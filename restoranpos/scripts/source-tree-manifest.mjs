#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectoryNames = new Set([
  '.git',
  '.cursor',
  'node_modules',
  'out',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  'logs',
]);
const ignoredRelativePrefixes = [
  'native/build',
  'native/build-',
  'release',
  'release-',
  'control/.data',
];

function ignored(relative, entry) {
  const normalized = relative.replaceAll('\\', '/');
  if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) return true;
  if (entry.isDirectory() && (entry.name === 'release' || entry.name.startsWith('release-'))) return true;
  if (
    entry.isDirectory() &&
    (normalized === 'native/build' || normalized.startsWith('native/build-'))
  ) {
    return true;
  }
  if (/^build\/icon-.*\.png$/i.test(normalized)) return true;
  if (ignoredRelativePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return true;
  }
  if (/^\.env(?:\.|$)/.test(entry.name) || /\.log$/i.test(entry.name) || /\.tsbuildinfo$/i.test(entry.name)) {
    return true;
  }
  return false;
}

function walk(directory, base = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (ignored(relative, entry)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`source manifest refuses symlink: ${relative}`);
    if (entry.isDirectory()) files.push(...walk(absolute, relative));
    else if (entry.isFile()) files.push({ relative, absolute });
  }
  return files;
}

const files = walk(ROOT);
const entries = files.map(({ relative, absolute }) => ({
  path: relative,
  bytes: fs.statSync(absolute).size,
  sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
}));
const treeSha256 = createHash('sha256')
  .update(entries.map((entry) => `${entry.sha256}  ${entry.path}\n`).join(''))
  .digest('hex');

process.stdout.write(`${JSON.stringify({ files: entries.length, treeSha256, entries })}\n`);
