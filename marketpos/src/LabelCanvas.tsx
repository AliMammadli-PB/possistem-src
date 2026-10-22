import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Eye, EyeOff, Maximize, Move, MousePointer2 } from 'lucide-react';
import type { LabelDesign, LabelPreview, LabelProfile } from './labelTypes';
import { labelText, type LabelWord } from './labelText';
import { clampOffset, snapCenter, LABEL_ELEMENTS, type LabelBox, type LabelElement } from './labelLayout';
import type { Lang } from './types';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
type Drag = { key: LabelElement; mode: 'move' | 'resize'; handle?: Handle; startX: number; startY: number; box: LabelBox; dx: number; dy: number; snapped: boolean; stripe?: number; settling?: boolean };
export type DesignEdit = (patch: Partial<LabelDesign> | ((d: LabelDesign) => Partial<LabelDesign>), options?: { anchor?: LabelElement }) => void;
const VISIBLE = { name: 'showName', barcode: 'showBarcode', digits: 'showDigits', caption: 'showCaption' } as const;
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Continuous sizing in printer dots; the opposite edges stay fixed. */
function resized(d: Drag): LabelBox {
  const h = d.handle ?? 'se';
  const width = Math.max(.1, d.box.width + (h.includes('w') ? -d.dx : h.includes('e') ? d.dx : 0));
  const height = Math.max(.1, d.box.height + (h.includes('n') ? -d.dy : h.includes('s') ? d.dy : 0));
  return { x: d.box.x + (h.includes('w') ? d.box.width - width : 0), y: d.box.y + (h.includes('n') ? d.box.height - height : 0), width, height };
}

export function LabelCanvas({ preview, profile, element, setElement, linked, zoom, disabled, lang, edit, setShowPrice, barMode, stripeIndex, setStripeIndex }: {
  preview: LabelPreview; profile: LabelProfile; element: LabelElement; setElement: (e: LabelElement) => void; linked: boolean; zoom: number; disabled: boolean; lang: Lang;
  edit: DesignEdit; setShowPrice: (show: boolean, anchor: LabelElement) => void; barMode: boolean; stripeIndex: number; setStripeIndex: (n: number) => void;
}) {
  const t = (key: LabelWord) => labelText(lang, key);
  const viewport = useRef<HTMLDivElement>(null), world = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const currentDrag = useRef<Drag | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null), space = useRef(false);
  const lastView = useRef<{ x: number; y: number; scale: number; width: number; fit: boolean } | null>(null);
  const [drag, showDrag] = useState<Drag | null>(null), [available, setAvailable] = useState(600), [fitAll, setFitAll] = useState(false);
  const setDrag = (d: Drag | null) => { currentDrag.current = d; showDrag(d); };
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth)); observer.observe(el); setAvailable(el.clientWidth);
    return () => { observer.disconnect(); clearTimeout(timer.current); };
  }, []);
  useEffect(() => { if (currentDrag.current?.settling) { clearTimeout(timer.current); setDrag(null); } }, [preview]);
  const boxes = preview.boxes, stripeMode = barMode && element === 'barcode', dotsPerMm = profile.dpi === 300 ? 12 : 8;
  const millimetres = (n: number) => (n / dotsPerMm).toFixed(3);
  const setVisible = (key: LabelElement, show: boolean) => { if (key === 'price') setShowPrice(show, key); else edit({ [VISIBLE[key]]: show }, { anchor: key }); };
  const bounds = Object.values(boxes);
  const actualMinX = Math.min(0, ...bounds.map(b => b.x)), actualMinY = Math.min(0, ...bounds.map(b => b.y));
  const actualMaxX = Math.max(preview.width, ...bounds.map(b => b.x + b.width)), actualMaxY = Math.max(preview.height, ...bounds.map(b => b.y + b.height));
  // A pasteboard surrounds the paper. Expanding it never shifts the view after a drop.
  const minX = Math.min(-preview.width, actualMinX), minY = Math.min(-preview.height, actualMinY);
  const maxX = Math.max(preview.width * 2, actualMaxX), maxY = Math.max(preview.height * 2, actualMaxY);
  const fitWidth = fitAll ? Math.max(actualMaxX - actualMinX, (actualMaxY - actualMinY) * Math.max(80, available - 96) / Math.max(80, (viewport.current?.clientHeight || 440) - 96)) : preview.width;
  const scale = Math.max(.001, Math.min(1, Math.max(80, available - 96) / fitWidth)) * zoom;
  const pad = 72;
  const originX = pad + Math.max(0, -minX) * scale, originY = pad + Math.max(0, -minY) * scale;
  useLayoutEffect(() => {
    const el = viewport.current; if (!el) return;
    const old = lastView.current;
    if (!old || old.scale !== scale || old.width !== available || old.fit !== fitAll) {
      el.scrollLeft = fitAll ? originX + actualMinX * scale - 48 : originX - Math.max(48, (available - preview.width * scale) / 2);
      el.scrollTop = fitAll ? originY + actualMinY * scale - 48 : originY - 72;
    } else { el.scrollLeft += originX - old.x; el.scrollTop += originY - old.y; }
    lastView.current = { x: originX, y: originY, scale, width: available, fit: fitAll };
  }, [originX, originY, scale, available, fitAll, actualMinX, actualMinY, preview.width]);
  const startPan = (e: ReactPointerEvent<HTMLElement>) => {
    if (!viewport.current) return;
    e.preventDefault(); e.stopPropagation(); world.current?.focus({ preventScroll: true }); world.current?.setPointerCapture(e.pointerId);
    pan.current = { x: e.clientX, y: e.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop };
  };
  const moveBy = (key: LabelElement, dx: number, dy: number) => edit(d => ({
    [`${key}X`]: clampOffset(d[`${key}X`] + dx), [`${key}Y`]: clampOffset(d[`${key}Y`] + dy),
    ...(key === 'barcode' && linked ? { digitsX: clampOffset(d.digitsX + dx), digitsY: clampOffset(d.digitsY + dy) } : {}),
  }));
  const resizeTo = (key: LabelElement, box: LabelBox, next: LabelBox) => {
    edit(d => {
      const dx = next.x - box.x, dy = next.y - box.y;
      if (key === 'barcode') {
        const base = preview.barcodeBase || box, rx = next.width / box.width, ry = next.height / box.height;
        return { barWidth: Math.max(.001, Math.min(64, (preview.moduleWidth || 1) * rx)),
          barcodeHeight: Math.max(.1, Math.min(2000, base.height * ry)),
          barcodeX: clampOffset(d.barcodeX + dx + (base.width / 2 - (box.x - base.x)) * (rx - 1)),
          barcodeY: clampOffset(d.barcodeY + dy - (box.y - base.y) * (ry - 1)) };
      }
      const align = key === 'digits' ? 'center' : d[`${key}Align`];
      const anchorX = (align === 'left' ? d.margin : align === 'right' ? preview.width - d.margin : preview.width / 2) + d.offsetX + d[`${key}X`];
      return { [`${key}ScaleX`]: (d[`${key}ScaleX`] ?? 1) * next.width / Math.max(.000001, box.width),
        [`${key}ScaleY`]: (d[`${key}ScaleY`] ?? 1) * next.height / Math.max(.000001, box.height),
        [`${key}X`]: clampOffset(d[`${key}X`] + dx - (box.x - anchorX) * (next.width / Math.max(.000001, box.width) - 1)),
        [`${key}Y`]: clampOffset(d[`${key}Y`] + dy) };
    }, { anchor: key });
  };
  const begin = (key: LabelElement, mode: Drag['mode'], handle?: Handle) => (e: ReactPointerEvent<HTMLElement>) => {
    if (space.current || e.button === 1) { startPan(e); return; }
    if (disabled || !boxes[key] || e.button !== 0) return;
    e.stopPropagation(); e.preventDefault(); setElement(key);
    world.current?.focus({ preventScroll: true }); world.current?.setPointerCapture(e.pointerId);
    clearTimeout(timer.current);
    setDrag({ key, mode, handle, startX: e.clientX, startY: e.clientY, box: boxes[key]!, dx: 0, dy: 0, snapped: false });
  };
  const beginStripe = (index: number, mode: Drag['mode'], handle?: Handle) => (e: ReactPointerEvent<HTMLElement>) => {
    const box = preview.stripes?.find(b => b.index === index); if (!box) return;
    begin('barcode', mode, handle)(e);
    if (currentDrag.current && !space.current && e.button === 0) { setStripeIndex(index); setDrag({ ...currentDrag.current, box, stripe: index }); }
  };
  const saveStripe = (d: Drag) => {
    const next = d.mode === 'resize' ? resized(d) : { ...d.box, x: d.box.x + d.dx, y: d.box.y + d.dy }, module = preview.moduleWidth || 1, height = preview.barcodeBase?.height || 1;
    edit(v => {
      const e = v.barEdits[d.stripe!] || { shift: 0, top: 0, width: 1, height: 1, hidden: false };
      return { barEdits: { ...v.barEdits, [d.stripe!]: { ...e,
        shift: e.shift + (next.x - d.box.x + (next.width - d.box.width) / 2) / module,
        top: e.top + (next.y - d.box.y) / height, width: e.width * next.width / d.box.width, height: e.height * next.height / d.box.height } } };
    });
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (pan.current && viewport.current) { viewport.current.scrollLeft = pan.current.left - e.clientX + pan.current.x; viewport.current.scrollTop = pan.current.top - e.clientY + pan.current.y; return; }
    const d = currentDrag.current; if (!d || d.settling) return;
    let dx = (e.clientX - d.startX) / scale, dy = (e.clientY - d.startY) / scale, snapped = false;
    if (d.mode === 'move' && d.stripe === undefined && !e.altKey) {
      const snap = snapCenter(d.box.x + dx, d.box.width, preview.width, 4 / scale);
      if (snap.snapped) { dx = snap.x - d.box.x; snapped = true; }
    }
    if (e.shiftKey) { dx *= .1; dy *= .1; }
    setDrag({ ...d, dx, dy, snapped });
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (pan.current) { pan.current = null; if (world.current?.hasPointerCapture(e.pointerId)) world.current.releasePointerCapture(e.pointerId); return; }
    const d = currentDrag.current; if (!d || d.settling) return;
    if (world.current?.hasPointerCapture(e.pointerId)) world.current.releasePointerCapture(e.pointerId);
    if (Math.abs(d.dx) + Math.abs(d.dy) < .001) { setDrag(null); return; }
    setDrag({ ...d, settling: true });
    timer.current = setTimeout(() => { if (currentDrag.current?.settling) setDrag(null); }, 5000);
    if (d.stripe !== undefined) saveStripe(d);
    else if (d.mode === 'move') moveBy(d.key, d.dx, d.dy);
    else resizeTo(d.key, d.box, resized(d));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.code === 'Space') { e.preventDefault(); space.current = true; return; }
    if (e.key === 'Escape') { e.preventDefault(); setDrag(null); return; }
    if (disabled || !boxes[element]) return;
    if (stripeMode && ['Delete','Backspace'].includes(e.key)) { e.preventDefault(); edit(d => ({ barEdits: { ...d.barEdits, [stripeIndex]: { shift: 0, top: 0, width: 1, height: 1, ...d.barEdits[stripeIndex], hidden: true } } })); return; }
    const step = e.shiftKey ? 10 : e.altKey ? .1 : 1, box = boxes[element]!;
    if (stripeMode) {
      const b = preview.stripes?.find(b => b.index === stripeIndex), directions: Record<string, [number,number]> = { ArrowLeft: [-step,0], ArrowRight: [step,0], ArrowUp: [0,-step], ArrowDown: [0,step] };
      const direction = directions[e.key], size = ['+','=','-'].includes(e.key) ? (e.key === '-' ? -.1 : .1) : 0;
      if (b && (direction || size)) { e.preventDefault(); saveStripe({ key: 'barcode', stripe: stripeIndex, mode: size ? 'resize' : 'move', handle: 'se', box: b, dx: direction?.[0] ?? b.width * size, dy: direction?.[1] ?? b.height * size, startX: 0, startY: 0, snapped: false }); return; }
    }
    const keys: Record<string, () => void> = {
      ArrowLeft: () => moveBy(element, -step, 0), ArrowRight: () => moveBy(element, step, 0), ArrowUp: () => moveBy(element, 0, -step), ArrowDown: () => moveBy(element, 0, step),
      '+': () => resizeTo(element, box, { ...box, width: box.width * 1.1, height: box.height * 1.1 }),
      '-': () => resizeTo(element, box, { ...box, width: box.width * .9, height: box.height * .9 }),
      Delete: () => setVisible(element, false), Backspace: () => setVisible(element, false),
    };
    const run = keys[e.key === '=' ? '+' : e.key]; if (run) { e.preventDefault(); run(); }
  };
  return <div className="label-canvas-editor">
    <div className="label-canvas-tools"><output className="label-mm-readout" aria-live="off">{(() => { const b = drag ? (drag.mode === 'move' ? { ...drag.box, x: drag.box.x + drag.dx, y: drag.box.y + drag.dy } : resized(drag)) : stripeMode ? preview.stripes?.find(b => b.index === stripeIndex) : boxes[element]; return b ? `${millimetres(b.width)} × ${millimetres(b.height)} mm · X ${millimetres(b.x)} · Y ${millimetres(b.y)}` : t('visualMode'); })()}</output><span><MousePointer2/>{t('visualMode')}</span><button type="button" aria-pressed={fitAll} onClick={() => setFitAll(x => !x)}><Maximize/>{t(fitAll ? 'fitPaper' : 'fitAll')}</button></div>
    <div ref={viewport} className="label-canvas-viewport">
      <div ref={world} className="label-canvas" tabIndex={0} role="application" aria-label={t('canvasLabel')} onKeyDown={onKey} onKeyUp={e => { if (e.code === 'Space') space.current = false; }} onBlur={() => { space.current = false; }} onPointerDown={e => { if (e.target === e.currentTarget || e.button === 1 || space.current) startPan(e); }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { pan.current = null; setDrag(null); }}
        style={{ width: Math.max(available, (maxX - minX) * scale + pad * 2), height: Math.max(320, (maxY - minY) * scale + pad * 2) }}>
        <div className="label-paper-sheet" style={{ left: originX, top: originY, width: preview.width * scale, height: preview.height * scale }}><span>{profile.widthMm} × {profile.heightMm} mm</span></div>
        <svg className="label-mm-rulers" aria-hidden width={preview.width * scale + 56} height={preview.height * scale + 56} viewBox={`-28 -28 ${preview.width * scale + 56} ${preview.height * scale + 56}`} style={{ left: originX - 28, top: originY - 28 }}>
          {Array.from({ length: Math.floor(preview.width / dotsPerMm) + 1 }, (_, mm) => <g key={`x${mm}`}><line x1={mm * dotsPerMm * scale} x2={mm * dotsPerMm * scale} y1={-3} y2={mm % 5 ? -7 : -12}/>{mm % 5 === 0 && <text x={mm * dotsPerMm * scale} y={-16} textAnchor="middle">{mm}</text>}</g>)}
          {Array.from({ length: Math.floor(preview.height / dotsPerMm) + 1 }, (_, mm) => <g key={`y${mm}`}><line x1={-3} x2={mm % 5 ? -7 : -12} y1={mm * dotsPerMm * scale} y2={mm * dotsPerMm * scale}/>{mm % 5 === 0 && mm > 0 && <text x={-16} y={mm * dotsPerMm * scale + 3} textAnchor="end">{mm}</text>}</g>)}
        </svg>
        {Object.entries(boxes).map(([name, box]) => {
          const key = name as LabelElement, active = drag?.key === key && drag.stripe === undefined;
          let shown = active ? (drag!.mode === 'move' ? { ...box, x: box.x + drag!.dx, y: box.y + drag!.dy } : resized(drag!)) : box;
          if (!active && key === 'digits' && linked && drag?.key === 'barcode' && drag.stripe === undefined) {
            const changed = drag.mode === 'move' ? { ...drag.box, x: drag.box.x + drag.dx, y: drag.box.y + drag.dy } : resized(drag);
            shown = { ...box, x: box.x + (drag.mode === 'move' ? drag.dx : 0), y: box.y + changed.y + changed.height - drag.box.y - drag.box.height };
          }
          return <div key={key} data-element={key} className={`label-box${key === element ? ' selected' : ''}${active ? ' dragging' : ''}`}
            role="button" aria-label={t(`${key}Element`)} aria-pressed={key === element}
            style={{ left: originX + shown.x * scale, top: originY + shown.y * scale, width: shown.width * scale, height: shown.height * scale }} onDoubleClick={() => { setElement(key); requestAnimationFrame(() => { const field = document.querySelector<HTMLInputElement>('.label-visual-inspector .label-sample-input'); field?.focus(); field?.select(); }); }} onPointerDown={begin(key, 'move')}>
            {preview.layers?.[key] && !(key === 'barcode' && stripeMode) && <img className="label-layer-image" src={preview.layers[key]} alt="" draggable={false}/>}
            {key === 'barcode' && stripeMode && preview.stripes?.map(stripe => {
              const activeStripe = drag?.stripe === stripe.index, b = activeStripe ? (drag!.mode === 'move' ? { ...stripe, x: stripe.x + drag!.dx, y: stripe.y + drag!.dy } : resized(drag!)) : stripe;
              return <div key={stripe.index} data-stripe={stripe.index} role="button" aria-label={`${t('stripe')} ${Math.floor(stripe.index / 2) + 1}`} className={`label-stripe${stripe.index === stripeIndex ? ' selected' : ''}${stripe.hidden ? ' hidden-stripe' : ''}`} style={{ left: (b.x - box.x) * scale, top: (b.y - box.y) * scale, width: b.width * scale, height: b.height * scale }} onPointerDown={beginStripe(stripe.index, 'move')}>
                {stripe.index === stripeIndex && !disabled && HANDLES.map(h => <span key={h} data-handle={h} className={`label-handle ${h}`} aria-hidden onPointerDown={beginStripe(stripe.index, 'resize', h)}/>)}</div>;
            })}
            {key === element && !(key === 'barcode' && stripeMode) && !disabled && HANDLES.map(h => <span key={h} data-handle={h} className={`label-handle ${h}`} aria-hidden onPointerDown={begin(key, 'resize', h)}/>)}
          </div>;
        })}
        {drag?.snapped && <div className="label-guide" style={{ left: originX + preview.width / 2 * scale, top: originY - 20, height: preview.height * scale + 40 }}/>}
      </div>
    </div>
    <p className="label-hint"><Move/>{t('canvasHint')}</p>
  </div>;
}

/** The layer list lives beside the drawing so it never pushes the paper down. */
export function LabelLayers({ profile, element, setElement, disabled, lang, edit, setShowPrice }: {
  profile: LabelProfile; element: LabelElement; setElement: (e: LabelElement) => void; disabled: boolean; lang: Lang;
  edit: DesignEdit; setShowPrice: (show: boolean, anchor: LabelElement) => void;
}) {
  const t = (key: LabelWord) => labelText(lang, key), v = profile.design;
  const visible = (key: LabelElement) => key === 'price' ? profile.showPrice : Boolean(v[VISIBLE[key]]);
  const setVisible = (key: LabelElement, show: boolean) => {
    if (key === 'price') setShowPrice(show, key);
    else edit({ [VISIBLE[key]]: show, ...(key === 'caption' && show && !v.caption ? { caption: t('captionElement') } : {}) }, { anchor: key });
  };
  return (
<div className="label-visibility" aria-label={t('visibleParts')}>{LABEL_ELEMENTS.map(key => <div key={key} className={`label-layer${element === key ? ' active' : ''}`}>
      <button type="button" aria-pressed={element === key} disabled={disabled} onClick={() => setElement(key)}>{t(`${key}Element`)}</button>
      <button type="button" aria-label={`${t(visible(key) ? 'hidePart' : 'showPart')} · ${t(`${key}Element`)}`} aria-pressed={visible(key)} disabled={disabled} onClick={() => setVisible(key, !visible(key))}>{visible(key) ? <Eye/> : <EyeOff/>}</button>
    </div>)}</div>
  );
}
