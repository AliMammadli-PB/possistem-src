#!/usr/bin/env node
/** Build verified NSIS and portable Windows executables for Market POS. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import {verifyMarketModules} from './verify-market-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKET = path.join(ROOT, '..', 'marketpos');
const BUILD = path.join(MARKET, 'build');
const RELEASE = path.join(MARKET, 'release');
const marketPackage = JSON.parse(fs.readFileSync(path.join(MARKET, 'package.json'), 'utf8'));
const marketVersion = marketPackage.version;
const allowUnsigned = process.argv.includes('--allow-unsigned');
const signingConfigured = Boolean(process.env.CSC_LINK || process.env.WIN_CSC_LINK);

function fail(message) {
  process.stderr.write(`[market-package] ERROR: ${message}\n`);
  process.exit(1);
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

async function generateIcon() {
  const source = path.join(MARKET, 'public', 'assets', 'marketpos-app-icon-v2.png');
  const iconPng = path.join(BUILD, 'icon.png');
  await sharp(source).resize(512, 512).png().toFile(iconPng);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const files = [];
  for (const size of sizes) {
    const file = path.join(BUILD, `icon-${size}.png`);
    await sharp(source).resize(size, size).png().toFile(file);
    files.push(file);
  }
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), await pngToIco(files));
}

if (!signingConfigured && !allowUnsigned) {
  fail('Code-signing certificate missing. Set CSC_LINK/CSC_KEY_PASSWORD or pass --allow-unsigned for a local test build.');
}
if (!signingConfigured) {
  process.stdout.write('[market-package] WARNING: unsigned local build; Windows SmartScreen may warn.\n');
}

verifyMarketModules();
await generateIcon();
run(process.execPath, [path.join(ROOT, 'scripts', 'build-market-core.mjs')]);
const coreExe = path.join(MARKET, 'native', 'build', 'market-pos-core.exe');
const coreLinux = path.join(MARKET, 'native', 'build', 'market-pos-core');
let builderConfig = 'electron-builder.yml';
if (!fs.existsSync(coreExe)) {
  if (fs.existsSync(coreLinux) && process.platform !== 'win32') {
    process.stdout.write('[market-package] WARNING: market-pos-core.exe missing (Linux host without mingw). Packaging Electron UI without native sidecar resource.\n');
    const raw = fs.readFileSync(path.join(MARKET, 'electron-builder.yml'), 'utf8');
    const stripped = raw.replace(/\nextraResources:[\s\S]*?\nwin:/, '\nwin:');
    const tmp = path.join(BUILD, 'electron-builder.no-core.yml');
    fs.mkdirSync(BUILD, { recursive: true });
    fs.writeFileSync(tmp, stripped);
    builderConfig = tmp;
  } else {
    fail('market-pos-core.exe missing — install mingw cross toolchain or build on Windows');
  }
}
run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', path.join(MARKET, 'tsconfig.json')]);
run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(MARKET, 'vite.config.ts')]);
run(process.execPath, [
  path.join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
  '--win',
  '--x64',
  '--config',
  builderConfig,
  '--publish',
  'never',
], MARKET);
verifyMarketModules({archive:true});

const expected = [
  path.join(RELEASE, `MarketPos-Setup-${marketVersion}.exe`),
  path.join(RELEASE, `MarketPos-Portable-${marketVersion}.exe`),
];
for (const file of expected) {
  if (!fs.existsSync(file)) fail(`Missing artifact: ${file}`);
  if (fs.statSync(file).size < 10 * 1024 * 1024) fail(`Suspiciously small artifact: ${file}`);
  process.stdout.write(`[market-package] ready: ${file}\n`);
}
