#!/usr/bin/env node
/**
 * End-to-end check of Topdan POS (wholesale) in Electron (unpackaged, Linux core):
 *   PIN sign-in -> goods with a pack and three price levels (one with a
 *   generated barcode) -> a wholesale customer with a credit limit -> an
 *   invoice in packs and pieces, repriced when the buyer is chosen -> paid on
 *   credit -> A4 invoice -> debt shown, part paid back, statement -> stock
 *   left in packs -> goods added from the price list.
 *
 *   node scripts/smoke-topdan-electron.mjs <screenshot-dir> [core-binary]
 *
 * The account and licence are seeded locally and the control API points at a
 * closed port, so nothing reaches possistem.az.
 */
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.resolve(ROOT, '..', 'topdanpos');
const OUT = path.resolve(process.argv[2] ?? path.join(APP, 'release', 'smoke'));
const CORE = path.resolve(process.argv[3] ?? path.join(APP, 'native', 'build-linux', 'topdan-pos-core'));
fs.mkdirSync(OUT, { recursive: true });
const USER_DATA = fs.mkdtempSync(path.join(OUT, 'user-data-'));
const { hashPin } = createRequire(import.meta.url)(path.join(APP, 'electron', 'staff-auth.cjs'));

const staffRow = (id, name, role, pin) => {
  const salt = randomBytes(16).toString('hex');
  return { id, name, role, active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'], salt, pinHash: hashPin(pin, salt) };
};
const year = Date.now() + 365 * 864e5;
const seeded = {
  version: 2,
  staff: [staffRow('u-manager', 'Aysel Müdir', 'manager', '1111'), staffRow('u-cashier', 'Kamran Kassir', 'cashier', '2222'), staffRow('u-warehouse', 'Rəşad Anbar', 'warehouse', '3333')],
  tenant: { token: 'smoke', email: 'smoke@topdan.local', customerId: 'smoke', customerName: 'Smoke Topdan', expiresAt: year, paymentUrl: null, licenses: [] },
  activation: { mode: 'active', customerName: 'Smoke Topdan', customerId: 'smoke', deviceId: 'smoke', serverDeviceId: 'smoke', createdAt: Date.now(), validUntil: year, controlUrl: 'http://127.0.0.1:9/pos/api' },
  staffSession: null, pinnedLicenseKey: null,
  backup: { directory: '', password: '', lastBackupAt: 0, retentionDays: 30 },
};
fs.writeFileSync(path.join(USER_DATA, 'market-secure-state.json'), JSON.stringify({ version: 1, encrypted: false, data: Buffer.from(JSON.stringify(seeded)).toString('base64') }));

const port = 9300 + Math.floor(Math.random() * 300);
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(electron, [APP, '--password-store=basic'], {
  env: { ...process.env, TOPDAN_POS_AUTOMATION_PORT: String(port), TOPDAN_POS_AUTOMATION_USER_DATA: USER_DATA, TOPDAN_POS_CORE_PATH: CORE, TOPDAN_POS_CONTROL_URL: 'http://127.0.0.1:9' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
let browser;
try {
  for (let i = 0; i < 60 && !browser; i += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!browser) throw new Error(`no CDP\n${log}`);
  let page;
  for (let i = 0; i < 40 && !page; i += 1) {
    page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('topdan-pos://'));
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error('Topdan POS window not found');
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('dialog', (dialog) => { console.log(`dialog: ${dialog.message()}`); void dialog.accept(); });

  // 1. PIN only: the PIN names the person.
  await expect(page.locator('.mp-staff-pad')).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-pin');
  for (const d of '1111') await page.locator('.mp-staff-pad button', { hasText: new RegExp(`^${d}$`) }).click();
  // First sign-in on a PC names its register.
  const registerName = page.getByRole('textbox', { name: 'Kassa adı' });
  await expect(registerName.or(page.locator('.market-shell'))).toBeVisible({ timeout: 20_000 });
  if (await registerName.isVisible()) {
    await registerName.fill('Kassa 1');
    await page.getByRole('button', { name: 'Kassanı aç' }).click();
  }
  await expect(page.locator('.market-shell')).toBeVisible({ timeout: 20_000 });

  // 2. A new warehouse sells nothing yet.
  await page.locator('.rail nav button[title="Satış"]').click();
  await expect(page.locator('.invoice-empty')).toBeVisible();
  await shot(page, '02-invoice-empty');

  const goods = async (g) => {
    await page.locator('.rail nav button[title="Mallar"]').click();
    await page.getByRole('button', { name: 'Yeni mal' }).click();
    const form = page.locator('.modal');
    const field = (label) => form.getByLabel(label, { exact: true });
    const select = (label) => form.locator('label.field').filter({ has: page.locator('span', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }) }).locator('select');
    await field('Ad · AZ *').fill(g.name);
    await field('Brend / istehsalçı').fill(g.brand);
    await select('Kateqoriya').selectOption(g.category);
    await select('Ədəd vahidi').selectOption(g.unit);
    await select('Qablaşdırma (yeşik, blok…)').selectOption(g.pack);
    await field('Qablaşdırmada ədəd').fill(String(g.per));
    await form.locator('.price-levels label').nth(0).locator('input').fill(g.cost);
    await form.locator('.price-levels .retail input').fill(g.retail);
    await form.locator('.price-levels .wholesale input').fill(g.wholesale);
    await form.locator('.price-levels .dealer input').fill(g.dealer);
    if (g.barcode) await form.locator('.barcode-field input').fill(g.barcode);
    else {
      await form.getByRole('button', { name: 'Barkod yarat' }).click();
      await expect(form.locator('.barcode-field input')).toHaveValue(/^20\d{11}$/);
    }
    await form.locator('.shelf-field input').fill(g.shelf);
    await field(`Say · ${g.pack}`).fill(String(g.packs));
    await shot(page, `03-${g.shelf}`);
    await form.locator('.modal-primary').click();
    await expect(form).toBeHidden();
  };

  // 3. Two goods with packs and three price levels.
  await goods({ name: 'Su 1.5 L', brand: 'Sirab', category: 'Su', unit: 'şüşə', pack: 'yeşik', per: 6, cost: '5.40', retail: '9.00', wholesale: '7.20', dealer: '6.00', barcode: '4760000000017', shelf: 'A-1', packs: 50 });
  await goods({ name: 'Şəkər 1 kq', brand: 'Azərsun', category: 'Şəkər və duz', unit: 'paket', pack: 'kisə', per: 10, cost: '14.00', retail: '19.00', wholesale: '17.00', dealer: '16.00', shelf: 'B-2', packs: 20 });
  await expect(page.locator('.inventory-card')).toHaveCount(2);
  await shot(page, '04-goods');

  // 4. A wholesale customer with a 1000 AZN credit limit.
  await page.locator('.rail nav button[title="Müştərilər"]').click();
  await page.getByRole('button', { name: 'Yeni müştəri' }).click();
  const cust = page.locator('.modal');
  await cust.getByLabel('Müştəri / firma adı *', { exact: true }).fill('Nərgiz Market');
  await cust.getByLabel('Telefon', { exact: true }).fill('+994 50 555 11 22');
  await cust.getByLabel('VÖEN', { exact: true }).fill('1234567891');
  await cust.getByLabel('Ünvan', { exact: true }).fill('Bakı, Yasamal');
  await cust.getByRole('radio', { name: /^Topdan/ }).click();
  await cust.getByLabel('Nisyə satış olar').check();
  await cust.getByLabel('Nisyə limiti · AZN', { exact: true }).fill('1000');
  await shot(page, '05-customer');
  await cust.locator('.modal-primary').click();
  await expect(cust).toBeHidden();
  await expect(page.locator('.customer-row', { hasText: 'Nərgiz Market' })).toContainText('Topdan');

  // 5. An invoice: 3 cases + 2 bottles, at retail, then repriced for the shop.
  await page.locator('.rail nav button[title="Satış"]').click();
  const search = page.locator('.invoice-entry .search-box input');
  await search.fill('4760000000017');
  await search.press('Enter');
  const water = page.locator('.invoice-row', { hasText: 'Su 1.5 L' });
  await expect(water).toBeVisible();
  const [packsBox, piecesBox] = [water.locator('.qty-cell').nth(0), water.locator('.qty-cell').nth(1)];
  await packsBox.getByRole('button', { name: 'Artır' }).click();
  await packsBox.getByRole('button', { name: 'Artır' }).click();
  await piecesBox.locator('input').fill('2');
  await expect(packsBox.locator('input')).toHaveValue('3');
  const grand = page.locator('.invoice-sums .grand dd');
  await expect(grand).toContainText(/30[.,]00/);
  await page.locator('.buyer-card').click();
  await page.locator('.customer-pick-list button', { hasText: 'Nərgiz Market' }).click();
  await expect(page.locator('.buyer-card')).toContainText('1234567891');
  await expect(grand).toContainText(/24[.,]00/);
  await shot(page, '06-invoice');

  // 6. Paid on credit; the A4 invoice names the buyer and says the sum in words.
  await page.locator('.invoice-actions .pay').click();
  const pay = page.locator('.modal');
  await pay.locator('.pay-quick button').nth(2).click();
  await shot(page, '07-payment');
  await pay.locator('.payment-complete').click();
  const doc = page.locator('.doc-preview .invoice-doc');
  await expect(doc).toBeVisible();
  await expect(doc).toContainText('Nərgiz Market');
  await expect(doc).toContainText('iyirmi dörd manat 00 qəpik');
  await expect(doc).toContainText('3 yeşik + 2 şüşə');
  await shot(page, '08-invoice-a4');
  await page.locator('.modal .modal-actions').getByRole('button', { name: 'Bağla' }).click();
  await expect(page.locator('.invoice-empty')).toBeVisible();

  // 7. The debt: 24 AZN owed, 10 paid back, statement shows both.
  await page.locator('.rail nav button[title="Müştərilər"]').click();
  const row = page.locator('.customer-row', { hasText: 'Nərgiz Market' });
  await expect(row).toContainText(/24[.,]00/);
  await row.getByRole('button', { name: 'Borc ödənişi' }).click();
  await page.locator('.modal').getByLabel('Məbləğ · AZN', { exact: true }).fill('10');
  await page.locator('.modal .modal-primary').click();
  await expect(row).toContainText(/14[.,]00/);
  await row.getByRole('button', { name: 'Üzləşmə aktı' }).click();
  await expect(page.locator('.statement-doc tbody tr')).toHaveCount(2);
  await shot(page, '09-statement');
  await page.locator('.modal').getByRole('button', { name: 'Ləğv et' }).click();

  // 8. Stock is kept in pieces and shown in cases: 300 - 20 = 46 cases + 4 bottles.
  await page.locator('.rail nav button[title="Mallar"]').click();
  await expect(page.locator('.inventory-card', { hasText: 'Su 1.5 L' })).toContainText('46 yeşik + 4 şüşə');

  // 9. The price list at the buyer's level adds a sack of sugar.
  await page.locator('.rail nav button[title="Satış"]').click();
  await page.getByRole('button', { name: 'Qiymət siyahısı' }).click();
  await page.locator('.price-row', { hasText: 'Şəkər 1 kq' }).getByRole('button', { name: '+ kisə' }).click();
  await page.locator('.modal header button').click();
  await expect(page.locator('.invoice-row', { hasText: 'Şəkər 1 kq' })).toBeVisible();
  await expect(page.locator('.invoice-sums .grand dd')).toContainText(/19[.,]00/);
  await shot(page, '10-price-list');

  if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
  console.log(`PASS topdan e2e -> ${OUT}`);
} catch (err) {
  console.error(log.split('\n').slice(-30).join('\n'));
  throw err;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  fs.rmSync(USER_DATA, { recursive: true, force: true });
}
