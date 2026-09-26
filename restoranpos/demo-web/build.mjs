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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'demo-web', 'dist'));
const WASM = path.resolve(process.argv[3] ?? path.join(ROOT, 'native', 'build-wasm'));
const RENDERER = path.join(ROOT, 'out', 'renderer');

/**
 * Writes `content` under a content-addressed name. Cloudflare gives .js files
 * a 4-hour browser cache, so a fixed name (bridge.js) could pair yesterday's
 * bridge with today's UI; a new version now always has a new name.
 */
function publish(dir, name, content) {
  const ext = path.extname(name);
  const hashed = `${path.basename(name, ext)}-${createHash('sha256').update(content).digest('hex').slice(0, 10)}${ext}`;
  fs.writeFileSync(path.join(dir, hashed), content);
  return hashed;
}

const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');

for (const file of [path.join(RENDERER, 'index.html'), PRELOAD, path.join(WASM, 'restaurant-pos-core.wasm')]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(RENDERER, OUT, { recursive: true, dereference: true });
const demo = path.join(OUT, 'demo');
fs.mkdirSync(demo, { recursive: true });
const wasm = publish(demo, 'restaurant-pos-core.wasm', fs.readFileSync(path.join(WASM, 'restaurant-pos-core.wasm')));
const loader = fs.readFileSync(path.join(WASM, 'restaurant-pos-core.mjs'), 'utf8');
if (!loader.includes('"restaurant-pos-core.wasm"')) throw new Error('core loader: wasm file name not found');
const core = publish(demo, 'restaurant-pos-core.mjs', loader.replaceAll('"restaurant-pos-core.wasm"', `"${wasm}"`));
const seed = publish(demo, 'seed.js', fs.readFileSync(path.join(HERE, 'seed.js'), 'utf8'));

const template = fs.readFileSync(path.join(HERE, 'bridge.template.js'), 'utf8');
const preload = fs.readFileSync(PRELOAD, 'utf8');
for (const slot of ['/*PRELOAD*/', "'./restaurant-pos-core.mjs'", "'./seed.js'"]) {
  if (!template.includes(slot)) throw new Error(`bridge template lost ${slot}`);
}
const bridge = publish(
  demo,
  'bridge.js',
  template
    .replace('/*PRELOAD*/', () => preload)
    .replaceAll('__APP_VERSION__', JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version)
    .replace("'./restaurant-pos-core.mjs'", `'./${core}'`)
    .replace("'./seed.js'", `'./${seed}'`),
);

const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const bundleTag = html.match(/<script type="module"[^>]*src="\.\/assets\/index-[^"]+\.js"><\/script>/);
if (!bundleTag) throw new Error('index.html: bundle script tag not found');
fs.writeFileSync(
  indexPath,
  html
    .replace('<title>possistem</title>', '<title>possistem · Restoran POS demo</title>')
    .replace(bundleTag[0], `<script type="module" src="./demo/${bridge}"></script>\n    ${bundleTag[0]}`),
);
process.stdout.write(`[demo-web] ${path.relative(process.cwd(), OUT)}\n`);
