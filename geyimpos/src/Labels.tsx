/**
 * Price tags with a CODE128 barcode: printed on A4 label sheets through the
 * system print dialog, or sent to a thermal label printer (market:printer:label).
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Tags } from 'lucide-react';

import { variantLabel } from './apparel';
import { code128Svg } from './code128';
import { stockOf } from './domain';
import { Modal } from './forms';
import { money } from './format';
import { tr } from './i18n';
import type { Lang, Product, SessionUser } from './types';

function Label({ product, storeName, lang }: { product: Product; storeName: string; lang: Lang }) {
  const svg = useMemo(() => code128Svg(product.barcode), [product.barcode]);
  return (
    <div className="price-tag">
      <small>{storeName}</small>
      <b>{product.brand ? `${product.brand} · ` : ''}{product.name[lang]}</b>
      <span>{variantLabel(product, lang) || product.sku}</span>
      <i dangerouslySetInnerHTML={{ __html: svg }} />
      <code>{product.barcode}</code>
      <strong>{money(product.priceMinor, lang)}</strong>
    </div>
  );
}

export function LabelModal({ lang, products, storeName, session, notify, onClose }: { lang: Lang; products: Product[]; storeName: string; session: SessionUser; notify: (text: string) => void; onClose: () => void }) {
  const printable = products.filter((product) => product.kind !== 'service' && product.barcode);
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(printable.map((product) => [product.id, String(Math.max(1, stockOf(product)))])));
  const [printing, setPrinting] = useState(false);
  const sheet = printable.flatMap((product) => Array.from({ length: Math.min(200, Math.max(0, Number(counts[product.id]) || 0)) }, () => product));

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('printing-labels');
    const done = () => { document.body.classList.remove('printing-labels'); setPrinting(false); };
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', done); document.body.classList.remove('printing-labels'); };
  }, [printing]);

  const toPrinter = async () => {
    try {
      for (const product of printable) {
        const count = Math.min(100, Math.max(0, Number(counts[product.id]) || 0));
        if (count) await window.marketSystem?.printer?.label(session.sessionToken, product, count);
      }
      notify(`${tr(lang, 'printLabels')} · ${sheet.length}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal title={tr(lang, 'printLabels')} subtitle={`${printable.length} ${tr(lang, 'variants')} · ${sheet.length} ${tr(lang, 'labelsWord')}`} onClose={onClose} wide>
      <div className="label-list">
        {printable.map((product) => (
          <label key={product.id}>
            <span><b>{product.name[lang]}</b><small>{[variantLabel(product, lang), product.barcode].filter(Boolean).join(' · ')}</small></span>
            <input type="number" min={0} max={200} inputMode="numeric" value={counts[product.id] ?? '0'} onChange={(event) => setCounts((rows) => ({ ...rows, [product.id]: event.target.value }))} aria-label={tr(lang, 'labelCount')} />
          </label>
        ))}
      </div>
      {printable[0] && <div className="label-preview"><Label product={printable[0]} storeName={storeName} lang={lang} /></div>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        {window.marketSystem?.printer?.label && <button type="button" disabled={!sheet.length} onClick={() => void toPrinter()}><Tags />{tr(lang, 'labelPrinter')}</button>}
        <button type="button" className="modal-primary" disabled={!sheet.length} onClick={() => setPrinting(true)}><Printer />{tr(lang, 'labelSheet')}</button>
      </div>
      {printing && createPortal(<div className="label-print-root">{sheet.map((product, index) => <Label key={`${product.id}-${index}`} product={product} storeName={storeName} lang={lang} />)}</div>, document.body)}
    </Modal>
  );
}
