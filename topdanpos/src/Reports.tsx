/**
 * The two reports a wholesale owner opens every day: who owes how much, and
 * who bought how much (last 30 days, split into paid and nisyə).
 */
import { useEffect, useMemo, useState } from 'react';
import { BookUser, HandCoins } from 'lucide-react';

import { loadCustomers, TierBadge } from './Customers';
import { money } from './format';
import { tr } from './i18n';
import type { Customer } from './wholesale';
import type { Lang, PersistedState } from './types';

const DAY = 86_400_000;

export function WholesaleReports({ state, lang, coreReady }: { state: PersistedState; lang: Lang; coreReady: boolean }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  useEffect(() => { if (coreReady) void loadCustomers().then(setCustomers).catch(() => undefined); }, [coreReady, state.sales.length]);
  const debtors = customers.filter((row) => row.balanceMinor > 0).sort((a, b) => b.balanceMinor - a.balanceMinor);
  const buyers = useMemo(() => {
    const since = Date.now() - 30 * DAY;
    const map = new Map<string, { name: string; count: number; total: number; credit: number }>();
    for (const sale of state.sales) {
      if (sale.refunded || sale.createdAt < since) continue;
      const key = sale.customerId || '';
      const row = map.get(key) ?? { name: sale.customerName || customers.find((c) => c.id === key)?.name || tr(lang, 'walkIn'), count: 0, total: 0, credit: 0 };
      row.count += 1;
      row.total += sale.totalMinor;
      row.credit += sale.creditMinor ?? sale.payment.creditMinor ?? 0;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 15);
  }, [state.sales, customers, lang]);
  return (
    <section className="wholesale-reports">
      <article className="data-card">
        <div className="data-title"><div><h2><HandCoins /> {tr(lang, 'debtorsReport')}</h2><span>{debtors.length} · {money(debtors.reduce((sum, row) => sum + row.balanceMinor, 0), lang)}</span></div></div>
        {!debtors.length && <p className="shelf-empty">{tr(lang, 'noDebtors')}</p>}
        <div className="report-rows">
          {debtors.slice(0, 15).map((row) => (
            <div key={row.id}><span><b>{row.name}</b><small>{[row.voen && `VÖEN ${row.voen}`, row.phone].filter(Boolean).join(' · ')}</small></span><TierBadge tier={row.priceTier} lang={lang} /><em className="debt">{money(row.balanceMinor, lang)}</em></div>
          ))}
        </div>
      </article>
      <article className="data-card">
        <div className="data-title"><div><h2><BookUser /> {tr(lang, 'buyersReport')}</h2><span>{tr(lang, 'last30days')}</span></div></div>
        {!buyers.length && <p className="shelf-empty">{tr(lang, 'noResults')}</p>}
        <div className="report-rows">
          {buyers.map((row) => (
            <div key={row.name}><span><b>{row.name}</b><small>{row.count} {tr(lang, 'invoicesWord')}{row.credit ? ` · ${tr(lang, 'credit')} ${money(row.credit, lang)}` : ''}</small></span><em>{money(row.total, lang)}</em></div>
          ))}
        </div>
      </article>
    </section>
  );
}
