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
import { patchWarehousePerformance } from './warehouse-performance.mjs';
import { patchRegisterLinking } from './register-linking.mjs';
import { patchDocumentRights } from './document-rights.mjs';
import { patchMarketWorkflows } from './workflows.mjs';
import { patchMarket1536 } from './workflows1536.mjs';
import { patchBranchProducts1543 } from './branch-products1543.mjs';
import { patchMarket1535 } from './workflows1535.mjs';
import { patchGoodsEditing } from './goods-editing.mjs';
import { patchMarketValuation } from './valuation1562.mjs';
import { patchWaste1547 } from './waste1547.mjs';

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
// Cloud screens live next to ops. Copying their generated tree inside ops duplicates every asset.
fs.cpSync(RENDERER, OUT, { recursive: true, dereference: true, filter: source => source !== path.join(RENDERER, 'cloud-branches') });
// One settings destination per outer Market tab; the restaurant app is untouched.
let settingsPatched = false;
for (const file of fs.readdirSync(path.join(OUT, 'assets')).filter((name) => /^index-.*\.js$/.test(name))) {
  const target = path.join(OUT, 'assets', file);
  let source = fs.readFileSync(target, 'utf8');
  const before = 'const picked = psMarketMode() ? (id === "printer" || id === "receipt" ? id : "__market_hidden__") : pickedSection;';
  if (source.includes(before)) {
    const hiddenPrinter = '!psMarketMode() && hasPermission("settings.manage") ? jsxRuntimeExports.jsx(PsKitchenStations, {}) : null';
    if (!source.includes(hiddenPrinter)) throw new Error('Market printer setup component missing');
    source = source.replace(hiddenPrinter, 'hasPermission("settings.manage") ? jsxRuntimeExports.jsx(PsKitchenStations, {}) : null');
    source = source.replace('const [settingsSection, setSettingsSection] = reactExports.useState("restaurant");', 'const [settingsSection, setSettingsSection] = reactExports.useState(window.__psMarketSettingsPanel || "restaurant");');
    const catalogTabs = '].filter((tab) => !(psMarketMode() && (tab.id === "costing" || tab.id === "delivery")));';
    if (!source.includes(catalogTabs)) throw new Error('Market catalog tabs missing');
    source = source.replace(catalogTabs, '].filter((tab) => !(psMarketMode() && (tab.id === "costing" || tab.id === "delivery")) && (!window.__psMarketCatalog || tab.id === "goods" || tab.id === "categories") && (window.__psMarketCashLedger ? tab.id === "kassa" : tab.id !== "kassa"));');
    source = patchGoodsEditing(source);
    source = patchWarehousePerformance(source);
    source = patchRegisterLinking(source);
    source = patchMarketWorkflows(source);
    source = patchMarket1535(source);
    source = patchDocumentRights(source);
    source = patchMarketValuation(patchWaste1547(patchBranchProducts1543(patchMarket1536(source))));
    settingsPatched = true;
    source = source.replace(before, 'const picked = psMarketMode() ? (window.__psMarketSettingsPanel || (id === "printer" || id === "receipt" ? id : "__market_hidden__")) : pickedSection;');
    fs.writeFileSync(target, source);
  }
}
if (!settingsPatched) throw new Error("Market settings pane selector missing in renderer");
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

const cloudBuild=await import('node:child_process');
const cloudResult=cloudBuild.spawnSync(process.execPath,[path.join(ROOT,'cloud-branches/build.mjs'),path.join(path.dirname(OUT),'cloud-branches')],{stdio:'inherit'});if(cloudResult.status!==0)process.exit(1);
for(const [src,dest] of [['presence.js','branch-presence.cjs'],['object-selection.cjs','object-selection.cjs'],['client.cjs','cloud-branches.cjs'],['methods.json','cloud-branches-methods.json']])fs.copyFileSync(path.join(ROOT,'cloud-branches',src),path.join(ROOT,'../marketpos/electron',dest));
