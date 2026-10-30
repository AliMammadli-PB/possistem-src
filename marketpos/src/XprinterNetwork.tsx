import { useState } from 'react';
import { LoaderCircle, Network, Search, ShieldCheck, Wand2 } from 'lucide-react';
import type { Lang, SessionUser } from './types';

type Device = { mac: string; ip: string; mask: string; gateway: string; dhcp: boolean };
type Draft = { ip: string; mask: string; gateway: string };
type Adapter = { ip: string; mask: string; gateway: string };

const num = (text: string) => text.split('.').reduce((acc, part) => acc * 256 + (Number(part) || 0), 0) >>> 0;
const txt = (n: number) => [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
const sameNet = (a: Adapter, ip: string) => ((num(a.ip) & num(a.mask)) >>> 0) === ((num(ip) & num(a.mask)) >>> 0);
/** This PC's subnet with the printer's own host part (192.168.0.176 → 192.168.100.176), PC's mask and gateway. */
export function matchComputer(pc: Adapter, printerIp: string): Draft {
  const mask = num(pc.mask), net = (num(pc.ip) & mask) >>> 0;
  const bad = (n: number) => { const host = (n & ~mask) >>> 0; return host === 0 || host === (~mask >>> 0) || txt(n) === pc.ip || txt(n) === pc.gateway; };
  let n = (net | (num(printerIp) & ~mask)) >>> 0;
  if (bad(n)) n = (net | 200) >>> 0;
  return { ip: txt(n), mask: pc.mask, gateway: pc.gateway };
}

/**
 * Parametrlər → Printer: an Ethernet Xprinter's own IP / mask / gateway through the official SDK.
 * TSX port of PsXprinterNetwork (restoranpos/subscription/components.js). Success means the new
 * settings were read back from the device; a sent command alone is reported as unconfirmed.
 */
export function XprinterNetworkCard({ session, lang, notify }: { session: SessionUser; lang: Lang; notify: (s: string) => void }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  const api = window.marketSystem?.printer, token = session.sessionToken;
  const [devices, setDevices] = useState<Device[]>([]), [selected, setSelected] = useState<Device | null>(null), [adapters, setAdapters] = useState<Adapter[]>([]), [blocked, setBlocked] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ip: '', mask: '', gateway: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [verified, setVerified] = useState<boolean | null>(null), [confirm, setConfirm] = useState(false);
  if (!api?.xprinterDiscover || !api.xprinterConfigure) return null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setBusy(false); }
  };
  const unwrap = <T,>(r: { success: boolean; data?: T | null; error?: { message?: string } | null }) => { if (!r.success || !r.data) throw new Error(r.error?.message || t('Printer əməliyyatı alınmadı', 'Операция принтера не удалась', 'Printer operation failed')); return r.data; };
  const scan = () => run(async () => {
    setVerified(null); setSelected(null); setConfirm(false);
    const result = unwrap(await api.xprinterDiscover!(token)), found = result.devices ?? [];
    setDevices(found); setAdapters(result.adapters ?? []); setBlocked(result.firewall === false);
    if (!found.length) setError(result.firewall === false
      ? t('Windows firewall printerin cavabını bağlayır. “İcazə ver (Administrator)” düyməsini basın və Windows-un sualına “Bəli” deyin.', 'Брандмауэр Windows блокирует ответ принтера. Нажмите «Разрешить (администратор)» и ответьте «Да».', 'Windows Firewall blocks the printer’s reply. Press “Allow (Administrator)” and answer “Yes” to Windows.')
      : t('Xprinter tapılmadı. Printerin Ethernet kabelinin bu kompüterin routerinə qoşulduğunu yoxlayın.', 'Xprinter не найден. Проверьте, что кабель принтера подключён к роутеру этого компьютера.', 'No Xprinter found. Check that its Ethernet cable is connected to this computer’s router.'));
  });
  const grant = async () => {
    let granted = false;
    await run(async () => { await api.xprinterFirewall!(token); granted = true; setBlocked(false); });
    if (granted) await scan();
  };
  const apply = () => run(async () => {
    const r = unwrap(await api.xprinterConfigure!(token, { ...draft, mac: selected!.mac, oldIp: selected!.ip, confirmed: true }));
    setVerified(r.verified); setConfirm(false);
    if (r.verified) { const next = { ...selected!, ...draft, dhcp: false }; setSelected(next); setDevices(devices.map((d) => (d.mac === next.mac ? next : d))); }
  });
  // The till still prints to the old address until it is pointed at the new one.
  const retarget = () => run(async () => { await api.setTarget(token, `tcp:${draft.ip}:9100`); notify(t('Kassa printeri yeni IP-yə yönəldildi', 'Касса печатает на новый IP', 'The till now prints to the new IP')); });
  const pc = adapters[0], mismatch = Boolean(selected && pc && (!adapters.some((a) => sameNet(a, selected.ip)) || selected.gateway !== pc.gateway));
  const fields: Array<[keyof Draft, string]> = [['ip', t('Yeni IP ünvanı', 'Новый IP-адрес', 'New IP address')], ['mask', t('Alt şəbəkə maskası', 'Маска подсети', 'Subnet mask')], ['gateway', t('Default gateway / şlüz', 'Шлюз по умолчанию', 'Default gateway')]];
  return <section className="panel-card settings-card"><div className="panel-title"><h3>{t('Xprinter — IP və gateway', 'Xprinter — IP и шлюз', 'Xprinter — IP and gateway')}</h3><Network/></div>
    <p className="hint">{t('Ethernet şəbəkəsində Xprinter-i MAC ünvanı ilə seçin. Kompüterin şəbəkə ayarları dəyişmir.', 'Выберите Xprinter в сети Ethernet по MAC-адресу. Настройки сети компьютера не меняются.', 'Select an Ethernet Xprinter by MAC address. The computer’s network settings stay unchanged.')}</p>
    <div className="button-row"><button type="button" disabled={busy} onClick={() => void scan()}>{busy ? <LoaderCircle className="spin"/> : <Search/>}{t('Şəbəkədə Xprinter axtar', 'Найти Xprinter в сети', 'Find Xprinter on network')}</button></div>
    {blocked && !devices.length && api.xprinterFirewall && <div className="button-row"><button type="button" className="primary-action" disabled={busy} onClick={() => void grant()}><ShieldCheck/>{t('İcazə ver (Administrator)', 'Разрешить (администратор)', 'Allow (Administrator)')}</button></div>}
    {devices.length > 0 && <label className="activation-input">{t('Printer — MAC / cari IP', 'Принтер — MAC / текущий IP', 'Printer — MAC / current IP')}
      <select disabled={busy} value={selected?.mac ?? ''} onChange={(e) => { const d = devices.find((x) => x.mac === e.target.value) ?? null; setSelected(d); setDraft(d ? { ip: d.ip, mask: d.mask, gateway: d.gateway } : { ip: '', mask: '', gateway: '' }); setVerified(null); setConfirm(false); }}>
        <option value="">{t('Printer seçin', 'Выберите принтер', 'Select printer')}</option>
        {devices.map((d) => <option key={d.mac} value={d.mac}>{`${d.mac} · ${d.ip} · gw ${d.gateway}${d.dhcp ? ' · DHCP' : ''}`}</option>)}
      </select></label>}
    {mismatch && selected && pc && <div className="xprinter-match"><p>{t('Printer bu kompüterlə eyni şəbəkədə deyil: printer ', 'Принтер не в сети этого компьютера: принтер ', 'The printer is not on this computer’s network: printer ')}{selected.ip} (gw {selected.gateway}), {t('kompüter ', 'компьютер ', 'computer ')}{pc.ip} (gw {pc.gateway}).</p>
      <button type="button" disabled={busy} onClick={() => { setDraft(matchComputer(pc, selected.ip)); setConfirm(false); setVerified(null); }}><Wand2/>{t('Kompüterin şəbəkəsinə uyğunlaşdır', 'Подстроить под сеть компьютера', 'Match this computer’s network')}</button></div>}
    {selected && <>
      {fields.map(([key, label]) => <label key={key} className="activation-input">{label}<input inputMode="decimal" maxLength={15} disabled={busy} value={draft[key]} onChange={(e) => { setDraft({ ...draft, [key]: e.target.value }); setConfirm(false); }}/></label>)}
      <div className="button-row"><button type="button" className="primary-action" disabled={busy} onClick={() => (confirm ? void apply() : setConfirm(true))}>
        {busy && confirm ? t('Printer yenidən başlayır, 30 saniyəyə qədər gözləyin…', 'Принтер перезапускается, подождите до 30 секунд…', 'The printer is restarting, wait up to 30 seconds…') : confirm ? t('Təsdiq et: printer bağlantısı yenilənəcək', 'Подтвердить: подключение принтера изменится', 'Confirm: printer connection will change') : t('Statik IP və gateway tətbiq et', 'Применить статический IP и шлюз', 'Apply static IP and gateway')}</button></div>
    </>}
    {verified === true && <><p role="status">{t('Yeni IP, maska və gateway printerdən oxunub təsdiqləndi.', 'Новые IP, маска и шлюз подтверждены принтером.', 'The printer reported and confirmed the new IP, mask and gateway.')}</p>
      <div className="button-row"><button type="button" disabled={busy} onClick={() => void retarget()}>{t('Kassanı bu IP-yə çap etdir', 'Печатать на этот IP', 'Print to this IP')}</button></div></>}
    {verified === false && <p className="settings-error" role="alert">{t('Əmr göndərildi, amma yeni ayarlar printerdən təsdiqlənmədi. Printeri və şəbəkəni yoxlayıb yenidən axtarın.', 'Команда отправлена, но принтер не подтвердил настройки. Проверьте принтер и сеть и повторите поиск.', 'The command was sent, but the new settings were not confirmed. Check the printer and network, then search again.')}</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
