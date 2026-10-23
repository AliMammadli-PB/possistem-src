import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ApiError,
  adjustMarketStock,
  createMarketProduct,
  deleteMarketProduct,
  formatMoney,
  marketOverview,
  marketProductPhotoUrl,
  ownerMarketCommands,
  ownerMarketInventory,
  sendMarketCommand,
  updateMarketProduct,
  uploadMarketProductImage,
  type LicenseInfo,
  type MarketInventoryPage,
  type MarketOverviewPayload,
  type MarketProduct,
  type MarketRegister,
  type MarketWarehouse,
} from '../api';
import { usePolling } from '../hooks/usePolling';
import { MarketBranchStock } from './MarketBranchStock';
import { prepareCatalogPhoto } from '../lib/catalog-photo';
import { Field, PasswordField } from '../ui/forms';
import { Icon } from '../ui/Icon';
import { Alert, Button, EmptyState, IconButton } from '../ui/primitives';
import { Modal, useToast } from '../ui/overlays';

const SHOP_SECTIONS = [
  { id: 'shop-home', label: 'İcmal' },
  { id: 'shop-sales', label: 'Canlı satış' },
  { id: 'shop-mix', label: 'Ödəniş' },
  { id: 'shop-analytics', label: 'Analiz' },
  { id: 'shop-recent', label: 'Son hərəkət' },
  { id: 'shop-inventory', label: 'Stok və məhsullar' },
] as const;

function stockBand(stock: number, min: number): 'danger' | 'warn' | 'ok' {
  const ratio = stock / Math.max(1, min);
  if (stock <= 0 || ratio < 0.55) return 'danger';
  if (ratio < 1.05) return 'warn';
  return 'ok';
}

function stockLabel(band: 'danger' | 'warn' | 'ok'): string {
  if (band === 'danger') return 'Kritik';
  if (band === 'warn') return 'Az qalıb';
  return 'Normal';
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return 'Hələ yox';
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 1) return 'İndicə';
  if (minutes < 60) return `${minutes} dəq əvvəl`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  return new Date(value).toLocaleDateString('az-AZ');
}

function salesWarehouse(warehouses: MarketWarehouse[]): MarketWarehouse {
  return (
    warehouses.find(
      (warehouse) =>
        warehouse.id === 'wh-sales' ||
        warehouse.code === 'ZAL-01' ||
        /satış|zal|sales/i.test(String(warehouse.name ?? warehouse.code ?? '')),
    ) ??
    warehouses[0] ?? { id: 'wh-sales', code: 'ZAL-01', name: 'Satış zalı' }
  );
}

function warehouseLabel(warehouse: MarketWarehouse): string {
  return String(warehouse.name || warehouse.code || warehouse.id);
}

function commandStatus(
  status: string,
  error?: string | null,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' } {
  if (status === 'done' && error) return { label: 'Çap olmadı', tone: 'warning' };
  if (status === 'done') return { label: 'Çap olundu', tone: 'success' };
  if (status === 'running') return { label: 'Kassada', tone: 'info' };
  if (status === 'pending') return { label: 'Gözləyir', tone: 'warning' };
  if (status === 'failed') return { label: 'Xəta', tone: 'danger' };
  return { label: status, tone: 'neutral' };
}

function minorFromManat(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function formatLcd(minor = 0): string {
  const amount = Math.max(0, Math.trunc(minor));
  const manat = Math.floor(amount / 100).toLocaleString('az-AZ');
  const qepik = String(amount % 100).padStart(2, '0');
  return `${manat},${qepik}`;
}

function productLetter(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase('az') || 'M';
}

const emptyForm = {
  id: '',
  name: '',
  sku: '',
  barcode: '',
  price: '',
  cost: '',
  qty: '',
  minStock: '0',
};

type FileInputRef = { current: HTMLInputElement | null };

function TillDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = `drawer-${title.replace(/\s+/g, '-').toLowerCase()}`;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="till-layer">
      <button type="button" className="till-scrim" aria-label="Bağla" onClick={onClose} />
      <div className="till-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="till-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="x" label="Bağla" onClick={onClose} />
        </header>
        <div className="till-drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function MarketOwnerPanel({
  customerName,
  license,
  market: marketProp,
  refreshing,
  onReload,
}: {
  customerName: string;
  license: LicenseInfo | null;
  market: MarketOverviewPayload['market'] | null;
  refreshing: boolean;
  onReload: () => void;
}) {
  const { show } = useToast();
  const live = usePolling(marketOverview, 4_000);
  const market = live.data?.market ?? marketProp;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'instock' | 'out' | 'critical'>('all');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [deltaInput, setDeltaInput] = useState('10');
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [zOpen, setZOpen] = useState(false);
  const [zCash, setZCash] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removePassword, setRemovePassword] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [tick, setTick] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('shop-home');
  const [progress, setProgress] = useState(0);
  const lastCount = useRef<number | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const inventoryLoader = useCallback(
    () => ownerMarketInventory({ q: query, filter, page, limit: 50 }),
    [query, filter, page],
  );
  const inventory = usePolling(inventoryLoader, 8_000);
  const commands = usePolling(ownerMarketCommands, 5_000);

  const pageData: MarketInventoryPage | null = inventory.data;
  const warehouses = pageData?.warehouses?.length ? pageData.warehouses : market?.warehouses ?? [];
  const floor = useMemo(() => salesWarehouse(warehouses), [warehouses]);
  const products = pageData?.products ?? market?.products ?? [];
  const totals = pageData?.totals;
  const connected = Boolean(market?.connected);
  const canCommand = connected;
  const selected = products.find((product) => product.id === selectedId) ?? null;
  const lastCommand = commands.data?.commands?.[0] ?? null;
  const registers: MarketRegister[] = market?.registers ?? [];
  const daily = market?.dailySalesMinor ?? 0;
  const list = products.filter((product) => product.active !== false);

  useEffect(() => {
    if (lastCount.current != null && lastCount.current !== daily) {
      setTick(true);
      const timer = window.setTimeout(() => setTick(false), 320);
      lastCount.current = daily;
      return () => window.clearTimeout(timer);
    }
    lastCount.current = daily;
    return undefined;
  }, [daily]);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setProgress(max > 0 ? (doc.scrollTop / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const nodes = SHOP_SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (node): node is HTMLElement => Boolean(node),
    );
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-42% 0px -48% 0px', threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const fillForm = (product: MarketProduct) => {
    setSelectedId(product.id);
    setPhotoFile(null);
    setForm({
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? '',
      price: (Number(product.priceMinor || 0) / 100).toFixed(2),
      cost: (Number(product.costMinor || 0) / 100).toFixed(2),
      qty: String(product.warehouseStock?.[floor.id] ?? product.stock ?? 0),
      minStock: String(product.minStock ?? 0),
    });
  };

  const startCreate = () => {
    setSelectedId('new');
    setPhotoFile(null);
    setForm(emptyForm);
  };

  const closeProduct = useCallback(() => {
    setSelectedId(null);
    setForm(emptyForm);
    setPhotoFile(null);
  }, []);

  const closeRemove = useCallback(() => {
    if (busy) return;
    setRemoveId(null);
    setRemovePassword('');
    setRemoveError('');
  }, [busy]);

  const closeZ = useCallback(() => {
    if (busy) return;
    setZOpen(false);
  }, [busy]);

  const submitProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      show({ tone: 'warning', title: 'Məhsul adı lazımdır' });
      return;
    }
    setBusy(true);
    const sku = form.sku.trim() || `SKU-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const stockQty = Math.max(0, Math.trunc(Number(form.qty) || 0));
    const payload = {
      name: form.name.trim(),
      sku,
      barcode: form.barcode.trim(),
      priceMinor: minorFromManat(form.price),
      costMinor: minorFromManat(form.cost),
      minStock: Math.max(0, Math.trunc(Number(form.minStock) || 0)),
      active: true,
      ...(form.id ? {} : { warehouseStock: { [floor.id || 'wh-sales']: stockQty } }),
    };
    try {
      let productId = form.id;
      if (form.id) await updateMarketProduct(form.id, payload);
      else {
        const created = await createMarketProduct(payload);
        productId = String(created.product?.id ?? '');
      }
      if (photoFile && productId) {
        const prepared = await prepareCatalogPhoto(photoFile);
        await uploadMarketProductImage(productId, prepared);
        setPhotoFile(null);
      }
      if (productId) setForm((current) => ({ ...current, id: productId }));
      else if (!form.id) setForm(emptyForm);
      setSelectedId(productId || null);
      show({
        tone: 'success',
        title: form.id ? 'Məhsul yeniləndi' : 'Məhsul əlavə olundu',
        message: photoFile
          ? 'Şəkil kassaya düşəcək — oflaynda da qalacaq.'
          : form.id
            ? 'Ad və qiymət kassaya düşəcək.'
            : `Miqdar ${warehouseLabel(floor)} anbarına yazıldı — kassada görünəcək.`,
      });
      void inventory.reload();
      void live.reload();
      onReload();
    } catch (cause) {
      show({
        tone: 'danger',
        title: 'Məhsul saxlanılmadı',
        message: cause instanceof ApiError ? cause.message : 'Yenidən cəhd edin.',
      });
    } finally {
      setBusy(false);
    }
  };

  const changeStock = async (product: MarketProduct, warehouseId: string, delta: number) => {
    if (!delta) return;
    const key = `${product.id}:${warehouseId}`;
    setAdjusting(key);
    try {
      const result = await adjustMarketStock(product.id, { warehouseId, delta });
      show({
        tone: 'success',
        title: delta > 0 ? `+${result.applied} əlavə olundu` : `${result.applied} azaldıldı`,
        message: `Yeni qalıq: ${result.qty}`,
      });
      void inventory.reload();
      onReload();
    } catch (cause) {
      show({
        tone: 'danger',
        title: 'Stok dəyişmədi',
        message: cause instanceof ApiError ? cause.message : 'Yenidən cəhd edin.',
      });
    } finally {
      setAdjusting(null);
    }
  };

  const sendReport = async (kind: 'x_report' | 'z_report') => {
    if (!canCommand) {
      show({ tone: 'warning', title: 'Kassa onlayn deyil', message: 'X və Z yalnız ürək döyüntüsü olanda gedir.' });
      return;
    }
    setBusy(true);
    try {
      await sendMarketCommand({
        kind,
        actualCashMinor: kind === 'z_report' ? minorFromManat(zCash) : undefined,
      });
      setZOpen(false);
      setZCash('');
      show({
        tone: 'success',
        title: kind === 'z_report' ? 'Z əmri göndərildi' : 'X əmri göndərildi',
        message: 'Onlayn kassa hesabatı çap edəcək.',
      });
      void commands.reload();
    } catch (cause) {
      show({
        tone: 'danger',
        title: 'Əmr göndərilmədi',
        message: cause instanceof ApiError ? cause.message : 'Yenidən cəhd edin.',
      });
    } finally {
      setBusy(false);
    }
  };

  const removeProduct = async () => {
    if (!removeId) return;
    if (!removePassword.trim()) {
      setRemoveError('Giriş şifrənizi yazın');
      return;
    }
    setBusy(true);
    try {
      await deleteMarketProduct(removeId, removePassword);
      if (form.id === removeId) setForm(emptyForm);
      if (selectedId === removeId) setSelectedId(null);
      setRemoveId(null);
      setRemovePassword('');
      setRemoveError('');
      show({ tone: 'success', title: 'Məhsul silindi' });
      void inventory.reload();
      void live.reload();
      onReload();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'CURRENT_PASSWORD_INVALID') {
        setRemoveError('Şifrə düzgün deyil');
        return;
      }
      show({
        tone: 'danger',
        title: 'Silinmədi',
        message: cause instanceof ApiError ? cause.message : 'Yenidən cəhd edin.',
      });
    } finally {
      setBusy(false);
    }
  };

  const savePhoto = async (product: MarketProduct, file: File) => {
    setPhotoFile(file);
    setBusy(true);
    try {
      const prepared = await prepareCatalogPhoto(file);
      setPhotoFile(prepared);
      await uploadMarketProductImage(product.id, prepared);
      show({ tone: 'success', title: 'Şəkil kassaya göndərildi', message: 'Kassa 2-3 saniyəyə şəkli alacaq.' });
      void inventory.reload();
      void live.reload();
      onReload();
    } catch (cause) {
      show({
        tone: 'danger',
        title: 'Şəkil yüklənmədi',
        message: cause instanceof ApiError ? cause.message : 'Yenidən cəhd edin.',
      });
    } finally {
      setBusy(false);
    }
  };

  const hasMarketLicense = Boolean(license && (license.product === 'market' || license.plan === 'market'));
  const customDelta = Math.max(1, Math.trunc(Number(deltaInput.replace(',', '.')) || 0));
  const productOpen = selectedId !== null;
  const checks = market?.transactionCount ?? 0;
  const cash = market?.cashMinor ?? 0;
  const card = market?.cardMinor ?? 0;
  const payTotal = cash + card;
  const avgMinor = checks ? Math.round(daily / checks) : 0;
  const openCount = registers.filter((row) => row.status === 'open' && row.connected !== false).length;
  const liveRegister =
    registers.find((row) => row.status === 'open' && row.connected !== false) ?? registers[0] ?? null;
  const liveOpen = Boolean(liveRegister && liveRegister.status === 'open' && liveRegister.connected !== false);
  const liveIds = new Set(list.map((product) => product.id));
  const topProducts = (market?.topProducts ?? []).filter((row) => liveIds.has(row.id));
  const topMax = Math.max(
    1,
    ...topProducts.map((row) => Number(row.qty || 0)),
    ...topProducts.map((row) => Number(row.revenueMinor || 0)),
  );
  const categoryRows = (() => {
    const counts = new Map<string, number>();
    for (const product of list) {
      const key = String(product.category || '').trim() || 'Digər';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const total = Math.max(1, list.length);
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }));
  })();
  const moves = list
    .filter((product) => product.lastMovement?.at)
    .sort(
      (left, right) =>
        new Date(right.lastMovement!.at).getTime() - new Date(left.lastMovement!.at).getTime(),
    )
    .slice(0, 6);
  const lowRows = (market?.lowStock ?? []).filter((row) => liveIds.has(row.id));
  const stockCards = (
    lowRows.length
      ? lowRows.map((row) => {
          const product = list.find((item) => item.id === row.id);
          return {
            id: row.id,
            name: row.name,
            stock: Number(row.stock ?? product?.stock ?? 0),
            min: Number(row.minStock ?? product?.minStock ?? 0),
            note: product?.category || product?.sku || '',
          };
        })
      : list.map((product) => ({
          id: product.id,
          name: product.name,
          stock: Number(product.warehouseStock?.[floor.id] ?? product.stock),
          min: product.minStock,
          note: product.category || product.sku,
        }))
  )
    .sort((left, right) => left.stock / Math.max(1, left.min) - right.stock / Math.max(1, right.min))
    .slice(0, 8);
  const cashShare = payTotal ? Math.round((cash / payTotal) * 100) : 0;
  const cardShare = payTotal ? 100 - cashShare : 0;
  const reloadLive = () => {
    onReload();
    void live.reload();
    void inventory.reload();
  };

  return (
    <div className="shop">
      <div className="shop-progress" style={{ width: `${progress}%` }} />

      <button
        type="button"
        className={`shop-menu${menuOpen ? ' is-open' : ''}`}
        aria-label="Menyu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="shop-bars" aria-hidden="true"><i /><i /><i /></span>
      </button>

      <aside className={`shop-nav${menuOpen ? ' is-open' : ''}`} id="shop-nav" aria-hidden={!menuOpen}>
        <h3>Sürətli keçid</h3>
        <p>İstədiyiniz bölməyə keçin. Aşağı sürüşdürdükcə aktiv hissə menyuda işarələnir.</p>
        <nav className="shop-menu-list" aria-label="Səhifə bölmələri">
          {SHOP_SECTIONS.map((section, index) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={activeSection === section.id ? 'is-active' : undefined}
              onClick={(event) => {
                event.preventDefault();
                setMenuOpen(false);
                jumpTo(section.id);
              }}
            >
              <span>{section.label}</span>
              <small>{String(index + 1).padStart(2, '0')}</small>
            </a>
          ))}
        </nav>
        <div className="shop-nav-foot">
          {market?.storeName || customerName} · {connected ? 'kassa onlayn' : 'kassa oflayn'}
        </div>
      </aside>

      <div className="shop-page">
        <section className="shop-section shop-hero" id="shop-home">
          <div className="shop-inner">
            <div className="shop-eyebrow"><i /> {connected ? 'Sistem işləyir' : 'Kassa oflayndır'}</div>
            <h1>Biznesinizi aydın görün. Satışı, stoku və məhsulları bir yerdə idarə edin.</h1>
            <p>
              Rəqəmlər kassanın ürək döyüntüsündən gəlir. Saatlıq qrafik və saxta satış yoxdur — till göndərməyəndə
              sahə boş qalır.
            </p>
            <div className="shop-hero-actions">
              <button type="button" className="shop-btn shop-btn-primary" onClick={() => jumpTo('shop-sales')}>
                Canlı satışa keç
              </button>
              <button type="button" className="shop-btn" onClick={() => jumpTo('shop-inventory')}>
                Məhsullara bax
              </button>
              <button type="button" className="shop-btn" disabled={!canCommand} onClick={() => void sendReport('x_report')}>
                X hesabat
              </button>
              <button type="button" className="shop-btn" disabled={!canCommand} onClick={() => setZOpen(true)}>
                Z hesabat
              </button>
            </div>
            <div className="shop-scroll-cue">
              <span className="shop-mouse"><i /></span>
              Aşağı sürüşdür
            </div>
            <div className="shop-hero-stats">
              <div><span>Filial</span><strong>{market?.storeName || customerName}</strong></div>
              <div><span>Aktiv kassa</span><strong>{openCount}</strong></div>
              <div><span>Məhsul</span><strong>{totals?.all ?? market?.activeProductCount ?? list.length}</strong></div>
              <div>
                <span>Server statusu</span>
                <strong className={connected ? 'is-live' : undefined}>{connected ? 'Onlayn' : 'Oflayn'}</strong>
              </div>
            </div>
          </div>
        </section>

        {!hasMarketLicense ? (
          <div className="shop-license">
            <Alert tone="warning" title="Market POS lisenziyası tapılmadı">
              Market kassası üçün ayrıca aktivasiya açarı lazımdır.
            </Alert>
          </div>
        ) : null}

        <section className="shop-section" id="shop-sales">
          <div className="shop-inner">
            <div className="shop-section-title">
              <div>
                <div className="shop-eyebrow"><i /> Canlı satış</div>
                <h2>Bugünkü satış nəticəsi</h2>
              </div>
              <p>
                Ümumi satış, çek sayı və aktiv növbə kassadan gəlir. Son görünmə: {relativeTime(market?.lastSeenAt)}.
              </p>
            </div>

            <div className="shop-sales-layout">
              <article className={`shop-panel shop-sales-main${tick ? ' is-tick' : ''}${connected ? '' : ' is-dim'}`}>
                <div className="shop-label">Bu gün ümumi satış</div>
                <div className="shop-sales-value" aria-live="polite">
                  {formatLcd(daily)}
                  <small>₼</small>
                </div>
                <div className="shop-toolbar">
                  <button
                    type="button"
                    className="shop-btn"
                    disabled={refreshing || live.refreshing || inventory.refreshing}
                    onClick={reloadLive}
                  >
                    Yenilə
                  </button>
                  {lastCommand && connected ? (
                    <span className="shop-hint">
                      Son əmr: {lastCommand.kind === 'z_report' ? 'Z' : 'X'} · {commandStatus(lastCommand.status, lastCommand.error).label}
                    </span>
                  ) : null}
                </div>
                <div className="shop-sales-bottom">
                  <div className="shop-kpi"><span>Çek sayı</span><strong>{checks}</strong></div>
                  <div className="shop-kpi"><span>Orta çek</span><strong>{checks ? formatMoney(avgMinor) : '—'}</strong></div>
                  <div className="shop-kpi"><span>Nağd</span><strong>{formatMoney(cash)}</strong></div>
                  <div className="shop-kpi"><span>Aktiv kassa</span><strong>{openCount}</strong></div>
                </div>
              </article>

              <div className="shop-side">
                <article className="shop-panel shop-pad">
                  <div className="shop-card-head">
                    <h3>Aktiv kassa</h3>
                    <span className={`shop-pill${liveOpen ? ' is-green' : ''}`}>{liveOpen ? 'Açıq' : 'Bağlı'}</span>
                  </div>
                  {liveRegister ? (
                    <>
                      <div className="shop-cashier">
                        <div className="shop-avatar">{productLetter(liveRegister.name)}</div>
                        <div>
                          <strong>{liveRegister.name}{liveRegister.terminalName ? ` · ${liveRegister.terminalName}` : ''}</strong>
                          <span>{liveRegister.operatorName || 'Kassir yoxdur'}</span>
                        </div>
                      </div>
                      <div className="shop-data">
                        <div><span>Növbə satışı</span><strong>{formatMoney(liveRegister.salesMinor)}</strong></div>
                        <div><span>Son görünmə</span><strong>{relativeTime(liveRegister.lastSeenAt)}</strong></div>
                        <div><span>Kart</span><strong>{formatMoney(card)}</strong></div>
                      </div>
                    </>
                  ) : (
                    <p className="shop-empty">Kassa hələ ürək döyüntüsü göndərməyib. Till açılıb növbə başlayanda burada görünəcək.</p>
                  )}
                </article>

                <article className="shop-panel shop-pad">
                  <div className="shop-card-head">
                    <h3>Server görünüşü</h3>
                    <span className="shop-pill is-blue">{connected ? 'Canlı' : 'Gözləyir'}</span>
                  </div>
                  <div className="shop-big">{connected ? 'Onlayn' : 'Oflayn'}</div>
                  <div className="shop-sub">
                    {market?.appVersion ? `Till ${market.appVersion}` : 'Kassa versiyası hələ gəlməyib.'}
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="shop-section" id="shop-mix">
          <div className="shop-inner">
            <div className="shop-section-title">
              <div>
                <div className="shop-eyebrow"><i /> Ödəniş</div>
                <h2>Nağd və kart payı</h2>
              </div>
              <p>Kassanın göndərdiyi nağd/kart bölgüsü. Saatlıq satış seriyası till-dən gəlmir, ona görə uydurulmur.</p>
            </div>
            <article className="shop-panel shop-chart">
              <div className="shop-card-head">
                <h3>Bu günün ödəniş bölgüsü</h3>
                <span className="shop-legend"><i /> kassadan</span>
              </div>
              {payTotal > 0 ? (
                <div className="shop-mix-plot" aria-label="Nağd və kart">
                  <div className="shop-mix-col" style={{ flexGrow: Math.max(cash, 1) }}>
                    <strong>{formatLcd(cash)}</strong>
                    <span>Nağd · {cashShare}%</span>
                  </div>
                  <div className="shop-mix-col is-card" style={{ flexGrow: Math.max(card, 1) }}>
                    <strong>{formatLcd(card)}</strong>
                    <span>Kart · {cardShare}%</span>
                  </div>
                </div>
              ) : (
                <p className="shop-empty shop-empty-box">
                  Bu gün nağd/kart bölgüsü hələ yoxdur. Kassa satış göndərəndə pay burada açılacaq.
                </p>
              )}
            </article>
            <div className="shop-explainer">
              <strong>Necə oxunur?</strong> Sol sütun nağd, sağ sütun kartdır. Eni həmin günün payına görə dəyişir.
            </div>
          </div>
        </section>

        <section className="shop-section" id="shop-analytics">
          <div className="shop-inner">
            <div className="shop-section-title">
              <div>
                <div className="shop-eyebrow"><i /> Analiz</div>
                <h2>Kartın üzərinə gəldikdə detallar açılır</h2>
              </div>
              <p>Ən çox satılanlar, kataloq kateqoriyası və azalan stok — hamısı kassa və mərkəzi kataloqdan.</p>
            </div>
            <div className="shop-analytics">
              <article className="shop-analytics-card">
                <div className="shop-analytics-icon"><Icon name="activity" size={18} /></div>
                <h3>Ən çox satılan məhsullar</h3>
                <p>Till-in göndərdiyi günlük top siyahı.</p>
                <div className="shop-analytics-overlay">
                  {topProducts.length ? (
                    <div className="shop-bars-list">
                      {topProducts.slice(0, 4).map((row) => {
                        const value = Number(row.qty || 0);
                        const width = Math.max(8, Math.round((value / topMax) * 100));
                        return (
                          <div key={row.id} className="shop-bar-item">
                            <span><b>{row.name}</b><b>{value ? `${value} ədəd` : formatMoney(row.revenueMinor ?? 0)}</b></span>
                            <div className="shop-bar"><i style={{ width: `${width}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="shop-empty">Till hələ top məhsul göndərməyib.</p>
                  )}
                </div>
              </article>

              <article className="shop-analytics-card">
                <div className="shop-analytics-icon"><Icon name="file" size={18} /></div>
                <h3>Kateqoriya payı</h3>
                <p>Kataloqdakı məhsul sayına görə.</p>
                <div className="shop-analytics-overlay">
                  {list.length ? (
                    <div className="shop-bars-list">
                      {categoryRows.map((row) => (
                        <div key={row.name} className="shop-bar-item">
                          <span><b>{row.name}</b><b>{row.pct}%</b></span>
                          <div className="shop-bar"><i style={{ width: `${Math.max(8, row.pct)}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="shop-empty">Kataloq boşdur.</p>
                  )}
                </div>
              </article>

              <article className="shop-analytics-card">
                <div className="shop-analytics-icon"><Icon name="warning" size={18} /></div>
                <h3>Azalan stok</h3>
                <p>Minimumun altına düşən mallar.</p>
                <div className="shop-analytics-overlay">
                  {stockCards.length ? (
                    <div className="shop-bars-list">
                      {stockCards.slice(0, 4).map((row) => {
                        const width = Math.max(8, Math.min(100, Math.round((row.stock / Math.max(1, row.min)) * 100)));
                        return (
                          <div key={row.id} className="shop-bar-item">
                            <span><b>{row.name}</b><b>{row.stock} / {row.min}</b></span>
                            <div className="shop-bar"><i style={{ width: `${width}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="shop-empty">Azalan stok yoxdur.</p>
                  )}
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="shop-section" id="shop-recent">
          <div className="shop-inner">
            <div className="shop-section-title">
              <div>
                <div className="shop-eyebrow"><i /> Son hərəkət</div>
                <h2>Stokda son dəyişikliklər</h2>
              </div>
              <p>Kassadan çek lenti gəlmir. Burada məhsulun son stok hərəkəti göstərilir.</p>
            </div>
            <div className="shop-feed-grid">
              <article className="shop-panel shop-pad">
                {moves.length ? (
                  <div className="shop-feed">
                    {moves.map((product) => {
                      const movement = product.lastMovement!;
                      return (
                        <button
                          key={`${product.id}-${movement.at}`}
                          type="button"
                          className="shop-sale-row"
                          onClick={() => fillForm(product)}
                        >
                          <div className="shop-pay">
                            <Icon name={movement.delta < 0 ? 'minus' : 'plus'} size={17} />
                          </div>
                          <div className="shop-sale-main">
                            <strong>{product.name}</strong>
                            <span>{movement.kind || 'stok'} · {relativeTime(movement.at)}</span>
                          </div>
                          <div className="shop-sale-amount">
                            <strong>{movement.delta > 0 ? '+' : ''}{movement.delta}</strong>
                            <span>{formatMoney(product.priceMinor)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    title="Hərəkət yoxdur"
                    description="Stok artımı, satışı və ya silinməsi olanda burada görünəcək."
                  />
                )}
              </article>
              <article className="shop-panel shop-pad">
                <div className="shop-label">Bu günün xülasəsi</div>
                <div className="shop-summary-big">{formatLcd(daily)} <small>₼</small></div>
                <div className="shop-summary-list">
                  <div><span>Çek sayı</span><strong>{checks}</strong></div>
                  <div><span>Kart ödənişi</span><strong>{payTotal ? `${cardShare}%` : '—'}</strong></div>
                  <div><span>Nağd ödəniş</span><strong>{payTotal ? `${cashShare}%` : '—'}</strong></div>
                  <div><span>Orta çek</span><strong>{checks ? formatMoney(avgMinor) : '—'}</strong></div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="shop-section" id="shop-inventory">
          <div className="shop-inner">
            <div className="shop-section-title">
              <div>
                <div className="shop-eyebrow"><i /> Stok və məhsullar</div>
                <h2>Məhsulları idarə edin, stoklara baxın</h2>
              </div>
              <p>Şəkil qalereyadan seçilir və kassada oflaynda da qalır. Silmək üçün giriş şifrəsi lazımdır.</p>
            </div>

            <article className="shop-panel shop-pad">
              <div className="shop-inventory-top">
                <div>
                  <div className="shop-label">İdarəetmə paneli</div>
                  <div className="shop-inventory-title">Məhsul və stok görünüşü</div>
                </div>
                <div className="shop-inventory-actions">
                  <button type="button" className="shop-btn" onClick={() => jumpTo('shop-stock')}>Stoklara bax</button>
                  <button type="button" className="shop-btn shop-btn-primary" onClick={startCreate}>Yeni məhsul əlavə et</button>
                </div>
              </div>

              <div className="shop-inventory-tools">
                <Field
                  label="Axtar"
                  value={query}
                  placeholder="Ad, SKU və ya barkod"
                  prefixIcon="search"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
                <div className="shop-filters" role="group" aria-label="Stok filtri">
                  {(
                    [
                      ['all', `Hamısı (${totals?.all ?? '—'})`],
                      ['instock', `Var (${totals?.instock ?? '—'})`],
                      ['out', `Yoxdur (${totals?.out ?? '—'})`],
                      ['critical', `Kritik (${totals?.critical ?? '—'})`],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      data-active={filter === id ? '1' : '0'}
                      onClick={() => {
                        setFilter(id);
                        setPage(1);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="shop-stock-grid" id="shop-stock">
                {stockCards.length ? (
                  stockCards.map((row) => {
                    const band = stockBand(row.stock, row.min);
                    const ratio = Math.min(100, Math.max(8, (row.stock / Math.max(1, row.min)) * 100));
                    return (
                      <article key={row.id} className="shop-stock-card">
                        <div className="shop-stock-top">
                          <strong>{row.name}</strong>
                          <span className={`shop-stock-badge is-${band}`}>{stockLabel(band)}</span>
                        </div>
                        <div className="shop-stock-sub">{row.note || 'Qeyd yoxdur'}</div>
                        <div className="shop-stock-meta">
                          <span>Stok: {row.stock}</span>
                          <span>Minimum: {row.min}</span>
                        </div>
                        <div className="shop-progress-line"><i className={`is-${band}`} style={{ width: `${ratio}%` }} /></div>
                      </article>
                    );
                  })
                ) : (
                  <p className="shop-empty">Stok sətiri yoxdur.</p>
                )}
              </div>

              {list.length ? (
                <div className="shop-products">
                  {list.map((product) => {
                    const photo = marketProductPhotoUrl(product);
                    const qty = Number(product.warehouseStock?.[floor.id] ?? product.stock);
                    const band = stockBand(qty, product.minStock);
                    return (
                      <button key={product.id} type="button" className="shop-product" onClick={() => fillForm(product)}>
                        <div className="shop-product-image">
                          {photo ? <img src={photo} alt="" /> : <span>{productLetter(product.name)}</span>}
                        </div>
                        <div className="shop-product-body">
                          <strong>{product.name}</strong>
                          <div className="shop-product-meta">
                            <span>{formatMoney(product.priceMinor)}</span>
                            <em className={band === 'danger' ? 'is-low' : undefined}>{qty} ədəd</em>
                          </div>
                          <div className="shop-product-meta">
                            <span>Bugün {product.soldTodayQty ?? 0} · {formatMoney(product.profitTodayMinor)}</span>
                            <em>Ümumi {product.soldAllQty ?? 0}</em>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="Kataloq boşdur"
                  description="Şəkil və stok əlavə edin — kassa oflaynda da eyni şəkli göstərəcək."
                  action={
                    <Button size="sm" variant="primary" icon="plus" onClick={startCreate}>
                      Məhsul əlavə et
                    </Button>
                  }
                />
              )}

              {pageData && pageData.total > pageData.limit ? (
                <div className="shop-pager">
                  <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    Əvvəlki
                  </Button>
                  <small>Səhifə {pageData.page} · {pageData.total}</small>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={page * pageData.limit >= pageData.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Növbəti
                  </Button>
                </div>
              ) : null}
            </article>

            <MarketBranchStock />
          </div>
        </section>

        <section className="shop-section shop-end" id="shop-end">
          <div className="shop-inner shop-end-inner">
            <div className="shop-eyebrow" style={{ justifyContent: 'center' }}><i /> possistem tərzi</div>
            <h2>Aydın görünüş. Daha çox nəzarət.</h2>
            <p>Satış, stok və şəkil eyni səhifədədir. Rəqəmlər yalnız kassadan gələndə dolur.</p>
            <button type="button" className="shop-btn" onClick={() => jumpTo('shop-home')}>Yuxarı qayıt</button>
          </div>
        </section>
      </div>

      <TillDrawer
        open={productOpen}
        title={selectedId === 'new' ? 'Yeni məhsul' : selected?.name || 'Məhsul'}
        onClose={closeProduct}
      >
        {selectedId === 'new' ? (
          <form className="market-product-form" onSubmit={(event) => void submitProduct(event)}>
            <Field label="Ad" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Field label="SKU" value={form.sku} hint="Boş buraxsanız avtomatik yaranır" onChange={(event) => setForm({ ...form, sku: event.target.value })} />
            <Field label="Barkod" value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
            <Field label="Satış qiyməti (AZN)" inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
            <Field label="Maya qiyməti (AZN)" inputMode="decimal" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} />
            <Field
              label="Stok (kassa qalığı)"
              inputMode="numeric"
              value={form.qty}
              onChange={(event) => setForm({ ...form, qty: event.target.value })}
            />
            <Field label="Minimum stok" inputMode="numeric" value={form.minStock} onChange={(event) => setForm({ ...form, minStock: event.target.value })} />
            <PhotoField file={photoFile} onPick={setPhotoFile} inputRef={photoInput} />
            <div className="button-row">
              <Button type="submit" variant="primary" loading={busy}>Əlavə et</Button>
              <Button type="button" variant="ghost" onClick={closeProduct}>Ləğv et</Button>
            </div>
          </form>
        ) : selected ? (
          <ProductDetail
            product={selected}
            warehouses={warehouses}
            floorId={floor.id}
            form={form}
            busy={busy}
            adjusting={adjusting}
            deltaInput={deltaInput}
            customDelta={customDelta}
            photoFile={photoFile}
            photoInput={photoInput}
            onFormChange={setForm}
            onDeltaInput={setDeltaInput}
            onSave={(event) => void submitProduct(event)}
            onUploadPhoto={(file) => void savePhoto(selected, file)}
            onAdjust={(warehouseId, delta) => void changeStock(selected, warehouseId, delta)}
            onRemove={() => {
              setRemoveId(selected.id);
              setRemovePassword('');
              setRemoveError('');
            }}
          />
        ) : null}
      </TillDrawer>

      <Modal
        open={zOpen}
        title="Z hesabat"
        description="Növbə bağlanacaq və hesabat kassa printerindən çıxacaq."
        onClose={closeZ}
      >
        <Field
          label="Sayılan nağd (AZN)"
          inputMode="decimal"
          value={zCash}
          hint="Boş buraxmaq olar"
          onChange={(event) => setZCash(event.target.value)}
        />
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={closeZ} disabled={busy}>Ləğv et</Button>
          <Button type="button" variant="danger" loading={busy} onClick={() => void sendReport('z_report')}>Z göndər</Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(removeId)}
        title="Məhsulu sil"
        description="Kassadan da çıxacaq. Market POS-a girdiyiniz şifrəni yazın."
        onClose={closeRemove}
      >
        <form
          className="market-product-form"
          onSubmit={(event) => {
            event.preventDefault();
            void removeProduct();
          }}
        >
          <PasswordField
            label="Sahibkar şifrəsi"
            autoComplete="current-password"
            value={removePassword}
            error={removeError}
            onChange={(event) => {
              setRemovePassword(event.target.value);
              setRemoveError('');
            }}
          />
          <div className="dialog-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={closeRemove}>
              Ləğv et
            </Button>
            <Button type="submit" variant="danger" loading={busy}>
              Sil
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function PhotoField({
  file,
  previewUrl,
  onPick,
  inputRef,
}: {
  file: File | null;
  previewUrl?: string | null;
  onPick: (file: File | null) => void;
  inputRef: FileInputRef;
}) {
  const fieldId = useId();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const local = objectUrl || previewUrl || '';
  return (
    <div className="till-photo">
      <span>Şəkil</span>
      {local ? <img src={local} alt="" /> : <em>Qalereyadan şəkil seçin — kassada görünəcək</em>}
      <input
        id={fieldId}
        ref={inputRef}
        type="file"
        accept="image/*"
        className="till-photo-input"
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
      <label htmlFor={fieldId} className="button button-secondary button-md">
        <span>{local ? 'Şəkli dəyiş' : 'Qalereyadan seç'}</span>
      </label>
    </div>
  );
}

function ProductDetail({
  product,
  warehouses,
  floorId,
  form,
  busy,
  adjusting,
  deltaInput,
  customDelta,
  photoFile,
  photoInput,
  onFormChange,
  onDeltaInput,
  onSave,
  onUploadPhoto,
  onAdjust,
  onRemove,
}: {
  product: MarketProduct;
  warehouses: MarketWarehouse[];
  floorId: string;
  form: typeof emptyForm;
  busy: boolean;
  adjusting: string | null;
  deltaInput: string;
  customDelta: number;
  photoFile: File | null;
  photoInput: FileInputRef;
  onFormChange: (next: typeof emptyForm) => void;
  onDeltaInput: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onUploadPhoto: (file: File) => void;
  onAdjust: (warehouseId: string, delta: number) => void;
  onRemove: () => void;
}) {
  const bins = warehouses.length
    ? warehouses
    : Object.keys(product.warehouseStock ?? {}).map((id) => ({ id, name: id }));
  const movement = product.lastMovement;
  const photo = marketProductPhotoUrl(product);

  return (
    <>
      <PhotoField
        file={photoFile}
        previewUrl={photo}
        onPick={(file) => {
          if (file) onUploadPhoto(file);
        }}
        inputRef={photoInput}
      />
      <dl className="market-facts">
        <div>
          <dt>Satış qiyməti</dt>
          <dd className="tabular">{formatMoney(product.priceMinor)}</dd>
        </div>
        <div>
          <dt>Maya qiyməti</dt>
          <dd className="tabular">{formatMoney(product.costMinor)}</dd>
        </div>
        <div>
          <dt>Stok</dt>
          <dd className="tabular">{product.stock}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{product.active === false ? 'Deaktiv' : 'Aktiv'}</dd>
        </div>
        <div>
          <dt>Bu gün satış</dt>
          <dd className="tabular">{product.soldTodayQty ?? 0} ədəd · {formatMoney(product.revenueTodayMinor)}</dd>
        </div>
        <div>
          <dt>Bu gün xalis</dt>
          <dd className="tabular">{formatMoney(product.profitTodayMinor)}</dd>
        </div>
        <div>
          <dt>Ümumi satış</dt>
          <dd className="tabular">{product.soldAllQty ?? 0} ədəd · {formatMoney(product.revenueAllMinor)}</dd>
        </div>
        <div>
          <dt>Ümumi xalis</dt>
          <dd className="tabular">{formatMoney(product.profitAllMinor)}</dd>
        </div>
      </dl>

      {movement ? (
        <p className="market-movement">
          Son hərəkət: {movement.delta > 0 ? '+' : ''}{movement.delta}
          {movement.kind ? ` · ${movement.kind}` : ''} · {relativeTime(movement.at)}
        </p>
      ) : null}

      <h3>Anbar qalığı</h3>
      <ul className="stock-bins">
        {bins.map((warehouse) => {
          const qty = product.warehouseStock?.[warehouse.id] ?? 0;
          const busyKey = `${product.id}:${warehouse.id}`;
          const isFloor = warehouse.id === floorId;
          return (
            <li key={warehouse.id}>
              <div>
                <strong>{warehouseLabel(warehouse)}</strong>
                <small>{isFloor ? 'Kassada satılır' : warehouse.id}</small>
              </div>
              <span className={`tabular ${qty <= 0 ? 'stock-out' : ''}`}>{qty}</span>
              <div className="stock-stepper">
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  icon="minus"
                  disabled={qty <= 0}
                  loading={adjusting === busyKey}
                  onClick={() => onAdjust(warehouse.id, -1)}
                >
                  1
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="secondary"
                  icon="plus"
                  loading={adjusting === busyKey}
                  onClick={() => onAdjust(warehouse.id, 1)}
                >
                  1
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="primary"
                  loading={adjusting === busyKey}
                  onClick={() => onAdjust(warehouse.id, 10)}
                >
                  +10
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        className="stock-custom"
        onSubmit={(event) => {
          event.preventDefault();
          onAdjust(floorId, customDelta);
        }}
      >
        <Field
          label={`${warehouseLabel({ id: floorId, name: 'Satış zalı' })} üçün əlavə et`}
          inputMode="numeric"
          value={deltaInput}
          onChange={(event) => onDeltaInput(event.target.value)}
        />
        <Button type="submit" variant="primary" icon="plus" loading={adjusting?.startsWith(`${product.id}:`) ?? false}>
          +{customDelta} artır
        </Button>
      </form>

      <form className="market-product-form" onSubmit={onSave}>
        <h3>Məhsul məlumatı</h3>
        <Field label="Ad" required value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
        <Field label="SKU" value={form.sku} onChange={(event) => onFormChange({ ...form, sku: event.target.value })} />
        <Field label="Barkod" value={form.barcode} onChange={(event) => onFormChange({ ...form, barcode: event.target.value })} />
        <Field label="Satış qiyməti (AZN)" inputMode="decimal" value={form.price} onChange={(event) => onFormChange({ ...form, price: event.target.value })} />
        <Field label="Maya qiyməti (AZN)" inputMode="decimal" value={form.cost} onChange={(event) => onFormChange({ ...form, cost: event.target.value })} />
        <Field label="Minimum stok" inputMode="numeric" value={form.minStock} onChange={(event) => onFormChange({ ...form, minStock: event.target.value })} />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={busy}>Yadda saxla</Button>
          <Button type="button" variant="danger" icon="trash" onClick={onRemove}>Sil</Button>
        </div>
      </form>
    </>
  );
}
