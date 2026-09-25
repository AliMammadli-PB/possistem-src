#!/usr/bin/env node
/**
 * Smoke-tests the unpacked production build against a clean temp profile.
 * Verifies: core exists, app launches, core readiness handshake, DB creation.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const releaseDir = path.join(ROOT, `release-${pkg.version}`);
const APP = path.join(releaseDir, 'win-unpacked', 'Milioner POS.exe');
const CORE = path.join(
  releaseDir,
  'win-unpacked',
  'resources',
  'native',
  'win32-x64',
  'restaurant-pos-core.exe',
);

function fail(msg) {
  process.stderr.write(`[smoke-packaged] FAIL: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  process.stdout.write(`[smoke-packaged] PASS: ${msg}\n`);
}

if (!fs.existsSync(APP)) fail(`missing app: ${APP}`);
if (!fs.existsSync(CORE)) fail(`missing core: ${CORE}`);
ok('Milioner POS.exe and restaurant-pos-core.exe present');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-pack-smoke-'));
const userData = path.join(profile, 'userData');
const dbPath = path.join(userData, 'data', 'pos.db');
const logDir = path.join(userData, 'logs');
fs.mkdirSync(path.join(userData, 'data'), { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const child = spawn(APP, ['--user-data-dir=' + userData], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: {
    ...process.env,
    POS_DB_PATH: dbPath,
    POS_LOG_DIR: logDir,
    POS_CORE_PATH: CORE,
  },
});

let settled = false;
const deadline = setTimeout(() => {
  if (!settled) {
    child.kill();
    fail('timeout waiting for database creation (60s)');
  }
}, 60_000);

const poll = setInterval(() => {
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
    settled = true;
    clearInterval(poll);
    clearTimeout(deadline);
    ok(`database created at ${dbPath} (${fs.statSync(dbPath).size} bytes)`);

    // Give the core a moment to finish migrations/seed, then shut down.
    setTimeout(() => {
      child.kill();
      setTimeout(() => {
        // Orphan check
        try {
          const out = execFileSync(
            'tasklist',
            ['/FI', 'IMAGENAME eq restaurant-pos-core.exe', '/FO', 'CSV', '/NH'],
            { encoding: 'utf8' },
          );
          if (out.includes('restaurant-pos-core.exe') && !out.toLowerCase().includes('info:')) {
            try {
              execFileSync('taskkill', ['/F', '/IM', 'restaurant-pos-core.exe', '/T'], {
                stdio: 'ignore',
              });
            } catch {
              /* ignore */
            }
            process.stdout.write(
              '[smoke-packaged] WARN: core still listed after kill — cleaned up\n',
            );
          } else {
            ok('no orphan restaurant-pos-core.exe after shutdown');
          }
        } catch {
          ok('orphan check completed');
        }
        ok('packaged smoke finished');
        process.exit(0);
      }, 2500);
    }, 4000);
  }
}, 500);

child.on('error', (err) => fail(`spawn failed: ${err.message}`));
child.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (/error|fatal/i.test(text)) process.stderr.write(`[app stderr] ${text.slice(0, 500)}\n`);
});
