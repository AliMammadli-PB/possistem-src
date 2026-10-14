#!/usr/bin/env node
/**
 * "Sometimes an input can't be clicked until the app is restarted."
 *
 * On Windows, Electron can leave the page without keyboard focus after a
 * native dialog (window.confirm, the image/licence file pickers) or a
 * focus change: the window looks active but its inputs never take focus.
 *
 *  - main: whenever a window gets focus back, hand it to its page
 *    (webContents.focus()), the known workaround;
 *  - renderer: the last native window.confirm (removing a printer) becomes
 *    the app's own confirm dialog, like every other confirmation.
 * Runs after apply-restaurant-kitchen-stations.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const MARK = '/* POS_FOCUS_FIX_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  s = replaceOnce(
    s,
    `function PsKitchenStations() {
  const L = psAdminText;
`,
    `function PsKitchenStations() {
  const L = psAdminText;
  ${MARK}
  const [confirmAsk, confirmDialog] = useConfirm();
`,
    'stations confirm hook',
  );
  s = replaceOnce(
    s,
    'if (!window.confirm(L(`"${row.name}" printeri silinsin?`, `"${row.name}" yazıcısı silinsin mi?`, `Remove "${row.name}"?`))) return;',
    'if (!(await confirmAsk(L(`"${row.name}" printeri silinsin?`, `"${row.name}" yazıcısı silinsin mi?`, `Remove "${row.name}"?`), { danger: true }))) return;',
    'printer remove confirm',
  );
  s = replaceOnce(
    s,
    `L("+ Printer əlavə et", "+ Yazıcı ekle", "+ Add printer")) : null));
}`,
    `L("+ Printer əlavə et", "+ Yazıcı ekle", "+ Add printer")) : null),
    confirmDialog);
}`,
    'stations confirm dialog',
  );
  if (/window\.(confirm|alert|prompt)\(/.test(s)) throw new Error('a native dialog is still in the renderer');
  fs.writeFileSync(BUNDLE, s);
  console.log('renderer focus fix applied');
} else {
  console.log('bundle already applied');
}

let m = fs.readFileSync(MAIN, 'utf8');
if (!m.includes(MARK)) {
  m = replaceOnce(
    m,
    'c.app.whenReady().then(()=>{const _psStaff=_psLoadStaff()',
    `${MARK}c.app.on("browser-window-created",(_e,w)=>{w.on("focus",()=>{try{if(!w.isDestroyed()&&!w.webContents.isDestroyed())w.webContents.focus()}catch{}})});c.app.whenReady().then(()=>{const _psStaff=_psLoadStaff()`,
    'main focus',
  );
  fs.writeFileSync(MAIN, m);
  console.log('main focus fix applied');
} else {
  console.log('main already applied');
}
