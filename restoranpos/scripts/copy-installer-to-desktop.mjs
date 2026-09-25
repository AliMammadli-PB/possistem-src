#!/usr/bin/env node
/**
 * Copies the built NSIS installer to the current user's Desktop.
 * Desktop path is resolved dynamically (no hard-coded user folder).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const installerName = `Possistem-Setup-${version}.exe`;
const versioned = path.join(ROOT, `release-${version}`, installerName);
const legacy = path.join(ROOT, 'release', installerName);
const source = fs.existsSync(versioned) ? versioned : legacy;

function fail(msg) {
  process.stderr.write(`[copy-installer] ERROR: ${msg}\n`);
  process.exit(1);
}

function resolveDesktop() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"],
        { encoding: 'utf8' },
      ).trim();
      if (out && fs.existsSync(out)) return out;
    } catch {
      /* fall through */
    }
  }
  return path.join(os.homedir(), 'Desktop');
}

if (!fs.existsSync(source)) fail(`installer not found: ${source}`);

const stat = fs.statSync(source);
if (stat.size < 1024 * 1024) fail(`installer suspiciously small (${stat.size} bytes): ${source}`);

const desktop = resolveDesktop();
if (!fs.existsSync(desktop)) fail(`Desktop folder not found: ${desktop}`);

const dest = path.join(desktop, installerName);
fs.copyFileSync(source, dest);

const hash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
const destStat = fs.statSync(dest);

process.stdout.write(
  [
    `[copy-installer] source : ${source}`,
    `[copy-installer] desktop: ${dest}`,
    `[copy-installer] size   : ${(destStat.size / (1024 * 1024)).toFixed(2)} MB (${destStat.size} bytes)`,
    `[copy-installer] sha256 : ${hash}`,
    `[copy-installer] version: ${version}`,
    '',
  ].join('\n'),
);

if (!fs.existsSync(dest) || fs.statSync(dest).size !== destStat.size) {
  fail('Desktop copy verification failed');
}
