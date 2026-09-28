/**
 * The wholesale sale screen is an invoice being written, not a basket:
 *   1. who is buying (their price level, VÖEN, debt and credit left),
 *   2. the lines, in packs and loose pieces, at that buyer's price,
 *   3. payment split over cash, card and nisyə (credit), then the A4 qaimə.
 * Goods are found by scanner, by the 0-9 pad, by typing, or from the price list.
 */
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, BookUser, Check, ChevronRight, CircleDollarSign, CreditCard, HandCoins, Keyboard, ListChecks,
  LockKeyhole, Minus, Pause, Plus, ScanBarcode, Search, Trash2, UserRound, WalletCards, X,
} from 'lucide-react';

import { BarcodePad } from './BarcodePad';
import { CatalogAisleNav } from './CatalogAisleNav';
import { marketCoreClient } from './core/client';
import { CustomerPicker, TierBadge, loadCustomers } from './Customers';
import { findBarcode, parseMoneyInput, stockOf } from './domain';
import { Modal } from './forms';
import { money, newId } from './format';
import { tr } from './i18n';
import { InvoiceModal, type InvoiceData } from './Invoice';
import { ProductVisual } from './ProductVisual';
import type { ExchangeCredit } from './ReturnModal';
import { useBarcodeScanner } from './useBarcodeScanner';
import { creditLeft, packLabel, packPrice, packUnitsOf, priceFor, qtyLabel, splitQty, unitLabel, type Customer } from './wholesale';
import type { CartLine, HeldCart, Lang, Payment, PersistedState, Product, SessionUser } from './types';

type Props = {
  state: PersistedState;
  setState: React.Dispatch<React.SetStateAction<PersistedState>>;
  session: SessionUser;
  lang: Lang;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  cloudConnected: boolean;
  notify: (text: string) => void;
  coreReady: boolean;
  onRefresh: () => Promise<PersistedState>;
  exchangeCredit: ExchangeCredit | null;
  onExchangeDone: () => void;
};

const sellsLoose = (product: Product) => packUnitsOf(product) <= 1 || !product.packName || product.splitAllowed !== false;
const packable = (product: Product) => packUnitsOf(product) > 1 && Boolean(product.packName);

export function InvoiceSale({ state, setState, session, lang, cart, setCart, cloudConnected, notify, coreReady, onRefresh, exchangeCredit, onExchangeDone }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [discount, setDiscount] = useState('0');
  const inputRef = useRef<HTMLInputElement>(null);

  const reloadCustomers = useCallback(() => { if (coreReady) void loadCustomers().then(setCustomers).catch(() => undefined); }, [coreReady]);
  useEffect(reloadCustomers, [reloadCustomers]);

  const tier = customer?.priceTier ?? 'retail';
  const products = useMemo(() => state.products.filter((product) => product.active), [state.products]);
  const onSale = useMemo(() => products.filter((product) => product.kind === 'service' || stockOf(product) > 0), [products]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const register = state.registers.find((row) => row.id === state.settings.defaultRegisterId);
  const warehouseId = state.settings.defaultWarehouseId;

  const suggestions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('az');
    if (!needle) return [];
    return onSale.filter((product) => product.barcode.includes(needle) || product.sku.toLocaleLowerCase('az').includes(needle)
      || (product.manufacturer ?? '').toLocaleLowerCase('az').includes(needle)
      || Object.values(product.name).some((name) => name.toLocaleLowerCase('az').includes(needle))).slice(0, 8);
  }, [onSale, query]);
  useEffect(() => setActive(0), [query]);

  const lines = cart.flatMap((line) => {
    const product = productMap.get(line.productId);
    return product ? [{ ...line, product, unitMinor: priceFor(product, tier) }] : [];
  });
  const subtotal = lines.reduce((sum, line) => sum + line.unitMinor * line.qty, 0);
  const discountMinor = Math.min(subtotal, parseMoneyInput(discount));
  const total = subtotal - discountMinor;
  const packsTotal = lines.reduce((sum, line) => sum + (packable(line.product) ? splitQty(line.product, line.qty).packs : 0), 0);

  const setQty = (product: Product, pieces: number) => {
    const max = product.kind === 'service' ? Number.MAX_SAFE_INTEGER : stockOf(product);
    const next = Math.max(0, Math.min(max, Math.floor(pieces)));
    if (pieces > max) notify(`${tr(lang, 'outOfStock')} · ${qtyLabel(product, max, lang)}`);
    setCart((rows) => {
      const exists = rows.some((row) => row.productId === product.id);
      if (!next) return rows.filter((row) => row.productId !== product.id);
      return exists ? rows.map((row) => (row.productId === product.id ? { ...row, qty: next } : row)) : [...rows, { productId: product.id, qty: next }];
    });
  };
  const add = (product: Product, pieces = packable(product) ? packUnitsOf(product) : 1) => {
    const current = cart.find((line) => line.productId === product.id)?.qty ?? 0;
    setQty(product, current + pieces);
    startTransition(() => setQuery(''));
    inputRef.current?.focus();
  };

  const scan = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          const resolved = await marketCoreClient.barcode.resolve(value);
          const product = productMap.get(String(resolved.productId || resolved.id || ''));
          if (product) { add(product); notify(`${product.name[lang]} · ${qtyLabel(product, packable(product) ? packUnitsOf(product) : 1, lang)}`); return; }
        }
      } catch { /* fall back to the local catalogue */ }
      const product = findBarcode(products, value);
      if (product) { add(product); notify(`${product.name[lang]} · ${qtyLabel(product, packable(product) ? packUnitsOf(product) : 1, lang)}`); }
      else if (suggestions[0]) add(suggestions[active] ?? suggestions[0]);
      else notify(tr(lang, 'noResults'));
    })();
  };
  useBarcodeScanner({ enabled: !pickerOpen && !payOpen && !invoice, onScan: scan });

  const reset = () => { setCart([]); setDiscount('0'); setCustomer(null); onExchangeDone(); };
  const hold = () => {
    if (!cart.length) return;
    const label = `${customer?.name ?? tr(lang, 'walkIn')} · #${state.heldCarts.length + 1}`;
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          await marketCoreClient.sales.hold({ lines: cart, label, cashierId: session.id, registerId: register?.id ?? state.settings.defaultRegisterId, discountMinor });
          await onRefresh();
        } else {
          const held: HeldCart = { id: newId('held'), label, createdAt: Date.now(), lines: cart };
          setState((previous) => ({ ...previous, heldCarts: [...previous.heldCarts, held] }));
        }
        reset();
      } catch (err) { notify(err instanceof Error ? err.message : String(err)); }
    })();
  };
  const resume = (held: HeldCart) => {
    void (async () => {
      try {
        if (coreReady && marketCoreClient.available()) {
          const resumed = await marketCoreClient.sales.resume(held.id) as { lines: CartLine[]; discountMinor?: number };
          setCart(resumed.lines || held.lines);
          if (resumed.discountMinor != null) setDiscount((Number(resumed.discountMinor) / 100).toFixed(2));
          await onRefresh();
        } else {
          setCart(held.lines);
          setState((previous) => ({ ...previous, heldCarts: previous.heldCarts.filter((row) => row.id !== held.id) }));
        }
        const who = customers.find((row) => held.label.startsWith(`${row.name} · `));
        if (who) setCustomer(who);
      } catch (err) { notify(err instanceof Error ? err.message : String(err)); }
    })();
  };

  const complete = (payment: Payment) => {
    void (async () => {
      try {
        let terminalRef = payment.terminalRef;
        if ((payment.cardMinor ?? 0) > 0 && window.marketSystem?.terminal) {
          const mode = (localStorage.getItem('topdanpos.terminalMode') as 'manual' | 'mock_integrated') || 'manual';
          const term = await window.marketSystem.terminal.pay(session.sessionToken, { amountMinor: payment.cardMinor ?? 0, mode, reference: payment.terminalRef || '' });
          if (term.status === 'declined') throw new Error('Terminal declined');
          terminalRef = String(term.reference || term.authCode || terminalRef || '');
          await marketCoreClient.terminal.record({ amountMinor: payment.cardMinor ?? 0, reference: terminalRef, status: term.status || 'approved', provider: mode, authCode: term.authCode });
        }
        const sale = await marketCoreClient.sales.complete({
          cashierId: session.id, registerId: register?.id ?? state.settings.defaultRegisterId, warehouseId, discountMinor,
          items: cart, payment: { ...payment, terminalRef }, role: session.role,
          customerId: customer?.id, customerName: customer?.name,
        });
        try {
          await marketCoreClient.fiscal.enqueue({ saleId: sale.id, kind: 'sale', idempotencyKey: `sale:${sale.id}`, request: { saleId: sale.id, totalMinor: sale.totalMinor, receiptNo: sale.receiptNo } });
          await window.marketSystem?.fiscal?.processPending(session.sessionToken);
        } catch { /* fiscal is optional */ }
        setInvoice({
          saleId: sale.id, receiptNo: sale.receiptNo, createdAt: sale.createdAt || Date.now(), customer,
          lines: lines.map(({ product, qty, unitMinor }) => ({ product, qty, unitMinor })),
          subtotalMinor: subtotal, discountMinor, totalMinor: sale.totalMinor ?? total,
          cashMinor: payment.cashMinor ?? 0, cardMinor: payment.cardMinor ?? 0, creditMinor: payment.creditMinor ?? 0,
          debtBeforeMinor: customer?.balanceMinor ?? 0,
        });
        setPayOpen(false);
        reset();
        await onRefresh();
        reloadCustomers();
        notify(`${tr(lang, 'completed')} · ${sale.receiptNo}`);
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err));
      }
    })();
  };
  const printReceipt = (saleId: string) => {
    void (async () => {
      try {
        const receipt = await marketCoreClient.sales.receipt(saleId);
        await window.marketSystem?.printer?.receipt(session.sessionToken, receipt, 80);
      } catch (err) { notify(err instanceof Error ? err.message : String(err)); }
    })();
  };

  return (
    <div className="invoice-layout">
      <section className="invoice-main">
        <button type="button" className={customer ? 'buyer-card' : 'buyer-card walk-in'} onClick={() => setPickerOpen(true)}>
          <span className="buyer-icon">{customer ? <BookUser /> : <UserRound />}</span>
          <span className="buyer-copy">
            <small>{tr(lang, 'buyer')}</small>
            <b>{customer?.name ?? tr(lang, 'walkIn')}</b>
            <em>{customer ? [customer.voen && `VÖEN ${customer.voen}`, customer.phone, customer.address].filter(Boolean).join(' · ') || '—' : tr(lang, 'walkInHint')}</em>
          </span>
          <TierBadge tier={tier} lang={lang} />
          {customer && (
            <span className="buyer-debt">
              <small>{tr(lang, 'debt')}</small><b className={customer.balanceMinor > 0 ? 'debt' : ''}>{money(customer.balanceMinor, lang)}</b>
              <small>{customer.creditAllowed ? `${tr(lang, 'creditLeft')} ${money(creditLeft(customer), lang)}` : tr(lang, 'noCredit')}</small>
            </span>
          )}
          <span className="buyer-change">{tr(lang, 'changeBuyer')}<ChevronRight /></span>
        </button>

        <div className="invoice-entry">
          <label className="search-box">
            <Search />
            <input
              ref={inputRef} data-scanner="allow" autoFocus value={query} placeholder={tr(lang, 'search')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(suggestions.length - 1, i + 1)); }
                else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
                else if (event.key === 'Enter') { event.preventDefault(); scan(query); }
                else if (event.key === 'Escape') setQuery('');
              }}
            />
            {suggestions.length > 0 && (
              <div className="suggest-list" role="listbox">
                {suggestions.map((product, index) => (
                  <button type="button" role="option" aria-selected={index === active} key={product.id} className={index === active ? 'active' : ''} onMouseEnter={() => setActive(index)} onClick={() => add(product)}>
                    <ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} category={product.category} />
                    <span><b>{product.name[lang]}</b><small>{[product.barcode, `${tr(lang, 'stock')}: ${qtyLabel(product, stockOf(product), lang)}`].join(' · ')}</small></span>
                    <em>{money(packable(product) ? packPrice(product, priceFor(product, tier)) : priceFor(product, tier), lang)}<small>/ {packable(product) ? packLabel(product, lang) : unitLabel(product, lang)}</small></em>
                  </button>
                ))}
              </div>
            )}
          </label>
          <button type="button" className={padOpen ? 'entry-tool active' : 'entry-tool'} aria-pressed={padOpen} onClick={() => setPadOpen(!padOpen)}><Keyboard /><span>0-9</span></button>
          <button type="button" className="entry-tool" onClick={() => setPriceListOpen(true)}><ListChecks /><span>{tr(lang, 'priceList')}</span></button>
          <span className={cloudConnected ? 'scan-chip ok' : 'scan-chip'}><ScanBarcode />{tr(lang, 'scanReady')}</span>
        </div>
        {padOpen && <div className="invoice-pad"><BarcodePad lang={lang} onSubmit={scan} /></div>}

        <div className="invoice-table" role="table" aria-label={tr(lang, 'invoiceLines')}>
          <div className="invoice-row head" role="row">
            <span>№</span><span>{tr(lang, 'goodsName')}</span><span>{tr(lang, 'packsCol')}</span><span>{tr(lang, 'piecesCol')}</span><span>{tr(lang, 'unitPriceCol')}</span><span>{tr(lang, 'amount')}</span><span />
          </div>
          {!lines.length && (
            <div className="invoice-empty"><ScanBarcode /><b>{tr(lang, 'invoiceEmpty')}</b><small>{tr(lang, 'invoiceEmptyHint')}</small></div>
          )}
          {lines.map(({ product, qty, unitMinor }, index) => {
            const per = packUnitsOf(product);
            const { packs, pieces } = packable(product) ? splitQty(product, qty) : { packs: 0, pieces: qty };
            return (
              <div className="invoice-row" role="row" key={product.id}>
                <span className="row-no">{index + 1}</span>
                <span className="row-name">
                  <b>{product.name[lang]}</b>
                  <small>{[product.barcode, packable(product) ? `1 ${packLabel(product, lang)} = ${per} ${unitLabel(product, lang)}` : '', `${tr(lang, 'stock')}: ${qtyLabel(product, stockOf(product), lang)}`].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="qty-cell">
                  {packable(product) ? (
                    <>
                      <button type="button" aria-label={tr(lang, 'less')} onClick={() => setQty(product, qty - per)}><Minus /></button>
                      <input inputMode="numeric" value={packs} aria-label={packLabel(product, lang)} onChange={(event) => setQty(product, (Number(event.target.value) || 0) * per + pieces)} />
                      <button type="button" aria-label={tr(lang, 'more')} onClick={() => setQty(product, qty + per)}><Plus /></button>
                      <small>{packLabel(product, lang)}</small>
                    </>
                  ) : <small className="muted">—</small>}
                </span>
                <span className="qty-cell">
                  {sellsLoose(product) ? (
                    <>
                      <button type="button" aria-label={tr(lang, 'less')} onClick={() => setQty(product, qty - 1)}><Minus /></button>
                      <input inputMode="numeric" value={pieces} aria-label={unitLabel(product, lang)} onChange={(event) => setQty(product, packs * per + (Number(event.target.value) || 0))} />
                      <button type="button" aria-label={tr(lang, 'more')} onClick={() => setQty(product, qty + 1)}><Plus /></button>
                      <small>{unitLabel(product, lang)}</small>
                    </>
                  ) : <small className="muted">{tr(lang, 'packOnly')}</small>}
                </span>
                <span className="row-price">{money(packable(product) ? unitMinor * per : unitMinor, lang)}<small>/ {packable(product) ? packLabel(product, lang) : unitLabel(product, lang)}</small></span>
                <span className="row-sum">{money(unitMinor * qty, lang)}</span>
                <button type="button" className="row-remove" aria-label={tr(lang, 'removeLine')} onClick={() => setQty(product, 0)}><X /></button>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="invoice-side">
        <div className="invoice-head">
          <div><small>{tr(lang, 'invoiceTitle')}</small><strong>№ {String(state.sales.length + 1).padStart(4, '0')}</strong><span>{register?.name ?? '—'} · {new Date().toLocaleDateString('az-AZ')}</span></div>
          <button type="button" disabled={!cart.length} onClick={() => { if (confirm(tr(lang, 'clearInvoiceConfirm'))) reset(); }} aria-label={tr(lang, 'clearInvoice')}><Trash2 /></button>
        </div>
        {register?.status !== 'open' && (
          <div className="register-warning"><LockKeyhole /><div><b>{tr(lang, 'registerClosed')}</b><small>{register?.name}</small></div></div>
        )}
        <dl className="invoice-sums">
          <div><dt>{tr(lang, 'linesCount')}</dt><dd>{lines.length}{packsTotal ? ` · ${packsTotal} ${tr(lang, 'packsWord')}` : ''}</dd></div>
          <div><dt>{tr(lang, 'subtotal')}</dt><dd>{money(subtotal, lang)}</dd></div>
          <div className="discount-line"><dt>{tr(lang, 'discount')}</dt><dd><input value={discount} inputMode="decimal" onChange={(event) => setDiscount(event.target.value)} aria-label={tr(lang, 'discount')} /> ₼</dd></div>
          <div><dt>{tr(lang, 'vatIncluded')}</dt><dd>{money(Math.round((total * 18) / 118), lang)}</dd></div>
          <div className="grand"><dt>{tr(lang, 'total')}</dt><dd>{money(total, lang)}</dd></div>
        </dl>
        {exchangeCredit && (
          <div className="exchange-banner">
            <ArrowLeftRight />
            <span><b>{tr(lang, 'exchangeCredit')} · {money(exchangeCredit.amountMinor, lang)}</b><small>{exchangeCredit.receiptNo}</small></span>
            <button type="button" onClick={onExchangeDone} aria-label={tr(lang, 'cancel')}><X /></button>
          </div>
        )}
        {state.heldCarts.length > 0 && (
          <div className="held-strip">
            {state.heldCarts.slice(0, 3).map((held) => (
              <button key={held.id} type="button" onClick={() => resume(held)}><Pause /><span>{held.label}<small>{held.lines.length} {tr(lang, 'linesWord')}</small></span><ChevronRight /></button>
            ))}
          </div>
        )}
        <div className="invoice-actions">
          <button type="button" className="hold" disabled={!cart.length} onClick={hold}><Pause />{tr(lang, 'hold')}</button>
          <button type="button" className="pay" disabled={!cart.length || register?.status !== 'open'} onClick={() => setPayOpen(true)}>
            <WalletCards /><span>{tr(lang, 'checkoutInvoice')}<small>{tr(lang, 'checkoutHint')}</small></span><b>{money(total, lang)}</b>
          </button>
        </div>
      </aside>

      {pickerOpen && <CustomerPicker lang={lang} session={session} customers={customers} onClose={() => setPickerOpen(false)} onCreated={reloadCustomers} onPick={(picked) => { setCustomer(picked); setPickerOpen(false); inputRef.current?.focus(); }} />}
      {priceListOpen && <PriceList lang={lang} products={onSale} tier={tier} inCart={(id) => cart.find((line) => line.productId === id)?.qty ?? 0} onAdd={add} onClose={() => setPriceListOpen(false)} />}
      {payOpen && <InvoicePayment lang={lang} totalMinor={total} customer={customer} onClose={() => setPayOpen(false)} onComplete={complete} />}
      {invoice && <InvoiceModal lang={lang} settings={state.settings} data={invoice} onReceipt={window.marketSystem?.printer ? () => printReceipt(invoice.saleId) : undefined} onClose={() => { setInvoice(null); inputRef.current?.focus(); }} />}
    </div>
  );
}

/** The price list at the buyer's level, grouped by goods group: add a pack or a piece. */
function PriceList({ lang, products, tier, inCart, onAdd, onClose }: { lang: Lang; products: Product[]; tier: string; inCart: (productId: string) => number; onAdd: (product: Product, pieces?: number) => void; onClose: () => void }) {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const categories = useMemo(() => [...new Set(products.map((product) => product.category))], [products]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) map.set(product.category, (map.get(product.category) ?? 0) + 1);
    return map;
  }, [products]);
  const rows = products
    .filter((product) => (category === 'all' || product.category === category) && (!query.trim() || product.name[lang].toLocaleLowerCase('az').includes(query.trim().toLocaleLowerCase('az'))))
    .sort((a, b) => a.name[lang].localeCompare(b.name[lang], 'az'));
  return (
    <Modal title={tr(lang, 'priceList')} subtitle={`${products.length} · ${tr(lang, 'priceLevel')}`} onClose={onClose} wide>
      <div className="picker-toolbar">
        <label className="table-search"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr(lang, 'search')} /></label>
      </div>
      <CatalogAisleNav lang={lang} categories={categories} counts={counts} total={products.length} value={category} onChange={setCategory} layout="chips" />
      <div className="price-list">
        {rows.map((product) => {
          const unit = priceFor(product, tier);
          const left = stockOf(product) - inCart(product.id);
          return (
            <div className="price-row" key={product.id}>
              <ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} category={product.category} />
              <span><b>{product.name[lang]}</b><small>{[product.manufacturer, `${tr(lang, 'stock')}: ${qtyLabel(product, stockOf(product), lang)}`].filter(Boolean).join(' · ')}</small></span>
              <em>{money(packable(product) ? packPrice(product, unit) : unit, lang)}<small>/ {packable(product) ? packLabel(product, lang) : unitLabel(product, lang)}</small></em>
              <span className="price-add">
                {packable(product) && <button type="button" disabled={left < packUnitsOf(product)} onClick={() => onAdd(product, packUnitsOf(product))}>+ {packLabel(product, lang)}</button>}
                {sellsLoose(product) && <button type="button" disabled={left < 1} onClick={() => onAdd(product, 1)}>+ {unitLabel(product, lang)}</button>}
              </span>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** Cash, card and nisyə in any split; nisyə only for a customer with credit left. */
function InvoicePayment({ lang, totalMinor, customer, onClose, onComplete }: { lang: Lang; totalMinor: number; customer: Customer | null; onClose: () => void; onComplete: (payment: Payment) => void }) {
  const fmt = (minor: number) => (minor / 100).toFixed(2);
  const [cash, setCash] = useState(fmt(totalMinor));
  const [card, setCard] = useState('0.00');
  const [credit, setCredit] = useState('0.00');
  const [terminalRef, setTerminalRef] = useState('');
  const creditRoom = customer ? creditLeft(customer) : 0;
  const cashMinor = parseMoneyInput(cash || '0');
  const cardMinor = parseMoneyInput(card || '0');
  const creditMinor = parseMoneyInput(credit || '0');
  const paid = cashMinor + cardMinor + creditMinor;
  const change = Math.max(0, cashMinor - Math.max(0, totalMinor - cardMinor - creditMinor));
  const creditError = creditMinor > 0 && (!customer ? tr(lang, 'creditNeedsCustomer') : !customer.creditAllowed ? tr(lang, 'noCredit') : creditMinor > creditRoom ? `${tr(lang, 'creditLimitExceeded')} · ${money(creditRoom, lang)}` : '');
  const valid = paid >= totalMinor && !creditError && cardMinor + creditMinor <= totalMinor;
  const only = (which: 'cash' | 'card' | 'credit') => {
    setCash(fmt(which === 'cash' ? totalMinor : 0));
    setCard(fmt(which === 'card' ? totalMinor : 0));
    setCredit(fmt(which === 'credit' ? totalMinor : 0));
  };
  const submit = () => {
    const parts = [cashMinor > 0, cardMinor > 0, creditMinor > 0].filter(Boolean).length;
    const method: Payment['method'] = parts > 1 ? 'mixed' : cardMinor > 0 ? 'card' : creditMinor > 0 ? 'credit' : 'cash';
    const cashApplied = Math.max(0, totalMinor - cardMinor - creditMinor);
    onComplete({
      method, amountMinor: totalMinor,
      tenderedMinor: method === 'cash' ? cashMinor : totalMinor, changeMinor: method === 'cash' ? change : 0,
      cashMinor: method === 'cash' ? totalMinor : cashApplied, cardMinor, creditMinor, terminalRef: terminalRef || undefined,
    });
  };
  return (
    <Modal title={tr(lang, 'checkoutInvoice')} subtitle={`${customer?.name ?? tr(lang, 'walkIn')} · ${tr(lang, 'total')} ${money(totalMinor, lang)}`} onClose={onClose} wide>
      <div className="pay-quick">
        <button type="button" onClick={() => only('cash')}><CircleDollarSign /><b>{tr(lang, 'cash')}</b></button>
        <button type="button" onClick={() => only('card')}><CreditCard /><b>{tr(lang, 'card')}</b></button>
        <button type="button" disabled={!customer?.creditAllowed || creditRoom < totalMinor} onClick={() => only('credit')}><HandCoins /><b>{tr(lang, 'credit')}</b><small>{customer?.creditAllowed ? `${tr(lang, 'creditLeft')} ${money(creditRoom, lang)}` : tr(lang, 'creditNeedsCustomer')}</small></button>
      </div>
      <div className="pay-split">
        <label className="field"><span>{tr(lang, 'cash')} · AZN</span><input inputMode="decimal" value={cash} onChange={(event) => setCash(event.target.value)} /></label>
        <label className="field"><span>{tr(lang, 'card')} · AZN</span><input inputMode="decimal" value={card} onChange={(event) => setCard(event.target.value)} /></label>
        <label className="field"><span>{tr(lang, 'credit')} · AZN</span><input inputMode="decimal" value={credit} disabled={!customer?.creditAllowed} onChange={(event) => setCredit(event.target.value)} /></label>
        {cardMinor > 0 && <label className="field"><span>Terminal ref</span><input value={terminalRef} onChange={(event) => setTerminalRef(event.target.value)} placeholder="RRN / auth" /></label>}
      </div>
      <dl className="pay-summary">
        <div><dt>{tr(lang, 'total')}</dt><dd>{money(totalMinor, lang)}</dd></div>
        <div><dt>{tr(lang, 'paidNow')}</dt><dd>{money(paid, lang)}</dd></div>
        <div><dt>{tr(lang, 'change')}</dt><dd>{money(change, lang)}</dd></div>
        {customer && <div><dt>{tr(lang, 'debtAfter')}</dt><dd className={creditMinor > 0 ? 'debt' : ''}>{money(customer.balanceMinor + creditMinor, lang)}</dd></div>}
      </dl>
      {(creditError || (paid < totalMinor && `${tr(lang, 'paymentShort')} · ${money(totalMinor - paid, lang)}`)) && <p className="form-error">{creditError || `${tr(lang, 'paymentShort')} · ${money(totalMinor - paid, lang)}`}</p>}
      <button type="button" className="modal-primary payment-complete" disabled={!valid} onClick={submit}><Check />{tr(lang, 'completeInvoice')}<strong>{money(totalMinor, lang)}</strong></button>
    </Modal>
  );
}
