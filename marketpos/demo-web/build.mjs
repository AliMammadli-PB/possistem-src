#!/usr/bin/env node
/**
 * Packs MarketPos for the possistem.az live demo:
 *   dist/ (the Vite build) + the market core built to WebAssembly + a bridge
 *   that stands in for Electron main.
 *
 *   npm run market:build            (from restoranpos/)
 *   node demo-web/build.mjs <out-dir> [wasm-build-dir]
 *
 * The WebAssembly core: source ~/.cache/emsdk/emsdk_env.sh, then
 *   emcmake cmake -S native -B native/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
 *   cmake --build native/build-wasm --target market_core_wasm
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, 'dist'));
const WASM = path.resolve(process.argv[3] ?? path.join(ROOT, 'native', 'build-wasm'));
const DIST = path.join(ROOT, 'dist');

for (const file of [path.join(DIST, 'index.html'), path.join(WASM, 'market-pos-core.wasm')]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(DIST, OUT, { recursive: true, dereference: true });
const demo = path.join(OUT, 'demo');
fs.mkdirSync(demo, { recursive: true });
for (const file of ['market-pos-core.mjs', 'market-pos-core.wasm']) {
  fs.copyFileSync(path.join(WASM, file), path.join(demo, file));
}

const template = fs.readFileSync(path.join(HERE, 'bridge.template.js'), 'utf8');
for (const slot of ['/*PRELOAD*/', '/*CORE_PAYLOAD*/']) {
  if (!template.includes(slot)) throw new Error(`bridge template lost its ${slot} slot`);
}
const read = (file) => fs.readFileSync(path.join(ROOT, 'electron', file), 'utf8');
fs.writeFileSync(
  path.join(demo, 'bridge.js'),
  template.replace('/*CORE_PAYLOAD*/', () => read('core-payload.cjs')).replace('/*PRELOAD*/', () => read('preload.cjs')),
);

// Product photos resolve to market-pos://app/assets/…, a scheme Electron main
// serves from dist/. In the browser that is simply ./assets/… of this page.
const assetsDir = path.join(OUT, 'assets');
let rewritten = 0;
for (const file of fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'))) {
  const full = path.join(assetsDir, file);
  const js = fs.readFileSync(full, 'utf8');
  const next = js.replaceAll('`market-pos://app${', '`.${').replaceAll('`market-pos://app/${', '`./${');
  if (next !== js) {
    fs.writeFileSync(full, next);
    rewritten += 1;
  }
}
if (!rewritten) throw new Error('product image URL resolver not found in the bundle');

const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const bundleTag = html.match(/<script type="module"[^>]*src="\.\/assets\/index-[^"]+\.js"><\/script>/);
if (!bundleTag) throw new Error('index.html: bundle script tag not found');
// The core is WebAssembly, which the till's CSP does not need to allow.
if (!html.includes("script-src 'self'")) throw new Error('index.html: CSP script-src not found');
html = html
  .replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com")
  // possistem.az is behind Cloudflare, which injects its analytics beacon.
  .replace("connect-src 'self'", "connect-src 'self' https://cloudflareinsights.com")
  .replace('<title>MarketPos</title>', '<title>possistem · Market POS demo</title>')
  .replace(bundleTag[0], `<script type="module" src="./demo/bridge.js"></script>\n    ${bundleTag[0]}`);
fs.writeFileSync(indexPath, html);
process.stdout.write(`[market demo-web] ${OUT}\n`);
