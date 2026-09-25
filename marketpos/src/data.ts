import { aisleFromWolt } from './catalogCategories';
import type { PersistedState, Product, PurchaseOrder, Register, Sale, StaffProfile, Warehouse } from './types';
import woltCatalogReference from './wolt-catalog-reference.json';

const now = Date.now();

export const demoStaff: StaffProfile[] = [
  { id: 'u-manager', name: 'MarketPos Müdir', role: 'manager', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
  { id: 'u-head', name: 'MarketPos Baş kassir', role: 'head_cashier', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-sales'] },
  { id: 'u-cashier', name: 'MarketPos Kassir', role: 'cashier', active: true, registerIds: ['reg-2'], warehouseIds: ['wh-sales'] },
  { id: 'u-warehouse', name: 'MarketPos Anbar', role: 'warehouse', active: true, registerIds: [], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
];

export const initialWarehouses: Warehouse[] = [
  { id: 'wh-main', code: 'DEP-01', name: 'Mərkəzi depo', address: 'Bakı · əsas təchizat deposu', manager: 'MarketPos Anbar', active: true },
  { id: 'wh-cold', code: 'SOY-01', name: 'Soyuducu anbar', address: 'Mağaza arxası · -2°C / +4°C', manager: 'MarketPos Anbar', active: true },
  { id: 'wh-sales', code: 'ZAL-01', name: 'Satış zalı', address: 'Rəf və kassalar', manager: 'MarketPos Baş kassir', active: true },
];

export const initialRegisters: Register[] = [
  { id: 'reg-1', code: 'KASSA-01', name: 'Kassa 1', location: 'Əsas giriş', status: 'open', operatorId: 'u-head', openingFloatMinor: 15000, openedAt: now - 3 * 60 * 60 * 1000 },
  { id: 'reg-2', code: 'KASSA-02', name: 'Kassa 2', location: 'Sağ sıra', status: 'open', operatorId: 'u-cashier', openingFloatMinor: 10000, openedAt: now - 2 * 60 * 60 * 1000 },
  { id: 'reg-3', code: 'KASSA-03', name: 'Kassa 3', location: 'Ekspress · 10 məhsul', status: 'closed', openingFloatMinor: 0 },
];

type WoltRef = {
  woltId?: string;
  category?: string;
  posCategory?: string;
  name: string;
  priceMinor: number;
  barcode?: string;
  unit?: string;
  imageUrl?: string;
  assetPath?: string;
};

const accents = ['#5fc6a5', '#86c66c', '#f1a95b', '#8b73d1', '#4da8cf', '#ee6d68', '#e9b640', '#4db7a8'];

const catalog = woltCatalogReference as WoltRef[];

const usedBarcodes = new Set<string>();

function barcodeFor(ref: WoltRef, index: number): string {
  const raw = String(ref.barcode || '').replace(/\D/g, '');
  let candidate = raw.length >= 8 ? raw : `47699${String(index + 1).padStart(8, '0')}`;
  if (usedBarcodes.has(candidate)) candidate = `${candidate}${String(index + 1).padStart(3, '0')}`.slice(0, 18);
  usedBarcodes.add(candidate);
  return candidate;
}

export const initialProducts: Product[] = catalog.map((ref, index) => {
  const id = `p-wolt-${String(index + 1).padStart(4, '0')}`;
  const sku = `W-${String(index + 1).padStart(4, '0')}`;
  const name = ref.name || `Məhsul ${index + 1}`;
  const category = aisleFromWolt(ref.category, ref.posCategory);
  const unit = ref.unit || 'əd';
  const priceMinor = Math.max(1, Number(ref.priceMinor) || 1);
  // Default images are local WebP assets bundled with the app (offline-first).
  const imageUrl = ref.assetPath || '';
  const cold = category === 'Süd' || category === 'Səhər yeməyi' || category === 'Dəniz məhsulları' || category === 'Ət-toyuq' || category === 'Dondurulmuş'
    || /dondurul|ət |et |toyuq|balıq/i.test(ref.category || '');
  return {
    id,
    sku,
    barcode: barcodeFor(ref, index),
    name: { az: name, ru: name, en: name },
    category,
    unit,
    priceMinor,
    costMinor: Math.max(1, Math.round(priceMinor * 0.68)),
    minStock: unit === 'kq' ? 8 : 12,
    taxRate: 18,
    supplier: 'Bravo · Wolt',
    warehouseStock: {
      'wh-main': 20 + (index * 7) % 80,
      'wh-cold': cold ? 10 + (index % 25) : 0,
      'wh-sales': 6 + (index * 5) % 40,
    },
    accent: accents[index % accents.length] ?? '#2563eb',
    image: imageUrl ? { kind: 'url', url: imageUrl } : { kind: 'url', url: '' },
    active: true,
    createdAt: now - 30 * 86400000,
  };
});

export const initialPurchaseOrders: PurchaseOrder[] = initialProducts.slice(0, 2).map((product, index) => ({
  id: `PO-WOLT-0${index + 1}`,
  supplier: 'Bravo · Wolt',
  expectedAt: '2026-09-15',
  createdAt: now - (index + 1) * 86400000,
  createdBy: index === 0 ? 'u-warehouse' : 'u-manager',
  warehouseId: index === 0 ? 'wh-cold' : 'wh-main',
  status: 'ordered' as const,
  lines: [{ productId: product.id, qty: 12 + index * 6, costMinor: product.costMinor }],
}));

export const initialSales: Sale[] = [
  {
    id: 'sale-demo-1',
    receiptNo: 'M-260912-0001',
    createdAt: now - 42 * 60000,
    items: initialProducts.slice(0, 3).map((product, index) => ({ productId: product.id, qty: index === 0 ? 2 : 1 })),
    subtotalMinor: initialProducts.slice(0, 3).reduce((sum, product, index) => sum + product.priceMinor * (index === 0 ? 2 : 1), 0),
    discountMinor: 0,
    totalMinor: initialProducts.slice(0, 3).reduce((sum, product, index) => sum + product.priceMinor * (index === 0 ? 2 : 1), 0),
    payment: { method: 'cash' as const, amountMinor: 0, tenderedMinor: 0, changeMinor: 0 },
    refunded: false,
    cashierId: 'u-cashier',
    registerId: 'reg-2',
  },
].map((sale) => ({
  ...sale,
  payment: {
    ...sale.payment,
    amountMinor: sale.totalMinor,
    tenderedMinor: sale.totalMinor + 200,
    changeMinor: 200,
  },
}));

export const createInitialState = (): PersistedState => ({
  schemaVersion: 5,
  products: initialProducts,
  sales: initialSales,
  purchaseOrders: initialPurchaseOrders,
  warehouses: initialWarehouses,
  registers: initialRegisters,
  heldCarts: [],
  audits: [{
    id: 'audit-start',
    createdAt: now,
    actorId: 'system',
    action: 'SYSTEM_READY',
    detail: `MarketPos · Bravo Narimanov Azinko · ${initialProducts.length} məhsul`,
  }],
  settings: {
    storeName: 'MarketPos Supermarket',
    legalName: 'MarketPos Retail MMC',
    taxId: '1401234561',
    phone: '+994 50 555 00 00',
    address: 'Bakı · Nərimanov · Azinko',
    terminalName: 'MARKETPOS-01',
    defaultWarehouseId: 'wh-sales',
    defaultRegisterId: 'reg-2',
    syncUrl: 'https://possistem.az/marketpos',
  },
  syncQueue: 0,
});
