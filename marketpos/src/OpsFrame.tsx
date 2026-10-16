import { useEffect, useState } from 'react';
import { Boxes, RefreshCw, TriangleAlert } from 'lucide-react';

import { settingsText } from './settingsText';
import { HardwareSettingsCard } from './RetailOpsPanels';
import type { Lang, SessionUser } from './types';

type OpsStatus = { host: boolean; state: string; available: boolean };

/**
 * Əməliyyatlar (1.5.0): the restaurant's warehouse system - Mallar,
 * Kateqoriyalar, Anbar, İnventarizasiya, Alışlar, Partnyorlar, Kassalar,
 * Qazanc, Xərclər, Satışlar - shown inside MarketPos. Its screens run in a
 * frame and reach the warehouse core through window.marketOps (main checks
 * this user's session on every call).
 */
export function OpsFrame({ session, notify, catalogOnly = false }: { session: SessionUser; notify: (text: string) => void; catalogOnly?: boolean }) {
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
  return <iframe className="ops-frame" title="Əməliyyatlar" src={`./ops/index.html${catalogOnly ? "?panel=catalog" : ""}#/operations?tab=goods`} />;
}

/**
 * Parametrlər → Çek dizaynı (1.5.1): the restaurant's receipt settings - logo,
 * QR code, header, paper width, font and the receipt preview. Receipts print
 * in this design (electron/hardware-ipc.cjs, receipt.renderExternal).
 */
export function ReceiptDesignCard({ session, lang, panel = 'receipt' }: { session: SessionUser; lang: Lang; panel?: string }) {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  (window as unknown as { __marketOpsToken?: string }).__marketOpsToken = session.sessionToken;
  useEffect(() => {
    let alive = true;
    const check = () => { void window.marketOps?.status().then((s) => { if (alive) { setStatus(s); setFailed(false); } }).catch(() => { if (alive) setFailed(true); }); };
    check();
    const timer = window.setInterval(check, 3000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const text = (az: string, ru: string, en: string) => settingsText(lang, az, ru, en);
  const ready = status?.state === 'ready';
  return <section className="receipt-design-card">
    {notice && <p role="status">{notice}</p>}
    {window.marketOps && ready ? <iframe key={panel} className="ops-frame receipt-frame" title={panel === 'printer' ? text('Printer seçimi', 'Выбор принтера', 'Printer selection') : text('Çek dizaynı və önizləmə', 'Дизайн и просмотр чека', 'Receipt design and preview')} src={`./ops/index.html?panel=${panel}#/settings`}/> :
      <div className="settings-loading" role="status"><TriangleAlert/><h3>{failed ? text('Çek sisteminə qoşulmaq alınmadı', 'Нет связи с системой чеков', 'Receipt system unavailable') : status?.host === false ? text('Çek sistemi əsas anbar kassasındadır', 'Чеки на основной складской кассе', 'Receipt design is on the main stock till') : text('Çek sistemi hazırlanır…', 'Система чеков запускается…', 'Preparing receipt system…')}</h3>
      <p>{text('Əsas kassanı açıq saxlayın. Aşağıdakı cihaz ayarları bu kompüterin printerini idarə edir.', 'Основная касса должна быть включена. Ниже настройки принтера этого компьютера.', 'Keep the main till running. The settings below control this computer’s printer.')}</p>
      {panel === 'printer' && <HardwareSettingsCard session={session} lang={lang} notify={setNotice}/>}</div>}
  </section>;
}
