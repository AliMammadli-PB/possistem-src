#!/usr/bin/env node
/**
 * End-to-end check of Aptek POS in Electron (unpackaged, Linux core):
 *   PIN sign-in -> two medicines with their first lot (one sold by the unit, one
 *   prescription-only and expiring soon) -> sale by pack and by unit -> GS1
 *   DataMatrix scan -> prescription recorded -> cash sale -> prescription
 *   journal and expiry report -> an expired box refused -> a new lot received.
 *
 *   node scripts/smoke-aptek-electron.mjs <screenshot-dir> [core-binary]
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
const APP = path.resolve(ROOT, '..', 'aptekpos');
const OUT = path.resolve(process.argv[2] ?? path.join(APP, 'release', 'smoke'));
const CORE = path.resolve(process.argv[3] ?? path.join(APP, 'native', 'build-linux', 'aptek-pos-core'));
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
  tenant: { token: 'smoke', email: 'smoke@aptek.local', customerId: 'smoke', customerName: 'Smoke Aptek', expiresAt: year, paymentUrl: null, licenses: [] },
  activation: { mode: 'active', customerName: 'Smoke Aptek', customerId: 'smoke', deviceId: 'smoke', serverDeviceId: 'smoke', createdAt: Date.now(), validUntil: year, controlUrl: 'http://127.0.0.1:9/pos/api' },
  staffSession: null, pinnedLicenseKey: null,
  backup: { directory: '', password: '', lastBackupAt: 0, retentionDays: 30 },
};
fs.writeFileSync(path.join(USER_DATA, 'market-secure-state.json'), JSON.stringify({ version: 1, encrypted: false, data: Buffer.from(JSON.stringify(seeded)).toString('base64') }));

const port = 9300 + Math.floor(Math.random() * 300);
const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
const child = spawn(electron, [APP, '--password-store=basic'], {
  env: { ...process.env, APTEK_POS_AUTOMATION_PORT: String(port), APTEK_POS_AUTOMATION_USER_DATA: USER_DATA, APTEK_POS_CORE_PATH: CORE, APTEK_POS_CONTROL_URL: 'http://127.0.0.1:9' },
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
    page = browser.contexts()[0]?.pages().find((p) => p.url().startsWith('aptek-pos://'));
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error('Aptek POS window not found');
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

  // 2. Nothing is on sale in a new pharmacy.
  await page.locator('.rail nav button[title="Satış"]').click();
  await expect(page.locator('.catalog-pane .empty')).toBeVisible();
  await shot(page, '02-sale-empty');

  const day = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const yymmdd = (ms) => iso(ms).slice(2).replaceAll('-', '');
  const medicine = async (m) => {
    await page.locator('.rail nav button[title="Dərmanlar"]').click();
    await page.getByRole('button', { name: 'Yeni dərman' }).click();
    const form = page.locator('.modal');
    const field = (label) => form.getByLabel(label, { exact: true });
    const select = (label) => form.locator('label.field').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('select');
    await field('Ad · AZ *').fill(m.name);
    await field('Təsiredici maddə (INN)').fill(m.inn);
    await field('Doza (məs. 500 mq)').fill(m.strength);
    await select('Dərman forması').selectOption(m.form);
    await select('Kateqoriya').selectOption(m.category);
    if (m.rx) await form.getByLabel('Reseptlə satılır').check();
    await field('Qutuda ədəd (tablet, ampula…)').fill(String(m.units));
    if (m.split) await form.getByLabel('Qutu açılıb ədədlə satıla bilər').check();
    await field('Alış qiyməti / qutu · AZN').fill(m.cost);
    await field('Satış qiyməti / qutu · AZN *').fill(m.price);
    await form.locator('.barcode-field input').fill(m.barcode);
    await field('Seriya nömrəsi').fill(m.lot);
    await field('Son istifadə tarixi').fill(iso(m.expiry));
    await field('Say (qutu)').fill(String(m.packs));
    await shot(page, `03-${m.lot}`);
    await form.locator('.modal-primary').click();
    await expect(form).toBeHidden();
  };

  // 3. Two medicines, each arriving as a lot.
  const now = Date.now();
  await medicine({ name: 'Parasetamol', inn: 'Paracetamol', strength: '500 mq', form: 'tablet', category: 'Ağrıkəsici', units: 20, split: true, cost: '1.00', price: '3.00', barcode: '4600000000017', lot: 'P-01', expiry: now + 400 * day, packs: 5 });
  await medicine({ name: 'Amoksisillin', inn: 'Amoxicillin', strength: '500 mq', form: 'capsule', category: 'Antibiotik', rx: true, units: 16, cost: '3.00', price: '6.50', barcode: '4600000000024', lot: 'A-02', expiry: now + 60 * day, packs: 3 });
  await expect(page.locator('.inventory-card')).toHaveCount(2);
  await shot(page, '04-medicines');

  // 4. The list shows both; a pack and one tablet of paracetamol.
  await page.locator('.rail nav button[title="Satış"]').click();
  await expect(page.locator('.med-row:not(.med-head)')).toHaveCount(2);
  const para = page.locator('.med-row', { hasText: 'Parasetamol' });
  await expect(para).toContainText('5 qutu');
  await para.getByRole('button', { name: '+ Qutu' }).click();
  await para.getByRole('button', { name: '+ tablet' }).click();
  await expect(page.locator('.cart-line').first()).toContainText('1 qutu + 1 tablet');
  await shot(page, '05-sale-list');

  // 5. The amoxicillin box is scanned by its GS1 DataMatrix.
  const search = page.locator('.search-box input');
  await search.fill(`(01)04600000000024(17)${yymmdd(now + 60 * day)}(10)A-02`);
  await search.press('Enter');
  await expect(page.locator('.cart-line')).toHaveCount(2);
  await expect(page.locator('.rx-banner')).toBeVisible();

  // 6. A prescription medicine asks for the prescription before payment.
  await page.locator('.checkout-actions .pay').click();
  const rx = page.locator('.modal');
  await rx.getByLabel('Resept nömrəsi *', { exact: true }).fill('RX-7781');
  await rx.getByLabel('Həkim *', { exact: true }).fill('Dr. Əliyeva');
  await rx.getByLabel('Xəstə (ad, soyad) *', { exact: true }).fill('Kamran Həsənov');
  await shot(page, '06-prescription');
  await rx.getByRole('button', { name: 'Ödənişə keç' }).click();
  for (const key of ['2', '0']) await page.locator('.num-pad button', { hasText: new RegExp(`^${key}$`) }).click();
  await shot(page, '07-payment');
  await page.locator('.payment-complete').click();
  await expect(page.locator('.cart-empty')).toBeVisible();

  // 7. An expired box is stopped at the scanner.
  await search.fill(`(01)04600000000017(17)${yymmdd(now - 30 * day)}(10)OLD`);
  await search.press('Enter');
  await expect(page.locator('.cart-empty')).toBeVisible();

  // 8. Reports: the prescription journal and the expiry list.
  await page.locator('.rail nav button[title="Hesabatlar"]').click();
  await expect(page.locator('.pharmacy-reports')).toContainText('RX-7781');
  await expect(page.locator('.pharmacy-reports')).toContainText('A-02');
  await shot(page, '08-reports');

  // 9. A new lot for paracetamol.
  await page.locator('.rail nav button[title="Dərmanlar"]').click();
  await page.locator('.inventory-card', { hasText: 'Parasetamol' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Seriya qəbul et' }).click();
  const lotForm = page.locator('.modal');
  await lotForm.getByLabel('Seriya nömrəsi *', { exact: true }).fill('P-02');
  await lotForm.getByLabel('Son istifadə tarixi *', { exact: true }).fill(iso(now + 700 * day));
  await lotForm.getByLabel('Say (qutu) *', { exact: true }).fill('2');
  await lotForm.locator('.modal-primary').click();
  await expect(lotForm).toBeHidden();
  await page.locator('.rail nav button[title="Satış"]').click();
  await expect(page.locator('.med-row', { hasText: 'Parasetamol' })).toContainText('5 qutu + 19 tablet');
  await shot(page, '09-after-lot');

  if (errors.length) throw new Error(`page errors: ${errors.join('\n')}`);
  console.log(`PASS aptek e2e -> ${OUT}`);
} catch (err) {
  console.error(log.split('\n').slice(-30).join('\n'));
  throw err;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  fs.rmSync(USER_DATA, { recursive: true, force: true });
}
