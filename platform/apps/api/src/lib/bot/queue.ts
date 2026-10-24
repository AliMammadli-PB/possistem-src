/**
 * The waiting room between a WhatsApp message and the till.
 *
 * A command is a row in `bot_commands`; the POS picks it up on its next sync
 * tick and posts the result back. This module holds the in-flight promise so
 * the chat reply can be sent the moment the answer lands, and holds the
 * confirmation codes for actions that must not fire on a single typo.
 */
import { completeBotCommand, enqueueBotCommand } from '../mysql.js';
import type { ParsedCommand } from './parser.js';

/** How long the till has to answer before the owner gets "cavab vermədi". */
const RESULT_TIMEOUT_MS = 45_000;
/** A confirmation code is useless once the owner has walked away. */
const CONFIRM_TTL_MS = 5 * 60_000;

export type CommandOutcome = {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  timedOut?: boolean;
};

type Waiter = {
  resolve: (outcome: CommandOutcome) => void;
  timer: NodeJS.Timeout;
};

const waiters = new Map<string, Waiter>();

/** Action parked behind a 4-digit code, keyed by customer+sender. */
export type PendingConfirmation = {
  code: string;
  command: ParsedCommand;
  summary: string;
  expiresAt: number;
};

const confirmations = new Map<string, PendingConfirmation>();

function confirmKey(customerId: string, phone: string): string {
  return `${customerId}:${phone}`;
}

export function putConfirmation(
  customerId: string,
  phone: string,
  command: ParsedCommand,
  summary: string,
): string {
  // 4 digits is enough: it is a typo guard, not a secret, and the channel is
  // already restricted to numbers the owner listed.
  const code = String(Math.floor(1000 + Math.random() * 9000));
  confirmations.set(confirmKey(customerId, phone), {
    code,
    command,
    summary,
    expiresAt: Date.now() + CONFIRM_TTL_MS,
  });
  return code;
}

export function takeConfirmation(
  customerId: string,
  phone: string,
  code: string,
): PendingConfirmation | null {
  const key = confirmKey(customerId, phone);
  const pending = confirmations.get(key);
  if (!pending) return null;
  if (pending.expiresAt < Date.now()) {
    confirmations.delete(key);
    return null;
  }
  if (pending.code !== code) return null;
  confirmations.delete(key);
  return pending;
}

export function clearConfirmation(customerId: string, phone: string): boolean {
  return confirmations.delete(confirmKey(customerId, phone));
}

export function hasConfirmation(customerId: string, phone: string): boolean {
  const pending = confirmations.get(confirmKey(customerId, phone));
  if (!pending) return false;
  if (pending.expiresAt < Date.now()) {
    confirmations.delete(confirmKey(customerId, phone));
    return false;
  }
  return true;
}

/**
 * Queues work for the till and waits for the answer.
 *
 * The wait is in-memory: an API restart loses it and the owner is told the
 * till did not answer, which is honest — the command row itself is still there
 * with its real outcome.
 */
export async function runOnTill(input: {
  customerId: string;
  command: string;
  args?: Record<string, unknown>;
  requestedBy?: string | null;
  timeoutMs?: number;
  /** Only this till may take it (the portal's restaurant management). */
  deviceId?: string;
}): Promise<CommandOutcome & { commandId: string | null }> {
  const commandId = await enqueueBotCommand({
    customerId: input.customerId,
    command: input.command,
    args: input.deviceId ? { ...(input.args ?? {}), deviceId: input.deviceId } : input.args,
    requestedBy: input.requestedBy,
    ttlMs: (input.timeoutMs ?? RESULT_TIMEOUT_MS) + 30_000,
  });
  if (!commandId) {
    return { ok: false, error: 'command_queue_unavailable', commandId: null };
  }

  const outcome = await new Promise<CommandOutcome>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(commandId);
      resolve({ ok: false, timedOut: true });
    }, input.timeoutMs ?? RESULT_TIMEOUT_MS);
    timer.unref?.();
    waiters.set(commandId, { resolve, timer });
  });

  return { ...outcome, commandId };
}

/**
 * Restaurant management from the portal (1.8.0): while someone is working in
 * it, the till polls for commands every second instead of every five.
 */
const portalRpcAt = new Map<string, number>();
const PORTAL_FAST_MS = 120_000;

export function notePortalRpc(customerId: string): void {
  portalRpcAt.set(customerId, Date.now());
}

export function portalRpcActive(customerId: string): boolean {
  const at = portalRpcAt.get(customerId);
  return at !== undefined && Date.now() - at < PORTAL_FAST_MS;
}

/** Called by the device result route; wakes whoever is waiting on this command. */
export async function settleCommand(input: {
  customerId: string;
  commandId: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}): Promise<boolean> {
  const stored = await completeBotCommand(input);
  const waiter = waiters.get(input.commandId);
  if (waiter) {
    clearTimeout(waiter.timer);
    waiters.delete(input.commandId);
    waiter.resolve({
      ok: input.ok,
      result: input.result,
      error: input.error,
      errorCode: input.errorCode,
    });
  }
  return stored;
}
