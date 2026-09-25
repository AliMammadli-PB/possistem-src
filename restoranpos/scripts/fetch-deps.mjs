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
 * pinned version is already present - the repository ships them vendored, so a
 * normal install downloads nothing.
 *
 * Integrity: every download must match the SHA-256 pinned in EXPECTED_SHA256
 * before it is used; a mismatch or a network failure exits non-zero (set
 * POS_ALLOW_MISSING_DEPS=1 to downgrade a *network* failure to a warning for an
 * offline machine). The vendored tree itself is checked against
 * native/third_party/SHA256SUMS by scripts/verify-third-party.mjs before every
 * core build. Bumping a version means updating its hash here in the same commit.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const QRCODEGEN_COMMIT = '3c6d0b3cefb4e049dc337e82237c9644399716a8';

/** SHA-256 of every upstream artifact this script downloads, by exact URL. */
const EXPECTED_SHA256 = {
  [`https://www.sqlite.org/2025/${SQLITE_ARCHIVE}.zip`]: '1d3049dd0f830a025a53105fc79fd2ab9431aea99e137809d064d8ee8356b032',
  [`https://github.com/nlohmann/json/releases/download/v${JSON_VERSION}/json.hpp`]: 'aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63',
  [`https://github.com/catchorg/Catch2/releases/download/v${CATCH2_VERSION}/catch_amalgamated.hpp`]: '8730587447e16531b832407bbf66959e97ad09af445adc118d2df13689dfecab',
  [`https://github.com/catchorg/Catch2/releases/download/v${CATCH2_VERSION}/catch_amalgamated.cpp`]: 'd90d5101269efb3bba00729b8cf14d44a6e6d9b695f9e5c9b4a71345a3bceb99',
  [`https://github.com/gabime/spdlog/archive/refs/tags/v${SPDLOG_VERSION}.tar.gz`]: '15a04e69c222eb6c01094b5c7ff8a249b36bb22788d72519646fb85feb267e67',
  [`https://raw.githubusercontent.com/nayuki/QR-Code-generator/${QRCODEGEN_COMMIT}/cpp/qrcodegen.cpp`]: '8948b57053deb5d132bfc675ca2688b7abef9f03ec633c0de59770c945a66fc9',
  [`https://raw.githubusercontent.com/nayuki/QR-Code-generator/${QRCODEGEN_COMMIT}/cpp/qrcodegen.hpp`]: 'b779c3b156cf7a57ce789d6fee4fc991ccc2913774d26c909d22bb8f26b2a793',
};

let failed = false;
let integrityFailure = false;

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
  const expected = EXPECTED_SHA256[url];
  const actual = createHash('sha256').update(buf).digest('hex');
  if (!expected || actual !== expected) {
    integrityFailure = true;
    throw new Error(`SHA-256 mismatch for ${url}: expected ${expected ?? '(not pinned)'}, got ${actual}`);
  }
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.writeFileSync(destFile, buf);
  return buf.length;
}

/**
 * Windows ships bsdtar at System32\tar.exe, which handles both .zip and .tar.gz.
 * GNU tar (Linux) cannot read .zip, so zips go through unzip there.
 */
function extract(archive, intoDir) {
  fs.mkdirSync(intoDir, { recursive: true });
  if (archive.endsWith('.zip') && process.platform !== 'win32') {
    execFileSync('unzip', ['-q', '-o', archive, '-d', intoDir], { stdio: 'pipe' });
  } else {
    execFileSync('tar', ['-xf', archive, '-C', intoDir], { stdio: 'pipe' });
  }
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

async function qrcodegen() {
  const base = `https://raw.githubusercontent.com/nayuki/QR-Code-generator/${QRCODEGEN_COMMIT}/cpp`;
  await download(`${base}/qrcodegen.cpp`, path.join(TP, 'qrcodegen', 'qrcodegen.cpp'));
  await download(`${base}/qrcodegen.hpp`, path.join(TP, 'qrcodegen', 'qrcodegen.hpp'));
  fs.writeFileSync(
    path.join(TP, 'qrcodegen', 'UPSTREAM.txt'),
    `https://github.com/nayuki/QR-Code-generator\nCommit: ${QRCODEGEN_COMMIT}\nMIT license included in both source files.\n`,
  );
}

function qrcodegenPresent() {
  return ['qrcodegen.cpp', 'qrcodegen.hpp'].every((f) => fs.existsSync(path.join(TP, 'qrcodegen', f)));
}

async function main() {
  fs.mkdirSync(TP, { recursive: true });
  await step('sqlite', SQLITE_VERSION, sqlite);
  await step('nlohmann', JSON_VERSION, nlohmann);
  await step('catch2', CATCH2_VERSION, catch2);
  await step('spdlog', SPDLOG_VERSION, spdlog);
  if (qrcodegenPresent()) log('qrcodegen already vendored - skipping');
  else await step('qrcodegen', QRCODEGEN_COMMIT.slice(0, 12), qrcodegen);

  if (!failed) {
    log('all C++ dependencies vendored.');
    return;
  }
  log('');
  if (integrityFailure) {
    log('A downloaded dependency did not match its pinned SHA-256 - refusing to use it.');
    process.exit(1);
  }
  log('One or more dependencies could not be downloaded, and the core cannot be built without them.');
  log('Re-run once you have network access:   node scripts/fetch-deps.mjs');
  if (process.env.POS_ALLOW_MISSING_DEPS !== '1') process.exit(1);
}

main().catch((err) => {
  log(`unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
