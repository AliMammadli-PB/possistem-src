import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useI18n } from '../i18n';

type Lang = 'az' | 'en' | 'ru';
type PlanText = { name: string; badge: string; tagline: string; features: string[] };
type Plan = {
  id: string;
  nameAz: string;
  monthlyPriceMinor: number | string;
  content: Partial<Record<Lang, PlanText>> | null;
};
type Draft = {
  price: string;
  texts: Record<Lang, { name: string; badge: string; tagline: string; features: string }>;
};

const LANGS: { id: Lang; label: string }[] = [
  { id: 'az', label: 'AZ' },
  { id: 'en', label: 'EN' },
  { id: 'ru', label: 'RU' },
];

function toDraft(plan: Plan): Draft {
  const n = Number(plan.monthlyPriceMinor) || 0;
  const texts = {} as Draft['texts'];
  for (const { id } of LANGS) {
    const c = plan.content?.[id];
    texts[id] = {
      name: c?.name ?? (id === 'az' ? plan.nameAz : ''),
      badge: c?.badge ?? '',
      tagline: c?.tagline ?? '',
      features: (c?.features ?? []).join('\n'),
    };
  }
  return { price: n > 0 ? (n / 100).toFixed(2) : '', texts };
}

function toContent(draft: Draft): Record<Lang, PlanText> {
  const out = {} as Record<Lang, PlanText>;
  for (const { id } of LANGS) {
    const t = draft.texts[id];
    out[id] = {
      name: t.name.trim(),
      badge: t.badge.trim(),
      tagline: t.tagline.trim(),
      features: t.features
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }
  return out;
}

export function SubscriptionPlansPage() {
  const t = useI18n();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [lang, setLang] = useState<Record<string, Lang>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ plans: Plan[] }>('/subscription-plans');
      setPlans(data.plans);
      setDrafts(Object.fromEntries(data.plans.map((p) => [p.id, toDraft(p)])));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    }
  }, [t.common.error]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(planId: string, l: Lang, field: keyof Draft['texts'][Lang], value: string) {
    setDrafts((prev) => {
      const d = prev[planId]!;
      return { ...prev, [planId]: { ...d, texts: { ...d.texts, [l]: { ...d.texts[l], [field]: value } } } };
    });
  }

  async function save(plan: Plan) {
    const draft = drafts[plan.id]!;
    const manat = Number(draft.price.replace(',', '.') || '0');
    if (!Number.isFinite(manat) || manat < 0) {
      setError('Qiymət düzgün deyil');
      return;
    }
    const content = toContent(draft);
    if (!content.az.name) {
      setError('AZ adı boş ola bilməz');
      return;
    }
    setSavingId(plan.id);
    setError(null);
    setNotice(null);
    try {
      await api(`/subscription-plans/${encodeURIComponent(plan.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ monthlyPriceMinor: Math.round(manat * 100), content }),
      });
      setNotice(`${content.az.name}: yadda saxlanıldı — saytda dərhal görünür`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.common.error);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Tariflər</h1>
          <p className="muted">
            possistem.az saytındakı plan kartları. Qiyməti 0 və ya boş qoysanız, saytda «Qiymət üçün sorğu
            göndərin» yazılır. Nişanı olan plan (məs. «Populyar») saytda seçilmiş görünür. EN/RU boş qalsa, həmin
            dildə standart mətn göstərilir.
          </p>
        </div>
      </header>

      {error ? (
        <div className="banner-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <p className="plans-admin-notice" role="status">
          {notice}
        </p>
      ) : null}

      {!plans ? (
        <p className="muted">{t.loading}</p>
      ) : (
        <div className="plans-admin-grid">
          {plans.map((plan) => {
            const draft = drafts[plan.id];
            if (!draft) return null;
            const l = lang[plan.id] ?? 'az';
            const text = draft.texts[l];
            const busy = savingId === plan.id;
            return (
              <article key={plan.id} className="plans-admin-card">
                <div className="plans-admin-head">
                  <h2>{draft.texts.az.name || plan.id}</h2>
                  <div className="support-filters" role="tablist" aria-label="Dil">
                    {LANGS.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        role="tab"
                        aria-selected={l === x.id}
                        className={`chip${l === x.id ? ' active' : ''}`}
                        onClick={() => setLang((prev) => ({ ...prev, [plan.id]: x.id }))}
                      >
                        {x.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="plans-admin-field">
                  <span>Aylıq qiymət (₼)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={draft.price}
                    disabled={busy}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [plan.id]: { ...draft, price: e.target.value } }))}
                  />
                </label>
                <label className="plans-admin-field">
                  <span>Ad ({l.toUpperCase()})</span>
                  <input value={text.name} maxLength={40} disabled={busy} onChange={(e) => edit(plan.id, l, 'name', e.target.value)} />
                </label>
                <label className="plans-admin-field">
                  <span>Nişan — boş qoysanız göstərilmir</span>
                  <input
                    value={text.badge}
                    maxLength={24}
                    placeholder="Populyar"
                    disabled={busy}
                    onChange={(e) => edit(plan.id, l, 'badge', e.target.value)}
                  />
                </label>
                <label className="plans-admin-field">
                  <span>Alt başlıq</span>
                  <input
                    value={text.tagline}
                    maxLength={80}
                    placeholder="1 obyekt / filial"
                    disabled={busy}
                    onChange={(e) => edit(plan.id, l, 'tagline', e.target.value)}
                  />
                </label>
                <label className="plans-admin-field">
                  <span>Xüsusiyyətlər — hər sətir bir bənd</span>
                  <textarea
                    rows={9}
                    value={text.features}
                    disabled={busy}
                    onChange={(e) => edit(plan.id, l, 'features', e.target.value)}
                  />
                </label>

                <button type="button" className="btn" disabled={busy} onClick={() => void save(plan)}>
                  {busy ? 'Saxlanılır…' : 'Saxla'}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
