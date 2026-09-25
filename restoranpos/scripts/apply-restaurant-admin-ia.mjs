#!/usr/bin/env node
/**
 * One home for the admin shortcuts, not two.
 *
 * Settings carried a grid of admin tiles *and* /admin carried the same list —
 * the same twelve links in two places, drifting apart (WhatsApp was only in one,
 * Cash only in the other). The intended layout, which tests/unit/restaurant-ux-ia
 * already asserts, is that /admin is the hub and Settings holds device settings.
 *
 * So: the hub gains what only the Settings grid had, and the grid goes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_ADMIN_IA_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
const before = s;

// WhatsApp used to be added to the hub here. It is gone from the product -
// support runs through the chat on possistem.az - and re-adding it on every
// launch is what kept it coming back: this script's per-edit guards re-run,
// while apply-restaurant-no-whatsapp.mjs had already marked itself done. The
// result was a hub tile pointing at a route that no longer exists.
// See apply-restaurant-no-whatsapp.mjs, which now converges on every run.

// --- and the duplicated grid in Settings goes -----------------------------
if (s.includes('adminLinks.length > 0 &&')) {
const dumpStart = '      adminLinks.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("section"';
const dumpEnd = `          to
        )) })
      ] }),
`;
const from = s.indexOf(dumpStart);
must(from !== -1, 'settings admin grid not found');
const to = s.indexOf(dumpEnd, from);
must(to !== -1, 'settings admin grid end not found');
s = s.slice(0, from) + s.slice(to + dumpEnd.length);

// `adminLinks` itself is now unused; leaving it would be dead code the next
// reader has to reason about.
const listStart = s.indexOf('  const adminLinks = [');
must(listStart !== -1, 'adminLinks declaration not found');
const listEnd = s.indexOf('  ].filter((l) => l.show);\n', listStart);
must(listEnd !== -1, 'adminLinks end not found');
s = s.slice(0, listStart) + s.slice(listEnd + '  ].filter((l) => l.show);\n'.length);
}

// --- the staff code is the seeded admin's PIN ------------------------------
// The card that printed it was already dead (`&& false`), but leaving the
// branch in the bundle keeps 9001 one edit away from being on screen again.
const pinBadge = /,\n\s*\(typeof window !== "undefined" && window\.pos\?\.app && false\) \? [^\n]*children: user\.code \}\) : null/;
if (pinBadge.test(s)) s = s.replace(pinBadge, '');

if (s === before) {
  console.log('bundle already applied');
  process.exit(0);
}
if (!s.startsWith(MARK)) s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(!s.includes('adminLinks.length > 0 &&'), 'settings grid survived');
must(!s.includes('const adminLinks = ['), 'adminLinks declaration survived');
must(s.includes('function AdminHubPage'), 'admin hub missing');
must(!s.includes('to: "/settings/whatsapp"'), 'whatsapp re-added to the hub');
for (const route of ['/admin/cash', '/admin/gifts', '/admin/staff']) {
  must(s.includes(`to: "${route}"`), `${route} unreachable from the hub`);
}

console.log('patched', BUNDLE);
