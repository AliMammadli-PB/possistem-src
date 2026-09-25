#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN_DIR = path.join(ROOT, 'docs', 'design', 'milioner-1.2.1', 'loading');
const KEYFRAME_DIR = path.join(DESIGN_DIR, 'keyframes');
const OUTPUT_DIR = path.join(
  ROOT,
  'apps',
  'desktop',
  'src',
  'renderer',
  'public',
  'loading',
  'frames',
);
const WIDTH = 620;
const HEIGHT = 420;
const ANCHOR_FRAMES = [1, 7, 13, 19, 25, 30];

const promptSet = [
  'Closed Milioner walnut-and-brass entrance at night; one guest approaches from behind.',
  'Same facade and guest; one waiter opens the right door and welcomes the guest.',
  'Same guest crosses the threshold while the waiter holds the door; warm lounge revealed.',
  'Same guest walks through the Milioner lounge toward the host and POS station.',
  'Close view of the matte-black POS terminal beginning to glow on the host counter.',
  'Final ready frame: powered POS with centered brass pomegranate emblem on obsidian.',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function normalizedKeyframe(index) {
  const file = path.join(KEYFRAME_DIR, `keyframe-${String(index + 1).padStart(2, '0')}.png`);
  if (!fs.existsSync(file)) throw new Error(`Missing keyframe: ${file}`);
  return sharp(file)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .modulate({ saturation: 0.94, brightness: 0.94 })
    .png({ compressionLevel: 9, quality: 92 })
    .toBuffer();
}

async function withOpacity(png, opacity) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);
  return sharp(data, { raw: info }).png().toBuffer();
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const keyframes = await Promise.all(Array.from({ length: 6 }, (_, index) => normalizedKeyframe(index)));
const frameManifest = [];

for (let frame = 1; frame <= 30; frame += 1) {
  let segment = ANCHOR_FRAMES.findIndex((anchor, index) => {
    const next = ANCHOR_FRAMES[index + 1] ?? anchor;
    return frame >= anchor && frame <= next;
  });
  if (segment < 0) segment = ANCHOR_FRAMES.length - 1;

  const startFrame = ANCHOR_FRAMES[segment];
  const endFrame = ANCHOR_FRAMES[Math.min(segment + 1, ANCHOR_FRAMES.length - 1)];
  const span = Math.max(1, endFrame - startFrame);
  const rawT = Math.max(0, Math.min(1, (frame - startFrame) / span));
  const eased = rawT * rawT * (3 - 2 * rawT);
  const base = keyframes[segment];
  let output = base;

  if (segment < keyframes.length - 1 && eased > 0) {
    const overlay = await withOpacity(keyframes[segment + 1], eased);
    output = await sharp(base)
      .composite([{ input: overlay, blend: 'over' }])
      .png({ compressionLevel: 9, quality: 90 })
      .toBuffer();
  }

  const filename = `frame-${String(frame).padStart(2, '0')}.png`;
  const destination = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(destination, output);
  frameManifest.push({
    frame,
    output: path.relative(ROOT, destination).replaceAll('\\', '/'),
    width: WIDTH,
    height: HEIGHT,
    segment: segment + 1,
    blend: Number(eased.toFixed(4)),
    sha256: sha256(output),
  });
}

const keyframeManifest = Array.from({ length: 6 }, (_, index) => {
  const filename = `keyframe-${String(index + 1).padStart(2, '0')}.png`;
  const file = path.join(KEYFRAME_DIR, filename);
  return {
    keyframe: index + 1,
    input: path.relative(ROOT, file).replaceAll('\\', '/'),
    prompt: promptSet[index],
    sha256: sha256(fs.readFileSync(file)),
  };
});

const manifest = {
  release: '1.2.1',
  generatorMode: 'built-in-imagegen-keyframes-plus-local-frame-interpolation',
  playback: { frames: 30, width: WIDTH, height: HEIGHT, fps: 12 },
  keyframes: keyframeManifest,
  frames: frameManifest,
};
fs.writeFileSync(path.join(DESIGN_DIR, 'loading-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`[launch-frames] PASS: ${frameManifest.length} PNG frames at ${WIDTH}x${HEIGHT}\n`);
