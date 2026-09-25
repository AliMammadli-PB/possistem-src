#!/usr/bin/env node
import { _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(path.join(tmpdir(), 'milioner-login-qa-'));
const app = await electron.launch({
  args: [ROOT],
  env: {
    ...process.env,
    POS_CORE_PATH: path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe'),
    POS_DB_PATH: path.join(temp, 'pos.db'),
    POS_LOG_DIR: path.join(temp, 'logs'),
    POS_E2E_BYPASS_LICENSE: '1',
  },
});

try {
  const deadline = Date.now() + 60_000;
  let page;
  while (Date.now() < deadline && !page) {
    page = app.windows().find((candidate) => {
      const url = candidate.url();
      return url.startsWith('app://local/') && !url.includes('/splash.html');
    });
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Main renderer did not open');
  await page.getByRole('img', { name: 'Milioner' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /9001/ }).waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const output = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'qa', 'login-screen.png');
  await page.screenshot({ path: output, fullPage: true });
  process.stdout.write(`[login-qa] ${path.relative(ROOT, output)}\n`);
  await page.getByRole('button', { name: /9001/ }).click();
  await page.getByRole('button', { name: '1', exact: true }).waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const pinOutput = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'qa', 'pin-screen.png');
  await page.screenshot({ path: pinOutput, fullPage: true });
  process.stdout.write(`[login-qa] ${path.relative(ROOT, pinOutput)}\n`);
} finally {
  await app.close();
  rmSync(temp, { recursive: true, force: true });
}
