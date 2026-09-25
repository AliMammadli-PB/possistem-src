#!/usr/bin/env node
/**
 * The sidebar, and the page you land on, follow the job you actually do.
 *
 * `/tables` was pinned `show: true`, so a storekeeper signing in with their PIN
 * got a floor plan they have no permission to touch, and their own work -
 * stock, deliveries, suppliers - was three clicks away behind the admin hub.
 *
 * Both decisions now read the session's permissions rather than a role name,
 * because roles are data: an operator can create "Anbarçı 2" on the roles
 * screen or rename one from the website, and neither should change where that
 * person lands. The shipped names survive only as a hint for sessions that
 * arrive without a permission list.
 *
 * Operations links appear in the sidebar only for people who cannot administer.
 * An admin reaches the same panels through İdarə, which already has a door for
 * each of them; putting both in front of them would just be the same six links
 * twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_ROLE_HOME_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');

// --- the operations route must admit everyone the sidebar sends there -----
// It was gated on `inventory.view` alone, so a person with only suppliers or
// delivery rights was bounced off a page whose own tabs would have welcomed
// them. The page already renders "Bu bölmələr üçün səlahiyyətiniz yoxdur" when
// none of its tabs apply, and every call it makes is permission-checked in the
// core, so the route guard was both too narrow and redundant.
// Guarded separately so it converges even once the main mark is in place.
{
  const guarded = '/* @__PURE__ */ jsxRuntimeExports.jsx(Route, { element: /* @__PURE__ */ jsxRuntimeExports.jsx(RequirePermission, { permission: "inventory.view" }), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/operations", element: /* @__PURE__ */ jsxRuntimeExports.jsx(OperationsPage, {}) }) }),';
  const open = '/* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/operations", element: /* @__PURE__ */ jsxRuntimeExports.jsx(OperationsPage, {}) }),';
  if (s.includes(guarded)) {
    must(s.split(guarded).length - 1 === 1, 'operations route: expected 1 match');
    s = s.replace(guarded, open);
    fs.writeFileSync(BUNDLE, s);
    must(!s.includes(guarded), 'narrow guard survived');
    must(s.includes(open), 'operations route lost');
    console.log('patched: operations route open to every panel it hosts');
  }
}

// --- one active link, not five ------------------------------------------
// The operations links share a pathname and differ only by `?tab=`, so
// NavLink's isActive lit every one of them at once. Guarded separately, like
// the route above, so it converges after the main mark is in place.
{
  const old = 'className: ({ isActive }) => `ps-nav ${isActive ? "ps-nav-on" : "ps-nav-off"}`,';
  const fixed = 'className: ({ isActive }) => `ps-nav ${isActive && _psNavTabMatches(to, location) ? "ps-nav-on" : "ps-nav-off"}`,';
  if (s.includes(old)) {
    must(s.split(old).length - 1 === 1, 'nav className: expected 1 match');
    s = s.replace(old, fixed);
    const helper = `function _psNavTabMatches(to, location) {
  const q = to.indexOf("?");
  if (q < 0) return true;
  const wanted = new URLSearchParams(to.slice(q)).get("tab");
  return wanted === new URLSearchParams(location.search || "").get("tab");
}
function AppShell() {`;
    must(s.split('function AppShell() {').length - 1 === 1, 'AppShell not unique');
    s = s.replace('function AppShell() {', helper);
    fs.writeFileSync(BUNDLE, s);
    must(s.includes('_psNavTabMatches(to, location)'), 'active-tab check missing');
    must(s.includes('function _psNavTabMatches'), 'helper missing');
    console.log('patched: one active sidebar link at a time');
  }
}

if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

for (const icon of ['PackageOpen', 'Store', 'Users', 'Table2', 'Soup', 'Move', 'ClipboardList']) {
  must(s.includes(`const ${icon} = createLucideIcon`), `${icon} is not in the bundle`);
}

// --- where you land -------------------------------------------------------
s = replaceOnce(
  s,
  `function homeRouteForRole(role) {
  switch (role) {
    case "kitchen":
      return "/kds";
    case "cashier":
      return "/tables";
    default:
      return "/tables";
  }
}`,
  `function homeRouteForRole(session) {
  // Called with the whole session now; the old call passed just the role, so
  // a string is still accepted rather than crashing on a stale caller.
  const role = typeof session === "string" ? session : session?.role;
  const perms = session && typeof session === "object" && Array.isArray(session.permissions)
    ? session.permissions
    : [];
  const can = (key) => perms.includes(key);

  if (perms.length) {
    // Ordered by how much of the shift is spent there. An administrator holds
    // everything and so keeps landing on the floor, which is what they had.
    if (can("order.view") || can("order.create") || can("tables.status")) return "/tables";
    if (can("kds.operate") || can("kds.view")) return "/kds";
    if (can("inventory.view")) return "/operations?tab=stock";
    if (can("suppliers.view")) return "/operations?tab=suppliers";
    if (can("delivery.view")) return "/operations?tab=delivery";
    if (can("customers.view")) return "/operations?tab=guests";
    if (can("schedule.view")) return "/operations?tab=roster";
    if (can("reports.view")) return "/admin";
  }

  // No permission list on the session: fall back to the shipped role names.
  if (role === "kitchen") return "/kds";
  if (role === "storekeeper") return "/operations?tab=stock";
  return "/tables";
}`,
  'home route',
);

// Five call sites, all with `session` in scope.
const before = s.split('homeRouteForRole(session.role)').length - 1;
must(before === 5, `expected 5 call sites, found ${before}`);
s = s.split('homeRouteForRole(session.role)').join('homeRouteForRole(session)');

// --- what the sidebar shows ----------------------------------------------
s = replaceOnce(
  s,
  `  const serviceLinks = [
    { to: "/tables", label: t.nav.tables, icon: Table2, show: true },
    { to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") }
  ];`,
  `  // Only for people whose job this is. An admin gets the same panels from
  // İdarə, which has a door for each; showing both would be one list twice.
  const opsLinks = canAdmin ? [] : [
    { to: "/operations?tab=stock", label: "Anbar", icon: PackageOpen, show: hasPermission("inventory.view") },
    { to: "/operations?tab=suppliers", label: "Təchizat", icon: Store, show: hasPermission("suppliers.view") },
    { to: "/operations?tab=guests", label: "Müştərilər", icon: Users, show: hasPermission("customers.view") },
    { to: "/operations?tab=delivery", label: "Çatdırılma", icon: Move, show: hasPermission("delivery.view") },
    { to: "/operations?tab=roster", label: "İş qrafiki", icon: ClipboardList, show: hasPermission("schedule.view") }
  ];
  const serviceLinks = [
    {
      to: "/tables",
      label: t.nav.tables,
      icon: Table2,
      // Was pinned open, which is how a storekeeper ended up staring at a floor
      // plan. Anyone who touches an order or a table still sees it.
      show: hasPermission("order.view") || hasPermission("order.create") || hasPermission("tables.status")
    },
    { to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") || hasPermission("kds.view") },
    ...opsLinks
  ];`,
  'sidebar links',
);

// --- never strand anyone --------------------------------------------------
s = replaceOnce(
  s,
  `  const links = [...serviceLinks, ...adminLinksNav];`,
  `  const visible = [...serviceLinks, ...adminLinksNav].filter((l) => l.show);
  // A permission set nobody anticipated must not produce an empty sidebar: a
  // till with no way out of the current screen is worse than one extra link.
  const links = visible.length
    ? [...serviceLinks, ...adminLinksNav]
    : [{ to: "/tables", label: t.nav.tables, icon: Table2, show: true }];`,
  'sidebar fallback',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('function homeRouteForRole(session)'), 'home route not rewritten');
must(s.split('homeRouteForRole(session.role)').length - 1 === 0, 'a stale call site survived');
must(s.split('homeRouteForRole(session)').length - 1 >= 5, 'call sites lost');
must(!s.includes('{ to: "/tables", label: t.nav.tables, icon: Table2, show: true },\n    { to: "/kds"'), 'tables still pinned open');
must(s.includes('label: "Anbar", icon: PackageOpen'), 'stock link missing');
must(s.includes('const opsLinks = canAdmin ? []'), 'ops links not gated on canAdmin');
must(s.includes('visible.length'), 'empty-sidebar fallback missing');

console.log('patched', BUNDLE);
