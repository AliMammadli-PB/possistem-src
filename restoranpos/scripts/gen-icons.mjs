#!/usr/bin/env node
/** Regenerates Milioner PNG/ICO app icons from the canonical vector artwork. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vector = path.join(ROOT, 'build', 'icon.svg');
const src = path.join(ROOT, 'build', 'icon.png');
if (!fs.existsSync(vector)) {
  process.stderr.write('build/icon.svg missing\n');
  process.exit(1);
}
await sharp(vector).resize(1024, 1024, { fit: 'contain' }).png().toFile(src);
if (!fs.existsSync(src)) {
  process.stderr.write('build/icon.png missing\n');
  process.exit(1);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const files = [];
for (const s of sizes) {
  const out = path.join(ROOT, 'build', `icon-${s}.png`);
  await sharp(src).resize(s, s, { fit: 'cover' }).png().toFile(out);
  files.push(out);
}
const buf = await pngToIco(files);
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buf);
process.stdout.write(`[gen-icons] wrote Milioner icon.png + icon.ico (${buf.length} bytes)\n`);
