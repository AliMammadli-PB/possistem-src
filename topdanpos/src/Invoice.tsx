/**
 * Qaimə-faktura: the A4 document a wholesale sale leaves with the goods —
 * seller and buyer (with VÖEN), every line in packs and pieces at the buyer's
 * price level, the total in words, how it was paid and what is still owed.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, ReceiptText } from 'lucide-react';

import { Modal } from './forms';
import { money } from './format';
import { tr } from './i18n';
import { amountInWords, packLabel, packUnitsOf, qtyLabel, tierLabel, unitLabel, type Customer } from './wholesale';
import type { Lang, Product, StoreSettings } from './types';

export type InvoiceData = {
  receiptNo: string;
  createdAt: number;
  customer: Customer | null;
  lines: Array<{ product: Product; qty: number; unitMinor: number }>;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  cashMinor: number;
  cardMinor: number;
  creditMinor: number;
  debtBeforeMinor: number;
  saleId: string;
};

export function InvoiceDoc({ lang, settings, data }: { lang: Lang; settings: StoreSettings; data: InvoiceData }) {
  const vat = Math.round((data.totalMinor * 18) / 118);
  return (
    <article className="a4-doc invoice-doc">
      <header>
        <div>
          <h1>{tr(lang, 'invoiceTitle')}</h1>
          <p>№ {data.receiptNo} · {new Date(data.createdAt).toLocaleString('az-AZ')}</p>
        </div>
        <div>
          <b>{settings.legalName || settings.storeName}</b>
          <small>{[settings.taxId && `VÖEN ${settings.taxId}`, settings.address, settings.phone].filter(Boolean).join(' · ')}</small>
        </div>
      </header>
      <div className="doc-parties">
        <p><small>{tr(lang, 'seller')}</small><b>{settings.legalName || settings.storeName}</b>{settings.taxId ? <span>VÖEN {settings.taxId}</span> : null}</p>
        <p><small>{tr(lang, 'buyer')}</small><b>{data.customer?.name ?? tr(lang, 'walkIn')}</b>{data.customer ? <span>{[data.customer.voen && `VÖEN ${data.customer.voen}`, data.customer.address, data.customer.phone].filter(Boolean).join(' · ')}</span> : null}<span>{tr(lang, 'priceLevel')}: {tierLabel(data.customer?.priceTier, lang)}</span></p>
      </div>
      <table>
        <thead>
          <tr><th>№</th><th>{tr(lang, 'goodsName')}</th><th>{tr(lang, 'barcode')}</th><th className="num">{tr(lang, 'qty')}</th><th className="num">{tr(lang, 'unitPriceCol')}</th><th className="num">{tr(lang, 'amount')}</th></tr>
        </thead>
        <tbody>
          {data.lines.map(({ product, qty, unitMinor }, index) => {
            const per = packUnitsOf(product);
            return (
              <tr key={product.id}>
                <td>{index + 1}</td>
                <td>{product.name[lang]}{per > 1 && product.packName ? <small> · 1 {packLabel(product, lang)} = {per} {unitLabel(product, lang)}</small> : null}</td>
                <td>{product.barcode}</td>
                <td className="num">{qtyLabel(product, qty, lang)}{per > 1 && product.packName ? <small>{qty} {unitLabel(product, lang)}</small> : null}</td>
                <td className="num">{money(unitMinor * (per > 1 && product.packName ? per : 1), lang)}<small>{per > 1 && product.packName ? `/ ${packLabel(product, lang)}` : `/ ${unitLabel(product, lang)}`}</small></td>
                <td className="num">{money(unitMinor * qty, lang)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={5}>{tr(lang, 'subtotal')}</td><td className="num">{money(data.subtotalMinor, lang)}</td></tr>
          {data.discountMinor > 0 && <tr><td colSpan={5}>{tr(lang, 'discount')}</td><td className="num">-{money(data.discountMinor, lang)}</td></tr>}
          <tr><td colSpan={5}>{tr(lang, 'vatIncluded')}</td><td className="num">{money(vat, lang)}</td></tr>
          <tr className="grand"><td colSpan={5}>{tr(lang, 'total')}</td><td className="num">{money(data.totalMinor, lang)}</td></tr>
        </tfoot>
      </table>
      <p className="doc-words">{tr(lang, 'inWords')}: <b>{amountInWords(data.totalMinor)}</b></p>
      <div className="doc-payment">
        {data.cashMinor > 0 && <span>{tr(lang, 'cash')}: <b>{money(data.cashMinor, lang)}</b></span>}
        {data.cardMinor > 0 && <span>{tr(lang, 'card')}: <b>{money(data.cardMinor, lang)}</b></span>}
        {data.creditMinor > 0 && <span>{tr(lang, 'credit')}: <b>{money(data.creditMinor, lang)}</b></span>}
        {data.customer && (data.creditMinor > 0 || data.debtBeforeMinor > 0) && (
          <span>{tr(lang, 'debtBefore')}: <b>{money(data.debtBeforeMinor, lang)}</b> → {tr(lang, 'debtAfter')}: <b>{money(data.debtBeforeMinor + data.creditMinor, lang)}</b></span>
        )}
      </div>
      <footer className="doc-signs">
        <span>{tr(lang, 'handedOver')} ____________<small>M.Y.</small></span>
        <span>{tr(lang, 'received')} ____________<small>{tr(lang, 'signature')}</small></span>
      </footer>
    </article>
  );
}

/** Shown after a sale: print the A4 invoice, or the till receipt. */
export function InvoiceModal({ lang, settings, data, onReceipt, onClose }: { lang: Lang; settings: StoreSettings; data: InvoiceData; onReceipt?: () => void; onClose: () => void }) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('printing-doc');
    const done = () => { document.body.classList.remove('printing-doc'); setPrinting(false); };
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', done); document.body.classList.remove('printing-doc'); };
  }, [printing]);
  return (
    <Modal title={tr(lang, 'invoiceTitle')} subtitle={`${data.receiptNo} · ${money(data.totalMinor, lang)}`} onClose={onClose} wide>
      <div className="doc-preview"><InvoiceDoc lang={lang} settings={settings} data={data} /></div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'close')}</button>
        {onReceipt && <button type="button" onClick={onReceipt}><ReceiptText />{tr(lang, 'receipt80')}</button>}
        <button type="button" className="modal-primary invoice-print" onClick={() => setPrinting(true)}><Printer />{tr(lang, 'printInvoice')}</button>
      </div>
      {printing && createPortal(<div className="doc-print-root"><InvoiceDoc lang={lang} settings={settings} data={data} /></div>, document.body)}
    </Modal>
  );
}
