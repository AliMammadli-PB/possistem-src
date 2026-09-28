import type { PersistedState, Product, PurchaseOrder, Register, Sale, StaffProfile, Warehouse } from './types';

const now = Date.now();

export const demoStaff: StaffProfile[] = [
  { id: 'u-manager', name: 'Aptek POS Müdir', role: 'manager', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
  { id: 'u-head', name: 'Aptek POS Baş kassir', role: 'head_cashier', active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-sales'] },
  { id: 'u-cashier', name: 'Aptek POS Kassir', role: 'cashier', active: true, registerIds: ['reg-2'], warehouseIds: ['wh-sales'] },
  { id: 'u-warehouse', name: 'Aptek POS Anbar', role: 'warehouse', active: true, registerIds: [], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'] },
];

export const initialWarehouses: Warehouse[] = [
  { id: 'wh-main', code: 'ANB-01', name: 'Anbar', address: 'Qəbul və saxlama · otaq temperaturu', manager: 'Aptek POS Anbar', active: true },
  { id: 'wh-cold', code: 'SOY-01', name: 'Soyuducu', address: '2-8 °C · vaksin, insulin, şamlar', manager: 'Aptek POS Anbar', active: true },
  { id: 'wh-sales', code: 'ZAL-01', name: 'Satış zalı', address: 'Rəflər və kassa', manager: 'Aptek POS Baş kassir', active: true },
];

export const initialRegisters: Register[] = [
  { id: 'reg-1', code: 'KASSA-01', name: 'Kassa 1', location: 'Əsas giriş', status: 'open', operatorId: 'u-head', openingFloatMinor: 15000, openedAt: now - 3 * 60 * 60 * 1000 },
  { id: 'reg-2', code: 'KASSA-02', name: 'Kassa 2', location: 'Resept pəncərəsi', status: 'open', operatorId: 'u-cashier', openingFloatMinor: 10000, openedAt: now - 2 * 60 * 60 * 1000 },
  { id: 'reg-3', code: 'KASSA-03', name: 'Kassa 3', location: 'Növbətçi aptek pəncərəsi', status: 'closed', openingFloatMinor: 0 },
];

// A pharmacy starts empty: medicines are created in stock (Anbar) and received
// by lot; a medicine appears on the sale screen once it has stock.
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
    detail: 'Aptek POS hazırdır',
  }],
  settings: {
    storeName: 'Aptek',
    legalName: 'Aptek MMC',
    taxId: '1401234561',
    phone: '+994 50 555 00 00',
    address: 'Bakı',
    terminalName: 'APTEKPOS-01',
    defaultWarehouseId: 'wh-sales',
    defaultRegisterId: 'reg-2',
    syncUrl: 'https://possistem.az/aptekpos',
  },
  syncQueue: 0,
});
