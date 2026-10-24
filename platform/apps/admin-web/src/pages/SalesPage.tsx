import { useLiveEffect } from '../lib/live';
import {MarketRegisterCapacity} from '../components/MarketRegisterCapacity';
import { useCallback,  useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../i18n';
import { EmailEditor } from '../components/EmailEditor';

type ResellerOption = { id: string; name: string };

type Sale = {
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  voen: string | null;
  contactPerson: string | null;
  createdAt: string;
  customerActive: boolean;
  resellerId: string | null;
  resellerName: string | null;
  resellerSlug: string | null;
  plan: string | null;
  status: string | null;
  validUntil: string | null;
  licenseId: string | null;
  activationKeyId: string | null;
  product: 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan' | null; /* topdan-product: type */ /* aptek-product: type */ /* geyim-product: type */
  keyLabel: string | null;
  maxDevices: number | null;
  redeemCount: number | null;
  keyExpiresAt: string | null;
};

type IssuedKey = {
  customerName: string;
  email: string | null;
  activationKey: string;
  label: string | null;
  expiresAt: string | null;
};

function statusLabel(status: string | null): string {
  switch (status) {
    case 'active':
      return 'Aktiv';
    case 'expired':
      return 'Bitib';
    case 'suspended':
      return 'Dayandırılıb';
    case 'revoked':
      return 'Ləğv edilib';
    default:
      return '—';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('az-AZ');
}

function productLabel(product: Sale['product']): string {
  return product === 'topdan' ? 'Topdan POS' /* topdan-product: label */ : product === 'aptek' ? 'Aptek POS' /* aptek-product: label */ : product === 'geyim' ? 'Geyim POS' : product === 'market' ? 'Market POS' : 'Restoran POS'; /* geyim-product: label */
}

function daysLeftLabel(validUntil: string | null): string {
  if (!validUntil) return 'Tarix yoxdur';
  const d = new Date(validUntil);
  if (Number.isNaN(d.getTime())) return 'Tarix yoxdur';
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} gün gecikib`;
  if (days === 0) return 'Bu gün bitir';
  return `${days} gün qalıb`;
}

type LiveSummary = Record<
  string,
  { connected: boolean; lastSeenAt: string | null; openTables: number; restaurantName: string | null }
>;

export function SalesPage() {
  const t = useI18n();
  const [rows, setRows] = useState<Sale[] | null>(null);
  const [liveSummary, setLiveSummary] = useState<LiveSummary>({});
  const [resellers, setResellers] = useState<ResellerOption[]>([]);
  const [filter, setFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter) params.set('resellerId', filter);
    if (productFilter) params.set('product', productFilter);
    const qs = params.toString() ? `?${params.toString()}` : '';
    void api<Sale[]>(`/sales${qs}`)
      .then((data) => {
        setRows(data);
        setError(null);
        const ids = data.map((row) => row.customerId);
        if (ids.length > 0) {
          void api<{ summary: LiveSummary }>('/customers/live-summary', {
            method: 'POST',
            body: JSON.stringify({ customerIds: ids }),
          })
            .then((res) => setLiveSummary(res.summary))
            .catch(() => setLiveSummary({}));
        } else {
          setLiveSummary({});
        }
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : t.common.error;
        setError(msg === 'Unauthorized' ? t.login.sessionExpired : msg);
      });
  }, [filter, productFilter, t.common.error]);

  useLiveEffect(load, [load]);

  useLiveEffect(() => {
    void api<ResellerOption[]>('/resellers')
      .then((data) => setResellers(data.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => setResellers([]));
  }, []);

  const clearHwid = async (row: Sale) => {
    if (!window.confirm(`${row.name} — ${t.sales.clearHwidConfirm}`)) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/customers/${row.customerId}/clear-hwid`, { method: 'POST', body: '{}' });
      setNotice(t.sales.hwidCleared);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  };

  const regenerateKey = async (row: Sale) => {
    if (!window.confirm(`${row.name} · ${row.product || "POS"} — ${t.sales.showKeyConfirm}`)) return;
    setError(null);
    setNotice(null);
    setBusyId(row.customerId);
    try {
      const data = await api<{
        activationKey: string;
        customerName: string;
        email: string | null;
        label: string | null;
        expiresAt: string | null;
      }>(`/customers/${row.customerId}/regenerate-activation-key`, {
        method: 'POST',
        body: JSON.stringify({licenseId:row.licenseId}),
      });
      setIssued({
        customerName: data.customerName,
        email: data.email,
        activationKey: data.activationKey,
        label: data.label,
        expiresAt: data.expiresAt,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusyId(null);
    }
  };

  const copyKey = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.activationKey);
      setNotice(t.sales.keyCopied);
    } catch {
      setError(t.common.error);
    }
  };

  const summary = rows
    ? {
        total: rows.length,
        online: rows.filter((row) => liveSummary[row.customerId]?.connected).length,
        active: rows.filter((row) => row.status === 'active').length,
        market: rows.filter((row) => row.product === 'market' || row.product === 'geyim' || row.product === 'aptek' || row.product === 'topdan').length, /* topdan-product: counts */ /* aptek-product: counts */ /* geyim-product: counts */
        restaurant: rows.filter((row) => row.product !== 'market' && row.product !== 'geyim' && row.product !== 'aptek' && row.product !== 'topdan').length, /* topdan-product: restaurant */ /* aptek-product: restaurant */
      }
    : null;

  return (
    <div className="page">
      <header className="page-header sales-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.sales.title}</h1>
          <p className="muted sales-header-copy">{t.sales.hint}</p>
        </div>
        <div className="filter-row sales-filters">
          <label>
            {t.sales.colProduct}
            <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">{t.sales.filterAllProducts}</option>
              <option value="restaurant">Restoran POS</option>
              <option value="market">Market POS</option>
              {/* geyim-product: option */}<option value="geyim">Geyim POS</option>
              {/* aptek-product: option */}<option value="aptek">Aptek POS</option>
              {/* topdan-product: option */}<option value="topdan">Topdan POS</option>
            </select>
          </label>
          <label>
            {t.sales.colSeller}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">{t.sales.filterAll}</option>
              <option value="direct">{t.sales.filterDirect}</option>
              {resellers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Link className="btn primary" to={`/new-customer${productFilter ? `?product=${productFilter}` : ''}`}>
            {t.nav.newCustomer}
          </Link>
        </div>
      </header>

      {summary && (
        <section className="sales-summary" aria-label="Müştəri xülasəsi">
          <div>
            <span>{t.sales.title}</span>
            <strong>{summary.total}</strong>
          </div>
          <div>
            <span>{t.live.online}</span>
            <strong>{summary.online}</strong>
          </div>
          <div>
            <span>{statusLabel('active')}</span>
            <strong>{summary.active}</strong>
          </div>
          <div>
            <span>Restoran / Market</span>
            <strong>{summary.restaurant} / {summary.market}</strong>
          </div>
        </section>
      )}

      {error && <p className="error" style={{ marginTop: '1rem' }}>{error}</p>}
      {notice && <p className="notice" style={{ marginTop: '1rem' }}>{notice}</p>}

      {issued && (
        <section className="card" style={{ marginTop: '1.2rem' }} role="dialog" aria-label={t.sales.colKey}>
          <div className="section-heading">
            <h2>{t.sales.colKey}</h2>
            <button type="button" className="btn" onClick={() => setIssued(null)}>
              {t.sales.closeKey}
            </button>
          </div>
          <p className="muted">{t.sales.keyOnce}</p>
          <dl className="kv" style={{ marginTop: '.8rem' }}>
            <dt>{t.sales.colCustomer}</dt>
            <dd>{issued.customerName}</dd>
            <dt>{t.sales.colEmail}</dt>
            <dd className="mono">{issued.email ?? '—'}</dd>
            <dt>{t.sales.colKey}</dt>
            <dd className="mono key-value">{issued.activationKey}</dd>
            <dt>{t.sales.colExpires}</dt>
            <dd>{formatDate(issued.expiresAt)}</dd>
          </dl>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" onClick={() => void copyKey()}>
              {t.sales.copyKey}
            </button>
          </div>
        </section>
      )}

      <section className="card sales-panel" style={{ marginTop: '1.2rem' }}>
        <div className="section-heading">
          <div>
            <h2>Müştəri kataloqu</h2>
            <p className="muted compact-copy">Müştəri adına klik etdikdə canlı vəziyyət, icazələr və işçi rolları açılır.</p>
          </div>
        </div>
        {rows && rows.length === 0 && (
          <p className="muted" style={{ marginTop: '.8rem' }}>
            {t.sales.empty}
          </p>
        )}
        {rows && rows.length > 0 && (
          <div className="sales-catalog">
            {rows.map((r) => {
              const live = liveSummary[r.customerId];
              const online = Boolean(live?.connected);
              return (
                <article className="sales-card" key={`${r.customerId}-${r.licenseId}-${r.activationKeyId}`}>
                  <div className="sales-card-main">
                    <div className="sales-card-title">
                      <span className="live-dot" data-online={online ? '1' : '0'} aria-hidden />
                      <div>
                        <Link to={`/sales/${r.customerId}`} className="customer-link sales-name">
                          {r.name}
                        </Link>
                        <p className="muted">
                          {[r.contactPerson, r.phone, r.email].filter(Boolean).join(' · ') || 'Əlaqə yoxdur'}
                        </p>
                      </div>
                    </div>
                    <div className="sales-card-badges">
                      <span className="product-badge" data-product={r.product ?? 'restaurant'}>
                        {productLabel(r.product)}
                      </span>
                      <span className={`status-badge status-${r.status ?? 'unknown'}`}>
                        {statusLabel(r.status)}
                      </span>
                      <span className="status-badge">
                        {online ? t.live.online : live?.lastSeenAt ? t.live.offline : t.live.never}
                      </span>
                    </div>
                  </div>

                  <div className="sales-card-meta">
                    <div>
                      <span>{t.sales.colExpires}</span>
                      <strong>{formatDate(r.validUntil)}</strong>
                      <small>{daysLeftLabel(r.validUntil)}</small>
                    </div>
                    <div>
                      <span>{t.sales.colDevices}</span>
                      <strong>{r.redeemCount ?? 0}/{r.maxDevices ?? 0}</strong>
                      <small>{r.keyLabel ?? 'Aktivasiya açarı yoxdur'}</small>
                    </div>
                    <div>
                      <span>{t.sales.colSeller}</span>
                      <strong>{r.resellerName ?? t.dashboard.direct}</strong>
                      <small>{formatDate(r.createdAt)}</small>
                    </div>
                    <div>
                      <span>{t.live.colPos}</span>
                      <strong>{live?.openTables ? `${live.openTables} ${t.live.openTablesShort}` : '—'}</strong>
                      <small>{r.voen ? `VÖEN ${r.voen}` : r.address ?? 'Ünvan yoxdur'}</small>
                    </div>
                  </div>

                  <div className="sales-card-actions">
                    <EmailEditor
                      customerId={r.customerId}
                      customerName={r.name}
                      email={r.email}
                      licenseId={r.licenseId}
                      maxDevices={r.maxDevices}
                      onSaved={(email) => {
                        setRows((prev) =>
                          prev
                            ? prev.map((row) =>
                                row.customerId === r.customerId ? { ...row, email } : row,
                              )
                            : prev,
                        );
                        setNotice(t.sales.emailUpdated);
                        setError(null);
                      }}
                      onCapacitySaved={(maxDevices) => {
                        setRows((prev) =>
                          prev
                            ? prev.map((row) =>
                                row.customerId === r.customerId && row.licenseId === r.licenseId
                                  ? { ...row, maxDevices }
                                  : row,
                              )
                            : prev,
                        );
                        setNotice(t.sales.usageUpdated);
                        setError(null);
                      }}
                      onDeleted={() => {
                        setRows((prev) =>
                          prev ? prev.filter((row) => row.customerId !== r.customerId) : prev,
                        );
                        setNotice(t.sales.saleDeleted);
                        setError(null);
                      }}
                      onError={(msg) => {
                        setError(msg || null);
                        if (msg) setNotice(null);
                      }}
                    />
                    <div className="row-actions">
                      {(r.product === 'market' || r.plan === 'market') && <MarketRegisterCapacity customerId={r.customerId} customerName={r.name} onSaved={next => {setRows(prev => prev?.map(row => row.customerId === r.customerId && row.licenseId === next.licenseId ? {...row,maxDevices:next.capacity} : row) ?? prev);setNotice('PC limiti yeniləndi');setError(null);}}/>}
                      <button
                        type="button"
                        className="btn"
                        disabled={!r.activationKeyId || busyId === r.customerId}
                        onClick={() => void regenerateKey(r)}
                      >
                        {busyId === r.customerId ? t.loading : t.sales.showKey}
                      </button>
                      <button type="button" className="btn" onClick={() => void clearHwid(r)}>
                        {t.sales.clearHwid}
                      </button>
                      <Link to={`/sales/${r.customerId}`} className="btn secondary">
                        Aç
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
