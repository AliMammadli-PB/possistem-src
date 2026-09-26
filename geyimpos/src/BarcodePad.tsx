/**
 * Typing a barcode by hand when the scanner cannot read a worn or creased tag:
 * a 0-9 pad on the sale screen, big enough for a finger, usable with a mouse.
 */
import { useState } from 'react';
import { Delete, ScanBarcode } from 'lucide-react';

import { tr } from './i18n';
import type { Lang } from './types';

export function BarcodePad({ lang, onSubmit }: { lang: Lang; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  const submit = () => {
    if (!code) return;
    onSubmit(code);
    setCode('');
  };
  return (
    <section className="barcode-pad" aria-label={tr(lang, 'manualBarcode')}>
      <header><ScanBarcode /><span><b>{tr(lang, 'manualBarcode')}</b><small>{tr(lang, 'manualBarcodeHint')}</small></span></header>
      <output className={code ? 'barcode-display' : 'barcode-display empty'} aria-live="polite">{code || '0000000000000'}</output>
      <div className="barcode-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
          <button type="button" key={key} onClick={() => setCode((value) => (value + key).slice(0, 32))}>{key}</button>
        ))}
        <button type="button" className="key-muted" onClick={() => setCode('')}>C</button>
        <button type="button" onClick={() => setCode((value) => (value + '0').slice(0, 32))}>0</button>
        <button type="button" className="key-muted" aria-label={tr(lang, 'pinBack')} onClick={() => setCode((value) => value.slice(0, -1))}><Delete /></button>
      </div>
      <button type="button" className="barcode-submit" disabled={!code} onClick={submit}>{tr(lang, 'addToCart')}</button>
    </section>
  );
}
