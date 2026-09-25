#!/usr/bin/env node
/**
 * Takes WhatsApp out of the till.
 *
 * Support now runs through the chat on possistem.az, so a second channel that
 * needs its own QR pairing, its own session and its own failure modes is one
 * more thing to explain and keep alive for no gain.
 *
 * The route, the entry points and the nav label all go; the page function is
 * left where it is - unreferenced code in a bundle costs nothing, and carving
 * a function out of minified output is how anchors get broken.
 *
 * Every edit is guarded on its own and the script converges on each run. The
 * previous version exited early once its mark was in the bundle, which meant a
 * later patch could put the link back and nothing would ever take it out
 * again - exactly what happened with apply-restaurant-admin-ia.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_NO_WHATSAPP_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function dropOnce(src, find, label) {
  if (!src.includes(find)) return src;
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  console.log('  removed', label);
  return src.replace(find, '');
}

let s = fs.readFileSync(BUNDLE, 'utf8');
const before = s;

// --- the admin hub shortcut ------------------------------------------------
s = dropOnce(
  s,
  `    { to: "/settings/whatsapp", label: t.nav.whatsapp, icon: WhatsappIcon, show: hasPermission("settings.manage") },\n`,
  'admin hub shortcut',
);

// --- the settings link -----------------------------------------------------
s = dropOnce(
  s,
  `      hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsxs(
        Link,
        {
          to: "/settings/whatsapp",
          className: "touch-target flex w-full items-center justify-between rounded-xl border border-hairline bg-elevated px-4 py-3 text-left text-sm text-cream hover:border-gold/40",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.settings.whatsappOpen }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "→" })
          ]
        }
      ) : null,\n`,
  'settings link',
);

// --- the route -------------------------------------------------------------
s = dropOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { element: /* @__PURE__ */ jsxRuntimeExports.jsx(RequirePermission, { permission: "settings.manage" }), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/settings/whatsapp", element: /* @__PURE__ */ jsxRuntimeExports.jsx(WhatsappPage, {}) }) }),\n`,
  'route',
);

if (!s.includes(MARK)) s = MARK + '\n' + s;
if (s !== before) fs.writeFileSync(BUNDLE, s);

// These run every time, applied or not - the point is the end state, not
// whether this particular run was the one that edited the file.
must(!s.includes('to: "/settings/whatsapp"'), 'a WhatsApp link survived');
must(!s.includes('path: "/settings/whatsapp"'), 'the WhatsApp route survived');
// Support must still be reachable - that is where these users are being sent.
must(s.includes('/support'), 'support route missing');

console.log(s === before ? 'no WhatsApp entry points present' : `patched ${BUNDLE}`);
