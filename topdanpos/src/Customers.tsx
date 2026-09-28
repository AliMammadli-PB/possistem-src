/**
 * Wholesale customers (shops, markets, dealers): their price level, VÖEN and
 * address for the invoice, the credit (nisyə) they may take and what they owe.
 * Debts are the core's customer_ledger: a credit sale adds, a payment subtracts.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookUser, HandCoins, Pencil, Plus, Printer, Search, UserRound, Users } from 'lucide-react';

import { marketCoreClient } from './core/client';
import { parseMoneyInput } from './domain';
import { Field, Kpi, Modal, SelectField } from './forms';
import { money } from './format';
import { tr } from './i18n';
import { PRICE_TIERS, creditLeft, tierLabel, type Customer, type PriceTier } from './wholesale';
import type { Lang, SessionUser, StoreSettings } from './types';

export async function loadCustomers(): Promise<Customer[]> {
  if (!marketCoreClient.available()) return [];
  return ((await marketCoreClient.customers.list()) as Customer[]) ?? [];
}

export function TierBadge({ tier, lang }: { tier: string | undefined; lang: Lang }) {
  return <b className={`tier-badge tier-${tier || 'retail'}`}>{tierLabel(tier, lang)}</b>;
}

export function CustomerModal({ lang, session, customer, onClose, onSaved }: { lang: Lang; session: SessionUser; customer: Customer | null; onClose: () => void; onSaved: (customer: Customer) => void }) {
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [voen, setVoen] = useState(customer?.voen ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [tier, setTier] = useState<PriceTier>(customer?.priceTier ?? 'wholesale');
  const [credit, setCredit] = useState(Boolean(customer?.creditAllowed ?? false));
  const [limit, setLimit] = useState(customer ? (customer.creditLimitMinor / 100).toFixed(2) : '0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) { setError(tr(lang, 'requiredFields')); return; }
    if (voen.trim() && !/^\d{10}$/.test(voen.trim())) { setError(tr(lang, 'voenInvalid')); return; }
    setBusy(true);
    try {
      const fields = { name: name.trim(), phone: phone.trim(), voen: voen.trim(), address: address.trim(), note: note.trim(), priceTier: tier, creditAllowed: credit, creditLimitMinor: credit ? parseMoneyInput(limit || '0') : 0, actorId: session.id };
      const saved = customer
        ? await marketCoreClient.customers.update({ id: customer.id, ...fields })
        : await marketCoreClient.customers.create(fields);
      onSaved(saved as Customer);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={customer ? tr(lang, 'editCustomer') : tr(lang, 'newCustomer')} subtitle={tr(lang, 'customerFormHint')} onClose={onClose} wide>
      <div className="form-grid">
        <Field label={`${tr(lang, 'customerName')} *`} value={name} onChange={setName} />
        <Field label={tr(lang, 'phone')} value={phone} onChange={setPhone} />
        <Field label={tr(lang, 'voen')} value={voen} onChange={setVoen} />
        <Field label={tr(lang, 'address')} value={address} onChange={setAddress} />
      </div>
      <h3 className="form-section">{tr(lang, 'priceLevel')}</h3>
      <div className="tier-picker" role="radiogroup" aria-label={tr(lang, 'priceLevel')}>
        {PRICE_TIERS.map((row) => (
          <button type="button" role="radio" aria-checked={tier === row.id} key={row.id} className={tier === row.id ? `active tier-${row.id}` : `tier-${row.id}`} onClick={() => setTier(row.id)}>
            <b>{row.labels[lang]}</b><small>{row.hint[lang]}</small>
          </button>
        ))}
      </div>
      <h3 className="form-section">{tr(lang, 'creditSection')}</h3>
      <div className="form-grid">
        <label className="field toggle-field"><span>{tr(lang, 'creditAllowed')}</span><input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} /></label>
        <label className="field"><span>{tr(lang, 'creditLimit')} · AZN</span><input type="number" value={limit} disabled={!credit} onChange={(event) => setLimit(event.target.value)} /></label>
        <Field label={tr(lang, 'comment')} value={note} onChange={setNote} wide />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" disabled={busy} onClick={() => void save()}><Users />{tr(lang, 'save')}</button>
      </div>
    </Modal>
  );
}

/** Who is buying: search by name, phone or VÖEN; "walk-in" sells at retail. */
export function CustomerPicker({ lang, session, customers, onPick, onClose, onCreated }: { lang: Lang; session: SessionUser; customers: Customer[]; onPick: (customer: Customer | null) => void; onClose: () => void; onCreated: () => void }) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('az');
    return customers.filter((row) => !needle || [row.name, row.phone, row.voen].some((value) => (value ?? '').toLocaleLowerCase('az').includes(needle)));
  }, [customers, query]);
  if (creating) return <CustomerModal lang={lang} session={session} customer={null} onClose={() => setCreating(false)} onSaved={(customer) => { onCreated(); onPick(customer); }} />;
  return (
    <Modal title={tr(lang, 'pickCustomer')} subtitle={`${customers.length} ${tr(lang, 'customersWord')}`} onClose={onClose} wide>
      <div className="picker-toolbar">
        <label className="table-search"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr(lang, 'customerSearch')} /></label>
        <button type="button" className="primary-action" onClick={() => setCreating(true)}><Plus />{tr(lang, 'newCustomer')}</button>
      </div>
      <div className="customer-pick-list">
        <button type="button" className="walk-in" onClick={() => onPick(null)}>
          <UserRound /><span><b>{tr(lang, 'walkIn')}</b><small>{tr(lang, 'walkInHint')}</small></span><TierBadge tier="retail" lang={lang} />
        </button>
        {rows.map((row) => (
          <button type="button" key={row.id} onClick={() => onPick(row)}>
            <BookUser />
            <span><b>{row.name}</b><small>{[row.voen && `VÖEN ${row.voen}`, row.phone, row.address].filter(Boolean).join(' · ')}</small></span>
            <TierBadge tier={row.priceTier} lang={lang} />
            <em className={row.balanceMinor > 0 ? 'debt' : ''}>{row.balanceMinor > 0 ? `${tr(lang, 'debt')} ${money(row.balanceMinor, lang)}` : tr(lang, 'noDebt')}</em>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function PayDebtModal({ lang, session, customer, onClose, onDone }: { lang: Lang; session: SessionUser; customer: Customer; onClose: () => void; onDone: (text: string) => void }) {
  const [amount, setAmount] = useState((customer.balanceMinor / 100).toFixed(2));
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const amountMinor = parseMoneyInput(amount || '0');
  const submit = async () => {
    if (amountMinor <= 0) { setError(tr(lang, 'requiredFields')); return; }
    setBusy(true);
    try {
      await marketCoreClient.customers.payDebt({ customerId: customer.id, amountMinor, note: tr(lang, method), actorId: session.id, role: session.role });
      onDone(`${customer.name} · ${money(amountMinor, lang)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={tr(lang, 'takePayment')} subtitle={`${customer.name} · ${tr(lang, 'debt')} ${money(customer.balanceMinor, lang)}`} onClose={onClose}>
      <div className="form-grid">
        <label className="field"><span>{tr(lang, 'amount')} · AZN</span><input autoFocus type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <SelectField label={tr(lang, 'paymentMethod')} value={method} onChange={setMethod} options={['cash', 'card', 'bankTransfer']} labels={{ cash: tr(lang, 'cash'), card: tr(lang, 'card'), bankTransfer: tr(lang, 'bankTransfer') }} />
      </div>
      <p className="form-hint">{tr(lang, 'debtAfter')}: <b>{money(customer.balanceMinor - amountMinor, lang)}</b></p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" disabled={busy} onClick={() => void submit()}><HandCoins />{tr(lang, 'takePayment')}</button>
      </div>
    </Modal>
  );
}

type LedgerRow = { id: string; kind: string; amount_minor: number; balance_after_minor: number; ref_type: string; ref_id: string; note: string; created_at: number };

/** Üzləşmə aktı: every credit sale and payment with the running balance, printable. */
function Statement({ lang, customer, settings, onClose }: { lang: Lang; customer: Customer; settings: StoreSettings; onClose: () => void }) {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { void marketCoreClient.customers.ledger(customer.id).then((data) => setRows(((data as LedgerRow[]) ?? []).slice().reverse())).catch(() => undefined); }, [customer.id]);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('printing-doc');
    const done = () => { document.body.classList.remove('printing-doc'); setPrinting(false); };
    window.addEventListener('afterprint', done, { once: true });
    const timer = window.setTimeout(() => window.print(), 50);
    return () => { window.clearTimeout(timer); window.removeEventListener('afterprint', done); document.body.classList.remove('printing-doc'); };
  }, [printing]);
  const doc = (
    <article className="a4-doc statement-doc">
      <header><div><h1>{tr(lang, 'statement')}</h1><p>{new Date().toLocaleDateString('az-AZ')}</p></div><div><b>{settings.legalName || settings.storeName}</b><small>{[settings.taxId && `VÖEN ${settings.taxId}`, settings.address].filter(Boolean).join(' · ')}</small></div></header>
      <p className="doc-party"><b>{customer.name}</b>{[customer.voen && `VÖEN ${customer.voen}`, customer.address, customer.phone].filter(Boolean).join(' · ')}</p>
      <table>
        <thead><tr><th>{tr(lang, 'date')}</th><th>{tr(lang, 'operation')}</th><th>{tr(lang, 'reference')}</th><th className="num">{tr(lang, 'debit')}</th><th className="num">{tr(lang, 'creditCol')}</th><th className="num">{tr(lang, 'balance')}</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString('az-AZ')}</td>
              <td>{row.kind === 'payment' ? `${tr(lang, 'paymentReceived')}${row.note ? ` · ${row.note}` : ''}` : tr(lang, 'creditSale')}</td>
              <td>{row.ref_type === 'sale' ? row.ref_id : ''}</td>
              <td className="num">{row.amount_minor > 0 ? money(row.amount_minor, lang) : ''}</td>
              <td className="num">{row.amount_minor < 0 ? money(-row.amount_minor, lang) : ''}</td>
              <td className="num">{money(row.balance_after_minor, lang)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5}>{tr(lang, 'balanceNow')}</td><td className="num">{money(customer.balanceMinor, lang)}</td></tr></tfoot>
      </table>
      <footer className="doc-signs"><span>{tr(lang, 'seller')} ____________</span><span>{tr(lang, 'buyer')} ____________</span></footer>
    </article>
  );
  return (
    <Modal title={tr(lang, 'statement')} subtitle={customer.name} onClose={onClose} wide>
      <div className="doc-preview">{doc}</div>
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" onClick={() => setPrinting(true)}><Printer />{tr(lang, 'print')}</button>
      </div>
      {printing && createPortal(<div className="doc-print-root">{doc}</div>, document.body)}
    </Modal>
  );
}

export function CustomersPage({ lang, session, settings, coreReady, notify }: { lang: Lang; session: SessionUser; settings: StoreSettings; coreReady: boolean; notify: (text: string) => void }) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);
  const [editing, setEditing] = useState<Customer | null | 'new'>(null);
  const [paying, setPaying] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<Customer | null>(null);
  const reload = () => { if (coreReady) void loadCustomers().then(setRows).catch((err: Error) => notify(err.message)); };
  useEffect(reload, [coreReady]);
  const canEdit = session.role === 'manager' || session.role === 'head_cashier';
  const visible = rows.filter((row) => (!onlyDebt || row.balanceMinor > 0) && (!query.trim() || [row.name, row.phone, row.voen].some((value) => (value ?? '').toLocaleLowerCase('az').includes(query.trim().toLocaleLowerCase('az')))));
  const totalDebt = rows.reduce((sum, row) => sum + Math.max(0, row.balanceMinor), 0);
  const debtors = rows.filter((row) => row.balanceMinor > 0).length;
  return (
    <div className="module-page customers-page">
      <section className="kpi-grid three">
        <Kpi icon={Users} label={tr(lang, 'customers')} value={String(rows.length)} note={`${rows.filter((row) => row.priceTier !== 'retail').length} ${tr(lang, 'priceWholesale').toLocaleLowerCase('az')} / ${tr(lang, 'priceDealer').toLocaleLowerCase('az')}`} tone="blue" />
        <Kpi icon={HandCoins} label={tr(lang, 'totalDebt')} value={money(totalDebt, lang)} note={tr(lang, 'credit')} tone="amber" />
        <Kpi icon={BookUser} label={tr(lang, 'debtors')} value={String(debtors)} note={tr(lang, 'customersWord')} tone="green" />
      </section>
      <section className="data-card">
        <div className="data-title">
          <div><h2>{tr(lang, 'customers')}</h2></div>
          <div className="data-actions">
            <label className="table-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr(lang, 'customerSearch')} /></label>
            <button type="button" className={onlyDebt ? 'active' : ''} aria-pressed={onlyDebt} onClick={() => setOnlyDebt(!onlyDebt)}><HandCoins />{tr(lang, 'debtors')}</button>
            <button type="button" className="primary-action" disabled={!canEdit || !coreReady} onClick={() => setEditing('new')}><Plus />{tr(lang, 'newCustomer')}</button>
          </div>
        </div>
        <div className="customer-table" role="table">
          <div className="customer-row head" role="row"><span>{tr(lang, 'customerName')}</span><span>{tr(lang, 'priceLevel')}</span><span>{tr(lang, 'creditLimit')}</span><span>{tr(lang, 'debt')}</span><span /></div>
          {!visible.length && <p className="shelf-empty">{tr(lang, 'noCustomers')}</p>}
          {visible.map((row) => (
            <div className="customer-row" role="row" key={row.id}>
              <span><b>{row.name}</b><small>{[row.voen && `VÖEN ${row.voen}`, row.phone, row.address].filter(Boolean).join(' · ') || '—'}</small></span>
              <span><TierBadge tier={row.priceTier} lang={lang} /></span>
              <span>{row.creditAllowed ? <>{money(row.creditLimitMinor, lang)}<small>{tr(lang, 'creditLeft')} {money(creditLeft(row), lang)}</small></> : <small>{tr(lang, 'noCredit')}</small>}</span>
              <span className={row.balanceMinor > 0 ? 'debt' : ''}>{money(row.balanceMinor, lang)}</span>
              <span className="row-actions">
                <button type="button" disabled={row.balanceMinor <= 0} onClick={() => setPaying(row)}><HandCoins />{tr(lang, 'takePayment')}</button>
                <button type="button" onClick={() => setStatement(row)}><Printer />{tr(lang, 'statement')}</button>
                <button type="button" disabled={!canEdit} onClick={() => setEditing(row)} aria-label={tr(lang, 'editCustomer')}><Pencil /></button>
              </span>
            </div>
          ))}
        </div>
      </section>
      {editing && <CustomerModal lang={lang} session={session} customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(saved) => { setEditing(null); notify(`${tr(lang, 'customerSaved')} · ${saved.name}`); reload(); }} />}
      {paying && <PayDebtModal lang={lang} session={session} customer={paying} onClose={() => setPaying(null)} onDone={(text) => { setPaying(null); notify(`${tr(lang, 'paymentReceived')} · ${text}`); reload(); }} />}
      {statement && <Statement lang={lang} customer={statement} settings={settings} onClose={() => setStatement(null)} />}
    </div>
  );
}
