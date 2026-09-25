#!/usr/bin/env node
/**
 * Smoke-tests receipt generation against a real POS database without enqueueing
 * or sending a print job. This is safe to run against the cashier database.
 *
 * Usage:
 *   node scripts/test-receipt-preview.mjs "C:\...\data\pos.db"
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.join(root, 'native', 'build', 'restaurant-pos-core.exe');
const db = path.resolve(
  process.argv[2] ??
    path.join(
      process.env.APPDATA ?? '',
      'Maison Aurelia POS',
      'data',
      'pos.db',
    ),
);

if (!fs.existsSync(core)) throw new Error(`Core executable not found: ${core}`);
if (!fs.existsSync(db)) throw new Error(`POS database not found: ${db}`);

const child = spawn(
  core,
  ['--db', db, '--log-dir', path.join(os.tmpdir(), 'maison-receipt-smoke'), '--protocol', '1'],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);

const pending = new Map();
let nextId = 1;

const lines = readline.createInterface({ input: child.stdout });
lines.on('line', (line) => {
  const frame = JSON.parse(line);
  if (!frame.requestId) return;
  const waiter = pending.get(frame.requestId);
  if (!waiter) return;
  pending.delete(frame.requestId);
  if (frame.success) waiter.resolve(frame.data);
  else waiter.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`));
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

function call(method, payload = {}) {
  const requestId = `smoke-${nextId++}`;
  child.stdin.write(
    `${JSON.stringify({
      requestId,
      method,
      protocolVersion: 1,
      timestamp: Date.now(),
      payload,
    })}\n`,
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${method} timed out`));
    }, 10_000);
    pending.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

try {
  const users = await call('auth.listUsers');
  const admin = users.users.find((user) => user.code === '9001');
  if (!admin) throw new Error('Demo administrator 9001 is not available');

  // 9001 ships in the source, so a fresh till makes it pick a new PIN first.
  await call('auth.login', { userId: admin.id, pin: '9001', newPin: '4826' });
  const jobs = await call('print.jobs', { limit: 50 });
  const target = jobs.jobs.find(
    (job) => job.kind === 'customer_receipt' && job.orderId,
  );
  if (!target) throw new Error('No customer receipt job with an order was found');

  const preview = await call('receipts.preview', {
    orderId: target.orderId,
    kind: 'customer_receipt',
    paperWidth: 80,
    renderMode: 'auto',
  });

  if (!preview.document) throw new Error('Preview returned no ReceiptDocument');
  if (!preview.text?.includes('AZN')) throw new Error('Preview has no AZN amounts');
  if (!preview.text?.includes('Təşəkkür edirik!')) {
    throw new Error('Preview has incorrect Azerbaijani footer');
  }

  process.stdout.write(
    `[receipt-smoke] PASS order=${target.orderNumber ?? target.orderId} ` +
      `receipt=${preview.number} totalMinor=${preview.totalMinor} ` +
      `mode=${preview.effectiveRenderMode}\n`,
  );
} finally {
  child.stdin.end();
  lines.close();
  child.kill();
}

child.on('exit', (code) => {
  if (code && code !== 0 && stderr) process.stderr.write(stderr);
});
