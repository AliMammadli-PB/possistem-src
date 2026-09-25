#!/usr/bin/env node
/**
 * Kills orphaned restaurant-pos-core processes and optionally wipes build trees.
 *
 * Orphans from crashed `npm run dev` sessions hold the SQLite WAL lock and make
 * the next launch look like a hang. Always safe to run between sessions.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wipe = process.argv.includes('--wipe');

function log(msg) {
  process.stdout.write(`[dev-clean] ${msg}\n`);
}

if (process.platform === 'win32') {
  try {
    execFileSync(
      'taskkill',
      ['/F', '/IM', 'restaurant-pos-core.exe', '/T'],
      { stdio: 'ignore' },
    );
    log('killed restaurant-pos-core.exe');
  } catch {
    log('no restaurant-pos-core.exe running');
  }
} else {
  try {
    execFileSync('pkill', ['-f', 'restaurant-pos-core'], { stdio: 'ignore' });
    log('killed restaurant-pos-core');
  } catch {
    log('no restaurant-pos-core running');
  }
}

if (wipe) {
  for (const rel of ['native/build', 'out', 'release', 'dist']) {
    const target = path.join(ROOT, rel);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      log(`removed ${rel}`);
    }
  }
}

log('done');
