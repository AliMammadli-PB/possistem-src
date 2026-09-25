#!/usr/bin/env node
/**
 * The sidebar follows what the website closed.
 *
 * `window.__psAccess` already reached the route gate (PsGate) and the İdarə /
 * Əməliyyat tabs, but not AppShell's own links: a till whose Anbar the head
 * admin had shut still showed the link, and pressing it landed on "Buna
 * icazəniz yoxdur". The link now disappears within one sync tick (5 s).
 *
 * Also: the Mətbəx link was shown for `kds.view`, while the route itself needs
 * `kds.operate`, so a view-only user was offered a door that was locked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_SIDEBAR_ACCESS_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let src = fs.readFileSync(BUNDLE, 'utf8');
if (src.includes(MARK)) {
  console.log('sidebar access already applied');
  process.exit(0);
}

src = replaceOnce(
  src,
  `  const floorMode = isFloorPath(location.pathname);
  const canAdmin = hasPermission("reports.view")`,
  `  const floorMode = isFloorPath(location.pathname);
  ${MARK}const[, _psNavTick]=reactExports.useState(0);reactExports.useEffect(()=>{const fn=()=>_psNavTick(n=>n+1);window.addEventListener("ps:access",fn);return()=>window.removeEventListener("ps:access",fn);},[]);
  const canAdmin = hasPermission("reports.view")`,
  'AppShell access tick',
);

src = replaceOnce(
  src,
  `{ to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") || hasPermission("kds.view") },`,
  `{ to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") },`,
  'kds link',
);

src = replaceOnce(
  src,
  `  const visible = [...serviceLinks, ...adminLinksNav].filter((l) => l.show);`,
  `  for (const l of [...serviceLinks, ...adminLinksNav]) l.show = l.show && _psArea(l.to);
  const visible = [...serviceLinks, ...adminLinksNav].filter((l) => l.show);`,
  'nav area filter',
);

fs.writeFileSync(BUNDLE, src);
must(fs.readFileSync(BUNDLE, 'utf8').includes('l.show = l.show && _psArea(l.to)'), 'filter not written');
console.log('sidebar access applied', BUNDLE);
