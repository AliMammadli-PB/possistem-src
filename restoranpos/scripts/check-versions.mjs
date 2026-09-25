#!/usr/bin/env node
/**
 * Every place that states a product version must state the same one, so the
 * installer, the native core and support telemetry never disagree about which
 * build is running. Also pins the Electron runtime between the lockfile and
 * both electron-builder configs. Exits non-zero on any mismatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET = path.resolve(ROOT, '..', 'marketpos');

const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const cmakeVersion = (file) => /project\([^)]*VERSION\s+([0-9.]+)\)/.exec(fs.readFileSync(file, 'utf8'))?.[1];
const builderElectron = (file) => /^electronVersion:\s*(\S+)/m.exec(fs.readFileSync(file, 'utf8'))?.[1];

const problems = [];
function same(label, values) {
  const distinct = new Set(Object.values(values));
  if (distinct.size !== 1) problems.push(`${label}: ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

for (const [label, dir] of [['restaurant', ROOT], ['market', MARKET]]) {
  const pkg = json(path.join(dir, 'package.json'));
  const lock = json(path.join(dir, 'package-lock.json'));
  same(`${label} version`, {
    'package.json': pkg.version,
    'package-lock.json': lock.version,
    'package-lock root': lock.packages?.['']?.version,
    'native/CMakeLists.txt': cmakeVersion(path.join(dir, 'native', 'CMakeLists.txt')),
  });
}

const restaurantLock = json(path.join(ROOT, 'package-lock.json'));
same('electron runtime', {
  'restoranpos lock': restaurantLock.packages?.['node_modules/electron']?.version,
  'restoranpos electron-builder.yml': builderElectron(path.join(ROOT, 'electron-builder.yml')),
  'marketpos electron-builder.yml': builderElectron(path.join(MARKET, 'electron-builder.yml')),
});

if (problems.length) {
  for (const p of problems) process.stderr.write(`[check-versions] MISMATCH ${p}\n`);
  process.exit(1);
}
process.stdout.write('[check-versions] ok\n');
