#!/usr/bin/env node
/**
 * Packs the restaurant's Əməliyyatlar screens for Market POS (1.5.0):
 * out/renderer + a bridge to the Market window, plus the method list Market
 * main allows (methods.json, the same list the customer portal uses).
 *
 *   node scripts/assemble-restaurant.mjs
 *   node market-ops/build.mjs <out-dir>     (Market: ../marketpos/dist/ops)
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, '..', 'marketpos', 'dist', 'ops'));
const RENDERER = path.join(ROOT, 'out', 'renderer');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
for (const file of [path.join(RENDERER, 'index.html'), PRELOAD]) {
  if (!fs.existsSync(file)) throw new Error(`missing ${file} - run scripts/assemble-restaurant.mjs first`);
}

const methods = JSON.parse(fs.readFileSync(path.join(ROOT, 'portal-web', 'remote-methods.json'), 'utf8'));
// Market only: Parametrlər → Printer and Çek dizaynı (the till's own printer and receipt screens).
for (const extra of ['permissions.list', 'settings.getAll', 'settings.set', 'receiptLogo.apply', 'receiptLogo.clear', 'print.previewTest', 'print.setPrinter', 'print.printers', 'print.detect', 'print.enqueue']) {
  if (!methods.includes(extra)) methods.push(extra);
}
const template = fs.readFileSync(path.join(HERE, 'bridge.template.js'), 'utf8');
if (!template.includes('/*PRELOAD*/')) throw new Error('bridge template lost /*PRELOAD*/');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const bridge = template.replaceAll('__APP_VERSION__', version).replace('/*PRELOAD*/', () => fs.readFileSync(PRELOAD, 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(RENDERER, OUT, { recursive: true, dereference: true });
const name = `bridge-${createHash('sha256').update(bridge).digest('hex').slice(0, 10)}.js`;
fs.mkdirSync(path.join(OUT, 'market'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'market', name), bridge);
fs.writeFileSync(path.join(OUT, 'methods.json'), JSON.stringify(methods));

const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const bundleTag = html.match(/<script type="module"[^>]*src="\.\/assets\/index-[^"]+\.js"><\/script>/);
if (!bundleTag) throw new Error('index.html: bundle script tag not found');
fs.writeFileSync(indexPath, html
  .replace(/<title>[^<]*<\/title>/, '<title>MarketPos · Əməliyyatlar</title>')
  .replace(bundleTag[0], `<script type="module" src="./market/${name}"></script>\n    ${bundleTag[0]}`));
process.stdout.write(`[market-ops] ${path.relative(process.cwd(), OUT)} (${version}, ${methods.length} methods)\n`);
