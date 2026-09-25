import type { CoreState, ErrorCode, MethodName } from './protocol.generated';

/** Channels between renderer and main. The renderer never sees any other name. */
export const IPC = {
  invoke: 'pos:invoke',
  coreStatus: 'pos:coreStatus',
  coreStatusSnapshot: 'pos:coreStatus:get',
  coreEvent: 'pos:coreEvent',
  coreRestart: 'pos:coreRestart',
  appInfo: 'pos:appInfo',
  openLogs: 'pos:openLogs',
  sessionGet: 'pos:session:get',
  sessionChanged: 'pos:session:changed',
  updateStatus: 'pos:update:status',
  updateCheck: 'pos:update:check',
  updateInstall: 'pos:update:install',
  updateChanged: 'pos:update:changed',
  displayGet: 'pos:display:get',
  displaySet: 'pos:display:set',
  catalogPickImage: 'pos:catalog:image:pick',
  openExternal: 'pos:openExternal',
} as const;

/** Window size / zoom preference owned by the Electron main process. */
export interface DisplayPrefs {
  mode: 'fullscreen' | 'windowed';
  width: number;
  height: number;
  zoomFactor: number;
}

export interface DisplayPreset {
  id: string;
  label: string;
  mode: 'fullscreen' | 'windowed';
  width: number;
  height: number;
}

export interface DisplayOptions {
  prefs: DisplayPrefs;
  presets: DisplayPreset[];
  screen: { width: number; height: number };
}

/** Mirror of the authenticated operator, held in main (never renderer storage). */
export interface PosSession {
  userId: string;
  code: string;
  fullName: string;
  role: string;
  shiftId: string | null;
  permissions: string[];
  loginAt: number;
  authenticated: true;
}

/**
 * Live state of this restaurant's WhatsApp bot session on the control server.
 *
 * `status` is the Baileys socket: `qr` means a code is on screen waiting to be
 * scanned, `open` means the bot is linked and alerts will go out.
 */
export interface WhatsappRuntime {
  status: 'idle' | 'qr' | 'connecting' | 'open' | 'close' | string;
  qrDataUrl: string | null;
  waUser: string | null;
  lastError: string | null;
}

/** Which families of chat commands the bot will act on. */
export interface WhatsappBotPermissions {
  read: boolean;
  reports: boolean;
  catalog: boolean;
  alerts: boolean;
}

/** One remotely triggered action, as shown in the settings journal. */
export interface WhatsappCommandLogEntry {
  id: string;
  command: string;
  status: string;
  requestedBy: string | null;
  createdAt: string;
  error: string | null;
}

/**
 * Why the bot is or is not working, end to end.
 *
 * Every field here has at some point been the whole reason an owner's messages
 * went unanswered, and none of them were visible from the till: the failure and
 * "nobody wrote to the bot" produced exactly the same empty screen.
 */
export interface WhatsappDiagnostics {
  /**
   * Server-reported fields.
   *
   * All optional on purpose: a control server older than these routes answers
   * without them, and "the server did not say" must not be shown as "switched
   * off". Reading `undefined` as `false` had the screen announce that the live
   * database was missing while the bot was demonstrably answering out of it.
   */
  /** The control server's live mirror. Without it there is no command channel. */
  liveDatabase?: boolean;
  /** Whether this restaurant's till has ever reached the mirror. */
  deviceRegistered?: boolean;
  /** Whether the server has heard from it recently. */
  deviceOnline?: boolean;
  deviceLastSeenAt?: string | null;
  /** Last message the bot received / sent, ISO-8601. */
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  /** Filled in by the till itself — the server cannot report its own absence. */
  lastSyncOkAt?: string | null;
  lastSyncError?: string | null;
}

/** Stored alert settings plus the current pairing state. */
export interface WhatsappConfig {
  enabled: boolean;
  recipientPhone: string;
  adminName: string;
  messageTemplate: string;
  /** Master switch for two-way commands; alerts still flow when off. */
  botEnabled: boolean;
  /** Extra numbers, beside recipientPhone, allowed to command the bot. */
  allowedNumbers: string[];
  botPermissions: WhatsappBotPermissions;
  commands: WhatsappCommandLogEntry[];
  diagnostics: WhatsappDiagnostics;
  /** Persisted view: `connected` once a QR has been scanned. */
  waStatus: string;
  waUser: string | null;
  runtime: WhatsappRuntime;
}

/** Envelope written to the C++ sidecar's stdin. */
export interface CoreRequest {
  requestId: string;
  method: MethodName | string;
  protocolVersion: number;
  timestamp: number;
  payload: unknown;
}

export interface CoreErrorBody {
  code: ErrorCode | string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/** Envelope read from the C++ sidecar's stdout. */
export interface CoreResponse<T = unknown> {
  requestId: string;
  success: boolean;
  data: T | null;
  error: CoreErrorBody | null;
}

/**
 * Result shape handed to the renderer.
 *
 * Errors are always *values*, never thrown exceptions: a custom Error class
 * loses its prototype and extra properties crossing the contextBridge, so a
 * thrown `code` would silently vanish.
 */
export type PosResult<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: CoreErrorBody };

export interface InvokeOptions {
  /** Reused across retries so a replay returns the original result. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface InvokeRequest {
  method: string;
  payload?: unknown;
  options?: InvokeOptions;
}

/** Pushed to the renderer whenever the supervisor's view of the core changes. */
export interface CoreStatus {
  state: CoreState;
  /** Monotonic; lets the renderer discard a stale snapshot that lands late. */
  seq: number;
  attempt: number;
  pid: number | null;
  corePath: string;
  coreVersion: string | null;
  lastExitCode: number | null;
  lastError: { code: string; message: string } | null;
  sinceMs: number;
  /** Real startup progress, driven by core.stage events rather than a timer. */
  stage: { key: string; message: string; progress: number } | null;
  /**
   * What the core is working on right now, from its liveness replies.
   *
   * A busy core is alive. Keeping the two apart is what stops slow work - a
   * printer that is not answering, a long report - from being read as a hung
   * process and killed.
   */
  busy: { method: string; ms: number } | null;
}

export interface CoreEventMessage<T = unknown> {
  event: string;
  payload: T;
  seq: number;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  isDev: boolean;
  dbPath: string;
  logDir: string;
  corePath: string;
}

export function ok<T>(data: T): PosResult<T> {
  return { success: true, data, error: null };
}

export function fail<T = never>(
  code: ErrorCode | string,
  message: string,
  retryable = false,
  details?: unknown,
): PosResult<T> {
  return { success: false, data: null, error: { code, message, retryable, details } };
}
