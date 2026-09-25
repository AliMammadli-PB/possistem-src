#!/usr/bin/env node
/**
 * Prints the goods-receipt note where the goods are.
 *
 * A third printer with nothing addressed to it is a cable, not a feature. The
 * core now routes `warehouse_slip` to `printer.warehouse`; this is what sends
 * one - on receipt, and again on demand, because the copy that matters is the
 * one that gets signed and those go missing.
 *
 * Failing to print must not read as a failed receipt: the stock is already in
 * the building and the supplier's debt is already recorded by the time the
 * paper is asked for. The toast says so rather than implying the receipt died.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_WAREHOUSE_SLIP_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const hits = src.split(find).length - 1;
  must(hits === 1, `${label}: expected 1 match, found ${hits}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

must(s.includes('function OpsSuppliers('), 'the supply screen is not in the bundle');
must(s.includes('window.pos.print.enqueue'), 'the print bridge is not in the bundle');

// --- one helper, used by both the receive and the reprint -----------------
s = replaceOnce(
  s,
  'function OpsSuppliers() {',
  `/**
 * The delivery note, sent to whichever printer is assigned to the store room.
 *
 * Not fatal: by the time this runs the stock is in and the supplier is owed,
 * so a printer that is off means a missing piece of paper, not a missing
 * delivery. Saying which is the difference between a shrug and a panic.
 */
async function opsPrintWarehouseSlip(purchaseId) {
  const res = await window.pos.print.enqueue(
    { kind: "warehouse_slip", options: { purchaseId } },
    { idempotencyKey: crypto.randomUUID(), timeoutMs: 3e4 }
  );
  if (!res.success) {
    toast("Mal qəbulu çap olunmadı — qəbul özü yazılıb", "warning");
    return false;
  }
  return true;
}

function OpsSuppliers() {`,
  'slip helper',
);

// --- print on receipt, and offer it again afterwards ----------------------
s = replaceOnce(
  s,
  `        p.status !== "received"
          ? /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { disabled: busy,
              onClick: () => void run(window.pos.suppliers.receive(p.id), "Mal qəbul edildi"),
              children: "Qəbul et" })
          : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-faint", children: "—" })`,
  `        p.status !== "received"
          ? /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { disabled: busy,
              onClick: () => void (async () => {
                const received = await run(window.pos.suppliers.receive(p.id), "Mal qəbul edildi");
                if (received) await opsPrintWarehouseSlip(p.id);
              })(),
              children: "Qəbul et" })
          : /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet",
              onClick: () => void opsPrintWarehouseSlip(p.id),
              children: "Qəbzi çap et" })`,
  'receive + reprint',
);

must(s.includes('async function opsPrintWarehouseSlip'), 'the helper did not land');
must(s.includes('kind: "warehouse_slip"'), 'nothing enqueues the slip');
must(s.includes('children: "Qəbzi çap et"'), 'no way to reprint');
// The receipt itself must still be awaited before the paper is asked for, or a
// failed receive would print a note for a delivery that never happened.
must(s.includes('if (received) await opsPrintWarehouseSlip(p.id);'), 'the slip is not gated on the receipt');

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
