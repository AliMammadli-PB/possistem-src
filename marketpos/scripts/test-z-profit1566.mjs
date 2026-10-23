/**
 * 1.5.66: the shift report (X/Z) carries cost and profit — weighed lines by weight, partial returns
 * taking back their share — and the Z receipt prints them. Real market core.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.MARKET_CORE_BINARY || path.join(root, 'native/build-linux/market-pos-core');
const wine = binary.endsWith('.exe');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'z-profit-'));
const pending = new Map();
let seq = 0, ready;
const started = new Promise((r) => { ready = r; });
const args = ['--db', path.join(dir, 'market.db'), '--log-dir', path.join(dir, 'logs'), '--protocol', '1'];
const child = spawn(wine ? 'wine' : binary, wine ? [binary, ...args] : args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WINEDEBUG: '-all' } });
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let f; try { f = JSON.parse(line); } catch { continue; }
    if (f.event === 'core.ready') ready();
    const p = pending.get(f.requestId); if (p) { pending.delete(f.requestId); p(f); }
  }
});
child.stderr.on('data', () => {});
const ask = (method, payload = {}) => new Promise((resolve, reject) => {
  const requestId = 'z-' + (++seq), timer = setTimeout(() => reject(Error('timeout ' + method)), 15000);
  pending.set(requestId, (f) => { clearTimeout(timer); resolve(f); });
  child.stdin.write(JSON.stringify({ requestId, method, protocolVersion: 1, timestamp: Date.now(), payload: { actorId: 'u1', role: 'manager', ...payload } }) + '\n');
});
const ok = (r) => { assert.equal(r.success, true, JSON.stringify(r.error)); return r.data; };

try {
  await Promise.race([started, new Promise((_, rej) => setTimeout(() => rej(Error('core did not start')), 20000))]);
  const now = Date.now();
  const product = (id, unit, priceMinor, costMinor) => ({ id, sku: id, barcode: id, name: { az: id, ru: id, en: id }, category: 'C', unit, priceMinor, costMinor, minStock: 0, taxRate: 0, supplier: '', warehouseStock: { 'wh-sales': 100 }, image: { kind: 'url', url: '' }, active: true, createdAt: now });
  ok(await ask('state.importLegacy', { snapshot: {
    warehouses: [{ id: 'wh-sales', code: 'ZAL', name: 'Sales', active: true }],
    registers: [{ id: 'reg-1', code: 'K1', name: 'Kassa 1', status: 'closed', openingFloatMinor: 0 }],
    products: [product('su', 'əd', 150, 100), product('alma', 'kq', 800, 500)],
    settings: { storeName: 'QA', defaultWarehouseId: 'wh-sales', defaultRegisterId: 'reg-1' } } }));
  ok(await ask('cash.openSession', { registerId: 'reg-1', operatorId: 'u1', openingFloatMinor: 1000 }));
  // 3 × su (4.50, cost 3.00) and 0.310 kg alma (2.48, cost 1.55).
  const sale = ok(await ask('sale.complete', { cashierId: 'u1', registerId: 'reg-1', idempotencyKey: 's1', items: [{ productId: 'su', qty: 3 }, { productId: 'alma', qty: 1, qtyMilli: 310 }], payment: { method: 'cash', tenderedMinor: 698, cashMinor: 698 } }));
  assert.equal(sale.totalMinor, 698);
  let x = ok(await ask('cash.xReport', { registerId: 'reg-1' }));
  assert.equal(x.costMinor, 300 + 155);
  assert.equal(x.profitMinor, 698 - 455);
  // Return one su: 1.50 back, cost 1.00 back.
  const suLine = sale.items.find((l) => l.productId === 'su');
  ok(await ask('return.partial', { saleId: sale.id, lines: [{ saleItemId: suLine.saleItemId ?? suLine.id, qty: 1 }], reason: 'QA' }));
  x = ok(await ask('cash.xReport', { registerId: 'reg-1' }));
  assert.equal(x.netSalesMinor, 548);
  assert.equal(x.costMinor, 355);
  assert.equal(x.profitMinor, 548 - 355);
  const z = ok(await ask('cash.zClose', { registerId: 'reg-1', actualCashMinor: x.expectedCashMinor }));
  assert.equal(z.profitMinor, 193); assert.equal(z.differenceMinor, 0);
  const { buildXzReportEscPos } = createRequire(import.meta.url)('../electron/hardware/printer.js');
  const text = buildXzReportEscPos({ ...z, reportType: 'Z', registerName: 'Kassa 1' }).toString('latin1');
  assert.match(text, /Kassa: Kassa 1/); assert.match(text, /Qazanc\s+AZN 1\.93/); assert.match(text, /Maya deyeri\s+AZN 3\.55/); assert.match(text, /Qaytarma\s+AZN 1\.50/);
  console.log('PASS native Z: cost 4.55 → 3.55 after a partial return, weighed line by weight, profit 1.93 on the shift and on the Z receipt.');
} finally {
  const exited = new Promise((r) => child.once('exit', r));
  child.stdin.end(); await exited;
  await fs.rm(dir, { recursive: true, force: true });
}
