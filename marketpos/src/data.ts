import type { PersistedState } from './types';

/** Production defaults contain no merchant or sample business records. */
export const createInitialState = (): PersistedState => ({
  schemaVersion: 5,
  products: [], sales: [], purchaseOrders: [], warehouses: [], registers: [],
  heldCarts: [], audits: [], syncQueue: 0,
  settings: {
    showProductImages: false,
    storeName: '', legalName: '', taxId: '', phone: '', address: '', terminalName: '',
    defaultWarehouseId: '', defaultRegisterId: '',
    syncUrl: 'https://possistem.az/marketpos',
  },
});

export function readPersistedState(storage: Pick<Storage, 'getItem'>, key: string): PersistedState | null {
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    if (!parsed || ![2, 3, 4, 5].includes(parsed.schemaVersion) || !Array.isArray(parsed.products)) return null;
    const initial = createInitialState();
    // Preserve every real legacy SKU and record; never merge a sample catalogue.
    return {...initial, ...parsed, schemaVersion: 5,
      settings: {...initial.settings, ...parsed.settings},
      products: parsed.products,
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      purchaseOrders: Array.isArray(parsed.purchaseOrders) ? parsed.purchaseOrders : [],
      warehouses: Array.isArray(parsed.warehouses) ? parsed.warehouses : [],
      registers: Array.isArray(parsed.registers) ? parsed.registers : [],
    };
  } catch { return null; }
}
