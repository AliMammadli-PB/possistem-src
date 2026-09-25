#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = process.platform === 'win32'
  ? path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe')
  : path.join(ROOT, 'native', 'build-linux', 'restaurant-pos-core');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-fresh-db-'));
const dbPath = path.join(workDir, 'pos.db');
const logDir = path.join(workDir, 'logs');
fs.mkdirSync(logDir);

function fail(message) {
  fs.rmSync(workDir, { recursive: true, force: true });
  throw new Error(`[test-fresh-db] ${message}`);
}

if (!fs.existsSync(CORE)) fail(`core missing: ${CORE}`);

await new Promise((resolve, reject) => {
  const child = spawn(CORE, ['--db', dbPath, '--log-dir', logDir, '--protocol', '1'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error(`timeout waiting for core.ready\n${stderr}`));
  }, 30_000);
  child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === 'event' && message.event === 'core.ready') {
          clearTimeout(timer);
          child.stdin.end();
          child.on('close', (code) =>
            code === 0 || code === null
              ? resolve()
              : reject(new Error(`core exited ${code}\n${stderr}`)),
          );
          return;
        }
      } catch {
        // Ignore non-protocol output while waiting for readiness.
      }
    }
  });
  child.on('error', reject);
});

const db = new DatabaseSync(dbPath, { readOnly: true });
const version = db.prepare('PRAGMA user_version').get().user_version;
const floor = db
  .prepare(
    `SELECT a.name_az AS name, COUNT(t.id) AS tables
     FROM restaurant_areas a
     LEFT JOIN restaurant_tables t ON t.area_id=a.id AND t.active=1
     WHERE a.active=1
     GROUP BY a.id
     ORDER BY a.sort_order`,
  )
  .all();
const tableLabels = db
  .prepare(
    `SELECT a.name_az AS area, t.label
     FROM restaurant_areas a
     JOIN restaurant_tables t ON t.area_id=a.id AND t.active=1
     WHERE a.active=1
     ORDER BY a.sort_order, t.sort_order`,
  )
  .all();
const activeCategories = db
  .prepare('SELECT COUNT(*) AS count FROM menu_categories WHERE active=1')
  .get().count;
const activeProducts = db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE active=1').get().count;
const drafts = db
  .prepare("SELECT COUNT(*) AS count FROM menu_items WHERE id LIKE 'itm-legacy-%' AND active=0 AND archived=0")
  .get().count;
db.close();

const expectedFloor = [
  { name: 'Zal', tables: 16 },
  { name: 'Bar', tables: 2 },
  { name: 'Kabinet', tables: 3 },
];

if (version !== 22) fail(`schema is ${version}, expected 22`);
if (JSON.stringify(floor) !== JSON.stringify(expectedFloor)) {
  fail(`floor is ${JSON.stringify(floor)}`);
}
const expectedLabels = expectedFloor.flatMap(({ name, tables }) =>
  Array.from({ length: tables }, (_, index) => ({ area: name, label: `Masa ${index + 1}` })),
);
if (JSON.stringify(tableLabels) !== JSON.stringify(expectedLabels)) {
  fail(`table labels are ${JSON.stringify(tableLabels)}`);
}
if (activeCategories !== 16) fail(`active categories=${activeCategories}`);
if (activeProducts !== 118) fail(`active products=${activeProducts}`);
if (drafts < 120) fail(`legacy drafts=${drafts}`);

process.stdout.write(
  `[test-fresh-db] PASS: schema=${version}, floor=${JSON.stringify(floor)}, active=${activeProducts}, drafts=${drafts}\n`,
);
fs.rmSync(workDir, { recursive: true, force: true });
