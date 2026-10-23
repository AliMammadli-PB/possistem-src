/** 1.5.66: the portal's daily figures — weighed lines by weight, partial returns and discounts off. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'books-'));
const out = path.join(dir, 'books.mjs');
await build({ entryPoints: [path.join(root, 'src/books.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const { marketBooks } = await import(pathToFileURL(out).href);
try {
  const now = Date.now();
  const p = (id, priceMinor, costMinor, unit) => ({ id, sku: id, barcode: '', name: { az: id, ru: id, en: id }, category: '', unit, priceMinor, costMinor, minStock: 0, taxRate: 0, supplier: '', warehouseStock: {}, accent: '', image: { kind: 'url', url: '' }, active: true, createdAt: now });
  const pay = (total) => ({ method: 'cash', amountMinor: total, tenderedMinor: total, changeMinor: 0, cashMinor: total });
  const state = { products: [p('su', 150, 100, 'əd'), p('alma', 800, 500, 'kq')], warehouses: [], registers: [], heldCarts: [], purchaseOrders: [],
    sales: [
      { id: 's1', receiptNo: '1', createdAt: now, items: [{ productId: 'alma', qty: 1, qtyMilli: 310 }], subtotalMinor: 248, discountMinor: 0, totalMinor: 248, payment: pay(248), refunded: false, cashierId: 'u', registerId: 'r' },
      { id: 's2', receiptNo: '2', createdAt: now, items: [{ productId: 'su', qty: 3 }], subtotalMinor: 450, discountMinor: 50, totalMinor: 400, payment: pay(400), refunded: false, cashierId: 'u', registerId: 'r',
        refunds: [{ refundId: 'r1', createdAt: now, lines: [{ productId: 'su', qty: 1, amountMinor: 133 }] }] },
    ] };
  const books = marketBooks(state);
  // alma: 2.48 − 1.55 = 0.93. su: 4.00 − 1.33 back = 2.67 kept, cost 3.00 × (267/400) = 2.0025.
  assert.equal(books.daily.sales, 248 + 267);
  assert.equal(books.daily.profit, Math.trunc(93 + (267 - 300 * 267 / 400)));
  assert.equal(books.daily.count, 2);
  console.log('PASS books: daily sales 5.15 net of a partial return, profit counts 0.310 kg (not 1 kg) and the receipt discount.');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
