import { useEffect, useRef } from 'react';

type ScannerOptions = {
  minLength?: number;
  onScan: (barcode: string) => void;
  enabled?: boolean;
};

/**
 * USB HID wedge scanner: a rapid character burst terminated by Enter.
 *
 * The scanner stays armed the whole time the till is on the sale screen — a
 * real counter scanner is never "switched on", the cashier just shoots at the
 * item — so what matters is that every scan lands somewhere sensible. Routing
 * is the caller's job (see SalePage): a product code goes into the cart, a
 * loyalty card attaches the customer, and while the payment sheet is open a
 * product scan must NOT quietly change the basket being paid for.
 *
 * Keystrokes are ignored while focus sits in a text field, so typing a search
 * term or an amount never looks like a scan. A field that WANTS scans opts in
 * with data-scanner="allow".
 *
 * Accepts letters and '-' as well as digits: loyalty cards and Code128 product
 * labels are frequently alphanumeric, and a digits-only buffer silently dropped
 * every one of them.
 */
const SCAN_CHAR = /^[0-9A-Za-z-]$/;

/** Longest gap between two keystrokes still considered one scanner burst. */
const BURST_GAP_MS = 120;

export function useBarcodeScanner({ minLength = 6, onScan, enabled = true }: ScannerOptions) {
  const buffer = useRef('');
  const timer = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const allowField = target?.dataset?.scanner === 'allow';
      if (isField && !allowField) return;

      // A modifier means it is a shortcut, not a scanner character.
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (SCAN_CHAR.test(event.key)) {
        buffer.current += event.key;
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => { buffer.current = ''; }, BURST_GAP_MS);
        return;
      }
      if (event.key === 'Enter' && buffer.current.length >= minLength) {
        event.preventDefault();
        const code = buffer.current;
        buffer.current = '';
        if (timer.current) window.clearTimeout(timer.current);
        onScanRef.current(code);
        return;
      }
      // Any other key ends the burst: a half-typed code must not merge with the
      // next scan and resolve to a product nobody scanned.
      buffer.current = '';
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [enabled, minLength]);
}
