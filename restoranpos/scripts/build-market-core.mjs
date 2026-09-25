#!/usr/bin/env node
/**
 * Builds market-pos-core (Linux native or Windows cross via mingw when available).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET_NATIVE = path.join(ROOT, '..', 'marketpos', 'native');
const BUILD = path.join(MARKET_NATIVE, 'build');
const isWin = os.platform() === 'win32';

function log(msg) {
  process.stdout.write(`[build-market-core] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[build-market-core] ERROR: ${msg}\n`);
  process.exit(1);
}
function run(command, args, opts = {}) {
  const r = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.error) fail(`${command}: ${r.error.message}`);
  if (r.status !== 0) fail(`${command} exited ${r.status}`);
}

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const CONFIG = configIndex >= 0 ? (args[configIndex + 1] ?? 'Release') : 'Release';
const CLEAN = args.includes('--clean');

if (!fs.existsSync(path.join(MARKET_NATIVE, 'third_party', 'sqlite'))) {
  fail('marketpos/native/third_party missing — symlink to ../../restoranpos/native/third_party');
}

run(process.execPath, [path.join(ROOT, 'scripts', 'gen-market-protocol.mjs')]);
run(process.execPath, [path.join(ROOT, 'scripts', 'gen-market-migrations.mjs')]);

if (CLEAN && fs.existsSync(BUILD)) {
  fs.rmSync(BUILD, { recursive: true, force: true });
}
fs.mkdirSync(BUILD, { recursive: true });

const cmake = process.env.CMAKE || 'cmake';
const cross = !isWin && (spawnSync('x86_64-w64-mingw32-g++', ['--version'], { encoding: 'utf8' }).status === 0);

const configure = [cmake, '-S', MARKET_NATIVE, '-B', BUILD, `-DCMAKE_BUILD_TYPE=${CONFIG}`, '-G', 'Ninja'];
if (cross) {
  log('cross-compiling for Windows with mingw');
  configure.push(
    '-DCMAKE_SYSTEM_NAME=Windows',
    '-DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc',
    '-DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++',
    '-DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres',
  );
} else {
  log(`native build (${os.platform()})`);
}

run(configure[0], configure.slice(1));
run(cmake, ['--build', BUILD, '--config', CONFIG, '-j', String(os.cpus().length || 4)]);

const exeName = cross || isWin ? 'market-pos-core.exe' : 'market-pos-core';
const exe = path.join(BUILD, exeName);
if (!fs.existsSync(exe)) fail(`expected binary missing: ${exe}`);
log(`OK ${exe}`);
