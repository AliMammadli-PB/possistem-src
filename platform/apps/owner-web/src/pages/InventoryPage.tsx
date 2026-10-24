import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  customerAccess,
  inventoryAccess,
  inventoryCommand,
  inventoryCommands,
  inventorySnapshot,
  type InventoryCommandStatus,
  type InventoryLine,
  type InventoryMenuItem,
  type InventoryMenuCategory,
  type InventoryProduct,
  type InventoryWarehouse,
} from '../api';
import { ConfirmDialog } from '../ui/overlays';
import { Field, SelectField } from '../ui/forms';
import { exportCsv } from '../ui/export-csv';
import { parseCsv } from '../ui/import-csv';
import { exportXlsx, parseXlsx } from '../ui/xlsx';
import { printLabels } from '../ui/print-labels';
import { PageHeader } from '../ui/navigation';
import { Alert, Button, Card, DataTable, EmptyState, ErrorState } from '../ui/primitives';

const LABELS: Record<InventoryProduct, string> = { market: 'Market POS', restaurant: 'Restoran POS' };
const KINDS = [
  ['store', 'Anbar'],
  ['kitchen', 'Mətbəx'],
  ['bar', 'Bar'],
  ['cold', 'Soyuducu'],
] as const;

function qtyText(product: InventoryProduct, line: InventoryLine) {
  if (product === 'market') return String(line.qty);
  const amount = line.qty / 1000;
  return `${Number.isInteger(amount) ? amount : amount.toFixed(3)} ${line.unit || ''}`.trim();
}

export default function InventoryPage() {
  const [params] = useSearchParams();
  const wantKind = params.get('kind');
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [stockProducts, setStockProducts] = useState<InventoryProduct[]>([]);
  const [cost, setCost] = useState<Record<InventoryProduct, boolean>>({ market: false, restaurant: false });
  const [product, setProduct] = useState<InventoryProduct>('market');
  const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([]);
  const [lines, setLines] = useState<InventoryLine[]>([]);
  const [menu, setMenu] = useState<InventoryMenuItem[]>([]);
  const [categories, setCategories] = useState<InventoryMenuCategory[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [menuCategoryId, setMenuCategoryId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [commands, setCommands] = useState<InventoryCommandStatus[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<InventoryLine | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);
  const archived = useRef(new Set<string>());
  const [deleteArea, setDeleteArea] = useState<string | null>(null);
  const rowKey = (row: InventoryLine) => `${row.deviceId || ''}:${row.id}`;
  const removeIngredient = async () => {
    if (!deleteTarget?.deviceId || !deleteArea || deleteLock.current) return;
    const target = deleteTarget;
    deleteLock.current = true; setDeleting(true); setNotice(''); setError('');
    try {
      await inventoryCommand('restaurant', 'product.deactivate', { productId: target.id, deviceId: target.deviceId, area: deleteArea });
      archived.current.add(rowKey(target));
      setLines((current) => current.filter((row) => rowKey(row) !== rowKey(target)));
      setNotice(`“${target.name}” silinməsi kassaya göndərildi: kassa onlayndırsa bir neçə saniyəyə, oflayndırsa açılanda silinəcək. Keçmiş hərəkətlər saxlanılır.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Məhsul silinmədi'); }
    finally { setDeleteTarget(null); deleteLock.current = false; setDeleting(false); }
  };

  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseKind, setWarehouseKind] = useState('store');
  const [renameId, setRenameId] = useState('');
  const [card, setCard] = useState({
    name: '', barcode: '', group: '', unit: 'ədəd', salePrice: '', costPrice: '', kind: 'product',
    comment: '', tags: '', minPrice: '', taxRate: '18', station: '', department: '', packUnit: '', packQty: '',
    priceDiscount: '', priceWholesale: '', priceDealer: '', weighted: false, serial: false, supplier: '', minStock: '',
  });
  const [move, setMove] = useState({
    kind: 'stock.receive',
    productId: '',
    warehouseId: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    qty: '',
    reason: 'other',
  });

  const loadAccess = async () => {
    const [access, grants] = await Promise.all([inventoryAccess(), customerAccess()]);
    setDeleteArea(grants.portal == null || grants.portal.includes('product.write') ? 'product' : grants.portal.includes('anbar.write') ? 'anbar' : null);
    const available = [...new Set([...access.products, ...(access.catalogProducts ?? [])])];
    setProducts(available);
    setStockProducts(access.products);
    setCost(access.cost);
    setProduct((current) => (available.includes(current) ? current : available[0] ?? 'market'));
    return { available, stock: access.products };
  };

  const loadSnapshot = async (next: InventoryProduct, hasStock = stockProducts.includes(next)) => {
    const row = await inventorySnapshot(next, hasStock ? 'anbar' : 'product');
    const snapshot = row.snapshot ?? {};
    setWarehouses(Array.isArray(snapshot.warehouses) ? snapshot.warehouses : []);
    setLines(Array.isArray(snapshot.lines) ? snapshot.lines : []);
    setMenu(Array.isArray(snapshot.menu) ? snapshot.menu : []);
    setCategories(Array.isArray(snapshot.categories) ? snapshot.categories : []);
    const deviceIds = [...new Set([...(snapshot.warehouses ?? []), ...(snapshot.menu ?? []), ...(snapshot.categories ?? [])].map((item) => item.deviceId).filter((id): id is string => Boolean(id)))];
    setSelectedDeviceId((current) => deviceIds.includes(current) ? current : deviceIds[0] ?? '');
    void inventoryCommands(next, hasStock ? 'anbar' : 'product').then((result) => setCommands(result.commands)).catch(() => setCommands([]));
    setUpdatedAt(row.updatedAt);
    setProblems(row.problems ?? []);
    setCard((prev) => ({ ...prev, unit: next === 'restaurant' ? 'kg' : 'ədəd', kind: next === 'restaurant' ? (hasStock ? 'ingredient' : 'menu') : 'product' }));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const allowed = await loadAccess();
        if (!alive) return;
        if (allowed.available[0]) await loadSnapshot(allowed.available[0], allowed.stock.includes(allowed.available[0]));
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Anbar açılmadı');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (loading || products.length === 0) return;
    const timer = window.setInterval(() => {
      void inventorySnapshot(product, stockProducts.includes(product) ? 'anbar' : 'product').then((row) => {
        setWarehouses(row.snapshot.warehouses ?? []);
        setLines(row.snapshot.lines ?? []);
        setMenu(row.snapshot.menu ?? []);
        setCategories(row.snapshot.categories ?? []);
        setUpdatedAt(row.updatedAt);
        setProblems(row.problems ?? []);
      }).catch(() => undefined);
      void inventoryCommands(product, stockProducts.includes(product) ? 'anbar' : 'product').then((row) => setCommands(row.commands)).catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loading, products.length, product, stockProducts]);

  useEffect(() => {
    if (loading || !wantKind) return;
    setCard((prev) => (prev.kind === wantKind ? prev : { ...prev, kind: wantKind }));
    document.getElementById('kart')?.scrollIntoView({ block: 'start' });
  }, [loading, wantKind, product]);

  const activeWarehouses = selectedDeviceId ? warehouses.filter((item) => item.deviceId === selectedDeviceId) : warehouses;
  const activeLines = lines.filter((item) => (!selectedDeviceId || item.deviceId === selectedDeviceId) && !archived.current.has(rowKey(item)));
  const activeMenu = selectedDeviceId ? menu.filter((item) => item.deviceId === selectedDeviceId) : menu;
  const activeCategories = selectedDeviceId ? categories.filter((item) => item.deviceId === selectedDeviceId) : categories;
  const cards = useMemo(() => {
    const seen = new Map<string, InventoryLine>();
    for (const line of activeLines) if (!seen.has(line.id)) seen.set(line.id, line);
    return [...seen.values()];
  }, [activeLines]);

  const visible = activeLines.filter((line) => {
    if (warehouseId && line.warehouseId !== warehouseId) return false;
    if (lowOnly && line.qty > line.minQty) return false;
    const hay = `${line.name} ${line.barcode} ${line.group}`.toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  const send = async (kind: string, body: Record<string, unknown>) => {
    setNotice('');
    setError('');
    try {
      await inventoryCommand(product, kind, { ...body, deviceId: selectedDeviceId });
      setNotice('Əmr kassaya göndərildi. Kassa onlayn olanda siyahı yenilənəcək.');
      void inventoryCommands(product, stockProducts.includes(product) ? 'anbar' : 'product').then((result) => setCommands(result.commands));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Əmr göndərilmədi');
    }
  };

  const importCards = async (file: File) => {
    setError('');
    setNotice('');
    try {
      const rows = file.name.toLowerCase().endsWith('.xlsx') ? await parseXlsx(file) : parseCsv(await file.text());
      if (rows.length > 200) throw new Error('Bir dəfəyə ən çox 200 məhsul idxal edin.');
      const knownDevices = [...new Set([...warehouses, ...menu, ...categories].map((row) => row.deviceId).filter((id): id is string => Boolean(id)))];
      const deviceId = selectedDeviceId || (knownDevices.length === 1 ? knownDevices[0] : '');
      if (!deviceId && knownDevices.length > 1) throw new Error('İdxal üçün POS cihazını seçin.');
      let queued = 0;
      for (const [index, row] of rows.entries()) {
        const name = row.name?.trim();
        const kind = product === 'restaurant' ? (stockEnabled && row.kind === 'ingredient' ? 'product.save' : 'menu.product.save') : 'product.save';
        const price = Number(row.salePrice ?? 0);
        const costPrice = Number(row.costPrice ?? 0);
        if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(costPrice) || costPrice < 0) {
          throw new Error(`${index + 2}-ci CSV sətrində ad və ya qiymət düzgün deyil; ${queued} sənəd növbəyə alındı.`);
        }
        const categoryId = row.categoryId || menuCategoryId;
        if (kind === 'menu.product.save' && !categoryId) throw new Error(`${index + 2}-ci CSV sətrində categoryId yoxdur; ${queued} sənəd növbəyə alındı.`);
        await inventoryCommand(product, kind, {
          name, barcode: row.barcode ?? '', group: row.group ?? '', unit: row.unit || 'ədəd',
          salePrice: price, costPrice, categoryId, station: row.station || 'kitchen',
          minStock: Math.max(0, Math.trunc(Number(row.minStock) || 0)), ...(deviceId ? { deviceId } : {}),
        });
        queued++;
      }
      setNotice(`${queued} məhsul sənədi POS növbəsinə alındı.`);
      const fresh = await inventoryCommands(product, stockEnabled ? 'anbar' : 'product');
      setCommands(fresh.commands);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'CSV idxal edilmədi');
    }
  };

  const milli = (raw: string) => {
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed)) return 0;
    return product === 'restaurant' ? Math.round(parsed * 1000) : Math.trunc(parsed);
  };

  if (loading) return <p>Anbar yüklənir…</p>;
  if (products.length === 0) {
    return (
      <ErrorState
        title="Anbar bağlıdır"
        description="Bu hesabın lisenziyasında anbar modulu yoxdur."
      />
    );
  }

  const showCost = cost[product];
  const stockEnabled = stockProducts.includes(product);
  const stockBody = (kind: string) => {
    const qty = milli(move.qty);
    const body: Record<string, unknown> = {
      productId: move.productId,
      warehouseId: move.warehouseId,
      reason: move.reason,
      deviceId: selectedDeviceId,
    };
    if (product === 'restaurant') body.qtyMilli = qty;
    else body.qty = qty;
    if (kind === 'stock.transfer') {
      body.fromWarehouseId = move.fromWarehouseId;
      body.toWarehouseId = move.toWarehouseId;
    }
    return body;
  };

  return (
    <div className="page-stack erp-workspace">
      <PageHeader
        eyebrow={stockEnabled ? 'Anbar' : 'Menyu'}
        title={stockEnabled ? 'Anbar' : 'Restoran menyusu'}
        description={updatedAt ? `Son şəkil: ${new Date(updatedAt).toLocaleString('az-AZ')}` : 'Kassa hələ anbar şəkli göndərməyib.'}
      />
      {products.length > 1 ? (
        <div className="segmented" role="tablist" aria-label="POS">
          {products.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === product}
              onClick={() => {
                setProduct(item);
                void loadSnapshot(item).catch((cause) => setError(cause instanceof Error ? cause.message : 'Yüklənmədi'));
              }}
            >
              {LABELS[item]}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="danger" title="Xəta">{error}</Alert> : null}
      {notice ? <Alert tone="success" title="Əməliyyatın nəticəsi">{notice}</Alert> : null}
      {problems.length > 0 ? (
        <Alert tone="warning" title="Kassa bu əmrləri tətbiq etmədi">{problems.join(', ')}</Alert>
      ) : null}
      {new Set([...warehouses, ...menu, ...categories].map((row) => row.deviceId).filter(Boolean)).size > 1 ? (
        <SelectField label="POS cihazı" value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
          {[...new Map([...warehouses, ...menu, ...categories].filter((row) => row.deviceId).map((row) => [row.deviceId, row.deviceName || row.deviceId])).entries()].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </SelectField>
      ) : null}

      {stockEnabled ? <Card>
        <h2>Anbarlar</h2>
        {activeWarehouses.length === 0 ? <EmptyState title="Anbar yoxdur" description="Kassa şəkil göndərəndə siyahı burada görünəcək." /> : (
          <DataTable
            caption="Anbarlar"
            rows={activeWarehouses}
            getRowKey={(row) => row.id}
            columns={[
              { key: 'name', label: 'Ad', render: (row) => row.name },
              { key: 'kind', label: 'Növ', render: (row) => KINDS.find((item) => item[0] === row.kind)?.[1] ?? row.kind },
              { key: 'active', label: 'Vəziyyət', render: (row) => (row.active === false ? 'Bağlı' : 'Aktiv') },
            ]}
            empty={null}
          />
        )}
        <div className="form-grid">
          <Field label="Ad" value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} />
          {product === 'restaurant' ? (
            <SelectField label="Növ" value={warehouseKind} onChange={(event) => setWarehouseKind(event.target.value)}>
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectField>
          ) : null}
          <SelectField label="Adını dəyiş" value={renameId} onChange={(event) => setRenameId(event.target.value)}>
            <option value="">Yeni anbar</option>
            {activeWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </SelectField>
        </div>
        <div className="button-row">
          <Button variant="primary" onClick={() => void send(renameId ? 'warehouse.rename' : 'warehouse.create', { id: renameId, name: warehouseName, kind: warehouseKind })}>Saxla</Button>
          <Button variant="danger" disabled={!renameId} onClick={() => void send('warehouse.close', { id: renameId, name: activeWarehouses.find((row) => row.id === renameId)?.name ?? '' })}>Bağla</Button>
        </div>
      </Card> : null}

      {stockEnabled ? <Card>
        <h2>Qalıq</h2>
        <Button onClick={() => exportCsv(`anbar-${product}.csv`, [
          ['POS cihazı', 'Məhsul', 'Barkod', 'Qrup', 'Anbar', 'Miqdar', 'Vahid', 'Satış qiyməti', ...(showCost ? ['Maya dəyəri'] : [])],
          ...visible.map((row) => [row.deviceName ?? '', row.name, row.barcode, row.group, row.warehouseName, row.qty, row.unit, row.salePrice, ...(showCost ? [row.costPrice ?? 0] : [])]),
        ])}>CSV ixracı</Button>
        <Button onClick={() => void exportXlsx(`anbar-${product}.xlsx`, [
          ['POS cihazı', 'Məhsul', 'Barkod', 'Qrup', 'Anbar', 'Miqdar', 'Vahid', 'Satış qiyməti', ...(showCost ? ['Maya dəyəri'] : [])],
          ...visible.map((row) => [row.deviceName ?? '', row.name, row.barcode, row.group, row.warehouseName, row.qty, row.unit, row.salePrice, ...(showCost ? [row.costPrice ?? 0] : [])]),
        ]).catch((cause) => setError(cause instanceof Error ? cause.message : 'XLSX hazırlanmadı'))}>XLSX ixracı</Button>
        <Button onClick={() => void printLabels(visible).catch((cause) => setError(cause instanceof Error ? cause.message : 'Etiketlər çap edilmədi'))}>Etiket çapı</Button>
        <div className="form-grid">
          <Field label="Axtarış" value={query} onChange={(event) => setQuery(event.target.value)} />
          <SelectField label="Anbar" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Hamısı</option>
            {activeWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </SelectField>
          <label className="checkbox"><input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} /> Az qalanlar</label>
        </div>
        <DataTable
          caption="Qalıq"
          rows={visible}
          getRowKey={(row) => `${row.deviceId || ''}-${row.id}-${row.warehouseId}`}
          empty={<EmptyState title="Sətir yoxdur" description="Axtarışı dəyişin və ya kassanın onlayn olmasını gözləyin." />}
          columns={[
            { key: 'name', label: product === 'restaurant' ? 'Xammal' : 'Məhsul', render: (row) => row.name },
            { key: 'warehouse', label: 'Anbar', render: (row) => row.warehouseName || row.warehouseId },
            { key: 'qty', label: 'Qalıq', render: (row) => qtyText(product, row) },
            { key: 'group', label: 'Qrup', render: (row) => row.group || '—' },
            ...(product === 'restaurant' && deleteArea ? [{ key: 'actions', label: 'Əməliyyat', render: (row: InventoryLine) => <Button variant="danger" disabled={deleting || !row.deviceId} aria-label={`${row.name} məhsulunu sil`} onClick={() => setDeleteTarget(row)}>Sil</Button> }] : []),
          ]}
        />
      </Card> : null}

      <Card id="kart">
        <h2>{stockEnabled ? 'Kart' : 'Menyu kartı'}</h2>
        <label>CSV/XLSX idxalı (name, barcode, group, unit, salePrice, costPrice, minStock; menyu üçün categoryId)
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importCards(file);
            event.target.value = '';
          }} />
        </label>
        {product === 'restaurant' ? (
          <>
            <h3>Menyu və xammal ayrı saxlanır</h3>
            <DataTable caption="Menyu məhsulları" rows={activeMenu} getRowKey={(row) => `${row.deviceId || ''}-${row.id}`}
              empty={<EmptyState title="Menyu məhsulu yoxdur" description="Restoran POS menyunu göndərəndə görünəcək." />}
              columns={[
                { key: 'name', label: 'Ad', render: (row) => row.name },
                { key: 'category', label: 'Kateqoriya', render: (row) => activeCategories.find((item) => item.id === row.categoryId)?.name || row.categoryId },
                { key: 'price', label: 'Qiymət', render: (row) => `${(row.salePrice / 100).toFixed(2)} ₼` },
              ]} />
            <div className="form-grid">
              <Field label="Yeni menyu kateqoriyası" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
              <Button disabled={!categoryName.trim()} onClick={() => void send('menu.category.save', { name: categoryName })}>Kateqoriya yarat</Button>
            </div>
          </>
        ) : null}
        <div className="form-grid">
          <SelectField label="Növ" value={card.kind} onChange={(event) => setCard({ ...card, kind: event.target.value })}>
            {product === 'restaurant' ? <>{stockEnabled ? <option value="ingredient">Xammal</option> : null}<option value="menu">Menyu məhsulu</option></> : <><option value="product">Məhsul</option><option value="service">Xidmət</option></>}
          </SelectField>
          {product === 'restaurant' && card.kind === 'menu' ? (
            <SelectField label="Menyu kateqoriyası" value={menuCategoryId} onChange={(event) => setMenuCategoryId(event.target.value)}>
              <option value="">Seçin</option>
              {activeCategories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
          ) : null}
          <Field label="Ad" required value={card.name} onChange={(event) => setCard({ ...card, name: event.target.value })} />
          <Field label="Barkod" value={card.barcode} onChange={(event) => setCard({ ...card, barcode: event.target.value })} />
          <Field label={product === 'restaurant' ? 'Kateqoriya' : 'Qrup'} value={card.group} onChange={(event) => setCard({ ...card, group: event.target.value })} />
          <SelectField label="Vahid" value={card.unit} onChange={(event) => setCard({ ...card, unit: event.target.value })}>
            {(product === 'restaurant' ? ['kg', 'l', 'ədəd', 'qab'] : ['ədəd', 'mt', 'qutu', 'kq', 'litr']).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </SelectField>
          <Field label="Satış qiyməti (qəpik)" value={card.salePrice} onChange={(event) => setCard({ ...card, salePrice: event.target.value })} />
          <SelectField label="Vergi" value={card.taxRate} onChange={(event) => setCard({ ...card, taxRate: event.target.value })}>
            <option value="18">ƏDV 18%</option>
            <option value="8">Sadələşdirilmiş 8%</option>
            <option value="2">Sadələşdirilmiş 2%</option>
            <option value="0">ƏDV-dən azad</option>
          </SelectField>
          <Field label="ƏDV-siz (qəpik)" value={String(Math.round((Number(card.salePrice) || 0) / (Number(card.taxRate) ? 1 + Number(card.taxRate) / 100 : 1)))} readOnly />
          <Field label="Minimal qiymət (qəpik)" value={card.minPrice} onChange={(event) => setCard({ ...card, minPrice: event.target.value })} />
          <Field label="Endirimli qiymət (qəpik)" value={card.priceDiscount} onChange={(event) => setCard({ ...card, priceDiscount: event.target.value })} />
          <Field label="Topdan (qəpik)" value={card.priceWholesale} onChange={(event) => setCard({ ...card, priceWholesale: event.target.value })} />
          <Field label="Diller (qəpik)" value={card.priceDealer} onChange={(event) => setCard({ ...card, priceDealer: event.target.value })} />
          {showCost ? <Field label="Maya (qəpik)" value={card.costPrice} onChange={(event) => setCard({ ...card, costPrice: event.target.value })} /> : null}
          {card.kind === 'product' ? <Field label="Minimal qalıq" value={card.minStock} onChange={(event) => setCard({ ...card, minStock: event.target.value })} /> : null}
          <Field label="Təchizatçı" value={card.supplier} onChange={(event) => setCard({ ...card, supplier: event.target.value })} />
          <Field label="Şərh" value={card.comment} onChange={(event) => setCard({ ...card, comment: event.target.value })} />
          <Field label="Tag" value={card.tags} onChange={(event) => setCard({ ...card, tags: event.target.value })} />
          <Field label="Stansiya" value={card.station} onChange={(event) => setCard({ ...card, station: event.target.value })} />
          <Field label="Şöbə" value={card.department} onChange={(event) => setCard({ ...card, department: event.target.value })} />
          <Field label="Bağlama vahidi" value={card.packUnit} onChange={(event) => setCard({ ...card, packUnit: event.target.value })} />
          <Field label="Bağlamada say" value={card.packQty} onChange={(event) => setCard({ ...card, packQty: event.target.value })} />
          <label className="checkbox"><input type="checkbox" checked={card.weighted} onChange={(event) => setCard({ ...card, weighted: event.target.checked })} /> Çəki</label>
          <label className="checkbox"><input type="checkbox" checked={card.serial} onChange={(event) => setCard({ ...card, serial: event.target.checked })} /> Seriya</label>
        </div>
        <Button
          variant="primary"
          disabled={!card.name.trim() || (product === 'market' && !card.group.trim()) || (card.kind === 'menu' && !menuCategoryId)}
          onClick={() => void send(card.kind === 'menu' ? 'menu.product.save' : 'product.save', {
            name: card.name,
            categoryId: menuCategoryId,
            kind: card.kind,
            barcode: card.barcode,
            group: card.group,
            unit: card.unit,
            salePrice: Math.max(0, Math.trunc(Number(card.salePrice) || 0)),
            costPrice: Math.max(0, Math.trunc(Number(card.costPrice) || 0)),
            minPrice: Math.max(0, Math.trunc(Number(card.minPrice) || 0)),
            minStock: card.kind === 'service' ? 0 : Math.max(0, Math.trunc(Number(card.minStock) || 0)),
            taxRate: Math.max(0, Math.trunc(Number(card.taxRate) || 0)),
            supplier: card.supplier,
            comment: card.comment,
            tags: card.tags,
            station: card.station,
            department: card.department,
            packUnit: card.packUnit,
            packQty: Math.max(0, Math.trunc(Number(card.packQty) || 0)),
            priceDiscount: Math.max(0, Math.trunc(Number(card.priceDiscount) || 0)),
            priceWholesale: Math.max(0, Math.trunc(Number(card.priceWholesale) || 0)),
            priceDealer: Math.max(0, Math.trunc(Number(card.priceDealer) || 0)),
            weighted: card.weighted,
            serial: card.serial,
          })}
        >Kartı saxla</Button>
      </Card>

      {stockEnabled ? <Card>
        <h2>Hərəkət</h2>
        <div className="form-grid">
          <SelectField label="Növ" value={move.kind} onChange={(event) => setMove({ ...move, kind: event.target.value })}>
            <option value="stock.receive">Mal qəbulu</option>
            <option value="stock.transfer">Anbardan anbara</option>
            <option value="stock.waste">Silinmə / itki</option>
            <option value="stock.count">Sayım</option>
          </SelectField>
          <SelectField label={product === 'restaurant' ? 'Xammal' : 'Məhsul'} value={move.productId} onChange={(event) => setMove({ ...move, productId: event.target.value })}>
            <option value="">Seçin</option>
            {cards.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </SelectField>
          {move.kind === 'stock.transfer' ? (
            <>
              <SelectField label="Haradan" value={move.fromWarehouseId} onChange={(event) => setMove({ ...move, fromWarehouseId: event.target.value })}>
                <option value="">Seçin</option>
                {activeWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
              <SelectField label="Hara" value={move.toWarehouseId} onChange={(event) => setMove({ ...move, toWarehouseId: event.target.value })}>
                <option value="">Seçin</option>
                {activeWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </SelectField>
            </>
          ) : (
            <SelectField label="Anbar" value={move.warehouseId} onChange={(event) => setMove({ ...move, warehouseId: event.target.value })}>
              <option value="">Seçin</option>
              {activeWarehouses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </SelectField>
          )}
          <Field label={product === 'restaurant' ? 'Miqdar' : 'Ədəd'} value={move.qty} onChange={(event) => setMove({ ...move, qty: event.target.value })} />
          {move.kind === 'stock.waste' && product === 'market' ? (
            <SelectField label="Səbəb" value={move.reason} onChange={(event) => setMove({ ...move, reason: event.target.value })}>
              <option value="expired">Vaxtı keçib</option>
              <option value="damaged">Zədələnib</option>
              <option value="spoiled">Xarab olub</option>
              <option value="other">Digər</option>
            </SelectField>
          ) : null}
        </div>
        <Button variant="primary" onClick={() => void send(move.kind, stockBody(move.kind))}>Təsdiqlə</Button>
      </Card> : null}
      <Card>
        <h2>Göndərilən əmrlər</h2>
        <DataTable caption="Əmr tarixçəsi" rows={commands} getRowKey={(row) => row.id}
          empty={<EmptyState title="Əmr yoxdur" description="Portal əmrləri burada izlənəcək." />}
          columns={[
            { key: 'kind', label: 'Əməliyyat', render: (row) => row.kind },
            { key: 'status', label: 'Vəziyyət', render: (row) => row.status === 'pending' ? 'Gözləyir' : row.status === 'applied' ? 'Tətbiq edildi' : 'Rədd edildi' },
            { key: 'created', label: 'Tarix', render: (row) => new Date(row.created_at).toLocaleString('az-AZ') },
            { key: 'reason', label: 'Səbəb', render: (row) => row.error_reason || '—' },
          ]} />
      </Card>
      <ConfirmDialog open={Boolean(deleteTarget)} title="Məhsul anbardan silinsin?"
        description={deleteTarget ? `“${deleteTarget.name}” bütün anbarlarda aktiv siyahıdan çıxarılacaq. Keçmiş hərəkətlər saxlanılacaq. Reseptdə istifadə olunursa, resepti də yeniləyin.` : ''}
        confirmLabel="Bəli, sil" danger busy={deleting} onConfirm={() => void removeIngredient()}
        onClose={() => { if (!deleteLock.current) setDeleteTarget(null); }} />
    </div>
  );
}
