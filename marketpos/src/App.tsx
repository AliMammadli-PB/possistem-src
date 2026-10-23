import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BarChart3, Boxes, Check,
  ChevronRight, CircleDollarSign, Cloud, CloudOff, 
  Expand, FileClock, LockKeyhole, LogOut, Minus,
  PackageSearch, Pause, Plus, ReceiptText,
  RotateCcw, Settings, ShieldCheck, ShoppingBag,
  ShoppingBasket, Smartphone, Store, Trash2, TriangleAlert, Users,
  WalletCards, X,
} from 'lucide-react';

import { createInitialState, readPersistedState } from './data';
import { ChangePinScreen } from './ChangePinScreen';
import { printStationTickets } from './KitchenStations';
import { canAccess, findBarcode, parseMoneyInput, ROLE_VIEWS, stockOf } from './domain';
import { auditActionLabel, auditDetailLabel, roleLabel, tr, unitLabel, viewLabel } from './i18n';
import { marketCoreClient } from './core/client';
import { ProductVisual } from './ProductVisual';
import { RolePermissionsPanel } from './RolePermissionsPanel';
import { SaleCatalog } from './SaleCatalog';
import { PaymentModal, checkoutErrorMessage } from './PaymentModal';
import {useCartApproval} from './useCartApproval';
import {
  CustomersPage, FiscalBadge, PlatformStubsPage,
  RegistersOpsPage, ReportsOpsPage,
} from './RetailOpsPanels';
import { OperationsWorkspace } from './OperationsWorkspace';
import { ManagementPage } from './ManagementPage';
import { ReturnsPage } from './ReturnsPage';
import { UsersPage } from './UsersPage';
import { ManagerApprovalModal } from './ManagerApprovalModal';
import { tenantLoginError } from './authErrors';
import { ObjectLoginGate } from './ObjectLoginGate';
import { SupportButton } from './SupportChat';
import type { RemoteObject } from './OperationsWorkspace';
import { BranchAdmin } from './BranchAdmin';
import type { BranchStockMode } from './BranchStockView';
import { SettingsPage } from './SettingsPage';
import type { ActivationStatus, CartLine, HeldCart, Lang, Payment, PersistedState, Product, Register, Role, Sale, SessionUser, StaffProfile, TenantStatus, View } from './types';

import { marketBooks, stockLines } from './books';
import { longDate, money, newId } from './format';
import { ACK_KEY, FAIL_KEY, ACK_PENDING_KEY, FAIL_PENDING_KEY, applyMarketCommand, clearPending, failedCommandReasons, productFromCard, readCommandIds, rememberCommandId, rememberFailure } from './portalCommands';
import { RegisterModal, RoleAvatar, Kpi } from './forms';
const STORE_KEY = 'possistem.market.pos.v2';
const LEGACY_MIGRATED_KEY = 'possistem.market.pos.core-migrated';
const CATALOG_SYNC_KEY = 'possistem.market.pos.catalog-sync';
// The local keys used the old company name; a till keeps its values under the
// new names (losing catalog-sync would re-run the catalogue import).
for (const name of ['v2', 'core-migrated', 'catalog-sync']) {
  try {
    const legacy = `cyberplus.market.pos.${name}`;
    const value = localStorage.getItem(legacy);
    if (value === null) continue;
    if (localStorage.getItem(`possistem.market.pos.${name}`) === null) localStorage.setItem(`possistem.market.pos.${name}`, value);
    localStorage.removeItem(legacy);
  } catch { /* storage blocked: nothing to move */ }
}
const CATALOG_SYNC_TOKEN = 'bravo-narimanov-azinko-catalog-aisles-v1';

const STOCK_VIEWS = new Set<View>(['ops']);
// The owner's rule: a missing permission never hides a button; using it says so.
const DENIED = 'Buna icazəniz yoxdur';
/** Market rights that open a screen (any one); screens not listed follow the role. */
const OPS_VIEW_RIGHTS = ["OPS_GOODS", "OPS_STOCK", "OPS_TRANSFERS", "OPS_PURCHASES", "OPS_STOCKTAKE", "OPS_CATEGORIES", "OPS_PARTNERS", "OPS_SALES", "OPS_CASH", "OPS_EXPENSES", "OPS_SALARY", "OPS_DOCUMENTS", "OPS_PROFIT", "OPS_EXPORT", "OPS_USERS"];
const VIEW_RIGHTS: Partial<Record<View, string[]>> = {
  ops: OPS_VIEW_RIGHTS, reports: ['VIEW_REPORTS', 'VIEW_PROFIT'], returns: ['SALE_REFUND', 'PARTIAL_REFUND'],
  settings: ['MANAGE_SETTINGS'], staff: ['MANAGE_USERS'],
};
/** Electron wraps a main-process refusal in "Error invoking remote method …"; show the refusal itself. */
/** True when the element (or one it sits in) is something a person acts on. */
function actsOn(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.matches('button, a, input, select, textarea, label, [role="button"], [role="tab"], [contenteditable="true"]')) return true;
    if (getComputedStyle(el).cursor === 'pointer') return true;
  }
  return false;
}

/**
 * A closed section, fully drawn: looking is free, acting on it is refused.
 * The owner's rule - the screen keeps its buttons; pressing one says why not.
 */
function LockedArea({ locked, onDenied, children }: { locked: boolean; onDenied: () => void; children: React.ReactNode }) {
  if (!locked) return <>{children}</>;
  const refuse = (event: React.SyntheticEvent) => {
    if (!actsOn(event.target, event.currentTarget)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'pointerdown') onDenied();
  };
  return (
    <div
      className="locked-area"
      data-ps-locked="true"
      onClickCapture={refuse}
      onPointerDownCapture={refuse}
      onSubmitCapture={refuse}
      onKeyDownCapture={(event) => { if (event.key !== 'Tab' && !event.key.startsWith('Arrow') && event.key !== 'Escape') refuse(event); }}
    >
      {children}
    </div>
  );
}

function cleanNotice(message: string | null): string | null {
  if (!message) return message;
  const bare = message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
  return /icazə yoxdur|PERMISSION_DENIED|role required/i.test(bare) ? DENIED : bare;
}
const MARKET_AREAS = ['dashboard', 'sale', 'ops', 'inventory', 'warehouses', 'purchases', 'returns', 'reports', 'registers', 'stocktake', 'customers', 'import', 'staff', 'settings'];
// What each PC is for, set by the owner on possistem.az (Kompüterlər): the
// website's areas are narrowed to it, so the store-room PC opens on stock.
const STATION_VIEWS: Record<string, string[]> = {
  cashier: ['sale', 'returns', 'registers', 'customers', 'settings'],
  waiter: ['sale', 'customers', 'settings'],
  kitchen: ['sale', 'settings'],
  warehouse: ['ops', 'inventory', 'reports', 'settings'],
};
function narrowByStation(access: string[] | null, station: string | undefined): string[] | null {
  const allowed = station ? STATION_VIEWS[station] : undefined;
  if (!allowed) return access;
  return (access ?? MARKET_AREAS).filter((key) => allowed.includes(key));
}


export default function App() {
  const [legacyState] = useState(() => readPersistedState(localStorage, STORE_KEY));
  const [state, setState] = useState<PersistedState>(() => (marketCoreClient.available() ? null : legacyState) ?? createInitialState());
  const [coreReady, setCoreReady] = useState(false);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [objectSession,setObjectSession]=useState<string|null>(null);
  const [lang, setLang] = useState<Lang>('az');
  const [view, setView] = useState<View>('dashboard');
  const [branch, setBranch] = useState<{ registerId: string; branchName: string } | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => { if (session && coreReady && window.marketSystem?.branchContext) void window.marketSystem.branchContext(session.sessionToken).then(next => { if (live) setBranch(next); }).catch(() => { if (live) setBranch(null); }); };
    setBranch(null); refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [session?.sessionToken, coreReady, state.settings.defaultRegisterId, view]);
  // The owner's objects for the top-bar switch: another object's Əməliyyatlar
  // opens here over the internet (its till answers), this one's stays local.
  type Till = { deviceId: string; branchId?: string | null; online?: boolean; onlineUntil?:number; supported?: boolean; local?: boolean; product?: string };
  const [places, setPlaces] = useState<{ objects: { id: string; name: string }[]; tills: Till[] } | null>(null);
  const [remote, setRemote] = useState<RemoteObject | null>(null);
  // Read-only stock: every branch summed, or a branch's last copy (offline too).
  const [stockView, setStockView] = useState<BranchStockMode | null>(null);
  const [placesTick, setPlacesTick] = useState(0);
  useEffect(() => {
    const branches = window.marketSystem?.branches;
    setRemote(null);
    if (!session || session.role !== 'manager' || !branches) { setPlaces(null); return; }
    let live = true;
    const load = () => branches.list(session.sessionToken).then((data) => {
      const d = data as { objects?: { id: string; name: string }[]; branches?: Till[] };
      if (live) setPlaces({ objects: d.objects ?? [], tills: d.branches ?? [] });
    }).catch(() => { if (live) setPlaces(null); });
    void load();
    const timer = window.setInterval(load, 20000);
    const presenceTimer=window.setInterval(()=>setPlaces(p=>p?{...p,tills:p.tills.map(d=>Number.isFinite(d.onlineUntil)?{...d,online:Date.now()<d.onlineUntil!}:d)}:p),1000);
    // The remote screens reach the other till through this (cloud-branches/remote).
    (window as unknown as { cloudBranches?: unknown }).cloudBranches = { rpc: (id: string, calls: unknown[]) => branches.rpc(session.sessionToken, id, calls) };
    return () => { live = false; window.clearInterval(timer);window.clearInterval(presenceTimer); };
  }, [session?.sessionToken, session?.role, placesTick]);
  useEffect(() => { if (view !== 'ops') { setRemote(null); setStockView(null); } }, [view]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const syncInputs = useRef({state,staff,branch});
  syncInputs.current={state,staff,branch};
  const navigationRequest = useRef(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [inventoryOn, setInventoryOn] = useState(true);
  // What the website last allowed, kept across restarts: a till that starts
  // offline must not come up with every screen the head admin closed open again.
  const [marketAccess, setMarketAccess] = useState<string[] | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('market.access') ?? 'null');
      return Array.isArray(saved) ? saved : null;
    } catch { return null; }
  });
  // What the signed-in user may do: role grants plus the super admin's per-worker overrides.
  // null until the core answers (the role alone decides meanwhile); polled, so a
  // right taken away on the website hides its screen and buttons within ~20 s.
  const [rights, setRights] = useState<string[] | null>(null);
  useEffect(() => {
    const load = window.marketSystem?.auth.rights;
    setRights(null);
    if (!session || !load) return;
    let live = true;
    const pull = () => void load(session.sessionToken).then((next) => { if (live) setRights((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)); }).catch(() => undefined);
    pull();
    const timer = window.setInterval(pull, 20000);
    return () => { live = false; window.clearInterval(timer); };
  }, [session?.sessionToken]);
  const [notice, setNoticeRaw] = useState<string | null>(null);
  const setNotice = useCallback((message: string | null) => setNoticeRaw(cleanNotice(message)), []);
  useEffect(() => { const warning = () => setNotice(tr(lang, 'inventorySyncPending')); window.addEventListener('market:ops:warning', warning); return () => window.removeEventListener('market:ops:warning', warning); }, [lang, setNotice]);
  const deny = useCallback(() => setNoticeRaw(DENIED), []);
  const [registerModal, setRegisterModal] = useState(false);

  (window as unknown as {__marketOpsToken?:string}).__marketOpsToken=session?.sessionToken;
  const t = (key: string) => tr(lang, key);

  const refreshFromCore = async () => {
    const next = await marketCoreClient.getState();
    setState(next);
    return next;
  };

  // The core announces every write - its own, and another till's arriving
  // through sync.apply - so a price or a stock count changed on one PC lands on
  // every other PC's screen without anyone refreshing. A receipt or a sync batch
  // is many writes; they collapse into one read.
  useEffect(() => {
    if (!coreReady || !window.marketCore?.onEvent) return;
    let timer = 0;
    const off = window.marketCore.onEvent((evt) => {
      if (evt?.event !== 'state.changed') return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void refreshFromCore().catch(() => undefined); }, 200);
    });
    return () => { window.clearTimeout(timer); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreReady]);

  // Safety net: a dropped frame must not strand the till on stale data.
  useEffect(() => {
    if (!coreReady) return;
    const timer = window.setInterval(() => { void refreshFromCore().catch(() => undefined); }, 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreReady]);

  // The sync service (LAN peers + cloud) says whether this till is talking to
  // the others; the cloud badge follows it rather than only the 30 s heartbeat.
  const [syncStatus, setSyncStatus] = useState<{ mode: 'vps' | 'lan' | 'offline'; peerCount: number; pending: number } | null>(null);
  useEffect(() => {
    const sync = window.marketSystem?.sync;
    if (!sync?.onChanged) return;
    void sync.status?.().then((status) => setSyncStatus(status)).catch(() => undefined);
    return sync.onChanged((status) => {
      setSyncStatus(status);
      if (typeof status?.vpsConnected === 'boolean') setCloudConnected(status.vpsConnected);
    });
  }, [coreReady]);

  // Several PCs share one shop's data, so each PC must be its own register -
  // two tills ringing up on one register would share a drawer and a Z report.
  // The first person who works a till names it; the core binds the register to
  // this device (settings.deviceRegisterId, never synced).
  const [registerName, setRegisterName] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const bindThisRegister = async () => {
    if (!session || !registerName.trim()) return;
    setRegisterBusy(true); setRegisterError(null);
    try {
      await marketCoreClient.cash.bindDeviceRegister(registerName.trim(), session.id, Date.now());
      await refreshFromCore();
    } catch (error) {
      setRegisterError(error instanceof Error ? error.message : String(error));
    } finally { setRegisterBusy(false); }
  };

  const mutate = (fn: (previous: PersistedState) => PersistedState, action?: string, detail?: string) => {
    // Browser / core-unavailable fallback only. Electron retail mutations go through C++.
    if (coreReady && marketCoreClient.available()) {
      void (async () => {
        try {
          if (action && session) await marketCoreClient.audit.append(session.id, action, detail || action);
          await refreshFromCore();
        } catch (err) {
          setNotice(err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }
    setState((previous) => {
      const next = fn(previous);
      if (!action || !session) return next;
      return { ...next, audits: [{ id: newId('audit'), createdAt: Date.now(), actorId: session.id, action, detail: detail || action }, ...next.audits].slice(0, 200), syncQueue: cloudConnected ? next.syncQueue : next.syncQueue + 1 };
    });
  };
  useEffect(() => {
    let cancelled = false;
    // Read-only. The catalogue migrations below write, and writing needs a
    // permission - which needs somebody signed in, which has not happened yet
    // when this runs. Splitting the two is what lets the core refuse a stock
    // or catalogue write from a session that was never allowed to make one.
    const boot = async () => {
      if (!marketCoreClient.available()) return;
      try {
        for (let i = 0; i < 40; i += 1) {
          const status = await marketCoreClient.status();
          if (status.state === 'ready') break;
          await new Promise((r) => setTimeout(r, 250));
        }
        const status = await marketCoreClient.status();
        if (status.state !== 'ready') throw new Error(`core state: ${status.state}`);
        const snapshot = await marketCoreClient.getState();
        if (cancelled) return;
        // Native storage is authoritative. Never add demo SKUs or replace the
        // merchant's prices/stock when a populated register starts.
        setState({ ...snapshot, schemaVersion: 5 });
        setCoreReady(true);
        setCoreError(null);
      } catch (err) {
        if (!cancelled) setCoreError(err instanceof Error ? err.message : String(err));
      }
    };
    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Import browser-era data only into an empty database, after staff login.
    // Old catalogue flags must never reseed a populated shop or restore stock.
    if (!coreReady || !session) return;
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) === '1' &&
        localStorage.getItem(CATALOG_SYNC_KEY) === CATALOG_SYNC_TOKEN) return;
    let cancelled = false;
    const migrate = async () => {
      try {
        // 1.5.33: no browser-era import - an old cache carried the demo catalogue into real accounts.
        const snapshot = await marketCoreClient.getState();
        if (!cancelled) {
          setState({ ...snapshot, schemaVersion: 5 });
          localStorage.setItem(LEGACY_MIGRATED_KEY, '1');
          localStorage.setItem(CATALOG_SYNC_KEY, CATALOG_SYNC_TOKEN);
        }
      } catch {
        // Keep the last native snapshot. A failed import never creates a fake
        // catalogue in memory; the next authorized login can retry.
      }
    };
    void migrate();
    return () => { cancelled = true; };
  }, [coreReady, session, legacyState]);

  useEffect(() => {
    // Electron's native database is authoritative; do not manufacture a browser
    // snapshot while the core is loading. legacyState retains an actual old cache.
    if (marketCoreClient.available()) {
      if (coreReady) localStorage.removeItem(STORE_KEY);
      return;
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }, [state, coreReady]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => { setOnline(false); setCloudConnected(false); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.key !== 'F11') return;
      event.preventDefault();
      void window.marketSystem?.display.toggleFullscreen();
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, []);
  useEffect(() => { void (window.marketSystem?.staff.list() ?? Promise.resolve([])).then(setStaff).catch(() => setStaff([])); }, []);
  useEffect(() => {
    if (!session || !window.marketSystem) return;
    let active = true;
    let pushing = false;
    const push = async () => {
      if (pushing) return;
      pushing = true;
      const {state,staff,branch}=syncInputs.current;
      try {
      const sentAck = readCommandIds(ACK_PENDING_KEY).slice(-40);
      const sentFail = readCommandIds(FAIL_PENDING_KEY).slice(-40);
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const sales = state.sales.filter((sale) => !sale.refunded && sale.createdAt >= dayStart.getTime());
      const dailySalesMinor = sales.reduce((sum, sale) => sum + sale.totalMinor, 0);
      const cashMinor = sales.reduce((sum, sale) => sum + (sale.payment.method === 'card' ? 0 : sale.payment.cashMinor ?? sale.payment.amountMinor), 0);
      const cardMinor = sales.reduce((sum, sale) => sum + (sale.payment.method === 'cash' ? 0 : sale.payment.cardMinor ?? sale.payment.amountMinor), 0);
      const lowStock = state.products.filter((product) => product.active && stockOf(product) <= product.minStock);
      const cashMovements = coreReady && marketCoreClient.available()
        ? await marketCoreClient.cash.movements().catch(() => undefined) : undefined;
      const finance = coreReady && marketCoreClient.available()
        ? await marketCoreClient.portal.finance().catch(() => undefined) : undefined;
      const response = await window.marketSystem?.sync.push(session.sessionToken, {
        storeName: state.settings.storeName,
        terminalName: state.settings.terminalName,
        branchName: branch?.branchName || state.settings.branchName || "",
        dailySalesMinor,
        transactionCount: sales.length,
        cashMinor,
        cardMinor,
        openRegisters: state.registers.filter((row) => row.status === 'open').length,
        criticalStock: lowStock.length,
        queue: state.syncQueue,
        registers: state.registers.map((register) => ({
          id: register.id,
          name: register.name,
          status: register.status,
          operatorName: staff.find((row) => row.id === register.operatorId)?.name ?? null,
          salesMinor: sales.filter((sale) => sale.registerId === register.id).reduce((sum, sale) => sum + sale.totalMinor, 0),
        })),
        lowStock: lowStock.slice(0, 100).map((product) => ({ id: product.id, name: product.name.az, sku: product.sku, barcode: product.barcode, stock: stockOf(product), minStock: product.minStock })),
        warehouses: state.warehouses.map((warehouse) => ({ id: warehouse.id, name: warehouse.name, active: warehouse.active, totalStock: state.products.reduce((sum, product) => sum + Math.max(0, product.warehouseStock[warehouse.id] ?? 0), 0) })),
        updatedAt: Date.now(),
        lines: stockLines(state),
        ...(sentAck.length ? { appliedCommandIds: sentAck } : {}),
        ...(sentFail.length ? { failedCommandIds: sentFail } : {}),
        ...(sentFail.length ? { failedCommandReasons: failedCommandReasons().filter((row) => sentFail.includes(row.id)) } : {}),
      }, marketBooks(state, cashMovements, finance));
      if (!active || !response) return;
      if (response.connected) {
        clearPending(ACK_PENDING_KEY, sentAck);
        clearPending(FAIL_PENDING_KEY, sentFail);
      }
      setCloudConnected(response.connected);
      // Only a real answer changes what is allowed. An offline or failed push
      // carries no list, and reading that as "no restriction" opened every
      // screen the head admin had closed the moment the network dropped.
      if (response.connected) {
        setInventoryOn(response.inventory !== false);
        const access = narrowByStation(Array.isArray(response.access) ? response.access : null, response.device?.station);
        setMarketAccess(access);
        try { localStorage.setItem('market.access', JSON.stringify(access)); } catch { /* private storage */ }
      }
      if (response.connected) setState((previous) => previous.syncQueue === 0 ? previous : ({ ...previous, syncQueue: 0 }));
      const canApplyPortal = session.role === 'manager' || session.role === 'warehouse' || session.role === 'head_cashier';
      if (response.connected && canApplyPortal) {
        let changed = false;
        for (const cmd of response.commands ?? []) {
          if (!cmd?.id || readCommandIds(ACK_KEY).includes(cmd.id) || readCommandIds(FAIL_KEY).includes(cmd.id)) continue;
          try {
            const result = await applyMarketCommand(cmd, session, coreReady, state);
            if (result === 'local') {
              const body = cmd.body ?? {};
              const str = (key: string) => (typeof body[key] === 'string' ? body[key] : '');
              const num = (key: string) => Math.trunc(Number(body[key]) || 0);
              setState((previous) => {
                if (cmd.kind === 'warehouse.create') {
                  const warehouse = { id: str('id') || newId('wh'), code: 'WH', name: str('name'), address: '', manager: '', active: true };
                  return { ...previous, warehouses: [...previous.warehouses, warehouse] };
                }
                if (cmd.kind === 'warehouse.rename') return { ...previous, warehouses: previous.warehouses.map((row) => row.id === str('id') ? { ...row, name: str('name') || row.name } : row) };
                if (cmd.kind === 'warehouse.close') return { ...previous, warehouses: previous.warehouses.map((row) => row.id === str('id') ? { ...row, active: false } : row) };
                const touch = (qtyFor: (current: number) => number) => ({
                  ...previous,
                  products: previous.products.map((product) => product.id !== str('productId') ? product : {
                    ...product,
                    warehouseStock: { ...product.warehouseStock, [str('warehouseId')]: qtyFor(product.warehouseStock[str('warehouseId')] ?? 0) },
                  }),
                });
                if (cmd.kind === 'stock.receive' || cmd.kind === 'stock.adjust') return touch((current) => current + num('qty'));
                if (cmd.kind === 'stock.count') return touch(() => num('qty'));
                if (cmd.kind === 'stock.waste') return touch((current) => current - Math.abs(num('qty')));
                if (cmd.kind === 'stock.transfer') {
                  return { ...previous, products: previous.products.map((product) => product.id !== str('productId') ? product : { ...product, warehouseStock: { ...product.warehouseStock, [str('fromWarehouseId')]: (product.warehouseStock[str('fromWarehouseId')] ?? 0) - Math.abs(num('qty')), [str('toWarehouseId')]: (product.warehouseStock[str('toWarehouseId')] ?? 0) + Math.abs(num('qty')) } }) };
                }
                if (cmd.kind === 'product.save') {
                  const existing = previous.products.find((row) => row.barcode && str('barcode') && row.barcode === str('barcode'));
                  const created = productFromCard(body, existing);
                  if (!existing) return { ...previous, products: [created, ...previous.products] };
                  return { ...previous, products: previous.products.map((row) => row.id === existing.id ? created : row) };
                }
                return previous;
              });
            } else if (result === 'ok') changed = true;
            else continue;
            rememberCommandId(ACK_KEY, cmd.id);
            rememberCommandId(ACK_PENDING_KEY, cmd.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!/icazə|permission|forbidden/i.test(message)) rememberFailure(cmd.id, message);
          }
        }
        if (changed && coreReady) await refreshFromCore();
      }
      } finally { pushing = false; }
    };
    void push();
    const timer = window.setInterval(() => void push(), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session, coreReady]);

  const login = async (pin: string) => {
    try {
      let user: SessionUser;
      if (window.marketSystem) {
        // The PIN alone names the person, as on the restaurant till.
        user = await window.marketSystem.auth.login('', pin);
      } else {
        // Browser preview (npm run market:dev) has no staff store; it is never a
        // shipped till, so a production web build refuses sign-in outright.
        const profile: StaffProfile = {id:'browser-manager',name:'Müdir',role:'manager',active:true,registerIds:[],warehouseIds:[]};
        if (!import.meta.env.DEV || !profile || !/^\d{4,8}$/.test(pin)) throw new Error(t('invalidPin'));
        user = { ...profile, sessionToken: `browser-${profile.id}` };
      }
      setObjectSession(null);
      setSession(user);
      const first = ROLE_VIEWS[user.role][0] ?? 'dashboard';
      setView(first);
      setNotice(`${user.name} · ${roleLabel(user.role, lang)}`);
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      throw new Error(/yanlış|invalid|wrong|pin/i.test(raw) || !raw ? t('invalidPin') : raw.includes('remote method') ? t('invalidPin') : raw);
    }
  };

  const logout = async () => {
    if (session && window.marketSystem) await window.marketSystem.auth.logout(session.sessionToken).catch(() => false);
    setSession(null); setObjectSession(null); setCart([]); setView('dashboard');
  };

  useEffect(() => {
    if (!session || !window.marketSystem?.activation?.refresh) return;
    let alive = true;
    const refreshLicense = async () => {
      try {
        const status = await window.marketSystem!.activation.refresh();
        if (!alive) return;
        if ((status as ActivationStatus & { inventory?: boolean }).inventory === false) setInventoryOn(false);
        if (status.mode === 'expired' || status.mode === 'revoked') {
          if (session) await window.marketSystem!.auth.logout(session.sessionToken).catch(() => false);
          setSession(null);
          setCart([]);
          setView('dashboard');
          setNotice(tr(lang, 'licenseBlocked'));
        }
      } catch { /* offline: keep session */ }
    };
    void refreshLicense();
    const timer = window.setInterval(() => void refreshLicense(), 5 * 60 * 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [session?.sessionToken, lang]);

  useEffect(() => {
    if (!session) return;
    if (!inventoryOn && STOCK_VIEWS.has(view)) {
      setView('dashboard');
      return;
    }
    if (marketAccess && !marketAccess.includes(view)) {
      const next = ROLE_VIEWS[session.role].find((id) => marketAccess.includes(id) && (inventoryOn || !STOCK_VIEWS.has(id)));
      if (next) setView(next);
    }
  }, [inventoryOn, view, marketAccess, session]);

  if (!session) return <AuthGate lang={lang} setLang={setLang} staff={staff} onLogin={login} />;
  if (session.mustChangePin && window.marketSystem) {
    return (
      <ChangePinScreen
        lang={lang}
        session={session}
        onChanged={(profile) => {
          setSession({ ...session, ...profile, mustChangePin: false });
          setStaff((rows) => rows.map((row) => (row.id === profile.id ? { ...row, ...profile } : row)));
        }}
        onLogout={() => void logout()}
      />
    );
  }

  const needsRegister = coreReady && marketCoreClient.available() && !state.settings.deviceRegisterId &&
    (session.role === 'cashier' || session.role === 'head_cashier' || session.role === 'manager');
  if (needsRegister) {
    return (
      <div className="modal-backdrop register-setup-backdrop" role="presentation">
        <form className="modal register-setup-modal" onSubmit={(event) => { event.preventDefault(); void bindThisRegister(); }}>
          <header className="modal-head">
            <div>
              <p className="brand-kicker">{t('registers')}</p>
              <h2>{t('registerSetupTitle')}</h2>
              <p>{t('registerSetupHint')}</p>
            </div>
            <Store aria-hidden="true" />
          </header>
          <div className="modal-body">
            <label className="field">
              <span>{t('registerName')}</span>
              <input autoFocus maxLength={80} value={registerName} onChange={(event) => setRegisterName(event.target.value)} disabled={registerBusy} />
            </label>
            {registerError && <p className="form-error">{registerError}</p>}
          </div>
          <div className="modal-actions">
            <button className="modal-primary" type="submit" disabled={registerBusy || !registerName.trim()}>
              <Check />{registerBusy ? '…' : t('registerSetupContinue')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // One confirmation for each authenticated staff session, including restored sessions.
  // Managers switch objects from Əməliyyatlar; staff confirm theirs here, and POSSISTEM's
  // user places a new PC in its object (asked once: a placed PC goes straight on).
  if(window.marketSystem && (session.role !== 'manager' || session.superAdmin) && objectSession !== session.sessionToken)return <ObjectLoginGate lang={lang} onDone={()=>{setObjectSession(session.sessionToken);void refreshFromCore().catch(()=>{});}} onLogout={()=>void logout()}/>;

  // POSSISTEM's own user (10-digit PIN) may do everything, objects included.
  const superAdmin = Boolean(session.superAdmin) || Boolean(rights?.includes('SUPER_ADMIN'));
  const has = (keys: string[]) => superAdmin || (rights == null ? session.role === 'manager' : keys.some((key) => rights.includes(key)));
  // A screen whose rights POSSISTEM did not give this user (role or worker) is not shown.
  const rightOk = (id: View) => !VIEW_RIGHTS[id] || has(VIEW_RIGHTS[id]!);
  const viewAllowed = (id: View): boolean => id === 'management' ? (['branches', 'returns', 'reports', 'ops'] as View[]).some((v) => v !== 'management' && allowedViews.includes(v)) : id === 'branches' ? session.role === 'manager' || superAdmin : rightOk(id) && (inventoryOn || !STOCK_VIEWS.has(id)) && (marketAccess == null || marketAccess.includes(id)
    || (id === 'ops' && ['inventory', 'warehouses', 'purchases', 'stocktake'].some((area) => marketAccess.includes(area))));
  const userAdmin = has(['MANAGE_USERS']);
  // A right from POSSISTEM opens its screen for a role that would not see it.
  const extraViews: View[] = (Object.keys(VIEW_RIGHTS) as View[]).filter((id) => !ROLE_VIEWS[session.role].includes(id) && rights != null && has(VIEW_RIGHTS[id]!));
  const allowedViews: View[] = [...ROLE_VIEWS[session.role], ...extraViews].filter((id) => id === 'management' || viewAllowed(id));
  if (allowedViews.includes('management') && !viewAllowed('management')) allowedViews.splice(allowedViews.indexOf('management'), 1);
  // Another object's Əməliyyatlar over the internet, chosen at the right of its tab row.
  const objectSwitch = (session.role === 'manager' || superAdmin) && (places && places.objects.length > 1 ? (() => {
                const ownId = places.tills.find((d) => d.local)?.branchId ?? '';
                const ownName = (branch?.registerId === state.settings.defaultRegisterId && branch.branchName) || places.objects.find((o) => o.id === ownId)?.name || state.settings.branchName || '—';
                const reachable = (id: string) => places.tills.find((d) => d.branchId === id && !d.local && d.online && d.supported);
                // Online branch: its screens live. Offline branch: its last copy. All: every branch summed.
                const value = remote?.objectId ?? (stockView?.kind === 'all' ? '__all' : stockView?.kind === 'branch' ? stockView.branchId : 'local');
                return <select aria-label="Filial" value={value} onChange={(event) => {
                  const id = event.target.value, till = reachable(id), name = places.objects.find((o) => o.id === id)?.name ?? id;
                  setRemote(null); setStockView(null);
                  if (id === '__all') setStockView({ kind: 'all' });
                  else if (id !== 'local' && till) setRemote({ objectId: id, deviceId: till.deviceId, name, product: till.product === 'restaurant' ? 'restaurant' : 'market' });
                  else if (id !== 'local') setStockView({ kind: 'branch', branchId: id, name });
                  if (id !== 'local') safeSetView('ops');
                }}>
                  <option value="local">{ownName}</option>
                  <option value="__all">{lang === 'ru' ? 'Все филиалы' : lang === 'en' ? 'All branches' : 'Bütün filiallar'}</option>
                  {places.objects.filter((o) => o.id !== ownId).map((o) => <option key={o.id} value={o.id}>{o.name}{reachable(o.id) ? '' : lang === 'ru' ? ' · офлайн' : lang === 'en' ? ' · offline' : ' · oflayn'}</option>)}
                </select>;
              })() : null);
  const ownObjectName = (branch?.registerId === state.settings.defaultRegisterId && branch.branchName) || state.settings.branchName || (lang === 'ru' ? 'Не указан' : lang === 'en' ? 'Not assigned' : 'Təyin edilməyib');
  // POSSISTEM's user renames or removes this PC's filial from Parametrlər.
  const ownBranch = places?.tills.find((d) => d.local)?.branchId ?? '';
  const branchAdmin = superAdmin && ownBranch && places ? <BranchAdmin key={ownBranch} lang={lang} token={session.sessionToken} branchId={ownBranch} name={places.objects.find((o) => o.id === ownBranch)?.name ?? ownObjectName} onChanged={() => setPlacesTick((n) => n + 1)} /> : null;
  // What the top bar used to carry: shown on Parametrlər → Mağaza instead.
  const deviceInfo: Array<[string, string]> = [
    [lang === 'ru' ? 'Связь' : lang === 'en' ? 'Connection' : 'Əlaqə', `${online ? (cloudConnected ? t('online') : t('offline')) : t('offline')}${state.syncQueue ? ` · ${state.syncQueue} ${t('pending')}` : ''}${syncStatus?.peerCount ? ` · ${syncStatus.peerCount} kassa (LAN)` : ''}`],
    [lang === 'ru' ? 'Филиал' : lang === 'en' ? 'Branch' : 'Filial', ownObjectName],
    [lang === 'ru' ? 'Терминал' : lang === 'en' ? 'Terminal' : 'Terminal', `${state.settings.terminalName}${state.registers.find((row) => row.id === state.settings.defaultRegisterId) ? ` · ${state.registers.find((row) => row.id === state.settings.defaultRegisterId)!.name}` : ''}`],
  ];
  const safeSetView = (next: View) => {
    const request = ++navigationRequest.current;
    if (!(canAccess(session.role, next) || extraViews.includes(next)) || !viewAllowed(next)) { deny(); return; }
    // The selling screen opens at once. Coming from Əməliyyatlar the warehouse's
    // latest quantities are pulled in behind it (the core announces the change
    // and the screen refreshes) - waiting for that here is what made Satış open
    // late, or not at all when the sync failed.
    setView(next);
    if (next !== 'sale' || view === 'sale' || !coreReady) return;
    void (async () => {
      try {
        if ((view === 'ops' || view === 'settings') && window.marketOps) {
          const status = await window.marketOps.status();
          if (status.host && (status.catalogPending || status.catalogError)) {
            const res = await window.marketOps.sync(session.sessionToken);
            if (!res.success) throw new Error('sync');
          }
        }
        const fresh = await marketCoreClient.getState();
        if (request === navigationRequest.current) setState(fresh);
      } catch { if (request === navigationRequest.current) setNotice(tr(lang, 'inventorySyncFailed')); }
    })();
  };
  const allNav: Array<{ id: View; icon: typeof Store }> = [
    { id: 'dashboard', icon: Activity }, { id: 'sale', icon: ShoppingBasket }, { id: 'ops', icon: Boxes },
    { id: 'returns', icon: RotateCcw }, { id: 'management', icon: Boxes }, { id: 'reports', icon: BarChart3 }, { id: 'registers', icon: Store },
    { id: 'customers', icon: Users }, { id: 'platform', icon: Cloud },
    { id: 'staff', icon: Users }, { id: 'mobile', icon: Smartphone }, { id: 'settings', icon: Settings },
  ];
  // Every screen stays in the sidebar; the locked ones are dimmed and refuse.
  const nav = allNav.filter(item => item.id !== 'registers' && item.id !== 'staff');

  const refundSale = async (sale: Sale) => {
    if (coreReady && marketCoreClient.available()) {
      const returned = await marketCoreClient.returns.create(sale.id, session.id);
      // A committed return must stay committed even if the following read fails.
      setState(previous => ({...previous, sales: previous.sales.map(row => row.id === returned.id ? returned : row)}));
      try { await refreshFromCore(); }
      catch { setNotice(lang === 'ru' ? 'Возврат сохранён; обновите данные.' : lang === 'en' ? 'Return saved; refresh the data.' : 'Qaytarma saxlanıldı; məlumatları yeniləyin.'); return; }
    } else {
      mutate(previous => ({ ...previous,
        sales: previous.sales.map(row => row.id === sale.id ? {...row,refunded:true} : row),
        products: previous.products.map(product => {
          const sold = sale.items.filter(line => line.productId === product.id).reduce((sum,line) => sum + line.qty,0);
          const returned = (sale.refunds ?? []).flatMap(ref => ref.lines).filter(line => line.productId === product.id).reduce((sum,line) => sum + line.qty,0);
          const qty = Math.max(0,sold-returned);
          return qty ? {...product,stock:stockOf(product)+qty,warehouseStock:{...product.warehouseStock,[previous.settings.defaultWarehouseId]:(product.warehouseStock[previous.settings.defaultWarehouseId] ?? 0)+qty}} : product;
        })
      }), 'SALE_REFUND', sale.receiptNo);
    }
    setNotice(lang === 'ru' ? 'Возврат сохранён' : lang === 'en' ? 'Return saved' : 'Geri qaytarma saxlanıldı');
  };

  const toggleRegister = async (register: Register) => {
      try {
        if (coreReady && marketCoreClient.available()) {
          if (register.status === 'closed') await marketCoreClient.cash.open(register.id, session.id, register.openingFloatMinor || 0);
          else await marketCoreClient.cash.close(register.id, session.id);
          await refreshFromCore();
        } else {
          mutate((previous) => ({ ...previous, registers: previous.registers.map((row) => row.id === register.id ? { ...row, status: row.status === 'open' ? 'closed' : 'open', openedAt: row.status === 'closed' ? Date.now() : undefined, operatorId: row.status === 'closed' ? session.id : undefined } : row) }), 'REGISTER_TOGGLE', register.code);
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
  };

  return (
    <div className="market-shell">
      <aside className="rail">
        <button className="brand-mark" onClick={() => safeSetView('dashboard')} aria-label="MarketPos ana səhifə"><span className="ps-brand-mark"><img src="./assets/brand-mark.png" alt="" /></span><span>MarketPos</span></button>
        <nav>{nav.filter(({ id }) => allowedViews.includes(id) || id === 'returns' && allowedViews.includes('sale')).map(({ id, icon: Icon }) => <button key={id} data-view={id} className={view === id || (id === 'management' && view === 'branches') ? 'active' : ''} onClick={() => safeSetView(id)} title={viewLabel(id, lang)}><Icon /><span>{viewLabel(id, lang)}</span></button>)}</nav>
        <button className="rail-user" type="button" onClick={() => void logout()} title={t('logout')} aria-label={t('logout')}>
          <RoleAvatar role={session.role} name={session.name} compact />
          <span><b>{session.name}</b><small>{t('logout')}</small></span>
          <LogOut />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="store-title">{state.settings.logoUrl ? <img src={state.settings.logoUrl} alt="" /> : <span className="ps-brand-mark store-mini"><img src="./assets/brand-mark.png" alt="" /></span>}<div><p>MARKETPOS · RETAIL OS</p><h1>{viewLabel(view, lang)}</h1></div></div>
          <div className="top-actions">
            <SupportButton lang={lang} variant="top" />
            <FiscalBadge coreReady={coreReady} />
            <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label="Language"><option value="az">AZ</option><option value="ru">RU</option><option value="en">EN</option></select>
            <button className="icon-button" onClick={() => void window.marketSystem?.display.toggleFullscreen()} title="F11"><Expand /></button>
          </div>
        </header>

        <main className={`page-area${view==='branches'||view==='ops'&&remote?' branch-page-area':''}`}>
          <LockedArea locked={!viewAllowed(view)} onDenied={deny}>
          {view === 'dashboard' && <Dashboard state={state} staff={staff} session={session} lang={lang} onView={safeSetView} />}
          {view === 'sale' && <SalePage canDiscount={has(['SALE_DISCOUNT'])} state={state} setState={setState} session={session} lang={lang} cart={cart} setCart={setCart} cloudConnected={cloudConnected} notify={setNotice} coreReady={coreReady} onRefresh={refreshFromCore} audit={mutate} />}
          {view === 'management' && <ManagementPage lang={lang} views={allowedViews} onView={safeSetView}/> }
          {view === 'branches' && (session.role === 'manager' || superAdmin) && <iframe className="ops-frame branch-hub-frame" title={t('branches')} src={`./cloud-branches/hub.html?lang=${lang}${superAdmin ? '' : '&locked=1'}`}/> }
          {['ops','registers','staff'].includes(view) && <OperationsWorkspace key={view + (remote?.deviceId ?? '') + (stockView ? JSON.stringify(stockView) : '')} remote={view === 'ops' ? remote : null} stockView={view === 'ops' ? stockView : null} can={has} objectSwitch={view === 'ops' ? objectSwitch : null} session={session} lang={lang} notify={setNotice} initial={view === 'registers' ? 'registers' : view === 'staff' ? 'users' : 'warehouse'} canUsers={userAdmin || superAdmin} registers={<RegistersOpsPage state={state} staff={staff} session={session} lang={lang} coreReady={coreReady} onAdd={() => setRegisterModal(true)} onToggle={toggleRegister} onRefresh={refreshFromCore} notify={setNotice}/>} users={<><UsersPage session={session} canManage={userAdmin} staff={staff} lang={lang} onChanged={setStaff} notify={setNotice}/>{session.role === 'manager' && <RolePermissionsPanel actorRole={session.role} superAdmin={superAdmin} sessionToken={session.sessionToken} lang={lang}/>}</>} />}
          {view === 'returns' && <ReturnsPage state={state} staff={staff} lang={lang} coreReady={coreReady} onRefund={refundSale} />}
          {view === 'reports' && <ReportsOpsPage state={state} staff={staff} lang={lang} coreReady={coreReady} />}
          {view === 'customers' && <CustomersPage session={session} lang={lang} coreReady={coreReady} notify={setNotice} />}
          {view === 'platform' && <PlatformStubsPage coreReady={coreReady} notify={setNotice} />}
          {view === 'mobile' && <MobilePage state={state} staff={staff} lang={lang} cloudConnected={cloudConnected} />}
          {view === 'settings' && <SettingsPage deviceInfo={deviceInfo} extra={branchAdmin} onBarcodeProduct={(product) => setState(previous => ({ ...previous, products: previous.products.map(p => p.id === product.id ? product : p) }))} state={state} session={session} lang={lang} coreReady={coreReady} notify={setNotice} onSettings={async (settings) => {
                if (coreReady && marketCoreClient.available()) {
                  await marketCoreClient.settings.set(settings, session.id);
                  await refreshFromCore();
                } else mutate((previous) => ({ ...previous, settings }), 'SETTINGS_SAVE', settings.storeName);
          }} />}
          </LockedArea>
        </main>
      </section>

      {registerModal && <RegisterModal lang={lang} onClose={() => setRegisterModal(false)} onSave={(register) => {
        void (async () => {
          try {
            if (coreReady && marketCoreClient.available()) {
              await marketCoreClient.cash.createRegister(register);
              await refreshFromCore();
            } else mutate((previous) => ({ ...previous, registers: [...previous.registers, register] }), 'REGISTER_CREATE', register.name);
            setRegisterModal(false); setNotice(t('registerSaved'));
          } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); }
        })();
      }} />}
      {notice && <div className="toast" role="status">{notice === DENIED ? <TriangleAlert /> : <Check />}{notice}</div>}
      {coreError && <div className="toast"><TriangleAlert />Core: {coreError}</div>}
    </div>
  );
}

function shortHwid(deviceId?: string) {
  if (!deviceId) return '…';
  if (deviceId.length <= 16) return deviceId;
  return `${deviceId.slice(0, 8)}…${deviceId.slice(-4)}`;
}

function licenseModeLabel(lang: Lang, mode: ActivationStatus['mode'] | undefined) {
  if (mode === 'active') return tr(lang, 'active');
  if (mode === 'expired') return tr(lang, 'expired');
  if (mode === 'revoked') return tr(lang, 'revoked');
  if (mode === 'unlicensed') return tr(lang, 'unlicensed');
  return tr(lang, 'trial');
}

function licenseAllowsPin(activation: ActivationStatus | null) {
  return !!activation && activation.mode === 'active' && activation.validUntil > Date.now();
}

function AuthGate({ lang, setLang, onLogin }: { lang: Lang; setLang: (lang: Lang) => void; staff: StaffProfile[]; onLogin: (pin: string) => Promise<void> }) {
  const [tenant, setTenant] = useState<TenantStatus | null>(null);
  const [activation, setActivation] = useState<ActivationStatus | null>(null);
  const [ready, setReady] = useState(!window.marketSystem);

  useEffect(() => {
    if (!window.marketSystem) return;
    let cancelled = false;
    const boot = async () => {
      try {
        // Status first: it resets a PC still holding another account's activation.
        const tenantStatus = await window.marketSystem!.tenant.status();
        const license = await window.marketSystem!.activation.refresh().catch(() => window.marketSystem!.activation.status());
        if (cancelled) return;
        setTenant(tenantStatus);
        setActivation(license);
      } finally {
        if (!cancelled) setReady(true);
      }
    };
    void boot();
    const timer = window.setInterval(() => {
      void window.marketSystem?.activation.refresh().then(setActivation).catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  if (!window.marketSystem) {
    return <LoginScreen lang={lang} onLogin={onLogin} />;
  }
  if (!ready) {
    return (
      <main className="ps-login-screen" style={{ backgroundImage: 'url(./assets/login-bg.png)' }}>
        <div className="ps-login-veil" aria-hidden />
        <div className="ps-login-glass ps-auth-loading"><ShieldCheck /><p>{tr(lang, 'loginSecure')}</p></div>
      </main>
    );
  }
  if (!tenant?.authenticated) {
    return (
      <TenantLoginScreen
        lang={lang}
        setLang={setLang}
        onSuccess={(next) => setTenant(next)}
      />
    );
  }
  if (!licenseAllowsPin(activation)) {
    return (
      <ActivationGateScreen
        lang={lang}
        setLang={setLang}
        tenant={tenant}
        activation={activation}
        onActivated={(next) => { if (activation?.customerId && next.customerId && next.customerId !== activation.customerId) location.reload(); else setActivation(next); }}
        onTenantLogout={() => {
          void window.marketSystem?.tenant.logout().then(() => setTenant({ authenticated: false }));
        }}
      />
    );
  }
  return (
    <LoginScreen
      lang={lang}
      onLogin={onLogin}
      onTenantLogout={() => {
        void window.marketSystem?.tenant.logout().then(() => setTenant({ authenticated: false })).catch(() => undefined);
      }}
    />
  );
}

// Technical support before the owner account is signed in: no account yet, so the chat cannot open — show the phone.
function SupportLine({ lang }: { lang: Lang }) {
  return <p className="mp-support-line"><span>{tr(lang, 'techSupport')}</span><strong>051 333 35 55</strong></p>;
}

function TenantLoginScreen({ lang, onSuccess }: { lang: Lang; setLang: (lang: Lang) => void; onSuccess: (tenant: TenantStatus) => void }) {
  // Same gate as Restaurant POS: the email is always remembered, no extra toggles.
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem('marketpos.tenant.email') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password || busy || !window.marketSystem) return;
    setBusy(true);
    setError('');
    try {
      const status = await window.marketSystem.tenant.login(email.trim(), password);
      try { localStorage.setItem('marketpos.tenant.email', email.trim()); } catch { /* storage blocked */ }
      // Another account on this PC: everything on screen was the previous one's.
      if ((status as { switched?: boolean }).switched) { location.reload(); return; }
      onSuccess(status);
    } catch (reason) {
      setError(tenantLoginError(reason,lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ps-rest-gate">
      <div className="ps-rest-gate-photo" style={{ backgroundImage: 'url(./assets/login-bg.png)' }} aria-hidden="true" />
      <div className="ps-rest-gate-grid">
        <div className="ps-rest-gate-brand">
          <div className="ps-rest-gate-head">
            <div className="ps-brand-lockup ps-brand-lockup--hero"><img src="./assets/brand-mark.png" alt="possistem" className="ps-brand-logo ps-brand-logo--hero" draggable={false} /></div>
            <div>
              <p className="ps-rest-gate-wordmark">possistem</p>
              <p className="ps-rest-gate-sub">{tr(lang, 'gateTagline')}</p>
            </div>
          </div>
          <div className="ps-rest-gate-copy">
            <p className="ps-rest-gate-kicker">{tr(lang, 'gateTagline')}</p>
            <h1 className="ps-rest-gate-title">{tr(lang, 'gateTitle')}</h1>
            <div className="ps-rest-gate-rule" />
            <p className="ps-rest-gate-hint">{tr(lang, 'gateHint')}</p>
          </div>
          <p className="ps-rest-gate-secure">{tr(lang, 'loginSecure')}</p>
        </div>
        <form className="ps-rest-gate-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="ps-rest-gate-mobile">
            <img src="./assets/brand-mark.png" alt="possistem" className="ps-brand-logo ps-brand-logo--compact" draggable={false} />
            <h2>{tr(lang, 'gateTitle')}</h2>
          </div>
          <h2 className="ps-rest-gate-desk-title">{tr(lang, 'gateTitle')}</h2>
          <div className="ps-rest-gate-rule ps-rest-gate-rule--card" />
          <label>
            <span>{tr(lang, 'tenantEmail')}</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="ps-rest-gate-input" required disabled={busy} />
          </label>
          <label>
            <span>{tr(lang, 'tenantPassword')}</span>
            <input type={showPassword?"text":"password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="ps-rest-gate-input" required disabled={busy} />
          </label>
          <button type="button" aria-pressed={showPassword} disabled={busy} onClick={()=>setShowPassword(v=>!v)} style={{minHeight:48,background:'#eff5ff',border:'1px solid #c2d5f0',borderRadius:12,color:'#164b91',fontWeight:700,padding:'10px 14px'}}>{lang==='ru'?(showPassword?'Скрыть пароль':'Показать пароль'):lang==='en'?(showPassword?'Hide password':'Show password'):(showPassword?'Parolu gizlət':'Parolu göstər')}</button>
          {error && <p className="ps-rest-gate-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className="ps-rest-gate-submit">{busy ? '…' : tr(lang, 'gateSignIn')}</button>
          <SupportLine lang={lang} />
        </form>
      </div>
    </div>
  );
}

function ActivationGateScreen({
  lang, tenant, activation, onActivated, onTenantLogout,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  tenant: Extract<TenantStatus, { authenticated: true }>;
  activation: ActivationStatus | null;
  onActivated: (status: ActivationStatus) => void;
  onTenantLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // No key (1.5.34): the owner's account activates this PC by itself, within its
  // PC slots on the website. Retried a few times - a network blip is not a screen.
  const clean = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  const activate = async () => {
    if (!window.marketSystem) return;
    setBusy(true);
    setMessage(lang === 'ru' ? 'Активация через аккаунт…' : lang === 'en' ? 'Activating with the account…' : 'Hesab ilə aktivləşdirilir…');
    let last: unknown = null;
    for (const wait of [0, 2000, 5000]) {
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      try { const status = await window.marketSystem.activation.activate(null, ''); setMessage(''); setBusy(false); onActivated(status); return; }
      catch (reason) { last = reason; }
    }
    setMessage(clean(last));
    setBusy(false);
  };
  const tried = useRef(false);
  useEffect(() => { if (!tried.current) { tried.current = true; void activate(); } }, []);

  // A partner renewing the licence on the website unlocks the till from here.
  const recheck = async () => {
    if (!window.marketSystem || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const status = await window.marketSystem.activation.refresh();
      onActivated(status);
      if (!licenseAllowsPin(status)) setMessage('Lisenziya hələ uzadılmayıb — partnyorunuza və ya POSSISTEM-ə müraciət edin');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  // Same frame as the email gate (and Restaurant POS); only the card's content differs.
  return (
    <div className="ps-rest-gate">
      <div className="ps-rest-gate-photo" style={{ backgroundImage: 'url(./assets/login-bg.png)' }} aria-hidden="true" />
      <div className="ps-rest-gate-grid">
        <div className="ps-rest-gate-brand">
          <div className="ps-rest-gate-head">
            <div className="ps-brand-lockup ps-brand-lockup--hero"><img src="./assets/brand-mark.png" alt="possistem" className="ps-brand-logo ps-brand-logo--hero" draggable={false} /></div>
            <div>
              <p className="ps-rest-gate-wordmark">possistem</p>
              <p className="ps-rest-gate-sub">{tr(lang, 'gateTagline')}</p>
            </div>
          </div>
          <div className="ps-rest-gate-copy">
            <p className="ps-rest-gate-kicker">{tr(lang, 'activation')}</p>
            <h1 className="ps-rest-gate-title">{tr(lang, 'licenseGateTitle')}</h1>
            <div className="ps-rest-gate-rule" />
            <p className="ps-rest-gate-hint">{tr(lang, 'licenseGateHint')}</p>
          </div>
          <p className="ps-rest-gate-secure">{tenant.email}</p>
        </div>
        <form className="ps-rest-gate-card" onSubmit={(event) => { event.preventDefault(); void activate(); }}>
          <div className="ps-rest-gate-mobile">
            <img src="./assets/brand-mark.png" alt="possistem" className="ps-brand-logo ps-brand-logo--compact" draggable={false} />
            <h2>{tr(lang, 'activation')}</h2>
          </div>
          <h2 className="ps-rest-gate-desk-title">{tr(lang, 'activation')}</h2>
          <div className="ps-rest-gate-rule ps-rest-gate-rule--card" />
          <dl className="ps-rest-gate-facts">
            <div><dt>{tr(lang, 'licenseCustomer')}</dt><dd>{activation?.customerName || tenant.customerName}</dd></div>
            <div><dt>{tr(lang, 'licenseDevice')}</dt><dd>{shortHwid(activation?.deviceId)}</dd></div>
            <div><dt>{tr(lang, 'licenseValidUntil')}</dt><dd>{activation?.validUntil ? new Date(activation.validUntil).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ') : '—'}</dd></div>
            <div><dt>{licenseModeLabel(lang, activation?.mode)}</dt><dd>{tr(lang, 'licenseBlocked')}</dd></div>
          </dl>
          {message && <p className="ps-rest-gate-error" role="alert">{message}</p>}
          <button type="submit" disabled={busy} className="ps-rest-gate-submit">{busy ? '…' : lang === 'ru' ? 'Проверить снова' : lang === 'en' ? 'Try again' : 'Yenidən yoxla'}</button>
          <div className="ps-rest-gate-links">
            {activation?.serverDeviceId && <button type="button" disabled={busy} onClick={() => void recheck()}>Serverdən yoxla</button>}
            <button type="button" onClick={onTenantLogout}>{tr(lang, 'tenantSwitchAccount')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Staff sign-in, the same screen as the restaurant till's: the PIN alone names
 * the person (main.cjs findStaffByPin), so there is no list to pick from.
 */
function LoginScreen({ lang, onLogin, onTenantLogout }: {
  lang: Lang;
  onLogin: (pin: string) => Promise<void>;
  onTenantLogout?: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // POSSISTEM's 10-digit PIN: its first 4 digits keep the pad going instead of signing in.
  const [long, setLong] = useState(false);
  const length = long ? 10 : 4;

  const submit = async (nextPin = pin) => {
    if (nextPin.length < 4 || busy) return;
    setBusy(true);
    setError('');
    try {
      await onLogin(nextPin);
    } catch (reason) {
      const raw = reason instanceof Error ? reason.message : '';
      setError(/yanlış|invalid|wrong|pin|remote method/i.test(raw) || !raw ? tr(lang, 'invalidPin') : raw);
      setPin('');
      setLong(false);
    } finally {
      setBusy(false);
    }
  };

  const pressKey = (key: string) => {
    if (busy) return;
    if (key === 'clear') { setPin(''); setLong(false); setError(''); return; }
    if (key === 'back') { if (pin.length <= 4) setLong(false); setPin(pin.slice(0, -1)); return; }
    setError('');
    if (pin.length >= length) return;
    const next = pin + key;
    setPin(next);
    if (long && next.length === 10) void submit(next);
    else if (!long && next.length === 4) {
      setBusy(true);
      void Promise.resolve(window.marketSystem?.auth.adminPrefix?.(next)).catch(() => false).then((admin) => {
        setBusy(false);
        if (admin) setLong(true); else void submit(next);
      });
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) pressKey(event.key);
      else if (event.key === 'Backspace') pressKey('back');
      else if (event.key === 'Escape') pressKey('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="mp-staff">
      <div className="mp-staff-photo" style={{ backgroundImage: 'url(./assets/login-bg.png)' }} aria-hidden="true" />
      <div className="mp-staff-grid">
        <section className="mp-staff-brand">
          <div className="mp-staff-brand-mark">
            <span className="mp-staff-tile" aria-hidden="true"><img src="./assets/brand-mark.png" alt="" draggable={false} /></span>
            <p className="mp-staff-product">Market POS</p>
          </div>
          <div className="mp-staff-welcome">
            <p className="mp-staff-kicker">{tr(lang, 'staffSignIn')}</p>
            <h1>{tr(lang, 'loginWelcome')}</h1>
            <div className="mp-staff-rule"><span aria-hidden="true" /><span>{tr(lang, 'loginShiftHint')}</span></div>
          </div>
          <div className="mp-staff-secure">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 3.8 26 8v7.2c0 6.2-3.7 10.3-10 13-6.3-2.7-10-6.8-10-13V8l10-4.2Z" stroke="currentColor" strokeWidth="1.25" /><path d="m11.5 16 3 3 6.5-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{tr(lang, 'loginSecure')}</span>
          </div>
        </section>
        <section className="mp-staff-card">
          <div className="mp-staff-card-line" aria-hidden="true" />
          {onTenantLogout ? (
            <button type="button" className="mp-staff-tenant-out" onClick={onTenantLogout} disabled={busy}>
              <LogOut aria-hidden="true" />{tr(lang, 'switchAccount')}
            </button>
          ) : null}
          <div className="mp-staff-pin">
            <h3 className="mp-staff-pin-title">{tr(lang, 'pinTitle')}</h3>
            <p className="mp-staff-pin-hint">{tr(lang, 'pinHint')}</p>
            <div className={`mp-staff-pin-dots${busy ? ' is-busy' : ''}`} aria-label={`${pin.length} / ${length}`}>
              {Array.from({ length }, (_, index) => index).map((index) => (
                <span key={index} className={`mp-staff-pin-cell${index < pin.length ? ' is-on' : ''}`}><span /></span>
              ))}
              <span className="mp-staff-pin-count">{pin.length}/{length}</span>
            </div>
            <div className="mp-staff-pad" aria-label={tr(lang, 'pinPad')}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((key) => {
                const action = key === 'clear' || key === 'back';
                return (
                  <button
                    key={key}
                    type="button"
                    className={action ? 'mp-staff-key mp-staff-key--action' : 'mp-staff-key'}
                    disabled={busy || (action && !pin)}
                    aria-label={key === 'clear' ? tr(lang, 'pinClear') : key === 'back' ? tr(lang, 'pinBack') : key}
                    onClick={() => pressKey(key)}
                  >
                    {key === 'clear' ? (
                      <svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M7 8.2h14M10 8.2l.8-2.6h6.4l.8 2.6M9 11.3l.8 10.4h8.4l.8-10.4" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" /><path d="M12.3 13.2v5.3m3.4-5.3v5.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>
                    ) : key === 'back' ? (
                      <svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M10.3 7.4h12.2a2.7 2.7 0 0 1 2.7 2.7v7.8a2.7 2.7 0 0 1-2.7 2.7H10.3L3.4 14l6.9-6.6Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" /><path d="m14.3 11 6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" /></svg>
                    ) : key}
                  </button>
                );
              })}
            </div>
            <div className="mp-staff-pin-status">
              {error ? (
                <div className="mp-staff-pin-error" role="alert"><span aria-hidden="true">!</span><span>{error}</span></div>
              ) : null}
            </div>
          </div>
          {window.marketSystem?.support ? <SupportButton lang={lang} variant="gate" /> : <SupportLine lang={lang} />}
        </section>
      </div>
    </main>
  );
}

function Dashboard({ state, staff, session, lang, onView }: { state: PersistedState; staff: StaffProfile[]; session: SessionUser; lang: Lang; onView: (view: View) => void }) {
  const activeSales = state.sales.filter((sale) => !sale.refunded);
  const revenue = activeSales.reduce((sum, sale) => sum + sale.totalMinor, 0);
  const critical = state.products.filter((product) => stockOf(product) <= product.minStock);
  const open = state.registers.filter((register) => register.status === 'open');
  const totalStock = state.products.reduce((sum, product) => sum + stockOf(product), 0);
  const roleMessage: Record<Role, string> = { manager: 'Satış, kassa, anbar və işçi vəziyyəti tam nəzarətdədir.', head_cashier: 'Açıq kassaları, qaytarmaları və növbə satışlarını idarə edin.', cashier: 'Kassanızı açın, barkodu oxudun və sürətli satış edin.', warehouse: 'Kritik qalıqları, depoları və alış sifarişlərini idarə edin.' };
  return <div className="module-page dashboard"><section className="welcome-card"><div><p>{longDate(new Date(), lang)}</p><h2>Salam, {session.name.split(' ')[0]}</h2><span>{roleMessage[session.role]}</span></div><div className="live-badge"><Activity /><span>CANLI<small>{state.settings.storeName}</small></span></div></section><section className="kpi-grid"><Kpi icon={CircleDollarSign} label={tr(lang, 'todaySales')} value={money(revenue, lang)} note={`${activeSales.length} ${tr(lang, 'transactions').toLowerCase()}`} tone="green" /><Kpi icon={Store} label={tr(lang, 'openRegisters')} value={`${open.length} / ${state.registers.length}`} note={open.map((row) => row.name).join(' · ')} tone="blue" /><Kpi icon={TriangleAlert} label={tr(lang, 'criticalProducts')} value={String(critical.length)} note={critical.slice(0, 2).map((row) => row.name[lang]).join(' · ')} tone="amber" /><Kpi icon={Boxes} label={tr(lang, 'totalStock')} value={String(totalStock)} note={`${state.warehouses.length} ${tr(lang, 'warehouses').toLowerCase()}`} tone="violet" /></section><section className="dashboard-grid"><article className="panel-card quick-card"><div className="panel-title"><div><p>{tr(lang, 'quickOpsKicker').toLocaleUpperCase(lang)}</p><h3>{tr(lang, 'quickActions')}</h3></div></div><div className="quick-grid">{canAccess(session.role, 'sale') && <button onClick={() => onView('sale')}><span><ShoppingBasket /></span><b>{tr(lang, 'newSale')}</b><small>{tr(lang, 'scanReady')}</small><ChevronRight /></button>}{canAccess(session.role, 'ops') && <button onClick={() => onView('ops')}><span><PackageSearch /></span><b>{tr(lang, 'ops')}</b><small>Mallar · Anbar · Alışlar</small><ChevronRight /></button>}{canAccess(session.role, 'registers') && <button onClick={() => onView('registers')}><span><Store /></span><b>{tr(lang, 'registers')}</b><small>{open.length} {tr(lang, 'active').toLowerCase()}</small><ChevronRight /></button>}</div></article><article className="panel-card"><div className="panel-title"><div><p>{tr(lang, 'auditKicker').toLocaleUpperCase(lang)}</p><h3>{tr(lang, 'audit')}</h3></div><FileClock /></div><div className="activity-list">{state.audits.slice(0, 5).map((entry) => <div key={entry.id}><span><Activity /></span><p><b>{auditActionLabel(entry.action, lang)}</b><small>{auditDetailLabel(entry.detail, lang)} · {staff.find((row) => row.id === entry.actorId)?.name ?? tr(lang, 'systemActor')}</small></p><time>{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></article></section></div>;
}

export function SalePage({ state, setState, session, lang, cart, setCart, cloudConnected, notify, coreReady, onRefresh, audit, canDiscount = true }: { canDiscount?: boolean; state: PersistedState; setState: React.Dispatch<React.SetStateAction<PersistedState>>; session: SessionUser; lang: Lang; cart: CartLine[]; setCart: React.Dispatch<React.SetStateAction<CartLine[]>>; cloudConnected: boolean; notify: (text: string) => void; coreReady: boolean; onRefresh: () => Promise<PersistedState>; audit: (fn: (state: PersistedState) => PersistedState, action?: string, detail?: string) => void }) {
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pendingScans, setPendingScans] = useState(0);
  const pendingScanCount = useRef(0);
  const scanEpoch = useRef(0);
  useEffect(() => () => { scanEpoch.current += 1; }, []);
  const paymentLock = useRef(false);
  const submissionKey = useRef<string | null>(null);
  const committedSale = useRef<Sale | null>(null);

  const [discount, setDiscount] = useState('0');

  const products = useMemo(() => state.products.filter((product) => product.active), [state.products]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const warehouseId = state.settings.defaultWarehouseId;
  const register = state.registers.find((row) => row.id === state.settings.defaultRegisterId);
  const detail = cart.flatMap((line) => {
    const product = productMap.get(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const lineMinor = (line: CartLine & { product: Product }) => line.qtyMilli ? Math.round(line.product.priceMinor * line.qtyMilli / 1000) : line.product.priceMinor * line.qty;
  const subtotal = detail.reduce((sum, line) => sum + lineMinor(line), 0);
  const discountMinor = Math.min(subtotal, parseMoneyInput(discount));
  const total = subtotal - discountMinor;
  const approval=useCartApproval(cart,setCart,discountMinor,coreReady&&marketCoreClient.available(),value=>setDiscount((value/100).toFixed(2)),notify);

  const add = useCallback((product: Product) => {
    const available = stockOf(product);
    setCart((rows) => {
      const inCart = rows.find((line) => line.productId === product.id && !line.qtyMilli)?.qty ?? 0;
      if (available <= inCart) {
        queueMicrotask(() => notify(tr(lang, 'outOfStock')));
        return rows;
      }
      return rows.some((row) => row.productId === product.id && !row.qtyMilli)
        ? rows.map((row) => row.productId === product.id && !row.qtyMilli ? { ...row, qty: row.qty + 1 } : row)
        : [...rows, { productId: product.id, qty: 1 }];
    });
  }, [warehouseId, setCart, notify, lang]);

  const barcodeIndex = useMemo(() => {
    const index = new Map<string, Product>();
    for (const product of products) {
      for (const key of [product.barcode, product.sku]) if (key && !index.has(key)) index.set(key, product);
    }
    return index;
  }, [products]);
  const scanEnabled = useRef(true);
  scanEnabled.current = !paymentOpen && !paying;
  const scan = useCallback((value: string, inputValue?: string) => {
    const burst = value.trim();
    const full = inputValue?.trim() || burst;
    // A manual entry can pause mid-code; a scanner can arrive after a name search.
    // Prefer a complete exact code, then the fresh burst, without confusing the two.
    const code = /^\d{8,14}$/.test(full) ? full : burst;
    if (!code || !scanEnabled.current || paymentLock.current) return;
    const known = barcodeIndex.get(full) || barcodeIndex.get(burst);
    if (known) { add(known); notify(`${known.name[lang]} · ${tr(lang, 'completed')}`); return; }
    const epoch = scanEpoch.current;
    pendingScanCount.current += 1; setPendingScans(pendingScanCount.current);
    void (async () => {
      try {
      try {
        if (coreReady && marketCoreClient.available()) {
          let resolved: Record<string, unknown> | undefined;
          const candidates = [...new Set([code, ...(full !== code && /^[0-9A-Za-z.-]+$/.test(full) ? [full] : [])])];
          for (const candidate of candidates) {
            try { resolved = await marketCoreClient.barcode.resolve(candidate); break; }
            catch (error) { if (candidate === candidates[candidates.length - 1]) throw error; }
          }
          if (!resolved) return;
          // An outstanding lookup must not change a basket after payment opened.
          if (epoch !== scanEpoch.current || !scanEnabled.current || paymentLock.current) return;
          const productId = String(resolved.productId || resolved.id || '');
          const product = productMap.get(productId);
          const qtyMilli = Number(resolved.qtyMilli) || 0;
          if (product && resolved.scale && qtyMilli > 0) {
            setCart((rows) => [...rows, { productId: product.id, qty: 1, qtyMilli }]);
            notify(`${product.name[lang]} · ${(qtyMilli / 1000).toFixed(3)} ${unitLabel(product.unit, lang)}`);
            return;
          }
          if (product) { add(product); notify(`${product.name[lang]} · ${tr(lang, 'completed')}`); return; }
        }
      } catch { /* Exact local fallback remains available offline. */ }
      if (epoch !== scanEpoch.current || !scanEnabled.current || paymentLock.current) return;
      const product = findBarcode(products, code);
      if (product) { add(product); notify(`${product.name[lang]} · ${tr(lang, 'completed')}`); }
      else notify(tr(lang, 'noResults'));
      } finally {
        if (epoch === scanEpoch.current) {
          pendingScanCount.current = Math.max(0, pendingScanCount.current - 1);
          setPendingScans(pendingScanCount.current);
        }
      }
    })();
  }, [barcodeIndex, products, productMap, coreReady, setCart, add, notify, lang]);
  const emptyCart = useCallback(() => {
    scanEpoch.current += 1; pendingScanCount.current = 0; setPendingScans(0); setCart([]);
  }, [setCart]);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  // Storno: a scanned item leaves the basket only with SALE_CANCEL (set by
  // POSSISTEM per role or worker) or a PIN of someone who holds it; the core
  // records each one with who approved it.
  const [voidAsk, setVoidAsk] = useState<{ held?: HeldCart; title: string; line: { productId: string; name: string; qty: number; amountMinor: number }; apply: () => void } | null>(null);
  const guardedVoid = (_title: string, _line: {productId:string;name:string;qty:number;amountMinor:number}, apply:()=>void) => {if(!paymentLock.current)apply();};

  const cartLineFor = (rows: CartLine[]) => {
    const amountMinor = rows.reduce((sum, row) => { const p = productMap.get(row.productId); return sum + (p ? (row.qtyMilli ? Math.round(p.priceMinor * row.qtyMilli / 1000) : p.priceMinor * row.qty) : 0); }, 0);
    const name = rows.length === 1 ? (productMap.get(rows[0]!.productId)?.name[lang] ?? rows[0]!.productId) : `Səbət · ${rows.length} mal`;
    return { productId: rows.length === 1 ? rows[0]!.productId : 'cart', name, qty: rows.reduce((sum, row) => sum + (row.qtyMilli ? row.qtyMilli / 1000 : row.qty), 0) || 1, amountMinor };
  };
  const clearCart = () => {
    if (!cartRef.current.length) return;
    guardedVoid('Səbəti silmək', cartLineFor(cartRef.current), emptyCart);
  };
  const newSale = useCallback(() => {
    if (paymentLock.current) return false;
    if (!cartRef.current.length) { emptyCart(); setDiscount('0'); return true; }
    if (!confirm('Cari səbət təmizlənsin?')) return false;
    guardedVoid('Səbəti silmək', cartLineFor(cartRef.current), () => { emptyCart(); setDiscount('0'); });
    return false;
  }, [emptyCart, productMap, lang]);

  const changeQty = (productId: string, delta: number) => setCart((rows) => rows.map((row) => row.productId === productId && !row.qtyMilli ? { ...row, qty: Math.max(0, Math.min(productMap.has(productId) ? stockOf(productMap.get(productId)!) : row.qty, row.qty + delta)) } : row).filter((row) => row.qty > 0));
  const adjust = (productId: string, delta: number) => {
    if (delta >= 0) { changeQty(productId, delta); return; }
    const product = productMap.get(productId);
    guardedVoid('Malı səbətdən silmək', { productId, name: product?.name[lang] ?? productId, qty: -delta, amountMinor: (product?.priceMinor ?? 0) * -delta }, () => changeQty(productId, delta));
  };
  const hold = () => {
    if (!cart.length || pendingScanCount.current) return;
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          const checked=await approval.flush();if(checked.dirty)throw Error(lang==='ru'?'Подтвердите изменения корзины':lang==='en'?'Approve cart changes first':'Səbət dəyişikliklərini təsdiqləyin');
          await marketCoreClient.sales.hold({
            cartRevision:checked.revision,
            lines: cart,
            label: `Gözləyən #${state.heldCarts.length + 1}`,
            cashierId: session.id,
            registerId: register?.id ?? state.settings.defaultRegisterId,
            discountMinor: discountMinor,
          });
          await onRefresh();
          setCart([]);
        } else {
          const held: HeldCart = { id: newId('held'), label: `Gözləyən #${state.heldCarts.length + 1}`, createdAt: Date.now(), lines: cart };
          setState((previous) => ({ ...previous, heldCarts: [...previous.heldCarts, held] }));
          setCart([]);
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    })();
  };
  const complete = (payment: Payment) => {
    if (paymentLock.current || committedSale.current || !cart.length) return;
    paymentLock.current = true; setPaying(true); setPaymentError(null);
    submissionKey.current ??= newId('payment');
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          if (committedSale.current) return;
          let terminalRef = payment.terminalRef;
          if ((payment.method === 'card' || payment.method === 'mixed') && window.marketSystem?.terminal) {
            const mode = (localStorage.getItem('marketpos.terminalMode') as 'manual' | 'mock_integrated') || 'manual';
            const term = await window.marketSystem.terminal.pay(session.sessionToken, {
              amountMinor: payment.cardMinor ?? payment.amountMinor,
              mode,
              reference: payment.terminalRef || '',
            });
            if (term.status === 'declined') throw new Error('Terminal declined');
            terminalRef = String(term.reference || term.authCode || terminalRef || '');
            await marketCoreClient.terminal.record({
              amountMinor: payment.cardMinor ?? payment.amountMinor,
              reference: terminalRef,
              status: term.status || 'approved',
              provider: mode,
              authCode: term.authCode,
            });
          }
          const checked=await approval.flush();if(checked.dirty)throw Error('Səbət dəyişikliklərini rəhbər PIN-i ilə təsdiqləyin');
          const sale = await marketCoreClient.sales.complete({
            cartRevision:checked.revision,
            idempotencyKey: submissionKey.current,
            cashierId: session.id,
            registerId: register?.id ?? state.settings.defaultRegisterId,
            warehouseId,
            discountMinor,
            items: cart,
            customerId:payment.customerId||"",customerName:payment.customerName||"",
            payment: { ...payment, terminalRef },
            role: session.role,
          });
          committedSale.current = sale;
          // Close and clear before optional integrations/refresh. A refresh
          // failure must never leave a paid cart available for another charge.
          setCart([]); setDiscount('0'); setPaymentOpen(false);
          const warnings: string[] = [];
          try {
            const receipt = await marketCoreClient.sales.receipt(sale.id);
            const printed = await window.marketSystem?.printer?.receipt(session.sessionToken, receipt, 80);
            if (!printed || printed.ok === false) throw new Error('');
          } catch (error) {
            // Say why ("Printer seçilməyib", "Printerə göndərilmədi"), so the cashier knows what to fix.
            const why = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : '';
            warnings.push(why ? `${tr(lang, 'salePrintFailed')} — ${why}` : tr(lang, 'salePrintFailed'));
          }
          try {
            const sunmi=await window.sunmiApi?.call({action:'get'});
            if(!sunmi?.ok||!sunmi.data.config.enabled) await marketCoreClient.fiscal.enqueue({
              saleId: sale.id,
              kind: 'sale',
              idempotencyKey: `sale:${sale.id}`,
              request: { saleId: sale.id, totalMinor: sale.totalMinor, receiptNo: sale.receiptNo },
            });
            await window.marketSystem?.fiscal?.processPending(session.sessionToken);
          } catch { /* fiscal mock optional */ }
          // Extra kitchen printers get their own preparation ticket.
          const missedStations = await printStationTickets(state.settings, state.products, cart, sale.receiptNo, session.sessionToken);
          if (missedStations.length) warnings.push(`${tr(lang, 'checkoutStationFailed')}: ${missedStations.join(', ')}`);
          try { await onRefresh(); } catch { warnings.push(tr(lang, 'saleRefreshFailed')); }
          // A generic success message must never replace the print failure.
          notify([`${tr(lang, 'completed')} · ${sale.receiptNo}`, ...warnings].join(' · '));
          return;
        }
        const createdAt = Date.now();
        const sale: Sale = { id: newId('sale'), receiptNo: `M-${new Date(createdAt).toISOString().slice(2, 10).replace(/-/g, '')}-${String(state.sales.length + 1).padStart(4, '0')}`, createdAt, items: cart, subtotalMinor: subtotal, discountMinor, totalMinor: total, payment, refunded: false, cashierId: session.id, registerId: register?.id ?? 'unknown' };
        committedSale.current = sale;
        audit((previous) => ({ ...previous, sales: [sale, ...previous.sales], products: previous.products.map((product) => { const qty = cart.find((line) => line.productId === product.id)?.qty ?? 0; return qty && product.kind !== 'service' ? { ...product, stock: Math.max(0, stockOf(product) - qty), warehouseStock: { ...product.warehouseStock, [warehouseId]: Math.max(0, (product.warehouseStock[warehouseId] ?? 0) - qty) } } : product; }) }), 'SALE_COMPLETE', `${sale.receiptNo} · ${money(total, lang)}`);
        setCart([]); setDiscount('0'); setPaymentOpen(false); notify(`${tr(lang, 'completed')} · ${sale.receiptNo}`);
      } catch (err) {
        setPaymentError(checkoutErrorMessage(err, products, lang));
        // A refusal is not a sale. Keep the basket and refresh authoritative
        // availability so the cashier can correct it without a duplicate print.
        try { await onRefresh(); } catch { /* Keep the explicit payment error. */ }
      } finally {
        paymentLock.current = false; setPaying(false);
      }
    })();
  };

  const resumeHeld = (held: HeldCart) => {
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          const resumed = await marketCoreClient.sales.resume(held.id) as { lines: CartLine[]; discountMinor?: number };
          setCart(resumed.lines || held.lines);
          if (resumed.discountMinor != null) setDiscount((Number(resumed.discountMinor) / 100).toFixed(2));
          await onRefresh();
        } else {
          setCart(held.lines);
          setState((previous) => ({ ...previous, heldCarts: previous.heldCarts.filter((row) => row.id !== held.id) }));
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const cancelHeld = (held: HeldCart) => {
    setVoidAsk({held,title:lang==='ru'?'Отменить отложенную корзину':lang==='en'?'Cancel held basket':'Gözləyən səbəti ləğv et',line:{productId:held.id,name:held.label,qty:1,amountMinor:0},apply:()=>{}});
  };

  return (
    <div className={`sale-layout ${state.settings.showProductImages === true ? "" : "sale-without-images"}`}>
      <SaleCatalog showImages={state.settings.showProductImages === true} products={products} lang={lang} warehouseId={warehouseId} cloudConnected={cloudConnected} scannerEnabled={!paymentOpen && !paying} onAdd={add} onScan={scan} onNewSale={newSale}/>
      {voidAsk && <ManagerApprovalModal lang={lang} title={`${voidAsk.title} · ${voidAsk.line.name}`} onClose={() => setVoidAsk(null)} onApproved={async (pin) => {
        if(voidAsk.held){
          if(coreReady&&marketCoreClient.available()){await marketCoreClient.sales.cancelHeld(voidAsk.held.id,session.id,session.role,{managerPin:pin});await onRefresh();}
          else setState(previous=>({...previous,heldCarts:previous.heldCarts.filter(row=>row.id!==voidAsk.held!.id)}));
        }else await approval.approve(pin);
        setVoidAsk(null);
      }} />}
      <aside className="cart-pane">
        {approval.dirty && <div className="cart-approval-bar" role="status"><b>{lang==='ru'?'Изменения ожидают подтверждения':lang==='en'?'Cart changes await approval':'Səbət dəyişiklikləri təsdiq gözləyir'}</b><button disabled={approval.busy||paying} onClick={()=>setVoidAsk({title:lang==='ru'?'Подтвердить изменения':lang==='en'?'Approve changes':'Dəyişiklikləri təsdiqlə',line:{productId:'cart',name:'',qty:1,amountMinor:total},apply:()=>{}})}>{lang==='ru'?'Подтвердить изменения':lang==='en'?'Approve changes':'Dəyişiklikləri təsdiqlə'}</button></div>}

        <div className="cart-head">
          <div>
            <p>{tr(lang, 'cart')}</p>
            <strong>#{String(state.sales.length + 1).padStart(4, '0')}</strong>
            <small>{register?.name ?? 'Kassa seçilməyib'}</small>
          </div>
          <button disabled={!approval.ready || paying || !cart.length} onClick={clearCart} aria-label="Səbəti təmizlə"><Trash2 /></button>
        </div>
        {register?.status !== 'open' && (
          <div className="register-warning">
            <LockKeyhole />
            <div><b>{tr(lang, 'registerClosed')}</b><small>{register?.name}</small></div>
          </div>
        )}
        <div className="cart-lines">
          {!detail.length ? (
            <div className="cart-empty"><ShoppingBag /><strong>{tr(lang, 'emptyCart')}</strong><span>GTIN / EAN-13</span></div>
          ) : detail.map((line, lineIndex) => line.qtyMilli ? (
            <div className="cart-line" key={`w-${lineIndex}`}>
              {state.settings.showProductImages === true && <ProductVisual image={line.product.image} compact alt={line.product.name[lang]} accent={line.product.accent} />}
              <div className="line-copy">
                <strong>{line.product.name[lang]}</strong>
                <small>{money(line.product.priceMinor, lang)} / {unitLabel(line.product.unit, lang)}</small>
                <div className="stepper"><b>{(line.qtyMilli / 1000).toFixed(3)} {unitLabel(line.product.unit, lang)}</b></div>
              </div>
              <div className="line-total">
                <b>{money(lineMinor(line), lang)}</b>
                <button onClick={() => guardedVoid('Malı səbətdən silmək', { productId: line.product.id, name: line.product.name[lang], qty: (line.qtyMilli ?? 0) / 1000, amountMinor: lineMinor(line) }, () => setCart((rows) => rows.filter((_, index) => index !== lineIndex)))} aria-label="Məhsulu səbətdən sil"><X /></button>
              </div>
            </div>
          ) : ((({ product, qty }) => (
            <div className="cart-line" key={product.id}>
              {state.settings.showProductImages === true && <ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} />}
              <div className="line-copy">
                <strong>{product.name[lang]}</strong>
                <small>{money(product.priceMinor, lang)} / {unitLabel(product.unit, lang)}</small>
                <div className="stepper">
                  <button onClick={() => adjust(product.id, -1)} aria-label="Miqdarı azalt"><Minus /></button>
                  <b>{qty}</b>
                  <button onClick={() => adjust(product.id, 1)} aria-label="Miqdarı artır"><Plus /></button>
                </div>
              </div>
              <div className="line-total">
                <b>{money(product.priceMinor * qty, lang)}</b>
                <button onClick={() => adjust(product.id, -qty)} aria-label="Məhsulu səbətdən sil"><X /></button>
              </div>
            </div>
          ))(line)))}
        </div>
        {state.heldCarts.length > 0 && (
          <div className="held-strip">
            {state.heldCarts.slice(0, 2).map((held) => (
              <button key={held.id} type="button" onClick={() => resumeHeld(held)}>
                <Pause /><span>{held.label}<small>{held.lines.length} SKU</small></span><ChevronRight />
              </button>
            ))}
            {state.heldCarts[0] && (
              <button type="button" className="hold" onClick={() => cancelHeld(state.heldCarts[0]!)} title="Ləğv et"><X /></button>
            )}
          </div>
        )}
        <div className="discount-row">
          <label>{tr(lang, 'discount')}<span><input value={discount} onChange={(event) => setDiscount(event.target.value)} inputMode="decimal" disabled={!canDiscount} title={canDiscount ? undefined : DENIED} /> ₼</span></label>
        </div>
        <div className="totals">
          <div><span>{tr(lang, 'subtotal')}</span><b>{money(subtotal, lang)}</b></div>
          <div><span>{tr(lang, 'discount')}</span><b>-{money(discountMinor, lang)}</b></div>
          <div><span>{tr(lang, 'tax')} · 18%</span><b>{money(Math.round(total * 18 / 118), lang)}</b></div>
          <div className="grand"><span>{tr(lang, 'total')}</span><strong>{money(total, lang)}</strong></div>
        </div>
        <div className="checkout-actions">
          <button className="hold" disabled={!approval.ready || paying || pendingScans > 0 || !cart.length} onClick={hold}><Pause />{tr(lang, 'hold')}</button>
          <button className="pay" disabled={!approval.ready || paying || pendingScans > 0 || !cart.length || register?.status !== 'open'} onClick={() => { if (paying || pendingScanCount.current) return; submissionKey.current = null; committedSale.current = null; setPaymentError(null); setPaymentOpen(true); }}>
            <WalletCards /><span>{tr(lang, pendingScans > 0 ? 'barcodeResolving' : 'pay')}<small>Nağd · Kart · Qarışıq</small></span><b>{money(total, lang)}</b>
          </button>
        </div>
      </aside>
      {paymentOpen && <PaymentModal busy={paying} error={paymentError} lang={lang} storeName={state.settings.storeName} totalMinor={total} subtotalMinor={subtotal} discountMinor={discountMinor} items={detail.map((line) => ({ name: line.product.name[lang] || line.product.name.az, quantity: `${line.qtyMilli ? line.qtyMilli / 1000 : line.qty} ${unitLabel(line.product.unit, lang)}`, totalMinor: lineMinor(line) }))} onClose={() => { if (!paymentLock.current) setPaymentOpen(false); }} onComplete={complete} />}
    </div>
  );
}


function MobilePage({ state, staff, lang, cloudConnected }: { state: PersistedState; staff: StaffProfile[]; lang: Lang; cloudConnected: boolean }) {
  const sales = state.sales.filter((sale) => !sale.refunded); const revenue = sales.reduce((sum, sale) => sum + sale.totalMinor, 0); const low = state.products.filter((product) => stockOf(product) <= product.minStock);
  return <div className="module-page mobile-module"><section className="page-intro"><div><p>POSSISTEM.AZ / MARKETPOS</p><h2>{tr(lang, 'ownerLive')}</h2><span>{tr(lang, 'remoteNote')}</span></div><div className={`connection ${cloudConnected ? 'online' : ''}`}>{cloudConnected ? <Cloud /> : <CloudOff />}{cloudConnected ? tr(lang, 'connected') : tr(lang, 'offline')}</div></section><section className="mobile-showcase"><div className="phone-frame"><div className="phone-notch" /><header><div><small>{tr(lang, 'kickerOwner').toLocaleUpperCase(lang)}</small><h3>{state.settings.storeName}</h3></div><span className={cloudConnected ? 'online-dot' : ''} /></header><div className="phone-content"><p>Bugün · Canlı baxış</p><article className="phone-revenue"><small>{tr(lang, 'todaySales')}</small><strong>{money(revenue, lang)}</strong><span>{sales.length} çek</span></article><div className="phone-kpis"><span><small>{tr(lang, 'transactions')}</small><b>{sales.length}</b></span><span><small>{tr(lang, 'openRegisters')}</small><b>{state.registers.filter((row) => row.status === 'open').length}</b></span><span><small>{tr(lang, 'low')}</small><b>{low.length}</b></span><span><small>{tr(lang, 'staff')}</small><b>{staff.filter((row) => row.active).length}</b></span></div><h4>Kassalar</h4>{state.registers.map((register) => <div className="phone-row" key={register.id}><span className={register.status === 'open' ? 'online-dot' : ''} /><p><b>{register.name}</b><small>{staff.find((row) => row.id === register.operatorId)?.name ?? 'Bağlı'}</small></p><strong>{money(state.sales.filter((sale) => sale.registerId === register.id && !sale.refunded).reduce((sum, sale) => sum + sale.totalMinor, 0), lang)}</strong></div>)}<h4>Kritik stok</h4>{low.slice(0, 3).map((product) => <div className="phone-row" key={product.id}><ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} /><p><b>{product.name[lang]}</b><small>{product.sku}</small></p><strong className="danger">{stockOf(product)}</strong></div>)}</div><nav><span><Activity />Panel</span><span><ReceiptText />Satış</span><span><Boxes />Stok</span><span><Settings />Ayar</span></nav></div><div className="mobile-copy"><span><Smartphone /></span><h3>Mağaza cibinizdə</h3><p>Satış məbləği, kassa vəziyyəti, kassir performansı və kritik stoklar sahibkar hesabında telefon ölçüsünə uyğun göstərilir.</p><ul><li><Check />30 saniyəlik canlı sinxron</li><li><Check />POS offline olsa növbə saxlanılır</li><li><Check />Hər müştəri üçün ayrı tenant məlumatı</li><li><Check />AZ / RU / EN interfeys</li></ul><div className="portal-address"><Cloud /><span>Sahibkar ünvanı<b>possistem.az/marketpos</b></span></div></div></section></div>;
}
