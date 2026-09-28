/**
 * Prescriptions and expiry. A prescription medicine is only sold with the
 * prescription recorded (number, doctor, clinic, date, patient); it is kept on
 * the sale, so the "Resept jurnalı" is simply the sales that carry one. The
 * expiry report lists lots already expired (to write off) and those expiring
 * within 90 days (to sell first or return to the supplier).
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, FileText, Trash2 } from 'lucide-react';

import { marketCoreClient } from './core/client';
import { Field, Modal } from './forms';
import { longDate, money } from './format';
import { tr } from './i18n';
import { EXPIRY_WARN_DAYS, expiryState, qtyLabel, type Lot } from './pharmacy';
import type { Lang, PersistedState } from './types';

const RX_PREFIX = 'Resept';

export function PrescriptionModal({ lang, items, onClose, onDone }: { lang: Lang; items: string[]; onClose: () => void; onDone: (note: string) => void }) {
  const [number, setNumber] = useState('');
  const [doctor, setDoctor] = useState('');
  const [clinic, setClinic] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [patient, setPatient] = useState('');
  const [error, setError] = useState('');
  const save = () => {
    if (!number.trim() || !doctor.trim() || !patient.trim()) { setError(tr(lang, 'rxFieldsRequired')); return; }
    onDone(`${RX_PREFIX} №${number.trim()} · ${date} · Həkim: ${doctor.trim()}${clinic.trim() ? ` (${clinic.trim()})` : ''} · Xəstə: ${patient.trim()}`);
  };
  return (
    <Modal title={tr(lang, 'rxTitle')} subtitle={items.join(' · ')} onClose={onClose}>
      <div className="form-grid">
        <Field label={`${tr(lang, 'rxNumber')} *`} value={number} onChange={setNumber} />
        <Field label={tr(lang, 'rxDate')} value={date} onChange={setDate} type="date" />
        <Field label={`${tr(lang, 'rxDoctor')} *`} value={doctor} onChange={setDoctor} />
        <Field label={tr(lang, 'rxClinic')} value={clinic} onChange={setClinic} />
        <Field label={`${tr(lang, 'rxPatient')} *`} value={patient} onChange={setPatient} wide />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button>
        <button type="button" className="modal-primary" onClick={save}><Check />{tr(lang, 'rxContinue')}</button>
      </div>
    </Modal>
  );
}

export function PharmacyReports({ state, lang, coreReady, onWriteOff }: { state: PersistedState; lang: Lang; coreReady: boolean; onWriteOff: () => void }) {
  const [lots, setLots] = useState<Lot[]>([]);
  useEffect(() => {
    if (!coreReady || !marketCoreClient.available()) return;
    void marketCoreClient.lots.expiryReport({ withinDays: EXPIRY_WARN_DAYS }).then((rows) => setLots((rows as Lot[]) ?? [])).catch(() => setLots([]));
  }, [coreReady, state.products]);
  const products = useMemo(() => new Map(state.products.map((row) => [row.id, row])), [state.products]);
  const rxSales = state.sales.filter((sale) => sale.note?.startsWith(RX_PREFIX)).slice(0, 50);
  const expired = lots.filter((lot) => expiryState(lot.expires_at) === 'expired');
  const soon = lots.filter((lot) => expiryState(lot.expires_at) === 'soon');
  const lotRow = (lot: Lot) => {
    const product = products.get(lot.product_id);
    return (
      <tr key={lot.id}>
        <td><b>{product?.name[lang] ?? lot.product_id}</b>{product?.strength ? ` ${product.strength}` : ''}</td>
        <td>{lot.lot_number}</td>
        <td>{lot.expires_at ? new Date(lot.expires_at).toLocaleDateString('az-AZ') : '—'}</td>
        <td>{product ? qtyLabel(product, lot.qty_remaining, lang) : lot.qty_remaining}</td>
      </tr>
    );
  };
  return (
    <div className="module-page pharmacy-reports">
      <section className="data-card">
        <div className="data-title">
          <div><h2><CalendarClock /> {tr(lang, 'expiryReport')}</h2><span>{tr(lang, 'expiryReportHint').replace('{days}', String(EXPIRY_WARN_DAYS))}</span></div>
          {expired.length > 0 && <div className="data-actions"><button type="button" onClick={onWriteOff}><Trash2 />{tr(lang, 'writeOffExpired')}</button></div>}
        </div>
        <table className="expiry-table">
          <thead><tr><th>{tr(lang, 'medicine')}</th><th>{tr(lang, 'lotNumber')}</th><th>{tr(lang, 'expiryDate')}</th><th>{tr(lang, 'stock')}</th></tr></thead>
          <tbody>
            {expired.length > 0 && <tr className="group is-expired"><td colSpan={4}>{tr(lang, 'expiredLots')} · {expired.length}</td></tr>}
            {expired.map(lotRow)}
            {soon.length > 0 && <tr className="group is-soon"><td colSpan={4}>{tr(lang, 'soonLots')} · {soon.length}</td></tr>}
            {soon.map(lotRow)}
            {!lots.length && <tr><td colSpan={4}>{tr(lang, 'noExpiryIssues')}</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="data-card">
        <div className="data-title"><div><h2><FileText /> {tr(lang, 'rxJournal')}</h2><span>{tr(lang, 'rxJournalHint')}</span></div></div>
        <table className="expiry-table">
          <thead><tr><th>{tr(lang, 'date')}</th><th>{tr(lang, 'receipt')}</th><th>{tr(lang, 'rxTitle')}</th><th>{tr(lang, 'total')}</th></tr></thead>
          <tbody>
            {rxSales.map((sale) => <tr key={sale.id}><td>{longDate(new Date(sale.createdAt), lang)}</td><td>{sale.receiptNo}</td><td>{sale.note}</td><td>{money(sale.totalMinor, lang)}</td></tr>)}
            {!rxSales.length && <tr><td colSpan={4}>{tr(lang, 'rxJournalEmpty')}</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
