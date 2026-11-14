import { useEffect, useState } from 'react';

type Dish = { id: string; nameAz: string; categoryId: string; priceMinor: number; active?: boolean };
type Station = { id: string; name?: string; printer?: string; main?: boolean; roles?: string[]; itemIds?: string[]; categoryIds?: string[] };
type Row = { id: string; name: string; printer: string; dishes: Dish[] };

/**
 * Which printer a category's dishes use when the till sends them to the kitchen.
 * "" is the main kitchen printer. Any other id is a station in kitchen.stations
 * (the cashier printer included). New dishes added later stay on the kitchen
 * printer until the category is saved again.
 */
export function MenuPrinters({ deviceId, rpc, canWrite }: {
  deviceId: string;
  rpc: (deviceId: string, calls: Array<{ method: string; payload?: Record<string, unknown>; idempotencyKey?: string }>) => Promise<{ queued?: boolean; results?: Array<{ success: boolean; data?: any; error?: { message?: string } | null }> }>;
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [printers, setPrinters] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let live = true;
    setError('');
    void (async () => {
      const result = await rpc(deviceId, [
        { method: 'settings.getAll', payload: {} },
        { method: 'catalog.categories', payload: {} },
        { method: 'catalog.products', payload: { includeDrafts: true } },
      ]);
      if (!live) return;
      const failed = result.results?.find((row) => !row.success);
      if (failed) throw new Error(failed.error?.message || 'Menyu alınmadı');
      const settings = result.results?.[0]?.data?.settings || {};
      let stations: Station[] = [];
      try { stations = JSON.parse(settings['kitchen.stations'] || '[]'); } catch { stations = []; }
      const extras = (Array.isArray(stations) ? stations : []).filter((station) => station.id && station.printer && !station.main && !(station.roles || []).includes('kitchen'));
      const categories = result.results?.[1]?.data?.categories || [];
      const products: Dish[] = result.results?.[2]?.data?.products || [];
      const home = (categoryId: string, dishes: Dish[]) => {
        const hits = new Set(dishes.map((dish) => extras.find((station) => (station.itemIds || []).includes(dish.id) || (station.categoryIds || []).includes(categoryId))?.id || ''));
        return hits.size === 1 ? [...hits][0] : 'mixed';
      };
      if (!live) return;
      setPrinters(extras.map((station) => ({ id: station.id, name: station.name || 'Printer' })));
      setRows(categories.filter((category: { active?: boolean }) => category.active !== false).map((category: { id: string; nameAz: string }) => {
        const dishes = products.filter((dish) => dish.categoryId === category.id && dish.active !== false);
        return { id: category.id, name: category.nameAz, printer: home(category.id, dishes), dishes };
      }));
    })().catch((cause: Error) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [deviceId]);

  const save = async (row: Row, printer: string) => {
    if (!canWrite || busy) return;
    setBusy(row.id);
    setError('');
    try {
      for (let index = 0; index < row.dishes.length; index += 16) {
        const calls = row.dishes.slice(index, index + 16).map((dish) => ({
          method: 'catalog.upsertProduct',
          idempotencyKey: crypto.randomUUID(),
          payload: { id: dish.id, nameAz: dish.nameAz, categoryId: dish.categoryId, priceMinor: dish.priceMinor, printerStationId: printer },
        }));
        const result = await rpc(deviceId, calls);
        if (result.queued) throw new Error('Kassa oflayndır. POS açıq olanda yenidən seçin.');
        const failed = result.results?.find((item) => !item.success);
        if (failed) throw new Error(failed.error?.message || 'Printer saxlanmadı');
      }
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, printer } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Printer saxlanmadı');
    } finally {
      setBusy('');
    }
  };

  if (!rows.length && !error) return null;
  return (
    <div className="pw-table" style={{ margin: '0 0 16px' }}>
      <p className="pw-snapshot-caption">Mətbəxə göndərəndə seçilmiş printerdən çıxır. Müştəri çeki yenə kassa printerində qalır.</p>
      {error ? <p className="pw-error" role="alert">{error}</p> : null}
      <table>
        <thead><tr><th>Kateqoriya</th><th>Printer</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>
                <select aria-label={`${row.name} printeri`} disabled={!canWrite || busy === row.id} value={row.printer} onChange={(event) => { if (event.target.value !== 'mixed') void save(row, event.target.value); }}>
                  {row.printer === 'mixed' ? <option value="mixed">Qarışıq</option> : null}
                  <option value="">Mətbəx</option>
                  {printers.map((printer) => <option key={printer.id} value={printer.id}>{printer.name}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
