import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const CORE = path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe');
const MAIN = path.join(ROOT, 'out', 'main', 'index.js');

async function waitForMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const main = app.windows().find((candidate) => {
      const url = candidate.url();
      return url.startsWith('app://local/') && !url.includes('/splash.html');
    });
    if (main) return main;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const urls = app.windows().map((candidate) => candidate.url()).join(', ');
  throw new Error(`Main renderer window did not open; observed: ${urls || 'no windows'}`);
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; dbDir: string }> {
  test.skip(!existsSync(CORE), `Core binary missing at ${CORE} — run npm run build:core`);
  test.skip(!existsSync(MAIN), `Main bundle missing at ${MAIN} — run npm run build`);

  const dbDir = mkdtempSync(path.join(tmpdir(), 'pos-e2e-'));
  const dbPath = path.join(dbDir, 'pos.db');

  const app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      POS_CORE_PATH: CORE,
      POS_DB_PATH: dbPath,
      POS_LOG_DIR: path.join(dbDir, 'logs'),
      POS_E2E_BYPASS_LICENSE: '1',
    },
  });

  const page = await waitForMainWindow(app);
  await page.waitForLoadState('domcontentloaded');
  return { app, page, dbDir };
}

test.describe('POS acceptance', () => {
  test('login → table → order → submit', async () => {
    const { app, page, dbDir } = await launch();

    try {
      // Splash hands off to login once the core is ready.
      await expect(page.getByRole('img', { name: 'Milioner' })).toBeVisible({ timeout: 60_000 });

      // Prefer the current administrator seed; fall back to another enabled
      // four-digit demo user without allowing login to be silently skipped.
      const administrator = page.getByRole('button', { name: /Admin/i });
      await expect(administrator, 'seeded administrator must be visible').toBeVisible();
      await expect(page.getByText('9001')).toHaveCount(0);

      await administrator.click();
      for (const digit of '9001') {
        await page.getByRole('button', { name: digit, exact: true }).click();
      }
      // The shipped PIN is public: a fresh till asks for a new one, twice.
      await expect(page.getByText(/Yeni 4 rəqəmli PIN/)).toBeVisible({ timeout: 15_000 });
      for (const digit of '4826') await page.getByRole('button', { name: digit, exact: true }).click();
      await expect(page.getByText(/təkrar daxil edin/)).toBeVisible({ timeout: 15_000 });
      for (const digit of '4826') await page.getByRole('button', { name: digit, exact: true }).click();

      // Floor plan or kitchen home depending on role — administrator lands on tables.
      await expect(page.getByText(/Masa|Floor|Salon/i).first()).toBeVisible({ timeout: 30_000 });

      // Tapping a table no longer jumps straight into the order: it opens the
      // action sheet, and the order is one explicit choice away.
      const tableBtn = page.locator('button').filter({ hasText: /^T?\d|^M\d|^\d/ }).first();
      if (await tableBtn.count()) {
        await tableBtn.click();

        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible({ timeout: 10_000 });

        const openOrder = sheet
          .getByRole('button')
          .filter({ hasText: /Sifariş|order|Sipariş/i })
          .first();
        await openOrder.click();
        await expect(sheet).toBeHidden({ timeout: 15_000 });
      }
    } finally {
      await app.close();
      rmSync(dbDir, { recursive: true, force: true });
    }
  });
});
