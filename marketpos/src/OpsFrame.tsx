import { useEffect, useState } from 'react';
import { Boxes, RefreshCw } from 'lucide-react';

import type { SessionUser } from './types';

type OpsStatus = { host: boolean; state: string; available: boolean };

/**
 * Əməliyyatlar (1.5.0): the restaurant's warehouse system - Mallar,
 * Kateqoriyalar, Anbar, İnventarizasiya, Alışlar, Partnyorlar, Kassalar,
 * Qazanc, Xərclər, Satışlar - shown inside MarketPos. Its screens run in a
 * frame and reach the warehouse core through window.marketOps (main checks
 * this user's session on every call).
 */
export function OpsFrame({ session, notify }: { session: SessionUser; notify: (text: string) => void }) {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // The frame reads the token from here; main still verifies it on every call.
  (window as unknown as { __marketOpsToken?: string }).__marketOpsToken = session.sessionToken;

  const refresh = () => { void window.marketOps?.status().then(setStatus).catch(() => setStatus(null)); };
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (status?.state !== 'ready') refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [status?.state]);

  if (!window.marketOps) return <div className="module-page"><p>Əməliyyatlar yalnız MarketPos proqramında açılır.</p></div>;
  if (!status) return <div className="module-page"><p>Yüklənir…</p></div>;

  const setHost = async (host: boolean) => {
    setBusy(true);
    try { setStatus(await window.marketOps!.setHost(session.sessionToken, host)); }
    catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!status.host) {
    return (
      <div className="module-page ops-host-card">
        <section className="page-intro"><div><p>ƏMƏLİYYATLAR</p><h2>Anbar başqa kassadadır</h2>
          <span>Anbar sistemi (mallar, anbar, alışlar, kassalar) bir kompüterdə işləyir. Digər kassalar satır, mallar onlara avtomatik gəlir.</span></div></section>
        {session.role === 'manager' && <button className="primary-action" disabled={busy} onClick={() => void setHost(true)}><Boxes />Anbarı bu kassada işlət</button>}
      </div>
    );
  }
  if (status.state !== 'ready') {
    return (
      <div className="module-page ops-host-card">
        <section className="page-intro"><div><p>ƏMƏLİYYATLAR</p><h2>{status.available ? 'Anbar sistemi açılır…' : 'Anbar sistemi tapılmadı'}</h2>
          <span>{status.available ? `Vəziyyət: ${status.state}` : 'Proqramı yeniləyin və ya yenidən quraşdırın.'}</span></div></section>
        <button disabled={busy} onClick={refresh}><RefreshCw />Yenilə</button>
        {session.role === 'manager' && <button disabled={busy} onClick={() => void setHost(false)}>Bu kassa anbar kompüteri deyil</button>}
      </div>
    );
  }
  return <iframe className="ops-frame" title="Əməliyyatlar" src="./ops/index.html#/operations?tab=goods" />;
}
