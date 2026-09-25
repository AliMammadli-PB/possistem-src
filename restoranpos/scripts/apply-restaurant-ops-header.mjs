#!/usr/bin/env node
/**
 * The panel says which section you are actually in.
 *
 * Clicking "Anbar" in the sidebar opened a page headed "Əməliyyatlar" whose
 * subtitle listed six modules - müştərilər, rezervasiya, çatdırılma - that a
 * storekeeper has no permission to open. The page looked like the wrong one,
 * which is exactly what was reported: "anbara girdim, görmədim".
 *
 * Title now follows the open tab, and the subtitle lists only the sections
 * this person can actually reach.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_OPS_HEADER_v1 */';

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
  `      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl text-cream", children: "Əməliyyatlar" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: "Anbar, təchizat, müştərilər, rezervasiya, çatdırılma və iş qrafiki." })`,
  `      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl text-cream", children: current?.label ?? "Əməliyyatlar" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: tabs.length > 1 ? tabs.map((tab) => tab.label).join(" · ") : "Anbar qalığı, mal qəbulu və hərəkətlər." })`,
  'operations header',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('children: current?.label ?? "Əməliyyatlar"'), 'title not wired to the open tab');
must(!s.includes('children: "Anbar, təchizat, müştərilər, rezervasiya, çatdırılma və iş qrafiki."'),
     'the subtitle still promises sections the operator may not have');
must(s.includes('tabs.map((tab) => tab.label).join(" · ")'), 'subtitle not built from the visible tabs');

console.log('patched', BUNDLE);
