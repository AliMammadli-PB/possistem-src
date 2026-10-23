import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useI18n } from '../i18n';
import { useProduct } from '../lib/product';
import { EmailEditor } from '../components/EmailEditor';

/**
 * What is happening with the product the operator picked.
 *
 * It used to count every customer and every licence POSSISTEM has ever had and
 * label the result "Ümumi satış" — a number that is neither a sale nor about
 * the product on screen. Worse, it was the first thing anyone saw, so the panel
 * opened on figures that answered nobody's question.
 *
 * The figures here are the ones an operator acts on: how many shops run this
 * product, how many tills are plugged in and how many of those are actually
 * talking to us, what the update feed is handing out, and what is waiting.
 */
type RecentSale = {
  customerId: string;
  name: string;
  email: string | null;
  createdAt: string;
  resellerName: string | null;
  status: string | null;
};

type Scoped = {
  product: 'restaurant' | 'market';
  shops: number;
  activeLicenses: number;
  thisMonth: number;
  tills: number;
  tillsOnline: number;
  openTickets: number;
  release: { version: string; fileName: string } | null;
  versions: { version: string; count: number; lastSeenAt: string | null; current: boolean }[];
  behind: number;
  recent: RecentSale[];
};

type Stats = {
  scoped: Scoped | null;
  db: 'up' | 'down';
  version: string;
};

export function DashboardPage() {
  const t = useI18n();
  const { product } = useProduct();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    setError(null);
    void api<Stats>(`/dashboard/stats?product=${product}`)
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : t.common.error));
  }, [product, t.common.error]);

  const healthy = stats?.db === 'up';
  const scoped = stats?.scoped ?? null;
  const productName = product === 'market' ? t.nav.productMarket : t.nav.productRestaurant;

  const setEmail = (customerId: string, email: string | null) => {
    setStats((prev) =>
      prev?.scoped
        ? {
            ...prev,
            scoped: {
              ...prev.scoped,
              recent: prev.scoped.recent.map((r) =>
                r.customerId === customerId ? { ...r, email } : r,
              ),
            },
          }
        : prev,
    );
    setNotice(t.sales.emailUpdated);
  };

  const removeSale = (customerId: string) => {
    setStats((prev) =>
      prev?.scoped
        ? {
            ...prev,
            scoped: {
              ...prev.scoped,
              shops: Math.max(0, prev.scoped.shops - 1),
              recent: prev.scoped.recent.filter((r) => r.customerId !== customerId),
            },
          }
        : prev,
    );
    setNotice(t.sales.saleDeleted);
  };

  // A till that has not spoken in fifteen minutes is either a shop that closed
  // or a sync that broke, and the second one is worth chasing today.
  const silent = scoped ? Math.max(0, scoped.tills - scoped.tillsOnline) : 0;

  return (
    <div className="page">
      <header className="dashboard-hero">
        <div>
          <p className="eyebrow">{productName}</p>
          <h1>{t.dashboard.title}</h1>
          <p className="hero-copy">{t.dashboard.hint}</p>
        </div>
        {stats && (
          <div className="health-summary">
            <span
              className="health-pulse"
              style={healthy ? undefined : { background: '#b85248', boxShadow: 'none' }}
            />
            <div>
              <strong>{healthy ? t.dashboard.healthy : t.dashboard.unhealthy}</strong>
              <small>v{stats.version}</small>
            </div>
          </div>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="stat-grid">
        <div className="stat">
          <span className="stat-label">{t.dashboard.shops}</span>
          <div className="stat-value">{scoped?.shops ?? '—'}</div>
        </div>
        <div className="stat">
          <span className="stat-label">{t.dashboard.activeLicenses}</span>
          <div className="stat-value">{scoped?.activeLicenses ?? '—'}</div>
        </div>
        <div className="stat">
          <span className="stat-label">{t.dashboard.tillsOnline}</span>
          <div className="stat-value">
            {scoped ? `${scoped.tillsOnline}/${scoped.tills}` : '—'}
          </div>
          {scoped && silent > 0 && (
            <span className="stat-foot">{t.dashboard.tillsSilent(silent)}</span>
          )}
        </div>
        <div className="stat">
          <span className="stat-label">{t.dashboard.thisMonth}</span>
          <div className="stat-value">{scoped?.thisMonth ?? '—'}</div>
        </div>
        <div className="stat">
          <span className="stat-label">{t.dashboard.openTickets}</span>
          <div className="stat-value">{scoped?.openTickets ?? '—'}</div>
          {scoped && scoped.openTickets > 0 && (
            <Link className="stat-foot" to="/support">
              {t.nav.support} →
            </Link>
          )}
        </div>
      </section>

      {/* The panel hands out this installer and every till updates from it, so
          a feed that is stale or missing is something to see here rather than
          hear about from a shop. */}
      <section className="card release-card">
        <div className="section-heading">
          <h2>{t.dashboard.release}</h2>
          <Link to="/setup">{t.nav.setup} →</Link>
        </div>
        {scoped?.release ? (
          <p className="release-line">
            <strong>{scoped.release.version}</strong>
            <span className="mono muted">{scoped.release.fileName}</span>
            {scoped.behind > 0 && (
              <span className="release-behind">{t.dashboard.behind(scoped.behind)}</span>
            )}
          </p>
        ) : (
          <p className="error" role="alert">
            {t.dashboard.releaseMissing}
          </p>
        )}

        {/* The spread, not a flag: the till nobody has touched since August is
            the one worth seeing, and an "up to date" badge hides it. */}
        {scoped && scoped.versions.length > 0 && (
          <div className="table-wrap" style={{ marginTop: '.9rem' }}>
            <table>
              <thead>
                <tr>
                  <th>{t.dashboard.colVersion}</th>
                  <th>{t.dashboard.colTills}</th>
                  <th>{t.dashboard.colLastSeen}</th>
                </tr>
              </thead>
              <tbody>
                {scoped.versions.map((row) => (
                  <tr key={row.version}>
                    <td className="mono">
                      {row.version}
                      {row.current && <span className="version-current"> ✓</span>}
                    </td>
                    <td>{row.count}</td>
                    <td className={row.lastSeenAt ? undefined : 'muted'}>
                      {row.lastSeenAt
                        ? new Date(row.lastSeenAt).toLocaleString('az-AZ', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: '1.2rem' }}>
        <div className="section-heading">
          <h2>{t.dashboard.recent}</h2>
          <Link to="/sales">{t.nav.sales} →</Link>
        </div>
        {scoped && scoped.recent.length === 0 && (
          <p className="muted" style={{ marginTop: '.8rem' }}>
            {t.dashboard.recentEmpty}
          </p>
        )}
        {scoped && scoped.recent.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.sales.colCustomer}</th>
                  <th>{t.sales.colEmail}</th>
                  <th>{t.sales.colSeller}</th>
                  <th>{t.sales.colDate}</th>
                </tr>
              </thead>
              <tbody>
                {scoped.recent.map((r) => (
                  <tr key={r.customerId}>
                    <td>
                      <Link to={`/sales/${r.customerId}?product=${product}`}>{r.name}</Link>
                    </td>
                    <td>
                      <EmailEditor
                        customerId={r.customerId}
                        customerName={r.name}
                        email={r.email}
                        onSaved={(email) => setEmail(r.customerId, email)}
                        onDeleted={() => removeSale(r.customerId)}
                        onError={(msg) => {
                          setError(msg || null);
                          if (msg) setNotice(null);
                        }}
                      />
                    </td>
                    <td>{r.resellerName ?? t.dashboard.direct}</td>
                    <td>{new Date(r.createdAt).toLocaleDateString('az-AZ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
