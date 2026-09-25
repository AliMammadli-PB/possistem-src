#!/usr/bin/env node
/**
 * Full Windows packaging pipeline:
 *   1. Release C++ core
 *   2. Verify restaurant-pos-core.exe
 *   3. Typecheck + electron-vite production build
 *   4. electron-builder NSIS
 *   5. Verify installer
 *
 * The installer stays in release/. Cashier terminals receive it through the
 * update feed; packaging must not clutter the developer's Desktop.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_EXE = path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe');

function log(msg) {
  process.stdout.write(`[package-win] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[package-win] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(label, command, args) {
  log(label);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status}`);
}

function runNpm(label, args) {
  log(label);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status}`);
}

function runNpx(label, args) {
  log(label);
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const signingConfigured = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);
if (!signingConfigured && process.env.POS_ALLOW_UNSIGNED_PACKAGE !== '1') {
  fail(
    'Windows code-signing is required. Set CSC_LINK/CSC_KEY_PASSWORD, or set ' +
      'POS_ALLOW_UNSIGNED_PACKAGE=1 only for an isolated development build.',
  );
}
if (!signingConfigured) {
  log('WARNING: producing an explicitly allowed unsigned development installer');
}
const installerName = `Possistem-Setup-${pkg.version}.exe`;
const releaseDir = fs.existsSync(path.join(ROOT, 'electron-builder.yml'))
  ? (() => {
      const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8');
      const match = yml.match(/^\s*output:\s*(\S+)/m);
      return match ? path.join(ROOT, match[1]) : path.join(ROOT, 'release');
    })()
  : path.join(ROOT, 'release');
const installerPath = path.join(releaseDir, installerName);

runNpm('typecheck', ['run', 'typecheck']);
runNpm('build:core (Release)', ['run', 'build:core']);

if (!fs.existsSync(CORE_EXE)) {
  fail(`C++ Release executable missing: ${CORE_EXE}`);
}
const coreSize = fs.statSync(CORE_EXE).size;
if (coreSize < 100_000) fail(`C++ executable too small (${coreSize} bytes)`);
log(`core ok: ${CORE_EXE} (${(coreSize / (1024 * 1024)).toFixed(2)} MB)`);

runNpm('build:desktop (electron-vite)', ['run', 'build:desktop']);

const mainJs = path.join(ROOT, 'out', 'main', 'index.js');
const preloadJs = path.join(ROOT, 'out', 'preload', 'index.js');
const rendererHtml = path.join(ROOT, 'out', 'renderer', 'index.html');
for (const file of [mainJs, preloadJs, rendererHtml]) {
  if (!fs.existsSync(file)) fail(`desktop build artifact missing: ${file}`);
}

runNpx('electron-builder NSIS', [
  'electron-builder',
  '--win',
  '--x64',
  '--config',
  'electron-builder.yml',
  '--publish',
  'always',
]);

if (!fs.existsSync(installerPath)) fail(`installer was not produced: ${installerPath}`);
const installerSize = fs.statSync(installerPath).size;
if (installerSize < 1024 * 1024) {
  fail(`installer suspiciously small (${installerSize} bytes)`);
}
log(`installer ok: ${installerPath} (${(installerSize / (1024 * 1024)).toFixed(2)} MB)`);

log('DONE');
