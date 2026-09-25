import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Every section closed on the website: the till keeps its shape.
 *
 * Before, the sidebar collapsed to a lone "Masalar" and the page was a blank
 * "Buna icazəniz yoxdur". Now every link and the floor plan are drawn, and
 * pressing a table is what gets refused.
 */
const ROOT = path.resolve(__dirname, '../..');
const CORE = path.join(ROOT, 'native', 'build', 'restaurant-pos-core');

test('all areas closed: buttons stay, acting is refused', async () => {
  test.skip(!existsSync(path.join(ROOT, 'out', 'main', 'index.js')), 'stage out/ first');
  const dbDir = mkdtempSync(path.join(tmpdir(), 'pos-locked-'));
  const app = await electron.launch({
    // A separate profile: the owner's own till may be open, and its single-instance lock would end this one.
    args: [ROOT, '--no-sandbox', `--user-data-dir=${path.join(dbDir, 'profile')}`],
    env: {
      ...process.env,
      POS_CORE_PATH: CORE,
      POS_DB_PATH: path.join(dbDir, 'pos.db'),
      POS_LOG_DIR: path.join(dbDir, 'logs'),
      POS_E2E_BYPASS_LICENSE: '1',
      WINEDEBUG: '-all',
    },
  });
  try {
    let page = app.windows().find((w) => w.url().startsWith('app://local/') && !w.url().includes('splash'));
    const deadline = Date.now() + 90_000;
    while (!page && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      page = app.windows().find((w) => w.url().startsWith('app://local/') && !w.url().includes('splash'));
    }
    expect(page, 'main window').toBeTruthy();
    const p = page!;
    await p.waitForLoadState('domcontentloaded');

    // PIN-only login, seeded administrator.
    await expect(p.getByRole('button', { name: '9', exact: true })).toBeVisible({ timeout: 90_000 });
    for (const digit of '9001') await p.getByRole('button', { name: digit, exact: true }).click();
    // The shipped PIN is public: a fresh till asks for a new one, twice.
    await expect(p.getByText(/Yeni 4 rəqəmli PIN/)).toBeVisible({ timeout: 15_000 });
    for (const digit of '4826') await p.getByRole('button', { name: digit, exact: true }).click();
    await expect(p.getByText(/təkrar daxil edin/)).toBeVisible({ timeout: 15_000 });
    for (const digit of '4826') await p.getByRole('button', { name: digit, exact: true }).click();
    await expect(p.locator('aside nav a').first()).toBeVisible({ timeout: 30_000 });

    // The website closes every section (what the 5 s sync would inject).
    await p.evaluate(() => {
      (window as unknown as { __psAccess: string[] }).__psAccess = [];
      window.dispatchEvent(new CustomEvent('ps:access', { detail: [] }));
    });

    // A refusal nobody asked for (a background read) stays silent.
    await p.evaluate(() => { (window as unknown as { __psLastInput: number }).__psLastInput = 0; window.dispatchEvent(new CustomEvent('ps:denied')); });
    await p.waitForTimeout(300);
    await expect(p.getByText('Buna icazəniz yoxdur')).toHaveCount(0);

    const links = p.locator('aside nav a');
    await expect.poll(async () => links.count()).toBeGreaterThan(1);
    await expect(links.first()).toHaveAttribute('aria-disabled', 'true');

    await p.goto(p.url().replace(/#.*$/, '#/tables'));
    await expect(p.locator('[data-ps-locked="true"]')).toBeVisible();
    // The page is drawn, not replaced by the message.
    const pageText = await p.locator('main').innerText();
    expect(pageText.trim()).not.toBe('Buna icazəniz yoxdur');

    await p.screenshot({ path: path.join(dbDir, 'locked-tables.png') });

    // İdarə: every card drawn; opening one is refused and goes nowhere.
    await p.goto(p.url().replace(/#.*$/, '#/admin'));
    const card = p.locator('.ps-hub-link').first();
    await expect(card).toBeVisible();
    const atHub = p.url();
    await card.click({ force: true });
    await expect(p.getByText('Buna icazəniz yoxdur').first()).toBeVisible();
    expect(p.url()).toBe(atHub);
    await p.screenshot({ path: path.join(dbDir, 'locked-admin.png') });

    // Looking around is not working: picking another group still works.
    await p.getByText('Anbar və təchizat').first().click();
    await expect(p.locator('.ps-admin-hub h2', { hasText: 'Anbar və təchizat' })).toBeVisible();

    // A locked sidebar link refuses and does not navigate.
    const before = p.url();
    // aria-disabled makes Playwright wait for an enabled state; a person can press it.
    await links.nth(1).click({ force: true });
    expect(p.url()).toBe(before);
    console.log('screenshot:', path.join(dbDir, 'locked-tables.png'));
  } finally {
    await app.close();
  }
});
