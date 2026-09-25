#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.platform === 'win32'
  ? path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe')
  : path.join(ROOT, 'native', 'build-linux', 'restaurant-pos-core');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-catalog-ordering-'));
const dbPath = path.join(workDir, 'pos.db');
const logDir = path.join(workDir, 'logs');
fs.mkdirSync(logDir);

if (!fs.existsSync(CORE)) throw new Error(`core missing: ${CORE}`);

const child = spawn(CORE, ['--db', dbPath, '--log-dir', logDir, '--protocol', '1'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let buffer = '';
let stderr = '';
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
const pending = new Map();

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

const categoryPayload = (category, sortOrder, name = category.nameAz) => ({
  id: category.id,
  nameAz: name,
  nameTr: name,
  nameEn: name,
  icon: category.icon || '',
  accent: category.accent || '',
  image: category.image || '',
  sortOrder,
});

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

  const beforeCategories = (await call('catalog.categories')).categories;
  const beerIndex = beforeCategories.findIndex((category) => category.id === 'cat-beer');
  if (beerIndex <= 0) throw new Error(`beer category index is ${beerIndex}`);
  const beer = beforeCategories[beerIndex];
  const previous = beforeCategories[beerIndex - 1];
  await call(
    'catalog.upsertCategory',
    categoryPayload(beer, previous.sortOrder, 'Pivələr — redaktə testi'),
    randomUUID(),
  );
  await call(
    'catalog.upsertCategory',
    categoryPayload(previous, beer.sortOrder),
    randomUUID(),
  );
  const afterCategories = (await call('catalog.categories')).categories;
  if (afterCategories[beerIndex - 1]?.id !== 'cat-beer') {
    throw new Error('category did not move upward');
  }
  if (afterCategories[beerIndex - 1]?.nameAz !== 'Pivələr — redaktə testi') {
    throw new Error('category rename was not saved');
  }

  const beforeProducts = (await call('catalog.products', {
    categoryId: 'cat-ff',
    includeDrafts: true,
  })).products;
  if (beforeProducts.length < 2) throw new Error('not enough products to test ordering');
  const first = beforeProducts[0];
  const second = beforeProducts[1];
  await call(
    'catalog.upsertProduct',
    { id: first.id, categoryId: first.categoryId, nameAz: first.nameAz, sortOrder: second.sortOrder },
    randomUUID(),
  );
  await call(
    'catalog.upsertProduct',
    { id: second.id, categoryId: second.categoryId, nameAz: second.nameAz, sortOrder: first.sortOrder },
    randomUUID(),
  );
  const afterProducts = (await call('catalog.products', {
    categoryId: 'cat-ff',
    includeDrafts: true,
  })).products;
  if (afterProducts[0]?.id !== second.id || afterProducts[1]?.id !== first.id) {
    throw new Error('product card order did not swap');
  }

  process.stdout.write(
    `[catalog-ordering] PASS: category renamed and moved ${beerIndex + 1}->${beerIndex}; ` +
      `products ${first.nameAz}/${second.nameAz} swapped\n`,
  );
} finally {
  const exited = child.exitCode == null
    ? new Promise((resolve) => child.once('exit', resolve))
    : Promise.resolve();
  child.stdin.end();
  if (!child.killed && child.exitCode == null) child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  fs.rmSync(workDir, { recursive: true, force: true });
}
