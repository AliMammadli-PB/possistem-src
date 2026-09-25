import type { MethodName } from '../../shared/contracts/protocol.generated';
import type { PosResult } from '../../shared/contracts/ipc';
import type { PersistedState, Product, ProductDraft, Register, Sale, StoreSettings } from '../types';

/** `managerPin` is what the override dialog collected; main verifies it. */
export type CallOptions = { managerPin?: string };
type InvokeFn = (method: MethodName | string, payload?: unknown, options?: CallOptions) => Promise<PosResult>;

function getInvoke(): InvokeFn | null {
  const core = window.marketCore;
  if (!core?.invoke) return null;
  return (method, payload, options) => core.invoke(method, payload, options);
}

/**
 * Staff session token, attached to every core call so the main process can
 * derive the trusted actorId/role. The renderer no longer sends its own role —
 * main overwrites both fields from this token.
 */
let sessionToken: string | null = null;

export function setCoreSessionToken(token: string | null): void {
  sessionToken = token;
}

/** Adds the session token without clobbering a non-object payload. */
function withSession(payload?: unknown): unknown {
  if (!sessionToken) return payload;
  if (payload === undefined || payload === null) return { sessionToken };
  if (typeof payload !== 'object' || Array.isArray(payload)) return payload;
  return { ...(payload as Record<string, unknown>), sessionToken };
}

async function call<T>(method: MethodName | string, payload?: unknown, options?: CallOptions): Promise<T> {
  const invoke = getInvoke();
  if (!invoke) throw new Error('marketCore unavailable');
  const result = await invoke(method, withSession(payload), options);
  if (!result.success) {
    // A refusal reads the same on every screen, whatever the core called it.
    const denied = result.error?.code === 'PERMISSION_DENIED';
    const err = new Error(denied ? 'Buna icazəniz yoxdur' : result.error?.message || method);
    (err as Error & { code?: string; details?: unknown }).code = result.error?.code;
    (err as Error & { details?: unknown }).details = result.error?.details;
    throw err;
  }
  return result.data as T;
}

export const marketCoreClient = {
  available(): boolean {
    return Boolean(window.marketCore?.invoke);
  },
  status(): Promise<{ state: string }> {
    return window.marketCore?.status() ?? Promise.resolve({ state: 'unavailable' });
  },
  ping: () => call<{ pong: boolean }>('core.ping'),
  getState: () => call<PersistedState>('state.get'),
  importLegacy: (snapshot: PersistedState) => call<PersistedState>('state.importLegacy', { snapshot }),
  products: {
    list: (activeOnly = false) => call<Product[]>('product.list', { activeOnly }),
    save: (product: ProductDraft, actorId?: string) => call<Product>('product.update', { product, actorId }),
    create: (product: ProductDraft, actorId?: string) => call<Product>('product.create', { product, actorId }),
    importPreview: (rows: unknown[]) => call('product.importPreview', { rows }),
    importCommit: (rows: unknown[], actorId: string, role: string, dryRun = false) =>
      call('product.importCommit', { rows, actorId, role, dryRun }),
  },
  barcode: {
    resolve: (barcode: string) => call<Record<string, unknown>>('barcode.resolve', { barcode }),
  },
  sales: {
    complete: (payload: Record<string, unknown>) => call<Sale>('sale.complete', payload),
    list: () => call<Sale[]>('sale.list'),
    hold: (payload: Record<string, unknown>) => call('sale.hold', payload),
    resume: (id: string) => call('sale.resume', { id }),
    listHeld: () => call('sale.listHeld'),
    cancelHeld: (id: string, actorId: string, role: string, approverId?: string) =>
      call('sale.cancelHeld', { id, actorId, role, approverId }),
    receipt: (saleId: string) => call('sale.receipt', { saleId }),
    overridePrice: (payload: Record<string, unknown>) => call('sale.overridePrice', payload),
  },
  returns: {
    create: (saleId: string, actorId: string) => call<Sale>('return.create', { saleId, actorId }),
    partial: (payload: Record<string, unknown>) => call('return.partial', payload),
  },
  inventory: {
    transfer: (payload: Record<string, unknown>) => call<PersistedState>('inventory.transfer', payload),
    adjust: (payload: Record<string, unknown>) => call('inventory.adjust', payload),
    valuation: (warehouseId?: string) => call('inventory.valuation', warehouseId ? { warehouseId } : {}),
    lowStock: () => call('inventory.lowStock'),
    /** A write-off with a reason - not a negative adjustment. */
    waste: (payload: Record<string, unknown>) => call('inventory.waste', payload),
    wasteReasons: () => call<{ reasons: Array<{ code: string; label: string }> }>('inventory.wasteReasons'),
  },
  purchases: {
    create: (order: unknown) => call('purchase.create', { order }),
    receive: (id: string, actorId: string, portalCommandId?: string) => call<PersistedState>('purchase.receive', { id, actorId, portalCommandId }),
    list: () => call('purchase.list'),
    get: (id: string) => call('purchase.get', { id }),
    update: (payload: Record<string, unknown>) => call('purchase.update', payload),
    returnPartial: (payload: Record<string, unknown>) => call('purchase.returnPartial', payload),
    returns: (purchaseId: string) => call('purchase.returns', { purchaseId }),
  },
  cash: {
    bindDeviceRegister: (name: string, operatorId: string, updatedAt: number) =>
      call<{ register: Register; settings: StoreSettings }>('cash.bindDeviceRegister', {
        name,
        operatorId,
        updatedAt,
      }),
    open: (registerId: string, operatorId: string, openingFloatMinor = 0) =>
      call('cash.openSession', { registerId, operatorId, openingFloatMinor }),
    current: (registerId: string) =>
      call<{ open: boolean; session?: Record<string, unknown> }>('cash.currentSession', { registerId }),
    close: (registerId: string, operatorId: string) => call('cash.closeSession', { registerId, operatorId }),
    createRegister: (register: unknown) => call('cash.createRegister', { register }),
    cashIn: (payload: Record<string, unknown>, options?: CallOptions) => call('cash.cashIn', payload, options),
    movements: () => call<Array<{ id: string; kind: string; amountMinor: number; reason: string; createdAt: number }>>('cash.movements'),
    cashOut: (payload: Record<string, unknown>, options?: CallOptions) => call('cash.cashOut', payload, options),
    safeDrop: (payload: Record<string, unknown>, options?: CallOptions) => call('cash.safeDrop', payload, options),
    xReport: (registerId: string) => call('cash.xReport', { registerId }),
    zClose: (payload: Record<string, unknown>, options?: CallOptions) => call('cash.zClose', payload, options),
  },
  auth: {
    checkPermission: (role: string, permission: string, actorId?: string) =>
      call<{ allowed: boolean }>('auth.checkPermission', { role, permission, actorId }),
    listPermissions: (role: string) => call('auth.listPermissions', { role }),
    recordApproval: (payload: Record<string, unknown>) => call('auth.recordApproval', payload),
    /** Every permission key the core knows, grouped by what it governs. */
    permissionCatalogue: () =>
      call<{ groups: Record<string, { permission: string; label: string }[]> }>(
        'auth.permissionCatalogue',
      ),
    roles: () =>
      call<{ roles: { role: string; label: string; custom: boolean; permissions: string[] }[] }>(
        'auth.roles',
      ),
    /** Creates or updates; `permissions` replaces the whole set for that role. */
    saveRole: (role: string, label: string, permissions: string[]) =>
      call<{ role: string; granted: number }>('auth.saveRole', { role, label, permissions }),
    deleteRole: (role: string) => call<{ ok: boolean }>('auth.deleteRole', { role }),
    getOverrides: (employeeId: string) => call('auth.getOverrides', { employeeId }),
    setOverride: (payload: Record<string, unknown>) => call('auth.setOverride', payload),
  },
  stocktake: {
    create: (payload: Record<string, unknown>) => call('stocktake.create', payload),
    list: () => call('stocktake.list'),
    get: (id: string) => call('stocktake.get', { id }),
    updateLine: (id: string, countedQty: number, actorId: string, role: string) => call('stocktake.updateLine', { id, countedQty, actorId, role }),
    setStatus: (id: string, status: string, actorId: string, role: string) => call('stocktake.setStatus', { id, status, actorId, role }),
    post: (id: string, actorId: string, role: string) => call('stocktake.post', { id, actorId, role }),
  },
  customers: {
    list: () => call('customer.list'),
    create: (payload: Record<string, unknown>) => call('customer.create', payload),
    /** Partial update — omitted fields keep their current value. Used to assign a bonus card. */
    update: (payload: Record<string, unknown>) => call('customer.update', payload),
    ledger: (customerId: string) => call('customer.ledger', { customerId }),
    payDebt: (payload: Record<string, unknown>) => call('customer.payDebt', payload),
    summary: () => call('customer.summary'),
  },
  portal: {
    finance: () => call<{
      customers: Array<{ id: string; name: string; debtMinor: number }>;
      suppliers: Array<{ id: string; name: string; dueMinor: number }>;
      payments: Array<{ id: string; partyType: string; partyId: string; partyName: string; amountMinor: number; note: string; createdAt: number }>;
    }>('portal.finance'),
  },
  fiscal: {
    enqueue: (payload: Record<string, unknown>) => call('fiscal.enqueue', payload),
    listPending: () => call('fiscal.listPending'),
    retry: (id: string) => call('fiscal.retry', { id }),
  },
  warehouses: {
    create: (warehouse: unknown, actorId?: string) => call('warehouse.create', { warehouse, actorId }),
    update: (id: string, name: string, active: boolean, actorId?: string) =>
      call('warehouse.update', { id, name, active, actorId }),
  },
  settings: {
    set: (settings: unknown, actorId?: string) => call('settings.set', { settings, actorId }),
    setValue: (key: string, value: unknown, actorId: string, role: string) => call('settings.setValue', { key, value, actorId, role }),
  },
  audit: {
    append: (actorId: string, action: string, detail: string) =>
      call('audit.append', { actorId, action, detail }),
  },
  reports: {
    dailySales: (fromMs?: number, toMs?: number) => call('report.dailySales', { fromMs, toMs }),
    topProducts: (limit = 10) => call('report.topProducts', { limit }),
    profit: (fromMs?: number, toMs?: number) => call('report.profit', { fromMs, toMs }),
  },
  promo: {
    list: () => call('promo.list'),
    upsert: (payload: Record<string, unknown>) => call('promo.upsert', payload),
    evaluate: (items: unknown[]) => call('promo.evaluate', { items }),
  },
  supplier: {
    ledger: (supplierName: string) => call('supplier.ledger', { supplierName }),
    pay: (payload: Record<string, unknown>) => call('supplier.pay', payload),
    summary: () => call('supplier.summary'),
  },
  loyalty: {
    // balance/earn/redeem are gone. Bonus is earned and spent inside
    // sale.complete (one ledger row per sale, in the sale's transaction), and
    // the balance is read with the customer via customer.summary. The removed
    // trio duplicated that ledger from outside the sale — and `earn` had no
    // permission check at all, so it was an open points minter.
    config: () => call('loyalty.config'),
  },
  lots: {
    list: (payload: Record<string, unknown> = {}) => call('lot.list', payload),
    receive: (payload: Record<string, unknown>) => call('lot.receive', payload),
    expiryReport: (payload: Record<string, unknown> = {}) => call('lot.expiryReport', payload),
  },
  platform: {
    syncStatus: () => call('platform.syncStatus'),
    priceScopes: () => call('platform.priceScopes'),
    eqaimeStatus: () => call('platform.eqaimeStatus'),
    aggregatorStatus: () => call('platform.aggregatorStatus'),
  },
  terminal: {
    record: (payload: Record<string, unknown>) => call('terminal.record', payload),
  },
  treasury: {
    transfer: (payload: Record<string, unknown>) => call('treasury.transfer', payload),
    list: () => call('treasury.list'),
  },
};

export type MarketCoreClient = typeof marketCoreClient;
