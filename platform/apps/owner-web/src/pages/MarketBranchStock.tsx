import { useCallback, useMemo, useState } from 'react';
import {
  cancelMarketBranchEdit,
  ownerMarketBranchEdits,
  ownerMarketBranchStock,
  queueMarketBranchEdits,
  type MarketBranchEdit,
  type MarketBranchEditCommand,
  type MarketBranchStock as Branch,
} from '../api';
import { usePolling } from '../hooks/usePolling';
import { Field, SelectField } from '../ui/forms';
import { Modal, useToast } from '../ui/overlays';
import { Button } from '../ui/primitives';

type Line = Branch['lines'][number];

// ponytail: renders the first 500 rows; search narrows the rest. Virtualise if owners need to scroll 60k goods.
const MAX_ROWS = 500;

const qty = (milli: number) => (milli / 1000).toLocaleString('az', { maximumFractionDigits: 3 });
const when = (ms: number) => (ms ? new Date(ms).toLocaleString('az') : '—');
const money = (minor: number) => `${(minor / 100).toLocaleString('az', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`;
const parseNum = (text: string) => (text.trim() === '' ? NaN : Number(text.trim().replace(/\s/g, '').replace(',', '.')));
const OFFLINE_NOTE = 'Filial onlayn olanda tətbiq olunacaq';
const STATUS: Record<MarketBranchEditCommand['status'], [string, string]> = {
  pending: ['gözləyir', 'is-blue'], running: ['icra olunur', 'is-blue'], done: ['tətbiq olundu', 'is-green'],
  failed: ['alınmadı', ''], cancelled: ['ləğv edildi', ''],
};

function branchLabels(branches: Branch[]): Map<string, string> {
  const names = branches.map((b) => b.branchName || b.hostname || b.deviceId.slice(0, 8));
  return new Map(branches.map((b, i) => [
    b.deviceId,
    names.indexOf(names[i]) !== names.lastIndexOf(names[i]) ? `${names[i]} (${b.hostname || b.deviceId.slice(0, 8)})` : names[i],
  ]));
}

/** Each branch's warehouse stock as its warehouse PC last sent it, online or not. */
export function MarketBranchStock() {
  const state = usePolling(ownerMarketBranchStock, 60_000);
  const [branchId, setBranchId] = useState('all');
  const [query, setQuery] = useState('');
  const [inStock, setInStock] = useState(false);
  const branches = state.data?.branches ?? [];
  const labels = useMemo(() => branchLabels(branches), [branches]);
  const needle = query.trim().toLocaleLowerCase('az');

  const merged = useMemo(() => {
    if (branchId !== 'all') return [];
    const goods = new Map<string, { name: string; barcode: string; unit: string; total: number; parts: string[] }>();
    for (const branch of branches) {
      const warehouses = new Map(branch.warehouses.map((w) => [w.id, w.name]));
      for (const line of branch.lines) {
        if (inStock && line.qtyMilli <= 0) continue;
        const key = line.barcode.trim() || `n:${line.name.trim().toLocaleLowerCase('az')}`;
        const row = goods.get(key) ?? { name: line.name, barcode: line.barcode.trim(), unit: line.unit, total: 0, parts: [] };
        row.total += line.qtyMilli;
        row.parts.push(`${labels.get(branch.deviceId)} · ${warehouses.get(line.warehouseId) || line.warehouseId}: ${qty(line.qtyMilli)} ${line.unit}`);
        goods.set(key, row);
      }
    }
    return [...goods.values()]
      .filter((row) => !needle || row.name.toLocaleLowerCase('az').includes(needle) || row.barcode.includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, 'az'));
  }, [branches, branchId, inStock, labels, needle]);

  const branch = branches.find((b) => b.deviceId === branchId) ?? null;
  const branchLines = (branch?.lines ?? []).filter((line) =>
    (!inStock || line.qtyMilli > 0) &&
    (!needle || line.name.toLocaleLowerCase('az').includes(needle) || line.barcode.includes(needle)));

  return (
    <article className="shop-panel shop-pad" id="shop-branch-stock" style={{ marginTop: 18 }}>
      <div className="shop-inventory-top">
        <div>
          <div className="shop-label">Filialların anbarı</div>
          <div className="shop-inventory-title">Filiallar üzrə qalıq</div>
        </div>
        <div className="shop-inventory-actions">
          <button type="button" className="shop-btn" disabled={state.refreshing} onClick={() => void state.reload()}>Yenilə</button>
        </div>
      </div>

      <div className="shop-inventory-tools">
        <SelectField label="Filial" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          <option value="all">Bütün filiallar</option>
          {branches.map((b) => (
            <option key={b.deviceId} value={b.deviceId}>
              {labels.get(b.deviceId)}{b.online ? '' : ` — oflayn · son yenilənmə ${when(b.updatedAt)}`}
            </option>
          ))}
        </SelectField>
        <Field label="Axtar" value={query} placeholder="Mal adı və ya barkod" prefixIcon="search" onChange={(event) => setQuery(event.target.value)} />
        <div className="shop-filters" role="group" aria-label="Qalıq filtri">
          <button type="button" aria-pressed={inStock} data-active={inStock ? '1' : '0'} onClick={() => setInStock(!inStock)}>
            Yalnız qalığı olanlar
          </button>
        </div>
      </div>

      {state.error && !state.data ? <p className="shop-empty">Filial qalıqları yüklənmədi.</p> : null}
      {state.data && !branches.length ? (
        <p className="shop-empty">Hələ heç bir filialın anbar kompüteri qalıq göndərməyib.</p>
      ) : null}

      {branchId === 'all' && branches.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Mal</th><th scope="col">Barkod</th><th scope="col">Cəmi qalıq</th><th scope="col">Filiallar</th></tr>
            </thead>
            <tbody>
              {merged.slice(0, MAX_ROWS).map((row) => (
                <tr key={`${row.barcode}|${row.name}`}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.barcode || '—'}</td>
                  <td>{qty(row.total)} {row.unit}</td>
                  <td>{row.parts.map((part) => <small key={part}>{part}</small>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {merged.length > MAX_ROWS ? <p className="shop-empty">{merged.length} maldan {MAX_ROWS} göstərilir — axtarışla daraldın.</p> : null}
          {!merged.length ? <p className="shop-empty">Uyğun mal yoxdur.</p> : null}
        </div>
      ) : null}

      {branch ? <BranchView key={branch.deviceId} branch={branch} lines={branchLines} /> : null}
    </article>
  );
}

/** One branch: its warehouses, owner edits queued for it, and the edit dialog. */
function BranchView({ branch, lines }: { branch: Branch; lines: Line[] }) {
  const { show } = useToast();
  const loadEdits = useCallback(() => ownerMarketBranchEdits(branch.deviceId), [branch.deviceId]);
  const edits = usePolling(loadEdits, 30_000);
  const commands = edits.data?.commands ?? [];
  const [editing, setEditing] = useState<{ line: Line; requestId: string; qty: string; price: string; note: string; error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // What is queued but not applied yet, per good+warehouse (qty) and per good (latest price).
  const pending = useMemo(() => {
    const qty = new Map<string, number>();
    const price = new Map<string, number>();
    for (const command of [...commands].reverse()) {
      if (command.status !== 'pending' && command.status !== 'running') continue;
      for (const edit of command.edits) {
        if (edit.kind === 'qty') qty.set(`${edit.goodId}|${edit.warehouseId}`, (qty.get(`${edit.goodId}|${edit.warehouseId}`) ?? 0) + edit.deltaMilli);
        else price.set(edit.goodId, edit.salePriceMinor);
      }
    }
    return { qty, price };
  }, [commands]);
  const names = useMemo(() => new Map(branch.lines.map((line) => [line.goodId, line.name])), [branch.lines]);
  const warehouseNames = useMemo(() => new Map(branch.warehouses.map((w) => [w.id, w.name])), [branch.warehouses]);
  const pendingQty = (line: Line) => pending.qty.get(`${line.goodId}|${line.warehouseId}`) ?? 0;
  const shownPrice = (line: Line) => pending.price.get(line.goodId) ?? line.salePriceMinor;

  const open = (line: Line) => setEditing({
    line, requestId: crypto.randomUUID(), error: '', note: '',
    qty: String((line.qtyMilli + pendingQty(line)) / 1000), price: (shownPrice(line) / 100).toFixed(2),
  });

  const save = async () => {
    if (!editing) return;
    const { line } = editing;
    const newQty = parseNum(editing.qty);
    const newPrice = parseNum(editing.price);
    if (!Number.isFinite(newQty)) return setEditing({ ...editing, error: 'Yeni qalığı rəqəmlə yazın' });
    if (!Number.isFinite(newPrice) || newPrice < 0) return setEditing({ ...editing, error: 'Satış qiymətini düzgün yazın' });
    const out: MarketBranchEdit[] = [];
    const deltaMilli = Math.round(newQty * 1000) - line.qtyMilli - pendingQty(line);
    if (deltaMilli !== 0) out.push({ kind: 'qty', goodId: line.goodId, warehouseId: line.warehouseId, deltaMilli });
    const priceMinor = Math.round(newPrice * 100);
    if (branch.objectId && priceMinor !== shownPrice(line)) out.push({ kind: 'price', goodId: line.goodId, salePriceMinor: priceMinor });
    if (!out.length) return setEditing({ ...editing, error: 'Dəyişiklik yoxdur' });
    setBusy(true);
    try {
      const result = await queueMarketBranchEdits({ deviceId: branch.deviceId, requestId: editing.requestId, edits: out, note: editing.note.trim() || undefined });
      setEditing(null);
      show({ tone: 'success', title: 'Düzəliş növbəyə qoyuldu', message: result.online ? 'Filial bir neçə saniyəyə tətbiq edəcək' : OFFLINE_NOTE });
      await edits.reload();
    } catch (error) {
      setEditing({ ...editing, error: error instanceof Error ? error.message : 'Düzəliş göndərilmədi' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await cancelMarketBranchEdit(id);
      show({ tone: 'info', title: 'Düzəliş ləğv edildi' });
    } catch (error) {
      show({ tone: 'danger', title: 'Ləğv olunmadı', message: error instanceof Error ? error.message : undefined });
    }
    await edits.reload();
  };

  const describe = (edit: MarketBranchEdit) => {
    const name = names.get(edit.goodId) ?? edit.goodId;
    return edit.kind === 'qty'
      ? `${name} · ${warehouseNames.get(edit.warehouseId) || edit.warehouseId}: qalıq ${edit.deltaMilli > 0 ? '+' : ''}${qty(edit.deltaMilli)}`
      : `${name}: satış qiyməti ${money(edit.salePriceMinor)}`;
  };

  return (
    <>
      <p className="shop-empty">
        <span className={`shop-pill ${branch.online ? 'is-green' : ''}`}>{branch.online ? 'Onlayn' : 'Oflayn'}</span>{' '}
        Son yenilənmə: {when(branch.updatedAt)}
      </p>

      {commands.length ? (
        <div className="table-wrap">
          <div className="shop-label">Gözləyən düzəlişlər{branch.online ? '' : ` · ${OFFLINE_NOTE}`}</div>
          <table className="data-table">
            <thead>
              <tr><th scope="col">Tarix</th><th scope="col">Düzəliş</th><th scope="col">Qeyd</th><th scope="col">Status</th><th scope="col" /></tr>
            </thead>
            <tbody>
              {commands.map((command) => {
                const [label, tone] = STATUS[command.status] ?? [command.status, ''];
                return (
                  <tr key={command.id}>
                    <td>{new Date(command.createdAt).toLocaleString('az')}</td>
                    <td>{command.edits.map((edit, i) => {
                      const failed = command.results?.[i]?.success === false;
                      return <small key={i}>{describe(edit)}{failed ? ` — alınmadı: ${command.results?.[i]?.error ?? ''}` : ''}</small>;
                    })}</td>
                    <td>{command.note || '—'}</td>
                    <td>
                      <span className={`shop-pill ${tone}`}>{label}</span>
                      {command.error && command.status !== 'cancelled' ? <small>{command.error}</small> : null}
                    </td>
                    <td>
                      {command.status === 'pending' ? (
                        <button type="button" className="shop-btn" onClick={() => void cancel(command.id)}>Ləğv et</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {[...branch.warehouses, ...[...new Set(branch.lines.map((line) => line.warehouseId))]
        .filter((id) => !branch.warehouses.some((w) => w.id === id)).map((id) => ({ id, name: id }))].map((warehouse) => {
        const rows = lines.filter((line) => line.warehouseId === warehouse.id);
        return (
          <div key={warehouse.id} className="table-wrap">
            <div className="shop-label">{warehouse.name || warehouse.id} · {rows.length} mal</div>
            <table className="data-table">
              <thead>
                <tr><th scope="col">Mal</th><th scope="col">Barkod</th><th scope="col">Qalıq</th><th scope="col">Satış qiyməti</th><th scope="col" /></tr>
              </thead>
              <tbody>
                {rows.slice(0, MAX_ROWS).map((line) => {
                  const delta = pendingQty(line);
                  const price = shownPrice(line);
                  return (
                    <tr key={line.goodId}>
                      <td><strong>{line.name}</strong></td>
                      <td>{line.barcode || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{qty(line.qtyMilli)}{delta ? <span style={{ fontWeight: 700 }}> → {qty(line.qtyMilli + delta)}</span> : null} {line.unit}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{money(line.salePriceMinor)}{price !== line.salePriceMinor ? <span style={{ fontWeight: 700 }}> → {money(price)}</span> : null}</td>
                      <td><button type="button" className="shop-btn" onClick={() => open(line)}>Düzəliş</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > MAX_ROWS ? <p className="shop-empty">{rows.length} maldan {MAX_ROWS} göstərilir — axtarışla daraldın.</p> : null}
          </div>
        );
      })}

      <Modal
        open={Boolean(editing)}
        title={editing ? `Düzəliş: ${editing.line.name}` : 'Düzəliş'}
        description={editing
          ? `${warehouseNames.get(editing.line.warehouseId) || editing.line.warehouseId} · indiki qalıq ${qty(editing.line.qtyMilli)} ${editing.line.unit}${branch.online ? '' : ` · ${OFFLINE_NOTE}`}`
          : undefined}
        onClose={() => !busy && setEditing(null)}
      >
        {editing ? (
          <form
            className="market-product-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Field label={`Yeni qalıq (${editing.line.unit})`} inputMode="decimal" value={editing.qty}
              onChange={(event) => setEditing({ ...editing, qty: event.target.value, error: '' })} />
            <Field label="Satış qiyməti (₼)" inputMode="decimal" value={editing.price} disabled={!branch.objectId}
              hint={branch.objectId ? 'Dəyişməsəniz göndərilmir' : 'Qiymət üçün filialın kassasını yeniləyin'}
              onChange={(event) => setEditing({ ...editing, price: event.target.value, error: '' })} />
            <Field label="Qeyd" value={editing.note} maxLength={200} placeholder="Məs.: sayım düzəlişi"
              error={editing.error || undefined}
              onChange={(event) => setEditing({ ...editing, note: event.target.value, error: '' })} />
            <div className="dialog-actions">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Bağla</Button>
              <Button type="submit" loading={busy}>Növbəyə qoy</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
