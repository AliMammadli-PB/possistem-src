#!/usr/bin/env node
/**
 * Checks the vendored C++ dependencies against native/third_party/SHA256SUMS,
 * so a modified, missing or extra file fails the core build before it compiles.
 *
 *   node scripts/verify-third-party.mjs          verify (exit 1 on any mismatch)
 *   node scripts/verify-third-party.mjs --write  regenerate after a reviewed bump
 *
 * The manifest itself was produced from upstream archives whose SHA-256 is
 * pinned in scripts/fetch-deps.mjs.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TP = path.join(ROOT, 'native', 'third_party');
const MANIFEST = path.join(TP, 'SHA256SUMS');

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (full !== MANIFEST && !entry.name.startsWith('.')) out.push(full);
  }
  return out;
}

function current() {
  return listFiles(TP)
    .map((file) => [path.relative(TP, file).split(path.sep).join('/'), createHash('sha256').update(fs.readFileSync(file)).digest('hex')])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function verifyThirdParty() {
  if (!fs.existsSync(MANIFEST)) return ['SHA256SUMS missing'];
  const expected = new Map(
    fs.readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean).map((line) => {
      const [hash, ...rest] = line.split('  ');
      return [rest.join('  '), hash];
    }),
  );
  const problems = [];
  const seen = new Set();
  for (const [file, hash] of current()) {
    seen.add(file);
    if (!expected.has(file)) problems.push(`unexpected file: ${file}`);
    else if (expected.get(file) !== hash) problems.push(`modified: ${file}`);
  }
  for (const file of expected.keys()) if (!seen.has(file)) problems.push(`missing: ${file}`);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    fs.writeFileSync(MANIFEST, current().map(([file, hash]) => `${hash}  ${file}`).join('\n') + '\n');
    process.stdout.write(`[verify-third-party] wrote ${path.relative(ROOT, MANIFEST)}\n`);
  } else {
    const problems = verifyThirdParty();
    for (const p of problems) process.stderr.write(`[verify-third-party] ${p}\n`);
    if (problems.length) process.exit(1);
    process.stdout.write('[verify-third-party] ok\n');
  }
}
