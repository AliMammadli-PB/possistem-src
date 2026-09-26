import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRightLeft, BadgeDollarSign, BarChart3, Boxes, Building2, Check,
  ChevronRight, CircleDollarSign, ClipboardList, Cloud, CloudOff, CreditCard, Download,
  Expand, FileClock, ImagePlus, KeyRound, Languages, LockKeyhole, LogOut, Minus,
  Monitor, PackageCheck, PackagePlus, PackageSearch, Pause, Plus, ReceiptText, Scale,
  RefreshCw, RotateCcw, ScanBarcode, Search, Settings, ShieldCheck, ShoppingBag,
  ShoppingBasket, Smartphone, Store, Trash2, TriangleAlert, Truck, UserCog, Users,
  WalletCards, Warehouse as WarehouseIcon, Wheat, X,
} from 'lucide-react';

import { createInitialState, demoStaff, initialProducts } from './data';
import { CatalogAisleNav } from './CatalogAisleNav';
import { ChangePinScreen } from './ChangePinScreen';
import { cashChange, canAccess, findBarcode, parseMoneyInput, ROLE_VIEWS, stockOf } from './domain';
import { auditActionLabel, auditDetailLabel, roleLabel, tr, unitLabel, viewLabel } from './i18n';
import { marketCoreClient } from './core/client';
import { ProductVisual } from './ProductVisual';
import { RolePermissionsPanel } from './RolePermissionsPanel';
import { InventoryProductGrid, SaleProductGrid } from './SaleProductGrid';
import {
  CustomersPage, FiscalBadge, HardwareSettingsCard, ImportCsvPage, PlatformStubsPage,
  RegistersOpsPage, ReportsOpsPage, StocktakePage,
} from './RetailOpsPanels';
import { useBarcodeScanner } from './useBarcodeScanner';
import type { ActivationStatus, CartLine, HeldCart, Lang, Payment, PersistedState, Product, PurchaseOrder, Register, Role, Sale, SessionUser, StaffProfile, StoreSettings, TenantStatus, UpdateStatus, View } from './types';

import { marketBooks, stockLines } from './books';
import { longDate, money, newId } from './format';
import { ACK_KEY, FAIL_KEY, ACK_PENDING_KEY, FAIL_PENDING_KEY, applyMarketCommand, clearPending, failedCommandReasons, productFromCard, readCommandIds, rememberCommandId, rememberFailure } from './portalCommands';
import { ProductModal, WarehouseModal, RegisterModal, PurchaseModal, TransferModal, WasteModal, StaffModal, RoleAvatar, Kpi, Modal, Field } from './forms';
const STORE_KEY = 'cyberplus.market.pos.v2';
const LEGACY_MIGRATED_KEY = 'cyberplus.market.pos.core-migrated';
const CATALOG_SYNC_KEY = 'cyberplus.market.pos.catalog-sync';
const CATALOG_SYNC_TOKEN = 'bravo-narimanov-azinko-catalog-aisles-v1';

const STOCK_VIEWS = new Set<View>(['inventory', 'warehouses', 'purchases', 'stocktake']);
// The owner's rule: a missing permission never hides a button; using it says so.
const DENIED = 'Buna icazəniz yoxdur';
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
const MARKET_AREAS = ['dashboard', 'sale', 'inventory', 'warehouses', 'purchases', 'returns', 'reports', 'registers', 'stocktake', 'customers', 'import', 'staff', 'settings'];
// What each PC is for, set by the owner on possistem.az (Kompüterlər): the
// website's areas are narrowed to it, so the store-room PC opens on stock.
const STATION_VIEWS: Record<string, string[]> = {
  cashier: ['sale', 'returns', 'registers', 'customers', 'settings'],
  waiter: ['sale', 'customers', 'settings'],
  kitchen: ['sale', 'settings'],
  warehouse: ['inventory', 'warehouses', 'purchases', 'stocktake', 'import', 'reports', 'settings'],
};
function narrowByStation(access: string[] | null, station: string | undefined): string[] | null {
  const allowed = station ? STATION_VIEWS[station] : undefined;
  if (!allowed) return access;
  return (access ?? MARKET_AREAS).filter((key) => allowed.includes(key));
}

function refreshSeedCatalog(products: Product[]): Product[] {
  const existingById = new Map(products.map((product) => [product.id, product]));
  const seedIds = new Set(initialProducts.map((product) => product.id));
  const refreshed = initialProducts.map((seed) => {
    const existing = existingById.get(seed.id);
    if (!existing) return seed;
    return {
      ...existing,
      name: seed.name,
      category: seed.category,
      unit: seed.unit,
      priceMinor: seed.priceMinor,
      costMinor: seed.costMinor,
      supplier: seed.supplier,
      accent: seed.accent,
      image: seed.image,
      barcode: seed.barcode,
      sku: seed.sku,
    };
  });
  // Keep merchant-created products; drop obsolete demo seed ids that are no longer in catalog.
  const custom = products.filter((product) => !seedIds.has(product.id) && !product.id.startsWith('p-fruit-') && !product.id.startsWith('p-egg-') && !product.id.startsWith('p-bread-') && !product.id.startsWith('p-tea-') && !product.id.startsWith('p-coffee-') && !product.id.startsWith('p-oil-') && !product.id.startsWith('p-drink-') && !product.id.startsWith('p-dairy-') && !product.id.startsWith('p-chips-') && !product.id.startsWith('p-sweet-') && !product.id.startsWith('p-pasta-') && !product.id.startsWith('p-clean-') && !product.id.startsWith('p-water-') && product.id !== 'p-butter');
  return [...refreshed, ...custom];
}

function loadState(): PersistedState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as (Omit<PersistedState, 'schemaVersion'> & { schemaVersion: number }) | null;
    if (parsed?.schemaVersion === 5 && Array.isArray(parsed.products)) {
      return { ...parsed, products: refreshSeedCatalog(parsed.products) } as PersistedState;
    }
    if (parsed && Array.isArray(parsed.products) && (parsed.schemaVersion === 4 || parsed.schemaVersion === 3 || parsed.schemaVersion === 2)) {
      const custom = parsed.products.filter((product) => product.id.startsWith('product-'));
      return { ...createInitialState(), sales: parsed.sales ?? [], purchaseOrders: parsed.purchaseOrders ?? [], products: [...initialProducts, ...custom] };
    }
  } catch { /* Corrupt local state must not block the till. */ }
  return createInitialState();
}

export default function App() {
  const initial = useRef(loadState()).current;
  const [state, setState] = useState<PersistedState>(initial);
  const [coreReady, setCoreReady] = useState(false);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>(demoStaff);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [lang, setLang] = useState<Lang>('az');
  const [view, setView] = useState<View>('dashboard');
  const [cart, setCart] = useState<CartLine[]>([]);
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
  const [notice, setNoticeRaw] = useState<string | null>(null);
  const setNotice = useCallback((message: string | null) => setNoticeRaw(cleanNotice(message)), []);
  const deny = useCallback(() => setNoticeRaw(DENIED), []);
  const [productModal, setProductModal] = useState<Product | 'new' | null>(null);
  const [warehouseModal, setWarehouseModal] = useState(false);
  const [registerModal, setRegisterModal] = useState(false);
  const [purchaseModal, setPurchaseModal] = useState(false);
  const [staffModal, setStaffModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [wasteModal, setWasteModal] = useState(false);

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
        const catalogSynced = localStorage.getItem(CATALOG_SYNC_KEY) === CATALOG_SYNC_TOKEN;
        const customOnly = (snapshot.products ?? []).filter((product) => product.id.startsWith('product-'));
        setState({
          ...snapshot,
          schemaVersion: 5,
          products: catalogSynced
            ? refreshSeedCatalog(snapshot.products ?? [])
            : [...initialProducts, ...customOnly],
        });
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
    // The one-time migrations, once somebody is signed in. They rewrite the
    // catalogue, so they run as that person and are refused if their role may
    // not - in which case they simply run for the next person who may, and the
    // screen keeps showing the in-memory catalogue meanwhile.
    if (!coreReady || !session) return;
    const legacyDone = localStorage.getItem(LEGACY_MIGRATED_KEY) === '1';
    const catalogDone = localStorage.getItem(CATALOG_SYNC_KEY) === CATALOG_SYNC_TOKEN;
    if (legacyDone && catalogDone) return;

    let cancelled = false;
    const migrate = async () => {
      try {
        let snapshot = await marketCoreClient.getState();
        if (!legacyDone) {
          if (!snapshot.products || snapshot.products.length === 0) {
            snapshot = await marketCoreClient.importLegacy(loadState());
          }
          localStorage.setItem(LEGACY_MIGRATED_KEY, '1');
        }
        if (!catalogDone) {
          const customOnly = (snapshot.products ?? []).filter((product) => product.id.startsWith('product-'));
          snapshot = await marketCoreClient.importLegacy({
            ...snapshot,
            schemaVersion: 5,
            products: [...initialProducts, ...customOnly],
            settings: snapshot.settings ?? createInitialState().settings,
          });
          // Deactivate obsolete demo SKUs so they leave the sale grid.
          for (const old of snapshot.products ?? []) {
            if (old.id.startsWith('product-') || old.id.startsWith('p-wolt-')) continue;
            await marketCoreClient.products.save({ ...old, active: false }, session.id);
          }
          snapshot = await marketCoreClient.getState();
          localStorage.setItem(CATALOG_SYNC_KEY, CATALOG_SYNC_TOKEN);
        }
        if (!cancelled) {
          setState({ ...snapshot, schemaVersion: 5, products: refreshSeedCatalog(snapshot.products ?? []) });
        }
      } catch {
        // Not permitted, or offline mid-migration: the flags stay unset and the
        // next sign-in tries again. The UI keeps the in-memory catalogue.
      }
    };
    void migrate();
    return () => { cancelled = true; };
  }, [coreReady, session]);

  useEffect(() => {
    if (coreReady) {
      localStorage.removeItem(STORE_KEY);
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
  useEffect(() => { void (window.marketSystem?.staff.list() ?? Promise.resolve(demoStaff)).then(setStaff).catch(() => setStaff(demoStaff)); }, []);
  useEffect(() => {
    if (!session || !window.marketSystem) return;
    let active = true;
    let pushing = false;
    const push = async () => {
      if (pushing) return;
      pushing = true;
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
      if (response.connected) setState((previous) => ({ ...previous, syncQueue: 0 }));
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
  }, [session, staff, coreReady, state.settings.storeName, state.settings.terminalName, state.sales, state.registers, state.products, state.warehouses, state.syncQueue]);

  const login = async (pin: string) => {
    try {
      let user: SessionUser;
      if (window.marketSystem) {
        // The PIN alone names the person, as on the restaurant till.
        user = await window.marketSystem.auth.login('', pin);
      } else {
        // Browser preview (npm run market:dev) has no staff store; it is never a
        // shipped till, so a production web build refuses sign-in outright.
        const profile = demoStaff[0];
        if (!import.meta.env.DEV || !profile || !/^\d{4,8}$/.test(pin)) throw new Error(t('invalidPin'));
        user = { ...profile, sessionToken: `browser-${profile.id}` };
      }
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
    setSession(null); setCart([]); setView('dashboard');
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

  const viewAllowed = (id: View) => (inventoryOn || !STOCK_VIEWS.has(id)) && (marketAccess == null || marketAccess.includes(id));
  const allowedViews = ROLE_VIEWS[session.role].filter((id) => viewAllowed(id));
  const safeSetView = (next: View) => { if (canAccess(session.role, next) && viewAllowed(next)) setView(next); else deny(); };
  const allNav: Array<{ id: View; icon: typeof Store }> = [
    { id: 'dashboard', icon: Activity }, { id: 'sale', icon: ShoppingBasket }, { id: 'inventory', icon: Boxes },
    { id: 'warehouses', icon: WarehouseIcon }, { id: 'purchases', icon: Truck }, { id: 'returns', icon: RotateCcw },
    { id: 'reports', icon: BarChart3 }, { id: 'registers', icon: Store }, { id: 'stocktake', icon: ClipboardList },
    { id: 'customers', icon: Users }, { id: 'import', icon: Download }, { id: 'platform', icon: Cloud },
    { id: 'staff', icon: Users }, { id: 'mobile', icon: Smartphone }, { id: 'settings', icon: Settings },
  ];
  // Every screen stays in the sidebar; the locked ones are dimmed and refuse.
  const nav = allNav;

  const productMap = new Map(state.products.map((product) => [product.id, product]));

  const saveProduct = (product: Product) => {
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          const exists = state.products.some((row) => row.id === product.id);
          if (exists) await marketCoreClient.products.save(product, session.id);
          else await marketCoreClient.products.create(product, session.id);
          await refreshFromCore();
        } else {
          mutate((previous) => ({ ...previous, products: previous.products.some((row) => row.id === product.id) ? previous.products.map((row) => row.id === product.id ? product : row) : [product, ...previous.products] }), 'PRODUCT_SAVE', `${product.sku} · ${product.name.az}`);
        }
        setProductModal(null); setNotice(t('productSaved'));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const receiveOrder = (order: PurchaseOrder) => {
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          await marketCoreClient.purchases.receive(order.id, session.id);
          await refreshFromCore();
        } else {
          mutate((previous) => ({
            ...previous,
            products: previous.products.map((product) => {
              const qty = order.lines.find((line) => line.productId === product.id)?.qty ?? 0;
              return qty ? { ...product, warehouseStock: { ...product.warehouseStock, [order.warehouseId]: (product.warehouseStock[order.warehouseId] ?? 0) + qty } } : product;
            }),
            purchaseOrders: previous.purchaseOrders.map((row) => row.id === order.id ? { ...row, status: 'received' } : row),
          }), 'PURCHASE_RECEIVE', order.id);
        }
        setNotice(`${order.id} · ${t('received')}`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const refundSale = (sale: Sale) => {
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          await marketCoreClient.returns.create(sale.id, session.id);
          await refreshFromCore();
        } else {
          mutate((previous) => ({ ...previous, sales: previous.sales.map((row) => row.id === sale.id ? { ...row, refunded: true } : row), products: previous.products.map((product) => { const qty = sale.items.find((line) => line.productId === product.id)?.qty ?? 0; return qty ? { ...product, warehouseStock: { ...product.warehouseStock, [previous.settings.defaultWarehouseId]: (product.warehouseStock[previous.settings.defaultWarehouseId] ?? 0) + qty } } : product; }) }), 'SALE_REFUND', sale.receiptNo);
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const toggleRegister = (register: Register) => {
    void (async () => {
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
    })();
  };

  return (
    <div className="market-shell">
      <aside className="rail">
        <button className="brand-mark" onClick={() => safeSetView('dashboard')} aria-label="MarketPos ana səhifə"><span className="ps-brand-mark"><img src="./assets/brand-mark.png" alt="" /></span><span>MarketPos</span></button>
        <nav>{nav.map(({ id, icon: Icon }) => { const locked = !allowedViews.includes(id); return <button key={id} className={view === id ? 'active' : ''} aria-disabled={locked || undefined} onClick={() => locked ? deny() : safeSetView(id)} title={locked ? `${viewLabel(id, lang)} · ${DENIED}` : viewLabel(id, lang)}><Icon /><span>{viewLabel(id, lang)}</span></button>; })}</nav>
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
            <div className={`connection ${online ? 'online' : ''}`}>{online ? <Cloud /> : <CloudOff />}<span>{online ? (cloudConnected ? t('online') : t('offline')) : t('offline')}{state.syncQueue ? ` · ${state.syncQueue} ${t('pending')}` : ''}{syncStatus?.peerCount ? ` · ${syncStatus.peerCount} kassa (LAN)` : ''}</span></div>
            <FiscalBadge coreReady={coreReady} />
            <div className="terminal-pill"><Monitor /><span>{state.settings.terminalName}<small>{state.registers.find((row) => row.id === state.settings.defaultRegisterId)?.name}</small></span></div>
            <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label="Language"><option value="az">AZ</option><option value="ru">RU</option><option value="en">EN</option></select>
            <button className="icon-button" onClick={() => void window.marketSystem?.display.toggleFullscreen()} title="F11"><Expand /></button>
            <button type="button" className="topbar-logout" onClick={() => void logout()} aria-label={t('logout')}><LogOut />{t('logout')}</button>
          </div>
        </header>

        <main className="page-area">
          <LockedArea locked={!viewAllowed(view)} onDenied={deny}>
          {view === 'dashboard' && <Dashboard state={state} staff={staff} session={session} lang={lang} onView={safeSetView} />}
          {view === 'sale' && <SalePage state={state} setState={setState} session={session} lang={lang} cart={cart} setCart={setCart} cloudConnected={cloudConnected} notify={setNotice} coreReady={coreReady} onRefresh={refreshFromCore} audit={mutate} />}
          {view === 'inventory' && <InventoryPage state={state} lang={lang} canEdit={session.role === 'manager' || session.role === 'warehouse'} onDenied={deny} onAdd={() => setProductModal('new')} onEdit={setProductModal} onTransfer={() => setTransferModal(true)} onWaste={() => setWasteModal(true)} />}
          {view === 'warehouses' && <WarehousesPage state={state} lang={lang} onAdd={() => setWarehouseModal(true)} onTransfer={() => setTransferModal(true)} />}
          {view === 'purchases' && <PurchasesPage state={state} lang={lang} onAdd={() => setPurchaseModal(true)} onReceive={receiveOrder} />}
          {view === 'returns' && <ReturnsPage state={state} lang={lang} onRefund={refundSale} />}
          {view === 'reports' && <ReportsOpsPage state={state} staff={staff} lang={lang} coreReady={coreReady} />}
          {view === 'registers' && <RegistersOpsPage state={state} staff={staff} session={session} lang={lang} coreReady={coreReady} onAdd={() => setRegisterModal(true)} onToggle={toggleRegister} onRefresh={refreshFromCore} notify={setNotice} />}
          {view === 'stocktake' && <StocktakePage state={state} session={session} coreReady={coreReady} notify={setNotice} onRefresh={refreshFromCore} />}
          {view === 'customers' && <CustomersPage session={session} lang={lang} coreReady={coreReady} notify={setNotice} />}
          {view === 'import' && <ImportCsvPage session={session} coreReady={coreReady} notify={setNotice} />}
          {view === 'platform' && <PlatformStubsPage coreReady={coreReady} notify={setNotice} />}
          {view === 'staff' && <><StaffPage staff={staff} lang={lang} onAdd={() => setStaffModal(true)} /><RolePermissionsPanel actorRole={session.role} /></>}
          {view === 'mobile' && <MobilePage state={state} staff={staff} lang={lang} cloudConnected={cloudConnected} />}
          {view === 'settings' && <SettingsPage state={state} session={session} lang={lang} coreReady={coreReady} notify={setNotice} onSettings={(settings) => {
            void (async () => {
              try {
                if (coreReady && marketCoreClient.available()) {
                  await marketCoreClient.settings.set(settings, session.id);
                  await refreshFromCore();
                } else mutate((previous) => ({ ...previous, settings }), 'SETTINGS_SAVE', settings.storeName);
              } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); }
            })();
          }} />}
          </LockedArea>
        </main>
      </section>

      {productModal && <ProductModal lang={lang} products={state.products} warehouses={state.warehouses} session={session} product={productModal === 'new' ? null : productModal} onClose={() => setProductModal(null)} onSave={saveProduct} />}
      {warehouseModal && <WarehouseModal lang={lang} onClose={() => setWarehouseModal(false)} onSave={(warehouse) => {
        void (async () => {
          try {
            if (coreReady && marketCoreClient.available()) {
              await marketCoreClient.warehouses.create(warehouse, session.id);
              await refreshFromCore();
            } else mutate((previous) => ({ ...previous, warehouses: [...previous.warehouses, warehouse], products: previous.products.map((product) => ({ ...product, warehouseStock: { ...product.warehouseStock, [warehouse.id]: 0 } })) }), 'WAREHOUSE_CREATE', warehouse.name);
            setWarehouseModal(false); setNotice(t('warehouseSaved'));
          } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); }
        })();
      }} />}
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
      {purchaseModal && <PurchaseModal lang={lang} products={state.products} warehouses={state.warehouses} session={session} onClose={() => setPurchaseModal(false)} onSave={(order) => {
        void (async () => {
          try {
            if (coreReady && marketCoreClient.available()) {
              await marketCoreClient.purchases.create(order);
              await refreshFromCore();
            } else mutate((previous) => ({ ...previous, purchaseOrders: [order, ...previous.purchaseOrders] }), 'PURCHASE_CREATE', order.id);
            setPurchaseModal(false); setNotice(t('orderSaved'));
          } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); }
        })();
      }} />}
      {transferModal && <TransferModal lang={lang} products={state.products} warehouses={state.warehouses} onClose={() => setTransferModal(false)} onSave={(productId, from, to, qty) => {
        void (async () => {
          try {
            if (coreReady && marketCoreClient.available()) {
              await marketCoreClient.inventory.transfer({ productId, fromWarehouseId: from, toWarehouseId: to, qty, actorId: session.id });
              await refreshFromCore();
            } else mutate((previous) => ({ ...previous, products: previous.products.map((product) => product.id !== productId ? product : { ...product, warehouseStock: { ...product.warehouseStock, [from]: (product.warehouseStock[from] ?? 0) - qty, [to]: (product.warehouseStock[to] ?? 0) + qty } }) }), 'STOCK_TRANSFER', `${productMap.get(productId)?.sku} · ${qty}`);
            setTransferModal(false); setNotice(t('stockAdded'));
          } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); }
        })();
      }} />}
      {wasteModal && <WasteModal lang={lang} products={state.products} warehouses={state.warehouses} onClose={() => setWasteModal(false)} onSave={(input) => {
        void (async () => {
          try {
            await marketCoreClient.inventory.waste({ ...input, actorId: session.id });
            await refreshFromCore();
            setWasteModal(false);
            setNotice('Silinmə qeyd edildi');
          } catch (err) { setNotice(err instanceof Error ? err.message : String(err)); }
        })();
      }} />}
      {staffModal && <StaffModal lang={lang} registers={state.registers} warehouses={state.warehouses} onClose={() => setStaffModal(false)} onSave={async (profile, pin) => { const saved = window.marketSystem ? await window.marketSystem.staff.save(session.sessionToken, profile, pin) : { ...profile, id: newId('u') } as StaffProfile; setStaff((rows) => [...rows, saved]); setStaffModal(false); setNotice(t('staffSaved')); }} />}
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

function AuthGate({ lang, setLang, staff, onLogin }: { lang: Lang; setLang: (lang: Lang) => void; staff: StaffProfile[]; onLogin: (pin: string) => Promise<void> }) {
  const [tenant, setTenant] = useState<TenantStatus | null>(null);
  const [activation, setActivation] = useState<ActivationStatus | null>(null);
  const [ready, setReady] = useState(!window.marketSystem);

  useEffect(() => {
    if (!window.marketSystem) return;
    let cancelled = false;
    const boot = async () => {
      try {
        const [tenantStatus, license] = await Promise.all([
          window.marketSystem!.tenant.status(),
          window.marketSystem!.activation.refresh().catch(() => window.marketSystem!.activation.status()),
        ]);
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
    return <LoginScreen lang={lang} setLang={setLang} staff={staff} onLogin={onLogin} />;
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
        onActivated={(next) => setActivation(next)}
        onTenantLogout={() => {
          void window.marketSystem?.tenant.logout().then(() => setTenant({ authenticated: false }));
        }}
      />
    );
  }
  return <LoginScreen lang={lang} setLang={setLang} staff={staff} onLogin={onLogin} activation={activation} tenant={tenant} />;
}

function TenantLoginScreen({ lang, setLang, onSuccess }: { lang: Lang; setLang: (lang: Lang) => void; onSuccess: (tenant: TenantStatus) => void }) {
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem('marketpos.tenant.email') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => {
    try { return localStorage.getItem('marketpos.tenant.remember') === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password || busy || !window.marketSystem) return;
    setBusy(true);
    setError('');
    try {
      const status = await window.marketSystem.tenant.login(email.trim(), password);
      try {
        if (remember) {
          localStorage.setItem('marketpos.tenant.remember', '1');
          localStorage.setItem('marketpos.tenant.email', email.trim());
        } else {
          localStorage.removeItem('marketpos.tenant.remember');
          localStorage.removeItem('marketpos.tenant.email');
        }
      } catch { /* ignore */ }
      onSuccess(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr(lang, 'tenantWrongCredentials'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ps-login-screen" style={{ backgroundImage: 'url(./assets/login-bg.png)' }}>
      <div className="ps-login-veil" aria-hidden />
      <div className="ps-login-glow" aria-hidden />
      <div className="ps-login-grid">
        <section className="ps-login-brand">
          <div className="ps-login-brand-head">
            <span className="ps-brand-mark"><img src="./assets/brand-mark.png" alt="" draggable={false} /></span>
            <div>
              <p className="brand-wordmark">MarketPos</p>
              <p className="brand-sub">{tr(lang, 'loginTagline')}</p>
            </div>
            <label className="ps-login-lang">
              <Languages />
              <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label="Language">
                <option value="az">AZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </label>
          </div>
          <div className="ps-login-brand-copy">
            <p className="brand-kicker">{tr(lang, 'tenantEyebrow')}</p>
            <h1>{tr(lang, 'tenantWelcome')}</h1>
            <div className="ps-login-rule"><i /><span>{tr(lang, 'tenantHint')}</span></div>
          </div>
          <div className="ps-login-secure"><ShieldCheck /><span>{tr(lang, 'loginSecure')}</span></div>
        </section>
        <section className="ps-login-glass">
          <div className="ps-login-glass-shine" aria-hidden />
          <form className="ps-tenant-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <header>
              <p className="brand-kicker">01 / {tr(lang, 'tenantAccess')}</p>
              <h2>{tr(lang, 'tenantLogin')}</h2>
              <p className="ps-login-hint">{tr(lang, 'tenantLoginHint')}</p>
            </header>
            <label>
              <span>{tr(lang, 'tenantEmail')}</span>
              <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
            </label>
            <label>
              <span>{tr(lang, 'tenantPassword')}</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
            </label>
            <label className="ps-tenant-remember">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>{tr(lang, 'tenantRemember')}</span>
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="modal-primary" disabled={busy || !email.trim() || !password}>
              <LockKeyhole />{busy ? '…' : tr(lang, 'tenantContinue')}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function ActivationGateScreen({
  lang, setLang, tenant, activation, onActivated, onTenantLogout,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  tenant: Extract<TenantStatus, { authenticated: true }>;
  activation: ActivationStatus | null;
  onActivated: (status: ActivationStatus) => void;
  onTenantLogout: () => void;
}) {
  const [activationKey, setActivationKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

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

  const redeem = async () => {
    if (!window.marketSystem || busy) return;
    const key = activationKey.trim();
    if (key.length < 12) {
      setMessage(tr(lang, 'requiredFields'));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const status = await window.marketSystem.activation.activate(null, key);
      onActivated(status);
      setActivationKey('');
      setMessage(tr(lang, 'active'));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ps-login-screen" style={{ backgroundImage: 'url(./assets/login-bg.png)' }}>
      <div className="ps-login-veil" aria-hidden />
      <div className="ps-login-glow" aria-hidden />
      <div className="ps-login-grid">
        <section className="ps-login-brand">
          <div className="ps-login-brand-head">
            <span className="ps-brand-mark"><img src="./assets/brand-mark.png" alt="" draggable={false} /></span>
            <div>
              <p className="brand-wordmark">MarketPos</p>
              <p className="brand-sub">{tr(lang, 'loginTagline')}</p>
            </div>
            <label className="ps-login-lang">
              <Languages />
              <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label="Language">
                <option value="az">AZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </label>
          </div>
          <div className="ps-login-brand-copy">
            <p className="brand-kicker">{tr(lang, 'activation')}</p>
            <h1>{tr(lang, 'licenseGateTitle')}</h1>
            <div className="ps-login-rule"><i /><span>{tr(lang, 'licenseGateHint')}</span></div>
          </div>
          <div className="ps-login-secure"><ShieldCheck /><span>{tenant.email}</span></div>
        </section>
        <section className="ps-login-glass">
          <div className="ps-login-glass-shine" aria-hidden />
          <div className={`ps-login-license blocked`}>
            <header>
              <h3>{tr(lang, 'activation')}</h3>
              <em className="pill warn">{licenseModeLabel(lang, activation?.mode)}</em>
            </header>
            <div className="license-meta">
              <span><small>{tr(lang, 'licenseCustomer')}</small><b>{activation?.customerName || tenant.customerName}</b></span>
              <span><small>{tr(lang, 'licenseDevice')}</small><b>{shortHwid(activation?.deviceId)}</b></span>
              <span><small>{tr(lang, 'licenseValidUntil')}</small><b>{activation?.validUntil ? new Date(activation.validUntil).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ') : '—'}</b></span>
              <span><small>{tr(lang, 'tenantEmail')}</small><b>{tenant.email}</b></span>
            </div>
            <p>{tr(lang, 'licenseBlocked')}</p>
            <div className="activation-row">
              <input
                value={activationKey}
                onChange={(event) => setActivationKey(event.target.value)}
                placeholder="MPOS-XXXX-XXXX-XXXX"
                aria-label={tr(lang, 'activationKey')}
                disabled={busy}
              />
              <button type="button" className="modal-primary" disabled={busy} onClick={() => void redeem()}>
                <KeyRound />{tr(lang, 'activateNow')}
              </button>
            </div>
            {activation?.serverDeviceId && (
              <button type="button" className="ps-tenant-switch" disabled={busy} onClick={() => void recheck()}>
                <RefreshCw />Serverdən yoxla
              </button>
            )}
            {message && <p className="form-error">{message}</p>}
            <button type="button" className="ps-tenant-switch" onClick={onTenantLogout}>{tr(lang, 'tenantSwitchAccount')}</button>
          </div>
        </section>
      </div>
    </main>
  );
}

function LoginScreen({ lang, setLang, staff, onLogin, activation, tenant }: {
  lang: Lang;
  setLang: (lang: Lang) => void;
  staff: StaffProfile[];
  onLogin: (pin: string) => Promise<void>;
  activation?: ActivationStatus | null;
  tenant?: TenantStatus | null;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeStaff = staff.filter((row) => row.active);

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
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy) return;
      if (/^\d$/.test(event.key)) {
        setPin((value) => {
          if (value.length >= 4) return value;
          const next = value + event.key;
          if (next.length === 4) void submit(next);
          return next;
        });
      } else if (event.key === 'Backspace') setPin((value) => value.slice(0, -1));
      else if (event.key === 'Escape') { setPin(''); setError(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pressKey = (key: string) => {
    if (busy) return;
    if (key === 'clear') { setPin(''); return; }
    if (key === 'back') { setPin((value) => value.slice(0, -1)); return; }
    setPin((value) => {
      if (value.length >= 4) return value;
      const next = value + key;
      if (next.length === 4) void submit(next);
      return next;
    });
  };

  return (
    <main className="ps-login-screen" style={{ backgroundImage: 'url(./assets/login-bg.png)' }}>
      <div className="ps-login-veil" aria-hidden />
      <div className="ps-login-glow" aria-hidden />
      <div className="ps-login-grid">
        <section className="ps-login-brand">
          <div className="ps-login-brand-head">
            <span className="ps-brand-mark"><img src="./assets/brand-mark.png" alt="" draggable={false} /></span>
            <div>
              <p className="brand-wordmark">MarketPos</p>
              <p className="brand-sub">{tr(lang, 'loginTagline')}</p>
            </div>
            <label className="ps-login-lang">
              <Languages />
              <select value={lang} onChange={(event) => setLang(event.target.value as Lang)} aria-label="Language">
                <option value="az">AZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </label>
          </div>
          <div className="ps-login-brand-copy">
            <p className="brand-kicker">{tr(lang, 'loginEyebrow')}</p>
            <h1>{tr(lang, 'loginWelcome')}</h1>
            <div className="ps-login-rule"><i /><span>{tr(lang, 'loginShiftHint')}</span></div>
          </div>
          <div className="ps-login-secure"><ShieldCheck /><span>{tr(lang, 'loginSecure')}</span></div>
        </section>

        <section className="ps-login-glass">
          <div className="ps-login-glass-shine" aria-hidden />
          {activation && window.marketSystem && (
            <div className="ps-login-license">
              <header>
                <h3>{tr(lang, 'activation')}</h3>
                <em className="pill ok">{licenseModeLabel(lang, activation.mode)}</em>
              </header>
              <div className="license-meta">
                <span><small>{tr(lang, 'licenseCustomer')}</small><b>{activation.customerName}</b></span>
                <span><small>{tr(lang, 'licenseDevice')}</small><b>{shortHwid(activation.deviceId)}</b></span>
                <span><small>{tr(lang, 'licenseValidUntil')}</small><b>{new Date(activation.validUntil).toLocaleDateString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ')}</b></span>
                <span><small>{tr(lang, 'tenantEmail')}</small><b>{tenant && 'email' in tenant ? tenant.email : '—'}</b></span>
              </div>
            </div>
          )}
          <div className="ps-login-pin ps-login-pin--solo">
              <section className="ps-pin-entry">
                <p className="brand-kicker">{tr(lang, 'loginEnterPin')}</p>
                <h3>{tr(lang, 'loginPinTitle')}</h3>
                <p className="ps-login-hint">{tr(lang, 'loginPinHint')}</p>
                <div className="ps-pin-dots" aria-label={`${pin.length} / 4`}>
                  {[0, 1, 2, 3].map((index) => (
                    <span key={index} className={pin.length > index ? 'filled' : ''}>
                      <i />
                    </span>
                  ))}
                  <em>{pin.length}/4</em>
                </div>
                <div className="ps-pin-pad" aria-label="PIN klaviaturası">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((key) => {
                    const action = key === 'clear' || key === 'back';
                    return (
                      <button
                        key={key}
                        type="button"
                        className={action ? 'pin-key action' : 'pin-key'}
                        disabled={busy || (key === 'clear' && !pin) || (key === 'back' && !pin)}
                        aria-label={key === 'clear' ? 'PIN təmizlə' : key === 'back' ? 'Son rəqəmi sil' : `${key}`}
                        onClick={() => pressKey(key)}
                      >
                        {key === 'back' ? '←' : key === 'clear' ? 'C' : key}
                      </button>
                    );
                  })}
                </div>
                <div className="ps-pin-error">{error && <p className="form-error">{error}</p>}</div>
                <p className="ps-pin-staff-count">{activeStaff.length} {tr(lang, 'loginActiveStaff').toLocaleLowerCase(lang)} · {tr(lang, 'loginKeyboardHint')}</p>
              </section>
          </div>
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
  return <div className="module-page dashboard"><section className="welcome-card"><div><p>{longDate(new Date(), lang)}</p><h2>Salam, {session.name.split(' ')[0]}</h2><span>{roleMessage[session.role]}</span></div><div className="live-badge"><Activity /><span>CANLI<small>{state.settings.storeName}</small></span></div></section><section className="kpi-grid"><Kpi icon={CircleDollarSign} label={tr(lang, 'todaySales')} value={money(revenue, lang)} note={`${activeSales.length} ${tr(lang, 'transactions').toLowerCase()}`} tone="green" /><Kpi icon={Store} label={tr(lang, 'openRegisters')} value={`${open.length} / ${state.registers.length}`} note={open.map((row) => row.name).join(' · ')} tone="blue" /><Kpi icon={TriangleAlert} label={tr(lang, 'criticalProducts')} value={String(critical.length)} note={critical.slice(0, 2).map((row) => row.name[lang]).join(' · ')} tone="amber" /><Kpi icon={Boxes} label={tr(lang, 'totalStock')} value={String(totalStock)} note={`${state.warehouses.length} ${tr(lang, 'warehouses').toLowerCase()}`} tone="violet" /></section><section className="dashboard-grid"><article className="panel-card quick-card"><div className="panel-title"><div><p>{tr(lang, 'quickOpsKicker').toLocaleUpperCase(lang)}</p><h3>{tr(lang, 'quickActions')}</h3></div></div><div className="quick-grid">{canAccess(session.role, 'sale') && <button onClick={() => onView('sale')}><span><ShoppingBasket /></span><b>{tr(lang, 'newSale')}</b><small>{tr(lang, 'scanReady')}</small><ChevronRight /></button>}{canAccess(session.role, 'inventory') && <button onClick={() => onView('inventory')}><span><PackageSearch /></span><b>{tr(lang, 'inventory')}</b><small>{critical.length} {tr(lang, 'low').toLowerCase()}</small><ChevronRight /></button>}{canAccess(session.role, 'purchases') && <button onClick={() => onView('purchases')}><span><Truck /></span><b>{tr(lang, 'purchases')}</b><small>{state.purchaseOrders.filter((row) => row.status === 'ordered').length} {tr(lang, 'ordered').toLowerCase()}</small><ChevronRight /></button>}{canAccess(session.role, 'registers') && <button onClick={() => onView('registers')}><span><Store /></span><b>{tr(lang, 'registers')}</b><small>{open.length} {tr(lang, 'active').toLowerCase()}</small><ChevronRight /></button>}</div></article><article className="panel-card"><div className="panel-title"><div><p>{tr(lang, 'auditKicker').toLocaleUpperCase(lang)}</p><h3>{tr(lang, 'audit')}</h3></div><FileClock /></div><div className="activity-list">{state.audits.slice(0, 5).map((entry) => <div key={entry.id}><span><Activity /></span><p><b>{auditActionLabel(entry.action, lang)}</b><small>{auditDetailLabel(entry.detail, lang)} · {staff.find((row) => row.id === entry.actorId)?.name ?? tr(lang, 'systemActor')}</small></p><time>{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></article></section></div>;
}

function SalePage({ state, setState, session, lang, cart, setCart, cloudConnected, notify, coreReady, onRefresh, audit }: { state: PersistedState; setState: React.Dispatch<React.SetStateAction<PersistedState>>; session: SessionUser; lang: Lang; cart: CartLine[]; setCart: React.Dispatch<React.SetStateAction<CartLine[]>>; cloudConnected: boolean; notify: (text: string) => void; coreReady: boolean; onRefresh: () => Promise<PersistedState>; audit: (fn: (state: PersistedState) => PersistedState, action?: string, detail?: string) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [quick, setQuick] = useState<'bread' | 'weighted' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [discount, setDiscount] = useState('0');
  const inputRef = useRef<HTMLInputElement>(null);

  const products = useMemo(() => state.products.filter((product) => product.active), [state.products]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const categories = useMemo(() => [...new Set(products.map((product) => product.category))], [products]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of products) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    return counts;
  }, [products]);
  const warehouseId = state.settings.defaultWarehouseId;
  const register = state.registers.find((row) => row.id === state.settings.defaultRegisterId);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesQuick = quick === 'bread'
        ? product.category === 'Çörək'
        : quick === 'weighted'
          ? product.unit === 'kq'
          : category === 'all' || product.category === category;
      if (!matchesQuick) return false;
      if (!needle) return true;
      return product.barcode.includes(needle)
        || product.sku.toLocaleLowerCase().includes(needle)
        || Object.values(product.name).some((name) => name.toLocaleLowerCase().includes(needle));
    });
  }, [products, query, category, quick]);

  const detail = cart.flatMap((line) => {
    const product = productMap.get(line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const subtotal = detail.reduce((sum, line) => sum + line.product.priceMinor * line.qty, 0);
  const discountMinor = Math.min(subtotal, parseMoneyInput(discount));
  const total = subtotal - discountMinor;

  const add = useCallback((product: Product) => {
    const available = product.warehouseStock[warehouseId] ?? 0;
    setCart((rows) => {
      const inCart = rows.find((line) => line.productId === product.id)?.qty ?? 0;
      if (available <= inCart) {
        queueMicrotask(() => notify(tr(lang, 'outOfStock')));
        return rows;
      }
      return rows.some((row) => row.productId === product.id)
        ? rows.map((row) => row.productId === product.id ? { ...row, qty: row.qty + 1 } : row)
        : [...rows, { productId: product.id, qty: 1 }];
    });
    startTransition(() => setQuery(''));
  }, [warehouseId, setCart, notify, lang]);

  const scan = (value: string) => {
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          const resolved = await marketCoreClient.barcode.resolve(value);
          const productId = String(resolved.productId || resolved.id || '');
          if (productId) {
            const product = products.find((p) => p.id === productId);
            if (product) {
              add(product);
              notify(`${product.name[lang]} · ${tr(lang, 'completed')}`);
              return;
            }
          }
        }
      } catch { /* fall through to local */ }
      const product = findBarcode(products, value);
      if (product) {
        add(product);
        notify(`${product.name[lang]} · ${tr(lang, 'completed')}`);
      } else notify(tr(lang, 'noResults'));
    })();
  };

  useBarcodeScanner({ enabled: true, onScan: scan });

  const adjust = (productId: string, delta: number) => setCart((rows) => rows.map((row) => row.productId === productId ? { ...row, qty: Math.max(0, Math.min(productMap.get(productId)?.warehouseStock[warehouseId] ?? row.qty, row.qty + delta)) } : row).filter((row) => row.qty > 0));
  const hold = () => {
    if (!cart.length) return;
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          await marketCoreClient.sales.hold({
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
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
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
          const sale = await marketCoreClient.sales.complete({
            cashierId: session.id,
            registerId: register?.id ?? state.settings.defaultRegisterId,
            warehouseId,
            discountMinor,
            items: cart,
            payment: { ...payment, terminalRef },
            role: session.role,
          });
          try {
            await marketCoreClient.fiscal.enqueue({
              saleId: sale.id,
              kind: 'sale',
              idempotencyKey: `sale:${sale.id}`,
              request: { saleId: sale.id, totalMinor: sale.totalMinor, receiptNo: sale.receiptNo },
            });
            await window.marketSystem?.fiscal?.processPending(session.sessionToken);
          } catch { /* fiscal mock optional */ }
          try {
            const receipt = await marketCoreClient.sales.receipt(sale.id);
            await window.marketSystem?.printer?.receipt(session.sessionToken, receipt, 80);
          } catch { /* printer optional */ }
          await onRefresh();
          setCart([]); setDiscount('0'); setPaymentOpen(false);
          notify(`${tr(lang, 'completed')} · ${sale.receiptNo}`);
          return;
        }
        const createdAt = Date.now();
        const sale: Sale = { id: newId('sale'), receiptNo: `M-${new Date(createdAt).toISOString().slice(2, 10).replace(/-/g, '')}-${String(state.sales.length + 1).padStart(4, '0')}`, createdAt, items: cart, subtotalMinor: subtotal, discountMinor, totalMinor: total, payment, refunded: false, cashierId: session.id, registerId: register?.id ?? 'unknown' };
        audit((previous) => ({ ...previous, sales: [sale, ...previous.sales], products: previous.products.map((product) => { const qty = cart.find((line) => line.productId === product.id)?.qty ?? 0; return qty && product.kind !== 'service' ? { ...product, warehouseStock: { ...product.warehouseStock, [warehouseId]: Math.max(0, (product.warehouseStock[warehouseId] ?? 0) - qty) } } : product; }) }), 'SALE_COMPLETE', `${sale.receiptNo} · ${money(total, lang)}`);
        setCart([]); setDiscount('0'); setPaymentOpen(false); notify(`${tr(lang, 'completed')} · ${sale.receiptNo}`);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
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
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          await marketCoreClient.sales.cancelHeld(held.id, session.id, session.role);
          await onRefresh();
        } else {
          setState((previous) => ({ ...previous, heldCarts: previous.heldCarts.filter((row) => row.id !== held.id) }));
        }
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  return (
    <div className="sale-layout">
      <aside className="catalog-aisles">
        <h2>{tr(lang, 'catalogAisles')}</h2>
        <CatalogAisleNav
          lang={lang}
          categories={categories}
          counts={categoryCounts}
          total={products.length}
          value={quick ? '' : category}
          onChange={(next) => { setCategory(next); setQuick(null); }}
          layout="rail"
        />
      </aside>
      <section className="catalog-pane">
        <div className="sale-toolbar">
          <label className="search-box">
            <Search />
            <input ref={inputRef} data-scanner="allow" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') scan(query); }} placeholder={tr(lang, 'search')} />
          </label>
          <button className="scan-button" onClick={() => scan(query)}><ScanBarcode /><span>{tr(lang, 'barcode')}</span><small>{tr(lang, 'scanReady')}</small></button>
          <button className="new-sale-button" onClick={() => { if (!cart.length || confirm('Cari səbət təmizlənsin?')) { setCart([]); setDiscount('0'); inputRef.current?.focus(); } }}><Plus />{tr(lang, 'newSale')}</button>
        </div>
        <div className="sale-live-row">
          <div className="scan-status">
            <span className="pulse-dot" />
            <b>{tr(lang, 'scanReady')}</b>
            <small>EAN-13 · CODE128 · USB HID</small>
            <em className={cloudConnected ? 'ok' : ''}>{cloudConnected ? tr(lang, 'online') : tr(lang, 'offline')}</em>
          </div>
          <div className="cashier-quick">
            <button className={quick === 'bread' ? 'active' : ''} aria-pressed={quick === 'bread'} onClick={() => setQuick(quick === 'bread' ? null : 'bread')}><Wheat /><span>Çörək</span></button>
            <button className={quick === 'weighted' ? 'active' : ''} aria-pressed={quick === 'weighted'} onClick={() => setQuick(quick === 'weighted' ? null : 'weighted')}><Scale /><span>Kilo məhsul</span></button>
          </div>
        </div>
        <SaleProductGrid products={filtered} lang={lang} warehouseId={warehouseId} money={money} onAdd={add} />
      </section>
      <aside className="cart-pane">
        <div className="cart-head">
          <div>
            <p>{tr(lang, 'cart')}</p>
            <strong>#{String(state.sales.length + 1).padStart(4, '0')}</strong>
            <small>{register?.name ?? 'Kassa seçilməyib'}</small>
          </div>
          <button disabled={!cart.length} onClick={() => setCart([])} aria-label="Səbəti təmizlə"><Trash2 /></button>
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
          ) : detail.map(({ product, qty }) => (
            <div className="cart-line" key={product.id}>
              <ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} />
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
          ))}
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
          <label>{tr(lang, 'discount')}<span><input value={discount} onChange={(event) => setDiscount(event.target.value)} inputMode="decimal" /> ₼</span></label>
        </div>
        <div className="totals">
          <div><span>{tr(lang, 'subtotal')}</span><b>{money(subtotal, lang)}</b></div>
          <div><span>{tr(lang, 'discount')}</span><b>-{money(discountMinor, lang)}</b></div>
          <div><span>{tr(lang, 'tax')} · 18%</span><b>{money(Math.round(total * 18 / 118), lang)}</b></div>
          <div className="grand"><span>{tr(lang, 'total')}</span><strong>{money(total, lang)}</strong></div>
        </div>
        <div className="checkout-actions">
          <button className="hold" disabled={!cart.length} onClick={hold}><Pause />{tr(lang, 'hold')}</button>
          <button className="pay" disabled={!cart.length || register?.status !== 'open'} onClick={() => setPaymentOpen(true)}>
            <WalletCards /><span>{tr(lang, 'pay')}<small>Nağd · Kart · Qarışıq</small></span><b>{money(total, lang)}</b>
          </button>
        </div>
      </aside>
      {paymentOpen && <PaymentModal lang={lang} totalMinor={total} onClose={() => setPaymentOpen(false)} onComplete={complete} />}
    </div>
  );
}


function PaymentModal({ lang, totalMinor, onClose, onComplete }: { lang: Lang; totalMinor: number; onClose: () => void; onComplete: (payment: Payment) => void }) {
  const [method, setMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [tendered, setTendered] = useState((totalMinor / 100).toFixed(2));
  const [cashPart, setCashPart] = useState((totalMinor / 200).toFixed(2));
  const [terminalRef, setTerminalRef] = useState('');
  const tenderedMinor = method === 'card' ? totalMinor : parseMoneyInput(tendered);
  const change = cashChange(totalMinor, tenderedMinor);
  const cashMinor = parseMoneyInput(cashPart);
  const cardMinor = Math.max(0, totalMinor - cashMinor);
  const valid = method === 'card' || method === 'mixed' ? method === 'card' || (cashMinor > 0 && cardMinor >= 0) : tenderedMinor >= totalMinor;
  return <Modal title={tr(lang, 'pay')} subtitle={`${tr(lang, 'total')} · ${money(totalMinor, lang)}`} onClose={onClose} wide><div className="payment-layout"><section><div className="payment-methods"><button className={method === 'cash' ? 'active' : ''} onClick={() => setMethod('cash')}><CircleDollarSign /><b>{tr(lang, 'cash')}</b><small>AZN</small></button><button className={method === 'card' ? 'active' : ''} onClick={() => setMethod('card')}><CreditCard /><b>{tr(lang, 'card')}</b><small>POS terminal</small></button><button className={method === 'mixed' ? 'active' : ''} onClick={() => setMethod('mixed')}><WalletCards /><b>{tr(lang, 'mixed')}</b><small>Nağd + kart</small></button></div>{method === 'cash' && <><label className="money-field">{tr(lang, 'tendered')}<span><input autoFocus value={tendered} onChange={(event) => setTendered(event.target.value)} inputMode="decimal" /> AZN</span></label><div className="quick-cash">{[totalMinor, Math.ceil(totalMinor / 500) * 500, Math.ceil(totalMinor / 1000) * 1000, 5000, 10000].filter((value, index, rows) => rows.indexOf(value) === index).map((value) => <button key={value} onClick={() => setTendered((value / 100).toFixed(2))}>{money(value, lang)}</button>)}</div></>}{method === 'mixed' && <div className="split-fields"><label>{tr(lang, 'cash')}<input value={cashPart} onChange={(event) => setCashPart(event.target.value)} inputMode="decimal" /></label><label>{tr(lang, 'card')}<input value={(cardMinor / 100).toFixed(2)} disabled /></label></div>}{(method === 'card' || method === 'mixed') && <label className="money-field">Terminal ref (manual)<span><input value={terminalRef} onChange={(e) => setTerminalRef(e.target.value)} placeholder="RRN / auth" /></span></label>}<div className="payment-summary"><div><span>{tr(lang, 'total')}</span><b>{money(totalMinor, lang)}</b></div><div><span>{tr(lang, 'tendered')}</span><b>{money(method === 'mixed' ? cashMinor + cardMinor : tenderedMinor, lang)}</b></div><div className="change"><span>{tr(lang, 'change')}</span><strong>{money(method === 'cash' ? change : 0, lang)}</strong></div></div></section><aside className="receipt-preview"><div className="receipt-paper"><p>MARKETPOS SUPERMARKET</p><small>{new Date().toLocaleString('az-AZ')}</small><hr /><span>YEKUN <b>{money(totalMinor, lang)}</b></span><span>{tr(lang, method).toLocaleUpperCase('az')} <b>{money(method === 'cash' ? tenderedMinor : totalMinor, lang)}</b></span><span>QALIQ <b>{money(method === 'cash' ? change : 0, lang)}</b></span><hr /><small>Alış-verişiniz üçün təşəkkür edirik</small></div></aside></div><button className="modal-primary payment-complete" disabled={!valid} onClick={() => onComplete({ method, amountMinor: totalMinor, tenderedMinor: method === 'cash' ? tenderedMinor : totalMinor, changeMinor: method === 'cash' ? change : 0, cashMinor: method === 'mixed' ? cashMinor : undefined, cardMinor: method === 'mixed' ? cardMinor : method === 'card' ? totalMinor : undefined, terminalRef: terminalRef || undefined })}><Check />{tr(lang, 'completePayment')}<strong>{method === 'cash' ? `${tr(lang, 'change')}: ${money(change, lang)}` : money(totalMinor, lang)}</strong></button></Modal>;
}

function InventoryPage({ state, lang, canEdit, onDenied, onAdd, onEdit, onTransfer, onWaste }: { state: PersistedState; lang: Lang; canEdit: boolean; onDenied: () => void; onAdd: () => void; onEdit: (product: Product) => void; onTransfer: () => void; onWaste: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const categories = useMemo(() => [...new Set(state.products.map((product) => product.category))], [state.products]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of state.products) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    return counts;
  }, [state.products]);
  const rows = useMemo(
    () => state.products.filter((product) => {
      if (category !== 'all' && product.category !== category) return false;
      if (!query) return true;
      return product.barcode.includes(query)
        || product.sku.toLowerCase().includes(query.toLowerCase())
        || product.name[lang].toLowerCase().includes(query.toLowerCase());
    }),
    [state.products, query, lang, category],
  );
  const value = useMemo(
    () => state.products.reduce((sum, product) => sum + product.costMinor * stockOf(product), 0),
    [state.products],
  );
  const activeCount = useMemo(() => state.products.filter((p) => p.active).length, [state.products]);
  const lowCount = useMemo(() => state.products.filter((p) => stockOf(p) <= p.minStock).length, [state.products]);

  return (
    <div className="module-page inventory-page">
      <section className="kpi-grid three">
        <Kpi icon={Boxes} label={tr(lang, 'product')} value={String(state.products.length)} note={`${activeCount} ${tr(lang, 'active').toLowerCase()}`} tone="green" />
        <Kpi icon={TriangleAlert} label={tr(lang, 'low')} value={String(lowCount)} note="Minimum səviyyə" tone="amber" />
        <Kpi icon={BadgeDollarSign} label={tr(lang, 'inventory')} value={money(value, lang)} note="Maya dəyəri" tone="blue" />
      </section>
      <section className="data-card inventory-card-shell">
        <div className="data-title">
          <div>
            <h2>{tr(lang, 'inventory')}</h2>
          </div>
          <div className="data-actions">
            <label className="table-search">
              <Search />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr(lang, 'search')} />
            </label>
            <button type="button" aria-disabled={!canEdit || undefined} onClick={canEdit ? onTransfer : onDenied}><ArrowRightLeft />{tr(lang, 'transfer')}</button>
            <button type="button" aria-disabled={!canEdit || undefined} onClick={canEdit ? onWaste : onDenied}><Trash2 />Silinmə</button>
            <button type="button" className="primary-action" aria-disabled={!canEdit || undefined} onClick={canEdit ? onAdd : onDenied}><PackagePlus />{tr(lang, 'addProduct')}</button>
          </div>
        </div>
        <div className="inventory-catalog-layout">
          <aside className="catalog-aisles inventory-aisles">
            <h2>{tr(lang, 'catalogAisles')}</h2>
            <CatalogAisleNav
              lang={lang}
              categories={categories}
              counts={categoryCounts}
              total={state.products.length}
              value={category}
              onChange={setCategory}
              layout="rail"
            />
          </aside>
          <InventoryProductGrid products={rows} lang={lang} money={money} canEdit onEdit={canEdit ? onEdit : onDenied} />
        </div>
      </section>
    </div>
  );
}

function WarehousesPage({ state, lang, onAdd, onTransfer }: { state: PersistedState; lang: Lang; onAdd: () => void; onTransfer: () => void }) {
  return <div className="module-page"><section className="page-intro"><div><p>WAREHOUSE NETWORK</p><h2>{tr(lang, 'warehouses')}</h2><span>{state.warehouses.length} aktiv saxlama nöqtəsi</span></div><div><button onClick={onTransfer}><ArrowRightLeft />{tr(lang, 'transfer')}</button><button className="primary-action" onClick={onAdd}><Plus />{tr(lang, 'addWarehouse')}</button></div></section><div className="warehouse-grid">{state.warehouses.map((warehouse) => { const units = state.products.reduce((sum, product) => sum + (product.warehouseStock[warehouse.id] ?? 0), 0); const value = state.products.reduce((sum, product) => sum + (product.warehouseStock[warehouse.id] ?? 0) * product.costMinor, 0); return <article className="warehouse-card" key={warehouse.id}><header><span><WarehouseIcon /></span><div><small>{warehouse.code}</small><h3>{warehouse.name}</h3></div><em className="pill ok">{tr(lang, 'active')}</em></header><p>{warehouse.address}</p><div className="warehouse-stats"><div><small>SKU</small><b>{state.products.filter((product) => (product.warehouseStock[warehouse.id] ?? 0) > 0).length}</b></div><div><small>{tr(lang, 'stock')}</small><b>{units}</b></div><div><small>Dəyər</small><b>{money(value, lang)}</b></div></div><footer><span><UserCog />{warehouse.manager}</span><button onClick={onTransfer}>{tr(lang, 'transfer')}<ChevronRight /></button></footer></article>; })}</div></div>;
}

function PurchasesPage({ state, lang, onAdd, onReceive }: { state: PersistedState; lang: Lang; onAdd: () => void; onReceive: (order: PurchaseOrder) => void }) {
  const products = new Map(state.products.map((product) => [product.id, product]));
  const pending = state.purchaseOrders.filter((row) => row.status === 'ordered').length;
  return (
    <div className="module-page purchases-page">
      <section className="page-intro">
        <div>
          <h2>{tr(lang, 'purchases')}</h2>
          <span>{pending} {tr(lang, 'ordered').toLowerCase()}</span>
        </div>
        <button className="primary-action" onClick={onAdd}><Plus />{tr(lang, 'createOrder')}</button>
      </section>
      <div className="po-grid">
        {state.purchaseOrders.map((order) => {
          const warehouse = state.warehouses.find((row) => row.id === order.warehouseId);
          const units = order.lines.reduce((sum, line) => sum + line.qty, 0);
          const received = order.status === 'received';
          return (
            <article className={received ? 'po-card received' : 'po-card'} key={order.id}>
              <header className="po-head">
                <div className="po-title">
                  <h3>{order.supplier}</h3>
                  <small>{order.id}</small>
                </div>
                <em className={received ? 'pill ok' : 'pill info'}>{received ? tr(lang, 'received') : tr(lang, 'ordered')}</em>
              </header>
              <div className="po-meta">
                <span><small>{tr(lang, 'expectedDate')}</small><strong>{new Date(order.expectedAt).toLocaleDateString()}</strong></span>
                <span><small>Depo</small><strong>{warehouse?.code ?? '—'}</strong></span>
                <span><small>SKU</small><strong>{order.lines.length}</strong></span>
                <span><small>{tr(lang, 'stock')}</small><strong>{units}</strong></span>
              </div>
              <ul className="po-lines">
                {order.lines.map((line) => (
                  <li key={line.productId}>
                    <span>{products.get(line.productId)?.name[lang] ?? line.productId}</span>
                    <b>+{line.qty}</b>
                  </li>
                ))}
              </ul>
              <footer className="po-foot">
                <button type="button" className={received ? 'po-receive done' : 'po-receive'} disabled={received} onClick={() => onReceive(order)}>
                  {received ? <Check /> : <PackageCheck />}
                  {received ? tr(lang, 'received') : tr(lang, 'receive')}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ReturnsPage({ state, lang, onRefund }: { state: PersistedState; lang: Lang; onRefund: (sale: Sale) => void }) {
  const [query, setQuery] = useState(''); const products = new Map(state.products.map((product) => [product.id, product]));
  const rows = state.sales.filter((sale) => !query || sale.receiptNo.toLowerCase().includes(query.toLowerCase()));
  return <div className="module-page"><section className="return-search"><RotateCcw /><div><p>RETURNS DESK</p><h2>{tr(lang, 'returns')}</h2></div><label><ReceiptText /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Qəbz nömrəsi..." /></label></section><div className="receipt-list">{rows.map((sale) => <article key={sale.id}><div className="receipt-badge"><ReceiptText /></div><div className="receipt-main"><small>{new Date(sale.createdAt).toLocaleString()}</small><h3>{sale.receiptNo}</h3><p>{sale.items.map((line) => `${products.get(line.productId)?.name[lang]} ×${line.qty}`).join(' · ')}</p></div><strong>{money(sale.totalMinor, lang)}</strong><span className="payment-chip">{sale.payment.method === 'cash' ? <CircleDollarSign /> : <WalletCards />}{tr(lang, sale.payment.method)}</span><button disabled={sale.refunded} onClick={() => onRefund(sale)}>{sale.refunded ? <Check /> : <RotateCcw />}{sale.refunded ? tr(lang, 'refunded') : tr(lang, 'refund')}</button></article>)}</div></div>;
}

function StaffPage({ staff, lang, onAdd }: { staff: StaffProfile[]; lang: Lang; onAdd: () => void }) {
  const permissionText: Record<Role, string> = { manager: 'Bütün modullar, ayarlar, işçilər və hesabatlar', head_cashier: 'Satış, qaytarma, hesabat və kassa növbələri', cashier: 'Satış və şəxsi kassa növbəsi', warehouse: 'Məhsul, depo və alış sifarişləri' };
  return <div className="module-page"><section className="page-intro"><div><p>ROLE-BASED ACCESS</p><h2>{tr(lang, 'staff')}</h2><span>{staff.filter((row) => row.active).length} {tr(lang, 'active').toLowerCase()}</span></div><button className="primary-action" onClick={onAdd}><Plus />{tr(lang, 'addStaff')}</button></section><div className="staff-grid">{staff.map((user) => <article key={user.id}><RoleAvatar role={user.role} name={user.name} /><div><h3>{user.name}</h3><em>{roleLabel(user.role, lang)}</em><p>{permissionText[user.role]}</p><div className="permission-pills">{ROLE_VIEWS[user.role].slice(0, 5).map((view) => <span key={view}>{viewLabel(view, lang)}</span>)}</div></div><b className={user.active ? 'pill ok' : 'pill'}>{user.active ? tr(lang, 'active') : 'Passiv'}</b></article>)}</div></div>;
}

function MobilePage({ state, staff, lang, cloudConnected }: { state: PersistedState; staff: StaffProfile[]; lang: Lang; cloudConnected: boolean }) {
  const sales = state.sales.filter((sale) => !sale.refunded); const revenue = sales.reduce((sum, sale) => sum + sale.totalMinor, 0); const low = state.products.filter((product) => stockOf(product) <= product.minStock);
  return <div className="module-page mobile-module"><section className="page-intro"><div><p>POSSISTEM.AZ / MARKETPOS</p><h2>{tr(lang, 'ownerLive')}</h2><span>{tr(lang, 'remoteNote')}</span></div><div className={`connection ${cloudConnected ? 'online' : ''}`}>{cloudConnected ? <Cloud /> : <CloudOff />}{cloudConnected ? tr(lang, 'connected') : tr(lang, 'offline')}</div></section><section className="mobile-showcase"><div className="phone-frame"><div className="phone-notch" /><header><div><small>MARKETPOS OWNER</small><h3>{state.settings.storeName}</h3></div><span className={cloudConnected ? 'online-dot' : ''} /></header><div className="phone-content"><p>Bugün · Canlı baxış</p><article className="phone-revenue"><small>{tr(lang, 'todaySales')}</small><strong>{money(revenue, lang)}</strong><span>{sales.length} çek</span></article><div className="phone-kpis"><span><small>{tr(lang, 'transactions')}</small><b>{sales.length}</b></span><span><small>{tr(lang, 'openRegisters')}</small><b>{state.registers.filter((row) => row.status === 'open').length}</b></span><span><small>{tr(lang, 'low')}</small><b>{low.length}</b></span><span><small>{tr(lang, 'staff')}</small><b>{staff.filter((row) => row.active).length}</b></span></div><h4>Kassalar</h4>{state.registers.map((register) => <div className="phone-row" key={register.id}><span className={register.status === 'open' ? 'online-dot' : ''} /><p><b>{register.name}</b><small>{staff.find((row) => row.id === register.operatorId)?.name ?? 'Bağlı'}</small></p><strong>{money(state.sales.filter((sale) => sale.registerId === register.id && !sale.refunded).reduce((sum, sale) => sum + sale.totalMinor, 0), lang)}</strong></div>)}<h4>Kritik stok</h4>{low.slice(0, 3).map((product) => <div className="phone-row" key={product.id}><ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} /><p><b>{product.name[lang]}</b><small>{product.sku}</small></p><strong className="danger">{stockOf(product)}</strong></div>)}</div><nav><span><Activity />Panel</span><span><ReceiptText />Satış</span><span><Boxes />Stok</span><span><Settings />Ayar</span></nav></div><div className="mobile-copy"><span><Smartphone /></span><h3>Mağaza cibinizdə</h3><p>Satış məbləği, kassa vəziyyəti, kassir performansı və kritik stoklar sahibkar hesabında telefon ölçüsünə uyğun göstərilir.</p><ul><li><Check />30 saniyəlik canlı sinxron</li><li><Check />POS offline olsa növbə saxlanılır</li><li><Check />Hər müştəri üçün ayrı tenant məlumatı</li><li><Check />AZ / RU / EN interfeys</li></ul><div className="portal-address"><Cloud /><span>Sahibkar ünvanı<b>possistem.az/marketpos</b></span></div></div></section></div>;
}
function SettingsPage({ state, session, lang, coreReady, notify, onSettings }: { state: PersistedState; session: SessionUser; lang: Lang; coreReady: boolean; notify: (text: string) => void; onSettings: (settings: StoreSettings) => void }) {
  const [draft, setDraft] = useState(state.settings); const [display, setDisplay] = useState<{ prefs: { mode: 'fullscreen' | 'windowed'; width: number; height: number; zoomFactor: number }; presets: Array<{ id: string; label: string; mode: 'fullscreen' | 'windowed'; width: number; height: number }> } | null>(null);
  const [activation, setActivation] = useState<ActivationStatus | null>(null); const [activationKey, setActivationKey] = useState(''); const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' }); const [info, setInfo] = useState<{ version: string; updateUrl: string; controlUrl: string; packaged: boolean } | null>(null); const [message, setMessage] = useState(''); const [checkingUpdate, setCheckingUpdate] = useState(false);
  useEffect(() => { if (!window.marketSystem) return; void window.marketSystem.display.get().then(setDisplay); void window.marketSystem.activation.status().then(setActivation); void window.marketSystem.update.status().then(setUpdate); void window.marketSystem.app.info().then(setInfo); return window.marketSystem.update.onChanged(setUpdate); }, []);
  useEffect(() => {
    if (activation?.mode !== 'active') return;
    const branded: StoreSettings = {
      ...state.settings,
      storeName: activation.branding?.productName || activation.customerName,
      legalName: activation.customer?.legalName || activation.customerName,
      address: activation.customer?.address || state.settings.address,
      phone: activation.customer?.phone || state.settings.phone,
      taxId: activation.customer?.taxId || state.settings.taxId,
      logoUrl: activation.branding?.logoDataUrl || state.settings.logoUrl,
    };
    setDraft(branded);
    onSettings(branded);
    // A server device id changes only after a successful activation/re-activation.
  }, [activation?.serverDeviceId]);
  const chooseLogo = async () => { const url = await window.marketSystem?.image.pick(session.sessionToken); if (url) setDraft((value) => ({ ...value, logoUrl: url })); };
  const checkUpdate = async () => { if (checkingUpdate) return; setCheckingUpdate(true); setMessage(''); try { if (!window.marketSystem) { setUpdate({ state: 'disabled', message: 'Yeniləmə masaüstü Setup versiyasında işləyir' }); return; } setUpdate({ state: 'checking' }); const status = await window.marketSystem.update.check(session.sessionToken); setUpdate(status); } catch { setUpdate({ state: 'error', message: 'Yeniləmə serverinə qoşulmaq mümkün olmadı' }); setMessage('İnternet bağlantısını yoxlayın və yenidən cəhd edin'); } finally { setCheckingUpdate(false); } };
  const updateText = update.state === 'idle' ? 'Yoxlanılmayıb' : update.state === 'checking' ? 'Yoxlanılır...' : update.state === 'not_available' ? 'Son versiyadır' : update.state === 'available' ? `v${update.version} tapıldı` : update.state === 'downloading' ? `${update.percent}% yüklənir` : update.state === 'downloaded' ? `v${update.version} hazırdır` : update.message;
  return (
    <div className="module-page settings-grid">
      <HardwareSettingsCard session={session} lang={lang} notify={notify} />
      <section className="panel-card settings-card">
        <div className="panel-title">
          <h3>Mağaza məlumatları</h3>
          <Building2 />
        </div>
        {!coreReady && <p className="hint">Core offline — local settings only.</p>}
        <div className="logo-picker">
          <button type="button" onClick={() => void chooseLogo()}>
            {draft.logoUrl ? <img src={draft.logoUrl} alt="Logo" /> : <ImagePlus />}
            <span>{tr(lang, 'chooseImage')}</span>
          </button>
          <p>Logo qəbz, giriş, telefon paneli və hesabatlarda görünəcək.</p>
        </div>
        <div className="form-grid">
          <Field label="Mağaza adı" value={draft.storeName} onChange={(value) => setDraft({ ...draft, storeName: value })} />
          <Field label="Hüquqi ad" value={draft.legalName} onChange={(value) => setDraft({ ...draft, legalName: value })} />
          <Field label="VÖEN" value={draft.taxId} onChange={(value) => setDraft({ ...draft, taxId: value })} />
          <Field label="Telefon" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} />
          <Field label={tr(lang, 'address')} value={draft.address} onChange={(value) => setDraft({ ...draft, address: value })} wide />
          <Field label={tr(lang, 'terminal')} value={draft.terminalName} onChange={(value) => setDraft({ ...draft, terminalName: value })} />
        </div>
        <button type="button" className="modal-primary" onClick={() => { onSettings(draft); setMessage('Mağaza məlumatları yadda saxlanıldı'); }}>
          <Check />{tr(lang, 'save')}
        </button>
      </section>

      <section className="panel-card settings-card">
        <div className="panel-title">
          <h3>{tr(lang, 'update')}</h3>
          <RefreshCw className={checkingUpdate ? 'spin' : ''} />
        </div>
        <div className={`update-box ${update.state}`}>
          <span><Download /></span>
          <div>
            <small>{tr(lang, 'version')}</small>
            <b>{info?.version ?? '1.0.0'} · {updateText}</b>
            <p>{info?.updateUrl ?? 'https://possistem.az/marketpos/updates/'}</p>
          </div>
        </div>
        {update.state === 'downloading' && (
          <div className="progress"><span style={{ width: `${update.percent}%` }} /></div>
        )}
        <div className="button-row">
          <button type="button" disabled={checkingUpdate || update.state === 'downloading'} onClick={() => void checkUpdate()}>
            <RefreshCw className={checkingUpdate ? 'spin' : ''} />
            {checkingUpdate ? 'Yoxlanılır...' : tr(lang, 'checkUpdate')}
          </button>
          {update.state === 'downloaded' && (
            <button type="button" className="primary-action" onClick={() => void window.marketSystem?.update.install(session.sessionToken)}>
              {tr(lang, 'installUpdate')}
            </button>
          )}
        </div>
        <p className="hint">Setup ilə qurulan proqram hər 30 dəqiqədə serveri yoxlayır, yeniləməni avtomatik yükləyir və təhlükəsiz çıxışda quraşdırır.</p>
      </section>

      <section className="panel-card settings-card">
        <div className="panel-title">
          <h3>{tr(lang, 'activation')}</h3>
          <ShieldCheck />
        </div>
        <div className={`activation-box ${activation?.mode ?? 'trial'}`}>
          <ShieldCheck />
          <div>
            <small>{activation?.mode === 'active' ? tr(lang, 'active') : activation?.mode === 'expired' ? tr(lang, 'expired') : activation?.mode === 'revoked' ? tr(lang, 'revoked') : activation?.mode === 'unlicensed' ? tr(lang, 'unlicensed') : tr(lang, 'trial')}</small>
            <b>{activation?.customerName ?? state.settings.storeName}</b>
            <p>Cihaz: {activation?.deviceId.slice(0, 16) ?? '...'}</p>
            <p>Bitmə: {activation ? new Date(activation.validUntil).toLocaleDateString() : '...'}</p>
          </div>
        </div>
        <label className="activation-input">
          Aktivasiya açarı
          <input value={activationKey} onChange={(event) => setActivationKey(event.target.value)} placeholder="MPOS-XXXX-XXXX-XXXX" />
        </label>
        <button
          type="button"
          className="modal-primary"
          onClick={() => void window.marketSystem?.activation.activate(session.sessionToken, activationKey).then((status) => {
            setActivation(status);
            setMessage('Aktivasiya tamamlandı');
          }).catch((error: Error) => setMessage(error.message))}
        >
          <KeyRound />Aktivləşdir
        </button>
        <p className="hint">Açar cihazla bağlanır və serverin Ed25519 imzası yoxlanmadan qəbul edilmir.</p>
      </section>

      <section className="panel-card settings-card">
        <div className="panel-title">
          <h3>{tr(lang, 'display')}</h3>
          <Monitor />
        </div>
        <div className="preset-grid">
          {display?.presets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={display.prefs.mode === preset.mode && (preset.mode === 'fullscreen' || display.prefs.width === preset.width) ? 'active' : ''}
              onClick={() => void window.marketSystem?.display.set(session.sessionToken, {
                mode: preset.mode,
                width: preset.width || 1500,
                height: preset.height || 940,
                zoomFactor: display.prefs.zoomFactor,
              }).then((prefs) => setDisplay({ ...display, prefs })).catch(() => setMessage('Ekran ölçüsü tətbiq olunmadı'))}
            >
              <Monitor />
              <b>{preset.label}</b>
              <small>{preset.mode === 'fullscreen' ? 'F11' : `${preset.width}×${preset.height}`}</small>
            </button>
          ))}
        </div>
        <div className="zoom-row">
          <span>UI ölçüsü</span>
          {[0.8, 0.9, 1, 1.1, 1.2].map((zoom) => (
            <button
              type="button"
              key={zoom}
              className={display?.prefs.zoomFactor === zoom ? 'active' : ''}
              onClick={() => display && void window.marketSystem?.display.set(session.sessionToken, { ...display.prefs, zoomFactor: zoom }).then((prefs) => setDisplay({ ...display, prefs })).catch(() => setMessage('UI ölçüsü tətbiq olunmadı'))}
            >
              {Math.round(zoom * 100)}%
            </button>
          ))}
        </div>
        <p className="hint">F11 düyməsi istənilən ekranda tam ekranı açıb-bağlayır. 1024×768 terminallar ayrıca optimallaşdırılıb.</p>
      </section>

      {message && (
        <div className="settings-message">
          <Check />{message}
          <button type="button" onClick={() => setMessage('')}><X /></button>
        </div>
      )}
    </div>
  );
}

