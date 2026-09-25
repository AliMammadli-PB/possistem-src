#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qaDir = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'qa');
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'asset-spec.json'), 'utf8'),
);

async function sheet(type, columns, cell, labelHeight) {
  const assets = manifest.assets.filter((asset) => asset.type === type);
  const rows = Math.ceil(assets.length / columns);
  const width = columns * cell;
  const height = rows * (cell + labelHeight);
  const composites = [];
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * (cell + labelHeight);
    const image = await sharp(path.join(ROOT, asset.output))
      .resize(cell, cell, { fit: 'cover' })
      .png()
      .toBuffer();
    composites.push({ input: image, left: x, top: y });
    const text = String(asset.nameAz ?? asset.id).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const label = Buffer.from(`<svg width="${cell}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0a0908"/><text x="8" y="${Math.max(15, labelHeight - 7)}" fill="#ead7ad" font-family="Segoe UI,Arial" font-size="${type === 'product' ? 10 : 13}">${text}</text></svg>`);
    composites.push({ input: label, left: x, top: y + cell });
  }
  const output = path.join(qaDir, `${type}-contact-sheet.png`);
  await sharp({ create: { width, height, channels: 3, background: '#0a0908' } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(output);
  process.stdout.write(`[visual-contact-sheet] ${path.relative(ROOT, output)}\n`);
}

fs.mkdirSync(qaDir, { recursive: true });
await sheet('category', 4, 240, 28);
await sheet('product', 10, 120, 22);
await sheet('table', 6, 190, 28);
await sheet('loading', 6, 190, 28);
