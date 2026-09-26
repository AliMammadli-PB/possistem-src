#!/usr/bin/env node
/**
 * Boots both WebAssembly cores in Node and runs what the live demo relies on:
 * the restaurant seed and a PIN sign-in, and a market catalogue import with
 * purchase orders (the first-launch path) followed by state.get.
 *
 *   node demo-web/smoke.mjs <restaurant-wasm-build-dir> <market-wasm-build-dir>
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedDemo } from './seed.js';

const [restaurantDir, marketDir] = process.argv.slice(2);
if (!restaurantDir || !marketDir) throw new Error('usage: smoke.mjs <restaurant-wasm-dir> <market-wasm-dir>');

function caller(module, fn) {
  let n = 0;
  return (method, payload = {}) => {
    const text = JSON.stringify({ requestId: `s${++n}`, method, protocolVersion: 1, timestamp: Date.now(), payload });
    const size = module.lengthBytesUTF8(text) + 1;
    const ptr = module._malloc(size);
    try {
      module.stringToUTF8(text, ptr, size);
      const frames = module.UTF8ToString(module[`_${fn}`](ptr)).split('\n').filter(Boolean).map((line) => JSON.parse(line));
      return frames.filter((frame) => frame.type !== 'event').pop();
    } finally {
      module._free(ptr);
    }
  };
}

const load = async (dir, file) => (await import(pathToFileURL(path.resolve(dir, file)).href)).default({ printErr: () => {} });

const restaurant = await load(restaurantDir, 'restaurant-pos-core.mjs');
restaurant.FS.mkdirTree('/data');
restaurant.ccall('pos_boot', 'string', ['string'], ['/data/pos.db']);
const pos = caller(restaurant, 'pos_call');
await seedDemo(async (method, payload) => pos(method, payload));
const login = pos('auth.login', { userId: '', pin: '1234' });
assert.equal(login.success, true, JSON.stringify(login.error));
const tables = pos('tables.list', {});
assert.equal(tables.data.tables.filter((t) => t.orderId).length, 4, 'four open bills on the floor');
console.log('[demo-smoke] restaurant ok');

const market = await load(marketDir, 'market-pos-core.mjs');
market.FS.mkdirTree('/data');
assert.equal(market.ccall('market_boot', 'string', ['string'], ['/data/market.db']), '');
const mk = caller(market, 'market_call');
const actor = { role: 'manager', actorId: 'u-manager' };
const snapshot = {
  schemaVersion: 5,
  warehouses: [{ id: 'wh-sales', code: 'ZAL-01', name: 'Satış zalı', active: true }],
  registers: [{ id: 'reg-1', code: 'KASSA-01', name: 'Kassa 1', status: 'open', openingFloatMinor: 0 }],
  products: [{ id: 'p1', sku: 'S1', barcode: '4760000000011', name: { az: 'Süd', ru: 'Молоко', en: 'Milk' }, category: 'Süd', unit: 'əd', priceMinor: 210, costMinor: 150, minStock: 1, taxRate: 18, supplier: 'S', warehouseStock: { 'wh-sales': 10 }, accent: '#000', image: { kind: 'sprite', index: 0 }, active: true, createdAt: 1 }],
  purchaseOrders: [{ id: 'PO-1', supplier: 'S', expectedAt: '2026-09-15', createdAt: 1, createdBy: 'u-manager', warehouseId: 'wh-sales', status: 'ordered', lines: [] }],
  settings: { defaultWarehouseId: 'wh-sales', defaultRegisterId: 'reg-1' },
};
const imported = mk('state.importLegacy', { snapshot, ...actor });
assert.equal(imported.success, true, JSON.stringify(imported.error));
assert.equal(mk('state.get', actor).success, true);
console.log('[demo-smoke] market ok');
