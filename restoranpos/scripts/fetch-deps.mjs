#!/usr/bin/env node
/**
 * Vendors the C++ third-party dependencies into native/third_party/.
 *
 * We deliberately vendor rather than use CMake FetchContent:
 *   - Builds stay hermetic and offline-capable, which matters for a POS.
 *   - CMake 4.x hard-rejects `cmake_minimum_required(VERSION <3.5)`, and several
 *     upstream CMakeLists (notably nlohmann/json <=3.11.3, which declares 3.1)
 *     would fail outright at configure time.
 *
 * Idempotent: each dependency writes a `.version` marker and is skipped when the
 * pinned version is already present. Network failure is a warning, not a hard
 * error, so `npm install` still completes; build-core.mjs re-checks and fails
 * loudly with instructions if anything is missing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TP = path.join(ROOT, 'native', 'third_party');

const SQLITE_VERSION = '3.50.4';
const SQLITE_ARCHIVE = 'sqlite-amalgamation-3500400';
const JSON_VERSION = '3.12.0';
const CATCH2_VERSION = '3.8.1';
const SPDLOG_VERSION = '1.15.3';

let failed = false;

function log(msg) {
  process.stdout.write(`[fetch-deps] ${msg}\n`);
}

function marker(name) {
  return path.join(TP, name, '.version');
}

function isCurrent(name, version) {
  try {
    return fs.readFileSync(marker(name), 'utf8').trim() === version;
  } catch {
    return false;
  }
}

function stamp(name, version) {
  fs.writeFileSync(marker(name), `${version}\n`, 'utf8');
}

async function download(url, destFile) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
  return buf.length;
}

/** Windows ships bsdtar at System32\tar.exe, which handles both .zip and .tar.gz. */
function extract(archive, intoDir) {
  fs.mkdirSync(intoDir, { recursive: true });
  execFileSync('tar', ['-xf', archive, '-C', intoDir], { stdio: 'pipe' });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function tempDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `posdep-${tag}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

async function step(name, version, fn) {
  if (isCurrent(name, version)) {
    log(`${name} ${version} already vendored - skipping`);
    return;
  }
  try {
    log(`fetching ${name} ${version} ...`);
    fs.rmSync(path.join(TP, name), { recursive: true, force: true });
    fs.mkdirSync(path.join(TP, name), { recursive: true });
    await fn();
    stamp(name, version);
    log(`${name} ${version} OK`);
  } catch (err) {
    failed = true;
    log(`FAILED to vendor ${name}: ${err.message}`);
  }
}

async function sqlite() {
  const tmp = tempDir('sqlite');
  try {
    const zip = path.join(tmp, 'sqlite.zip');
    await download(`https://www.sqlite.org/2025/${SQLITE_ARCHIVE}.zip`, zip);
    extract(zip, tmp);
    const src = path.join(tmp, SQLITE_ARCHIVE);
    for (const f of ['sqlite3.c', 'sqlite3.h', 'sqlite3ext.h']) {
      fs.copyFileSync(path.join(src, f), path.join(TP, 'sqlite', f));
    }
  } finally {
    cleanup(tmp);
  }
}

async function nlohmann() {
  // Placed under nlohmann/nlohmann/ so `#include <nlohmann/json.hpp>` resolves
  // with third_party/nlohmann on the include path.
  const dest = path.join(TP, 'nlohmann', 'nlohmann', 'json.hpp');
  await download(
    `https://github.com/nlohmann/json/releases/download/v${JSON_VERSION}/json.hpp`,
    dest,
  );
}

async function catch2() {
  const base = `https://github.com/catchorg/Catch2/releases/download/v${CATCH2_VERSION}`;
  await download(`${base}/catch_amalgamated.hpp`, path.join(TP, 'catch2', 'catch_amalgamated.hpp'));
  await download(`${base}/catch_amalgamated.cpp`, path.join(TP, 'catch2', 'catch_amalgamated.cpp'));
}

async function spdlog() {
  const tmp = tempDir('spdlog');
  try {
    const tgz = path.join(tmp, 'spdlog.tar.gz');
    await download(
      `https://github.com/gabime/spdlog/archive/refs/tags/v${SPDLOG_VERSION}.tar.gz`,
      tgz,
    );
    extract(tgz, tmp);
    const src = path.join(tmp, `spdlog-${SPDLOG_VERSION}`);
    // Compiled-lib mode: we take the headers and the src/*.cpp translation units
    // so spdlog is built once instead of into every consumer.
    copyDir(path.join(src, 'include'), path.join(TP, 'spdlog', 'include'));
    copyDir(path.join(src, 'src'), path.join(TP, 'spdlog', 'src'));
    fs.copyFileSync(path.join(src, 'LICENSE'), path.join(TP, 'spdlog', 'LICENSE'));
  } finally {
    cleanup(tmp);
  }
}

async function main() {
  fs.mkdirSync(TP, { recursive: true });
  await step('sqlite', SQLITE_VERSION, sqlite);
  await step('nlohmann', JSON_VERSION, nlohmann);
  await step('catch2', CATCH2_VERSION, catch2);
  await step('spdlog', SPDLOG_VERSION, spdlog);

  if (failed) {
    log('');
    log('One or more dependencies could not be downloaded (offline?).');
    log('The C++ core cannot be built until they are present.');
    log('Re-run once you have network access:   node scripts/fetch-deps.mjs');
    // Intentionally exit 0 so `npm install` still succeeds.
  } else {
    log('all C++ dependencies vendored.');
  }
}

main().catch((err) => {
  log(`unexpected error: ${err.stack || err.message}`);
  process.exit(0);
});
