#!/usr/bin/env node
/**
 * Clicking Təchizat in the sidebar showed Anbar.
 *
 * The panel read `?tab=` in a `useState` initialiser, which runs once. Moving
 * between two sidebar links that share the `/operations` pathname changes the
 * query but never remounts the component, so the tab state kept its first
 * value - while the sidebar's active mark, which reads `location.search` on
 * every render, moved. The nav said Təchizat and the page said Anbar.
 *
 * The URL is the one source now: the tab is derived from `useLocation()` every
 * render, with state only for tab clicks inside the page, and a click also
 * writes the query so a reload lands where the operator was.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_OPS_TABSYNC_v1 */';

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
  `  const opsLocation = useLocation();
  const opsNavigate = useNavigate();

  // Read from both places: a hash router keeps the query inside the hash.
  const wantedTab = (() => {
    const fromSearch = new URLSearchParams(opsLocation.search || "").get("tab");
    const hash = opsLocation.hash || "";
    const fromHash = hash.includes("?")
      ? new URLSearchParams(hash.slice(hash.indexOf("?"))).get("tab")
      : null;
    return fromSearch || fromHash;
  })();

  const [picked, setPicked] = reactExports.useState("");

  // The URL wins whenever it names a tab this operator can open: two sidebar
  // links share this pathname, so a move between them is a query change with
  // no remount, and state alone would never hear about it.
  const active = tabs.some((tab) => tab.id === wantedTab)
    ? wantedTab
    : (tabs.some((tab) => tab.id === picked) ? picked : (tabs[0]?.id ?? ""));

  const setActive = (id) => {
    setPicked(id);
    // Keep the address in step so a reload, or the sidebar's active mark,
    // agrees with what is on screen.
    opsNavigate({ pathname: "/operations", search: "?tab=" + id }, { replace: true });
  };

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];`,
  'operations tab from the url',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('const opsLocation = useLocation();'), 'location not read');
must(s.includes('tabs.some((tab) => tab.id === wantedTab)'), 'url does not win');
must(!s.includes('new URLSearchParams(window.location.search).get("tab")'),
     'the once-only initialiser survived');
must(s.includes('opsNavigate({ pathname: "/operations", search: "?tab=" + id }'),
     'a tab click does not update the address');
// useLocation/useNavigate must already be imported in this bundle.
must(s.includes('const location = useLocation();'), 'useLocation is not in scope in this bundle');
must(s.includes('const navigate = useNavigate();'), 'useNavigate is not in scope in this bundle');

console.log('patched', BUNDLE);
