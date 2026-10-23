#!/usr/bin/env node
/**
 * The admin panel asks which product you came for, and then means it.
 *
 * What was wrong, in the order an operator meets it:
 *
 *  - The panel never asked. `product` defaulted to 'restaurant', so someone who
 *    opened it to look at Market read restaurant figures with nothing on screen
 *    saying which product they were looking at.
 *  - The landing page ignored the switch entirely. It counted every customer
 *    POSSISTEM has ever had, called that "Ümumi satış" - a label that is
 *    neither a sale nor scoped to anything - and put a reseller count next to
 *    it under the heading "Aktiv admin panelləri".
 *  - `/setup` asked the API for an installer without naming a product, so it
 *    always returned the restaurant one. The workaround was to hide the page in
 *    Market mode, which left no way at all to hand out the MarketPos installer.
 *  - The sidebar called the webshop catalogue "Məhsullar" while the topbar
 *    called the POS product "Məhsul" - the same word for two unrelated things,
 *    side by side.
 *  - The sidebar called reseller panels "Admin panelləri", which is what an
 *    operator would reasonably call the panel they are standing in.
 *
 * Runs on the VPS against /opt/possistem-pos-control, a deployed directory
 * rather than a git checkout: every file is backed up beside itself and every
 * edit converges on a second run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const SRC = path.join(ROOT, 'apps/admin-web/src');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function backup(file) {
  const bak = `${file}.bak-${STAMP}`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}
function place(name, dest) {
  const from = path.join(HERE, 'admin-web', name);
  must(fs.existsSync(from), `missing source: ${from}`);
  const to = path.join(SRC, dest);
  backup(to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`  + src/${dest}`);
}
function edit(file, apply, label) {
  const full = path.join(SRC, file);
  const before = fs.readFileSync(full, 'utf8');
  const after = apply(before);
  if (after === before) {
    console.log(`  = ${label}`);
    return before;
  }
  backup(full);
  fs.writeFileSync(full, after);
  console.log(`  + ${label}`);
  return after;
}
function replaceOnce(src, find, repl, label) {
  const hits = src.split(find).length - 1;
  must(hits === 1, `${label}: expected 1 match, found ${hits}`);
  return src.replace(find, repl);
}

// --- files ----------------------------------------------------------------
place('product.tsx', 'lib/product.tsx');
place('ProductGate.tsx', 'components/ProductGate.tsx');
place('DashboardPage.tsx', 'pages/DashboardPage.tsx');

// --- the gate, in front of every screen the shell wraps -------------------
edit(
  'components/AppShell.tsx',
  (src) => {
    if (src.includes('<ProductGate />')) return src;
    let out = replaceOnce(
      src,
      "import { POS_PRODUCTS, useProduct } from '../lib/product';",
      `import { POS_PRODUCTS, useProduct } from '../lib/product';
import { ProductGate } from './ProductGate';`,
      'gate import',
    );
    out = replaceOnce(
      out,
      "  const { product, setProduct } = useProduct();",
      "  const { product, setProduct, chosen } = useProduct();",
      'chosen flag',
    );
    // Before the nav is built, so nothing renders a product-shaped screen for a
    // product nobody picked.
    out = replaceOnce(
      out,
      `  // \`/setup\` serves the Restaurant POS installer only, so it is hidden in
  // Market mode rather than handing out the wrong download.
  const NAV = [`,
      `  // Asked once per browser, then remembered. Placed here rather than in a
  // route so it covers every screen the shell wraps, including the ones
  // reached by typing an address.
  if (!chosen) return <ProductGate />;

  const NAV = [`,
      'gate render',
    );
    // The installer page now serves whichever product is selected, so hiding it
    // was the workaround for a bug that is fixed.
    out = replaceOnce(
      out,
      "    ...(product === 'restaurant' ? [{ to: '/setup', label: t.nav.setup }] : []),",
      "    { to: '/setup', label: t.nav.setup },",
      'setup nav',
    );
    return out;
  },
  'AppShell: gate + setup for both products',
);

// --- the installer page follows the switch --------------------------------
edit(
  'components/SetupDownloadCard.tsx',
  (src) => {
    if (src.includes('/downloads/setup?product=')) return src;
    let out = replaceOnce(
      src,
      "import { useI18n } from '../i18n';",
      `import { useI18n } from '../i18n';
import { useProduct } from '../lib/product';`,
      'product import',
    );
    out = replaceOnce(
      out,
      '  const t = useI18n();\n  const [info, setInfo] = useState<SetupInfo | null>(null);',
      '  const t = useI18n();\n  const { product } = useProduct();\n  const [info, setInfo] = useState<SetupInfo | null>(null);',
      'product hook',
    );
    // Re-fetch on switch: the two feeds are different files with different
    // versions, and a stale card would offer the wrong installer.
    out = replaceOnce(
      out,
      "    void api<SetupInfo>('/downloads/setup')",
      "    setLoading(true);\n    void api<SetupInfo>(`/downloads/setup?product=${product}`)",
      'setup fetch',
    );
    out = replaceOnce(
      out,
      '  }, [t.downloads.unavailable]);',
      '  }, [product, t.downloads.unavailable]);',
      'setup effect deps',
    );
    return out;
  },
  'SetupDownloadCard: serves the selected product',
);

// --- words that meant two things ------------------------------------------
edit(
  'i18n/az.ts',
  (src) => {
    if (src.includes('gate:')) return src;
    let out = replaceOnce(
      src,
      `    dashboard: 'Ümumi baxış',
    admins: 'Admin panelləri',`,
      `    dashboard: 'Ümumi baxış',
    admins: 'Bayi panelləri',`,
      'reseller nav label',
    );
    out = replaceOnce(
      out,
      "    products: 'Məhsullar',",
      "    products: 'Sayt kataloqu',",
      'catalogue nav label',
    );
    out = replaceOnce(
      out,
      `  dashboard: {
    title: 'Xoş gəlmisiniz, Admin',
    hint: 'Bayilər, satışlar və quraşdırıcı bir yerdə.',`,
      `  gate: {
    title: 'Hansı məhsulla işləyirsiniz?',
    hint: 'Panel seçdiyiniz məhsula görə göstərir: müştərilər, lisenziyalar, kassalar və quraşdırıcı.',
    foot: 'Sonradan yuxarıdakı keçidlə dəyişə bilərsiniz.',
  },
  dashboard: {
    title: 'Ümumi vəziyyət',
    hint: 'Bu məhsul üzrə müştərilər, kassalar və yayımdakı versiya.',
    shops: 'Müştəri',
    tillsOnline: 'Onlayn kassa',
    tillsSilent: (n: number) => \`\${n} kassa 15 dəqiqədir səssizdir\`,
    openTickets: 'Açıq dəstək sorğusu',
    release: 'Yayımdakı versiya',
    releaseMissing: 'Yeniləmə kanalı oxunmadı — kassalar yeniləmə ala bilməz.',
    recentEmpty: 'Bu məhsul üzrə hələ müştəri yoxdur.',`,
      'dashboard words',
    );
    return out;
  },
  'i18n: gate, dashboard, de-collided nav labels',
);

// --- the gate's own look ---------------------------------------------------
edit(
  'styles.css',
  (src) => {
    if (src.includes('.product-gate')) return src;
    return `${src}
/* ---------------------------------------------------------- product gate --
   Asked once, before any screen that would otherwise have to guess. Its own
   wrapper rather than .auth-page, which is a two-column login layout. */
.product-gate-page {
  display: grid; place-items: center; min-height: 100vh;
  padding: clamp(1.5rem, 5vw, 4rem);
}
.product-gate { width: min(560px, 100%); text-align: center; }
.product-gate-mark { width: 48px; height: auto; margin: 0 auto .9rem; display: block; }
.product-gate-title { margin: 0 0 .5rem; font-size: 1.35rem; }
.product-gate-hint { margin: 0 auto 1.4rem; max-width: 42ch; }
.product-gate-grid {
  display: grid; gap: .8rem;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
.product-gate-card {
  display: flex; flex-direction: column; gap: .3rem;
  padding: 1.15rem 1rem; text-align: left; cursor: pointer;
  background: var(--elevated); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px;
  transition: border-color .15s ease, background .15s ease;
}
.product-gate-card:hover, .product-gate-card:focus-visible {
  border-color: var(--border-strong); background: var(--raised);
}
.product-gate-card strong { font-size: 1.02rem; }
.product-gate-card span { color: var(--muted); font-size: .78rem; }
.product-gate-foot { margin: 1.2rem 0 0; font-size: .75rem; }

/* A stat that needs a sentence under it — how many tills went quiet, where the
   open requests are. Deliberately small: the number is the message. */
.stat-foot {
  display: inline-block; margin-top: .4rem;
  color: var(--muted); font-size: .68rem;
}
a.stat-foot { color: var(--gold-light); }
.release-card { margin-top: 1.2rem; }
.release-line { display: flex; align-items: baseline; gap: .7rem; margin: .6rem 0 0; }
.release-line strong { font-family: var(--nums); font-size: 1.3rem; }
`;
  },
  'styles: product gate + stat footnotes',
);

// --- checks ----------------------------------------------------------------
const shell = fs.readFileSync(path.join(SRC, 'components/AppShell.tsx'), 'utf8');
must(shell.includes('if (!chosen) return <ProductGate />;'), 'the gate does not render');
must(!shell.includes("product === 'restaurant' ? [{ to: '/setup'"), 'setup is still hidden for market');

const card = fs.readFileSync(path.join(SRC, 'components/SetupDownloadCard.tsx'), 'utf8');
must(card.includes('/downloads/setup?product=${product}'), 'the installer is not product-aware');

const dash = fs.readFileSync(path.join(SRC, 'pages/DashboardPage.tsx'), 'utf8');
must(dash.includes('/dashboard/stats?product=${product}'), 'the dashboard is not product-scoped');
must(!dash.includes('t.dashboard.sold'), 'the mislabelled customer count survived');

const words = fs.readFileSync(path.join(SRC, 'i18n/az.ts'), 'utf8');
must(words.includes('Sayt kataloqu'), 'the catalogue label still collides with the product switch');
must(words.includes("admins: 'Bayi panelləri'"), 'reseller panels are still called admin panels');
for (const key of ['shops', 'tillsOnline', 'tillsSilent', 'openTickets', 'release', 'releaseMissing', 'recentEmpty']) {
  must(words.includes(`${key}:`), `dashboard.${key} is missing from the translations`);
}

const product = fs.readFileSync(path.join(SRC, 'lib/product.tsx'), 'utf8');
must(product.includes('chosen: stored !== null'), 'the panel still assumes a product');

console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);
