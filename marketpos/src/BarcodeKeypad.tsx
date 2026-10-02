/**
 * Typing a barcode by hand when the scanner cannot read a worn or creased tag:
 * a keypad that drops down from the sale screen's Barkod button. Works with a
 * finger, a mouse or the keyboard (digits, Backspace, Enter, Esc).
 */
import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Delete, Keyboard, X } from 'lucide-react';

import { tr } from './i18n';
import type { Lang } from './types';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '.'];

export function BarcodeKeypad({ lang, initial = '', onSubmit, onClose }: { lang: Lang; initial?: string; onSubmit: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const type = (key: string) => { setCode((value) => (value + key).slice(0, 32)); inputRef.current?.focus(); };
  const submit = () => { if (code.trim()) { onSubmit(code.trim()); setCode(''); } inputRef.current?.focus(); };

  // A click outside closes it, like any drop-down.
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node) && !(event.target as Element).closest?.('.scan-button')) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);

  return (
    <div className="barcode-keypad" ref={rootRef} role="dialog" aria-label={tr(lang, 'manualBarcode')}>
      <div className="barcode-keypad__display">
        <span aria-hidden="true"><Keyboard /></span>
        <input
          ref={inputRef}
          autoFocus
          inputMode="decimal"
          value={code}
          placeholder={tr(lang, 'manualBarcode')}
          aria-label={tr(lang, 'manualBarcode')}
          onChange={(event) => setCode(event.target.value.replace(/[^\dA-Za-z.-]/g, '').slice(0, 32))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); submit(); }
            if (event.key === 'Escape') onClose();
          }}
        />
        <button type="button" className="barcode-keypad__close" onClick={onClose} aria-label={tr(lang, 'close')}><X /></button>
      </div>
      <div className="barcode-keypad__keys">
        {KEYS.map((key) => <button type="button" key={key} onClick={() => type(key)}>{key}</button>)}
        <button type="button" className="key-back" onClick={() => { setCode((value) => value.slice(0, -1)); inputRef.current?.focus(); }} aria-label={tr(lang, 'pinBack')}><Delete /></button>
        <button type="button" className="key-clear" onClick={() => { setCode(''); inputRef.current?.focus(); }}>C</button>
        <button type="button" className="key-enter" onClick={submit} disabled={!code.trim()} aria-label={tr(lang, 'addToCart')}><CornerDownLeft /></button>
      </div>
    </div>
  );
}
