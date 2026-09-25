#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'docs', 'design', 'milioner-1.2.2', 'asset-spec.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expected = { category: 16, product: 118, table: 36, loading: 30 };

function fail(message) {
  throw new Error(`[visual-assets] ${message}`);
}

if (manifest.release !== '1.2.2') fail(`release is ${manifest.release}`);
if (manifest.assets.length !== 200) fail(`expected 200 assets, got ${manifest.assets.length}`);

const hashes = new Set();
for (const [type, count] of Object.entries(expected)) {
  const actual = manifest.assets.filter((asset) => asset.type === type).length;
  if (actual !== count) fail(`expected ${count} ${type} assets, got ${actual}`);
}

for (const asset of manifest.assets) {
  if (asset.status !== 'generated') fail(`${asset.key} status is ${asset.status}`);
  const file = path.join(ROOT, asset.output);
  if (!fs.existsSync(file)) fail(`${asset.key} missing ${asset.output}`);
  const bytes = fs.readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) fail(`${asset.key} SHA-256 mismatch`);
  if (hashes.has(sha256)) fail(`${asset.key} duplicates another PNG`);
  hashes.add(sha256);
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'png') fail(`${asset.key} is ${metadata.format}, expected png`);
  if (metadata.width !== asset.width || metadata.height !== asset.height) {
    fail(`${asset.key} is ${metadata.width}x${metadata.height}, expected ${asset.width}x${asset.height}`);
  }
}

process.stdout.write('[visual-assets] PASS: 118 products, 16 categories, 36 tables, 30 loading frames; 200 unique audited PNGs\n');
