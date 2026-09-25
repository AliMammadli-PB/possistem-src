#!/usr/bin/env node
/**
 * Gate Anbar (and other ops tabs) by licence access list window.__psAccess.
 *
 * Admin hub already filters with `_psArea(to)`. Operations tabs only checked
 * staff permissions, so a closed Anbar module still opened for Administrator.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LICENSE_AREA_TABS_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('already applied');
  process.exit(0);
}

must(s.includes('function _psArea(path){'), '_psArea missing');

const old = `{ id: "stock", label: "Anbar", show: hasPermission("inventory.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsStock, {}) }`;
const neu = `{ id: "stock", label: "Anbar", show: hasPermission("inventory.view") && _psArea("/operations?tab=stock"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsStock, {}) }`;
must(s.includes(old), 'stock tab needle missing');
s = s.replace(old, neu);

for (const [id, perm, pathQ] of [
  ['suppliers', 'suppliers.view', '/operations?tab=suppliers'],
  ['costing', 'inventory.view', '/operations?tab=stock'],
  ['vendors', 'suppliers.view', '/operations?tab=vendors'],
]) {
  const a = `{ id: "${id}", label:`;
  const i = s.indexOf(a);
  must(i !== -1, `${id} tab missing`);
  // only patch show: hasPermission(...) once per id near Ops
}

// costing
s = s.replace(
  `{ id: "costing", label: "Kalkulyasiya", show: hasPermission("inventory.view"), render:`,
  `{ id: "costing", label: "Kalkulyasiya", show: hasPermission("inventory.view") && _psArea("/operations?tab=stock"), render:`,
);
s = s.replace(
  `{ id: "suppliers", label: "Təchizat", show: hasPermission("suppliers.view"), render:`,
  `{ id: "suppliers", label: "Təchizat", show: hasPermission("suppliers.view") && _psArea("/operations?tab=suppliers"), render:`,
);
s = s.replace(
  `{ id: "vendors", label: "Təchizatçılar", show: hasPermission("suppliers.view"), render:`,
  `{ id: "vendors", label: "Təchizatçılar", show: hasPermission("suppliers.view") && _psArea("/operations?tab=vendors"), render:`,
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
must(s.includes('_psArea("/operations?tab=stock")'), 'stock area gate missing');
console.log('patched', BUNDLE);
