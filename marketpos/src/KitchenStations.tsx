import { useState } from 'react';
import { ChefHat, Plus, Printer, Trash2 } from 'lucide-react';
import { PRODUCT_FORM_AISLES } from './catalogCategories';
import { categoryLabel } from './i18n';
import type { CartLine, Lang, Product, SessionUser, StoreSettings } from './types';

/**
 * Extra kitchen printers ("Kababçı", "Bufet"): goods of the categories assigned
 * to one print on a preparation ticket at that printer when a sale completes.
 * Stored as JSON in the `kitchenStations` setting; the same model as Restaurant
 * POS's `kitchen.stations`.
 */
export type KitchenStation = { id: string; name: string; printer: string; categoryIds: string[] };

export function readStations(settings: StoreSettings): KitchenStation[] {
  try {
    const list = JSON.parse(settings.kitchenStations || '[]');
    return Array.isArray(list)
      ? list.filter((row) => row && row.id && row.printer && Array.isArray(row.categoryIds) && row.categoryIds.length)
      : [];
  } catch {
    return [];
  }
}

/** Sends one preparation ticket per station that has goods in this sale. Failures are returned, not thrown. */
export async function printStationTickets(
  settings: StoreSettings, products: Product[], cart: CartLine[], receiptNo: string, sessionToken: string,
): Promise<string[]> {
  const stations = readStations(settings);
  const print = window.marketSystem?.printer?.station;
  if (!stations.length || !print) return [];
  const failed: string[] = [];
  for (const station of stations) {
    const items = cart
      .map((line) => ({ line, product: products.find((p) => p.id === line.productId) }))
      .filter(({ product }) => product && station.categoryIds.includes(product.category))
      .map(({ line, product }) => ({ name: product!.name.az || product!.name.en || product!.sku, qty: line.qty, unit: product!.unit }));
    if (!items.length) continue;
    try {
      await print(sessionToken, station.printer, { stationName: station.name, receiptNo, createdAt: Date.now(), items });
    } catch {
      failed.push(station.name);
    }
  }
  return failed;
}

export function KitchenStationsCard({ settings, products, session, lang, onSave, notify }: {
  settings: StoreSettings;
  products: Product[];
  session: SessionUser;
  lang: Lang;
  onSave: (kitchenStations: string) => void;
  notify: (text: string) => void;
}) {
  const stations = readStations(settings);
  const [draft, setDraft] = useState<KitchenStation | null>(null);
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }> | null>(null);
  const categories = Array.from(new Set([...PRODUCT_FORM_AISLES, ...products.map((p) => p.category).filter(Boolean)]));

  const save = () => {
    if (!draft) return;
    const row = { ...draft, name: draft.name.trim(), printer: draft.printer.trim() };
    if (!row.name || !row.printer || !row.categoryIds.length) { notify('Ad, printer və ən azı bir kateqoriya seçin'); return; }
    const next = stations.some((s) => s.id === row.id) ? stations.map((s) => (s.id === row.id ? row : s)) : [...stations, row];
    onSave(JSON.stringify(next));
    setDraft(null);
  };
  const remove = (row: KitchenStation) => {
    if (!window.confirm(`"${row.name}" printeri silinsin?`)) return;
    onSave(JSON.stringify(stations.filter((s) => s.id !== row.id)));
  };
  const test = async (target: string) => {
    try {
      await window.marketSystem?.printer?.station?.(session.sessionToken, target, {
        stationName: draft?.name || stations.find((s) => s.printer === target)?.name || 'Test', receiptNo: 'TEST', createdAt: Date.now(),
        items: [{ name: 'Yoxlama vərəqi', qty: 1 }],
      });
      notify('Yoxlama vərəqi göndərildi');
    } catch (err) { notify(err instanceof Error ? err.message : String(err)); }
  };
  const loadPrinters = async () => {
    try { setPrinters((await window.marketSystem?.printer?.list()) ?? []); } catch (err) { notify(err instanceof Error ? err.message : String(err)); }
  };
  const takenBy = (category: string) => stations.find((s) => s.id !== draft?.id && s.categoryIds.includes(category));

  return (
    <section className="panel-card settings-card kitchen-stations">
      <div className="panel-title"><h3>Əlavə mətbəx printerləri</h3><ChefHat /></div>
      <p className="hint">Məsələn kababçının və ya bufetin öz printeri: seçdiyiniz kateqoriyaların malları satış tamamlananda ayrıca hazırlıq çeki ilə bu printerdən çıxır.</p>
      {stations.length === 0 && !draft && <p className="hint">Hələ əlavə printer yoxdur.</p>}
      {stations.map((row) => (
        <div key={row.id} className="kitchen-station-row">
          <div>
            <b>{row.name}</b>
            <small>{row.printer}</small>
            <small>{row.categoryIds.map((c) => categoryLabel(c, lang)).join(' · ')}</small>
          </div>
          <div className="kitchen-station-actions">
            <button type="button" onClick={() => void test(row.printer)}><Printer />Yoxla</button>
            <button type="button" onClick={() => setDraft({ ...row, categoryIds: [...row.categoryIds] })}>Düzəlt</button>
            <button type="button" onClick={() => remove(row)} aria-label="Sil"><Trash2 /></button>
          </div>
        </div>
      ))}
      {draft ? (
        <div className="kitchen-station-form">
          <label className="field"><span>Ad (məs. Kababçı)</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label className="field"><span>Printer ünvanı (tcp:192.168.0.50:9100 və ya Windows printer adı)</span><input value={draft.printer} onChange={(e) => setDraft({ ...draft, printer: e.target.value })} /></label>
          <div className="kitchen-station-actions">
            <button type="button" onClick={() => void loadPrinters()}>Qoşulu printerləri göstər</button>
            <button type="button" disabled={!draft.printer.trim()} onClick={() => void test(draft.printer.trim())}><Printer />Yoxlama vərəqi</button>
          </div>
          {printers && (
            <div className="kitchen-station-chips">
              {printers.length ? printers.map((p) => (
                <button key={p.id} type="button" className={draft.printer === p.id ? 'active' : ''} onClick={() => setDraft({ ...draft, printer: p.id })}>{p.name}</button>
              )) : <p className="hint">Printer tapılmadı — ünvanı əllə yazın.</p>}
            </div>
          )}
          <p className="hint">Bu printerdən çıxacaq kateqoriyalar</p>
          <div className="kitchen-station-chips">
            {categories.map((c) => {
              const other = takenBy(c);
              const on = draft.categoryIds.includes(c);
              return (
                <button key={c} type="button" disabled={Boolean(other)} className={on ? 'active' : ''} title={other?.name}
                  onClick={() => setDraft({ ...draft, categoryIds: on ? draft.categoryIds.filter((x) => x !== c) : [...draft.categoryIds, c] })}>
                  {on ? '✓ ' : ''}{categoryLabel(c, lang)}{other ? ` · ${other.name}` : ''}
                </button>
              );
            })}
          </div>
          <div className="kitchen-station-actions">
            <button type="button" className="modal-primary" onClick={save}>Yadda saxla</button>
            <button type="button" onClick={() => setDraft(null)}>Ləğv et</button>
          </div>
        </div>
      ) : (
        <button type="button" className="modal-primary" onClick={() => setDraft({ id: `st-${Date.now().toString(36)}`, name: '', printer: '', categoryIds: [] })}>
          <Plus />Əlavə mətbəx printeri
        </button>
      )}
    </section>
  );
}
