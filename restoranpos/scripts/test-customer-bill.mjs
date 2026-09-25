#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.platform === 'win32'
  ? path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe')
  : path.join(ROOT, 'native', 'build-linux', 'restaurant-pos-core');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-customer-bill-'));
const dbPath = path.join(workDir, 'pos.db');
const logDir = path.join(workDir, 'logs');
fs.mkdirSync(logDir);

if (!fs.existsSync(CORE)) throw new Error(`core missing: ${CORE}`);

const child = spawn(CORE, ['--db', dbPath, '--log-dir', logDir, '--protocol', '1'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let buffer = '';
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
const pending = new Map();
let stderr = '';

child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
child.on('error', (error) => readyReject(error));
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, '');
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.type === 'event' && message.event === 'core.ready') {
      readyResolve(message);
      continue;
    }
    const waiter = pending.get(message.requestId);
    if (!waiter) continue;
    pending.delete(message.requestId);
    clearTimeout(waiter.timer);
    message.success
      ? waiter.resolve(message.data)
      : waiter.reject(new Error(`${message.error?.code}: ${message.error?.message}`));
  }
});

function call(method, payload = {}, idempotencyKey) {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${method} timed out\n${stderr.slice(-2000)}`));
    }, 30_000);
    pending.set(requestId, { resolve, reject, timer });
    child.stdin.write(
      `${JSON.stringify({
        requestId,
        method,
        protocolVersion: 1,
        timestamp: Date.now(),
        idempotencyKey,
        payload,
      })}\n`,
    );
  });
}

try {
  await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('core.ready timed out')), 30_000)),
  ]);

  const users = await call('auth.listUsers');
  const admin = users.users.find((user) => user.code === '9001');
  if (!admin) throw new Error('administrator 9001 missing');
  // 9001 ships in the source, so a fresh till makes it pick a new PIN first.
  await call('auth.login', { userId: admin.id, pin: '9001', newPin: '4826' });
  await call('settings.set', { key: 'printer.receipt', value: 'virtual' });

  const order = await call(
    'orders.create',
    { tableId: 'tbl-01', guestCount: 2 },
    randomUUID(),
  );
  await call(
    'orders.addItem',
    { orderId: order.id, productId: 'itm-ff-01', quantity: 1, modifiers: [] },
    randomUUID(),
  );
  const before = await call('orders.get', { orderId: order.id });

  const printed = await call(
    'print.enqueue',
    { orderId: order.id, kind: 'customer_bill', paperWidth: 80 },
    randomUUID(),
  );
  if (printed.status !== 'completed') {
    throw new Error(`customer bill status=${printed.status}: ${printed.lastError ?? ''}`);
  }

  const afterPrint = await call('orders.get', { orderId: order.id });
  if (afterPrint.status !== before.status || afterPrint.totalMinor !== before.totalMinor) {
    throw new Error('printing changed the open order');
  }

  await call(
    'orders.addItem',
    { orderId: order.id, productId: 'itm-ff-01', quantity: 1, modifiers: [] },
    randomUUID(),
  );
  const afterExtra = await call('orders.get', { orderId: order.id });
  if (afterExtra.items.length !== before.items.length + 1 || afterExtra.totalMinor <= before.totalMinor) {
    throw new Error('order did not remain editable after customer bill');
  }

  child.stdin.end();
  await new Promise((resolve) => child.once('close', resolve));

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const receipt = db
    .prepare("SELECT kind, content_text AS text FROM receipts WHERE order_id=? AND kind='customer_bill' ORDER BY created_at DESC LIMIT 1")
    .get(order.id);
  db.close();
  if (!receipt || receipt.kind !== 'customer_bill') throw new Error('customer_bill snapshot missing');
  if (!receipt.text.includes('MÜŞTƏRİ ÇEKİ') || !receipt.text.includes('YEKUN')) {
    throw new Error('customer bill paper is missing its label or total');
  }

  process.stdout.write(
    `[customer-bill] PASS: total=${before.totalMinor}, status=${afterPrint.status}, ` +
      `order stayed ${afterPrint.status === 'completed' ? afterPrint.status : before.status}, extra item accepted\n`,
  );
} finally {
  if (!child.killed && child.exitCode == null) child.kill();
  fs.rmSync(workDir, { recursive: true, force: true });
}
