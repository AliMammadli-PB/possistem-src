import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PACKAGED = path.join(ROOT, 'release-1.2.4', 'win-unpacked', 'Milioner POS.exe');
const LEGACY_BACKUP_DIR = path.join(
  process.env.APPDATA ?? '',
  'Maison Aurelia POS',
  'data',
  'backups',
);
const CURRENT_DATABASE = path.join(
  process.env.APPDATA ?? '',
  'Maison Aurelia POS',
  'data',
  'pos.db',
);

async function waitForMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((candidate) => {
      const url = candidate.url();
      return url.startsWith('app://local/') && !url.includes('/splash.html');
    });
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Packaged main window did not open: ${app.windows().map((page) => page.url()).join(', ')}`);
}

test('packaged 1.2.4 opens and upgrades an existing Milioner database', async () => {
  test.skip(process.platform !== 'win32', 'Windows packaged smoke test');
  test.skip(!existsSync(PACKAGED), `Packaged executable missing: ${PACKAGED}`);
  test.skip(
    !existsSync(LEGACY_BACKUP_DIR) && !existsSync(CURRENT_DATABASE),
    'No existing Milioner database or legacy backup is available',
  );
  const activeInstalledInstances = Number(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "@(Get-Process -Name 'Milioner POS' -ErrorAction SilentlyContinue).Count",
      ],
      { encoding: 'utf8' },
    ).trim() || '0',
  );
  test.skip(
    activeInstalledInstances > 0,
    'An installed Milioner POS instance is active and owns the legacy single-instance profile',
  );

  const legacyName = existsSync(LEGACY_BACKUP_DIR)
    ? readdirSync(LEGACY_BACKUP_DIR).find((name) => name.startsWith('pos-pre-migration-v16-to-v17-'))
    : undefined;
  const sourceDatabase = legacyName
    ? path.join(LEGACY_BACKUP_DIR, legacyName)
    : CURRENT_DATABASE;
  test.skip(!existsSync(sourceDatabase), `Database fixture missing: ${sourceDatabase}`);

  const temp = mkdtempSync(path.join(tmpdir(), 'milioner-packaged-'));
  const dbPath = path.join(temp, 'pos.db');
  copyFileSync(sourceDatabase, dbPath);

  const app = await electron.launch({
    executablePath: PACKAGED,
    args: [`--user-data-dir=${path.join(temp, 'user-data')}`],
    env: {
      ...process.env,
      POS_DB_PATH: dbPath,
      POS_LOG_DIR: path.join(temp, 'logs'),
      POS_E2E_BYPASS_LICENSE: '1',
    },
  });

  try {
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getVersion())).toBe('1.2.4');
    const page = await waitForMainWindow(app);
    await expect(page.getByRole('img', { name: 'Milioner' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /9001/ })).toBeVisible();
  } finally {
    await app.close();
  }

  const schemaVersion = execFileSync(
    'python',
    ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute("PRAGMA user_version").fetchone()[0])', dbPath],
    { encoding: 'utf8' },
  ).trim();
  expect(schemaVersion).toBe('22');
  rmSync(temp, { recursive: true, force: true });
});
