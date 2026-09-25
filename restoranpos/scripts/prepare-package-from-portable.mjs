#!/usr/bin/env node
/**
 * Prepare possistem/out from portable asar, patch branding + logo (no black bg on mark).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASAR = process.env.POS_ASAR ?? '/home/panda/Desktop/Possistem-Linux/resources/app.asar';
const LOGO = process.env.POS_LOGO ?? '/home/panda/Desktop/possistem_logo.png';
const EXTRACT = path.join(ROOT, '.tmp-asar-extract');
const OUT = path.join(ROOT, 'out');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(ASAR)) {
  console.error('asar missing:', ASAR);
  process.exit(1);
}
if (!fs.existsSync(LOGO)) {
  console.error('logo missing:', LOGO);
  process.exit(1);
}

fs.rmSync(EXTRACT, { recursive: true, force: true });
run('npx', ['--yes', '@electron/asar', 'extract', ASAR, EXTRACT]);

const rendererAssets = path.join(EXTRACT, 'out', 'renderer', 'assets');
const markFiles = fs.readdirSync(rendererAssets).filter((f) => f.startsWith('milioner-mark') && f.endsWith('.png'));
if (!markFiles.length) {
  console.error('milioner-mark png not found in asar');
  process.exit(1);
}
for (const f of markFiles) {
  fs.copyFileSync(LOGO, path.join(rendererAssets, f));
  console.log('[prepare] logo ->', f, '(original PNG, no background fill)');
}

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let s = fs.readFileSync(filePath, 'utf8');
  const before = s;
  s = s.replace(/Offline POS/g, 'possistem');
  s = s.replace(/offlinegame\.az/g, 'possistem.az');
  // Logo wrappers: drop forced black tile behind transparent mark
  s = s.replace(/border-gold\/25 bg-black shadow/g, 'border-gold/25 bg-transparent shadow');
  s = s.replace(/border-gold\/35 bg-black shadow/g, 'border-gold/35 bg-transparent shadow');
  s = s.replace(/border-gold\/30 bg-black shadow/g, 'border-gold/30 bg-transparent shadow');
  if (s !== before) fs.writeFileSync(filePath, s);
}

for (const dir of ['out/main', 'out/preload', 'out/renderer']) {
  const base = path.join(EXTRACT, dir);
  if (!fs.existsSync(base)) continue;
  for (const entry of fs.readdirSync(base, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.path ?? base, entry.name);
    if (/\.(js|html|json)$/.test(entry.name)) patchFile(full);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(EXTRACT, 'out'), OUT, { recursive: true });

// Core from offline pos if missing
const coreSrc = path.join(ROOT, '../offline pos/native/build/restaurant-pos-core.exe');
const coreDst = path.join(ROOT, 'native/build/restaurant-pos-core.exe');
fs.mkdirSync(path.dirname(coreDst), { recursive: true });
if (!fs.existsSync(coreDst) && fs.existsSync(coreSrc)) {
  fs.copyFileSync(coreSrc, coreDst);
  console.log('[prepare] core copied from offline pos');
}

console.log('[prepare] out ready at', OUT);
