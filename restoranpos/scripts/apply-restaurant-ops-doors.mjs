#!/usr/bin/env node
/**
 * Doors straight into Anbar, Təchizat and the rest.
 *
 * Everything was already built and reachable - as tabs behind one hub tile
 * called "Əməliyyatlar", which tells an owner nothing about where their stock
 * is. The report was simply "anbari falan gormurem": not missing, unfindable.
 *
 * So the generic tile becomes six named ones, each opening the panel on its own
 * tab. Nothing new is built and no tab is lost: İxrac and anything added later
 * stay reachable as tabs once inside.
 *
 * The tab comes from the URL query, read off `location` directly rather than
 * through the router, so this works the same under a hash or a browser router.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_OPS_DOORS_v1 */';

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

// Every icon named below must already be in the bundle. A missing one is a
// ReferenceError at render, which no syntax check would catch - this is the
// ShieldCheck mistake, written down as an assertion.
for (const icon of ['PackageOpen', 'Store', 'Users', 'Table2', 'Move', 'ClipboardList']) {
  must(
    s.includes(`const ${icon} = createLucideIcon`),
    `${icon} is not in the bundle - pick one that is`,
  );
}

// --- the panel opens on the tab it was asked for --------------------------
s = replaceOnce(
  s,
  `  const [active, setActive] = reactExports.useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];`,
  `  const [active, setActive] = reactExports.useState(() => {
    // Read from both places: a hash router keeps the query inside the hash.
    const fromSearch = new URLSearchParams(window.location.search).get("tab");
    const hash = window.location.hash;
    const fromHash = hash.includes("?")
      ? new URLSearchParams(hash.slice(hash.indexOf("?"))).get("tab")
      : null;
    const wanted = fromSearch || fromHash;
    return tabs.some((tab) => tab.id === wanted) ? wanted : (tabs[0]?.id ?? "");
  });
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];`,
  'operations opens on the requested tab',
);

// --- six named doors instead of one vague one -----------------------------
s = replaceOnce(
  s,
  `    { to: "/operations", label: "Əməliyyatlar", icon: ClipboardList, show: hasPermission("inventory.view") },`,
  `    { to: "/operations?tab=stock", label: "Anbar", icon: PackageOpen, show: hasPermission("inventory.view") },
    { to: "/operations?tab=suppliers", label: "Təchizat", icon: Store, show: hasPermission("suppliers.view") },
    { to: "/operations?tab=guests", label: "Müştərilər", icon: Users, show: hasPermission("customers.view") },
    { to: "/operations?tab=reservations", label: "Rezervasiya", icon: Table2, show: hasPermission("reservations.view") },
    { to: "/operations?tab=delivery", label: "Çatdırılma", icon: Move, show: hasPermission("delivery.view") },
    { to: "/operations?tab=roster", label: "İş qrafiki", icon: ClipboardList, show: hasPermission("schedule.view") },`,
  'hub doors',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

for (const tab of ['stock', 'suppliers', 'guests', 'reservations', 'delivery', 'roster']) {
  must(s.includes(`to: "/operations?tab=${tab}"`), `${tab} door missing`);
}
must(!s.includes('label: "Əməliyyatlar", icon: ClipboardList'), 'the vague tile survived');
must(s.includes('tabs.some((tab) => tab.id === wanted)'), 'tab selection not wired');
// A door to a tab the operator cannot open would be a dead tile.
must(s.includes('label: "Anbar", icon: PackageOpen, show: hasPermission("inventory.view")'), 'stock door ungated');

console.log('patched', BUNDLE);
