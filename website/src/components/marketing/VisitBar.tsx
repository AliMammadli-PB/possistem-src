'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';

type VisitStats = { total: number; today: number };
const COPY = {
  az: { title: 'Sayt ziyarətləri', total: 'Ümumi ziyarət', today: 'Bu gün' },
  en: { title: 'Website visits', total: 'Total visits', today: 'Today' },
  ru: { title: 'Посещения сайта', total: 'Всего посещений', today: 'Сегодня' },
};

export function VisitBar() {
  const { language, locale } = useI18n();
  const [stats, setStats] = useState<VisitStats | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/pos/api/public/visits', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/' }), signal: ctrl.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: VisitStats | null) => {
        if (data && Number.isSafeInteger(data.total) && data.total >= 0 &&
            Number.isSafeInteger(data.today) && data.today >= 0) setStats(data);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  // A small public counter ("707 visits") weakens a B2B page: it appears once the total is worth showing.
  if (!stats || stats.total < 10000) return null;
  const copy = COPY[language];
  const number = new Intl.NumberFormat(locale);
  return (
    <section className="visit-pulse" aria-label={copy.title}>
      <span className="visit-pulse-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
      </span>
      <dl className="visit-pulse-metrics">
        <div><dt>{copy.total}</dt><dd>{number.format(stats.total)}</dd></div>
        <div className="visit-pulse-today"><dt>{copy.today}</dt><dd>{number.format(stats.today)}</dd></div>
      </dl>
    </section>
  );
}
