/**
 * Market POS IPC contracts (renderer ↔ Electron main).
 * Core domain methods are forwarded to market-pos-core via NDJSON.
 */
import type { ErrorCode, MethodName } from './protocol.generated';

export const MARKET_IPC = {
  invoke: 'market:invoke',
  coreStatus: 'market:coreStatus',
  coreStatusSnapshot: 'market:coreStatus:get',
  coreEvent: 'market:coreEvent',
  coreRestart: 'market:coreRestart',
} as const;

export type CoreState =
  | 'starting'
  | 'ready'
  | 'restarting'
  | 'crashed'
  | 'stopped';

export interface PosError {
  code: ErrorCode | string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface PosResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: PosError | null;
}

export function ok<T>(data: T): PosResult<T> {
  return { success: true, data, error: null };
}

export function fail(code: string, message: string, retryable = false, details?: unknown): PosResult<never> {
  return { success: false, error: { code, message, retryable, details } };
}

export type { MethodName, ErrorCode };
