'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import defaults from '@/data/pricing-plans.json';
import { formatManat } from '@/lib/money';
import { scrollToSection } from '@/lib/scroll';
import type { Language } from '@/lib/i18n';

type PlanId = 'standart' | 'biznes' | 'premium';
type PlanText = { name: string; badge: string; tagline: string; features: string[] };
type PlanContent = Partial<Record<Language, PlanText>>;
type ApiPlan = { id: string; monthlyPriceMinor: number | string; content?: PlanContent | null };

const PLAN_IDS: PlanId[] = ['standart', 'biznes', 'premium'];
const DEFAULTS = defaults as Record<PlanId, Record<Language, PlanText>>;

const SECTION: Record<Language, {
  eyebrow: string;
  title: string;
  lede: string;
  perMonth: string;
  priceSoon: string;
  cta: string;
  note: string;
}> = {
  az: {
    eyebrow: 'Tariflər',
    title: 'Biznesinizə uyğun planı seçin',
    lede: 'Restoran POS və Market POS üçün eyni planlar. Ödəniş aylıqdır, istənilən vaxt planı dəyişə bilərsiniz.',
    perMonth: '/ ay',
    priceSoon: 'Qiymət üçün sorğu göndərin',
    cta: 'Sorğu göndər',
    note: 'Bütün planlar oflayn işləyir — internet kəsiləndə satış dayanmır.',
  },
  en: {
    eyebrow: 'Pricing',
    title: 'Choose the plan that fits your business',
    lede: 'The same plans for Restaurant POS and Market POS. Billed monthly — switch plans any time.',
    perMonth: '/ month',
    priceSoon: 'Request a quote',
    cta: 'Send request',
    note: 'Every plan works offline — sales keep going when the internet drops.',
  },
  ru: {
    eyebrow: 'Тарифы',
    title: 'Выберите тариф для вашего бизнеса',
    lede: 'Одни и те же тарифы для Restaurant POS и Market POS. Оплата ежемесячно, тариф можно сменить в любой момент.',
    perMonth: '/ мес',
    priceSoon: 'Запросите цену',
    cta: 'Отправить запрос',
    note: 'Все тарифы работают офлайн — продажи не останавливаются без интернета.',
  },
};

/** Texts edited in the admin panel win; a language never filled in there keeps the built-in copy. */
function textFor(id: PlanId, language: Language, content: PlanContent | null | undefined): PlanText {
  const edited = content?.[language];
  return edited?.name ? edited : DEFAULTS[id][language] ?? DEFAULTS[id].az;
}

export function PricingPlans() {
  const { language } = useI18n();
  const copy = SECTION[language] ?? SECTION.az;
  const [plans, setPlans] = useState<Partial<Record<PlanId, ApiPlan>>>({});

  useEffect(() => {
    let alive = true;
    fetch('/pos/api/subscription-plans', { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { plans?: ApiPlan[] } | null) => {
        if (!alive || !data?.plans) return;
        const next: Partial<Record<PlanId, ApiPlan>> = {};
        for (const plan of data.plans) {
          if ((PLAN_IDS as string[]).includes(plan.id)) next[plan.id as PlanId] = plan;
        }
        setPlans(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="marketing-section pricing-section section-defer" id="tarifler">
      <div className="marketing-container">
        <header className="marketing-heading centered reveal">
          <div>
            <span className="marketing-eyebrow">{copy.eyebrow}</span>
            <h2>{copy.title}</h2>
          </div>
          <p>{copy.lede}</p>
        </header>

        <div className="pricing-grid">
          {PLAN_IDS.map((id) => {
            const plan = textFor(id, language, plans[id]?.content);
            const minor = Number(plans[id]?.monthlyPriceMinor) || 0;
            return (
              <article key={id} className={`pricing-card${plan.badge ? ' is-featured' : ''}`}>
                <div className="pricing-card-head">
                  <h3>{plan.name}</h3>
                  {plan.badge && <span className="pricing-badge">{plan.badge}</span>}
                </div>
                {plan.tagline && <p className="pricing-tagline">{plan.tagline}</p>}
                <div className="pricing-price">
                  {minor > 0 ? (
                    <>
                      <strong>{formatManat(minor / 100, language)}</strong>
                      <span>{copy.perMonth}</span>
                    </>
                  ) : (
                    <span className="pricing-price-soon">{copy.priceSoon}</span>
                  )}
                </div>
                <ul className="pricing-features">
                  {plan.features.map((feature, index) => (
                    <li key={`${index}-${feature}`}>{feature}</li>
                  ))}
                </ul>
                <a
                  className={`marketing-button ${plan.badge ? 'primary' : 'secondary'}`}
                  href="#elaqe"
                  onClick={(event) => {
                    event.preventDefault();
                    scrollToSection('elaqe');
                  }}
                >
                  {copy.cta}
                </a>
              </article>
            );
          })}
        </div>

        <p className="pricing-note">{copy.note}</p>
      </div>
    </section>
  );
}
