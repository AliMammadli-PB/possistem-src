/**
 * Per-tenant WhatsApp Web sessions (Baileys) for owner X/Z alerts.
 */
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import pino from 'pino';
import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type CacheStore,
  type ConnectionState,
  type WAMessage,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { env } from '../env.js';

export type WaRuntimeStatus = 'idle' | 'qr' | 'connecting' | 'open' | 'close';

type Session = {
  sock: WASocket | null;
  status: WaRuntimeStatus;
  qrDataUrl: string | null;
  waUser: string | null;
  lastError: string | null;
  starting: boolean;
  /**
   * WhatsApp now addresses 1:1 chats by `@lid` and hides the phone number, so
   * the only way to know who wrote is a lid → phone map we build ourselves.
   */
  lidToPhone: Map<string, string>;
  phoneToLid: Map<string, string>;
  /** Persisted map already merged in, so the DB is read once per session. */
  lidSeeded: boolean;
  /** When the directory was last asked, so a stranger cannot drive lookups. */
  lidLookupAt: number;
  /**
   * Messages this session sent, so a peer that failed to decrypt one can be
   * answered when it asks for a retry.
   */
  sentMessages: Map<string, { message: proto.IMessage; at: number }>;
};

/** Sent messages worth keeping for a retry request; older ones are dropped. */
const SENT_CACHE_MAX = 200;
const SENT_CACHE_TTL_MS = 10 * 60_000;

/**
 * Minimal `CacheStore` over a Map.
 *
 * Baileys counts decryption-retry attempts here. Left unset it still works, but
 * supplying one keeps the counters per session rather than per process.
 */
function createCacheStore(): CacheStore {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      store.set(key, value);
    },
    del(key: string): void {
      store.delete(key);
    },
    flushAll(): void {
      store.clear();
    },
  };
}

/** A number with no lid in the directory is not worth re-asking about often. */
const LID_LOOKUP_COOLDOWN_MS = 60_000;

const sessions = new Map<string, Session>();
const logger = pino({ level: 'silent' });

function authDir(customerId: string): string {
  return path.join(env.whatsappAuthDir, customerId);
}

function ensureSession(customerId: string): Session {
  let s = sessions.get(customerId);
  if (!s) {
    s = {
      sock: null,
      status: 'idle',
      qrDataUrl: null,
      waUser: null,
      lastError: null,
      starting: false,
      lidToPhone: new Map(),
      phoneToLid: new Map(),
      lidSeeded: false,
      lidLookupAt: 0,
      sentMessages: new Map(),
    };
    sessions.set(customerId, s);
  }
  return s;
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function toJid(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

export function renderTemplate(
  template: string,
  vars: { admin: string; title: string; body: string },
): string {
  return template
    .replaceAll('{admin}', vars.admin)
    .replaceAll('{title}', vars.title)
    .replaceAll('{body}', vars.body);
}

/**
 * Where an inbound message goes.
 *
 * Set once by the API bootstrap. Keeping it a hook rather than a direct import
 * stops this transport module from depending on the bot's business logic, and
 * lets the socket layer be exercised on its own.
 */
export type IncomingHandler = (message: {
  customerId: string;
  /** Phone number, when one could be established. Null on an unmapped @lid. */
  from: string | null;
  /** The sender's @lid identifier, when the chat uses one. */
  lid: string | null;
  /** The jid this arrived on — the address a reply must go back to. */
  replyJid: string;
  text: string;
  messageId: string;
  pushName: string | null;
}) => Promise<void>;

let incomingHandler: IncomingHandler | null = null;

export function onIncomingWhatsapp(handler: IncomingHandler): void {
  incomingHandler = handler;
}

function waDebug(payload: unknown): void {
  try {
    const line = `${new Date().toISOString()} ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n`;
    fs.appendFileSync('/var/log/milioner-pos-control/wa-inbound.log', line);
  } catch {
    /* ignore */
  }
}

/**
 * Messages already processed — Baileys redelivers after a reconnect.
 *
 * Keyed per customer, never by message id alone. Several customers can have
 * sessions on one WhatsApp account (each is a linked device), so the same
 * message arrives on every socket. A global key let whichever socket got there
 * first swallow it and silenced the rest — in practice a leftover test tenant
 * was eating the real till's "X hesabat".
 */
const seenMessages = new Map<string, number>();

export function alreadySeen(customerId: string, id: string): boolean {
  const now = Date.now();
  if (seenMessages.size > 500) {
    for (const [key, at] of seenMessages) {
      if (now - at > 300_000) seenMessages.delete(key);
    }
  }
  const key = `${customerId}:${id}`;
  if (seenMessages.has(key)) return true;
  seenMessages.set(key, now);
  return false;
}

/** Plain text out of the half-dozen shapes WhatsApp uses to carry it. */
function extractText(message: WAMessage): string | null {
  const m = message.message;
  if (!m) return null;
  const text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    null;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

/** `994501234567:12@s.whatsapp.net` → `994501234567`. */
function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const bare = jid.split('@')[0] ?? '';
  const digits = bare.split(':')[0] ?? '';
  return normalizePhone(digits);
}

/** `54709645742099@lid` / `54709645742099:3@lid` → `54709645742099`. */
function lidFromJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.includes('@lid')) return null;
  const bare = (jid.split('@')[0] ?? '').split(':')[0] ?? '';
  return /^\d{5,}$/.test(bare) ? bare : null;
}

/** Records one lid ⇄ phone pair. Returns true when the map actually changed. */
export function rememberLid(
  customerId: string,
  lidRaw: string | null | undefined,
  phoneRaw: string | null | undefined,
): boolean {
  const lid = lidRaw ? (lidFromJid(lidRaw) ?? (/^\d{5,}$/.test(lidRaw) ? lidRaw : null)) : null;
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (!lid || !phone) return false;
  const s = ensureSession(customerId);
  if (s.lidToPhone.get(lid) === phone) return false;
  s.lidToPhone.set(lid, phone);
  s.phoneToLid.set(phone, lid);
  waDebug({ kind: 'lid_learned', customerId, lid, phone });
  return true;
}

export function getPhoneForLid(customerId: string, lid: string | null): string | null {
  if (!lid) return null;
  return ensureSession(customerId).lidToPhone.get(lid) ?? null;
}

/** The whole map, shaped for the JSONB column that survives an API restart. */
export function getLidMap(customerId: string): Record<string, string> {
  return Object.fromEntries(ensureSession(customerId).lidToPhone);
}

/** Merges the persisted map in, once per session; live entries always win. */
export function seedLidMap(customerId: string, stored: unknown): void {
  const s = ensureSession(customerId);
  if (s.lidSeeded) return;
  s.lidSeeded = true;
  if (!stored || typeof stored !== 'object') return;
  for (const [lid, phone] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof phone !== 'string' || s.lidToPhone.has(lid)) continue;
    const normalized = normalizePhone(phone);
    if (!normalized) continue;
    s.lidToPhone.set(lid, normalized);
    s.phoneToLid.set(normalized, lid);
  }
}

/**
 * Asks WhatsApp for the lid behind each number the owner listed.
 *
 * This is the only source that works before the owner has ever written: the
 * directory answers with both halves, so the very first "X HESABAT" from a
 * fresh install is already recognised. Numbers already mapped are not re-asked.
 */
export async function learnLidsFor(customerId: string, phones: string[]): Promise<boolean> {
  const s = ensureSession(customerId);
  if (s.status !== 'open' || !s.sock) return false;

  const missing = phones
    .map((p) => normalizePhone(p))
    .filter((p): p is string => Boolean(p) && !s.phoneToLid.has(p as string));
  if (missing.length === 0) return false;
  // A number the directory has no lid for would otherwise be re-asked on every
  // message a stranger sends.
  if (Date.now() - s.lidLookupAt < LID_LOOKUP_COOLDOWN_MS) return false;
  s.lidLookupAt = Date.now();

  try {
    const results = await s.sock.onWhatsApp(...missing.map((p) => `+${p}`));
    let changed = false;
    for (const entry of results ?? []) {
      const phone = phoneFromJid(entry.jid);
      const lid = typeof entry.lid === 'string' ? entry.lid : null;
      if (rememberLid(customerId, lid, phone)) changed = true;
    }
    waDebug({ kind: 'lid_lookup', customerId, asked: missing.length, changed });
    return changed;
  } catch (err) {
    waDebug({ kind: 'lid_lookup_failed', customerId, err: String(err) });
    return false;
  }
}

function registerIncoming(customerId: string, sock: WASocket): void {
  // Both events carry the pair outright, so a contact sync or a number share
  // fills the map without a directory round trip.
  sock.ev.on('chats.phoneNumberShare', (event: { lid?: string; jid?: string }) => {
    rememberLid(customerId, event?.lid, phoneFromJid(event?.jid));
  });
  const learnContacts = (contacts: { id?: string; lid?: string | null }[]) => {
    for (const contact of contacts ?? []) {
      rememberLid(customerId, contact?.lid, phoneFromJid(contact?.id));
    }
  };
  sock.ev.on('contacts.upsert', learnContacts);
  sock.ev.on('contacts.update', learnContacts);

  sock.ev.on('messages.upsert', (event) => {
    waDebug({
      kind: 'upsert',
      customerId,
      type: event.type,
      count: event.messages?.length ?? 0,
      jids: (event.messages ?? []).map((m) => ({
        remoteJid: m.key.remoteJid,
        remoteJidAlt: (m.key as { remoteJidAlt?: string }).remoteJidAlt,
        fromMe: m.key.fromMe,
        id: m.key.id,
        msgKeys: m.message ? Object.keys(m.message) : [],
      })),
    });
    // Baileys sometimes delivers live 1:1 traffic as "append" rather than
    // "notify" — accept both and let the age filter discard history.
    if (event.type !== 'notify' && event.type !== 'append') return;
    for (const message of event.messages) {
      void handleIncoming(customerId, message).catch((err) => {
        waDebug({ kind: 'handler_error', customerId, err: String(err) });
      });
    }
  });
}

/**
 * Who sent this, as far as the message itself can say.
 *
 * WhatsApp has moved 1:1 chats onto @lid jids. The phone number, when present
 * at all, rides on remoteJidAlt / participantAlt / senderPn. A lid's digits are
 * *not* a phone number — reading them as one is what made the owner's own
 * "X hesabat" arrive as a stranger — so the two are returned separately and the
 * caller decides how to identify the sender.
 */
export function identifySender(message: WAMessage): {
  phone: string | null;
  lid: string | null;
} {
  const key = message.key as WAMessage['key'] & {
    remoteJidAlt?: string;
    participantAlt?: string;
    senderPn?: string;
  };
  const candidates = [
    key.remoteJid,
    key.remoteJidAlt,
    key.participant,
    key.participantAlt,
    key.senderPn,
  ];

  let phone: string | null = null;
  let lid: string | null = null;
  for (const jid of candidates) {
    if (!jid) continue;
    if (jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) {
      continue;
    }
    if (!lid) lid = lidFromJid(jid);
    if (!phone && jid.includes('@s.whatsapp.net')) phone = phoneFromJid(jid);
  }
  return { phone, lid };
}

/** One "I could not read that" per chat per minute — a warning, not a siren. */
const undecryptableNotifiedAt = new Map<string, number>();
const UNDECRYPTABLE_NOTICE_MS = 60_000;

/**
 * Tells the sender their message arrived unreadable.
 *
 * WhatsApp shows them a delivered tick, so silence looks like a broken bot
 * rather than a delivery that has to be repeated — which is exactly how a Z
 * report confirmation code was lost.
 */
function notifyUndecryptable(customerId: string, remoteJid: string): void {
  if (!remoteJid) return;
  const key = `${customerId}:${remoteJid}`;
  const last = undecryptableNotifiedAt.get(key) ?? 0;
  if (Date.now() - last < UNDECRYPTABLE_NOTICE_MS) return;
  undecryptableNotifiedAt.set(key, Date.now());
  void sendWhatsappJid(
    customerId,
    remoteJid,
    [
      '⚠️ Mesajınızı oxuya bilmədim (şifrələmə xətası).',
      '',
      'Zəhmət olmasa *bir daha yazın*.',
      'Təkrarlanarsa: telefonda WhatsApp → Ayarlar → Bağlı cihazlar →',
      'hamısını çıxarın, sonra kassadan QR-ı yenidən oxudun.',
    ].join('\n'),
  ).catch(() => undefined);
}

function isDirectChat(message: WAMessage): boolean {
  const key = message.key as WAMessage['key'] & { remoteJidAlt?: string };
  const jids = [key.remoteJid ?? '', key.remoteJidAlt ?? ''];
  if (jids.some((j) => j.endsWith('@g.us') || j === 'status@broadcast' || j.endsWith('@newsletter'))) {
    return false;
  }
  return jids.some(
    (j) => j.endsWith('@s.whatsapp.net') || j.endsWith('@lid') || j.endsWith('@hosted'),
  );
}

async function handleIncoming(customerId: string, message: WAMessage): Promise<void> {
  if (!incomingHandler) {
    waDebug({ kind: 'drop_no_handler', customerId });
    return;
  }
  if (message.key.fromMe) return;

  const remoteJid = message.key.remoteJid ?? '';
  if (!isDirectChat(message)) return;

  const messageId = message.key.id ?? '';
  if (!messageId || alreadySeen(customerId, messageId)) return;

  // A backlog replayed on reconnect must not fire yesterday's "close the day".
  const sentAt = Number(message.messageTimestamp ?? 0) * 1000;
  if (sentAt && Date.now() - sentAt > 120_000) return;

  const text = extractText(message);
  if (!text) {
    const keys = message.message ? Object.keys(message.message) : [];
    waDebug({ kind: 'drop_no_text', customerId, remoteJid, keys });
    // No keys at all means WhatsApp handed us an envelope it could not decrypt.
    // Staying silent is how a confirmation code went missing: the owner typed
    // it, the bot never saw it, and nothing came back. Say so instead.
    if (keys.length === 0) notifyUndecryptable(customerId, remoteJid);
    return;
  }

  const { phone, lid } = identifySender(message);
  // A message that shows both halves is free evidence — keep it.
  rememberLid(customerId, lid, phone);
  const from = phone ?? getPhoneForLid(customerId, lid);

  if (!from && !lid) {
    waDebug({
      kind: 'drop_no_sender',
      customerId,
      remoteJid,
      remoteJidAlt: (message.key as { remoteJidAlt?: string }).remoteJidAlt,
      text: text.slice(0, 40),
    });
    return;
  }

  waDebug({ kind: 'inbound', customerId, from, lid, text: text.slice(0, 60), remoteJid });

  await incomingHandler({
    customerId,
    from,
    lid,
    // Replying to the jid we were written from is the only address certain to
    // reach the sender; a phone jid rebuilt from a lid goes nowhere.
    replyJid: remoteJid,
    text,
    messageId,
    pushName: message.pushName ?? null,
  });
}

/**
 * Two tenants on one WhatsApp account is ambiguous by construction.
 *
 * Every linked device receives the same inbound message, so both bots answer
 * and the owner cannot tell which restaurant replied. Nothing here can pick the
 * right one, so it is made loud instead of silent — this went unnoticed for
 * days while a leftover test tenant answered on the real till's behalf.
 */
function warnIfAccountShared(customerId: string, waUser: string | null): void {
  if (!waUser) return;
  const others: string[] = [];
  for (const [id, other] of sessions) {
    if (id === customerId) continue;
    if (other.status === 'open' && other.waUser === waUser) others.push(id);
  }
  if (others.length === 0) return;
  waDebug({ kind: 'whatsapp_account_shared', customerId, waUser, others });
  console.warn(
    `[whatsapp] account ${waUser} is linked by more than one customer: ` +
      `${[customerId, ...others].join(', ')} — unlink all but the live till.`,
  );
}

export function getWhatsappRuntime(customerId: string) {
  const s = ensureSession(customerId);
  return {
    status: s.status,
    qrDataUrl: s.qrDataUrl,
    waUser: s.waUser,
    lastError: s.lastError,
  };
}

async function endSocket(customerId: string, logout: boolean) {
  const s = sessions.get(customerId);
  if (!s?.sock) return;
  try {
    if (logout) await s.sock.logout();
    else s.sock.end(undefined);
  } catch {
    /* ignore */
  }
  s.sock = null;
}

export async function clearWhatsappAuth(customerId: string): Promise<void> {
  await endSocket(customerId, true);
  const dir = authDir(customerId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const s = ensureSession(customerId);
  s.status = 'idle';
  s.qrDataUrl = null;
  s.waUser = null;
  s.lastError = null;
  s.starting = false;
  // A new pairing may be a different account entirely; its lids are not ours.
  s.lidToPhone.clear();
  s.phoneToLid.clear();
  s.lidSeeded = false;
  s.lidLookupAt = 0;
}

export async function startWhatsappPairing(customerId: string): Promise<Session> {
  const s = ensureSession(customerId);
  if (s.starting && s.status === 'qr' && s.qrDataUrl) return s;
  if (s.status === 'open' && s.sock) return s;

  s.starting = true;
  s.lastError = null;
  s.qrDataUrl = null;
  s.status = 'connecting';

  await endSocket(customerId, false);

  fs.mkdirSync(authDir(customerId), { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authDir(customerId));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    syncFullHistory: false,
    markOnlineOnConnect: true,
    msgRetryCounterCache: createCacheStore(),
    /**
     * Answers "I could not decrypt that, send it again".
     *
     * Baileys defaults this to `async () => undefined`, which means a retry
     * request can never be satisfied and the recipient's phone is stuck showing
     * "Mesaj gözlənilir" for good. Serving the message back from what this
     * session just sent lets the peer recover on its own.
     */
    getMessage: async (key) => {
      const id = key?.id;
      if (!id) return undefined;
      return s.sentMessages.get(id)?.message;
    },
  });
  s.sock = sock;

  sock.ev.on('creds.update', saveCreds);
  // Registered on the one socket factory, so pairing, reconnect and the
  // restore-at-boot path all get a listening bot.
  registerIncoming(customerId, sock);

  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        s.qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 280,
          color: { dark: '#1a140c', light: '#ffffff' },
        });
        s.status = 'qr';
        s.starting = false;
      } catch (err) {
        s.lastError = err instanceof Error ? err.message : 'qr_failed';
      }
    }
    if (connection === 'open') {
      s.status = 'open';
      s.qrDataUrl = null;
      s.starting = false;
      const id = sock.user?.id?.split(':')[0] ?? null;
      s.waUser = id;
      waDebug({ kind: 'connection_open', customerId, waUser: id });
      warnIfAccountShared(customerId, id);
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      s.status = 'close';
      s.sock = null;
      s.starting = false;
      s.lastError = loggedOut ? 'logged_out' : `closed_${code ?? 'unknown'}`;
      // A bot that never comes back looks identical to a bot nobody wrote to,
      // so why the socket dropped has to reach the log.
      waDebug({
        kind: 'connection_closed',
        customerId,
        code: code ?? null,
        loggedOut,
        reason: lastDisconnect?.error?.message ?? null,
      });
      if (loggedOut) {
        // WhatsApp has unlinked this device, so the stored credentials can only
        // ever produce another 401. Keeping them made "Show QR" fail silently
        // instead of offering a new code — the owner saw a dead bot with no way
        // to revive it. Dropping them turns the next connect into a fresh QR.
        try {
          fs.rmSync(authDir(customerId), { recursive: true, force: true });
          waDebug({ kind: 'auth_cleared_after_logout', customerId });
        } catch (err) {
          waDebug({ kind: 'auth_clear_failed', customerId, err: String(err) });
        }
        s.lidToPhone.clear();
        s.phoneToLid.clear();
        s.lidSeeded = false;
        s.lidLookupAt = 0;
        s.waUser = null;
      }
      if (!loggedOut && code !== DisconnectReason.connectionReplaced) {
        // Soft reconnect without forcing a new QR if auth still valid.
        setTimeout(() => {
          void startWhatsappPairing(customerId).catch(() => undefined);
        }, 4_000);
      }
    }
  });

  return s;
}

export async function waitForQr(
  customerId: string,
  timeoutMs = 25_000,
): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const s = ensureSession(customerId);
    if (s.qrDataUrl) return s.qrDataUrl;
    if (s.status === 'open') return null;
    await new Promise((r) => setTimeout(r, 400));
  }
  return ensureSession(customerId).qrDataUrl;
}

/** Sends to a jid exactly as given — used to answer on the chat we were written from. */
export async function sendWhatsappJid(
  customerId: string,
  jid: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!jid) return { ok: false, error: 'invalid_jid' };
  const s = ensureSession(customerId);
  if (s.status !== 'open' || !s.sock) {
    return { ok: false, error: 'whatsapp_not_connected' };
  }
  try {
    const sent = await s.sock.sendMessage(jid, { text });
    rememberSent(s, sent?.key?.id, sent?.message);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'send_failed' };
  }
}

/** Keeps a sent message around long enough to serve a retry request. */
function rememberSent(
  s: Session,
  id: string | null | undefined,
  message: proto.IMessage | null | undefined,
): void {
  if (!id || !message) return;
  const now = Date.now();
  s.sentMessages.set(id, { message, at: now });
  if (s.sentMessages.size > SENT_CACHE_MAX) {
    for (const [key, entry] of s.sentMessages) {
      if (now - entry.at > SENT_CACHE_TTL_MS) s.sentMessages.delete(key);
    }
    // Still oversized after ageing out: drop oldest-first until back in budget.
    while (s.sentMessages.size > SENT_CACHE_MAX) {
      const oldest = s.sentMessages.keys().next().value;
      if (oldest === undefined) break;
      s.sentMessages.delete(oldest);
    }
  }
}

export async function sendWhatsappText(
  customerId: string,
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: 'invalid_phone' };
  return sendWhatsappJid(customerId, toJid(normalized), text);
}

export async function restoreWhatsappSessions(
  customerIds: string[],
): Promise<void> {
  for (const id of customerIds) {
    const dir = authDir(id);
    if (!fs.existsSync(path.join(dir, 'creds.json'))) {
      waDebug({ kind: 'restore_skipped_no_creds', customerId: id, dir });
      continue;
    }
    try {
      await startWhatsappPairing(id);
      waDebug({ kind: 'restore_started', customerId: id });
    } catch (err) {
      // Swallowing this silently meant a bot that failed to come back at boot
      // was indistinguishable from one nobody had messaged yet.
      waDebug({ kind: 'restore_failed', customerId: id, err: String(err) });
      console.error(`[whatsapp] restore failed for ${id}: ${String(err)}`);
    }
  }
}
