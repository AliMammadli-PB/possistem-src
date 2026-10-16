import { useEffect, useState } from 'react';
import { Building2, Check, CreditCard, Download, ImagePlus, KeyRound, Monitor, Printer, ReceiptText, RefreshCw, ShieldCheck, Store, ShoppingBag, Boxes, X } from 'lucide-react';
import type { ActivationStatus, Lang, PersistedState, SessionUser, StoreSettings, UpdateStatus } from './types';
import { Field } from './forms';
import { tr } from './i18n';
import { settingsText } from './settingsText';
import { HardwareSettingsCard } from './RetailOpsPanels';
import { KitchenStationsCard } from './KitchenStations';
import { OpsFrame, ReceiptDesignCard } from './OpsFrame';

export function SettingsPage({ state, session, lang, coreReady, notify, onSettings }: { state: PersistedState; session: SessionUser; lang: Lang; coreReady: boolean; notify: (text: string) => void; onSettings: (settings: StoreSettings) => Promise<void> }) {
  const [section, setSection] = useState('store');
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(state.settings); const [display, setDisplay] = useState<{ prefs: { mode: 'fullscreen' | 'windowed'; width: number; height: number; zoomFactor: number }; presets: Array<{ id: string; label: string; mode: 'fullscreen' | 'windowed'; width: number; height: number }> } | null>(null);
  const [activation, setActivation] = useState<ActivationStatus | null>(null); const [activationKey, setActivationKey] = useState(''); const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' }); const [info, setInfo] = useState<{ version: string; updateUrl: string; controlUrl: string; packaged: boolean } | null>(null); const [message, setMessage] = useState(''); const [checkingUpdate, setCheckingUpdate] = useState(false);
  useEffect(() => { if (!window.marketSystem) return; void window.marketSystem.display.get().then(setDisplay); void window.marketSystem.activation.status().then(setActivation); void window.marketSystem.update.status().then(setUpdate); void window.marketSystem.app.info().then(setInfo); return window.marketSystem.update.onChanged(setUpdate); }, []);
  useEffect(() => {
    if (activation?.mode !== 'active') return;
    const branded: StoreSettings = {
      ...state.settings,
      storeName: activation.branding?.productName || activation.customerName,
      legalName: activation.customer?.legalName || activation.customerName,
      address: activation.customer?.address || state.settings.address,
      phone: activation.customer?.phone || state.settings.phone,
      taxId: activation.customer?.taxId || state.settings.taxId,
      logoUrl: activation.branding?.logoDataUrl || state.settings.logoUrl,
    };
    setDraft(branded);
    // Branding is offered in the draft; saving remains an explicit action.
    // A server device id changes only after a successful activation/re-activation.
  }, [activation?.serverDeviceId]);
  const chooseLogo = async () => { const url = await window.marketSystem?.image.pick(session.sessionToken); if (url) setDraft((value) => ({ ...value, logoUrl: url })); };
  const checkUpdate = async () => { if (checkingUpdate) return; setCheckingUpdate(true); setMessage(''); try { if (!window.marketSystem) { setUpdate({ state: 'disabled', message: 'Yeniləmə masaüstü Setup versiyasında işləyir' }); return; } setUpdate({ state: 'checking' }); const status = await window.marketSystem.update.check(session.sessionToken); setUpdate(status); } catch { setUpdate({ state: 'error', message: 'Yeniləmə serverinə qoşulmaq mümkün olmadı' }); setMessage('İnternet bağlantısını yoxlayın və yenidən cəhd edin'); } finally { setCheckingUpdate(false); } };
  const updateText = update.state === 'idle' ? 'Yoxlanılmayıb' : update.state === 'checking' ? 'Yoxlanılır...' : update.state === 'not_available' ? 'Son versiyadır' : update.state === 'available' ? `v${update.version} tapıldı` : update.state === 'downloading' ? `${update.percent}% yüklənir` : update.state === 'downloaded' ? `v${update.version} hazırdır` : update.message;
  const text = (az: string, ru: string, en: string) => settingsText(lang, az, ru, en);
  const saveStore = async () => {
    if (saving) return; setSaving(true); setMessage('');
    try { await onSettings({ ...draft, kitchenStations: state.settings.kitchenStations }); setMessage(text('Mağaza məlumatları saxlanıldı', 'Данные магазина сохранены', 'Store details saved')); }
    catch (error) { setMessage(error instanceof Error ? error.message : text('Saxlanılmadı', 'Не удалось сохранить', 'Could not save')); }
    finally { setSaving(false); }
  };
  const sections = [
    { id: 'store', icon: Store, name: text('Mağaza', 'Магазин', 'Store'), hint: text('Ad və əlaqə məlumatları', 'Название и контакты', 'Name and contact details') },
    { id: 'catalog', icon: ShoppingBag, name: text('Kataloq', 'Каталог', 'Catalog'), hint: text('Məhsullar və kateqoriyalar', 'Товары и категории', 'Products and categories') },
    { id: 'printer', icon: Printer, name: text('Printer', 'Принтер', 'Printer'), hint: text('Tapın, seçin və yoxlayın', 'Поиск, выбор и проверка', 'Find, select and test') },
    { id: 'receipt', icon: ReceiptText, name: text('Çek dizaynı', 'Дизайн чека', 'Receipt design'), hint: text('Loqo, QR və önizləmə', 'Логотип, QR и просмотр', 'Logo, QR and preview') },
    { id: 'stations', icon: Boxes, name: text('Stansiyalar', 'Станции', 'Stations'), hint: text('Əlavə çap nöqtələri', 'Дополнительная печать', 'Additional print stations') },
    { id: 'hardware', icon: CreditCard, name: text('Ödəniş cihazları', 'Платёжные устройства', 'Payment devices'), hint: text('Terminal, pul qutusu və fiskal', 'Терминал, ящик и фискализация', 'Terminal, drawer and fiscal') },
    { id: 'display', icon: Monitor, name: text('Ekran', 'Экран', 'Display'), hint: text('Ölçü və miqyas', 'Размер и масштаб', 'Size and scale') },
    { id: 'license', icon: ShieldCheck, name: text('Lisenziya', 'Лицензия', 'Licence'), hint: text('Hesab və aktivasiya', 'Аккаунт и активация', 'Account and activation') },
    { id: 'update', icon: RefreshCw, name: text('Yeniləmələr', 'Обновления', 'Updates'), hint: text('Proqramın son versiyası', 'Последняя версия', 'Latest application version') },
  ];
  const selected = sections.find((item) => item.id === section)!;
  return <div className="market-settings">
    <header className="settings-hero"><div><span className="settings-eyebrow">MARKET POS / {text('İDARƏETMƏ', 'УПРАВЛЕНИЕ', 'MANAGEMENT')}</span><h2>{text('İş yerinizə uyğun ayarlar', 'Настройки вашего магазина', 'Set up your workspace')}</h2><p>{text('Mağaza, cihaz və çek ayarları bir yerdə.', 'Магазин, устройства и чеки в одном месте.', 'Store, devices and receipt settings in one place.')}</p></div><div className="settings-device"><Monitor/><span>{state.settings.terminalName}<small>{info?.version ? `v${info.version}` : 'Market POS'}</small></span></div></header>
    <div className="settings-layout"><nav className="settings-rail" aria-label={text('Parametr bölmələri', 'Разделы настроек', 'Settings sections')}>
      {sections.map((item) => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><item.icon/><span><b>{item.name}</b><small>{item.hint}</small></span></button>)}
    </nav><div className="settings-content"><div className="settings-content-heading"><div><h3>{selected.name}</h3><p>{selected.hint}</p></div><selected.icon/></div>
      {section === 'store' && (
      <section className="panel-card settings-card"><div className="panel-title">
          <h3>Mağaza məlumatları</h3>
          <Building2 />
        </div>
        {!coreReady && <p className="hint">Core offline — local settings only.</p>}
        <div className="logo-picker">
          <button type="button" onClick={() => void chooseLogo()}>
            {draft.logoUrl ? <img src={draft.logoUrl} alt="Logo" /> : <ImagePlus />}
            <span>{tr(lang, 'chooseImage')}</span>
          </button>
          <p>Mağaza loqosu giriş, telefon paneli və hesabatlarda görünəcək. Çek loqosunu «Çek dizaynı» bölməsindən seçin.</p>
        </div>
        <div className="form-grid">
          <Field label="Mağaza adı" value={draft.storeName} onChange={(value) => setDraft({ ...draft, storeName: value })} />
          <Field label="Hüquqi ad" value={draft.legalName} onChange={(value) => setDraft({ ...draft, legalName: value })} />
          <Field label="VÖEN" value={draft.taxId} onChange={(value) => setDraft({ ...draft, taxId: value })} />
          <Field label="Telefon" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} />
          <Field label={tr(lang, 'address')} value={draft.address} onChange={(value) => setDraft({ ...draft, address: value })} wide />
          <Field label={tr(lang, 'terminal')} value={draft.terminalName} onChange={(value) => setDraft({ ...draft, terminalName: value })} />
        </div>
        <button type="button" className="modal-primary" disabled={saving} onClick={() => void saveStore()}>
          <Check />{tr(lang, 'save')}
        </button>
      </section>
      )}
      {section === 'catalog' && <div className="settings-embedded"><OpsFrame catalogOnly session={session} notify={notify}/></div>}
      {(section === 'printer' || section === 'receipt') && <ReceiptDesignCard key={section} session={session} lang={lang} panel={section}/>}
      {section === 'stations' && <KitchenStationsCard settings={state.settings} products={state.products} session={session} lang={lang} notify={notify} onSave={(kitchenStations) => { void onSettings({ ...state.settings, kitchenStations }).then(() => notify(text('Saxlanıldı', 'Сохранено', 'Saved'))).catch((error: Error) => notify(error.message)); }}/>}
      {section === 'hardware' && <HardwareSettingsCard includePrinter={false} session={session} lang={lang} notify={notify}/>}
      {section === 'display' && (
      <section className="panel-card settings-card"><div className="panel-title">
          <h3>{tr(lang, 'display')}</h3>
          <Monitor />
        </div>
        <div className="preset-grid">
          {display?.presets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={display.prefs.mode === preset.mode && (preset.mode === 'fullscreen' || display.prefs.width === preset.width) ? 'active' : ''}
              onClick={() => void window.marketSystem?.display.set(session.sessionToken, {
                mode: preset.mode,
                width: preset.width || 1500,
                height: preset.height || 940,
                zoomFactor: display.prefs.zoomFactor,
              }).then((prefs) => setDisplay({ ...display, prefs })).catch(() => setMessage('Ekran ölçüsü tətbiq olunmadı'))}
            >
              <Monitor />
              <b>{preset.label}</b>
              <small>{preset.mode === 'fullscreen' ? 'F11' : `${preset.width}×${preset.height}`}</small>
            </button>
          ))}
        </div>
        <div className="zoom-row">
          <span>UI ölçüsü</span>
          {[0.8, 0.9, 1, 1.1, 1.2].map((zoom) => (
            <button
              type="button"
              key={zoom}
              className={display?.prefs.zoomFactor === zoom ? 'active' : ''}
              onClick={() => display && void window.marketSystem?.display.set(session.sessionToken, { ...display.prefs, zoomFactor: zoom }).then((prefs) => setDisplay({ ...display, prefs })).catch(() => setMessage('UI ölçüsü tətbiq olunmadı'))}
            >
              {Math.round(zoom * 100)}%
            </button>
          ))}
        </div>
        <p className="hint">F11 düyməsi istənilən ekranda tam ekranı açıb-bağlayır. 1024×768 terminallar ayrıca optimallaşdırılıb.</p>
      </section>
      )}
      {section === 'license' && (
      <section className="panel-card settings-card"><div className="panel-title">
          <h3>{tr(lang, 'activation')}</h3>
          <ShieldCheck />
        </div>
        <div className={`activation-box ${activation?.mode ?? 'trial'}`}>
          <ShieldCheck />
          <div>
            <small>{activation?.mode === 'active' ? tr(lang, 'active') : activation?.mode === 'expired' ? tr(lang, 'expired') : activation?.mode === 'revoked' ? tr(lang, 'revoked') : activation?.mode === 'unlicensed' ? tr(lang, 'unlicensed') : tr(lang, 'trial')}</small>
            <b>{activation?.customerName ?? state.settings.storeName}</b>
            <p>Cihaz: {activation?.deviceId.slice(0, 16) ?? '...'}</p>
            <p>Bitmə: {activation ? new Date(activation.validUntil).toLocaleDateString() : '...'}</p>
          </div>
        </div>
        <label className="activation-input">
          Aktivasiya açarı
          <input value={activationKey} onChange={(event) => setActivationKey(event.target.value)} placeholder="MPOS-XXXX-XXXX-XXXX" />
        </label>
        <button
          type="button"
          className="modal-primary"
          onClick={() => void window.marketSystem?.activation.activate(session.sessionToken, activationKey).then((status) => {
            setActivation(status);
            setMessage('Aktivasiya tamamlandı');
          }).catch((error: Error) => setMessage(error.message))}
        >
          <KeyRound />Aktivləşdir
        </button>
        <p className="hint">Açar cihazla bağlanır və serverin Ed25519 imzası yoxlanmadan qəbul edilmir.</p>
      </section>
      )}
      {section === 'update' && (
      <section className="panel-card settings-card"><div className="panel-title">
          <h3>{tr(lang, 'update')}</h3>
          <RefreshCw className={checkingUpdate ? 'spin' : ''} />
        </div>
        <div className={`update-box ${update.state}`}>
          <span><Download /></span>
          <div>
            <small>{tr(lang, 'version')}</small>
            <b>{info?.version ?? '1.0.0'} · {updateText}</b>
            <p>{info?.updateUrl ?? 'https://possistem.az/marketpos/updates/'}</p>
          </div>
        </div>
        {update.state === 'downloading' && (
          <div className="progress"><span style={{ width: `${update.percent}%` }} /></div>
        )}
        <div className="button-row">
          <button type="button" disabled={checkingUpdate || update.state === 'downloading'} onClick={() => void checkUpdate()}>
            <RefreshCw className={checkingUpdate ? 'spin' : ''} />
            {checkingUpdate ? 'Yoxlanılır...' : tr(lang, 'checkUpdate')}
          </button>
          {update.state === 'downloaded' && (
            <button type="button" className="primary-action" onClick={() => void window.marketSystem?.update.install(session.sessionToken)}>
              {tr(lang, 'installUpdate')}
            </button>
          )}
        </div>
        <p className="hint">Setup ilə qurulan proqram hər 30 dəqiqədə serveri yoxlayır, yeniləməni avtomatik yükləyir və təhlükəsiz çıxışda quraşdırır.</p>
      </section>
      )}
    </div></div>
    {message && <div className="settings-message" role="status"><Check/>{message}<button type="button" aria-label={text('Bildirişi bağla', 'Закрыть уведомление', 'Dismiss notification')} onClick={() => setMessage('')}><X/></button></div>}
  </div>;
}
