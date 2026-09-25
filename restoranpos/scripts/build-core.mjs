#!/usr/bin/env node
/**
 * Builds the C++ sidecar (restaurant-pos-core.exe).
 *
 * cl.exe is not on PATH in a normal shell, so the MSVC environment has to be
 * sourced from vcvars64.bat first. That is done by writing a small batch file
 * and running it, which avoids the quoting minefield of nesting `call` inside
 * `cmd /c "..."`.
 *
 * Uses the Ninja single-config generator on purpose: the Visual Studio
 * generator appends Debug/ or Release/ to the output directory, which would
 * break both the exe lookup in Electron and the electron-builder packaging glob.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyThirdParty } from './verify-third-party.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE = path.join(ROOT, 'native');
const BUILD = path.join(NATIVE, 'build');
const EXE = path.join(BUILD, 'restaurant-pos-core.exe');

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
const CONFIG = configIndex >= 0 ? (args[configIndex + 1] ?? 'Release') : 'Release';
const CLEAN = args.includes('--clean');
const SKIP_IF_FRESH = args.includes('--if-stale');

function log(msg) {
  process.stdout.write(`[build-core] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[build-core] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: ROOT,
    ...options,
  });
  if (result.error) fail(`${command} could not be started: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with code ${result.status}`);
}

// --------------------------------------------------------------- dependencies
function checkDependencies() {
  const missing = ['sqlite', 'nlohmann', 'spdlog', 'catch2'].filter(
    (dep) => !fs.existsSync(path.join(NATIVE, 'third_party', dep, '.version')),
  );
  if (missing.length > 0) {
    fail(
      `vendored dependencies missing: ${missing.join(', ')}\n` +
        '            Run:  node scripts/fetch-deps.mjs',
    );
  }
  const tampered = verifyThirdParty();
  if (tampered.length > 0) {
    fail(`vendored dependencies do not match native/third_party/SHA256SUMS:\n            ${tampered.join('\n            ')}`);
  }
}

// ------------------------------------------------------------------- codegen
function generateSources() {
  run(process.execPath, [path.join(ROOT, 'scripts', 'gen-protocol.mjs')], { stdio: 'inherit' });
  run(process.execPath, [path.join(ROOT, 'scripts', 'gen-migrations.mjs')], { stdio: 'inherit' });
}

// -------------------------------------------------------------- msvc locating
function findVcvars() {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = path.join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;

  let installPath;
  try {
    installPath = execFileSync(
      vswhere,
      [
        '-latest',
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath',
      ],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
  if (!installPath) return null;

  const vcvars = path.join(installPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  return fs.existsSync(vcvars) ? vcvars : null;
}

function findMinGw() {
  const candidates = [
    'C:\\Qt\\Tools\\mingw1310_64\\bin',
    'C:\\msys64\\mingw64\\bin',
    'C:\\mingw64\\bin',
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'g++.exe'))) return dir;
  }
  return null;
}

/** Linux host → Windows x64 via distro mingw-w64 (g++-mingw-w64-x86-64). */
function findLinuxMingwCross() {
  if (process.platform === 'win32') return null;
  const cxx = 'x86_64-w64-mingw32-g++';
  const cc = 'x86_64-w64-mingw32-gcc';
  const which = (bin) => {
    try {
      return execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };
  const cxxPath = which(cxx);
  const ccPath = which(cc);
  if (!cxxPath || !ccPath) return null;
  return { cc: ccPath, cxx: cxxPath };
}

// ----------------------------------------------------------------- freshness
function isUpToDate() {
  if (!fs.existsSync(EXE)) return false;
  const exeTime = fs.statSync(EXE).mtimeMs;

  const roots = [path.join(NATIVE, 'core'), path.join(NATIVE, 'sidecar'), path.join(NATIVE, 'tests')];
  let newest = 0;

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  roots.forEach(walk);

  for (const extra of [
    path.join(NATIVE, 'CMakeLists.txt'),
    path.join(ROOT, 'database'),
    path.join(ROOT, 'shared', 'contracts', 'protocol.json'),
  ]) {
    if (fs.existsSync(extra)) {
      if (fs.statSync(extra).isDirectory()) walk(extra);
      else newest = Math.max(newest, fs.statSync(extra).mtimeMs);
    }
  }

  return exeTime > newest;
}

// --------------------------------------------------------------------- build
function buildWithMsvc(vcvars) {
  log(`using MSVC: ${vcvars}`);

  const configure = [
    'cmake',
    '-S', `"${NATIVE}"`,
    '-B', `"${BUILD}"`,
    '-G', '"Ninja"',
    `-DCMAKE_BUILD_TYPE=${CONFIG}`,
  ].join(' ');

  const build = `cmake --build "${BUILD}" --config ${CONFIG}`;

  const script = [
    '@echo off',
    `call "${vcvars}" >nul`,
    'if errorlevel 1 exit /b 1',
    configure,
    'if errorlevel 1 exit /b 1',
    build,
    'if errorlevel 1 exit /b 1',
  ].join('\r\n');

  const batch = path.join(os.tmpdir(), `pos-build-${process.pid}.bat`);
  fs.writeFileSync(batch, script, 'utf8');
  try {
    run('cmd.exe', ['/c', batch]);
  } finally {
    try {
      fs.unlinkSync(batch);
    } catch {
      /* best effort */
    }
  }
}

function buildWithMinGw(binDir) {
  log(`MSVC not found - falling back to MinGW at ${binDir}`);
  const env = { ...process.env, PATH: `${binDir};${process.env.PATH}` };

  run('cmake', [
    '-S', NATIVE,
    '-B', BUILD,
    '-G', 'Ninja',
    `-DCMAKE_BUILD_TYPE=${CONFIG}`,
    `-DCMAKE_C_COMPILER=${path.join(binDir, 'gcc.exe')}`,
    `-DCMAKE_CXX_COMPILER=${path.join(binDir, 'g++.exe')}`,
  ], { env });

  run('cmake', ['--build', BUILD], { env });
}

function buildWithLinuxMingwCross(compilers) {
  log(`cross-compiling with ${compilers.cxx}`);
  // Fresh tree: a previous Windows-native CMakeCache breaks the cross toolchain.
  if (fs.existsSync(path.join(BUILD, 'CMakeCache.txt'))) {
    log('clearing native/build CMake cache for cross compile');
    fs.rmSync(BUILD, { recursive: true, force: true });
    fs.mkdirSync(BUILD, { recursive: true });
  }

  run('cmake', [
    '-S', NATIVE,
    '-B', BUILD,
    '-G', 'Ninja',
    `-DCMAKE_BUILD_TYPE=${CONFIG}`,
    '-DCMAKE_SYSTEM_NAME=Windows',
    `-DCMAKE_C_COMPILER=${compilers.cc}`,
    `-DCMAKE_CXX_COMPILER=${compilers.cxx}`,
    '-DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres',
  ]);

  run('cmake', ['--build', BUILD, '--parallel', '1']);
}

// ---------------------------------------------------------------------- main
checkDependencies();
generateSources();

if (CLEAN && fs.existsSync(BUILD)) {
  log('removing previous build tree');
  fs.rmSync(BUILD, { recursive: true, force: true });
}

if (SKIP_IF_FRESH && isUpToDate()) {
  log('core is up to date - skipping build');
  process.exit(0);
}

fs.mkdirSync(BUILD, { recursive: true });

const vcvars = findVcvars();
if (vcvars) {
  buildWithMsvc(vcvars);
} else {
  const mingw = findMinGw();
  const cross = findLinuxMingwCross();
  if (mingw) {
    buildWithMinGw(mingw);
  } else if (cross) {
    buildWithLinuxMingwCross(cross);
  } else {
    fail(
      'no C++ toolchain found.\n' +
        '            Install Visual Studio Build Tools (Windows) or g++-mingw-w64-x86-64 (Linux).',
    );
  }
}

if (!fs.existsSync(EXE)) {
  fail(`build reported success but ${EXE} does not exist`);
}

// The launcher and the main process both spawn `restaurant-pos-core` (no
// extension). On Linux that is a wrapper around Wine, and it lives inside the
// build directory this script clears before a cross compile - so without this
// every rebuild left the app in Safe Mode with "POS core not found".
if (EXE.endsWith('.exe') && process.platform !== 'win32') {
  const wrapper = EXE.slice(0, -'.exe'.length);
  fs.writeFileSync(
    wrapper,
    `#!/usr/bin/env bash
# Generated by scripts/build-core.mjs - the core is a Windows binary run under
# Wine, and this is the single path everything else spawns.
set -euo pipefail
HERE="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export WINEPREFIX="\${WINEPREFIX:-\${XDG_DATA_HOME:-$HOME/.local/share}/possistem/wine}"
export WINEDEBUG="\${WINEDEBUG:--all}"
mkdir -p "$WINEPREFIX"
exec wine "$HERE/${path.basename(EXE)}" "$@"
`,
    { mode: 0o755 },
  );
  log(`wrote ${path.relative(ROOT, wrapper)} (wine wrapper)`);
}

const sizeMb = (fs.statSync(EXE).size / (1024 * 1024)).toFixed(1);
log(`built ${path.relative(ROOT, EXE)} (${sizeMb} MB, ${CONFIG})`);
