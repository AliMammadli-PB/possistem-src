#!/usr/bin/env node
/**
 * The two cash movements the drawer screen never offered.
 *
 * `cash_movements` has allowed four kinds since the schema landed - cash_in,
 * cash_out, expense and float_adjust - and CashService already treats them
 * distinctly when it works out what should be in the drawer. The screen only
 * ever offered the first two, so everything else went in as a plain cash_out:
 * money paid to a supplier from the till, change brought in at lunchtime, and
 * a genuine shortfall all looked identical afterwards.
 *
 * That matters at the end of the day. "Kassa 40 ₼ əskikdir" is a different
 * conversation from "40 ₼ təchizatçıya verilib" - and with one kind for both,
 * the only way to tell them apart was to read the reason field and hope
 * somebody had typed something useful.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_CASH_KINDS_v1 */';

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

must(s.includes('function psAdminText('), 'psAdminText is not in the bundle');
must(s.includes('setKind("cash_out")'), 'the cash movement buttons are not where expected');

// The two new buttons sit after cash_out, in the order an operator meets them:
// money out for a purchase, then a correction to the float.
const cashOutButton = `          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: () => setKind("cash_out"),
              className: \`touch-target rounded-xl px-4 py-3 text-sm \${kind === "cash_out" ? "bg-gold/15 text-gold" : "bg-elevated text-muted"}\`,
              children: t.cash.cashOut
            }
          )`;

const addition = `${cashOutButton},
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: () => setKind("expense"),
              className: \`touch-target rounded-xl px-4 py-3 text-sm \${kind === "expense" ? "bg-gold/15 text-gold" : "bg-elevated text-muted"}\`,
              children: psAdminText("Xərc", "Gider", "Expense")
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              onClick: () => setKind("float_adjust"),
              className: \`touch-target rounded-xl px-4 py-3 text-sm \${kind === "float_adjust" ? "bg-gold/15 text-gold" : "bg-elevated text-muted"}\`,
              children: psAdminText("Xırda pul", "Bozuk para", "Float")
            }
          )`;

s = replaceOnce(s, cashOutButton, addition, 'cash movement kinds');

// A kind with no explanation is a button nobody presses, or worse, one that
// everybody presses for the wrong thing.
const hintAnchor = `        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.cash.movement }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "gold-rule mt-2 w-20 opacity-50" }),`;
s = replaceOnce(
  s,
  hintAnchor,
  `${hintAnchor}
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 text-[11px] leading-relaxed text-faint", children: psAdminText(
          "Mədaxil: kassaya pul qoyulub. Məxaric: kassadan pul götürülüb. Xərc: kassadan ödəniş edilib (təchizatçı, kuryer). Xırda pul: kassadakı xırda pulun düzəlişi.",
          "Giriş: kasaya para konuldu. Çıkış: kasadan para alındı. Gider: kasadan ödeme yapıldı. Bozuk para: kasadaki bozuk paranın düzeltmesi.",
          "In: money added. Out: money taken. Expense: paid from the drawer. Float: correction to the change kept in the till."
        ) }),`,
  'cash kind hint',
);

must(s.includes('setKind("expense")'), 'expense kind missing');
must(s.includes('setKind("float_adjust")'), 'float adjust kind missing');
// The core only accepts the kinds its CHECK constraint names; a typo here is a
// rejected write at the counter with no clue why.
for (const kind of ['cash_in', 'cash_out', 'expense', 'float_adjust']) {
  must(s.includes(`setKind("${kind}")`), `${kind} is not offered`);
}

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
