#!/usr/bin/env node
/**
 * A closed section still opens; doing something in it is what gets refused.
 *
 * With every area closed on the website the till showed one sidebar link and a
 * blank "Buna icazəniz yoxdur" page. The owner's rule is that the screen keeps
 * its shape - every link, every button - and an attempt to act answers
 * "Buna icazəniz yoxdur".
 *
 *  - Sidebar: the "nothing allowed" fallback (a lone Masalar link) is gone; the
 *    full list always renders (locked links already refuse, see
 *    apply-restaurant-locked-visible.mjs).
 *  - PsGate (website areas) and RequirePermission (role permissions): the page
 *    renders inside _PsLocked, which swallows clicks, taps, drags and typing on
 *    anything interactive and says why. Scrolling and looking stay free.
 *  - _PsLocked also catches a render error - a page whose reads the core
 *    refuses shows the message instead of a white screen.
 *  - The station redirect (a kitchen PC opening on Mətbəx) now happens once per
 *    run instead of on every visit to a closed section.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LOCKED_PAGES_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const MARK_V2 = '/* POS_LOCKED_PAGES_v2 */';

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  // v2: the İdarə hub and the Əməliyyat tab row lock each card/tab themselves,
  // so a closed page must not also swallow picking a group or searching -
  // that is looking, not working.
  if (!s.includes(MARK_V2)) {
    s = replaceOnce(s,
      'function _psActs(target, root) {\n',
      `function _psActs(target, root) {\n  ${MARK_V2}if (target instanceof Element && target.closest(".ps-admin-hub, .ps-ops-tabs")) return false;\n`,
      'self-locking lists');
    fs.writeFileSync(BUNDLE, s);
    console.log('locked pages v2 applied', BUNDLE);
  } else {
    console.log('locked pages already applied');
  }
  process.exit(0);
}
must(s.includes('function _psDenied()'), 'apply-restaurant-locked-visible.mjs must run first');

s = replaceOnce(s,
  `  const links = visible.length
    ? [...serviceLinks, ...adminLinksNav]
    : [{ to: "/tables", label: t.nav.tables, icon: Table2, show: true }];`,
  `  ${MARK}void visible;
  const links = [...serviceLinks, ...adminLinksNav];`,
  'sidebar fallback');

s = replaceOnce(s,
  `    /* POS_LAN_v1 */const home = Array.isArray(window.__psAccess) ? ["/tables", "/kds", "/operations?tab=stock", "/refund", "/settings"].find((p) => _psArea(p) && p !== location.pathname + location.search) : null;
    if (home) return jsxRuntimeExports.jsx(Navigate, { to: home, replace: true });
    return jsxRuntimeExports.jsx("div", { className: "flex h-full items-center justify-center text-cream", children: "Buna icazəniz yoxdur" });`,
  `    /* POS_LAN_v1 */const home = !window.__psHomed && Array.isArray(window.__psAccess) ? ["/tables", "/kds", "/operations?tab=stock", "/refund", "/settings"].find((p) => _psArea(p) && p !== location.pathname + location.search) : null;
    if (home) { window.__psHomed = true; return jsxRuntimeExports.jsx(Navigate, { to: home, replace: true }); }
    return jsxRuntimeExports.jsx(_PsLocked, { children: jsxRuntimeExports.jsx(Outlet, {}) });`,
  'PsGate');

s = replaceOnce(s,
  `  if (!hasPermission(permission)) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex h-full items-center justify-center text-cream", children: "Buna icazəniz yoxdur" });
  }`,
  `  if (!hasPermission(permission)) {
    return jsxRuntimeExports.jsx(_PsLocked, { children: jsxRuntimeExports.jsx(Outlet, {}) });
  }`,
  'RequirePermission');

s = replaceOnce(s, 'function _psDenied() {', `/** Something the user can act on: a control, or anything drawn as clickable. */
function _psActs(target, root) {
  ${MARK_V2}if (target instanceof Element && target.closest(".ps-admin-hub, .ps-ops-tabs")) return false;
  for (let el = target; el && el !== root && el instanceof Element; el = el.parentElement) {
    if (el.matches('button, a, input, select, textarea, label, [role="button"], [role="tab"], [role="option"], [contenteditable="true"]')) return true;
    if (getComputedStyle(el).cursor === "pointer") return true;
  }
  return false;
}
class _PsLockedBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? jsxRuntimeExports.jsx("div", { className: "flex h-full items-center justify-center text-cream", children: "Buna icazəniz yoxdur" })
      : this.props.children;
  }
}
/** The page, fully drawn; acting on it is refused with the reason. */
function _PsLocked({ children }) {
  const refuse = (event) => {
    if (!_psActs(event.target, event.currentTarget)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "pointerdown") _psDenied();
  };
  const refuseKey = (event) => {
    if (event.key === "Tab" || event.key.startsWith("Arrow") || event.key === "Escape") return;
    refuse(event);
  };
  return jsxRuntimeExports.jsx("div", {
    className: "h-full",
    "data-ps-locked": "true",
    onClickCapture: refuse,
    onPointerDownCapture: refuse,
    onKeyDownCapture: refuseKey,
    onSubmitCapture: refuse,
    onDragStartCapture: refuse,
    children: jsxRuntimeExports.jsx(_PsLockedBoundary, { children })
  });
}
function _psDenied() {`, 'locked wrapper');

fs.writeFileSync(BUNDLE, s);
const out = fs.readFileSync(BUNDLE, 'utf8');
must(!out.includes('show: true }];') || !out.includes('icon: Table2, show: true }];'), 'sidebar fallback still present');
must(out.includes('jsx(_PsLocked, { children: jsxRuntimeExports.jsx(Outlet, {}) })'), 'locked pages not wired');
console.log('locked pages applied', BUNDLE);
