import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { DEFAULT_LABEL_SAMPLE, LABEL_FONTS, type LabelPreview, type LabelProfile, type LabelSample } from './labelTypes';
import type { DesignEdit } from './LabelCanvas';
import type { LabelElement } from './labelLayout';
import { labelText, type LabelWord } from './labelText';
import type { Lang } from './types';

export type SampleEdit = (key: keyof LabelSample, value: string) => void;
export function LabelSampleInput({ profile, element, lang, update, onInvalid }: { profile: LabelProfile; element: LabelElement; lang: Lang; update: SampleEdit; onInvalid: (invalid: boolean) => void }) {
  const t = (key: LabelWord) => labelText(lang, key), sample = profile.sample || DEFAULT_LABEL_SAMPLE;
  const [code, setCode] = useState(sample.barcode), [invalid, setInvalid] = useState(false);
  useEffect(() => { setCode(sample.barcode); setInvalid(false); }, [sample.barcode]);
  if (element === 'caption') return null;
  if (element === 'name' || element === 'price') return <label className="label-sample-field">{t(element === 'name' ? 'sampleName' : 'samplePrice')}<input className="label-sample-input" aria-label={t(element === 'name' ? 'sampleName' : 'samplePrice')} maxLength={element === 'name' ? 400 : 80} value={sample[element]} placeholder={element === 'name' ? t('sampleNameDefault') : '12.50 AZN'} onChange={e => update(element, e.target.value.replace(/[\r\n\0]/g, ''))}/><small>{t('sampleOnly')}</small></label>;
  const valid = (s: string) => /^\d{13}$/.test(s) && (10 - [...s.slice(0,12)].reduce((sum,n,i) => sum + Number(n) * (i % 2 ? 3 : 1),0) % 10) % 10 === Number(s[12]);
  return <label className="label-sample-field">{t('sampleCode')}<input className="label-sample-input" aria-label={t('sampleCode')} inputMode="numeric" maxLength={13} value={code} aria-invalid={invalid} onChange={e => { const s = e.target.value; setCode(s); setInvalid(!valid(s)); onInvalid(!valid(s)); if (valid(s)) update('barcode', s); }} onBlur={() => setInvalid(!valid(code))}/><small>{invalid ? t('E_LABEL_EAN13') : t('sampleOnly')}</small></label>;
}

export function LabelFontControls({ profile, element, edit, lang }: { profile: LabelProfile; element: Exclude<LabelElement,'barcode'>; edit: DesignEdit; lang: Lang }) {
  const t = (key: LabelWord) => labelText(lang, key), d = profile.design;
  return <div className="label-font-controls">
    <label>{t('fontFamily')}<select value={d[`${element}Font`]} onChange={e => edit({ [`${element}Font`]: e.target.value }, { anchor: element })}>{LABEL_FONTS.map(font => <option key={font} value={font}>{font}</option>)}</select></label>
    <button type="button" aria-pressed={d[`${element}Italic`]} onClick={() => edit({ [`${element}Italic`]: !d[`${element}Italic`] }, { anchor: element })}><i aria-hidden>I</i>{t('italic')}</button>
    <label>{t('fontSize')} · {((d[`${element}Size`] * d[`${element}ScaleY`]) / (profile.dpi === 300 ? 12 : 8)).toFixed(2)} mm<input type="range" min="6" max="400" step="0.1" value={d[`${element}Size`]} onChange={e => edit({ [`${element}Size`]: Number(e.target.value) }, { anchor: element })}/></label>
  </div>;
}

export function LabelStripeControls({ profile, preview, mode, setMode, index, setIndex, edit, lang }: {
  profile: LabelProfile; preview?: LabelPreview | null; mode: boolean; setMode: (b: boolean) => void; index: number; setIndex: (n: number) => void; edit: DesignEdit; lang: Lang;
}) {
  const t = (key: LabelWord) => labelText(lang, key), d = profile.design, stripes = preview?.stripes || [], at = Math.max(0, stripes.findIndex(b => b.index === index)), stripe = stripes[at], dots = profile.dpi === 300 ? 12 : 8;
  const selected = d.barEdits[index] || { shift: 0, top: 0, width: 1, height: 1, hidden: false };
  const update = (patch: Partial<typeof selected>) => edit(v => ({ barEdits: { ...v.barEdits, [index]: { shift: 0, top: 0, width: 1, height: 1, hidden: false, ...v.barEdits[index], ...patch } } }));
  return <div className="label-stripe-controls">
    <label>{t('inkWidth')} · {Math.round(d.inkScale * 100)}%<input type="range" min="0.1" max="3" step="0.01" value={d.inkScale} onChange={e => edit({ inkScale: Number(e.target.value) })}/></label>
    <button type="button" className="label-stripe-mode" aria-pressed={mode} onClick={() => setMode(!mode)}>{t('editStripes')}</button>
    {mode && <><p>{t('stripeHint')}</p><div className="label-stripe-select"><button type="button" aria-label={t('previousStripe')} disabled={at <= 0} onClick={() => setIndex(stripes[at-1]!.index)}><ChevronLeft/></button><b>{t('stripe')} {at + 1} / {stripes.length}</b><button type="button" aria-label={t('nextStripe')} disabled={at >= stripes.length-1} onClick={() => setIndex(stripes[at+1]!.index)}><ChevronRight/></button></div>
      {stripe && <output>{(stripe.width/dots).toFixed(2)} × {(stripe.height/dots).toFixed(2)} mm</output>}
      <label>{t('stripeWidth')}<input type="range" min="0.1" max="4" step="0.01" value={selected.width} onChange={e => update({ width: Number(e.target.value) })}/></label>
      <label>{t('stripeHeight')}<input type="range" min="0.05" max="3" step="0.01" value={selected.height} onChange={e => update({ height: Number(e.target.value) })}/></label>
      <button type="button" aria-pressed={selected.hidden} onClick={() => update({ hidden: !selected.hidden })}>{t(selected.hidden ? 'restoreStripe' : 'hideStripe')}</button>
      <button type="button" onClick={() => edit(v => { const next = { ...v.barEdits }; delete next[index]; return { barEdits: next }; })}><RotateCcw/>{t('resetStripe')}</button>
    </>}
    <button type="button" onClick={() => edit({ barEdits: {}, inkScale: 1 })}><RotateCcw/>{t('resetStripes')}</button>
    <small>{t('stripeScanNote')}</small>
  </div>;
}
