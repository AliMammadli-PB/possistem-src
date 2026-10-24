'use client';

import { useEffect, useRef, useState } from 'react';
import { HeroCompare } from '@/components/marketing/HeroCompare';
import { T } from '@/components/marketing/T';
import { Icon } from './Icon';
import { DemoControls, PosDemoApp, ScaledStage, openPosDemo } from './PosDemo';
import { go } from './store';

/**
 * Hero frame with a slide switch: "Müqayisə" shows the before/after image
 * comparison, "Demo" wipes a live, clickable POS demo over it.
 */
export function HeroShowcase() {
  const [demo, setDemo] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = (next: boolean) => {
    if (next === demo) return;
    if (next) {
      setMounted(true);
      go(null);
    }
    setSettled(false);
    // one frame so the layer mounts clipped before the wipe starts
    requestAnimationFrame(() => setDemo(next));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSettled(true), 950);
  };

  return (
    <div className={`product-browser hero-showcase ${demo ? 'is-demo' : ''} ${settled ? 'is-settled' : ''}`}>
      <div className="browser-bar">
        <span>
          <i />
          <i />
          <i />
        </span>
        <small>{demo ? <DemoControls fallback={<span>possistem · Restoran və Market POS</span>} /> : <T k="index.text.029" />}</small>
        <button
          type="button"
          role="switch"
          aria-checked={demo}
          className="hero-demo-switch"
          onClick={() => toggle(!demo)}
          aria-label="Canlı demonu aç və ya bağla"
        >
          <span className="hero-demo-switch__track">
            <span className="hero-demo-switch__opt">Müqayisə</span>
            <span className="hero-demo-switch__opt">Demo</span>
            <span className="hero-demo-switch__knob" aria-hidden="true" />
          </span>
        </button>
        {demo ? (
          <button type="button" className="hero-demo-expand" onClick={() => openPosDemo()} title="Tam ekranda aç">
            <Icon name="expand" size={12} stroke={2.4} /> Tam ekran
          </button>
        ) : (
          <b>
            <T k="index.text.030" />
          </b>
        )}
      </div>
      <div className="hero-showcase-view">
        <HeroCompare />
        {!demo ? (
          <button type="button" className="hero-demo-cta" onClick={() => toggle(true)}>
            <span className="hero-demo-cta__dot" aria-hidden="true" />
            Canlı demonu sına
            <span className="hero-demo-cta__arrow" aria-hidden="true">
              <Icon name="next" size={14} stroke={2.6} />
            </span>
          </button>
        ) : null}
        <div className="hero-demo-layer" aria-hidden={!demo} inert={!demo ? true : undefined}>
          {mounted ? (
            <ScaledStage fit="frame">
              <PosDemoApp />
            </ScaledStage>
          ) : null}
        </div>
        <div className="hero-demo-wipe" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
