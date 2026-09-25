#!/usr/bin/env node
/**
 * Patch restaurant-pos-core.exe receipt logo slots (no C++ rebuild needed).
 *
 * The Windows core embeds a fixed MR logo as:
 *   - HTML preview PNG base64 (max ~1591 chars)
 *   - ESC/POS mono bitmap 384x234 (11232 bytes)
 *
 * Usage:
 *   node scripts/patch-core-receipt-logo.mjs --clear [--exe path]
 *   node scripts/patch-core-receipt-logo.mjs --png /path/logo.png [--exe path]
 *   node scripts/patch-core-receipt-logo.mjs --data-url 'data:image/png;base64,...'
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_EXES = [
  path.join(ROOT, 'native', 'build', 'restaurant-pos-core.exe'),
  path.join(ROOT, 'release-1.5.2', 'win-unpacked', 'resources', 'native', 'win32-x64', 'restaurant-pos-core.exe'),
  path.join(ROOT, 'release-1.5.1', 'win-unpacked', 'resources', 'native', 'win32-x64', 'restaurant-pos-core.exe'),
  '/home/panda/Desktop/Possistem-Linux/resources/native/win32-x64/restaurant-pos-core.exe',
];

const IMG_MARK = Buffer.from('<img class="logo" alt="Milioner" src="data:image/png;base64,');
const B64_MARK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAANwAAACGAgMAAADLIQyD');
const BITS_LEN = 11232; // 384 x 234, stride 48
const TARGET_W = 384;
const TARGET_H = 234;

function parseArgs(argv) {
  const out = { clear: false, png: null, dataUrl: null, exes: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clear') out.clear = true;
    else if (a === '--png') out.png = argv[++i];
    else if (a === '--data-url') out.dataUrl = argv[++i];
    else if (a === '--exe') out.exes.push(argv[++i]);
  }
  return out;
}

const SLOTS_FILE = path.join(ROOT, 'native', 'build', 'receipt-logo-slots.json');

function loadSavedSlots() {
  try {
    return JSON.parse(fs.readFileSync(SLOTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveSlots(slots) {
  fs.mkdirSync(path.dirname(SLOTS_FILE), { recursive: true });
  fs.writeFileSync(SLOTS_FILE, JSON.stringify(slots, null, 2));
}

function findSlots(buf) {
  const saved = loadSavedSlots();
  let b64At = buf.indexOf(B64_MARK);
  let imgAt = buf.indexOf(IMG_MARK);
  if (imgAt < 0) imgAt = buf.indexOf(Buffer.from('<!-- receipt logo disabled'));

  if (b64At < 0 && imgAt > 0) {
    const probe = buf.lastIndexOf(Buffer.from('iVBORw0KGgo'), imgAt);
    if (probe >= 0) b64At = probe;
  }
  if (b64At < 0 && saved?.b64At >= 0) b64At = saved.b64At;
  if (imgAt < 0 && saved?.imgAt >= 0) imgAt = saved.imgAt;

  let bitsAt = -1;
  if (imgAt >= 0) {
    const guess = imgAt + 2008; // stock delta
    if (guess + BITS_LEN <= buf.length) bitsAt = guess;
  }
  if (bitsAt < 0 && b64At >= 0) {
    const guess = b64At + 4144;
    if (guess + BITS_LEN <= buf.length) bitsAt = guess;
  }
  if (bitsAt < 0 && saved?.bitsAt >= 0) bitsAt = saved.bitsAt;

  const b64Cap = saved?.b64Cap ?? (b64At >= 0 ? Math.max(1, buf.indexOf(0, b64At) - b64At) : 1592);
  return { imgAt, b64At, b64Cap, bitsAt };
}

function writeFixed(buf, at, payload, maxLen) {
  if (at < 0) throw new Error('slot missing');
  if (payload.length > maxLen) throw new Error(`payload ${payload.length} > slot ${maxLen}`);
  buf.fill(0, at, at + maxLen);
  payload.copy(buf, at);
}

async function logoAssetsFromPng(pngBuf) {
  const prepared = await sharp(pngBuf)
    .ensureAlpha()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(TARGET_W, TARGET_H, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  const { data, info } = await sharp(prepared).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const stride = Math.ceil(width / 8);
  const bits = Buffer.alloc(BITS_LEN, 0);
  const rowStride = stride;
  for (let y = 0; y < Math.min(height, TARGET_H); y++) {
    for (let x = 0; x < Math.min(width, TARGET_W); x++) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = info.channels > 3 ? data[i + 3] : 255;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const on = a > 128 && luminance < 140;
      if (on) bits[y * rowStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  // Compact preview PNG must fit the stock base64 slot (~1591 chars).
  let preview = prepared;
  let b64 = preview.toString('base64');
  for (const w of [220, 160, 120, 96, 72]) {
    if (b64.length <= 1591) break;
    preview = await sharp(prepared).resize(w, null, { fit: 'inside' }).png({ palette: true, colors: 4, compressionLevel: 9 }).toBuffer();
    b64 = preview.toString('base64');
  }
  if (b64.length > 1591) {
    throw new Error(`preview base64 still too large (${b64.length}); use a simpler logo`);
  }
  return { bits, b64: Buffer.from(b64, 'utf8') };
}

function neutralizeImgTag(buf, imgAt) {
  if (imgAt < 0) return;
  // Same-length HTML comment so string table layout stays stable.
  const replacement = Buffer.from('<!-- receipt logo disabled: no default MR  ');
  if (replacement.length !== IMG_MARK.length) {
    // pad/trim
    const out = Buffer.alloc(IMG_MARK.length, 0x20);
    replacement.copy(out, 0, 0, Math.min(replacement.length, out.length));
    out.copy(buf, imgAt);
  } else {
    replacement.copy(buf, imgAt);
  }
}

function restoreImgTag(buf, imgAt) {
  if (imgAt < 0) return;
  // After neutralize, find comment marker
  const comment = buf.indexOf(Buffer.from('<!-- receipt logo disabled'));
  const at = comment >= 0 ? comment : imgAt;
  IMG_MARK.copy(buf, at);
}

async function patchExe(exePath, mode, pngBuf) {
  if (!fs.existsSync(exePath)) {
    console.warn('[skip]', exePath);
    return false;
  }
  const buf = Buffer.from(fs.readFileSync(exePath));
  const slots = findSlots(buf);
  console.log('[slots]', exePath, slots);
  if (slots.bitsAt < 0 || slots.b64At < 0 || slots.imgAt < 0) {
    throw new Error(`logo slots not found in ${exePath}`);
  }
  saveSlots({
    imgAt: slots.imgAt,
    b64At: slots.b64At,
    bitsAt: slots.bitsAt,
    b64Cap: slots.b64Cap,
  });

  if (mode === 'clear') {
    neutralizeImgTag(buf, slots.imgAt);
    writeFixed(buf, slots.b64At, Buffer.alloc(0), slots.b64Cap);
    writeFixed(buf, slots.bitsAt, Buffer.alloc(BITS_LEN), BITS_LEN);
  } else {
    const assets = await logoAssetsFromPng(pngBuf);
    // Always rewrite the img opener at the saved offset.
    IMG_MARK.copy(buf, slots.imgAt);
    writeFixed(buf, slots.b64At, assets.b64, slots.b64Cap);
    writeFixed(buf, slots.bitsAt, assets.bits, BITS_LEN);
  }

  fs.writeFileSync(exePath, buf);
  console.log('[ok]', exePath, mode);
  return true;
}

const args = parseArgs(process.argv.slice(2));
const targets = args.exes.length ? args.exes : DEFAULT_EXES.filter((p) => fs.existsSync(p));

if (!args.clear && !args.png && !args.dataUrl) {
  console.error('Use --clear or --png FILE or --data-url DATA');
  process.exit(1);
}

let pngBuf = null;
if (args.png) pngBuf = fs.readFileSync(args.png);
if (args.dataUrl) {
  const m = /^data:image\/[a-zA-Z+]+;base64,(.+)$/s.exec(args.dataUrl);
  if (!m) throw new Error('invalid data-url');
  pngBuf = Buffer.from(m[1], 'base64');
}

let n = 0;
for (const exe of targets) {
  const ok = await patchExe(exe, args.clear ? 'clear' : 'set', pngBuf);
  if (ok) n++;
}
console.log(`[patch-core-receipt-logo] done (${n} files)`);
