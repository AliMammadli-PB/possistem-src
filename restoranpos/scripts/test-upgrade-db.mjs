/**
 * Smoke-test schema upgrade against a copy of the live production DB.
 *
 *   node scripts/test-upgrade-db.mjs
 *   node scripts/test-upgrade-db.mjs --db "C:\\path\\to\\pos.db"
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe');
const DEFAULT_DB = path.join(
  process.env.APPDATA || '',
  'Maison Aurelia POS',
  'data',
  'pos.db',
);

const argDb = process.argv.includes('--db')
  ? process.argv[process.argv.indexOf('--db') + 1]
  : null;
const sourceDb = argDb || DEFAULT_DB;

function fail(msg) {
  console.error(`[test-upgrade] ERROR: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(CORE)) fail(`core missing: ${CORE} — run npm run build:core`);
if (!fs.existsSync(sourceDb)) fail(`source db missing: ${sourceDb}`);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-upgrade-'));
const testDb = path.join(workDir, 'pos.db');
const logDir = path.join(workDir, 'logs');
fs.mkdirSync(logDir);
fs.copyFileSync(sourceDb, testDb);
for (const side of ['-wal', '-shm']) {
  const p = sourceDb + side;
  if (fs.existsSync(p)) fs.copyFileSync(p, testDb + side);
}

const before = new DatabaseSync(testDb, { readOnly: true });
const beforeVersion = before.prepare('PRAGMA user_version').get().user_version;
const beforeOpen = before
  .prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(total_minor),0) AS total FROM orders " +
      "WHERE status IN ('draft','open','sent','partially_paid') AND total_minor > 0",
  )
  .get();
before.close();
console.log(`[test-upgrade] source=${sourceDb}`);
console.log(`[test-upgrade] copy=${testDb}`);
console.log(`[test-upgrade] before user_version=${beforeVersion}`);

await new Promise((resolve, reject) => {
  const child = spawn(CORE, ['--db', testDb, '--log-dir', logDir, '--protocol', '1'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let buffer = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('timeout waiting for core.ready'));
  }, 30_000);

  child.stderr.on('data', (d) => {
    stderr += d.toString('utf8');
  });

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === 'event' && msg.event === 'core.ready') {
        clearTimeout(timer);
        child.stdin.end();
        child.on('close', (code) => {
          if (code !== 0 && code !== null) {
            reject(new Error(`core exited ${code}\n${stderr.slice(-2000)}`));
          } else {
            resolve();
          }
        });
        return;
      }
    }
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      clearTimeout(timer);
      reject(new Error(`core exited ${code} before ready\n${stderr.slice(-2000)}`));
    }
  });
});

const after = new DatabaseSync(testDb);
const version = after.prepare('PRAGMA user_version').get().user_version;
const activeCats = after
  .prepare('SELECT COUNT(*) AS c FROM menu_categories WHERE active = 1')
  .get().c;
const activeItems = after
  .prepare('SELECT COUNT(*) AS c FROM menu_items WHERE active = 1')
  .get().c;
const name = after
  .prepare("SELECT value FROM app_settings WHERE key = 'restaurant.name'")
  .get()?.value;
const phone = after
  .prepare("SELECT value FROM app_settings WHERE key = 'restaurant.phone'")
  .get()?.value;
const sample = after
  .prepare(
    "SELECT name_az, price_minor FROM menu_items WHERE active = 1 AND name_az = 'Club Sandwich'",
  )
  .get();
const floor = after
  .prepare(
    `SELECT a.name_az AS name, COUNT(t.id) AS tables
     FROM restaurant_areas a
     LEFT JOIN restaurant_tables t ON t.area_id=a.id AND t.active=1
     WHERE a.active=1 GROUP BY a.id ORDER BY a.sort_order`,
  )
  .all();
const tableLabels = after
  .prepare(
    `SELECT a.name_az AS area, t.label
     FROM restaurant_areas a
     JOIN restaurant_tables t ON t.area_id=a.id AND t.active=1
     WHERE a.active=1
     ORDER BY a.sort_order, t.sort_order`,
  )
  .all();
const afterOpen = after
  .prepare(
    "SELECT COUNT(*) AS c, COALESCE(SUM(total_minor),0) AS total FROM orders " +
      "WHERE status IN ('draft','open','sent','partially_paid') AND total_minor > 0",
  )
  .get();
const legacyDrafts = after
  .prepare(
    "SELECT COUNT(*) AS c FROM menu_items WHERE id LIKE 'itm-legacy-%' AND active=0 AND archived=0",
  )
  .get().c;
const depositColumn = after
  .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('orders') WHERE name='deposit_minor'")
  .get().c;

console.log(`[test-upgrade] after user_version=${version}`);
console.log(`[test-upgrade] restaurant=${name} phone=${phone}`);
console.log(`[test-upgrade] active categories=${activeCats} items=${activeItems}`);
console.log(`[test-upgrade] sample=${JSON.stringify(sample)}`);
console.log(`[test-upgrade] floor=${JSON.stringify(floor)}`);
console.log(`[test-upgrade] table labels=${JSON.stringify(tableLabels)}`);
console.log(`[test-upgrade] legacy drafts=${legacyDrafts}`);
console.log(`[test-upgrade] open before=${JSON.stringify(beforeOpen)} after=${JSON.stringify(afterOpen)}`);
after.close();

if (version < 10) fail(`expected schema >= 10, got ${version}`);
if (name !== 'Milioner Pub & Lounge') {
  fail(`expected restaurant.name Milioner Pub & Lounge, got ${name}`);
}
if (phone !== '+994505013540') fail(`expected phone +994505013540, got ${phone}`);
if (activeItems < 100) fail(`expected >=100 active menu items, got ${activeItems}`);
if (!sample || sample.price_minor !== 900) fail('Club Sandwich 9.00 missing');
if (JSON.stringify(floor) !== JSON.stringify([
  { name: 'Zal', tables: 16 },
  { name: 'Bar', tables: 2 },
  { name: 'Kabinet', tables: 3 },
])) fail(`unexpected floor: ${JSON.stringify(floor)}`);
const expectedLabels = [
  ...Array.from({ length: 16 }, (_, index) => ({ area: 'Zal', label: `Masa ${index + 1}` })),
  ...Array.from({ length: 2 }, (_, index) => ({ area: 'Bar', label: `Masa ${index + 1}` })),
  ...Array.from({ length: 3 }, (_, index) => ({ area: 'Kabinet', label: `Masa ${index + 1}` })),
];
if (JSON.stringify(tableLabels) !== JSON.stringify(expectedLabels)) {
  fail(`unexpected table labels: ${JSON.stringify(tableLabels)}`);
}
if (legacyDrafts < 120) fail(`expected photographed menu drafts, got ${legacyDrafts}`);
if (depositColumn !== 1) fail('orders.deposit_minor missing');
if (beforeOpen.total !== afterOpen.total) {
  fail(`open-order value changed: ${beforeOpen.total} -> ${afterOpen.total}`);
}

console.log('[test-upgrade] OK — upgrade path works');
fs.rmSync(workDir, { recursive: true, force: true });
