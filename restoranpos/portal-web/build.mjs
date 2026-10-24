#!/usr/bin/env node
/**
 * Packs the till's own screens for the customer portal (Restoran
 * idarəetməsi, 1.8.0): out/renderer + a bridge that sends every core call to
 * the restaurant's till through /pos/api/customer/pos/rpc.
 *
 *   node scripts/assemble-restaurant.mjs
 *   node portal-web/build.mjs <out-dir>
 *
 * The output is served under the portal at /pos/app/kassa/.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'portal-web', 'dist'));
const RENDERER = path.join(ROOT, 'out', 'renderer');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
for (const file of [path.join(RENDERER, 'index.html'), PRELOAD]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
}

const methods = JSON.parse(fs.readFileSync(path.join(HERE, 'remote-methods.json'), 'utf8'));
const template = fs.readFileSync(path.join(HERE, 'bridge.template.js'), 'utf8');
for (const slot of ['/*PRELOAD*/', '__REMOTE_METHODS__']) {
  if (!template.includes(slot)) throw new Error(`bridge template lost ${slot}`);
}
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const bridge = template
  .replace('__REMOTE_METHODS__', JSON.stringify(methods))
  .replaceAll('__APP_VERSION__', version)
  .replace('/*PRELOAD*/', () => fs.readFileSync(PRELOAD, 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(RENDERER, OUT, { recursive: true, dereference: true });
// Content-addressed, so a new release never pairs with yesterday's cached bridge.
const name = `bridge-${createHash('sha256').update(bridge).digest('hex').slice(0, 10)}.js`;
fs.mkdirSync(path.join(OUT, 'portal'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'portal', name), bridge);

const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const bundleTag = html.match(/<script type="module"[^>]*src="\.\/assets\/index-[^"]+\.js"><\/script>/);
if (!bundleTag) throw new Error('index.html: bundle script tag not found');
fs.writeFileSync(indexPath, html
  .replace(/<title>[^<]*<\/title>/, '<title>possistem · Restoran idarəetməsi</title>')
  .replace(bundleTag[0], `<script type="module" src="./portal/${name}"></script>\n    ${bundleTag[0]}`));
// Browser caches must never pair the new bridge with an old renderer or CSS.
let freshHtml = fs.readFileSync(indexPath, 'utf8');
for (const rel of ['assets/index-BsrHjfOR.js', 'possistem-system.css']) {
  const file = path.join(OUT, rel);
  const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  const parsed = path.parse(rel);
  const fresh = path.join(parsed.dir, `${parsed.name}-${hash}${parsed.ext}`).replaceAll('\\', '/');
  fs.copyFileSync(file, path.join(OUT, fresh));
  freshHtml = freshHtml.replaceAll(`./${rel}`, `./${fresh}`);
}
fs.writeFileSync(indexPath, freshHtml);
process.stdout.write(`[portal-web] ${path.relative(process.cwd(), OUT)} (${version}, ${methods.length} methods)\n`);
