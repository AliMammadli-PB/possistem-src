import { test, expect, chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * Market till, every section closed on the website: the sidebar and the page
 * stay drawn, and pressing a button answers "Buna icazəniz yoxdur".
 *
 * Runs the renderer in its browser (demo) mode; the stored access list is what
 * a till that last heard "everything closed" starts with.
 */
const MARKET = path.resolve(__dirname, '../../../marketpos');
const PORT = 5199;

test('market: all sections closed, buttons stay, acting is refused', async () => {
  const server: ChildProcess = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: MARKET, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try { await page.goto(`http://localhost:${PORT}/`); break; } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await page.evaluate(() => localStorage.setItem('market.access', '[]'));
    await page.reload();

    // Demo manager (browser mode PINs live in App.tsx).
    await page.getByText(/Müdir|Manager/).first().click();
    for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();

    const nav = page.locator('aside nav button');
    await expect.poll(async () => nav.count()).toBeGreaterThan(5);
    await expect(nav.first()).toHaveAttribute('aria-disabled', 'true');

    const area = page.locator('[data-ps-locked="true"]');
    await expect(area).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Buna icazəniz yoxdur' })).toHaveCount(0);

    // A button inside the closed page is there, and refuses.
    const button = area.locator('button:not([disabled])').first();
    await expect(button).toBeVisible();
    await button.click({ force: true });
    await expect(page.locator('.toast', { hasText: 'Buna icazəniz yoxdur' })).toBeVisible();

    // A locked sidebar entry refuses too.
    await nav.nth(2).click({ force: true });
    await expect(page.locator('.toast', { hasText: 'Buna icazəniz yoxdur' })).toBeVisible();
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'market-locked.png') });
  } finally {
    await browser.close();
    server.kill();
  }
});
