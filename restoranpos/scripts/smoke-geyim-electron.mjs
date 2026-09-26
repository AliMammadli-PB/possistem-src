#!/usr/bin/env node
/**
 * End-to-end check of Geyim POS in Electron (unpackaged, Linux core):
 *   PIN sign-in -> new model (3 sizes x 2 colours, opening stock) -> it shows on
 *   the sale screen -> size picker -> barcode scan -> cash sale -> exchange ->
 *   label sheet, plus the same sale screen emulated as a touch screen.
 *
 *   node scripts/smoke-geyim-electron.mjs <screenshot-dir> [core-binary]
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
const APP = path.resolve(ROOT, '..', 'geyimpos');
const OUT = path.resolve(process.argv[2] ?? path.join(APP, 'release', 'smoke'));
const CORE = path.resolve(process.argv[3] ?? path.join(APP, 'native', 'build-linux', 'geyim-pos-core'));
const USER_DATA = fs.mkdtempSync(path.join(OUT, 'user-data-'));
const { hashPin } = createRequire(import.meta.url)(path.join(APP, 'electron', 'staff-auth.cjs'));
fs.mkdirSync(OUT, { recursive: true });

const staffRow = (id, name, role, pin) => {
  const salt = randomBytes(16).toString('hex');
  return { id, name, role, active: true, registerIds: ['reg-1', 'reg-2', 'reg-3'], warehouseIds: ['wh-main', 'wh-cold', 'wh-sales'], salt, pinHash: hashPin(pin, salt) };
};
const year = Date.now() + 365 * 864e5;
const seeded = {
  version: 2,
  staff: [staffRow('u-manager', 'Aysel Müdir', 'manager', '1111'), staffRow('u-cashier', 'Kamran Kassir', 'cashier', '2222'), staffRow('u-warehouse', 'Rəşad Anbar', 'warehouse', '3333')],
  tenant: { token: 'smoke', email: 'smoke@geyim.local', customerId: 'smoke', customerName: 'Smoke Geyim', expiresAt: year, paymentUrl: null, licenses: [] },
  activation: { mode: 'active', customerName: 'Smoke Geyim', customerId: 'smoke', deviceId: 'smoke', serverDeviceId: 'smoke', createdAt: Date.now(), validUntil: year, controlUrl: 'http://127.0.0.1:9/pos/api' },
  staffSession: null, pinnedLicenseKey: null,
  backup: { directory: '', password: '', lastBackupAt: 0, retentionDays: 30 },
};
fs.writeFileSync(path.join(USER_DATA, 'market-secure-state.json'), JSON.stringify({ version: 1, encrypted: false, data: Buffer.from(JSON.stringify(seeded)).toString('base64') }));

const port = 9300 + Math.floor(Math.random() * 300);
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(electron, [APP, '--password-store=basic'], {
  env: { ...process.env, GEYIM_POS_AUTOMATION_PORT: String(port), GEYIM_POS_AUTOMATION_USER_DATA: USER_DATA, GEYIM_POS_CORE_PATH: CORE, GEYIM_POS_CONTROL_URL: 'http://127.0.0.1:9' },
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
    page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('geyim-pos://'));
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error('Geyim POS window not found');
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

  // 2. Nothing is on sale in a new shop.
  await page.locator('.rail nav button[title="Satış"]').click();
  await expect(page.locator('.catalog-pane .empty')).toBeVisible();
  await shot(page, '02-sale-empty');

  // 3. A model in stock: 3 sizes x 2 colours.
  await page.locator('.rail nav button[title="Məhsullar"]').click();
  await page.getByRole('button', { name: 'Yeni model' }).click();
  const form = page.locator('.modal');
  const field = (label) => form.getByLabel(label, { exact: true });
  const select = (label) => form.locator('label.field').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('select');
  await field('Məhsul adı · AZ *').fill('Oxford köynək');
  await field('Artikul / model kodu').fill('KN-100');
  await field('Brend').fill('Oxford');
  await select('Bölmə').selectOption('Kişi');
  await select('Material').selectOption('Pambıq');
  await field('Maya · AZN').fill('21');
  await field('Satış qiyməti · AZN *').fill('49.90');
  for (const size of ['S', 'M', 'L']) await form.locator('.chip-picker button', { hasText: new RegExp(`^${size}$`) }).first().click();
  for (const color of ['Qara', 'Ağ']) await form.locator('.chip-picker.colors button', { hasText: new RegExp(`^${color}$`) }).click();
  await form.getByLabel('Qara M').fill('3');
  await form.getByLabel('Ağ L').fill('2');
  await shot(page, '03-new-model');
  await form.locator('.modal-primary').click();
  await expect(form).toBeHidden();
  await expect(page.locator('.inventory-card')).toHaveCount(6);
  await shot(page, '04-stock');

  // 4. On sale as one model; the picker offers only what is in stock.
  await page.locator('.rail nav button[title="Satış"]').click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('Qalıq: 5');
  await shot(page, '05-sale-model');
  await page.locator('.product-card').click();
  await expect(page.locator('.variant-sizes button:not([disabled])')).toHaveCount(1);
  await shot(page, '06-variant-picker');
  await page.locator('.variant-sizes button:not([disabled])').click();
  await expect(page.locator('.cart-line')).toContainText('Qara · M');

  // 5. A scanned tag goes straight to the exact variant.
  const variants = await page.evaluate(async () => (await window.marketCore.invoke('product.list', {})).data);
  const white = variants.find((row) => row.color === 'Ağ' && row.size === 'L');
  await page.keyboard.type(white.barcode, { delay: 15 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.cart-line')).toHaveCount(2);
  await expect(page.locator('.cart-line').nth(1)).toContainText('Ağ · L');
  await shot(page, '07-cart');

  // 6. Cash sale with the on-screen keypad.
  await page.locator('.checkout-actions .pay').click();
  await page.locator('.num-pad button', { hasText: /^1$/ }).click();
  await page.locator('.num-pad button', { hasText: /^0$/ }).click();
  await page.locator('.num-pad button', { hasText: /^0$/ }).click();
  await expect(page.locator('.payment-summary .change')).toContainText(/0[,.]20/);
  await shot(page, '08-payment');
  await page.locator('.payment-complete').click();
  await expect(page.locator('.cart-empty')).toBeVisible();
  await expect(page.locator('.product-card')).toContainText('Qalıq: 3');

  // 7. Exchange the black M: refund it, the sale screen carries the credit.
  await page.locator('.rail nav button[title="Qaytarma"]').click();
  await page.getByRole('button', { name: /Seçərək qaytar/ }).first().click();
  await page.locator('.return-lines > div').first().locator('button[aria-label="+"]').click();
  await shot(page, '09-return');
  await page.getByRole('button', { name: /^Dəyişmə$/ }).click();
  await expect(page.locator('.exchange-banner')).toBeVisible();
  await expect(page.locator('.product-card')).toContainText('Qalıq: 4');
  await shot(page, '10-exchange');

  // 8. A worn tag typed on the sale screen's pad instead of scanned.
  const blackM = variants.find((row) => row.color === 'Qara' && row.size === 'M');
  for (const digit of blackM.barcode) await page.locator('.barcode-keys button', { hasText: new RegExp(`^${digit}$`) }).click();
  await expect(page.locator('.barcode-display')).toHaveText(blackM.barcode);
  await page.getByRole('button', { name: 'Səbətə at' }).click();
  await expect(page.locator('.cart-line')).toContainText('Qara · M');
  await shot(page, '11-barcode-pad');

  // 9. Label sheet.
  await page.locator('.exchange-banner button').click();
  await page.locator('.rail nav button[title="Məhsullar"]').click();
  await page.getByRole('button', { name: 'Etiket çap et' }).click();
  await expect(page.locator('.label-preview .price-tag svg')).toBeVisible();
  await shot(page, '12-labels');
  await page.keyboard.press('Escape');
  await page.locator('.modal-actions button', { hasText: 'Ləğv et' }).click();

  // 10. Touch screen: coarse pointer enlarges the targets (CSS reacts live).
  await page.locator('.rail nav button[title="Satış"]').click();
  await shot(page, '13-sale-mouse');
  await page.locator('.product-card').click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
  await shot(page, '14-touch-picker');
  await page.keyboard.press('Escape');
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
  console.log(`PASS geyim e2e (touch media ${coarse ? 'on' : 'off'}) -> ${OUT}`);
} catch (err) {
  console.error(log.split('\n').slice(-30).join('\n'));
  throw err;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  fs.rmSync(USER_DATA, { recursive: true, force: true });
}
