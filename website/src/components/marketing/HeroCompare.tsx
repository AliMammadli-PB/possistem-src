'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/providers/I18nProvider';
import { asset } from '@/lib/assets';

export function HeroCompare() {
  const { t } = useI18n();
  const heroRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);

  const [split, setSplit] = useState(0.5);
  const splitRef = useRef(0.5);
  const targetRef = useRef(0.5);
  const draggingRef = useRef(false);
  const userMovedRef = useRef(false);
  const autoplayRef = useRef(true);
  const autoplayStartRef = useRef(0);
  const rectRef = useRef({ left: 0, width: 1 });

  useEffect(() => {
    splitRef.current = split;
  }, [split]);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) autoplayRef.current = false;

    const MIN = 0.08;
    const MAX = 0.92;
    const LERP_IDLE = reducedMotion ? 1 : 0.1;
    const LERP_DRAG = reducedMotion ? 1 : 0.28;
    const AUTOPLAY_MS = 3800;

    const measure = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      rectRef.current = { left: r.left, width: r.width || 1 };
    };

    const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));
    const splitFromEvent = (clientX: number) =>
      clamp((clientX - rectRef.current.left) / rectRef.current.width);

    const applyVisuals = (value: number) => {
      const pct = `${(value * 100).toFixed(3)}%`;
      afterRef.current?.style.setProperty('--split', pct);
      heroRef.current?.style.setProperty('--split', pct);
      heroRef.current?.style.setProperty('--after-presence', (1 - value).toFixed(3));
    };

    const killAutoplay = () => {
      if (!userMovedRef.current) {
        userMovedRef.current = true;
        heroRef.current?.classList.add('has-interacted');
      }
      autoplayRef.current = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      killAutoplay();
      draggingRef.current = true;
      measure();
      targetRef.current = splitFromEvent(event.clientX);
      heroRef.current?.classList.add('is-dragging');
      dividerRef.current?.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      targetRef.current = splitFromEvent(event.clientX);
    };

    const endDrag = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      heroRef.current?.classList.remove('is-dragging');
      if (dividerRef.current?.hasPointerCapture(event.pointerId)) {
        dividerRef.current.releasePointerCapture(event.pointerId);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 0.08 : 0.03;
      if (event.key === 'ArrowLeft') {
        killAutoplay();
        targetRef.current = clamp(targetRef.current - step);
        event.preventDefault();
      } else if (event.key === 'ArrowRight') {
        killAutoplay();
        targetRef.current = clamp(targetRef.current + step);
        event.preventDefault();
      } else if (event.key === 'Home') {
        killAutoplay();
        targetRef.current = MIN;
        event.preventDefault();
      } else if (event.key === 'End') {
        killAutoplay();
        targetRef.current = MAX;
        event.preventDefault();
      }
    };

    let frameId = 0;
    const frame = (now: number) => {
      if (autoplayRef.current) {
        if (!autoplayStartRef.current) autoplayStartRef.current = now;
        const t = Math.min(1, (now - autoplayStartRef.current) / AUTOPLAY_MS);
        if (t >= 1) {
          autoplayRef.current = false;
          targetRef.current = 0.5;
        } else {
          targetRef.current = clamp(0.5 + Math.sin(t * Math.PI * 2) * 0.13);
        }
      }

      const lerp = draggingRef.current ? LERP_DRAG : LERP_IDLE;
      const next = splitRef.current + (targetRef.current - splitRef.current) * lerp;
      if (Math.abs(next - splitRef.current) > 0.0001) {
        splitRef.current = next;
        setSplit(next);
        applyVisuals(next);
      }

      frameId = requestAnimationFrame(frame);
    };

    measure();
    applyVisuals(splitRef.current);
    window.addEventListener('resize', measure, { passive: true });
    dividerRef.current?.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    dividerRef.current?.querySelector('button')?.addEventListener('keydown', onKeyDown);
    frameId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', measure);
      dividerRef.current?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  return (
    <div className="pos-compare" id="posCompare" ref={heroRef}>
      <div className="pos-compare-stage" id="posCompareStage" ref={stageRef}>
        <picture>
          <source srcSet={asset('/assets/hero-compare/pos-before-original-20261021.png')} type="image/png" />
          <img
            className="pos-compare-frame pos-compare-before"
            src={asset('/assets/hero-compare/pos-before-original-20261021.png')}
            alt={t('hero.compare.beforeAlt')}
            width={1672}
            height={941}
            draggable={false}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <div className="pos-compare-after-layer" id="posCompareAfter" ref={afterRef}>
          <picture>
            <source srcSet={asset('/assets/hero-compare/pos-after-1.9.9-20261021.png')} type="image/png" />
            <img
              className="pos-compare-frame pos-compare-after"
              src={asset('/assets/hero-compare/pos-after-1.9.9-20261021.png')}
              alt={t('hero.compare.afterAlt')}
              width={1672}
              height={941}
              draggable={false}
              fetchPriority="high"
              decoding="async"
            />
          </picture>
        </div>
        <span className="pos-compare-label pos-compare-label-l">{t('hero.compare.beforeLabel')}</span>
        <span className="pos-compare-label pos-compare-label-r">{t('hero.compare.afterLabel')}</span>
        <div className="pos-compare-divider" id="posCompareDivider" ref={dividerRef}>
          <div className="pos-compare-line" aria-hidden="true" />
          <button
            type="button"
            className="pos-compare-handle"
            id="posCompareHandle"
            aria-label="Müqayisə xəttini sola və ya sağa çək"
          >
            <span className="pos-compare-chev pos-compare-chev-l" aria-hidden="true" />
            <span className="pos-compare-core" aria-hidden="true" />
            <span className="pos-compare-chev pos-compare-chev-r" aria-hidden="true" />
          </button>
        </div>
        <div className="pos-compare-hint" aria-hidden="true">
          <span>Xətti çək</span>
        </div>
      </div>
    </div>
  );
}
