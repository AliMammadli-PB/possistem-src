import { useEffect, useState } from 'react';
import { formatMoney, inventoryAccess, tillBooks, type InventoryProduct, type TillBookDevice, type TillBooks } from '../api';
import { PageHeader } from '../ui/navigation';
import { Card, DataTable, EmptyState, ErrorState } from '../ui/primitives';

const TABS = [
  ['products', 'Məhsullar'],
  ['sales', 'Satışlar'],
  ['returns', 'Qaytarmalar'],
  ['orders', 'Sifarişlər'],
  ['customers', 'Tərəf-müqabillər'],
  ['points', 'Növbə və nöqtə'],
  ['report', 'Hesabat'],
  ['suppliers', 'Təchizatçılar'],
] as const;

type Tab = (typeof TABS)[number][0];

function when(at: number) {
  if (!at) return '—';
  return new Date(at).toLocaleString('az-AZ');
}

export default function OperationsPage() {
  const [product, setProduct] = useState<InventoryProduct>('market');
  const [allowed, setAllowed] = useState<InventoryProduct[]>([]);
  const [books, setBooks] = useState<{ market: TillBooks | null; restaurant: TillBooks | null }>({ market: null, restaurant: null });
  const [devices, setDevices] = useState<Record<InventoryProduct, TillBookDevice[]>>({ market: [], restaurant: [] });
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [tab, setTab] = useState<Tab>('products');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void Promise.all([tillBooks('emeliyyat'), inventoryAccess().catch(() => ({ products: ['market', 'restaurant'] as InventoryProduct[] }))])
      .then(([row, access]) => {
        if (!alive) return;
        setBooks({ market: row.market.books, restaurant: row.restaurant.books });
        setDevices({ market: row.market.devices, restaurant: row.restaurant.devices });
        setAllowed(access.products.length ? access.products : (['market', 'restaurant'] as InventoryProduct[]).filter((key) => Boolean(row[key].books || row[key].devices.length)));
        const only = access.products.length === 1 ? access.products[0] : null;
        setProduct(only ?? (!row.market.books && row.restaurant.books ? 'restaurant' : 'market'));
      })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Yüklənmədi'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <p>Yüklənir…</p>;
  if (error) return <ErrorState title={error.toLowerCase().includes('icazə') ? 'Buna icazəniz yoxdur' : 'Siyahı açılmadı'} description={error} />;
  const productDevices = devices[product];
  const row = (productDevices.length ? (productDevices.find((item) => item.deviceId === selectedDeviceId) ?? productDevices[0]).books : books[product]) ?? {};
  const sales = row.sales ?? [];
  const empty = <EmptyState title="Hələ sətir yoxdur" description="Kassa onlayn olanda siyahı burada görünəcək." />;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Kassa"
        title="Satış və hesabat"
        description="Akul-da bu hesabın açdığı siyahılar. Rəqəmlər kassanın son şəklinə əsaslanır."
      />
      {allowed.length > 1 ? (
        <div className="segmented" role="tablist">
          <button type="button" aria-selected={product === 'market'} onClick={() => setProduct('market')}>Market POS</button>
          <button type="button" aria-selected={product === 'restaurant'} onClick={() => setProduct('restaurant')}>Restoran POS</button>
        </div>
      ) : <p>{product === 'market' ? 'Market POS' : 'Restoran POS'}</p>}
      {productDevices.length > 1 ? (
        <label>POS cihazı <select value={productDevices.some((item) => item.deviceId === selectedDeviceId) ? selectedDeviceId : productDevices[0].deviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
          {productDevices.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.deviceName}</option>)}
        </select></label>
      ) : null}
      <div className="segmented" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <Card>
        {tab === 'products' && (
          <DataTable caption="Məhsullar" rows={row.products ?? []} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'name', label: 'Ad', render: (item) => item.name },
            { key: 'qty', label: 'Qalıq / satılan', render: (item) => String(item.qty) },
            { key: 'price', label: 'Qiymət', render: (item) => formatMoney(item.price) },
          ]} />
        )}
        {tab === 'sales' && (
          <DataTable caption="Satışlar" rows={sales.filter((item) => !item.refunded)} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'no', label: 'Nömrə', render: (item) => item.no },
            { key: 'total', label: 'Məbləğ', render: (item) => formatMoney(item.total) },
            { key: 'at', label: 'Vaxt', render: (item) => when(item.at) },
          ]} />
        )}
        {tab === 'returns' && (
          <DataTable caption="Qaytarmalar" rows={sales.filter((item) => item.refunded)} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'no', label: 'Nömrə', render: (item) => item.no },
            { key: 'total', label: 'Məbləğ', render: (item) => formatMoney(item.total) },
            { key: 'at', label: 'Vaxt', render: (item) => when(item.at) },
          ]} />
        )}
        {tab === 'orders' && (
          <DataTable caption="Sifarişlər" rows={row.orders ?? []} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'label', label: 'Ad', render: (item) => item.label },
            { key: 'lines', label: 'Sətir', render: (item) => String(item.lines) },
            { key: 'at', label: 'Vaxt', render: (item) => when(item.at) },
          ]} />
        )}
        {tab === 'customers' && (
          <DataTable caption="Tərəf-müqabillər" rows={row.customers ?? []} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'name', label: 'Ad', render: (item) => item.name },
          ]} />
        )}
        {tab === 'points' && (
          <DataTable caption="Növbə və satış nöqtəsi" rows={row.points ?? []} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'name', label: 'Ad', render: (item) => item.name },
            { key: 'status', label: 'Vəziyyət', render: (item) => item.status },
          ]} />
        )}
        {tab === 'report' && (
          <div className="page-stack">
            <p>Gündəlik satış {formatMoney(row.daily?.sales ?? 0)} · {row.daily?.count ?? 0} əməliyyat</p>
            <p>Nağd {formatMoney(row.daily?.cash ?? 0)} · Kart {formatMoney(row.daily?.card ?? 0)}</p>
            <p>Mənfəət {formatMoney(row.daily?.profit ?? 0)}</p>
            <DataTable caption="Dövriyyə" rows={row.turnover ?? []} getRowKey={(item) => item.name} empty={empty} columns={[
              { key: 'name', label: 'Məhsul', render: (item) => item.name },
              { key: 'qty', label: 'Miqdar', render: (item) => String(item.qty) },
              { key: 'total', label: 'Məbləğ', render: (item) => formatMoney(item.total) },
            ]} />
          </div>
        )}
        {tab === 'suppliers' && (
          <DataTable caption="Təchizatçılar" rows={row.suppliers ?? []} getRowKey={(item) => item.id} empty={empty} columns={[
            { key: 'name', label: 'Ad', render: (item) => item.name },
            { key: 'status', label: 'Vəziyyət', render: (item) => item.status },
            { key: 'lines', label: 'Sətir', render: (item) => String(item.lines) },
          ]} />
        )}
      </Card>
    </div>
  );
}
