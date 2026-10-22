/**
 * 1.5.61: scale label barcodes. Weight labels (prefix + PLU + grams) as before; Dahua's factory
 * total-price labels (prefix + PLU + qəpik) become a weighed line instead of "1 piece at the
 * total"; the rules are editable through settings.setValue and validated. Real market core.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.MARKET_CORE_BINARY || path.join(root, 'native/build-linux/market-pos-core');
const wine = binary.endsWith('.exe');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scale-barcode-'));
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
  const requestId = 'sb-' + (++seq), timer = setTimeout(() => reject(Error('timeout ' + method)), 15000);
  pending.set(requestId, (f) => { clearTimeout(timer); resolve(f); });
  child.stdin.write(JSON.stringify({ requestId, method, protocolVersion: 1, timestamp: Date.now(), payload: { actorId: 'u1', role: 'manager', ...payload } }) + '\n');
});
const ok = (r) => { assert.equal(r.success, true, JSON.stringify(r.error)); return r.data; };
const ean = (body) => { let s = 0; for (let i = 0; i < body.length; i++) s += Number(body[i]) * ((body.length - 1 - i) % 2 === 0 ? 3 : 1); return body + ((10 - (s % 10)) % 10); };
const rules = (pluLen, valueLen, mode, decimals) => ['20', '21', '22'].map((prefix) => ({ prefix, pluStart: 2, pluLen, valueStart: 2 + pluLen, valueLen, decimals, mode, checkChecksum: true }));

try {
  await Promise.race([started, new Promise((_, rej) => setTimeout(() => rej(Error('core did not start')), 20000))]);
  const now = Date.now();
  const product = (id, plu, unit, priceMinor) => ({ id, sku: id, barcode: '', plu, name: { az: id, ru: id, en: id }, category: 'Meyvə', unit, priceMinor, costMinor: 100, minStock: 0, taxRate: 0, supplier: '', warehouseStock: { 'wh-sales': 100 }, image: { kind: 'url', url: '' }, active: true, createdAt: now });
  ok(await ask('state.importLegacy', { snapshot: { warehouses: [{ id: 'wh-sales', code: 'ZAL', name: 'Sales', active: true }], registers: [], products: [product('alma', '00012', 'kq', 800), product('su', '00013', 'əd', 150)], settings: { storeName: 'QA', defaultWarehouseId: 'wh-sales' } } }));

  // Default rules (019): weight labels.
  let r = ok(await ask('barcode.resolve', { barcode: ean('200001200310') }));
  assert.equal(r.productId, 'alma'); assert.equal(r.qtyMilli, 310); assert.equal(r.lineTotalMinor, 248);

  // Dahua factory barcode 1: prefix + PLU(5) + total(5) in qəpik.
  ok(await ask('settings.setValue', { key: 'scaleBarcodeRules', value: rules(5, 5, 'PRICE', 2) }));
  assert.equal(ok(await ask('scale.rules')).rules[0].mode, 'PRICE');
  r = ok(await ask('barcode.resolve', { barcode: ean('210001200248') }));
  assert.equal(r.productId, 'alma'); assert.equal(r.embeddedPriceMinor, 248); assert.equal(r.qtyMilli, 310, '2.48 AZN at 8.00/kg is 0.310 kg'); assert.equal(r.lineTotalMinor, 248);
  r = ok(await ask('barcode.resolve', { barcode: ean('200001200080') }));
  assert.equal(r.qtyMilli, 100); assert.equal(r.lineTotalMinor, 80, '0.80 AZN stays 0.80, not 80');
  // A piece good with a price label keeps one piece at the label's price.
  r = ok(await ask('barcode.resolve', { barcode: ean('200001300150') }));
  assert.equal(r.productId, 'su'); assert.equal(r.qtyMilli, undefined); assert.equal(r.unitPriceMinor, 150);
  // Dahua factory barcode 4: prefix + PLU(4) + total(6).
  ok(await ask('settings.setValue', { key: 'scaleBarcodeRules', value: rules(4, 6, 'PRICE', 2) }));
  r = ok(await ask('scale.tryBarcode', { barcode: ean('200012001234') }));
  assert.equal(r.qtyMilli, 1543); assert.equal(r.lineTotalMinor, 1234);

  // Bad rules never reach the scan path.
  for (const value of [[], [{ prefix: '2a', pluStart: 2, pluLen: 5, valueStart: 7, valueLen: 5, decimals: 3, mode: 'WEIGHT' }], rules(5, 6, 'WEIGHT', 3), rules(5, 5, 'PIECE', 3)]) {
    const bad = await ask('settings.setValue', { key: 'scaleBarcodeRules', value });
    assert.equal(bad.success, false, 'reject ' + JSON.stringify(value).slice(0, 60));
  }
  assert.equal(ok(await ask('scale.rules')).rules[0].pluLen, 4, 'rejected rules leave the saved ones');
  const denied = await ask('settings.setValue', { key: 'scaleBarcodeRules', value: rules(5, 5, 'WEIGHT', 3), role: 'cashier', actorId: 'c1' });
  assert.equal(denied.success, false, 'a cashier cannot change the rules');
  console.log('PASS native scale barcodes: weight labels, Dahua total-price labels → weighed lines (2.48 → 0.310 kg, 0.80 stays 0.80), piece goods, 4+6 layout, validated rules, cashier refused.');
} finally {
  const exited = new Promise((r) => child.once('exit', r));
  child.stdin.end(); await exited;
  await fs.rm(dir, { recursive: true, force: true });
}
