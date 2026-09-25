import type { ActivationStatus, SessionUser, StaffProfile, UpdateStatus } from './types';
import type { PosResult } from '../shared/contracts/ipc';

/** What the LAN/cloud sync service reports (electron/sync-service.cjs). */
type MarketSyncStatus = { mode: 'vps' | 'lan' | 'offline'; pending: number; peerCount: number; vpsConnected?: boolean; bootstrapRequired?: boolean };
type DisplayPrefs = { mode: 'fullscreen' | 'windowed'; width: number; height: number; zoomFactor: number };
type DisplayPreset = { id: string; label: string; mode: 'fullscreen' | 'windowed'; width: number; height: number };

declare global {
  interface Window {
    marketSystem?: {
      staff: { list(): Promise<StaffProfile[]>; save(sessionToken: string, profile: Partial<StaffProfile>, pin: string): Promise<StaffProfile> };
      auth: { login(userId: string, pin: string): Promise<SessionUser>; logout(sessionToken: string): Promise<boolean>; current?(): Promise<SessionUser | null> };
      display: { get(): Promise<{ prefs: DisplayPrefs; presets: DisplayPreset[] }>; set(sessionToken: string, prefs: DisplayPrefs): Promise<DisplayPrefs>; toggleFullscreen(): Promise<DisplayPrefs> };
      image: { pick(sessionToken: string): Promise<string | null> };
      activation: {
        status(): Promise<ActivationStatus>;
        refresh(): Promise<ActivationStatus>;
        activate(sessionToken: string | null, activationKey: string): Promise<ActivationStatus>;
      };
      tenant: {
        status(): Promise<import('./types').TenantStatus>;
        login(email: string, password: string): Promise<import('./types').TenantStatus>;
        logout(): Promise<{ ok: boolean }>;
      };
      update: { status(): Promise<UpdateStatus>; check(sessionToken: string): Promise<UpdateStatus>; install(sessionToken: string): Promise<boolean>; onChanged(callback: (status: UpdateStatus) => void): () => void };
      sync: {
        status?(): Promise<MarketSyncStatus>;
        bootstrap?(sessionToken: string): Promise<unknown>;
        onChanged?(callback: (status: MarketSyncStatus) => void): () => void;
        push(sessionToken: string, snapshot: Record<string, unknown>, books?: Record<string, unknown>): Promise<{ connected: boolean; status?: number; reason?: string; inventory?: boolean; access?: string[] | null; device?: { station?: string } | null; commands?: Array<{ id: string; kind: string; body?: Record<string, unknown> }> }> };
      app: { info(): Promise<{ version: string; updateUrl: string; controlUrl: string; packaged: boolean }> };
      printer?: {
        list(): Promise<Array<{
          id: string; name: string; widthMm: number;
          connection?: string; model?: string; status?: string;
          isCurrent?: boolean; confirmed?: boolean;
        }>>;
        health(): Promise<{ online: boolean; provider: string; configured?: boolean; target?: string }>;
        test(sessionToken: string, widthMm?: number): Promise<{ ok: boolean; bytes: number }>;
        receipt(sessionToken: string, receipt: unknown, widthMm?: number): Promise<{ ok: boolean; bytes: number }>;
        /** Finds every printer and prints a page to each until one takes it. */
        detect(sessionToken: string, probe?: boolean): Promise<{
          current: string; chosen: string | null;
          printers: Array<{ target: string; displayName: string }>;
          probed: Array<{ target: string; displayName: string; ok: boolean; error: string }>;
        }>;
        setTarget(sessionToken: string, target: string): Promise<{ ok: boolean; current: string }>;
      };
      drawer?: { open(sessionToken: string, payload: Record<string, unknown>): Promise<unknown> };
      authExtra?: { verifyManagerPin(pin: string): Promise<{ ok: boolean; approverId: string; role: string; name: string }> };
      terminal?: { pay(sessionToken: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> };
      fiscal?: { processPending(sessionToken: string): Promise<unknown> };
    };
    marketCore?: {
      invoke(method: string, payload?: unknown, options?: { timeoutMs?: number }): Promise<PosResult>;
      status(): Promise<{ state: string; dbPath?: string }>;
      restart(sessionToken: string): Promise<{ state: string }>;
      onStatus(callback: (status: { state: string }) => void): () => void;
      onEvent(callback: (evt: { event: string; payload?: unknown }) => void): () => void;
    };
  }
}

export {};
