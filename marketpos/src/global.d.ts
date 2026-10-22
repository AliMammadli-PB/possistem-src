import type { ActivationStatus, SessionUser, StaffProfile, UpdateStatus } from './types';
import type { PosResult } from '../shared/contracts/ipc';

/** What the LAN/cloud sync service reports (electron/sync-service.cjs). */
type MarketSyncStatus = { mode: 'vps' | 'lan' | 'offline'; pending: number; peerCount: number; vpsConnected?: boolean; bootstrapRequired?: boolean };
type DisplayPrefs = { mode: 'fullscreen' | 'windowed'; width: number; height: number; zoomFactor: number };
type DisplayPreset = { id: string; label: string; mode: 'fullscreen' | 'windowed'; width: number; height: number };

declare global {
  interface Window {
    /** Əməliyyatlar - the warehouse system (electron/ops-engine.cjs). */
    marketOps?: {
      invoke(input: { sessionToken: string; method: string; payload?: unknown; idempotencyKey?: string; timeoutMs?: number }): Promise<PosResult<unknown>>;
      status(): Promise<{ host: boolean; state: string; available: boolean; catalogPending?: boolean; catalogError?: string | null; errors?: Record<string, string>; parked?: { key: string; error: string; at: number }[]; linked?: number }>;
      setHost(sessionToken: string, host: boolean): Promise<{ host: boolean; state: string; available: boolean; catalogPending?: boolean; catalogError?: string | null }>;
      sync(sessionToken: string): Promise<PosResult<unknown>>;
      categories?(): Promise<string[]>;
      cashSummary(sessionToken: string): Promise<PosResult<{ accounts: Array<{ id: string; name: string; kind: string; terminalId: string; balanceMinor: number; todayCashMinor: number; todayCardMinor: number }>; registerNames: Record<string, string> }>>;
    };
    marketSystem?: {
      permissions: {get(sessionToken:string):Promise<any>;save(sessionToken:string,role:string,permissions:string[],expectedVersion:number):Promise<any>};
      branches:{selection(sessionToken:string):Promise<unknown>;manage(sessionToken:string,operation:Record<string,unknown>):Promise<unknown>;assign(sessionToken:string,deviceId:string,name:string|{branchId:string}):Promise<unknown>;list(sessionToken:string):Promise<unknown>;rpc(sessionToken:string,deviceId:string,calls:unknown[]):Promise<unknown>;stock?(sessionToken:string):Promise<{at:number;own:import('./BranchStockView').StockSnapshot|null;branches:import('./BranchStockView').StockSnapshot[]}>;queueEdits?(sessionToken:string,deviceId:string,requestId:string,edits:unknown[],note?:string):Promise<{queued:boolean;online:boolean;commandIds:string[]}>;edits?(sessionToken:string,deviceId:string):Promise<any>;cancelEdit?(sessionToken:string,id:string):Promise<unknown>};
      branchContext(sessionToken: string): Promise<{ registerId: string; branchName: string; objectId: string }>;
      staff: {
        list(): Promise<StaffProfile[]>; save(sessionToken: string, profile: Partial<StaffProfile>, pin: string): Promise<StaffProfile>;
        remove(sessionToken: string, id: string): Promise<{ ok: boolean }>;
        places(sessionToken: string): Promise<{ warehouses?:{id:string;name:string}[]; objects: { id: string; name: string }[]; registers: { id: string; name: string; objectId: string }[] }>;
      };
      auth: { login(userId: string, pin: string): Promise<SessionUser>; adminPrefix?(digits: string): Promise<boolean>; logout(sessionToken: string): Promise<boolean>; current?(): Promise<SessionUser | null>; changePin(sessionToken: string, newPin: string): Promise<StaffProfile>; rights?(sessionToken: string, userId?: string): Promise<string[]> };
      display: { get(): Promise<{ prefs: DisplayPrefs; presets: DisplayPreset[] }>; set(sessionToken: string, prefs: DisplayPrefs): Promise<DisplayPrefs>; toggleFullscreen(): Promise<DisplayPrefs> };
      image: { pick(sessionToken: string): Promise<string | null> };
      activation: {
        status(): Promise<ActivationStatus>;
        refresh(): Promise<ActivationStatus>;
        activate(sessionToken: string | null, activationKey: string): Promise<ActivationStatus>;
      };
      support?: {
        active(): Promise<{ ticket: import('./SupportChat').SupportTicket | null; messages: import('./SupportChat').SupportMessage[] }>;
        send(ticketId: string | null, body: string): Promise<unknown>;
        messages(ticketId: string, after?: string): Promise<import('./SupportChat').SupportMessage[] | { messages: import('./SupportChat').SupportMessage[] }>;
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
      labels?: import('./labelTypes').LabelApi;
      printer?: {
        list(): Promise<Array<{
          id: string; name: string; widthMm: number;
          connection?: string; model?: string; status?: string;
          isCurrent?: boolean; confirmed?: boolean;
        }>>;
        health(): Promise<{ online: boolean; provider: string; configured?: boolean; target?: string }>;
        test(sessionToken: string, widthMm?: number): Promise<{ ok: boolean; bytes: number }>;
        receipt(sessionToken: string, receipt: unknown, widthMm?: number): Promise<{ ok: boolean; bytes: number }>;
        /** Preparation ticket for an extra kitchen printer, sent to its own target. */
        station?(sessionToken: string, target: string, ticket: { stationName: string; receiptNo: string; createdAt: number; items: Array<{ name: string; qty: number; unit?: string }> }, widthMm?: number): Promise<{ ok: boolean; bytes: number }>;
        /** Finds every printer and prints a page to each until one takes it. */
        detect(sessionToken: string, probe?: boolean): Promise<{
          current: string; chosen: string | null;
          printers: Array<{ target: string; displayName: string }>;
          probed: Array<{ target: string; displayName: string; ok: boolean; error: string }>;
        }>;
        setTarget(sessionToken: string, target: string): Promise<{ ok: boolean; current: string }>;
      };
      drawer?: { open(sessionToken: string, options?: { reason?: string; managerPin?: string }): Promise<unknown> };
      terminal?: { pay(sessionToken: string, payload: { amountMinor: number; mode: 'manual' | 'mock_integrated'; reference?: string }): Promise<Record<string, unknown>> };
      fiscal?: { processPending(sessionToken: string): Promise<unknown> };
    };
    marketCore?: {
      invoke(method: string, payload?: unknown, options?: { timeoutMs?: number; managerPin?: string }): Promise<PosResult>;
      status(): Promise<{ state: string; dbPath?: string }>;
      restart(sessionToken: string): Promise<{ state: string }>;
      onStatus(callback: (status: { state: string }) => void): () => void;
      onEvent(callback: (evt: { event: string; payload?: unknown }) => void): () => void;
    };
  }
}

export {};
