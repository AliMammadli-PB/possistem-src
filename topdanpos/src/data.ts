import type { PersistedState, Product, PurchaseOrder, Register, Sale, StaffProfile, Warehouse } from './types';

const now = Date.now();

export const demoStaff: StaffProfile[] = [
  { id: 'u-manager', name: 'Topdan POS Müdir', role: 'manager', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
  { id: 'u-head', name: 'Topdan POS Baş kassir', role: 'head_cashier', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-sales'] },
  { id: 'u-cashier', name: 'Topdan POS Kassir', role: 'cashier', active: true, registerIds: ['reg-2'], warehouseIds: ['wh-sales'] },
  { id: 'u-warehouse', name: 'Topdan POS Anbar', role: 'warehouse', active: true, registerIds: [], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
];

export const initialWarehouses: Warehouse[] = [
  { id: 'wh-main', code: 'ANB-01', name: 'Əsas anbar', address: 'Qəbul, saxlama və yükləmə', manager: 'Topdan POS Anbar', active: true },
  { id: 'wh-cold', code: 'SOY-01', name: 'Soyuq anbar', address: '0-6 °C · süd, ət, dondurulmuş', manager: 'Topdan POS Anbar', active: true },
  { id: 'wh-sales', code: 'SAT-01', name: 'Satış anbarı', address: 'Sifarişlərin yığıldığı və təhvil verildiyi yer', manager: 'Topdan POS Baş kassir', active: true },
];

export const initialRegisters: Register[] = [
  { id: 'reg-1', code: 'KASSA-01', name: 'Kassa 1', location: 'Əsas giriş', status: 'open', operatorId: 'u-head', openingFloatMinor: 15000, openedAt: now - 3 * 60 * 60 * 1000 },
  { id: 'reg-2', code: 'KASSA-02', name: 'Kassa 2', location: 'Sifariş masası', status: 'open', operatorId: 'u-cashier', openingFloatMinor: 10000, openedAt: now - 2 * 60 * 60 * 1000 },
  { id: 'reg-3', code: 'KASSA-03', name: 'Kassa 3', location: 'Yükləmə rampası', status: 'closed', openingFloatMinor: 0 },
];

// A wholesale warehouse starts empty: goods are created in stock (Mallar) with
// their packing and three price levels, and are sold once they have stock.
export const initialProducts: Product[] = [];
export const initialPurchaseOrders: PurchaseOrder[] = [];
export const initialSales: Sale[] = [];

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
    detail: 'Topdan POS hazırdır',
  }],
  settings: {
    storeName: 'Topdan',
    legalName: 'Topdan MMC',
    taxId: '1401234561',
    phone: '+994 50 555 00 00',
    address: 'Bakı',
    terminalName: 'TOPDANPOS-01',
    defaultWarehouseId: 'wh-main',
    defaultRegisterId: 'reg-2',
    syncUrl: 'https://possistem.az/topdanpos',
  },
  syncQueue: 0,
});
