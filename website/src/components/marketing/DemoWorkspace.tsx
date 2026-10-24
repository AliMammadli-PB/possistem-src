'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/components/providers/I18nProvider';
import { Expand, Close, Menu, Store, Utensils, Monitor, ArrowUpRight } from './DesignIcons';
import { asset } from '@/lib/assets';

const DEMO_RELEASE = 'current-20261021-r1';
const SYSTEMS = [
  { id: 'restaurant', name: 'Restoran POS', path: 'restoran', icon: Utensils },
  { id: 'market', name: 'Market POS', path: 'market', icon: Store },
  { id: 'topdan', name: 'Topdan POS', path: 'topdan', icon: Store },
  { id: 'aptek', name: 'Aptek POS', path: 'aptek', icon: Monitor },
  { id: 'geyim', name: 'Geyim POS', path: 'geyim', icon: Store },
] as const;
type System = typeof SYSTEMS[number];
const COPY = {
  az: { title: 'Hansı sistemi sınamaq istəyirsiniz?', lead: 'Seçin. Tətbiq bütün ekranı dolduracaq.', home: 'Sayta qayıt', choose: 'Sistemi seç', menu: 'Demo menyusu', full: 'Tam ekran', exit: 'Tam ekrandan çıx', pin: 'Demo giriş PIN-i', launch: 'Aç', loading: 'Giriş ekranı hazırlanır…', slow: 'Tətbiq hələ açılmayıb. Bağlantını yoxlayıb yenidən sınayın.', retry: 'Yenidən aç', close: 'Tətbiqə qayıt', note: 'Sınaq məlumatları ilə işləyir. Real ödəniş və fiziki çap aparılmır.' },
  en: { title: 'Which system would you like to try?', lead: 'Choose a system. The application fills your screen.', home: 'Back to website', choose: 'Choose a system', menu: 'Demo menu', full: 'Full screen', exit: 'Exit full screen', pin: 'Demo sign-in PIN', launch: 'Open', loading: 'Preparing the sign-in screen…', slow: 'The application has not opened yet. Check your connection and retry.', retry: 'Reload', close: 'Return to application', note: 'Uses sample data. No real payments or physical printing.' },
  ru: { title: 'Какую систему хотите попробовать?', lead: 'Выберите систему. Приложение займёт весь экран.', home: 'Вернуться на сайт', choose: 'Выбрать систему', menu: 'Меню демо', full: 'Полный экран', exit: 'Выйти из полного экрана', pin: 'PIN для входа в демо', launch: 'Открыть', loading: 'Подготовка экрана входа…', slow: 'Приложение ещё не открылось. Проверьте соединение и повторите попытку.', retry: 'Перезагрузить', close: 'Вернуться в приложение', note: 'Тестовые данные. Без реальных платежей и физической печати.' },
};

export function DemoWorkspace() {
  const params = useSearchParams();
  const { language } = useI18n();
  const c = COPY[language];
  const initial = SYSTEMS.find(item => item.id === params.get('system')) ?? null;
  const [system, setSystem] = useState<System | null>(initial);
  const [chooser, setChooser] = useState(!initial);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [reload, setReload] = useState(0);
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = SYSTEMS.find(item => item.id === params.get('system'));
    if (next && next.id !== system?.id) { setReady(false); setSystem(next); setChooser(false); }
  }, [params, system?.id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const changed = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', changed);
    return () => { document.body.style.overflow = previous; document.removeEventListener('fullscreenchange', changed); };
  }, []);

  // A document load is earlier than WASM/tenant initialization. Never show the
  // temporary account-activation screen while the real demo PIN screen boots.
  useEffect(() => {
    if (!system) return;
    setReady(false); setSlow(false);
    const timeout = window.setTimeout(() => setSlow(true), 45000);
    const poll = window.setInterval(() => {
      try {
        const doc = frame.current?.contentDocument;
        if (!doc?.querySelector('.ps-rest-staff, button[aria-label="1"]')) return;
        window.clearInterval(poll); window.clearTimeout(timeout);
        setReady(true); setSlow(false);
      } catch { /* Keep the retry state available if a document is inaccessible. */ }
    }, 100);
    return () => { window.clearInterval(poll); window.clearTimeout(timeout); };
  }, [system?.id, reload]);

  useEffect(() => {
    if (!chooser) return;
    firstChoice.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && system) { event.preventDefault(); setChooser(false); menuButton.current?.focus(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button,a[href]') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [chooser, system]);

  useEffect(() => {
    if (ready && !chooser) frame.current?.contentWindow?.focus();
  }, [ready, chooser]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await root.current?.requestFullscreen();
    } catch { /* The viewport still fills the page if browser full screen is denied. */ }
  };
  const select = (next: System) => {
    if (next.id !== system?.id) { setReady(false); setSystem(next); }
    setChooser(false);
    const url = new URL(location.href); url.searchParams.set('system', next.id);
    history.replaceState(null, '', url);
    // System selection is a user gesture, so browsers that support it can enter
    // native full screen. A direct URL still fills the viewport without it.
    if (!document.fullscreenElement && document.fullscreenEnabled) void root.current?.requestFullscreen().catch(() => {});
  };

  return <div className="ps-demo-page ps-demo-shell" ref={root}>
    <main id="main" className="ps-demo-canvas" aria-hidden={chooser || undefined} inert={chooser ? true : undefined}>
      {system && <iframe ref={frame} key={`${system.id}-${reload}`} src={`/pos-demo-app/${DEMO_RELEASE}/${system.path}/index.html`} title={`${system.name} — demo`} allow="fullscreen" className={`ps-demo-app${ready ? ' is-ready' : ''}`} tabIndex={ready ? 0 : -1} />}
      {system && !ready && <div className="ps-demo-boot" role="status"><a href="/" aria-label="Possistem"><img src={asset('/assets/brands/logo.png')} alt="" width={56} height={56} /></a><strong>{system.name}</strong><p>{slow ? c.slow : c.loading}</p>{slow && <button type="button" onClick={() => setReload(value => value + 1)}>{c.retry}</button>}</div>}
    </main>
    {!chooser && <div className="ps-demo-tools"><button ref={menuButton} type="button" onClick={() => setChooser(true)} aria-label={c.menu}><Menu /><span>Demo</span></button><button type="button" onClick={fullscreen} aria-label={full ? c.exit : c.full} title={full ? c.exit : c.full}>{full ? <Close /> : <Expand />}</button><Link href="/" aria-label={c.home} title={c.home}><ArrowUpRight /></Link></div>}
    {chooser && <div ref={dialog} className="ps-demo-launcher" role="dialog" aria-modal="true" aria-labelledby="demo-choose-title">
      <div className="ps-demo-launcher-bar"><Link href="/" className="ps-brand"><img src={asset('/assets/brands/logo.png')} alt="" width={38} height={38} /><span>Possistem</span></Link>{system ? <button type="button" onClick={() => { setChooser(false); menuButton.current?.focus(); }} aria-label={c.close}><Close /></button> : <Link href="/">{c.home}<ArrowUpRight /></Link>}</div>
      <div className="ps-demo-launcher-content"><p className="ps-kicker">POSSISTEM / DEMO</p><h1 id="demo-choose-title">{c.title}</h1><p className="ps-demo-launcher-lead">{c.lead}</p><div className="ps-demo-system-grid">{SYSTEMS.map((item, index) => <button ref={index === 0 ? firstChoice : undefined} type="button" key={item.id} onClick={() => select(item)} aria-label={item.name}><span className="ps-demo-system-icon"><item.icon /></span><strong>{item.name}</strong><span className="ps-demo-system-open">{c.launch}<ArrowUpRight /></span></button>)}</div><div className="ps-demo-launcher-help"><p>{c.pin}: <kbd>1234</kbd></p><small>{c.note}</small></div></div>
    </div>}
  </div>;
}
