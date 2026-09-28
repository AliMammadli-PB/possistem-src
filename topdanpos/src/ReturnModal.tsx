/**
 * Return some items of a receipt, or exchange them: the returned amount goes
 * out of the drawer as a refund (return.partial) and the sale screen shows it
 * as credit, so the customer pays only the difference for the new size/colour.
 */
import { useState } from 'react';
import { ArrowLeftRight, Minus, Plus, RotateCcw } from 'lucide-react';

import { qtyLabel } from './wholesale';
import { marketCoreClient } from './core/client';
import { Modal } from './forms';
import { money } from './format';
import { tr } from './i18n';
import type { Lang, Product, Sale, SessionUser } from './types';

export type ExchangeCredit = { amountMinor: number; receiptNo: string };

export function ReturnModal({ lang, sale, products, session, onClose, onDone }: { lang: Lang; sale: Sale; products: Map<string, Product>; session: SessionUser; onClose: () => void; onDone: (credit: ExchangeCredit | null) => void }) {
  const lines = sale.items.filter((line) => line.saleItemId != null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = lines.filter((line) => (qty[line.saleItemId!] ?? 0) > 0);
  const estimate = chosen.reduce((sum, line) => sum + (products.get(line.productId)?.priceMinor ?? 0) * (qty[line.saleItemId!] ?? 0), 0);

  const submit = async (exchange: boolean) => {
    setBusy(true);
    setError('');
    try {
      const result = await marketCoreClient.returns.partial({
        saleId: sale.id,
        actorId: session.id,
        lines: chosen.map((line) => ({ saleItemId: line.saleItemId, qty: qty[line.saleItemId!] })),
      }) as { amountMinor?: number };
      onDone(exchange ? { amountMinor: Number(result?.amountMinor ?? estimate), receiptNo: sale.receiptNo } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${tr(lang, 'returnLines')} · ${sale.receiptNo}`} subtitle={tr(lang, 'exchangeHint')} onClose={onClose} wide>
      <div className="return-lines">
        {lines.map((line) => {
          const product = products.get(line.productId);
          const id = line.saleItemId!;
          const value = qty[id] ?? 0;
          return (
            <div key={id} className={value ? 'active' : ''}>
              <span><b>{product?.name[lang] ?? line.productId}</b><small>{product ? [product.barcode, qtyLabel(product, line.qty, lang)].filter(Boolean).join(' · ') : `×${line.qty}`}</small></span>
              <div className="stepper">
                <button type="button" aria-label="-" disabled={!value} onClick={() => setQty((rows) => ({ ...rows, [id]: Math.max(0, value - 1) }))}><Minus /></button>
                <b>{value}</b>
                <button type="button" aria-label="+" disabled={value >= line.qty} onClick={() => setQty((rows) => ({ ...rows, [id]: Math.min(line.qty, value + 1) }))}><Plus /></button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <span className="modal-left">{chosen.length ? `≈ ${money(estimate, lang)}` : ''}</span>
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" disabled={!chosen.length || busy} onClick={() => void submit(false)}><RotateCcw />{tr(lang, 'returnSelected')}</button>
        <button type="button" className="modal-primary" disabled={!chosen.length || busy} onClick={() => void submit(true)}><ArrowLeftRight />{tr(lang, 'exchange')}</button>
      </div>
    </Modal>
  );
}
