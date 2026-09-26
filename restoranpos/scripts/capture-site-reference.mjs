#!/usr/bin/env node
/**
 * Screenshots of the real restaurant till at 1280×800, used as the reference
 * the possistem.az demo is matched against.
 *
 *   POS_CORE_PATH=<core binary> node scripts/capture-site-reference.mjs <out-dir>
 */
import { _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? 'site-reference');
mkdirSync(OUT, { recursive: true });
const temp = mkdtempSync(path.join(tmpdir(), 'site-ref-'));
const app = await electron.launch({
  args: [ROOT, '--no-sandbox', '--ozone-platform=x11'],
  env: {
    ...process.env,
    POS_CORE_PATH: process.env.POS_CORE_PATH ?? path.join(ROOT, 'native', 'build', 'restaurant-pos-core'),
    POS_DB_PATH: path.join(temp, 'pos.db'),
    POS_LOG_DIR: path.join(temp, 'logs'),
    POS_E2E_BYPASS_LICENSE: '1',
  },
});

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  // the rendered DOM + computed styles are what the demo copies
  writeFileSync(path.join(OUT, `${name}.html`), await page.content());
  process.stdout.write(`[ref] ${name}\n`);
}

try {
  const deadline = Date.now() + 90_000;
  let page;
  while (Date.now() < deadline && !page) {
    page = app.windows().find((w) => w.url().startsWith('app://local/') && !w.url().includes('splash'));
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }
  if (!page) throw new Error('main window did not open');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '9', exact: true }).waitFor({ timeout: 90_000 });
  await shot(page, '01-login');
  const pad = async (digits) => { for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click(); };
  await pad('9001');
  await page.waitForTimeout(2500);
  await shot(page, '01b-after-9001');
  await page.getByText(/Yeni 4 rəqəmli PIN/).waitFor({ timeout: 15_000 });
  await shot(page, '02-pin-change');
  await pad('4826');
  await page.getByText(/təkrar daxil edin/).waitFor({ timeout: 15_000 });
  await pad('4826');
  await page.waitForTimeout(2500);
  await shot(page, '03-home');
  // Same floor as the site demo: Əsas zal 1-8, Teras 9-12, VIP 13-14.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(temp, 'pos.db'));
  const now = Date.now();
  db.exec("INSERT OR IGNORE INTO restaurant_areas (id,name_az,name_tr,name_en,sort_order,active) VALUES ('area-main','Əsas zal','Ana salon','Main hall',1,1),('area-terrace','Teras','Teras','Terrace',2,1),('area-vip','VIP','VIP','VIP',3,1)");
  const seats = [4, 4, 4, 6, 4, 6, 4, 4, 4, 2, 4, 8, 6, 8];
  const ins = db.prepare('INSERT OR IGNORE INTO restaurant_tables (id,area_id,label,seats,pos_x,pos_y,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?)');
  seats.forEach((n, i) => { const k = i + 1; ins.run(`tbl-${k}`, k <= 8 ? 'area-main' : k <= 12 ? 'area-terrace' : 'area-vip', String(k), n, i % 4, Math.floor(i / 4), k, now); });
  db.close();
  await page.reload();
  await page.waitForTimeout(3000);
  if (await page.getByRole('button', { name: '9', exact: true }).isVisible().catch(() => false)) await pad('4826');
  await page.waitForTimeout(2500);
  await shot(page, '04-tables');
  await page.getByText('3', { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await shot(page, '05-table-tap');
  if (process.env.REF_PAUSE) await page.pause();
  for (const [i, label] of (process.env.REF_NAV ?? '').split(',').filter(Boolean).entries()) {
    await page.getByText(label, { exact: true }).first().click().catch(() => {});
    await shot(page, `1${i}-${label.replace(/\W+/g, '_')}`);
  }
} finally {
  await app.close();
  if (!process.env.REF_KEEP) rmSync(temp, { recursive: true, force: true }); else process.stdout.write(`[ref] kept ${temp}\n`);
}
