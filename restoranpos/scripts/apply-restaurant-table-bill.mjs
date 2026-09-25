#!/usr/bin/env node
/**
 * Stops a moved bill from following the table it left.
 *
 * Reported as: move table 1's bill to table 2, table 1 correctly goes free, but
 * anything added to table 1 afterwards lands on table 2's bill.
 *
 * The cause is the create key. It is minted per table and held until something
 * clears it, so reopening the emptied table sent `orders.create` with the key
 * that already produced the moved order - and the core replayed that order
 * back. Everything typed afterwards went onto somebody else's bill.
 *
 * Two changes, either of which alone would fix it; both because this is money:
 *  - the key is retired the moment a bill exists for the table, so the next
 *    sitting always mints a fresh one;
 *  - a bill that belongs to a different table is not treated as this table's,
 *    even when it is open and editable.
 *
 * The core refuses the stale replay as well (OrderHandlers.cpp).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_TABLE_BILL_v1 */';

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

s = replaceOnce(
  s,
  `      let orderId = floor.orderId;
      if (!orderId) {
        orderId = await createFresh();
      }
      let loaded = await loadOrder(orderId);
      const editable = loaded && (loaded.status === "draft" || loaded.status === "open" || loaded.status === "sent" || loaded.status === "partially_paid");
      if (!editable) {`,
  `      let orderId = floor.orderId;
      if (!orderId) {
        orderId = await createFresh();
      }
      // The key covered one intent - "open a bill on this table" - and is spent
      // as soon as a bill exists. Reusing it after the bill moved elsewhere is
      // what put new items on the other table's account.
      clearTable(tableId);
      let loaded = await loadOrder(orderId);
      const belongsHere = loaded && (!loaded.tableId || loaded.tableId === tableId);
      const editable = belongsHere && (loaded.status === "draft" || loaded.status === "open" || loaded.status === "sent" || loaded.status === "partially_paid");
      if (!editable) {`,
  'retire the create key and check the bill belongs here',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('const belongsHere = loaded'), 'ownership check missing');
must(s.split('clearTable(tableId);').length - 1 >= 2, 'key is not retired after create');

console.log('patched', BUNDLE);
