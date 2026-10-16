import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, CircleDollarSign, CreditCard, Delete, ReceiptText, TriangleAlert, WalletCards, X } from 'lucide-react';
import { cashChange, parseMoneyInput } from './domain';
import { money } from './format';
import { tr } from './i18n';
import type { Lang, Payment, Product } from './types';

/** Display a refusal in the cashier's language, without exposing internal IDs. */
export function checkoutErrorMessage(error: unknown, products: Product[], lang: Lang): string {
  const fault = error as { code?: string; details?: { productId?: string; available?: number; requested?: number } };
  if (fault?.code === 'INSUFFICIENT_STOCK') {
    const product = products.find((row) => row.id === fault.details?.productId);
    const name = product?.name[lang] || product?.name.az || tr(lang, 'product');
    const available = Number(fault.details?.available);
    const requested = Number(fault.details?.requested);
    return tr(lang, 'checkoutStockError').replace('{product}', name)
      .replace('{available}', Number.isFinite(available) ? String(available) : '—')
      .replace('{requested}', Number.isFinite(requested) ? String(requested) : '—');
  }
  if (fault?.code === 'REGISTER_CLOSED') return tr(lang, 'registerClosed');
  if (['PERMISSION_DENIED', 'E_FORBIDDEN'].includes(fault?.code || '')) return tr(lang, 'checkoutDenied');
  return tr(lang, 'checkoutFailed');
}

type CheckoutItem = { name: string; quantity: string; totalMinor: number };
type Props = { busy: boolean; error: string | null; lang: Lang; storeName: string; totalMinor: number; subtotalMinor: number; discountMinor: number; items: CheckoutItem[]; onClose: () => void; onComplete: (payment: Payment) => void };
const validAmount = (value: string) => /^\d+(?:[.,]\d{0,2})?$/.test(value.trim()) && Number.isSafeInteger(parseMoneyInput(value));

export function PaymentModal({ busy, error, lang, storeName, totalMinor, subtotalMinor, discountMinor, items, onClose, onComplete }: Props) {
  const [method, setMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [tendered, setTendered] = useState((totalMinor / 100).toFixed(2));
  const [cashPart, setCashPart] = useState((Math.floor(totalMinor / 2) / 100).toFixed(2));
  const [terminalRef, setTerminalRef] = useState('');
  const replaceAmount = useRef(true);
  const errorPanel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [busy, onClose]);
  useEffect(() => { if (error) errorPanel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [error]);
  const tenderedMinor = method === 'card' ? totalMinor : parseMoneyInput(tendered);
  const change = method === 'cash' ? cashChange(totalMinor, tenderedMinor) : 0;
  const cashMinor = parseMoneyInput(cashPart);
  const cardMinor = Math.max(0, totalMinor - cashMinor);
  const valid = method === 'card' || (method === 'mixed'
    ? validAmount(cashPart) && cashMinor > 0 && cashMinor < totalMinor
    : validAmount(tendered) && tenderedMinor >= totalMinor);
  const amount = method === 'mixed' ? cashPart : tendered;
  const setAmount = method === 'mixed' ? setCashPart : setTendered;
  const key = (digit: string) => {
    if (busy) return;
    const current = replaceAmount.current ? '' : amount;
    replaceAmount.current = false;
    if (digit === 'clear') { setAmount(''); return; }
    if (digit === 'back') { setAmount(current.slice(0, -1)); return; }
    if (digit === '.') {
      if (!/[.,]/.test(current)) setAmount((current || '0') + '.');
      return;
    }
    const next = current === '0' ? digit : current + digit;
    if (/^\d{0,10}(?:[.,]\d{0,2})?$/.test(next)) setAmount(next);
  };
  const selectMethod = (value: typeof method) => { setMethod(value); replaceAmount.current = true; };
  const submit = () => {
    if (busy || !valid) return;
    onComplete({ method, amountMinor: totalMinor, tenderedMinor: method === 'cash' ? tenderedMinor : totalMinor, changeMinor: change,
      cashMinor: method === 'mixed' ? cashMinor : undefined, cardMinor: method === 'mixed' ? cardMinor : method === 'card' ? totalMinor : undefined, terminalRef: terminalRef.trim() || undefined });
  };
  return <div className="modal-backdrop payment-backdrop"><section ref={dialog} className="payment-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title" aria-busy={busy}>
    <header className="payment-header"><div className="payment-heading"><span className="payment-heading-icon"><WalletCards /></span><div><p>{storeName || 'MarketPos'}</p><h2 id="checkout-title">{tr(lang, 'pay')}</h2></div></div><div className="payment-header-total"><small>{tr(lang, 'total')}</small><strong>{money(totalMinor, lang)}</strong></div><button className="payment-close" onClick={onClose} disabled={busy} aria-label={tr(lang, 'close')}><X /></button></header>
    <div className="payment-scroll">
      <div ref={errorPanel} className={error ? 'checkout-error' : 'checkout-error hidden'} role={error ? 'alert' : undefined}>{error && <><TriangleAlert /><div><strong>{tr(lang, 'checkoutNotCompleted')}</strong><p>{error}</p><small>{tr(lang, 'checkoutNotPrinted')}</small></div></>}</div>
      <fieldset className="payment-layout" disabled={busy}>
        <section className="payment-entry"><h3><span>01</span>{tr(lang, 'checkoutMethod')}</h3><div className="payment-methods">{([{ id: 'cash', icon: CircleDollarSign, hint: 'checkoutCashHint' }, { id: 'card', icon: CreditCard, hint: 'checkoutCardHint' }, { id: 'mixed', icon: WalletCards, hint: 'checkoutMixedHint' }] as const).map(({ id, icon: Icon, hint }) => <button key={id} className={method === id ? 'active' : ''} aria-pressed={method === id} onClick={() => selectMethod(id)}><Icon /><b>{tr(lang, id)}</b><small>{tr(lang, hint)}</small>{method === id && <Check className="method-check" />}</button>)}</div>
          {method !== 'card' ? <div className="payment-amount-grid"><div><label className="money-field" htmlFor="checkout-amount">{tr(lang, method === 'mixed' ? 'checkoutCashPart' : 'tendered')}<span><input id="checkout-amount" autoFocus value={amount} onFocus={(event) => { event.target.select(); replaceAmount.current = true; }} onChange={(event) => { setAmount(event.target.value); replaceAmount.current = false; }} inputMode="decimal" autoComplete="off" aria-invalid={!valid} /><b>AZN</b></span></label>
            {method === 'cash' ? <div className="quick-cash">{[totalMinor, ...[500, 1000, 2000, 5000, 10000].filter((value) => value >= totalMinor)].filter((value, index, rows) => rows.indexOf(value) === index).map((value) => <button key={value} onClick={() => { setTendered((value / 100).toFixed(2)); replaceAmount.current = true; }}>{value === totalMinor ? tr(lang, 'checkoutExact') : money(value, lang)}</button>)}</div> : <div className="payment-card-remainder"><CreditCard /><span>{tr(lang, 'checkoutCardPart')}<strong>{money(cardMinor, lang)}</strong></span></div>}
            {!valid && <p className="payment-validation" role="status">{tr(lang, method === 'mixed' ? 'checkoutSplitInvalid' : 'cashNotEnough')}</p>}
            <div className="payment-change"><span>{tr(lang, method === 'mixed' ? 'checkoutCardPart' : 'change')}</span><strong>{money(method === 'mixed' ? cardMinor : change, lang)}</strong></div>
          </div><div className="payment-keypad" aria-label={tr(lang, 'checkoutKeypad')}>{['1','2','3','4','5','6','7','8','9','.','0','back'].map((digit) => <button key={digit} onMouseDown={(event) => event.preventDefault()} onClick={() => key(digit)} aria-label={digit === 'back' ? tr(lang, 'checkoutBackspace') : digit}>{digit === 'back' ? <Delete /> : digit}</button>)}<button className="payment-clear" onMouseDown={(event) => event.preventDefault()} onClick={() => key('clear')}>{tr(lang, 'checkoutClearAmount')}</button></div></div>
          : <div className="payment-card-info"><CreditCard /><strong>{money(totalMinor, lang)}</strong><p>{tr(lang, 'checkoutCardInfo')}</p></div>}
          {method !== 'cash' && <label className="payment-reference">{tr(lang, 'checkoutTerminalRef')}<input value={terminalRef} onChange={(event) => setTerminalRef(event.target.value)} placeholder="RRN / auth" autoComplete="off" /></label>}
        </section>
        <aside className="checkout-basket"><h3><span>02</span>{tr(lang, 'checkoutBasket')}<ReceiptText /></h3><div className="checkout-basket-lines">{items.map((item, index) => <div key={index}><span><b>{item.name}</b><small>{item.quantity}</small></span><strong>{money(item.totalMinor, lang)}</strong></div>)}</div><div className="checkout-totals"><div><span>{tr(lang, 'subtotal')}</span><b>{money(subtotalMinor, lang)}</b></div>{discountMinor > 0 && <div><span>{tr(lang, 'discount')}</span><b>−{money(discountMinor, lang)}</b></div>}<div className="checkout-grand-total"><span>{tr(lang, 'total')}</span><strong>{money(totalMinor, lang)}</strong></div></div><p className="checkout-print-note"><ReceiptText />{tr(lang, 'checkoutPrintNote')}</p></aside>
      </fieldset>
    </div>
    <footer className="payment-footer"><button className="payment-back" disabled={busy} onClick={onClose}><ArrowLeft />{tr(lang, 'checkoutBack')}</button><button className="modal-primary payment-complete" aria-busy={busy} disabled={busy || !valid} onClick={submit}><Check /><span>{tr(lang, busy ? 'paymentProcessing' : 'completePayment')}<small>{method === 'cash' ? `${tr(lang, 'change')}: ${money(change, lang)}` : money(totalMinor, lang)}</small></span><ChevronRight /></button></footer>
  </section></div>;
}
