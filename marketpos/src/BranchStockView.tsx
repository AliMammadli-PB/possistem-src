import './branch-stock1543.css';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Field } from './forms';
import type { Lang } from './types';
import { printDocA4 } from './printA4';

export type StockSnapshot = {
  deviceId: string; branchId: string | null; branchName: string; hostname?: string; online: boolean; updatedAt: number; objectId?: string;
  warehouses: { id: string; name: string }[];
  lines: { goodId: string; name: string; barcode: string; unit: string; warehouseId: string; qtyMilli: number; salePriceMinor: number; costMinor?: number }[];
  registers?: { id: string; name: string; balanceMinor: number; todayCashMinor?: number; todayCardMinor?: number }[];
};
export type BranchStockMode = { kind: 'all' } | { kind: 'branch'; branchId: string; name: string };
type Part = { branch: string; deviceId: string; goodId: string; warehouseId: string; warehouse: string; qtyMilli: number; costMinor?: number; salePriceMinor?: number };
type Row = { key: string; name: string; barcode: string; unit: string; salePriceMinor: number; qtyMilli: number; costValueMinor: number; saleValueMinor: number; parts: Part[] };
type Edit = { kind: 'qty'; goodId: string; warehouseId: string; deltaMilli: number } | { kind: 'price'; goodId: string; salePriceMinor: number };
type Queued = { id: string; status: string; createdAt: string; completedAt?: string | null; error?: string | null; edits: Edit[]; note?: string };

/** The newest copy per branch (only a branch's warehouse PC sends one, but a PC may have moved). */
export function latestPerBranch(snapshots: StockSnapshot[]): StockSnapshot[] {
  const best = new Map<string, StockSnapshot>();
  for (const s of snapshots) {
    const key = s.branchId || `device:${s.deviceId}`;
    const have = best.get(key);
    if (!have || s.updatedAt > have.updatedAt) best.set(key, s);
  }
  return [...best.values()];
}

/**
 * Goods across branches: each branch has its own catalogue, so one good is the
 * same barcode and unit in every branch; unbarcoded cards remain branch-specific.
 */
export function mergeBranchStock(snapshots: StockSnapshot[]): Row[] {
  const rows = new Map<string, Row>();
  const values = new Map<string, {key:string; cost:bigint; sale:bigint}>();
  for (const s of snapshots) {
    const warehouse = new Map(s.warehouses.map((w) => [w.id, w.name]));
    for (const line of s.lines) {
      const unit = line.unit.trim().toLocaleLowerCase('az');
      const key = line.barcode ? `b:${line.barcode}:${unit}` : `g:${s.branchId || s.deviceId}:${line.goodId}:${unit}`;
      const row = rows.get(key) ?? { key, name: line.name, barcode: line.barcode, unit: line.unit, salePriceMinor: line.salePriceMinor, qtyMilli: 0, costValueMinor: 0, saleValueMinor: 0, parts: [] };
      row.qtyMilli += line.qtyMilli;
      // Stock value at each branch's own prices (1.5.47): Cəmi alış / Cəmi satış.
      // A product may occupy several warehouses. Combine its thousandths before
      // rounding, exactly as the local goods list does, then sum branch values.
      const valueKey = JSON.stringify([s.branchId || s.deviceId, line.goodId, key]);
      const value = values.get(valueKey) ?? {key, cost:0n, sale:0n};
      value.cost += BigInt(line.qtyMilli) * BigInt(line.costMinor ?? 0);
      value.sale += BigInt(line.qtyMilli) * BigInt(line.salePriceMinor);
      values.set(valueKey,value);
      row.parts.push({ branch: s.branchName || s.hostname || '—', deviceId: s.deviceId, goodId: line.goodId, warehouseId: line.warehouseId, warehouse: warehouse.get(line.warehouseId) ?? line.warehouseId, qtyMilli: line.qtyMilli, costMinor: line.costMinor ?? 0, salePriceMinor: line.salePriceMinor });
      rows.set(key, row);
    }
  }
  for (const value of values.values()) {const row=rows.get(value.key)!; row.costValueMinor += roundStockMilli(value.cost); row.saleValueMinor += roundStockMilli(value.sale);}
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'az'));
}

export function roundStockMilli(value:bigint):number {
  const result=(value<0n?-1n:1n)*((value<0n?-value:value)+500n)/1000n;
  if(result>BigInt(Number.MAX_SAFE_INTEGER)||result<BigInt(Number.MIN_SAFE_INTEGER))throw new Error('Qalıq dəyəri hesablama həddini aşır');
  return Number(result);
}

const money = (minor: number) => `${(minor / 100).toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`;
const qty = (milli: number) => (milli / 1000).toLocaleString('az-AZ', { maximumFractionDigits: 3 });
const partKey = (goodId: string, warehouseId: string) => `${goodId}|${warehouseId}`;

/**
 * Anbar across branches (1.5.41): every branch's goods summed, or one branch's
 * last copy - shown even while that branch is offline. In one branch the
 * quantities and prices can be corrected (1.5.42): the edits wait on the server
 * and the branch's warehouse PC applies them when it is online (a quantity is
 * sent as a change, so sales made meanwhile are kept).
 */
export function BranchStockView({ lang, token, mode }: { lang: Lang; token: string; mode: BranchStockMode }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  const [data, setData] = useState<{ own: StockSnapshot | null; branches: StockSnapshot[] } | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [stockedOnly, setStockedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [queued, setQueued] = useState<Queued[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => void window.marketSystem?.branches.stock?.(token)
      .then((next) => { if (live) { setData(next); setError(''); } })
      .catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    load();
    const timer = window.setInterval(load, 15000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token, refresh]);
  const all = useMemo(() => latestPerBranch([...(data?.own ? [data.own] : []), ...(data?.branches ?? [])]), [data]);
  // Bütün filiallar is every branch summed (1.5.47: no branch picker); one branch comes from the top-right switch.
  const snapshots = useMemo(() => mode.kind === 'branch' ? all.filter(s => s.branchId === mode.branchId) : all, [all, mode]);
  const target = mode.kind === 'branch' ? snapshots[0] ?? null : null;
  useEffect(() => { setEditing(null); }, [mode.kind, mode.kind === 'branch' ? mode.branchId : '']);
  useEffect(() => { setPage(0); setEditing(null); }, [search, stockedOnly]);
  useEffect(() => {
    if (!target?.deviceId || !window.marketSystem?.branches.edits) { setQueued([]); return; }
    let live = true;
    const load = () => void window.marketSystem!.branches.edits!(token, target.deviceId)
      .then((res) => { if (live) setQueued(Array.isArray(res?.commands) ? res.commands : []); })
      .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 20000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token, target?.deviceId, tick]);
  // Quantity changes not yet in the snapshot, per good and warehouse: waiting ones,
  // and applied ones the branch has not sent a newer copy since (else a re-edit
  // from the stale quantity would apply the change twice).
  const pending = useMemo(() => {
    const map = new Map<string, number>();
    const seenAt = target?.updatedAt ?? 0;
    const unseen = (q: Queued) => q.status === 'pending' || q.status === 'running' || (q.status === 'done' && Date.parse(q.completedAt || '') > seenAt);
    for (const q of queued) if (unseen(q)) for (const e of q.edits) if (e.kind === 'qty') map.set(partKey(e.goodId, e.warehouseId), (map.get(partKey(e.goodId, e.warehouseId)) ?? 0) + e.deltaMilli);
    return map;
  }, [queued, target?.updatedAt]);
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('az');
    return mergeBranchStock(snapshots).filter((r) => (!stockedOnly || r.qtyMilli !== 0) && (!needle || r.name.toLocaleLowerCase('az').includes(needle) || r.barcode.includes(needle)));
  }, [snapshots, search, stockedOnly]);
  const pages = Math.max(1, Math.ceil(rows.length / 60));
  const currentPage = Math.min(page, pages - 1);
  const when = (ms: number | string) => (ms ? new Date(ms).toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ') : '—');
  const statusLabel = (s: string) => s === 'done' ? t('tətbiq olundu', 'применено', 'applied') : s === 'failed' ? t('alınmadı', 'не удалось', 'failed') : s === 'cancelled' ? t('ləğv edildi', 'отменено', 'cancelled') : t('gözləyir', 'ожидает', 'waiting');

  return <div className="module-page branch-stock">
    <div className="branch-stock-head">

      <button type="button" onClick={() => setRefresh(n => n + 1)}>{t('Yenilə', 'Обновить', 'Refresh')}</button>
      <div className="branch-stock-sources">{snapshots.map((s) => <span key={s.deviceId} className={s.online ? 'online' : ''}>
        <b>{s.branchName || s.hostname || '—'}</b> · {t('son yenilənmə', 'обновлено', 'updated')} {when(s.updatedAt)}
      </span>)}</div>
      <input className="ops-wide-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Mal və ya barkod…', 'Товар или штрихкод…', 'Good or barcode…')} />
      <label className="branch-stock-toggle"><input type="checkbox" checked={stockedOnly} onChange={(e) => setStockedOnly(e.target.checked)} />{t('Yalnız qalığı olanlar', 'Только с остатком', 'Only in stock')}</label>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && !snapshots.length && <p className="label-hint">{t('Bu filialın anbar məlumatı hələ gəlməyib: filialın anbar kompüteri bir dəfə onlayn olmalıdır.', 'Данные склада филиала ещё не поступили: складской компьютер филиала должен хотя бы раз выйти в сеть.', 'No warehouse data from this branch yet: its warehouse PC must be online once.')}</p>}
    {target && queued.length > 0 && <section className="branch-edits">
      <h3>{t('Gözləyən düzəlişlər', 'Ожидающие изменения', 'Queued edits')}{!target.online && <small> · {t('filial onlayn olanda tətbiq olunacaq', 'применятся, когда филиал будет онлайн', 'applied when the branch is online')}</small>}</h3>
      {queued.slice(0, 20).map((q) => <div key={q.id} className={`branch-edit ${q.status}`}>
        <span>{when(q.createdAt)} · {q.edits.length} {t('düzəliş', 'изм.', 'edits')}{q.note ? ` · ${q.note}` : ''}</span>
        <b>{statusLabel(q.status)}{q.error ? `: ${q.error}` : ''}</b>
        {q.status === 'pending' && <button type="button" onClick={() => void window.marketSystem?.branches.cancelEdit?.(token, q.id).then(() => setTick((n) => n + 1)).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>{t('Ləğv et', 'Отменить', 'Cancel')}</button>}
      </div>)}
    </section>}
    {!data && !error && <p role="status">{t('Anbar məlumatları yüklənir…', 'Загрузка складов…', 'Loading warehouse data…')}</p>}
    <div className="branch-stock-scroll"><table className="branch-stock-table">
      <thead><tr><th>{t('Mal', 'Товар', 'Good')}</th><th>{t('Barkod', 'Штрихкод', 'Barcode')}</th><th>{t('Cəmi qalıq', 'Всего', 'Total')}</th><th>{t('Qalıq alış dəyəri', 'Закупочная стоимость остатка', 'Stock cost value')}</th><th>{t('Qalıq satış dəyəri', 'Продажная стоимость остатка', 'Stock sale value')}</th><th>{mode.kind === 'all' ? t('Filiallar', 'Филиалы', 'Branches') : t('Anbarlar', 'Склады', 'Warehouses')}</th>{target && <th />}</tr></thead>
      <tbody>{rows.slice(currentPage * 60, (currentPage + 1) * 60).map((r) => <tr key={r.key}>
        <td>{r.name}</td><td>{r.barcode || '—'}</td><td className="num">{qty(r.qtyMilli)} {r.unit}</td><td className="num">{money(r.costValueMinor)}</td><td className="num">{money(r.saleValueMinor)}</td>
        <td>{[...r.parts, ...(target ? target.warehouses.filter((w) => !r.parts.some((p) => p.warehouseId === w.id) && pending.has(partKey(r.parts[0]?.goodId ?? '', w.id))).map((w) => ({ branch: '', deviceId: target.deviceId, goodId: r.parts[0]?.goodId ?? '', warehouseId: w.id, warehouse: w.name, qtyMilli: 0 })) : [])].map((p, i) => {
          const wait = pending.get(partKey(p.goodId, p.warehouseId));
          return <span key={i} className="branch-stock-part">{mode.kind === 'all' ? `${p.branch} · ` : ''}{p.warehouse}: <b>{qty(p.qtyMilli)}</b>{wait ? <em> → {qty(p.qtyMilli + wait)}</em> : null}</span>;
        })}</td>
        {target && <td><button type="button" className="branch-stock-edit" onClick={() => setEditing(r)}>{t('Düzəliş', 'Изменить', 'Edit')}</button></td>}
      </tr>)}</tbody>
    </table></div>
    {data && !rows.length && <p className="label-hint">{t('Uyğun məhsul yoxdur', 'Товары не найдены', 'No matching products')}</p>}
    <div className="branch-stock-totals"><span>{t('Qalıq alış dəyəri', 'Закупочная стоимость остатка', 'Stock cost value')}: <b>{money(rows.reduce((n, r) => n + r.costValueMinor, 0))}</b></span><span>{t('Qalıq satış dəyəri', 'Продажная стоимость остатка', 'Stock sale value')}: <b>{money(rows.reduce((n, r) => n + r.saleValueMinor, 0))}</b></span>
      <button type="button" onClick={() => printDocA4({ title: mode.kind === 'all' ? t('Filialların qalıqları', 'Остатки филиалов', 'Branch stock') : `${mode.name} · ${t('anbar', 'склад', 'stock')}`, meta: snapshots.map((s) => [s.branchName || s.hostname || '—', when(s.updatedAt)] as [string, string]), head: [t('Mal', 'Товар', 'Good'), t('Barkod', 'Штрихкод', 'Barcode'), t('Cəmi qalıq', 'Всего', 'Total'), t('Qalıq alış dəyəri', 'Закупочная стоимость остатка', 'Stock cost value'), t('Qalıq satış dəyəri', 'Продажная стоимость остатка', 'Stock sale value'), t('Filiallar', 'Филиалы', 'Branches')], rows: rows.map((r) => [r.name, r.barcode || '', `${qty(r.qtyMilli)} ${r.unit}`, money(r.costValueMinor), money(r.saleValueMinor), r.parts.filter((p) => p.qtyMilli).map((p) => `${p.branch} · ${p.warehouse}: ${qty(p.qtyMilli)}`).join('; ')]), totals: [[t('Qalıq alış dəyəri', 'Закупочная стоимость остатка', 'Stock cost value'), money(rows.reduce((n, r) => n + r.costValueMinor, 0))], [t('Qalıq satış dəyəri', 'Продажная стоимость остатка', 'Stock sale value'), money(rows.reduce((n, r) => n + r.saleValueMinor, 0))]] })}>{t('Çap (A4)', 'Печать (A4)', 'Print (A4)')}</button></div>
    <div className="branch-stock-pagination"><span>{rows.length} {t('məhsul', 'товаров', 'products')} · {currentPage + 1} / {pages}</span><button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t('Əvvəlki', 'Назад', 'Previous')}</button><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>{t('Növbəti', 'Далее', 'Next')}</button></div>
    {editing && target && <EditGood lang={lang} row={editing} target={target} pending={pending} token={token} onClose={() => setEditing(null)} onQueued={() => { setEditing(null); setTick((n) => n + 1); }} />}
  </div>;
}

function EditGood({ lang, row, target, pending, token, onClose, onQueued }: { lang: Lang; row: Row; target: StockSnapshot; pending: Map<string, number>; token: string; onClose: () => void; onQueued: () => void }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  // Every warehouse of the branch can take this good, not only those holding some now.
  const goodId = row.parts[0]?.goodId ?? '';
  const [requestId] = useState(() => crypto.randomUUID());
  const parts = target.warehouses.map((w) => row.parts.find((p) => p.warehouseId === w.id) ?? { branch: '', deviceId: target.deviceId, goodId, warehouseId: w.id, warehouse: w.name, qtyMilli: 0 });
  const intended = (p: Part) => p.qtyMilli + (pending.get(partKey(p.goodId, p.warehouseId)) ?? 0);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(parts.map((p) => [p.warehouseId, String(intended(p) / 1000)])));
  const [price, setPrice] = useState((row.salePriceMinor / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    const edits: Edit[] = [];
    for (const p of parts) {
      const next = Number(String(values[p.warehouseId] ?? '').replace(',', '.'));
      if (!Number.isFinite(next)) { setError(t('Qalıq rəqəm olmalıdır', 'Остаток должен быть числом', 'Quantity must be a number')); return; }
      const delta = Math.round(next * 1000) - intended(p);
      if (delta) edits.push({ kind: 'qty', goodId: p.goodId, warehouseId: p.warehouseId, deltaMilli: delta });
    }
    const priceMinor = Math.round(Number(price.replace(',', '.')) * 100);
    if (!Number.isFinite(priceMinor) || priceMinor < 0) { setError(t('Qiymət düzgün deyil', 'Неверная цена', 'Invalid price')); return; }
    if (priceMinor !== row.salePriceMinor && target.objectId) edits.push({ kind: 'price', goodId, salePriceMinor: priceMinor });
    if (!edits.length) { onClose(); return; }
    setBusy(true); setError('');
    // One request id per dialog: a retry after a timeout is the same request, never a second change.
    try { await window.marketSystem!.branches.queueEdits!(token, target.deviceId, requestId, edits, note.trim() || undefined); onQueued(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <Modal title={row.name} subtitle={`${target.branchName || target.hostname || ''} · ${target.online ? t('onlayn: dərhal tətbiq olunur', 'онлайн: применится сразу', 'online: applied now') : t('oflayn: filial onlayn olanda tətbiq olunacaq', 'офлайн: применится, когда филиал будет онлайн', 'offline: applied when the branch is online')}`} onClose={onClose}>
    <div className="branch-edit-form">
      {parts.map((p) => <Field key={p.warehouseId} label={`${p.warehouse} · ${t('yeni qalıq', 'новый остаток', 'new quantity')} (${t('indi', 'сейчас', 'now')} ${qty(p.qtyMilli)} ${row.unit})`} value={values[p.warehouseId] ?? ''} onChange={(v) => setValues((prev) => ({ ...prev, [p.warehouseId]: v }))} />)}
      {target.objectId && <Field label={t('Satış qiyməti (₼)', 'Цена продажи (₼)', 'Sale price (₼)')} value={price} onChange={setPrice} />}
      <Field label={t('Qeyd (səbəb)', 'Примечание (причина)', 'Note (reason)')} value={note} onChange={setNote} wide />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="workflow-actions"><button type="button" className="primary-action" disabled={busy} onClick={() => void save()}>{busy ? '…' : t('Göndər', 'Отправить', 'Send')}</button><button type="button" onClick={onClose} disabled={busy}>{t('İmtina', 'Отмена', 'Cancel')}</button></div>
    </div>
  </Modal>;
}

/**
 * Kassalar of the other branches (1.5.47), from their last warehouse copy:
 * each branch's kassa with its balance and today's cash/card, offline too.
 */
export function BranchRegisters({ lang, token, includeOwn = false }: { lang: Lang; token: string; includeOwn?: boolean }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  const [data, setData] = useState<{ own: StockSnapshot | null; branches: StockSnapshot[] } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void window.marketSystem?.branches.stock?.(token).then((next) => { if (live) setData(next); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token]);
  const branches = latestPerBranch([...(includeOwn && data?.own ? [data.own] : []), ...(data?.branches ?? [])])
    .filter((s) => includeOwn || s.deviceId !== data?.own?.deviceId).filter((s) => s.registers?.length);
  const when = (ms: number) => (ms ? new Date(ms).toLocaleString(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'az-AZ') : '—');
  if (!data) return null;
  return <details className="branch-registers" open>
    <summary>{includeOwn ? t('Bütün filialların kassaları', 'Кассы всех филиалов', 'All branches’ registers') : t('Digər filialların kassaları', 'Кассы других филиалов', 'Other branches’ registers')} ({branches.reduce((n, s) => n + (s.registers?.length ?? 0), 0)})</summary>
    {!branches.length && <p className="label-hint">{t('Digər filialların kassa məlumatı hələ gəlməyib: filialın anbar kompüteri 1.5.47-yə yenilənib onlayn olmalıdır.', 'Данные касс других филиалов ещё не поступили.', 'No register data from other branches yet.')}</p>}
    {branches.map((s) => <section key={s.deviceId}>
      <h4>{s.branchName || s.hostname || '—'} <small className={s.online ? 'online' : ''}>{s.online ? t('onlayn', 'онлайн', 'online') : t('oflayn', 'офлайн', 'offline')} · {t('son yenilənmə', 'обновлено', 'updated')} {when(s.updatedAt)}</small></h4>
      <table className="branch-stock-table"><thead><tr><th>{t('Kassa', 'Касса', 'Register')}</th><th>{t('Balans', 'Баланс', 'Balance')}</th><th>{t('Bu gün nağd', 'Сегодня наличные', 'Cash today')}</th><th>{t('Bu gün kart', 'Сегодня карта', 'Card today')}</th></tr></thead>
        <tbody>{(s.registers ?? []).map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{money(r.balanceMinor)}</td><td className="num">{money(r.todayCashMinor ?? 0)}</td><td className="num">{money(r.todayCardMinor ?? 0)}</td></tr>)}</tbody></table>
    </section>)}
  </details>;
}
