#!/usr/bin/env node
/**
 * Packs the restaurant till for the possistem.az live demo:
 *   out/renderer (the assembled UI) + the core built to WebAssembly + a bridge
 *   that stands in for Electron main.
 *
 *   node scripts/assemble-restaurant.mjs
 *   node demo-web/build.mjs <out-dir> [wasm-build-dir]
 *
 * The WebAssembly core: source ~/.cache/emsdk/emsdk_env.sh, then
 *   emcmake cmake -S native -B native/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
 *   cmake --build native/build-wasm --target pos_core_wasm
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'demo-web', 'dist'));
const WASM = path.resolve(process.argv[3] ?? path.join(ROOT, 'native', 'build-wasm'));
const RENDERER = path.join(ROOT, 'out', 'renderer');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');

for (const file of [path.join(RENDERER, 'index.html'), PRELOAD, path.join(WASM, 'restaurant-pos-core.wasm')]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(RENDERER, OUT, { recursive: true, dereference: true });
const demo = path.join(OUT, 'demo');
fs.mkdirSync(demo, { recursive: true });
for (const file of ['restaurant-pos-core.mjs', 'restaurant-pos-core.wasm']) {
  fs.copyFileSync(path.join(WASM, file), path.join(demo, file));
}
fs.copyFileSync(path.join(HERE, 'seed.js'), path.join(demo, 'seed.js'));

const template = fs.readFileSync(path.join(HERE, 'bridge.template.js'), 'utf8');
const preload = fs.readFileSync(PRELOAD, 'utf8');
if (!template.includes('/*PRELOAD*/')) throw new Error('bridge template lost its /*PRELOAD*/ slot');
fs.writeFileSync(path.join(demo, 'bridge.js'), template.replace('/*PRELOAD*/', () => preload));

const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const bundleTag = html.match(/<script type="module"[^>]*src="\.\/assets\/index-[^"]+\.js"><\/script>/);
if (!bundleTag) throw new Error('index.html: bundle script tag not found');
fs.writeFileSync(
  indexPath,
  html
    .replace('<title>possistem</title>', '<title>possistem · Restoran POS demo</title>')
    .replace(bundleTag[0], `<script type="module" src="./demo/bridge.js"></script>\n    ${bundleTag[0]}`),
);
process.stdout.write(`[demo-web] ${path.relative(process.cwd(), OUT)}\n`);
