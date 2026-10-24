import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useProduct } from '../lib/product';
import { useI18n } from '../i18n';
import { EmailEditor } from '../components/EmailEditor';

type ResellerOption = { id: string; name: string };
type PosProduct = 'restaurant' | 'market';

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
  product: PosProduct | null;
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

function productLabel(product: PosProduct | null | undefined): string {
  if (product === 'market') return 'Market POS';
  if (product === 'restaurant') return 'Restoran POS';
  // No license yet — do not guess, or a missing value reads as a real sale.
  return '—';
}

type LiveSummary = Record<
  string,
  { connected: boolean; lastSeenAt: string | null; openTables: number; restaurantName: string | null }
>;

export function SalesPage() {
  const t = useI18n();
  const { product } = useProduct();
  const [rows, setRows] = useState<Sale[] | null>(null);
  const [liveSummary, setLiveSummary] = useState<LiveSummary>({});
  const [resellers, setResellers] = useState<ResellerOption[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter) params.set('resellerId', filter);
    // Driven by the global product switch in the topbar rather than a local
    // dropdown, so the whole panel shows one product at a time.
    if (product) params.set('product', product);
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
  }, [filter, product, t.common.error]);

  useEffect(load, [load]);

  useEffect(() => {
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

  /** POSSISTEM-in öz uzatması — kredit silinmir; kassa yeni tarixi heartbeat ilə alır. */
  const renew = async (row: Sale, days: number) => {
    if (!row.licenseId) return;
    if (!window.confirm(`${row.name} — lisenziya ${days} gün uzadılsın? (bitibsə bu gündən, bitməyibsə bitmə tarixindən sayılır)`)) return;
    setError(null);
    setNotice(null);
    setBusyId(row.customerId);
    try {
      const data = await api<{ validUntil: string }>(`/licenses/${row.licenseId}/renew`, {
        method: 'POST',
        body: JSON.stringify({ days }),
      });
      setNotice(`${row.name}: yeni bitmə tarixi ${formatDate(data.validUntil)}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setBusyId(null);
    }
  };

  const regenerateKey = async (row: Sale) => {
    if (!window.confirm(`${row.name} — ${t.sales.showKeyConfirm}`)) return;
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
        body: '{}',
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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.sales.title}</h1>
        </div>
        <div className="header-filters">
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
        </div>
      </header>
      <p className="muted">{t.sales.hint}</p>

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

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <div className="section-heading">
          <h2>{t.sales.title}</h2>
          <Link to="/new-customer">{t.nav.newCustomer} →</Link>
        </div>
        {rows && rows.length === 0 && (
          <p className="muted" style={{ marginTop: '.8rem' }}>
            {t.sales.empty}
          </p>
        )}
        {rows && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.sales.colCustomer}</th>
                  <th>{t.sales.colProduct}</th>
                  <th>{t.live.colPos}</th>
                  <th>{t.sales.colEmail}</th>
                  <th>{t.sales.colAddress}</th>
                  <th>{t.sales.colSeller}</th>
                  <th>{t.sales.colExpires}</th>
                  <th>{t.sales.colStatus}</th>
                  <th>{t.sales.colDevices}</th>
                  <th>{t.sales.colKey}</th>
                  <th>{t.sales.colDate}</th>
                  <th>{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const live = liveSummary[r.customerId];
                  const liveHref = r.product
                    ? `/sales/${r.customerId}?product=${r.product}`
                    : `/sales/${r.customerId}`;
                  return (
                  <tr key={r.licenseId ?? r.customerId}>
                    <td>
                      <Link to={liveHref} className="customer-link">
                        {r.name}
                      </Link>
                      {(r.contactPerson || r.phone) && (
                        <>
                          <br />
                          <small className="muted">
                            {[r.contactPerson, r.phone].filter(Boolean).join(' · ')}
                          </small>
                        </>
                      )}
                      {r.voen && (
                        <>
                          <br />
                          <small className="muted mono">VÖEN {r.voen}</small>
                        </>
                      )}
                    </td>
                    <td>{productLabel(r.product)}</td>
                    <td>
                      {live ? (
                        <>
                          <span
                            className="live-dot"
                            data-online={live.connected ? '1' : '0'}
                            aria-hidden
                          />
                          {live.connected ? t.live.online : live.lastSeenAt ? t.live.offline : t.live.never}
                          {live.openTables > 0 && (
                            <>
                              <br />
                              <small className="muted">
                                {live.openTables} {t.live.openTablesShort}
                              </small>
                            </>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <EmailEditor
                        customerId={r.customerId}
                        customerName={r.name}
                        email={r.email}
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
                    </td>
                    <td className="wrap-cell">{r.address ?? '—'}</td>
                    <td>{r.resellerName ?? t.dashboard.direct}</td>
                    <td>{formatDate(r.validUntil)}</td>
                    <td>{statusLabel(r.status)}</td>
                    <td className="mono">
                      {r.redeemCount ?? 0}/{r.maxDevices ?? 0}
                    </td>
                    <td>
                      <small className="muted">{r.keyLabel ?? '—'}</small>
                      <br />
                      <button
                        type="button"
                        className="btn"
                        disabled={!r.activationKeyId || busyId === r.customerId}
                        onClick={() => void regenerateKey(r)}
                      >
                        {busyId === r.customerId ? t.loading : t.sales.showKey}
                      </button>
                    </td>
                    <td>{formatDate(r.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn" onClick={() => void clearHwid(r)}>
                          {t.sales.clearHwid}
                        </button>
                        {r.licenseId && r.status !== 'revoked' && (
                          <select
                            aria-label="Uzat"
                            value=""
                            disabled={busyId === r.customerId}
                            onChange={(e) => {
                              const days = Number(e.target.value);
                              if (days > 0) void renew(r, days);
                            }}
                          >
                            <option value="">Uzat…</option>
                            <option value="7">7 gün</option>
                            <option value="30">30 gün</option>
                            <option value="90">90 gün</option>
                            <option value="180">180 gün</option>
                            <option value="365">365 gün</option>
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
