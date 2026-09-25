#!/usr/bin/env node
/**
 * Every button stays; the ones this person may not use say so.
 *
 * The owner's rule: icons and buttons do not disappear when a permission is
 * missing - a till whose screens change shape per waiter is harder to learn
 * and support. A button without the permission is shown dimmed, and pressing
 * it answers "Buna icazəniz yoxdur" instead of doing anything.
 *
 *  - Sidebar, İdarə cards and Əməliyyat tabs: all shown; locked ones dimmed,
 *    click is refused with the message (no navigation).
 *  - X/Z report, refund, split bill, recipe, table transfer/merge/place: the
 *    buttons are always there and refuse when the permission is missing.
 *  - The core checks every write anyway; its E_FORBIDDEN now reads the same
 *    message wherever a screen shows it (preload rewrites it and raises
 *    `ps:denied`, which the renderer turns into one toast).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_LOCKED_VISIBLE_v1 */';
const DENIED = 'Buna icazəniz yoxdur';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

// v2: the refusal toast answers a person, not a screen loading in the
// background. Opening an order read the dish costs (reports.costing needs
// inventory.view); with Anbar closed that read was refused and the toast
// appeared before anyone touched anything. Now:
//  - `ps:denied` from the preload toasts only within 2 s of a tap/click/key;
//  - the order screen does not ask for costs it may not read.
const MARK_V2 = '/* POS_LOCKED_VISIBLE_v2 */';
const LISTENER_V1 = 'window.addEventListener("ps:denied", () => _psDenied());';
const LISTENER_V2 = `${MARK_V2}
window.__psLastInput = 0;
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => { window.__psLastInput = Date.now(); }, true);
window.addEventListener("ps:denied", () => { if (Date.now() - window.__psLastInput < 2000) _psDenied(); });`;
const MAYA_READ = '        const res = await window.pos.inventory.costing();\n        if (!res.success) return;\n        const map = {};';
const MAYA_GUARDED = '        if (!useAuthStore.getState().hasPermission("inventory.view")) return;\n' + MAYA_READ;
function applyV2(src) {
  if (src.includes(MARK_V2)) return src;
  src = replaceOnce(src, LISTENER_V1, LISTENER_V2, 'denied listener v2');
  // The order-screen cost read was patched in by hand, not by a script: guard it when present.
  if (src.split(MAYA_READ).length - 1 === 1) src = src.replace(MAYA_READ, MAYA_GUARDED);
  return src;
}

// --- renderer ---------------------------------------------------------------
let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  if (s.includes(MARK_V2)) console.log('bundle already applied');
  else {
    fs.writeFileSync(BUNDLE, applyV2(s));
    console.log('bundle v2 applied', BUNDLE);
  }
} else {
  s = replaceOnce(s, 'function _psArea(path){', `${MARK}
function _psDenied() {
  toast(${JSON.stringify(DENIED)}, "danger");
}
window.addEventListener("ps:denied", () => _psDenied());
function _psArea(path){`, 'denied helper');

  // Sidebar: every link rendered; a locked one is dimmed and refuses the click.
  s = replaceOnce(s,
    'children: links.filter((l) => l.show).map(({ to, label, icon: Icon2 }) => /* @__PURE__ */ jsxRuntimeExports.jsxs(\n          NavLink,\n          {\n            to,\n            end: to === "/admin",\n            title: label,',
    'children: links.map(({ to, label, icon: Icon2, show: _psOk }) => /* @__PURE__ */ jsxRuntimeExports.jsxs(\n          NavLink,\n          {\n            to,\n            end: to === "/admin",\n            title: _psOk ? label : `${label} · ' + DENIED + '`,\n            "aria-disabled": _psOk ? void 0 : true,\n            onClick: _psOk ? void 0 : (event) => { event.preventDefault(); _psDenied(); },',
    'sidebar links');

  // İdarə hub: keep every card, mark the ones this person may not open.
  s = replaceOnce(s, '  ].filter((l) => l.show && _psArea(l.to));\n  return jsxRuntimeExports.jsx(PsAdminHub, { links });',
    '  ].map((l) => ({ ...l, locked: !(l.show && _psArea(l.to)) }));\n  return jsxRuntimeExports.jsx(PsAdminHub, { links });', 'hub list');
  // The cards themselves live in scripts/admin-ui/components.jsx, which
  // apply-restaurant-admin-refresh.mjs regenerates on every run; the lock is
  // written there, not here, or the next launch would erase it.

  // Əməliyyat tabs: the allowed list still drives which panel renders; the
  // buttons come from the full list.
  const tabsEnd = '  ].filter((tab) => tab.show);';
  must(s.split(tabsEnd).length - 1 === 1, 'ops tabs end');
  const tabsStartIdx = s.lastIndexOf('const tabs = [', s.indexOf(tabsEnd));
  must(tabsStartIdx > 0, 'ops tabs start');
  s = s.slice(0, tabsStartIdx) + 'const _psTabs = [' + s.slice(tabsStartIdx + 'const tabs = ['.length);
  s = replaceOnce(s, tabsEnd, '  ];\n  const tabs = _psTabs.filter((tab) => tab.show);', 'ops tabs split');
  s = replaceOnce(s,
    'children: tabs.map((tab) =>\n      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {\n        type: "button",\n        onClick: () => setActive(tab.id), "aria-current"',
    'children: _psTabs.map((tab) =>\n      /* @__PURE__ */ jsxRuntimeExports.jsx("button", {\n        type: "button",\n        "aria-disabled": tab.show ? void 0 : true,\n        onClick: () => tab.show ? setActive(tab.id) : _psDenied(), "aria-current"',
    'ops tab buttons');

  // X / Z report buttons.
  s = replaceOnce(s, '        canX && /* @__PURE__ */ jsxRuntimeExports.jsx(\n          "button",\n          {\n            type: "button",\n            disabled: busy,\n            onClick: () => void runXReport(),',
    '        /* @__PURE__ */ jsxRuntimeExports.jsx(\n          "button",\n          {\n            type: "button",\n            disabled: busy,\n            "aria-disabled": canX ? void 0 : true,\n            onClick: () => canX ? void runXReport() : _psDenied(),', 'X report');
  s = replaceOnce(s, '        canZ && /* @__PURE__ */ jsxRuntimeExports.jsx(\n          "button",\n          {\n            type: "button",\n            disabled: busy,\n            onClick: () => void openZClose(),',
    '        /* @__PURE__ */ jsxRuntimeExports.jsx(\n          "button",\n          {\n            type: "button",\n            disabled: busy,\n            "aria-disabled": canZ ? void 0 : true,\n            onClick: () => canZ ? void openZClose() : _psDenied(),', 'Z report');

  // Refund and split on the payment screen.
  s = replaceOnce(s, 'canRefund && p.status === "approved" ? /* @__PURE__ */ jsxRuntimeExports.jsx(\n                      "button",\n                      {\n                        type: "button",\n                        disabled: busy,\n                        onClick: () => openRefund(p),',
    'p.status === "approved" ? /* @__PURE__ */ jsxRuntimeExports.jsx(\n                      "button",\n                      {\n                        type: "button",\n                        disabled: busy,\n                        "aria-disabled": canRefund ? void 0 : true,\n                        onClick: () => canRefund ? openRefund(p) : _psDenied(),', 'refund');
  s = replaceOnce(s, 'canSplit && !split ? /* @__PURE__ */ jsxRuntimeExports.jsx(\n            "button",\n            {\n              type: "button",\n              disabled: busy || remaining <= 0,\n              onClick: () => setSplitDialog(true),',
    '!split ? /* @__PURE__ */ jsxRuntimeExports.jsx(\n            "button",\n            {\n              type: "button",\n              disabled: busy || remaining <= 0,\n              "aria-disabled": canSplit ? void 0 : true,\n              onClick: () => canSplit ? setSplitDialog(true) : _psDenied(),', 'split');

  // Recipe: openRecipe already refuses with a message; stop disabling the button.
  s = replaceOnce(s, '            disabled: busy || !canEdit,\n            onClick: () => void openRecipe(row),',
    '            disabled: busy,\n            "aria-disabled": canEdit ? void 0 : true,\n            onClick: () => void openRecipe(row),', 'recipe');

  // Floor plan menu: transfer/merge/items and "move place" always offered.
  s = replaceOnce(s, '    if (table.orderId && canTransfer) {\n      list.push({ id: "relocate"', '    if (table.orderId) {\n      list.push({ id: "relocate"', 'floor transfer items');
  s = replaceOnce(s, '    if (canLayout && useFloorPlan) list.push({ id: "place", label: t.tables.movePlace });', '    if (useFloorPlan) list.push({ id: "place", label: t.tables.movePlace });', 'floor place item');
  s = replaceOnce(s, '      case "place":\n        setFlow({ step: "place", tableId: table.id });\n        return;\n      default:\n        setFlow({ step: "pickTarget", sourceId: table.id, intent: action });',
    '      case "place":\n        if (!canLayout) { _psDenied(); return; }\n        setFlow({ step: "place", tableId: table.id });\n        return;\n      default:\n        if (!canTransfer) { _psDenied(); return; }\n        setFlow({ step: "pickTarget", sourceId: table.id, intent: action });', 'floor actions');

  s = applyV2(s);
  fs.writeFileSync(BUNDLE, s);
  console.log('bundle applied', BUNDLE);
}

// --- preload: one message for every refusal the core sends ------------------
let p = fs.readFileSync(PRELOAD, 'utf8');
if (p.includes(MARK)) {
  console.log('preload already applied');
} else {
  p = replaceOnce(p,
    '    return await electron.ipcRenderer.invoke(IPC.invoke, { method, payload, options });',
    `    ${MARK}
    const result = await electron.ipcRenderer.invoke(IPC.invoke, { method, payload, options });
    if (result && result.success === false && result.error && result.error.code === "E_FORBIDDEN") {
      result.error.message = ${JSON.stringify(DENIED)};
      // DOM events cross the isolated world, so the page's toast hears this even
      // where the calling screen swallows the error.
      try { window.dispatchEvent(new CustomEvent("ps:denied")); } catch {}
    }
    return result;`,
    'preload call');
  fs.writeFileSync(PRELOAD, p);
  console.log('preload applied', PRELOAD);
}

// --- css: dimmed, still clickable -------------------------------------------
let c = fs.readFileSync(CSS, 'utf8');
if (c.includes(MARK)) {
  console.log('css already applied');
} else {
  c += `\n${MARK}\n.ps-nav[aria-disabled="true"],.ps-hub-link[aria-disabled="true"],.ps-ops-tabs button[aria-disabled="true"],button[aria-disabled="true"]{opacity:.45;cursor:not-allowed}\n`;
  fs.writeFileSync(CSS, c);
  console.log('css applied', CSS);
}

const out = fs.readFileSync(BUNDLE, 'utf8');
must(out.includes('_psDenied()') && !out.includes('links.filter((l) => l.show).map'), 'renderer checks failed');
