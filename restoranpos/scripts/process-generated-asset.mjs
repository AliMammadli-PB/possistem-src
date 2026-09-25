#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'asset-spec.json');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const key = arg('--key');
const source = arg('--source');
if (!key || !source) {
  process.stderr.write('Usage: process-generated-asset.mjs --key <asset-key> --source <generated.png>\n');
  process.exit(2);
}
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
  throw new Error(`Generated source missing: ${source}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const asset = manifest.assets.find((entry) => entry.key === key);
if (!asset) throw new Error(`Unknown asset key: ${key}`);

const output = path.join(ROOT, asset.output);
fs.mkdirSync(path.dirname(output), { recursive: true });

await sharp(source)
  .rotate()
  .resize(asset.width, asset.height, {
    fit: 'cover',
    position: asset.type === 'table' ? 'centre' : 'attention',
    withoutEnlargement: false,
  })
  .png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: true,
    quality: 92,
    colours: 256,
    dither: 0.85,
    effort: 10,
  })
  .toFile(output);

const finalBuffer = fs.readFileSync(output);
const metadata = await sharp(finalBuffer).metadata();
if (metadata.format !== 'png' || metadata.width !== asset.width || metadata.height !== asset.height) {
  throw new Error(
    `Invalid processed image for ${key}: ${metadata.format} ${metadata.width}x${metadata.height}`,
  );
}

asset.status = 'generated';
asset.generatedSource = path.basename(source);
asset.sha256 = createHash('sha256').update(finalBuffer).digest('hex');
asset.bytes = finalBuffer.length;
asset.actualWidth = metadata.width;
asset.actualHeight = metadata.height;
asset.processedAt = new Date().toISOString();

const generated = manifest.assets.filter((entry) => entry.status === 'generated').length;
manifest.generatedAt = generated === manifest.assets.length ? new Date().toISOString() : null;
manifest.progress = { generated, total: manifest.assets.length };
fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(
  `[asset] ${key} -> ${asset.output} (${metadata.width}x${metadata.height}, ${finalBuffer.length} bytes, ${generated}/${manifest.assets.length})\n`,
);
