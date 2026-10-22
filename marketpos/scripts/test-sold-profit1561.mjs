/**
 * 1.5.61: Mallar/Anbar "Satışdan qazanc" grows with Market sales, net of returns and the
 * receipt discount, while the stock's possible profit shrinks. Real restaurant warehouse core.
 *   RESTAURANT_CORE_BINARY=... node scripts/test-sold-profit1561.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const binary = process.env.RESTAURANT_CORE_BINARY || path.join(root, 'restoranpos/native/build-linux/restaurant-pos-core');
const wine = binary.endsWith('.exe');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sold-profit-'));
let seq = 0;
const pending = new Map();
let ready;
const started = new Promise((r) => { ready = r; });
const args = ['--db', path.join(dir, 'ops.db'), '--log-dir', path.join(dir, 'logs'), '--protocol', '1'];
const child = spawn(wine ? 'wine' : binary, wine ? [binary, ...args] : args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WINEDEBUG: '-all', POS_SEED_DEMO_MENU: '0' } });
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let f; try { f = JSON.parse(line); } catch { continue; }
    if (f.event === 'core.ready') ready();
    const p = pending.get(f.requestId);
    if (p) { pending.delete(f.requestId); p(f); }
  }
});
child.stderr.on('data', () => {});
const ask = (method, payload = {}, extra = {}) => new Promise((resolve, reject) => {
  const requestId = 'sp-' + (++seq);
  const timer = setTimeout(() => reject(Error('timeout ' + method)), 20000);
  pending.set(requestId, (f) => { clearTimeout(timer); resolve(f); });
  child.stdin.write(JSON.stringify({ requestId, method, protocolVersion: 1, timestamp: Date.now(), payload, actor: { userId: 'usr-admin' }, ...extra }) + '\n');
});
const ok = (r) => { assert.equal(r.success, true, JSON.stringify(r.error)); return r.data; };
const terminal = { terminal: { id: 'market-k1', name: 'Kassa 1' } };
const good = (list, id) => list.goods.find((g) => g.id === id);

try {
  await Promise.race([started, new Promise((_, rej) => setTimeout(() => rej(Error('core did not start')), 20000))]);
  const id = ok(await ask('ingredients.save', { name: 'Alma', barcode: '4760001000001', unit: 'kg', costMinor: 200, salePriceMinor: 300 })).id;
  ok(await ask('inventory.adjust', { ingredientId: id, qtyDeltaMilli: 10000, reason: 'QA', idempotencyKey: 'open' }));
  let list = ok(await ask('goods.list', {}));
  assert.equal(good(list, id).soldProfitMinor, 0);
  const stockProfitBefore = list.totals.profitMinor;

  // 2.500 kg at 3.00 = 7.50; a second receipt 1.000 kg = 3.00 with 0.30 receipt discount.
  ok(await ask('sales.recordExternal', { externalId: 's1', number: '0001', lines: [{ ingredientId: id, qtyMilli: 2500, unitPriceMinor: 300, totalMinor: 750 }], cashMinor: 750 }, terminal));
  ok(await ask('sales.recordExternal', { externalId: 's2', number: '0002', lines: [{ ingredientId: id, qtyMilli: 1000, unitPriceMinor: 300, totalMinor: 300 }], cashMinor: 270, discountMinor: 30 }, terminal));
  list = ok(await ask('goods.list', {}));
  let g = good(list, id);
  assert.equal(g.soldQtyMilli, 3500);
  assert.equal(g.soldMinor, 750 + 270);
  assert.equal(g.soldCostMinor, 700);
  assert.equal(g.soldProfitMinor, 1020 - 700);
  assert.equal(list.totals.soldProfitMinor, 320);
  assert.ok(list.totals.profitMinor < stockProfitBefore, 'stock profit shrinks as goods leave');

  // Returning 1.000 kg of the first receipt takes its share of revenue (3.00) back out.
  ok(await ask('sales.recordExternalRefund', { externalId: 'r1', saleExternalId: 's1', lines: [{ ingredientId: id, qtyMilli: 1000 }], cashMinor: 300 }, terminal));
  list = ok(await ask('goods.list', {}));
  g = good(list, id);
  assert.equal(g.soldQtyMilli, 2500);
  assert.equal(g.soldMinor, 450 + 270);
  assert.equal(g.soldProfitMinor, 720 - 500);
  console.log('PASS warehouse goods.list: sold profit grows with sales (0 → 3.20 AZN), follows the receipt discount and returns (→ 2.20 AZN); stock profit shrinks.');
} finally {
  const exited = new Promise((r) => child.once('exit', r));
  child.stdin.end();
  await exited;
  await fs.rm(dir, { recursive: true, force: true });
}
