import { useLiveEffect } from '../lib/live';
import { useCallback,  useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useI18n } from '../i18n';

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed';

type Lead = {
  id: string;
  name: string;
  businessName: string;
  phone: string;
  city: string | null;
  message: string | null;
  product?: string | null; /* topdan-product: type */
  source: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
};

type LeadResponse = {
  entries: Lead[];
  newCount: number;
};

const STATUS_ORDER: LeadStatus[] = ['new', 'contacted', 'qualified', 'closed'];

function whatsappUrl(phone: string, businessName: string) {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `994${digits.slice(1)}`;
  if (digits.length === 9) digits = `994${digits}`;
  const text = encodeURIComponent(
    `Salam! ${businessName} üçün göndərdiyiniz possistem sorğusu ilə bağlı yazırıq.`,
  );
  return `https://wa.me/${digits}?text=${text}`;
}

export function LeadsPage() {
  const t = useI18n();
  const [data, setData] = useState<LeadResponse | null>(null);
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      setData(await api<LeadResponse>(`/leads${query}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setLoading(false);
    }
  }, [filter, t.common.error]);

  useLiveEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<LeadStatus, number> = {
      new: 0,
      contacted: 0,
      qualified: 0,
      closed: 0,
    };
    if (filter === 'all') data?.entries.forEach((entry) => result[entry.status]++);
    if (data) result.new = data.newCount;
    return result;
  }, [data, filter]);

  async function updateStatus(id: string, status: LeadStatus) {
    setUpdatingId(id);
    setError(null);
    try {
      const updated = await api<Lead>(`/leads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setData((current) => {
        if (!current) return current;
        const previous = current.entries.find((entry) => entry.id === id);
        let newCount = current.newCount;
        if (previous?.status === 'new' && status !== 'new') newCount = Math.max(0, newCount - 1);
        if (previous && previous.status !== 'new' && status === 'new') newCount += 1;
        const entries = current.entries
          .map((entry) => (entry.id === id ? updated : entry))
          .filter((entry) => filter === 'all' || entry.status === filter);
        return { ...current, entries, newCount };
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{t.brandSub}</p>
          <h1>{t.leads.title}</h1>
          <p className="hero-copy">{t.leads.hint}</p>
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? t.loading : t.leads.refresh}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="lead-stat-grid">
        {STATUS_ORDER.map((status) => (
          <button
            type="button"
            key={status}
            className={`lead-stat ${filter === status ? 'active' : ''}`}
            onClick={() => setFilter(filter === status ? 'all' : status)}
          >
            <span>{t.leads.status[status]}</span>
            <strong>{filter === 'all' || status === 'new' ? counts[status] : '—'}</strong>
          </button>
        ))}
      </section>

      <section className="card lead-inbox">
        <div className="section-heading">
          <h2>{filter === 'all' ? t.leads.all : t.leads.status[filter]}</h2>
          <span className="muted">{data?.entries.length ?? 0} {t.leads.requests}</span>
        </div>

        {loading && <p className="muted lead-empty">{t.loading}</p>}
        {!loading && data?.entries.length === 0 && (
          <p className="muted lead-empty">{t.leads.empty}</p>
        )}

        {!loading && data && data.entries.length > 0 && (
          <div className="lead-list">
            {data.entries.map((lead) => (
              <article className={`lead-row status-${lead.status}`} key={lead.id}>
                <div className="lead-main">
                  <div className="lead-title-line">
                    <span className="lead-status-dot" />
                    <div>
                      <h3>{lead.businessName}</h3>
                      <p>{lead.name}{lead.city ? ` · ${lead.city}` : ''}{/* topdan-product: badge */}{lead.product ? <strong className="lead-product"> · {({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS', aptek: 'Aptek POS', topdan: 'Topdan POS' } as Record<string, string>)[lead.product] ?? lead.product}</strong> : null}</p>
                    </div>
                  </div>
                  {lead.message && <blockquote>{lead.message}</blockquote>}
                  <div className="lead-meta">
                    <span>{new Date(lead.createdAt).toLocaleString('az-AZ')}</span>
                    <span>{lead.source}</span>
                  </div>
                </div>

                <div className="lead-contact">
                  <a
                    className="lead-phone"
                    href={whatsappUrl(lead.phone, lead.businessName)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <small>{t.leads.whatsapp}</small>
                    <strong>{lead.phone}</strong>
                  </a>
                  <label>
                    {t.leads.statusLabel}
                    <select
                      value={lead.status}
                      disabled={updatingId === lead.id}
                      onChange={(event) =>
                        void updateStatus(lead.id, event.target.value as LeadStatus)
                      }
                    >
                      {STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                          {t.leads.status[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
