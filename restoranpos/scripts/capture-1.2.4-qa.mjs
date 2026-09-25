#!/usr/bin/env node
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = path.join(ROOT, 'release-1.2.4', 'win-unpacked', 'Milioner POS.exe');
const QA = path.join(ROOT, 'docs', 'design', 'milioner-1.2.4', 'qa');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'milioner-1.2.4-qa-'));
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
  await page.setViewportSize({ width: 1024, height: 768 });

  const tableCards = page.locator('button.table-art');
  await tableCards.nth(15).waitFor({ timeout: 30_000 });
  const tableCount = await tableCards.count();
  if (tableCount !== 16) throw new Error('Zal must show exactly 16 tables');
  const forbiddenNames = ['Nar bağı', 'Xəzər', 'Şuşa', 'İçərişəhər', 'Muğam', 'Qız qalası', 'Zəngəzur'];
  const tableText = await tableCards.allTextContents();
  for (const name of forbiddenNames) {
    if (tableText.some((text) => text.includes(name))) throw new Error(`decorative table name remains: ${name}`);
  }
  const tableNumbers = await tableCards.evaluateAll((cards) =>
    cards.map((card) => {
      const number = Array.from(card.querySelectorAll('p')).find((node) => /^\d+$/.test(node.textContent?.trim() ?? ''));
      return {
        value: number?.textContent?.trim() ?? '',
        size: number ? Number.parseFloat(getComputedStyle(number).fontSize) : 0,
      };
    }),
  );
  if (tableNumbers.some((entry, index) => entry.value !== String(index + 1) || entry.size < 40)) {
    throw new Error(`table number hierarchy failed: ${JSON.stringify(tableNumbers)}`);
  }
  await page.screenshot({ path: path.join(QA, 'tables-1024x768.png') });

  await page.getByTitle('Kataloq').click();
  await page.waitForURL(/\/admin\/catalog$/, { timeout: 30_000 });
  const renameButtons = page.getByRole('button', { name: 'Kateqoriya adını dəyiş' });
  await renameButtons.first().waitFor({ timeout: 30_000 });
  if ((await renameButtons.count()) !== 16) throw new Error('all categories must expose rename controls');
  const moveUpCount = await page.getByRole('button', { name: 'Yuxarı daşı' }).count();
  if (moveUpCount < 16) throw new Error('all categories must expose move-up controls');
  await page.screenshot({ path: path.join(QA, 'admin-catalog-ordering-1024x768.png') });

  await page.getByTitle('Masalar').click();
  await page.waitForURL(/\/tables$/, { timeout: 30_000 });
  await tableCards.first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yeni sifariş aç', exact: true }).click();
  await page.waitForURL(/\/orders\/tbl-01$/, { timeout: 30_000 });

  const categoryRail = page.locator('main aside').first();
  const categoryCards = categoryRail.locator('button:has(img)');
  await categoryCards.nth(7).waitFor({ timeout: 30_000 });
  if ((await categoryCards.count()) !== 8) throw new Error('category rail must show eight cards');
  const railBox = await categoryCards.last().boundingBox();
  const controlsBox = await categoryRail.locator('div').last().boundingBox();
  if (!railBox || !controlsBox || controlsBox.y - (railBox.y + railBox.height) > 18) {
    throw new Error('category rail still leaves excessive empty space');
  }

  await categoryRail.locator('button').last().click();
  await categoryCards.first().click();
  const productCards = page.locator('main section button:has(img)');
  await productCards.nth(11).waitFor({ timeout: 30_000 });
  if ((await productCards.count()) !== 12) throw new Error('dense product grid must show twelve cards');
  await page.screenshot({ path: path.join(QA, 'order-categories-1024x768.png') });

  process.stdout.write(
    `QA_1_2_4_OK tables=${tableCount} categories=${await categoryCards.count()} ` +
      `products=${await productCards.count()} viewport=1024x768\n`,
  );
} finally {
  await app.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
