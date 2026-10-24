'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MODE_META, RESTAURANT_ROUTE, img, type DemoMode, type DemoScreen } from './data';
import { Icon } from './Icon';
import { go, useDemoState } from './store';

const BASE_W = 1280;
const BASE_H = 800;

/* ------------------------------------------------------------------ */
/* Scaling stage: the till is laid out at 1280×800 and scaled to fit.  */
/* ------------------------------------------------------------------ */

export function ScaledStage({ fit, children }: { fit: 'frame' | 'contain'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ s: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      const s =
        fit === 'frame'
          ? W / BASE_W
          : Math.min(1.2, Math.max(Math.min(W / BASE_W, H / BASE_H), Math.min(W / 760, H / 620)));
      setBox({ s, w: W / s, h: H / s });
    };
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
  }, [fit]);

  return (
    <div ref={ref} className="pd-scaler">
      {box ? (
        <div className="pd-stage" style={{ width: box.w, height: box.h, transform: `scale(${box.s})` }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App shell: the system chooser, then the real till in an iframe      */
/* ------------------------------------------------------------------ */

export function PosDemoApp() {
  const { mode, screen, signedIn, session } = useDemoState();
  return (
    <div className="pd-root">
      <div className="pd-screen" key={mode ? `${mode}-${session}` : 'choose'}>
        {mode ? <LiveTill mode={mode} screen={screen} signedIn={signedIn} /> : <Chooser />}
      </div>
    </div>
  );
}

function tillUrl(mode: DemoMode, screen: DemoScreen, signedIn: boolean) {
  const route = mode === 'restaurant' && signedIn ? (RESTAURANT_ROUTE[screen] ?? '') : '';
  return `${MODE_META[mode].app}${signedIn ? '?signedIn=1' : ''}${route}`;
}

function LiveTill({ mode, screen, signedIn }: { mode: DemoMode; screen: DemoScreen; signedIn: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const meta = MODE_META[mode];
  return (
    <div className="pd-live">
      {!loaded ? (
        <div className="pd-live-loading" role="status">
          <a href="/" aria-label="Possistem"><img src={img('logo.webp')} alt="" /></a>
          <span>{meta.name} açılır…</span>
        </div>
      ) : null}
      <iframe
        className="pd-live-frame"
        src={tillUrl(mode, screen, signedIn)}
        title={`${meta.name} — canlı demo`}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

/** PIN list and a way back to the chooser, shown in the frame around the till. */
export function DemoControls({ fallback = null }: { fallback?: ReactNode }) {
  const { mode } = useDemoState();
  if (!mode) return <>{fallback}</>;
  const meta = MODE_META[mode];
  return (
    <span className="pd-controls">
      <button type="button" className="pd-controls-back" onClick={() => go(null)}>
        <Icon name="back" size={13} stroke={2.4} /> Sistem seçimi
      </button>
      <span className="pd-controls-pins">
        PIN:{' '}
        {meta.pins.map(([who, pin]) => (
          <span key={who}>
            {who} <b>{pin}</b>
          </span>
        ))}
      </span>
    </span>
  );
}

function Chooser() {
  const cards: { mode: DemoMode; shot: string; text: string; features: string[] }[] = [
    {
      mode: 'restaurant',
      shot: 'demo-restoran.webp',
      text: 'Zal planı, sifariş, mətbəx ekranı və ödəniş — ofisiantdan kassaya qədər.',
      features: ['Masa planı', 'Mətbəx ekranı', 'Hesabı bölmə'],
    },
    {
      mode: 'market',
      shot: 'demo-market.webp',
      text: 'Barkodla sürətli satış, çəki məhsulları, anbar qalığı və çek.',
      features: ['Barkod', 'Anbar qalığı', '4 300+ məhsul'],
    },
  ];
  return (
    <div className="pd-choose">
      <header className="pd-choose-head">
        <a href="/" aria-label="Possistem" className="pd-choose-brand" style={{textDecoration:'none',color:'inherit'}}>
          <img src={img('logo.webp')} alt="" />
          <span>
            <b>possistem</b>
            <small>Canlı demo</small>
          </span>
        </a>
        <h2>Hansı kassanı açaq?</h2>
        <p>Proqramın özü: kassadakı eyni ekranlar və eyni nüvə, brauzerdə. Hər açılış təzə demodur.</p>
      </header>
      <div className="pd-choose-grid">
        {cards.map((card) => {
          const meta = MODE_META[card.mode];
          const pin = meta.pins[0][1];
          return (
            <button
              type="button"
              key={card.mode}
              className={`pd-choose-card is-${card.mode}`}
              onClick={() => go(card.mode)}
            >
              <span className="pd-choose-shot">
                <img src={img(card.shot)} alt={`${meta.name} ekranı`} />
                <span className="pd-choose-tag">
                  <Icon name={card.mode === 'restaurant' ? 'table' : 'barcode'} size={14} />
                  {meta.name}
                </span>
              </span>
              <span className="pd-choose-body">
                <strong>{meta.name}</strong>
                <small>{card.text}</small>
                <span className="pd-choose-features">
                  {card.features.map((feature) => (
                    <i key={feature}>
                      <Icon name="check" size={13} stroke={2.6} />
                      {feature}
                    </i>
                  ))}
                </span>
                <span className="pd-choose-foot">
                  <span className="pd-choose-pin" aria-label={`Giriş PIN-i ${pin}`}>
                    <em>PIN</em>
                    {pin.split('').map((digit, index) => (
                      <b key={index}>{digit}</b>
                    ))}
                  </span>
                  <span className="pd-choose-go">
                    Demonu aç <Icon name="next" size={16} stroke={2.4} />
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fullscreen modal                                                     */
/* ------------------------------------------------------------------ */

export type OpenDemoDetail = { mode?: DemoMode; screen?: DemoScreen; signedIn?: boolean };

export function openPosDemo(detail: OpenDemoDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenDemoDetail>('pos-demo:open', { detail }));
}

export function PosDemoModal() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const { mode, screen, signedIn } = (event as CustomEvent<OpenDemoDetail>).detail ?? {};
      if (mode) go(mode, screen ?? 'pos', Boolean(signedIn));
      setOpen(true);
    };
    window.addEventListener('pos-demo:open', onOpen);
    return () => window.removeEventListener('pos-demo:open', onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="pd-overlay" role="dialog" aria-modal="true" aria-label="possistem canlı demo">
      <div className="pd-overlay-bar">
        <span>
          <i /> possistem · Canlı demo
        </span>
        <DemoControls />
        <button type="button" ref={closeRef} onClick={() => setOpen(false)}>
          Bağla <Icon name="x" size={16} stroke={2.4} />
        </button>
      </div>
      <div className="pd-overlay-body">
        <ScaledStage fit="contain">
          <PosDemoApp />
        </ScaledStage>
      </div>
    </div>
  );
}
