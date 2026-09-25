#!/usr/bin/env node
/**
 * Kalkulyasiya recipe editor gate.
 *
 * The full OpsCosting + multi-product Resept dialog already lives in
 * index-DAmHwBc4.js (POS_RECIPE_EDIT_v1 / v2). This script used to embed a
 * giant PAGE template; that template was corrupted (bare `return` at top
 * level) and crashed every Desktop launch with POS_REBUILD_ON_LAUNCH=1.
 *
 * Keep this file as a no-op verifier + title soft-repair so launch.sh can
 * keep calling it without wiping the newer multi-line editor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_RECIPE_EDIT_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let s = fs.readFileSync(BUNDLE, 'utf8');

must(s.includes('function OpsCosting()'), 'OpsCosting missing — run apply-restaurant-costing.mjs first');
must(
  s.includes(MARK) || s.includes('/* POS_RECIPE_EDIT_v2 */'),
  'recipe editor mark missing in bundle — restore index-DAmHwBc4.js',
);
must(s.includes('window.pos.inventory.saveRecipe'), 'saveRecipe call missing');
must(s.includes('Resept yaz'), 'Resept yaz button missing');
must(s.includes('row.hasRecipe ? formatMoney(row.costMinor ?? 0) : "—"'), 'unknown cost still shown as —');
must(s.includes('Məhsul əlavə et') || s.includes('+ Sətir'), 'add-line control missing');

{
  const preload = fs.readFileSync(path.join(ROOT, 'out/preload/index.js'), 'utf8');
  must(preload.includes('saveRecipe:'), 'out/preload missing inventory.saveRecipe bridge');
  must(preload.includes('recipe: (menuItemId)'), 'out/preload missing inventory.recipe bridge');
}

let changed = false;

if (!s.includes('costing: ["Kalkulyasiya"')) {
  const opsNeedle =
    'suppliers: ["T\\u0259chizat", "Tedarik", "Purchasing"],';
  must(s.includes(opsNeedle), 'ops title map suppliers entry missing');
  s = s.replace(
    opsNeedle,
    opsNeedle + ' costing: ["Kalkulyasiya", "Maliyet", "Costing"],',
  );
  changed = true;
}

{
  const subNeedle =
    'stock: ["Stok qal\\u0131\\u011F\\u0131n\\u0131 izl\\u0259yin, m\\u0259hsul \\u0259lav\\u0259 edin v\\u0259 h\\u0259r\\u0259k\\u0259tl\\u0259ri idar\\u0259 edin.", "Stoklar\\u0131 takip edin, \\xFCr\\xFCn ekleyin ve hareketleri y\\xF6netin.", "Track stock, add products and manage adjustments."],';
  if (s.includes(subNeedle) && !s.includes('costing: ["Yem\\u0259yin t\\u0259rkibini')) {
    s = s.replace(
      subNeedle,
      subNeedle +
        ' costing: ["Yem\\u0259yin t\\u0259rkibini yaz\\u0131n \\u2014 maya v\\u0259 qazanc avtomatik hesablan\\u0131r.", "Yeme\\u011Fin i\\xE7eri\\u011Fini yaz\\u0131n \\u2014 maliyet otomatik hesaplan\\u0131r.", "Write what is in the dish \\u2014 cost is calculated automatically."],',
    );
    changed = true;
  }
}

must(s.includes('costing: ["Kalkulyasiya"'), 'costing hub title missing');

if (!s.includes(MARK)) {
  if (s.startsWith('/* POS_COSTING_v1 */') || s.includes('/* POS_COSTING_v1 */')) {
    s = s.replace('/* POS_COSTING_v1 */', '/* POS_COSTING_v1 */\n' + MARK);
  } else {
    s = MARK + '\n' + s;
  }
  changed = true;
}

if (changed) fs.writeFileSync(BUNDLE, s);
console.log(changed ? 'refreshed titles' : 'bundle already applied', path.basename(BUNDLE), '— recipe editor on Kalkulyasiya');
