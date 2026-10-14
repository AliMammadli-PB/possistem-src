#!/usr/bin/env node
/**
 * Customer portal "Masalar": the owner sees what is on each table, live.
 *
 * The floor sync (every 5 s, /owner/device/sync) already sends each table's
 * status, waiter, guests and totals. This asks the core for the dishes too
 * (tables.list includeItems) and adds them to each occupied table:
 * items: [{ name, quantity, status, totalMinor, note }], at most 60 per table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const MARK = '/* POS_LIVE_TABLE_ITEMS_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(MAIN, 'utf8');
if (!s.includes(MARK)) {
s = replaceOnce(s,
  'async function xs(e){const t={},n=await b("tables.list",{});',
  `async function xs(e){${MARK}const t={},n=await b("tables.list",{includeItems:!0});`,
  'sync tables call');
s = replaceOnce(s,
  'openedAt:l.openedAt==null?void 0:String(l.openedAt)}));t.tables=u}',
  'openedAt:l.openedAt==null?void 0:String(l.openedAt),items:Array.isArray(l.items)?l.items.slice(0,60).map(i=>({name:String(i.name??"").slice(0,120),quantity:Math.max(0,Number(i.quantity)||0),status:String(i.status??"")})):void 0}));t.tables=u}',
  'sync table items');
}

// v2: each line also carries its total and note (portal table details).
const MARK2 = '/* POS_LIVE_TABLE_ITEMS_v2 */';
if (!s.includes(MARK2)) {
  s = replaceOnce(s,
    `async function xs(e){${MARK}`,
    `async function xs(e){${MARK}${MARK2}`,
    'v2 mark');
  s = replaceOnce(s,
    'status:String(i.status??"")})):void 0}));t.tables=u}',
    'status:String(i.status??""),totalMinor:Math.max(0,Math.trunc(Number(i.totalMinor)||0)),note:i.note?String(i.note).slice(0,120):void 0})):void 0}));t.tables=u}',
    'sync item totals');
}
fs.writeFileSync(MAIN, s);
console.log('live table items applied');
