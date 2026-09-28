#!/usr/bin/env node
/**
 * Packs Topdan POS for the possistem.az live demo:
 *   dist/ (the Vite build) + the Topdan core built to WebAssembly + a bridge
 *   that stands in for Electron main.
 *
 *   npm run topdan:build             (from restoranpos/)
 *   node demo-web/build.mjs <out-dir> [wasm-build-dir]
 *
 * The WebAssembly core: source ~/.cache/emsdk/emsdk_env.sh, then
 *   emcmake cmake -S native -B native/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
 *   cmake --build native/build-wasm --target market_core_wasm (OUTPUT_NAME topdan-pos-core)
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(HERE, 'dist'));
const WASM = path.resolve(process.argv[3] ?? path.join(ROOT, 'native', 'build-wasm'));
const DIST = path.join(ROOT, 'dist');

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


for (const file of [path.join(DIST, 'index.html'), path.join(WASM, 'topdan-pos-core.wasm')]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(DIST, OUT, { recursive: true, dereference: true });
const demo = path.join(OUT, 'demo');
fs.mkdirSync(demo, { recursive: true });
const wasm = publish(demo, 'topdan-pos-core.wasm', fs.readFileSync(path.join(WASM, 'topdan-pos-core.wasm')));
const loader = fs.readFileSync(path.join(WASM, 'topdan-pos-core.mjs'), 'utf8');
if (!loader.includes('"topdan-pos-core.wasm"')) throw new Error('core loader: wasm file name not found');
const core = publish(demo, 'topdan-pos-core.mjs', loader.replaceAll('"topdan-pos-core.wasm"', `"${wasm}"`));

const seed = publish(demo, 'seed.js', fs.readFileSync(path.join(HERE, 'seed.js'), 'utf8'));
const template = fs.readFileSync(path.join(HERE, 'bridge.template.js'), 'utf8');
for (const slot of ['/*PRELOAD*/', '/*CORE_PAYLOAD*/', "'./topdan-pos-core.mjs'", "'./seed.js'"]) {
  if (!template.includes(slot)) throw new Error(`bridge template lost its ${slot} slot`);
}
const read = (file) => fs.readFileSync(path.join(ROOT, 'electron', file), 'utf8');
const bridge = publish(
  demo,
  'bridge.js',
  template
    .replace('/*CORE_PAYLOAD*/', () => read('core-payload.cjs'))
    .replace('/*PRELOAD*/', () => read('preload.cjs'))
    .replaceAll('__APP_VERSION__', JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version)
    .replace("'./topdan-pos-core.mjs'", `'./${core}'`)
    .replace("'./seed.js'", `'./${seed}'`),
);

// Product photos resolve to topdan-pos://app/assets/…, a scheme Electron main
// serves from dist/. In the browser that is simply ./assets/… of this page.
const assetsDir = path.join(OUT, 'assets');
let rewritten = 0;
for (const file of fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'))) {
  const full = path.join(assetsDir, file);
  const js = fs.readFileSync(full, 'utf8');
  const next = js.replaceAll('`topdan-pos://app${', '`.${').replaceAll('`topdan-pos://app/${', '`./${');
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
  .replace('<title>TopdanPos</title>', '<title>possistem · Topdan POS demo</title>')
  .replace(bundleTag[0], `<script type="module" src="./demo/${bridge}"></script>\n    ${bundleTag[0]}`);
fs.writeFileSync(indexPath, html);
process.stdout.write(`[topdan demo-web] ${OUT}\n`);
