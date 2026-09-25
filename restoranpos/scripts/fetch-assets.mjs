#!/usr/bin/env node
/**
 * Generates optimised WebP assets for every seed image path plus atmospheric
 * backgrounds and staff portraits. Uses sharp gradients/noise for offline
 * builds; replace with photographed assets for production installs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'assets', 'menu');
const SEED = path.join(ROOT, 'database', 'seed', '001_reference_data.sql');

function hashHue(name) {
  const digest = crypto.createHash('sha1').update(name).digest();
  return digest[0] * 1.4;
}

function hsl(h, s, l) {
  return `hsl(${Math.round(h) % 360} ${s}% ${l}%)`;
}

async function writeGradientWebp(relPath, { width, height, label }) {
  const dest = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 200) return 'skip';

  const hue = hashHue(relPath);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${hsl(hue, 28, 18)}"/>
      <stop offset="55%" stop-color="${hsl(hue + 28, 34, 28)}"/>
      <stop offset="100%" stop-color="${hsl(hue + 50, 40, 42)}"/>
    </linearGradient>
    <radialGradient id="v" cx="30%" cy="20%" r="70%">
      <stop offset="0%" stop-color="rgba(255,230,180,0.22)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>
  <text x="50%" y="52%" text-anchor="middle" fill="rgba(255,236,210,0.72)"
        font-family="Georgia, serif" font-size="${Math.round(width / 14)}">${label}</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .webp({ quality: 78, effort: 4 })
    .toFile(dest);

  const thumb = dest.replace(/\.webp$/i, '.thumb.webp');
  await sharp(dest).resize(320, 320, { fit: 'cover' }).webp({ quality: 70 }).toFile(thumb);
  return 'wrote';
}

function extractSeedPaths(sql) {
  const paths = new Set();
  for (const match of sql.matchAll(/'((?:categories|dishes)\/[^']+\.webp)'/g)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

const EXTRA = [
  'staff/admin.webp',
  'staff/waiter.webp',
  'staff/chef.webp',
  'backgrounds/login.webp',
  'backgrounds/dashboard.webp',
  'backgrounds/empty-orders.webp',
  'backgrounds/empty-tables.webp',
];

const sql = fs.readFileSync(SEED, 'utf8');
const assets = [...new Set([...extractSeedPaths(sql), ...EXTRA])];

fs.mkdirSync(OUT, { recursive: true });

let wrote = 0;
let skipped = 0;
for (const rel of assets) {
  const isBg = rel.startsWith('backgrounds/');
  const isStaff = rel.startsWith('staff/');
  const label = path.basename(rel, '.webp').replace(/-/g, ' ');
  const status = await writeGradientWebp(rel, {
    width: isBg ? 1600 : isStaff ? 640 : 960,
    height: isBg ? 900 : isStaff ? 800 : 720,
    label,
  });
  if (status === 'wrote') {
    wrote += 1;
    process.stdout.write(`[fetch-assets] wrote ${rel}\n`);
  } else {
    skipped += 1;
  }
}

process.stdout.write(`[fetch-assets] done wrote=${wrote} skipped=${skipped} → ${OUT}\n`);
