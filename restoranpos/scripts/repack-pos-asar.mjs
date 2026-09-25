#!/usr/bin/env node
/**
 * Patch possistem/out into a full Electron asar (node_modules + package.json + out).
 * Never pack `out/` alone — that breaks startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACT = path.join(ROOT, '.tmp-asar-extract');
const OUT = path.join(ROOT, 'out');
const ASAR =
  process.env.POS_ASAR ?? '/home/panda/Desktop/Possistem-Linux/resources/app.asar';
const FALLBACK_ASAR = path.join(
  ROOT,
  'release-1.5.1/win-unpacked/resources/app.asar',
);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(OUT)) {
  console.error('out/ missing — run prepare-package first');
  process.exit(1);
}

if (!fs.existsSync(path.join(EXTRACT, 'package.json'))) {
  const src = fs.existsSync(ASAR) ? ASAR : FALLBACK_ASAR;
  if (!fs.existsSync(src)) {
    console.error('No base asar to extract:', ASAR, FALLBACK_ASAR);
    process.exit(1);
  }
  fs.rmSync(EXTRACT, { recursive: true, force: true });
  console.log('[repack] extract', src);
  run('npx', ['--yes', '@electron/asar', 'extract', src, EXTRACT]);
}

console.log('[repack] sync out/ -> .tmp-asar-extract/out/');
fs.cpSync(OUT, path.join(EXTRACT, 'out'), { recursive: true, force: true });

console.log('[repack] pack ->', ASAR);
run('npx', ['--yes', '@electron/asar', 'pack', EXTRACT, ASAR]);

const stat = fs.statSync(ASAR);
console.log('[repack] done', ASAR, `${Math.round(stat.size / 1024 / 1024)} MB`);
if (stat.size < 100_000_000) {
  console.error('[repack] WARNING: asar looks too small — check structure');
  process.exit(1);
}
