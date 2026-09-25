import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const executablePath = resolve(process.argv[2] || 'market-pos/release/win-unpacked/MarketPos.exe');
const screenshotPath = resolve(process.argv[3] || 'market-pos/release/smoke-checkout.png');
const productImagePath = resolve('market-pos/public/assets/marketpos-products-01-v1.png');
const userDataPath = resolve('market-pos/release', `smoke-user-data-${Date.now()}`);
const port = 9100 + Math.floor(Math.random() * 180);
await mkdir(dirname(screenshotPath), { recursive: true });

let stdout = '';
let stderr = '';
const processHandle = spawn(executablePath, [`--user-data-dir=${userDataPath}`], {
  env: { ...process.env, MARKET_POS_DIAGNOSTIC: '1', MARKET_POS_AUTOMATION_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});
processHandle.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
processHandle.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

let browser;
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolveWait) => setTimeout(resolveWait, 500)); }
  }
  if (!browser) throw new Error(`CDP connection failed on port ${port}\n${stderr}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Electron browser context not found');
  let page = context.pages().find((candidate) => candidate.url().startsWith('market-pos://'));
  if (!page) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    page = context.pages().find((candidate) => candidate.url().startsWith('market-pos://'));
  }
  if (!page) throw new Error('Market POS page not found');
  await expect(page.locator('.login-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /MarketPos Kassir/ }).click();
  const one = page.getByRole('button', { name: '1 rəqəmi', exact: true });
  for (let index = 0; index < 4; index += 1) await one.click();
  await page.getByRole('button', { name: /Daxil ol/ }).click();
  await expect(page.locator('.market-shell')).toBeVisible();
  await page.locator('.rail nav button[title="Satış"]').click();
  const search = page.locator('.search-box input');
  await search.fill('4760010001029');
  await search.press('Enter');
  await expect(page.locator('.cart-line')).toContainText('Anchor Kərə Yağı 1 Kq');
  await page.locator('.checkout-actions .pay').click();
  await expect(page.locator('.payment-methods')).toBeVisible();
  await page.locator('.money-field input').fill('50');
  await expect(page.locator('.payment-summary .change')).toContainText(/24[,.]10/);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.locator('.payment-complete').click();
  await expect(page.locator('.cart-empty')).toBeVisible();

  await page.locator('.rail-user').click();
  await expect(page.locator('.login-screen')).toBeVisible();
  await page.getByRole('button', { name: /MarketPos Müdir/ }).click();
  for (const key of ['2', '4', '6', '8']) await page.getByRole('button', { name: `${key} rəqəmi`, exact: true }).click();
  await page.getByRole('button', { name: /Daxil ol/ }).click();
  await page.locator('.rail nav button[title="Məhsullar"]').click();
  await page.getByRole('button', { name: /Yeni məhsul əlavə et/ }).click();
  await page.getByLabel('Məhsul adı · AZ *').fill('Test pendir 500q');
  await page.getByLabel('Название · RU').fill('Тестовый сыр 500г');
  await page.getByLabel('Product name · EN').fill('Test cheese 500g');
  await page.locator('.barcode-field input').fill('4760010099999');
  await page.getByLabel('Maya · AZN').fill('6.20');
  await page.getByLabel('Satış qiyməti · AZN *').fill('8.90');
  await page.getByLabel('Minimum stok').fill('3');
  await page.getByLabel('İlkin stok').fill('7');
  await page.locator('.file-fallback input').setInputFiles(productImagePath);
  await page.locator('.modal-actions .modal-primary').click();
  await expect(page.locator('.data-card')).toContainText('Test pendir 500q');
  await page.locator('.rail nav button[title="Satış"]').click();
  await page.locator('.search-box input').fill('4760010099999');
  await page.locator('.search-box input').press('Enter');
  await expect(page.locator('.cart-line')).toContainText('Test pendir 500q');

  await page.reload();
  await expect(page.locator('.login-screen')).toBeVisible();
  await page.getByRole('button', { name: /MarketPos Müdir/ }).click();
  for (const key of ['2', '4', '6', '8']) await page.getByRole('button', { name: `${key} rəqəmi`, exact: true }).click();
  await page.getByRole('button', { name: /Daxil ol/ }).click();
  await page.locator('.rail nav button[title="Məhsullar"]').click();
  await page.locator('.table-search input').fill('4760010099999');
  await expect(page.locator('.data-card')).toContainText('Test pendir 500q');

  await page.locator('.rail nav button[title="Alışlar"]').click();
  await page.getByRole('button', { name: /Yeni alış sifarişi/ }).click();
  await page.getByLabel('Təchizatçı *').fill('Smoke Test Supplier');
  await page.getByRole('button', { name: /Siyahıya əlavə et/ }).click();
  await page.locator('.modal-actions .modal-primary').click();
  await expect(page.locator('.po-grid')).toContainText('Smoke Test Supplier');

  await page.locator('.rail nav button[title="Parametrlər"]').click();
  const updateButton = page.getByRole('button', { name: /Yeniləməni yoxla/ });
  await updateButton.click();
  await expect(updateButton).toBeEnabled({ timeout: 20_000 });
  const updateStatusText = (await page.locator('.update-box').innerText()).replace(/\s+/g, ' ').trim();
  const preset = page.getByRole('button', { name: /1024×768/ });
  await expect(preset).toBeVisible();
  await preset.click();
  await page.waitForTimeout(500);
  const windowedSize = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  await page.keyboard.press('F11');
  await page.waitForTimeout(700);
  const fullscreenSize = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const fullscreenState = await page.evaluate(() => window.marketSystem?.display.get());
  expect(fullscreenState?.prefs.mode).toBe('fullscreen');

  process.stdout.write(JSON.stringify({ ok: true, cashierFlow: { login: 'cashier', barcode: '4760010001029', product: 'Anchor Kərə Yağı 1 Kq', totalMinor: 2590, tenderedMinor: 5000, changeMinor: 2410 }, managerFlow: { login: 'manager', createdProduct: 'Test pendir 500q', barcode: '4760010099999', imageAttached: true, persistedAfterReload: true, purchaseOrderCreated: true }, updateFlow: { buttonRecovered: true, status: updateStatusText }, displayFlow: { preset: '1024x768', windowedSize, f11FullscreenSize: fullscreenSize, f11Mode: fullscreenState?.prefs.mode, f11Toggled: fullscreenState?.prefs.mode === 'fullscreen' }, screenshotPath, renderer: stdout.includes('mounted rootChildren=1') }, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  if (!processHandle.killed) processHandle.kill();
}
