#!/usr/bin/env node
/**
 * Aptek POS (pharmacy till) as a fourth product on the control plane, the same
 * way as Geyim POS (apply-geyim-product.mjs, which must have run first):
 * its own activation-key product 'aptek', sale choices in the admin and partner
 * panels, the sales list and its own installer feed (/var/www/aptekpos/updates),
 * while the licence behind it is a market-family licence marked
 * features.vertical 'aptek'. Every sale creates its own customer account, so an
 * Aptek pharmacy's data is kept apart from every other shop by customer.
 *
 * Runs on the VPS against /opt/possistem-pos-control. Backups next to each file
 * (.bak-<stamp>), marker-guarded edits (a second run changes nothing), and an
 * anchor that is not found exactly once stops the run before anything is written.
 *
 *   node apply-aptek-product.mjs [root] [--check]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ROOT = args.find((a) => !a.startsWith('--')) || '/opt/possistem-pos-control';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const M = 'aptek-product';

const pending = [];
function plan(rel, edits) {
  const file = path.join(ROOT, rel);
  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  for (const [label, marker, anchor, replacement] of edits) {
    if (src.includes(marker)) {
      console.log(`  = ${rel}: ${label}`);
      continue;
    }
    const n = src.split(anchor).length - 1;
    if (n !== 1) throw new Error(`${rel}: ${label}: anchor found ${n} times`);
    src = src.replace(anchor, () => replacement);
    if (!src.includes(marker)) throw new Error(`${rel}: ${label}: replacement lacks its marker`);
    console.log(`  + ${rel}: ${label}`);
  }
  if (src !== before) pending.push([file, src]);
}

plan('packages/contracts/src/index.ts', [
  ['product enum', `/* ${M} */`,
    "export const PosProductSchema = z.enum(['restaurant', 'market', 'geyim']);",
    `export const PosProductSchema = z.enum(['restaurant', 'market', 'geyim', 'aptek']); /* ${M} */`],
]);

const API = 'apps/api/src';
plan(`${API}/lib/provision.ts`, [
  ['product type', `/* ${M}: type */`,
    "export type ActivationProduct = 'restaurant' | 'market' | 'geyim';",
    `export type ActivationProduct = 'restaurant' | 'market' | 'geyim' | 'aptek'; /* ${M}: type */`],
  ['market family', `/* ${M}: family */`,
    "  const marketFamily = product === 'market' || product === 'geyim';",
    `  const marketFamily = product === 'market' || product === 'geyim' || product === 'aptek'; /* ${M}: family */`],
  ['vertical', `/* ${M}: vertical */`,
    "    if (product === 'geyim') features.vertical = 'geyim';",
    `    if (product === 'geyim' || product === 'aptek') features.vertical = product; /* ${M}: vertical */`],
]);

plan(`${API}/lib/setup-feed.ts`, [
  ['feed type', `/* ${M}: type */`,
    "export type SetupProduct = 'restaurant' | 'market' | 'geyim';",
    `export type SetupProduct = 'restaurant' | 'market' | 'geyim' | 'aptek'; /* ${M}: type */`],
  ['aptek feed', `/* ${M}: feed */`,
    "    productName: 'GeyimPos',\n  },\n};",
    `    productName: 'GeyimPos',\n  },\n  /* ${M}: feed */\n  aptek: {\n    publicBase: 'https://possistem.az/aptekpos/updates',\n    localFile: '/var/www/aptekpos/updates/latest.yml',\n    localHttp: 'http://127.0.0.1/aptekpos/updates',\n    productName: 'AptekPos',\n  },\n};`],
]);

const NAMES = "geyim: 'Geyim POS' }";
const NAMES_NEXT = `geyim: 'Geyim POS', aptek: 'Aptek POS' /* ${M} */ }`;
plan(`${API}/routes/devices.ts`, [['redeem message', `/* ${M} */`, NAMES, NAMES_NEXT]]);
plan(`${API}/routes/tenant.ts`, [['login message', `/* ${M} */`, NAMES, NAMES_NEXT]]);

plan(`${API}/routes/downloads.ts`, [
  ['aptek installer', `/* ${M} */`,
    "isPosProduct(product) || product === 'geyim' ? product",
    `isPosProduct(product) || product === 'geyim' || product === 'aptek' /* ${M} */ ? product`],
]);

// The portal of a market-family shop asks for the market installer; its key says which till it runs.
plan(`${API}/routes/customer.ts`, [
  ['requested aptek', `/* ${M}: requested */`,
    "  if (requested === 'geyim') return 'geyim' as const;",
    `  if (requested === 'geyim' || requested === 'aptek') return requested; /* ${M}: requested */`],
  ['key products', `/* ${M}: keys */`,
    "k.product IN ('market', 'geyim')",
    `k.product IN ('market', 'geyim', 'aptek') /* ${M}: keys */`],
  ['single vertical', `/* ${M}: vertical */`,
    "  return rows.length > 0 && rows.every((row) => row.product === 'geyim') ? ('geyim' as const) : ('market' as const);",
    `  const only = rows.length > 0 && rows.every((row) => row.product === rows[0]!.product) ? rows[0]!.product : 'market'; /* ${M}: vertical */\n  return only === 'geyim' || only === 'aptek' ? only : ('market' as const);`],
]);

plan(`${API}/routes/resellers.ts`, [
  ['filter type', `/* ${M}: type */`,
    "product?: 'restaurant' | 'market' | 'geyim'; limit?: string };",
    `product?: 'restaurant' | 'market' | 'geyim' | 'aptek'; limit?: string }; /* ${M}: type */`],
  ['filter', `/* ${M}: filter */`,
    "query.product === 'market' || query.product === 'geyim'",
    `query.product === 'market' || query.product === 'geyim' || query.product === 'aptek' /* ${M}: filter */`],
]);

const ADMIN = 'apps/admin-web/src';
plan(`${ADMIN}/components/SaleForm.tsx`, [
  ['product type', `/* ${M}: type */`,
    'type PosProduct = "restaurant" | "market" | "geyim";',
    `type PosProduct = "restaurant" | "market" | "geyim" | "aptek"; /* ${M}: type */`],
  ['label', `/* ${M}: label */`,
    '    value === "geyim" ? "Geyim POS" : value === "market"',
    `    value === "aptek" ? "Aptek POS" /* ${M}: label */ : value === "geyim" ? "Geyim POS" : value === "market"`],
  ['radio', `{/* ${M}: radio */}`,
    '                <small>Geyim, ayaqqabı və aksesuar mağazaları · ölçü/rəng, barkod, etiket</small>\n              </span>\n            </label>',
    `                <small>Geyim, ayaqqabı və aksesuar mağazaları · ölçü/rəng, barkod, etiket</small>\n              </span>\n            </label>\n            {/* ${M}: radio */}\n            <label data-active={product === "aptek" ? "1" : "0"}>\n              <input\n                type="radio"\n                name="product"\n                value="aptek"\n                checked={product === "aptek"}\n                onChange={() => setProduct("aptek")}\n              />\n              <span>\n                <strong>Aptek POS</strong>\n                <small>Apteklər · seriya və son istifadə tarixi, resept, qutu/ədəd satışı</small>\n              </span>\n            </label>`],
]);

plan(`${ADMIN}/pages/SalesPage.tsx`, [
  ['product type', `/* ${M}: type */`,
    "  product: 'restaurant' | 'market' | 'geyim' | null;",
    `  product: 'restaurant' | 'market' | 'geyim' | 'aptek' | null; /* ${M}: type */`],
  ['label', `/* ${M}: label */`,
    "  return product === 'geyim' ? 'Geyim POS'",
    `  return product === 'aptek' ? 'Aptek POS' /* ${M}: label */ : product === 'geyim' ? 'Geyim POS'`],
  ['counts', `/* ${M}: counts */`,
    "        market: rows.filter((row) => row.product === 'market' || row.product === 'geyim').length,",
    `        market: rows.filter((row) => row.product === 'market' || row.product === 'geyim' || row.product === 'aptek').length, /* ${M}: counts */`],
  ['counts restaurant', `/* ${M}: restaurant */`,
    "        restaurant: rows.filter((row) => row.product !== 'market' && row.product !== 'geyim').length,",
    `        restaurant: rows.filter((row) => row.product !== 'market' && row.product !== 'geyim' && row.product !== 'aptek').length, /* ${M}: restaurant */`],
  ['filter option', `{/* ${M}: option */}`,
    '<option value="geyim">Geyim POS</option>\n',
    `<option value="geyim">Geyim POS</option>\n              {/* ${M}: option */}<option value="aptek">Aptek POS</option>\n`],
]);

const RESELLER = 'apps/reseller-web/src';
plan(`${RESELLER}/api.ts`, [
  ['sale product', `/* ${M} */`,
    "  product?: 'restaurant' | 'market' | 'geyim';",
    `  product?: 'restaurant' | 'market' | 'geyim' | 'aptek'; /* ${M} */`],
]);
plan(`${RESELLER}/App.tsx`, [
  ['state', `/* ${M}: state */`,
    "useState<'restaurant' | 'market' | 'geyim'>('restaurant');",
    `useState<'restaurant' | 'market' | 'geyim' | 'aptek'>('restaurant'); /* ${M}: state */`],
  ['option', `{/* ${M}: option */}`,
    '              <option value="geyim">Geyim POS</option>\n            </select>',
    `              <option value="geyim">Geyim POS</option>\n              {/* ${M}: option */}<option value="aptek">Aptek POS</option>\n            </select>`],
]);

if (CHECK) {
  console.log(`check ok: ${pending.length} file(s) would change`);
  process.exit(0);
}
for (const [file, src] of pending) {
  fs.copyFileSync(file, `${file}.bak-${STAMP}`);
  fs.writeFileSync(file, src);
}
console.log(`applied: ${pending.length} file(s), backups .bak-${STAMP}`);
