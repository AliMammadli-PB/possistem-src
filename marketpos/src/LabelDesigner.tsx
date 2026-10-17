import { useState, type Dispatch, type InputHTMLAttributes, type SetStateAction } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AlignCenter, Minus, Plus, RotateCcw } from 'lucide-react';
import { defaultLabelDesign, type LabelDesign, type LabelPreview, type LabelProfile } from './labelTypes';
import { labelText, type LabelWord } from './labelText';
import { dotsToUnit, mmToUnit, moveSteps, paperUnit, roundUnit, unitStep, unitToDots, unitToMm, type LabelUnit } from './labelUnits';
import type { Lang } from './types';

type Element = 'name' | 'price' | 'barcode' | 'digits' | 'caption';
/**
 * A number field that keeps exactly what is typed while focused (values are
 * whole printer dots underneath, so "0.1 in" would otherwise snap to 0.098
 * mid-typing) and shows the stored value once the field is left.
 */
export function UnitInput({ value, onCommit, ...rest }: { value: number | ''; onCommit: (text: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input type="number" {...rest} value={draft ?? value} onFocus={() => setDraft(String(value))} onChange={e => { setDraft(e.target.value); onCommit(e.target.value); }} onBlur={() => setDraft(null)}/>;
}
type TextElement = Exclude<Element, 'barcode'>;
/** Layout lengths are whole printer dots; the fields show them in mm, inches or dots. */
export function LabelDesigner({ profile, setProfile, lang, disabled, preview }: { profile: LabelProfile; setProfile: Dispatch<SetStateAction<LabelProfile>>; lang: Lang; disabled: boolean; preview?: LabelPreview | null }) {
  const [element, setElement] = useState<Element>('barcode'), [stepIndex, setStepIndex] = useState(0), [linked, setLinked] = useState(true);
  const t = (key: LabelWord) => labelText(lang, key), v = profile.design, dpi = profile.dpi, unit: LabelUnit = profile.unit ?? 'mm';
  const unitName = t(unit === 'in' ? 'unitInShort' : unit === 'dot' ? 'unitDotShort' : 'unitMmShort');
  const paper = paperUnit(unit), paperName = t(paper === 'in' ? 'unitInShort' : 'unitMmShort');
  const steps = moveSteps(unit), step = steps[Math.min(stepIndex, steps.length - 1)]!, stepDots = Math.max(1, unitToDots(step, dpi, unit));
  const update = (patch: Partial<LabelDesign> | ((d: LabelDesign) => Partial<LabelDesign>)) => setProfile(p => ({ ...p, design: { ...p.design, ...(typeof patch === 'function' ? patch(p.design) : patch) } }));
  const shown = (dots: number) => (Number.isFinite(dots) ? roundUnit(dotsToUnit(dots, dpi, unit), unit) : '');
  const typed = (text: string) => (text === '' ? NaN : unitToDots(Number(text), dpi, unit));
  const position = (axis: 'X' | 'Y', value: number) => update(d => {
    const key = `${element}${axis}` as keyof LabelDesign, previous = Number(d[key]);
    const digits = Number(d[`digits${axis}` as keyof LabelDesign]);
    // A temporarily blank numeric input must not poison the linked field with NaN.
    const linkedValue = Number.isFinite(previous) && Number.isFinite(digits) ? digits + value - previous : value;
    return { [key]: value, ...(element === 'barcode' && linked && Number.isFinite(value) ? { [`digits${axis}`]: linkedValue } : {}) };
  });
  const move = (dx: number, dy: number) => update(d => ({ [`${element}X`]: Number(d[`${element}X` as keyof LabelDesign]) + dx, [`${element}Y`]: Number(d[`${element}Y` as keyof LabelDesign]) + dy, ...(element === 'barcode' && linked ? { digitsX: d.digitsX + dx, digitsY: d.digitsY + dy } : {}) }));
  /** A length in the chosen unit, kept as whole dots. */
  const length = (key: keyof LabelDesign, title: string, minDots: number, maxDots: number, extra = '') => <label>{`${title} (${unitName}${extra ? `, ${extra}` : ''})`}<UnitInput step={unitStep(unit)} min={shown(minDots)} max={shown(maxDots)} value={shown(Number(v[key]))} onCommit={text => update({ [key]: typed(text) })}/></label>;
  const clampTo = (key: keyof LabelDesign, value: number, min: number, max: number) => update({ [key]: Math.min(max, Math.max(min, Math.round(value))) });
  const resizer = (onSmaller: () => void, onBigger: () => void, smaller: LabelWord, bigger: LabelWord) => <div className="label-resize"><button type="button" onClick={onSmaller}><Minus/>{t(smaller)}</button><button type="button" onClick={onBigger}><Plus/>{t(bigger)}</button></div>;
  const fontStep = dpi === 300 ? 3 : 2;
  const visibleKey = element === 'name' ? 'showName' : element === 'digits' ? 'showDigits' : element === 'caption' ? 'showCaption' : null;
  // Auto height / auto bar width resize from what the preview actually drew.
  const drawnHeight = preview?.boxes?.barcode?.height ?? 0, drawnModule = preview?.moduleWidth ?? 0;
  const fittedNames = Object.entries(preview?.fitted ?? {}).map(([key, size]) => `${t(`${key}Element` as LabelWord)} (${shown(Number(v[`${key}Size` as keyof LabelDesign]))} → ${shown(size)} ${unitName})`);
  // A plain render helper, not a nested component: a nested one would remount
  // (and drop focus from) its inputs on every keystroke.
  const textControls = (key: TextElement) => {
    const sizeKey = `${key}Size` as const;
    return <>
      {resizer(() => clampTo(sizeKey, v[sizeKey] - fontStep, 8, 120), () => clampTo(sizeKey, v[sizeKey] + fontStep, 8, 120), 'smaller', 'bigger')}
      <div className="label-field-pair">{length(sizeKey, t('fontSize'), 8, 120)}{key === 'name' && <label>{t('lines')}<input type="number" step="1" min="1" max="3" value={Number.isFinite(v.nameLines) ? v.nameLines : ''} onChange={e => update({ nameLines: e.target.value === '' ? NaN : Number(e.target.value) })}/></label>}</div>
      <label className="label-check"><input type="checkbox" checked={v[`${key}Bold`]} onChange={e => update({ [`${key}Bold`]: e.target.checked })}/>{t('bold')}</label>
      {key !== 'digits' && <label>{t('align')}<select value={v[`${key}Align`]} onChange={e => update({ [`${key}Align`]: e.target.value })}>{(['left','center','right'] as const).map(a => <option key={a} value={a}>{t(a)}</option>)}</select></label>}
    </>;
  };
  return <section className="label-card label-designer"><header><div><h4>{t('design')}</h4><p>{t('designHint')}</p></div></header>
    <fieldset disabled={disabled}>
      <label className="label-unit">{t('unit')}<select value={unit} onChange={e => setProfile(p => ({ ...p, unit: e.target.value as LabelUnit }))}><option value="mm">{t('unitMm')}</option><option value="in">{t('unitIn')}</option><option value="dot">{t('unitDot')}</option></select></label>
      <div className="label-design-presets"><button type="button" onClick={() => setProfile(p => ({ ...p, widthMm: 45, heightMm: 25, design: defaultLabelDesign(p.dpi) }))}>{t('paper45')}</button><button type="button" onClick={() => setProfile(p => ({ ...p, design: defaultLabelDesign(p.dpi) }))}><RotateCcw/>{t('resetLayout')}</button></div>
      <div className="label-field-pair">
        <label>{`${t('width')} (${paperName})`}<UnitInput min={roundUnit(mmToUnit(20, paper), paper)} max={roundUnit(mmToUnit(profile.maxWidthMm, paper), paper)} step={paper === 'in' ? 0.01 : 0.1} value={Number.isFinite(profile.widthMm) ? roundUnit(mmToUnit(profile.widthMm, paper), paper) : ''} onCommit={text => setProfile(p => ({ ...p, widthMm: text === '' ? NaN : Math.round(unitToMm(Number(text), paper) * 100) / 100 }))}/></label>
        <label>{`${t('height')} (${paperName})`}<UnitInput min={roundUnit(mmToUnit(20, paper), paper)} max={roundUnit(mmToUnit(150, paper), paper)} step={paper === 'in' ? 0.01 : 0.1} value={Number.isFinite(profile.heightMm) ? roundUnit(mmToUnit(profile.heightMm, paper), paper) : ''} onCommit={text => setProfile(p => ({ ...p, heightMm: text === '' ? NaN : Math.round(unitToMm(Number(text), paper) * 100) / 100 }))}/></label>
      </div>
      <p>{t('dotsHint').replace('{dots}', dpi === 203 ? '8' : '12')}</p>
      <div className="label-element-tabs" aria-label={t('element')}>{(['name','price','barcode','digits','caption'] as const).map(key => <button key={key} type="button" aria-pressed={element === key} onClick={() => setElement(key)}>{t(`${key}Element`)}</button>)}</div>
      {visibleKey && <label className="label-check"><input type="checkbox" checked={v[visibleKey]} onChange={e => update({ [visibleKey]: e.target.checked })}/>{t('visible')}</label>}
      {element === 'price' && <><label className="label-check"><input type="checkbox" checked={profile.showPrice} onChange={e => setProfile(p => ({ ...p, showPrice: e.target.checked }))}/>{t('showPrice')}</label>
        <label>{t('pricePosition')}<select value={v.pricePosition} onChange={e => update({ pricePosition: e.target.value as LabelDesign['pricePosition'], priceY: 0 })}><option value="top">{t('priceTop')}</option><option value="bottom">{t('priceBottom')}</option></select></label></>}
      {element === 'barcode' && <label className="label-check"><input type="checkbox" checked={linked} onChange={e => setLinked(e.target.checked)}/>{t('linkDigits')}</label>}
      {element === 'caption' && <label>{t('captionElement')}<input maxLength={120} value={v.caption} onChange={e => update({ caption: e.target.value })}/></label>}
      <div className="label-field-pair">{(['X','Y'] as const).map(axis => <label key={axis}>{`${t(axis === 'X' ? 'xOffset' : 'yOffset')} (${unitName})`}<UnitInput step={unitStep(unit)} min={shown(-3000)} max={shown(3000)} value={shown(v[`${element}${axis}`])} onCommit={text => position(axis, typed(text))}/></label>)}</div>
      <div className="label-nudge"><label>{`${t('step')} (${unitName})`}<select value={stepIndex} onChange={e => setStepIndex(Number(e.target.value))}>{steps.map((n, i) => <option key={n} value={i}>{n}</option>)}</select></label><div><button type="button" aria-label={t('moveLeft')} onClick={() => move(-stepDots,0)}><ArrowLeft/></button><button type="button" aria-label={t('moveUp')} onClick={() => move(0,-stepDots)}><ArrowUp/></button><button type="button" aria-label={t('moveDown')} onClick={() => move(0,stepDots)}><ArrowDown/></button><button type="button" aria-label={t('moveRight')} onClick={() => move(stepDots,0)}><ArrowRight/></button></div></div>
      <button type="button" onClick={() => update(d => ({ [`${element}X`]: 0, ...(element === 'barcode' && linked ? { digitsX: 0 } : {}), ...(element === 'name' || element === 'price' || element === 'caption' ? { [`${element}Align`]: 'center' } : {}), offsetX: d.offsetX }))}><AlignCenter/>{t('centerElement')}</button>
      {element === 'barcode' ? <>
        {resizer(() => clampTo('barcodeHeight', (v.barcodeHeight || drawnHeight) - stepDots, 1, 2000), () => clampTo('barcodeHeight', (v.barcodeHeight || drawnHeight) + stepDots, 1, 2000), 'shorter', 'taller')}
        {resizer(() => clampTo('barWidth', (v.barWidth || drawnModule) - 1, 1, 8), () => clampTo('barWidth', (v.barWidth || drawnModule) + 1, 1, 8), 'thinner', 'thicker')}
        <div className="label-field-pair"><label>{`${t('moduleWidth')} (${t('unitDotShort')}, ${t('auto0')})`}<input type="number" step="1" min="0" max="8" value={Number.isFinite(v.barWidth) ? v.barWidth : ''} onChange={e => update({ barWidth: e.target.value === '' ? NaN : Number(e.target.value) })}/></label>{length('barcodeHeight', t('barHeight'), 0, 2000, t('auto0'))}</div>
      </> : textControls(element)}
      {fittedNames.length > 0 && <p className="label-fitted" role="status">{t('fitted')} {fittedNames.join(', ')}</p>}
      <p className="label-hint">{t('autoFitHint')}</p>
      <details className="label-manual"><summary>{t('wholeLabel')}</summary><div className="label-field-pair">{length('offsetX', t('xOffset'), -3000, 3000)}{length('offsetY', t('yOffset'), -3000, 3000)}</div>{length('margin', t('margin'), 0, 100)}</details>
    </fieldset>
  </section>;
}
