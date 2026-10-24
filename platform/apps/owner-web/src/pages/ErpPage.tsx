import {useAuth} from '../auth/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  customerAccess,
  posPortfolio,
  ownerProductLabels,
  type OwnerProduct,
  formatMoney,
  inventoryAccess,
  inventoryCommand,
  inventoryCommands,
  inventorySnapshot,
  tillBooks,
  type InventoryLine,
  type InventoryCommandStatus,
  type InventoryProduct,
  type TillBookDevice,
  type TillBooks,
} from '../api';
import { ConfirmDialog } from '../ui/overlays';
import { erpItem } from '../erp-menu';
import { PageHeader } from '../ui/navigation';
import { exportCsv } from '../ui/export-csv';
import { Alert, Button, Card, DataTable, EmptyState, ErrorState, LinkButton } from '../ui/primitives';

function when(at: number) {
  if (!at) return '—';
  return new Date(at).toLocaleString('az-AZ');
}

function printDocument(row: InventoryCommandStatus) {
  const popup = window.open('', '_blank');
  if (!popup) return;
  const details = [
    `Sənəd №: ${row.id}`, `Əməliyyat: ${row.kind}`,
    `Tarix: ${new Date(row.created_at).toLocaleString('az-AZ')}`,
    `Vəziyyət: ${row.status}`, `Məhsul: ${row.body.productId ?? row.body.ingredientId ?? '—'}`,
    `Miqdar: ${row.body.qtyMilli ?? row.body.qty ?? '—'}`,
    `Anbar: ${row.body.warehouseId ?? row.body.fromWarehouseId ?? '—'}`,
    `Səbəb: ${row.error_reason ?? row.body.reason ?? '—'}`,
  ];
  const sheet = popup.document.createElement('pre');
  sheet.textContent = details.join('\n');
  sheet.style.cssText = 'font:16px/1.7 sans-serif;white-space:pre-wrap;padding:24px';
  popup.document.body.appendChild(sheet);
  popup.print();
}

export default function ErpPage() {
  const {selectedProduct,availableProducts}=useAuth();
  const preferred:InventoryProduct=selectedProduct==='restaurant'?'restaurant':'market';
  const [portfolio,setPortfolio]=useState<Array<{deviceId:string;product:OwnerProduct}>|null>(null);
  useEffect(()=>{let live=true;void posPortfolio().then(r=>{if(live)setPortfolio(r.devices);}).catch(cause=>{if(live){setPortfolio([]);setError(cause instanceof Error?cause.message:'POS siyahısı alınmadı');}});return()=>{live=false;};},[]);
  const marketProduct:OwnerProduct=selectedProduct&&selectedProduct!=='restaurant'?selectedProduct:'market';
  const marketLabel=ownerProductLabels[marketProduct];
  const familyProducts=availableProducts.filter(p=>p!=='restaurant');
  const legacyFamilySafe=familyProducts.length===1&&familyProducts[0]===marketProduct;
  const deviceAllowed=(id:string|undefined)=>product==='restaurant'||(!id&&legacyFamilySafe)||Boolean(id&&portfolio?.some(d=>d.deviceId===id&&d.product===marketProduct));
  const { key } = useParams();
  const item = erpItem(key);
  const [product, setProduct] = useState<InventoryProduct>('market');
  const [allowed, setAllowed] = useState<InventoryProduct[]>([]);
  const [stockProducts, setStockProducts] = useState<InventoryProduct[]>([]);
  const [cost, setCost] = useState<Record<InventoryProduct, boolean>>({ market: false, restaurant: false });
  const [bookPack, setBookPack] = useState<Record<InventoryProduct, TillBooks | null>>({ market: null, restaurant: null });
  const [bookDevices, setBookDevices] = useState<Record<InventoryProduct, TillBookDevice[]>>({ market: [], restaurant: [] });
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [stock, setStock] = useState<Record<InventoryProduct, InventoryLine[]>>({ market: [], restaurant: [] });
  const [documents, setDocuments] = useState<Record<InventoryProduct, InventoryCommandStatus[]>>({ market: [], restaurant: [] });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [cashCommands, setCashCommands] = useState<Record<InventoryProduct, InventoryCommandStatus[]>>({ market: [], restaurant: [] });
  const [cashAmount, setCashAmount] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [cashRegisterId, setCashRegisterId] = useState('');
  const [paymentPartyType, setPaymentPartyType] = useState<'customer' | 'supplier'>('customer');
  const [paymentPartyId, setPaymentPartyId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseWarehouse, setPurchaseWarehouse] = useState('');
  const [purchaseProduct, setPurchaseProduct] = useState('');
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseCost, setPurchaseCost] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteArea, setDeleteArea] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryLine | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);
  const [actionError, setActionError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const archived = useRef(new Set<string>());
  const rowKey = (row: InventoryLine) => `${row.deviceId || ''}:${row.id}`;
  const refreshStock = async () => {
    if (!item) return;
    setRefreshing(true); setActionError('');
    try {
      const snapshot = await inventorySnapshot(product, item.key);
      setStock((current) => ({ ...current, [product]: (snapshot.snapshot.lines ?? []).filter((row) => !archived.current.has(rowKey(row))) }));
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Siyahı yenilənmədi'); }
    finally { setRefreshing(false); }
  };
  const removeIngredient = async () => {
    if (!deleteTarget?.deviceId || !deleteArea || deleteLock.current) return;
    deleteLock.current = true; setDeleting(true); setActionError(''); setNotice('');
    const target = deleteTarget;
    try {
      await inventoryCommand('restaurant', 'product.deactivate', {
        productId: target.id, deviceId: target.deviceId, area: deleteArea,
      });
      archived.current.add(rowKey(target));
      setStock((current) => ({ ...current, restaurant: current.restaurant.filter((row) => rowKey(row) !== rowKey(target)) }));
      setDeleteTarget(null);
      setNotice(`“${target.name}” silinməsi kassaya göndərildi: kassa onlayndırsa bir neçə saniyəyə, oflayndırsa açılanda silinəcək. Keçmiş hərəkətlər saxlanılır.`);
    } catch (cause) {
      setDeleteTarget(null);
      setActionError(cause instanceof Error ? cause.message : 'Məhsul silinmədi');
    } finally { deleteLock.current = false; setDeleting(false); }
  };


  useEffect(() => {
    if (!item) return;
    let alive = true;
    setLoading(true);
    setDenied(false);
    setError(''); setActionError(''); setNotice(''); setDeleteTarget(null);
    void customerAccess()
      .then(async (access) => {
        if (!alive) return;
        if (access.portal != null && !access.portal.includes(item.key)) {
          setDenied(true);
          return;
        }
        setCanWrite(access.portal == null || access.portal.includes(`${item.key}.write`));
        setDeleteArea(access.portal == null || access.portal.includes('product.write') ? 'product' : access.portal.includes('anbar.write') ? 'anbar' : null);
        const license = await inventoryAccess().catch(() => ({
          products: ['market', 'restaurant'] as InventoryProduct[],
          catalogProducts: [] as InventoryProduct[],
          cost: { market: false, restaurant: false },
        }));
        if (!alive) return;
        // A restaurant sold the menu but not the stock module still has cards
        // to keep; listing only the stock products left its Anbar blank.
        const carried = [...new Set([...license.products, ...(license.catalogProducts ?? [])])];
        setAllowed(carried);
        setStockProducts(license.products);
        setCost(license.cost ?? { market: false, restaurant: false });
        const only = carried.length === 1 ? carried[0] : null;
        if (item.source === 'documents') {
          const [market, restaurant] = await Promise.all([
            inventoryCommands('market', item.key).catch(() => ({ commands: [] })),
            inventoryCommands('restaurant', item.key).catch(() => ({ commands: [] })),
          ]);
          if (!alive) return;
          setDocuments({ market: market.commands, restaurant: restaurant.commands });
          setProduct(only ?? (carried.includes(preferred)?preferred:market.commands.length?'market':'restaurant'));
          setBookPack({ market: null, restaurant: null });
          setBookDevices({ market: [], restaurant: [] });
          return;
        }
        if (item.source === 'stock') {
          const [market, restaurant] = await Promise.all([
            inventorySnapshot('market', item.key).catch(() => null),
            inventorySnapshot('restaurant', item.key).catch(() => null),
          ]);
          if (!alive) return;
          const marketLines = market?.snapshot.lines ?? [];
          const restaurantLines = restaurant?.snapshot.lines ?? [];
          setStock({ market: marketLines, restaurant: restaurantLines });
          setProduct(only ?? (carried.includes(preferred)?preferred:marketLines.length?'market':'restaurant'));
          setBookPack({ market: null, restaurant: null });
          setBookDevices({ market: [], restaurant: [] });
          return;
        }
        const row = await tillBooks(item.key);
        if (!alive) return;
        if (item.source === 'purchases') {
          const [marketStock, restaurantStock] = await Promise.all([
            inventorySnapshot('market', item.key).catch(() => null),
            inventorySnapshot('restaurant', item.key).catch(() => null),
          ]);
          if (!alive) return;
          setStock({ market: marketStock?.snapshot.lines ?? [], restaurant: restaurantStock?.snapshot.lines ?? [] });
          const [marketDocs, restaurantDocs] = await Promise.all([
            inventoryCommands('market', item.key).catch(() => ({ commands: [] })),
            inventoryCommands('restaurant', item.key).catch(() => ({ commands: [] })),
          ]);
          if (!alive) return;
          setCashCommands({ market: marketDocs.commands, restaurant: restaurantDocs.commands });
        }
        const bookProducts = (['market', 'restaurant'] as InventoryProduct[]).filter((key) =>
          Boolean(row[key].books || row[key].devices.length));
        setAllowed(bookProducts.length ? bookProducts : carried);
        setBookPack({ market: row.market.books, restaurant: row.restaurant.books });
        setBookDevices({ market: row.market.devices, restaurant: row.restaurant.devices });
        if (item.key === 'cashins' || item.key === 'cashouts' || item.key === 'transactions' || item.key === 'credittransaction') {
          const [marketCash, restaurantCash] = await Promise.all([
            inventoryCommands('market', item.key).catch(() => ({ commands: [] })),
            inventoryCommands('restaurant', item.key).catch(() => ({ commands: [] })),
          ]);
          if (!alive) return;
          setCashCommands({ market: marketCash.commands, restaurant: restaurantCash.commands });
        }
        setProduct(bookProducts.includes(preferred)?preferred:bookProducts.includes('market')?'market':bookProducts.includes('restaurant')?'restaurant':only??preferred);
      })
      .catch((cause) => {
        if (!alive) return;
        const message = cause instanceof Error ? cause.message : 'Yüklənmədi';
        if (message.toLowerCase().includes('icazə')) setDenied(true);
        else setError(message);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [item?.key]);

  if (!item) return <ErrorState title="Bölmə tapılmadı" description="Bu ünvan menyuda yoxdur." />;
  if (loading) return <p>İcazə yoxlanılır…</p>;
  if (denied) return <ErrorState title="Buna icazəniz yoxdur" description="Baş admin bu bölməni bağlamışdır." />;
  if (error) return <ErrorState title="Siyahı açılmadı" description={error} />;

  const allLines = stock[product].filter((row) => !archived.current.has(rowKey(row))&&deviceAllowed(row.deviceId));
  const stockDevices = [...new Map(allLines.filter((row) => row.deviceId).map((row) => [row.deviceId!, row.deviceName || row.deviceId!])).entries()];
  const lines = allLines.filter((row) => (!selectedDeviceId || row.deviceId === selectedDeviceId) &&
    `${row.name} ${row.barcode || ''} ${row.group || ''}`.toLocaleLowerCase('az').includes(query.trim().toLocaleLowerCase('az')));
  const canDelete = product === 'restaurant' && stockProducts.includes('restaurant') && Boolean(deleteArea);
  const visibleDocuments = documents[product].filter((row) => {
    if (status && row.status !== status) return false;
    const body = row.body ?? {};
    return `${row.id} ${body.productId ?? body.ingredientId ?? ''} ${body.reason ?? ''}`.toLowerCase().includes(query.toLowerCase());
  });
  const devices = bookDevices[product].filter(row=>deviceAllowed(row.deviceId));
  const books = devices.length ? (devices.find((row) => row.deviceId === selectedDeviceId) ?? devices[0]).books : product==='restaurant'||legacyFamilySafe?bookPack[product]:null;
  const empty = (
    <EmptyState
      title="Hələ sətir yoxdur"
      description="Kassa onlayn olanda siyahı burada görünəcək."
      action={item.key === 'product' && canWrite
        ? <LinkButton to="/anbar" variant="primary">Kart yarat</LinkButton>
        : undefined}
    />
  );
  const sales = (books?.sales ?? []).filter((row) => !row.refunded);
  const returns = (books?.sales ?? []).filter((row) => row.refunded);
  const createCashMovement = async () => {
    const amountMinor = Math.round(Number(cashAmount.replace(',', '.')) * 100);
    const deviceId = devices.find((row) => row.deviceId === selectedDeviceId)?.deviceId ?? devices[0]?.deviceId;
    const registerId = cashRegisterId || books?.points?.[0]?.id || '';
    try {
      const result = await inventoryCommand(product, item.key === 'cashins' ? 'cash.in' : 'cash.out', {
        amountMinor, reason: cashReason.trim(), registerId, deviceId,
      });
      setNotice(`Sənəd ${result.id ?? ''} kassanın təsdiqini gözləyir.`);
      const fresh = await inventoryCommands(product, item.key);
      setCashCommands((current) => ({ ...current, [product]: fresh.commands }));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Sənəd göndərilmədi');
    }
  };
  const createPayment = async () => {
    const amountMinor = Math.round(Number(paymentAmount.replace(',', '.')) * 100);
    const deviceId = devices.find((row) => row.deviceId === selectedDeviceId)?.deviceId ?? devices[0]?.deviceId;
    const partyType = item.key === 'credittransaction' ? 'customer' : paymentPartyType;
    const party = partyType === 'customer'
      ? books?.customers?.find((row) => row.id === paymentPartyId)
      : books?.suppliers?.find((row) => row.id === paymentPartyId);
    if (!party || !deviceId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      setNotice('Tərəf-müqabil, POS cihazı və düzgün məbləğ seçin.');
      return;
    }
    const kind = partyType === 'customer' ? 'customer.pay' : 'supplier.pay';
    const target = partyType === 'customer' ? { customerId: party.id }
      : product === 'market' ? { supplierName: party.name } : { supplierId: party.id };
    try {
      const result = await inventoryCommand(product, kind, { ...target, amountMinor, note: paymentNote.trim(), deviceId });
      setNotice(`Ödəniş ${result.id ?? ''} POS təsdiqini gözləyir.`);
      const fresh = await inventoryCommands(product, item.key);
      setCashCommands((current) => ({ ...current, [product]: fresh.commands }));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Ödəniş göndərilmədi');
    }
  };
  const createPurchaseOrder = async () => {
    const deviceId = devices.find((row) => row.deviceId === selectedDeviceId)?.deviceId ?? devices[0]?.deviceId;
    const quantity = Number(purchaseQty.replace(',', '.'));
    const costMinor = Math.round(Number(purchaseCost.replace(',', '.')) * 100);
    const stockLine = lines.find((row) => row.id === purchaseProduct && row.warehouseId === purchaseWarehouse && row.deviceId === deviceId);
    if (!deviceId || !stockLine || !purchaseSupplier.trim() || !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isSafeInteger(costMinor) || costMinor < 0) {
      setNotice('Təchizatçı, anbar, məhsul, miqdar və maya dəyərini yoxlayın.');
      return;
    }
    const units = product === 'market' ? Math.trunc(quantity) : Math.round(quantity * 1000);
    if (units <= 0 || (product === 'market' && units !== quantity)) {
      setNotice('Market üçün tam say, restoran üçün üç onluğa qədər miqdar daxil edin.');
      return;
    }
    const line = product === 'market'
      ? { productId: purchaseProduct, qty: units, unitCostMinor: costMinor }
      : { ingredientId: purchaseProduct, qtyMilli: units, unitCostMinor: costMinor };
    const supplier = product === 'market' ? { supplierName: purchaseSupplier.trim() } : { supplierId: purchaseSupplier };
    try {
      const result = await inventoryCommand(product, 'purchase.order', {
        ...supplier, warehouseId: purchaseWarehouse, lines: [line], deviceId,
      });
      setNotice(`Alış sifarişi ${result.id ?? ''} POS təsdiqini gözləyir.`);
      const fresh = await inventoryCommands(product, item.key);
      setCashCommands((current) => ({ ...current, [product]: fresh.commands }));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Sifariş göndərilmədi');
    }
  };
  const receivePurchase = async (purchaseId: string) => {
    const deviceId = devices.find((row) => row.deviceId === selectedDeviceId)?.deviceId ?? devices[0]?.deviceId;
    try {
      const result = await inventoryCommand(product, 'purchase.receive', { purchaseId, deviceId });
      setNotice(`Qəbul sənədi ${result.id ?? ''} POS təsdiqini gözləyir.`);
      const fresh = await inventoryCommands(product, item.key);
      setCashCommands((current) => ({ ...current, [product]: fresh.commands }));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Qəbul sənədi göndərilmədi');
    }
  };

  // The card form lives on /anbar; these only choose which kind it opens on.
  const newCard = item.key === 'product' && canWrite
    ? product === 'market'
      ? [['product', '+ Yeni məhsul'], ['service', '+ Yeni xidmət']]
      : [
          ['menu', '+ Yeni menyu məhsulu'],
          ...(stockProducts.includes('restaurant') ? [['ingredient', '+ Yeni xammal']] : []),
          ['menu', '+ Yeni kateqoriya'],
        ]
    : [];

  return (
    <div className="page-stack erp-workspace">
      <PageHeader
        eyebrow={item.group}
        title={item.label}
        description={item.fields}
        actions={newCard.length ? (
          <div className="button-row">
            {newCard.map(([kind, label]) => (
              <LinkButton key={label} to={`/anbar?kind=${kind}`} variant="primary">{label}</LinkButton>
            ))}
          </div>
        ) : undefined}
      />
      {notice ? <Alert tone="success" title="Tamamlandı">{notice}</Alert> : null}
      {actionError ? <Alert tone="danger" title="Əməliyyat tamamlanmadı">{actionError}</Alert> : null}
      {allowed.length > 1 ? (
        <div className="segmented" role="tablist">
          <button type="button" aria-selected={product === 'market'} onClick={() => { setProduct('market'); setSelectedDeviceId(''); setQuery(''); }}>{marketLabel}</button>
          <button type="button" aria-selected={product === 'restaurant'} onClick={() => { setProduct('restaurant'); setSelectedDeviceId(''); setQuery(''); }}>Restoran POS</button>
        </div>
      ) : <p className="erp-source">{product === 'market' ? marketLabel : 'Restoran POS'}</p>}
      {item.source === 'stock' ? <Card className="inventory-toolbar">
        <div className="inventory-heading"><div><h2>{product === 'restaurant' ? 'Restoran anbarı' : 'Məhsul siyahısı'}</h2>
          <p>{allLines.length} anbar sətri · {canDelete ? 'Silmə POS-da təsdiqlənir, keçmiş hərəkətlər saxlanır.' : 'Kassadan göndərilən anbar məlumatları.'}</p></div>
          <Button loading={refreshing} disabled={deleting} onClick={() => void refreshStock()}>Siyahını yenilə</Button></div>
        <div className="inventory-filters">
          <label>Məhsul axtar<input type="search" placeholder="Ad, barkod və ya qrup" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {stockDevices.length > 1 ? <label>POS cihazı<select aria-label="POS cihazı" value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}><option value="">Bütün cihazlar</option>
            {stockDevices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label> : null}
        </div>
      </Card> : null}
      {item.source !== 'stock' && devices.length > 1 ? (
        <label>POS cihazı <select value={devices.some((row) => row.deviceId === selectedDeviceId) ? selectedDeviceId : devices[0].deviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
          {devices.map((row) => <option key={row.deviceId} value={row.deviceId}>{row.deviceName}</option>)}
        </select></label>
      ) : null}
      {item.source === 'documents' ? (
        <div className="form-grid">
          <label>Axtarış <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Vəziyyət <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Hamısı</option><option value="pending">Gözləyir</option>
            <option value="applied">Tətbiq edildi</option><option value="rejected">Rədd edildi</option>
          </select></label>
          <Link to="/anbar">Yeni sənəd yarat</Link>
          <button type="button" onClick={() => exportCsv(`${item.key}-${product}.csv`, [
            ['Sənəd №', 'Əməliyyat', 'Məhsul', 'Miqdar', 'Vəziyyət', 'Tarix', 'Səbəb'],
            ...visibleDocuments.map((row) => [row.id, row.kind, String(row.body.productId ?? row.body.ingredientId ?? ''),
              String(row.body.qtyMilli ?? row.body.qty ?? ''), row.status, row.created_at, row.error_reason ?? '']),
          ])}>CSV ixracı</button>
        </div>
      ) : null}
      {item.source === 'cash' && (item.key === 'cashins' || item.key === 'cashouts') && canWrite ? (
        <div className="form-grid">
          <label>Məbləğ (₼) <input inputMode="decimal" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} /></label>
          <label>Səbəb <input value={cashReason} onChange={(event) => setCashReason(event.target.value)} /></label>
          {product === 'market' ? <label>Kassa <select value={cashRegisterId || books?.points?.[0]?.id || ''} onChange={(event) => setCashRegisterId(event.target.value)}>
            {(books?.points ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label> : null}
          <button type="button" disabled={!Number.isFinite(Number(cashAmount.replace(',', '.'))) || Number(cashAmount.replace(',', '.')) <= 0 || !cashReason.trim() || (product === 'market' && !(cashRegisterId || books?.points?.[0]?.id))} onClick={() => void createCashMovement()}>Sənədi göndər</button>
        </div>
      ) : null}
      {item.source === 'payments' && canWrite ? (
        <div className="form-grid">
          {item.key === 'transactions' ? <label>Tərəf <select value={paymentPartyType} onChange={(event) => { setPaymentPartyType(event.target.value as 'customer' | 'supplier'); setPaymentPartyId(''); }}>
            <option value="customer">Müştəri</option><option value="supplier">Təchizatçı</option>
          </select></label> : null}
          <label>Ad <select value={paymentPartyId} onChange={(event) => setPaymentPartyId(event.target.value)}>
            <option value="">Seçin</option>
            {(item.key === 'credittransaction' || paymentPartyType === 'customer' ? books?.customers ?? [] : books?.suppliers ?? []).map((row) =>
              <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
          <label>Məbləğ (₼) <input inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
          <label>Qeyd <input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label>
          <button type="button" disabled={!paymentPartyId || !Number.isFinite(Number(paymentAmount.replace(',', '.'))) || Number(paymentAmount.replace(',', '.')) <= 0} onClick={() => void createPayment()}>Ödənişi göndər</button>
        </div>
      ) : null}
      {item.source === 'purchases' && item.key === 'purchaseorder' && canWrite ? (
        <div className="form-grid">
          <label>Təchizatçı {product === 'market'
            ? <input value={purchaseSupplier} onChange={(event) => setPurchaseSupplier(event.target.value)} />
            : <select value={purchaseSupplier} onChange={(event) => setPurchaseSupplier(event.target.value)}><option value="">Seçin</option>{(books?.suppliers ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>}</label>
          <label>Anbar <select value={purchaseWarehouse} onChange={(event) => { setPurchaseWarehouse(event.target.value); setPurchaseProduct(''); }}>
            <option value="">Seçin</option>{[...new Map(lines.filter((row) => !selectedDeviceId || row.deviceId === selectedDeviceId).map((row) => [row.warehouseId, row.warehouseName])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
          <label>Məhsul <select value={purchaseProduct} onChange={(event) => setPurchaseProduct(event.target.value)}><option value="">Seçin</option>
            {lines.filter((row) => row.warehouseId === purchaseWarehouse && (!selectedDeviceId || row.deviceId === selectedDeviceId)).map((row) => <option key={`${row.deviceId}-${row.id}`} value={row.id}>{row.name}</option>)}
          </select></label>
          <label>Miqdar <input inputMode="decimal" value={purchaseQty} onChange={(event) => setPurchaseQty(event.target.value)} /></label>
          <label>Vahid maya (₼) <input inputMode="decimal" value={purchaseCost} onChange={(event) => setPurchaseCost(event.target.value)} /></label>
          <button type="button" disabled={!purchaseSupplier.trim() || !purchaseWarehouse || !purchaseProduct || !purchaseQty || !purchaseCost} onClick={() => void createPurchaseOrder()}>Alış sifarişini göndər</button>
        </div>
      ) : null}
      <Card>
        {item.source === 'documents' && (
          <DataTable caption={item.label} rows={visibleDocuments} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'no', label: 'Sənəd №', render: (row) => row.id.slice(0, 8) },
            { key: 'item', label: 'Məhsul', render: (row) => String(row.body.productId ?? row.body.ingredientId ?? '—') },
            { key: 'qty', label: 'Miqdar', render: (row) => String(row.body.qtyMilli ?? row.body.qty ?? '—') },
            { key: 'status', label: 'Vəziyyət', render: (row) => row.status === 'pending' ? 'Gözləyir' : row.status === 'applied' ? 'Tətbiq edildi' : 'Rədd edildi' },
            { key: 'date', label: 'Tarix', render: (row) => new Date(row.created_at).toLocaleString('az-AZ') },
            { key: 'reason', label: 'Səbəb', render: (row) => row.error_reason || '—' },
            { key: 'print', label: 'Çap', render: (row) => <button type="button" onClick={() => printDocument(row)}>Qaimə</button> },
          ]} />
        )}
        {item.source === 'stock' && (
          <DataTable caption={item.label} rows={lines} getRowKey={(row) => `${row.deviceId || ''}-${row.warehouseId}-${row.id}`} empty={empty} columns={[
            { key: 'name', label: 'Məhsul', render: (row) => <><strong>{row.name}</strong><small>{[row.barcode, row.group].filter(Boolean).join(' · ') || '—'}</small></> },
            { key: 'warehouse', label: 'Anbar / POS', render: (row) => <><strong>{row.warehouseName || '—'}</strong><small>{row.deviceName || '—'}</small></> },
            { key: 'qty', label: 'Anbar qalığı', render: (row) => `${(product === 'restaurant' ? row.qty / 1000 : row.qty).toLocaleString('az-AZ', { maximumFractionDigits: 3 })} ${row.unit || 'ədəd'}` },
            { key: 'min', label: 'Min. qalıq', render: (row) => (row.minQty ? (product === 'restaurant' ? row.minQty / 1000 : row.minQty).toLocaleString('az-AZ', { maximumFractionDigits: 3 }) : '—') },
            { key: 'price', label: 'Satış qiyməti', render: (row) => formatMoney(row.salePrice) },
            ...(cost[product] ? [{ key: 'cost', label: 'Maya', render: (row: InventoryLine) => formatMoney(row.costPrice ?? 0) }] : []),
            ...(canDelete ? [{ key: 'actions', label: 'Əməliyyat', render: (row: InventoryLine) => <Button variant="danger" disabled={deleting || !row.deviceId} aria-label={`${row.name} məhsulunu sil`} title={!row.deviceId ? 'POS cihazını tanımaq üçün kassanı sinxronlaşdırın' : 'Keçmiş hərəkətlər saxlanılır'} onClick={() => setDeleteTarget(row)}>Sil</Button> }] : []),
          ]} />
        )}
        {item.source === 'sales' && (
          <DataTable caption={item.label} rows={sales} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'no', label: 'Satış №', render: (row) => row.no },
            { key: 'total', label: 'Məbləğ', render: (row) => formatMoney(row.total) },
            { key: 'at', label: 'Tarix', render: (row) => when(row.at) },
            { key: 'status', label: 'Status', render: () => 'Satış' },
          ]} />
        )}
        {item.source === 'returns' && (
          <DataTable caption={item.label} rows={returns} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'no', label: 'Nömrə', render: (row) => row.no },
            { key: 'total', label: 'Məbləğ', render: (row) => formatMoney(row.total) },
            { key: 'at', label: 'Tarix', render: (row) => when(row.at) },
          ]} />
        )}
        {item.source === 'orders' && (
          <DataTable caption={item.label} rows={books?.orders ?? []} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'label', label: 'Sifariş', render: (row) => row.label },
            { key: 'lines', label: 'Sətir', render: (row) => String(row.lines) },
            { key: 'at', label: 'Tarix', render: (row) => when(row.at) },
          ]} />
        )}
        {item.source === 'customers' && (
          <DataTable caption={item.label} rows={books?.customers ?? []} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'name', label: 'Ad', render: (row) => row.name },
          ]} />
        )}
        {item.source === 'points' && (
          <DataTable caption={item.label} rows={books?.points ?? []} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'name', label: 'Satış nöqtəsi', render: (row) => row.name },
            { key: 'status', label: 'Vəziyyət', render: (row) => row.status },
          ]} />
        )}
        {item.source === 'suppliers' && (
          <DataTable caption={item.label} rows={books?.suppliers ?? []} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'name', label: 'Təchizatçı', render: (row) => row.name },
            { key: 'status', label: 'Status', render: (row) => row.status || '—' },
            { key: 'due', label: 'Borc', render: (row) => row.dueMinor == null ? '—' : formatMoney(row.dueMinor) },
          ]} />
        )}
        {item.source === 'purchases' && (
          <><DataTable caption={item.label} rows={books?.purchases ?? []} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'no', label: 'Alış №', render: (row) => row.number || row.id },
            { key: 'supplier', label: 'Təchizatçı', render: (row) => row.supplierName },
            { key: 'status', label: 'Vəziyyət', render: (row) => row.status },
            { key: 'total', label: 'Məbləğ', render: (row) => formatMoney(row.totalMinor) },
            { key: 'at', label: 'Tarix', render: (row) => when(row.createdAt) },
            ...(item.key === 'supply' && canWrite ? [{ key: 'receive', label: 'Qəbul', render: (row: NonNullable<TillBooks['purchases']>[number]) => row.status === 'received' ? 'Qəbul edildi' : <button type="button" onClick={() => void receivePurchase(row.id)}>Qəbul et</button> }] : []),
          ]} />
          <DataTable caption="Portal alış sənədləri" rows={cashCommands[product]} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'no', label: 'Sənəd №', render: (row) => row.id.slice(0, 8) },
            { key: 'kind', label: 'Əməliyyat', render: (row) => row.kind === 'purchase.order' ? 'Sifariş' : 'Qəbul' },
            { key: 'status', label: 'Vəziyyət', render: (row) => row.status === 'pending' ? 'Gözləyir' : row.status === 'applied' ? 'Tətbiq edildi' : 'Rədd edildi' },
            { key: 'reason', label: 'Səbəb', render: (row) => row.error_reason || '—' },
          ]} /></>
        )}
        {item.source === 'debts' && (
          <>
            <DataTable caption="Müştəri borcları" rows={(books?.customers ?? []).filter((row) => (row.debtMinor ?? 0) !== 0)} getRowKey={(row) => row.id} empty={empty} columns={[
              { key: 'name', label: 'Müştəri', render: (row) => row.name },
              { key: 'amount', label: 'Borc', render: (row) => formatMoney(row.debtMinor ?? 0) },
            ]} />
            <DataTable caption="Təchizatçı borcları" rows={(books?.suppliers ?? []).filter((row) => (row.dueMinor ?? 0) !== 0)} getRowKey={(row) => row.id} empty={empty} columns={[
              { key: 'name', label: 'Təchizatçı', render: (row) => row.name },
              { key: 'amount', label: 'Borc', render: (row) => formatMoney(row.dueMinor ?? 0) },
            ]} />
          </>
        )}
        {item.source === 'cash' && (
          <><DataTable caption={item.label} rows={(books?.cashMovements ?? []).filter((row) =>
            item.key === 'cashins' ? row.kind === 'cash_in' : item.key === 'cashouts' ? row.kind === 'cash_out' || row.kind === 'expense' : true)}
            getRowKey={(row) => row.id} empty={empty} columns={[
              { key: 'kind', label: 'Növ', render: (row) => row.kind },
              { key: 'amount', label: 'Məbləğ', render: (row) => formatMoney(row.amountMinor) },
              { key: 'reason', label: 'Səbəb', render: (row) => row.reason || '—' },
              { key: 'at', label: 'Tarix', render: (row) => when(row.createdAt) },
            ]} />
            {(item.key === 'cashins' || item.key === 'cashouts') ? (
              <DataTable caption="Portal sənədləri" rows={cashCommands[product]} getRowKey={(row) => row.id} empty={empty} columns={[
                { key: 'id', label: 'Sənəd №', render: (row) => row.id.slice(0, 8) },
                { key: 'amount', label: 'Məbləğ', render: (row) => formatMoney(Number(row.body.amountMinor) || 0) },
                { key: 'status', label: 'Vəziyyət', render: (row) => row.status === 'pending' ? 'Gözləyir' : row.status === 'applied' ? 'Tətbiq edildi' : 'Rədd edildi' },
                { key: 'reason', label: 'Səbəb', render: (row) => row.error_reason || String(row.body.reason || '—') },
              ]} />
            ) : null}</>
        )}
        {item.source === 'payments' && (
          <><DataTable caption="POS ödəniş jurnalı" rows={(books?.payments ?? []).filter((row) => item.key !== 'credittransaction' || row.partyType === 'customer')} getRowKey={(row) => `${row.partyType}-${row.id}`} empty={empty} columns={[
            { key: 'party', label: 'Tərəf-müqabil', render: (row) => row.partyName },
            { key: 'type', label: 'Növ', render: (row) => row.partyType === 'customer' ? 'Müştəri' : 'Təchizatçı' },
            { key: 'amount', label: 'Məbləğ', render: (row) => formatMoney(row.amountMinor) },
            { key: 'note', label: 'Qeyd', render: (row) => row.note || '—' },
            { key: 'at', label: 'Tarix', render: (row) => when(row.createdAt) },
          ]} />
          <DataTable caption="Portal ödəniş sənədləri" rows={cashCommands[product]} getRowKey={(row) => row.id} empty={empty} columns={[
            { key: 'id', label: 'Sənəd №', render: (row) => row.id.slice(0, 8) },
            { key: 'kind', label: 'Növ', render: (row) => row.kind === 'customer.pay' ? 'Müştəri' : 'Təchizatçı' },
            { key: 'amount', label: 'Məbləğ', render: (row) => formatMoney(Number(row.body.amountMinor) || 0) },
            { key: 'status', label: 'Vəziyyət', render: (row) => row.status === 'pending' ? 'Gözləyir' : row.status === 'applied' ? 'Tətbiq edildi' : 'Rədd edildi' },
            { key: 'reason', label: 'Səbəb', render: (row) => row.error_reason || '—' },
          ]} /></>
        )}
        {item.source === 'transfers' && (
          <EmptyState title="Sənəd yoxdur" description="POS bu bölmə üçün ayrıca jurnal göndərəndə burada görünəcək." />
        )}
        {item.source === 'turnover' && (
          <DataTable caption={item.label} rows={books?.turnover ?? []} getRowKey={(row) => row.name} empty={empty} columns={[
            { key: 'name', label: 'Məhsul', render: (row) => row.name },
            { key: 'qty', label: 'Miqdar', render: (row) => String(row.qty) },
            { key: 'total', label: 'Məbləğ', render: (row) => formatMoney(row.total) },
          ]} />
        )}
        {item.source === 'daily' && (
          <div className="erp-cards">
            <article><span>Satış</span><strong>{formatMoney(books?.daily?.sales ?? 0)}</strong></article>
            <article><span>Nağd</span><strong>{formatMoney(books?.daily?.cash ?? 0)}</strong></article>
            <article><span>Kart</span><strong>{formatMoney(books?.daily?.card ?? 0)}</strong></article>
            <article><span>Əməliyyat</span><strong>{books?.daily?.count ?? 0}</strong></article>
            <article><span>Mənfəət</span><strong>{formatMoney(books?.daily?.profit ?? 0)}</strong></article>
          </div>
        )}
      </Card>
      <ConfirmDialog open={Boolean(deleteTarget)} title="Məhsul anbardan silinsin?"
        description={deleteTarget ? `“${deleteTarget.name}” bütün anbarlarda aktiv siyahıdan çıxarılacaq. Keçmiş hərəkətlər saxlanılacaq. Reseptdə istifadə olunursa, resepti də yeniləyin.` : ''}
        confirmLabel="Bəli, sil" danger busy={deleting}
        onConfirm={() => void removeIngredient()} onClose={() => { if (!deleteLock.current) setDeleteTarget(null); }} />
    </div>
  );
}
