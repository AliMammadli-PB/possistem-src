#!/usr/bin/env node
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(ROOT, 'release-1.2.2', 'win-unpacked', 'Milioner POS.exe');
const QA = path.join(ROOT, 'docs', 'design', 'milioner-1.2.2', 'qa');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'milioner-qa-'));
const userData = path.join(temp, 'user-data');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(QA, { recursive: true });
fs.writeFileSync(
  path.join(userData, 'display-prefs.json'),
  JSON.stringify({ mode: 'fullscreen', width: 1024, height: 768, zoomFactor: 1 }),
);

if (!fs.existsSync(EXE)) throw new Error(`packaged app missing: ${EXE}`);

async function waitForMainWindow(application) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = application.windows().find((candidate) => {
      const url = candidate.url();
      return url.startsWith('app://local/') && !url.includes('/splash.html');
    });
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`main window did not open: ${application.windows().map((page) => page.url()).join(', ')}`);
}

const app = await electron.launch({
  executablePath: EXE,
  args: [`--user-data-dir=${userData}`],
  env: {
    ...process.env,
    POS_DB_PATH: path.join(temp, 'pos.db'),
    POS_LOG_DIR: path.join(temp, 'logs'),
    POS_E2E_BYPASS_LICENSE: '1',
  },
});

try {
  const page = await waitForMainWindow(app);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('img', { name: 'Milioner' }).waitFor({ timeout: 60_000 });

  await page.getByRole('button', { name: /9001/ }).click();
  for (const digit of '9001') {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.waitForURL(/\/tables$/, { timeout: 30_000 });

  const firstTable = page.locator('button.table-art').first();
  await firstTable.click();
  const tableDialog = page.getByRole('dialog');
  await tableDialog.getByRole('button', { name: 'Yeni sifariş aç', exact: true }).click();
  await page.waitForURL(/\/orders\/tbl-01$/, { timeout: 30_000 });
  await page.locator('section img[alt]').first().waitFor({ timeout: 30_000 });

  const categories = page.locator('main aside').first();
  await categories.locator('button').last().click();
  // Category page two starts with Hot Mezze, Fruit, Mezze.
  await categories.locator('button').nth(2).click();

  const productImages = page.locator('section img[alt]');
  await productImages.nth(11).waitFor({ timeout: 30_000 });
  const visibleProducts = await productImages.count();
  if (visibleProducts !== 12) throw new Error(`expected 12 product cards, got ${visibleProducts}`);

  await page.screenshot({ path: path.join(QA, 'order-1024x768.png') });

  await productImages.first().locator('..').click();
  const orderId = await page.evaluate(async () => {
    const table = await window.pos.tables.get('tbl-01');
    if (!table.success) throw new Error(table.error.message);
    return table.data.orderId;
  });
  if (typeof orderId !== 'string' || !orderId) throw new Error('order id missing');

  await page.locator('main button.bg-oxblood').click();
  await page.waitForURL(new RegExp(`/payments/${orderId}$`), { timeout: 30_000 });
  const customerBill = page.getByRole('button', { name: 'Müştəri çeki', exact: true });
  await customerBill.waitFor({ timeout: 30_000 });
  const before = await page.evaluate(async (id) => {
    await window.pos.settings.set('printer.receipt', 'virtual');
    const res = await window.pos.orders.get(id);
    if (!res.success) throw new Error(res.error.message);
    return { status: res.data.status, totalMinor: res.data.totalMinor, items: res.data.items.length };
  }, orderId);

  await customerBill.click();
  await page.getByText('Müştəri çeki çap olundu; sifariş açıq qaldı').waitFor({ timeout: 30_000 });
  const after = await page.evaluate(async (id) => {
    const res = await window.pos.orders.get(id);
    if (!res.success) throw new Error(res.error.message);
    return { status: res.data.status, totalMinor: res.data.totalMinor, items: res.data.items.length };
  }, orderId);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`customer bill mutated order: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }

  await page.screenshot({ path: path.join(QA, 'payment-customer-bill-1024x768.png') });
  process.stdout.write(
    `QA_SCREENSHOTS_OK products=${visibleProducts} customerBill=open ` +
      `viewport=${page.viewportSize()?.width ?? 1024}x${page.viewportSize()?.height ?? 768}\n`,
  );
} finally {
  await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
