#!/usr/bin/env node
/**
 * Regression tests for the replication defects fixed in 1.4.3 (two cores syncing, as two PCs do):
 *   C1 export window starvation, C2 non-replicating goods receipt,
 *   C3 bootstrap double-count, C4 sequence regression, H1 poisoned batch.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(import.meta.dirname, '..');
// The core is cross-built for Windows; on Linux it runs under wine.
const exe = path.join(root, 'native', 'build', 'aptek-pos-core.exe');
const [command, prefix] = process.platform === 'win32' ? [exe, []] : ['wine', [exe]];
const work = await mkdtemp(path.join(tmpdir(), 'market-resilience-'));

class Core {
  constructor(name) {
    this.name = name;
    this.dbPath = path.join(work, `${name}.db`);
    this.pending = new Map();
    this.spawn();
  }
  spawn() {
    this.child = spawn(command, [...prefix, '--db', this.dbPath, '--log-dir', work, '--protocol', '1'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WINEDEBUG: '-all' } });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      let doc;
      try { doc = JSON.parse(line); } catch { return; }
      if (doc.type === 'event') return;
      this.pending.get(doc.requestId)?.(doc);
      this.pending.delete(doc.requestId);
    });
  }
  call(method, payload = {}) {
    // Every stock, product and purchase handler is permission-gated since 1.4.6;
    // this suite is about replication, so it acts as a manager throughout.
    payload = { role: 'manager', ...payload };
    const requestId = randomUUID();
    this.child.stdin.write(`${JSON.stringify({ requestId, method, protocolVersion: 1, timestamp: Date.now(), payload })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name}:${method} timeout`)), 60000);
      this.pending.set(requestId, (doc) => { clearTimeout(timer); doc.success ? resolve(doc.data) : reject(new Error(`${this.name}:${method} ${doc.error?.code}: ${doc.error?.message}`)); });
    });
  }
  async close() { this.child.stdin.end(); await new Promise((resolve) => this.child.once('exit', resolve)); }
  async restart() { await this.close(); this.spawn(); await new Promise((r) => setTimeout(r, 200)); }
}

const seedCatalog = async (core, { stock = 0 } = {}) => {
  await core.call('warehouse.create', { actorId: 'manager', warehouse: { id: 'wh-main', code: 'MAIN', name: 'Main warehouse' } });
  await core.call('product.create', { actorId: 'manager', product: {
    id: 'bread', sku: 'BREAD-1', barcode: '10001', name: { az: 'Corek', ru: 'Хлеб', en: 'Bread' },
    category: 'Bakery', unit: 'ea', priceMinor: 50, costMinor: 30, minStock: 5, taxRate: 18,
    supplier: '', accent: '#2563eb', image: { kind: 'sprite', index: 0 }, active: true, warehouseStock: { 'wh-main': 0 },
  } });
  if (stock) await core.call('inventory.adjust', { productId: 'bread', warehouseId: 'wh-main', qtyDelta: stock, actorId: 'manager', note: 'opening' });
};

const cores = [];
const newCore = (name) => { const c = new Core(name); cores.push(c); return c; };

try {
  // ---- C1: export must not starve once the outbox outgrows the 5000 window ----
  {
    const a = newCore('c1-a');
    await new Promise((r) => setTimeout(r, 250));
    await a.call('sync.configure', { deviceId: randomUUID() });
    await seedCatalog(a, { stock: 20000 });
    for (let i = 0; i < 5200; i += 1) {
      await a.call('inventory.adjust', { productId: 'bread', warehouseId: 'wh-main', qtyDelta: 1, actorId: 'manager', note: `bulk-${i}` });
    }
    const total = (await a.call('sync.status')).pending;
    assert.ok(total > 5000, `expected >5000 queued events, got ${total}`);

    // Drain the way a peer does: repeated export advancing the cursor each round.
    const vector = {};
    let drained = 0;
    for (let round = 0; round < 20; round += 1) {
      const out = await a.call('sync.export', { vector });
      if (!out.events.length) break;
      for (const e of out.events) {
        vector[e.originDeviceId] = Math.max(vector[e.originDeviceId] || 0, e.originSeq);
        drained += 1;
      }
    }
    assert.ok(drained > 5000, `export starved at ${drained} events — the peer cursor is not reaching SQL`);
    console.log(`[c1] drained ${drained} events past the 5000 window — OK`);
  }

  // ---- C2: goods receipt must replicate ----
  {
    const a = newCore('c2-a');
    const b = newCore('c2-b');
    await new Promise((r) => setTimeout(r, 250));
    const idA = randomUUID();
    await a.call('sync.configure', { deviceId: idA });
    await b.call('sync.configure', { deviceId: randomUUID() });
    await seedCatalog(a);
    const bootstrap = await a.call('sync.export', { vector: {} });
    await b.call('sync.apply', { events: bootstrap.events });

    const before = (await a.call('sync.status')).pending;
    const manager = { actorId: 'manager-1', role: 'manager' };
    const po = await a.call('purchase.create', { ...manager, order: {
      supplier: 'ACME', createdBy: 'manager-1', warehouseId: 'wh-main', status: 'ordered',
      lines: [{ productId: 'bread', qty: 75, costMinor: 30 }],
    } });
    await a.call('purchase.receive', { ...manager, id: po.id });
    const after = (await a.call('sync.status')).pending;
    assert.ok(after > before, 'purchase.receive emitted no sync event — the non-replicating stock path is back');

    const cursor = {};
    for (const e of bootstrap.events) cursor[e.originDeviceId] = Math.max(cursor[e.originDeviceId] || 0, e.originSeq);
    const delta = await a.call('sync.export', { vector: cursor });
    await b.call('sync.apply', { events: delta.events });
    const stockB = (await b.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty;
    assert.equal(stockB, 75, `goods receipt did not replicate: peer sees ${stockB}`);
    console.log('[c2] purchase.receive replicated to the second till — OK');
  }

  // ---- C3: two tills bootstrapping the same seed must not double stock ----
  {
    const a = newCore('c3-a');
    const b = newCore('c3-b');
    await new Promise((r) => setTimeout(r, 250));
    await a.call('sync.configure', { deviceId: randomUUID() });
    await b.call('sync.configure', { deviceId: randomUUID() });
    // Identical starting state, as two tills installed from the same seed.
    await seedCatalog(a, { stock: 40 });
    await seedCatalog(b, { stock: 40 });

    await a.call('sync.bootstrap');
    await b.call('sync.bootstrap');
    const fromA = await a.call('sync.export', { vector: {} });
    const fromB = await b.call('sync.export', { vector: {} });
    await b.call('sync.apply', { events: fromA.events });
    await a.call('sync.apply', { events: fromB.events });

    const stockA = (await a.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty;
    const stockB = (await b.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty;
    assert.equal(stockA, 40, `bootstrap double-counted on A: ${stockA}`);
    assert.equal(stockB, 40, `bootstrap double-counted on B: ${stockB}`);
    console.log('[c3] crossed bootstrap converged to 40, not 80 — OK');
  }

  // ---- C4: a restored backup must not wedge selling ----
  {
    const a = newCore('c4-a');
    await new Promise((r) => setTimeout(r, 250));
    await a.call('sync.configure', { deviceId: randomUUID() });
    await seedCatalog(a, { stock: 100 });
    const snapshot = path.join(work, 'c4-snapshot.db');
    await a.close();
    await copyFile(a.dbPath, snapshot);
    a.spawn();
    await new Promise((r) => setTimeout(r, 250));

    // Burn sequence numbers, then roll the DB back underneath the core.
    for (let i = 0; i < 25; i += 1) {
      await a.call('inventory.adjust', { productId: 'bread', warehouseId: 'wh-main', qtyDelta: -1, actorId: 'manager', note: `pre-restore-${i}` });
    }
    await a.close();
    await copyFile(snapshot, a.dbPath);
    a.spawn();
    await new Promise((r) => setTimeout(r, 250));

    // This is the sale that used to die on UNIQUE(origin_device_id, origin_seq).
    await a.call('inventory.adjust', { productId: 'bread', warehouseId: 'wh-main', qtyDelta: -3, actorId: 'cashier', note: 'post-restore sale' });
    const qty = (await a.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty;
    assert.equal(qty, 97, `post-restore stock wrong: ${qty}`);
    console.log('[c4] stock change succeeded after a backup restore — OK');
  }

  // ---- H1: one unapplicable event must not poison the batch ----
  {
    const a = newCore('h1-a');
    const b = newCore('h1-b');
    await new Promise((r) => setTimeout(r, 250));
    const idA = randomUUID();
    await a.call('sync.configure', { deviceId: idA });
    await b.call('sync.configure', { deviceId: randomUUID() });
    await seedCatalog(a, { stock: 10 });
    const good = await a.call('sync.export', { vector: {} });

    // A movement for a product the receiver has never seen — a foreign-key failure.
    const poison = {
      eventId: `evt-poison-${randomUUID()}`, originDeviceId: idA, originSeq: 999999,
      kind: 'stock.movement', createdAt: Date.now(),
      payload: { productId: 'does-not-exist', warehouseId: 'wh-main', qtyDelta: 5, type: 'SYNC' },
    };

    const result = await b.call('sync.apply', { events: [poison, ...good.events] });
    assert.ok(result.rejected >= 1, 'poison event was not quarantined');
    assert.ok(result.applied >= good.events.length, `siblings were rolled back: applied=${result.applied}`);
    const stockB = (await b.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty;
    assert.equal(stockB, 10, `sibling events lost: peer sees ${stockB}`);
    console.log(`[h1] quarantined ${result.rejected}, applied ${result.applied} siblings — OK`);
  }

  // ---- S1: a sale at one till leaves the stock the other till sees ----
  // The owner's case: the till is one PC, the store room another. Selling four
  // at the till must show four fewer on the store-room PC.
  {
    const till = newCore('s1-till');
    const store = newCore('s1-store');
    await new Promise((r) => setTimeout(r, 250));
    await till.call('sync.configure', { deviceId: randomUUID() });
    await store.call('sync.configure', { deviceId: randomUUID() });
    await seedCatalog(till, { stock: 30 });
    const bootstrap = await till.call('sync.export', { vector: {} });
    await store.call('sync.apply', { events: bootstrap.events });
    assert.equal((await store.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty, 30);

    const bound = await till.call('cash.bindDeviceRegister', { name: 'Kassa 1', operatorId: 'cashier-1', updatedAt: Date.now() });
    const registerId = bound.register?.id ?? bound.settings?.deviceRegisterId;
    await till.call('cash.openSession', { registerId, operatorId: 'cashier-1', openingFloatMinor: 0 });
    await till.call('sale.complete', {
      items: [{ productId: 'bread', qty: 4 }], cashierId: 'cashier-1', registerId,
      payment: { method: 'cash', amountMinor: 200, tenderedMinor: 200, changeMinor: 0 },
    });

    const cursor = {};
    for (const e of bootstrap.events) cursor[e.originDeviceId] = Math.max(cursor[e.originDeviceId] || 0, e.originSeq);
    const delta = await till.call('sync.export', { vector: cursor });
    await store.call('sync.apply', { events: delta.events });
    const left = (await store.call('inventory.getStock', { productId: 'bread', warehouseId: 'wh-main' })).qty;
    assert.equal(left, 26, `the store-room PC still sees ${left} after a sale of 4 at the till`);
    console.log('[s1] sale at the till reduced stock on the store-room PC (30 → 26) — OK');
  }

  console.log('\n[market-sync-resilience] all replication regression tests passed');
} finally {
  for (const core of cores) await core.close().catch(() => undefined);
  await rm(work, { recursive: true, force: true });
}
