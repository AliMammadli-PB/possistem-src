#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'index-DAmHwBc4.js');
let bundle = fs.readFileSync(bundlePath, 'utf8');
const marker = '/* POS_DESTINATION_REFRESH_v1 */';

if (!bundle.includes(marker)) {
  const settingsStart = bundle.indexOf('function SettingsPage()');
  const settingsEnd = bundle.indexOf('\nconst ICONS =', settingsStart);
  if (settingsStart < 0 || settingsEnd < 0) throw Error('SettingsPage not found');
  let page = bundle.slice(settingsStart, settingsEnd);

  // The old global Save guessed which child button to click. On the backup and
  // danger tabs that could select an unrelated action. Each form has its own
  // explicit Save button, so remove the misleading global actions entirely.
  const saveStart = page.indexOf('  const saveVisibleSettings = () => {');
  const saveEnd = page.indexOf('  const [qrUrl, setQrUrl]', saveStart);
  if (saveStart < 0 || saveEnd < 0) throw Error('Global settings save helper changed');
  page = page.slice(0, saveStart) + page.slice(saveEnd);

  const topStart = page.indexOf('    /* POS_SETTINGS_EXACT_BUNDLE_v1 */');
  const mainStart = page.indexOf('    /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "settings-shell"', topStart);
  if (topStart < 0 || mainStart < 0) throw Error('Settings top bar changed');
  page = page.slice(0, topStart) + '    /* POS_DESTINATION_SETTINGS_TOP_v1 */\n' + page.slice(mainStart);

  const bottomStart = page.indexOf('    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sticky-save show"');
  const bottomEnd = page.indexOf('    /* POS_SETTINGS_EXACT_CLOSE_v1 */', bottomStart);
  if (bottomStart < 0 || bottomEnd < 0) throw Error('Settings bottom save bar changed');
  page = page.slice(0, bottomStart) + '    /* POS_DESTINATION_SETTINGS_BOTTOM_v1 */\n' + page.slice(bottomEnd);

  const select = 'onClick: () => setSettingsSection(sec.id),';
  if (page.split(select).length !== 2) throw Error('Settings navigation changed');
  page = page.replace(select, 'onClick: () => { setSettingsSection(sec.id); document.querySelector(".ps-settings-page")?.scrollTo({top:0,behavior:"auto"}); },');

  bundle = marker + '\n' + bundle.slice(0, settingsStart) + page + bundle.slice(settingsEnd);
}
// The recovered renderer references a dashboard PNG that is absent from this
// distribution. Keep the dark dashboard artwork self-contained in the bundle.
if (!bundle.includes('POS_DASHBOARD_BACKGROUND_v1')) {
  const oldBackground = 'const dashboardBackground = "" + new URL("dashboard-bg-xa6IB7HV.png", import.meta.url).href;';
  if (!bundle.includes(oldBackground)) throw Error('Dashboard background reference changed');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#08172d"/><stop offset="1" stop-color="#163862"/></linearGradient><radialGradient id="r"><stop stop-color="#4475b7" stop-opacity=".42"/><stop offset="1" stop-color="#4475b7" stop-opacity="0"/></radialGradient></defs><path fill="url(#g)" d="M0 0h1600v900H0z"/><ellipse cx="1170" cy="210" rx="590" ry="410" fill="url(#r)"/><ellipse cx="160" cy="790" rx="530" ry="350" fill="url(#r)"/></svg>';
  bundle = bundle.replace(oldBackground, `/* POS_DASHBOARD_BACKGROUND_v1 */\nconst dashboardBackground = ${JSON.stringify('data:image/svg+xml,' + encodeURIComponent(svg))};`);
}
await transform(bundle, {loader:'js',target:'es2022'});
fs.writeFileSync(bundlePath, bundle);

const cssPath = path.join(root, 'possistem-system.css');
let css = fs.readFileSync(cssPath, 'utf8');
const begin = '/* POS_DESTINATION_REFRESH_CSS_START */';
const end = '/* POS_DESTINATION_REFRESH_CSS_END */';
const a = css.indexOf(begin);
if (a >= 0) {
  const b = css.indexOf(end, a);
  if (b < 0) throw Error('Destination CSS end marker missing');
  let after = b + end.length;
  while (css[after] === '\n' || css[after] === '\r') after++;
  css = css.slice(0, a) + css.slice(after);
}
const layer = fs.readFileSync(path.join(root, 'scripts/admin-ui/destination-refresh.css'), 'utf8');
fs.writeFileSync(cssPath, css.trimEnd() + '\n' + begin + '\n' + layer + '\n' + end + '\n');
console.log('Touch destination pages refreshed');
