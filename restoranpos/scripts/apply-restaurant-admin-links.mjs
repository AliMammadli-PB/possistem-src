#!/usr/bin/env node
/**
 * Cash and Gifts were reachable only by typing the URL.
 *
 * Both pages ship in the bundle and both routes are already permission-guarded
 * (`cash.manage`, `gifts.manage`), but neither appeared in the admin shortcut
 * grids — Settings listed ten shortcuts and omitted both, and the admin hub
 * omitted Cash. Nothing new is invented here: the labels (t.nav.cash,
 * t.nav.gifts) and the icons (CircleDollarSign, Gift) are already in the bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_ADMIN_LINKS_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

// --- Settings page: the multi-line shortcut grid ---------------------------
s = replaceOnce(
  s,
  `    {
      to: "/admin/backup",
      label: t.nav.backup,
      icon: HardDrive,
      show: hasPermission("backup.manage")
    },
    {
      to: "/reconcile",`,
  `    {
      to: "/admin/backup",
      label: t.nav.backup,
      icon: HardDrive,
      show: hasPermission("backup.manage")
    },
    {
      to: "/admin/cash",
      label: t.nav.cash,
      icon: CircleDollarSign,
      show: hasPermission("cash.manage")
    },
    {
      to: "/admin/gifts",
      label: t.nav.gifts,
      icon: Gift,
      show: hasPermission("gifts.manage")
    },
    {
      to: "/reconcile",`,
  'settings admin shortcuts: cash + gifts',
);

// --- Admin hub: the single-line link list (already has gifts) --------------
s = replaceOnce(
  s,
  `    { to: "/admin/backup", label: t.nav.backup, icon: HardDrive, show: hasPermission("backup.manage") },
    { to: "/reconcile",`,
  `    { to: "/admin/backup", label: t.nav.backup, icon: HardDrive, show: hasPermission("backup.manage") },
    { to: "/admin/cash", label: t.nav.cash, icon: CircleDollarSign, show: hasPermission("cash.manage") },
    { to: "/reconcile",`,
  'admin hub: cash',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

// The routes and labels these link to must actually exist, or the shortcuts
// would render and go nowhere.
must(s.includes('path: "/admin/cash"'), '/admin/cash route missing');
must(s.includes('path: "/admin/gifts"'), '/admin/gifts route missing');
must(s.includes('cash: "Kassa"'), 't.nav.cash label missing');
must(s.includes('gifts: "Hədiyyələr"'), 't.nav.gifts label missing');
must(s.split('to: "/admin/cash"').length - 1 === 2, 'expected cash in both shortcut lists');

console.log('patched', BUNDLE);
