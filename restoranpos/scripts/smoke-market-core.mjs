#!/usr/bin/env node
/** Smoke: spawn market-pos-core, ping, import minimal snapshot, complete a sale. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(ROOT, 'market-pos', 'native', 'build');
const bin = [path.join(build, 'market-pos-core'), path.join(build, 'market-pos-core.exe')].find((p) => fs.existsSync(p));
if (!bin) {
  console.error('market-pos-core not built — run npm run market:build:core');
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-core-smoke-'));
const db = path.join(dir, 'market.db');
const logs = path.join(dir, 'logs');
fs.mkdirSync(logs);

const child = spawn(bin, ['--db', db, '--log-dir', logs, '--protocol', '1'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const frames = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) frames.push(JSON.parse(line));
  }
});
child.stderr.on('data', (d) => process.stderr.write(d));

function waitFor(pred, ms = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const hit = frames.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - start > ms) return reject(new Error('timeout waiting for frame'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function ask(method, payload = {}) {
  const requestId = `r-${Date.now()}-${Math.random()}`;
  child.stdin.write(JSON.stringify({ requestId, method, protocolVersion: 1, timestamp: Date.now(), payload }) + '\n');
  return waitFor((f) => f.requestId === requestId);
}

const snap = {
  warehouses: [{ id: 'wh-sales', code: 'ZAL', name: 'Sales', address: '', manager: '', active: true }],
  registers: [{ id: 'reg-1', code: 'K1', name: 'Kassa', location: '', status: 'open', openingFloatMinor: 0, operatorId: 'u1', openedAt: Date.now() }],
  products: [{
    id: 'p1', sku: 'SKU1', barcode: '4769901000001',
    name: { az: 'Test', ru: 'Test', en: 'Test' }, category: 'Cat', unit: 'əd',
    priceMinor: 100, costMinor: 50, minStock: 1, taxRate: 18, supplier: 'S',
    warehouseStock: { 'wh-sales': 10 }, accent: '#000',
    image: { kind: 'sprite', index: 0 }, active: true, createdAt: Date.now(),
  }],
  settings: { storeName: 'Smoke', legalName: 'Smoke', taxId: '', phone: '', address: '', terminalName: 'T1', defaultWarehouseId: 'wh-sales', defaultRegisterId: 'reg-1', syncUrl: '' },
};

await waitFor((f) => f.type === 'event' && f.event === 'core.ready');
const ping = await ask('core.ping');
if (!ping.success) throw new Error('ping failed');
const imported = await ask('state.importLegacy', { snapshot: snap });
if (!imported.success) throw new Error(JSON.stringify(imported.error));
const sale = await ask('sale.complete', {
  cashierId: 'u1',
  registerId: 'reg-1',
  warehouseId: 'wh-sales',
  discountMinor: 0,
  items: [{ productId: 'p1', qty: 1 }],
  payment: { method: 'cash', tenderedMinor: 500 },
});
if (!sale.success) throw new Error(JSON.stringify(sale.error));
console.log(`[smoke-market-core] OK ${sale.data.receiptNo} total=${sale.data.totalMinor}`);
child.stdin.end();
await new Promise((r) => child.on('exit', r));
