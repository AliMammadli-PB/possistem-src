#!/usr/bin/env node
/**
 * Topdan POS (wholesale till) as a fifth product on the control plane, the same
 * way as Aptek POS (apply-aptek-product.mjs, which must have run first): its own
 * activation-key product 'topdan', sale choices in the admin and partner panels,
 * the sales list and its own installer feed (/var/www/topdanpos/updates), while
 * the licence behind it is a market-family licence marked features.vertical
 * 'topdan'. Every sale creates its own customer account, so a wholesaler's data
 * is kept apart from every other shop by customer.
 *
 * Also: a site visitor's request (contact_leads) now says which product they
 * want (restaurant, market, geyim, aptek, topdan), shown in the admin Leads page
 * and the notification email.
 *
 * Runs on the VPS against /opt/possistem-pos-control. Backups next to each file
 * (.bak-<stamp>), marker-guarded edits (a second run changes nothing), and an
 * anchor that is not found exactly once stops the run before anything is written.
 *
 *   node apply-topdan-product.mjs [root] [--check]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ROOT = args.find((a) => !a.startsWith('--')) || '/opt/possistem-pos-control';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const M = 'topdan-product';

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
  ['product enum', `/* ${M}: enum */`,
    "z.enum(['restaurant', 'market', 'geyim', 'aptek']); /* aptek-product */",
    `z.enum(['restaurant', 'market', 'geyim', 'aptek', 'topdan']); /* aptek-product */ /* ${M}: enum */`],
  ['lead product', `/* ${M}: lead */`,
    "  message: optionalLeadText(2000),\n  source: z.string().trim().min(1).max(120).default('website'),",
    `  message: optionalLeadText(2000),\n  /* ${M}: lead */ product: z.enum(['restaurant', 'market', 'geyim', 'aptek', 'topdan']).optional(),\n  source: z.string().trim().min(1).max(120).default('website'),`],
]);

plan('packages/database/src/schema.ts', [
  ['lead product column', `/* ${M} */`,
    "    message: text('message'),\n    source: text('source').notNull().default('website'),\n    status: text('status').notNull().default('new'),",
    `    message: text('message'),\n    product: text('product'), /* ${M} */\n    source: text('source').notNull().default('website'),\n    status: text('status').notNull().default('new'),`],
]);

const API = 'apps/api/src';
plan(`${API}/lib/provision.ts`, [
  ['product type', `/* ${M}: type */`,
    "export type ActivationProduct = 'restaurant' | 'market' | 'geyim' | 'aptek';",
    `export type ActivationProduct = 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; /* ${M}: type */`],
  ['market family', `/* ${M}: family */`,
    "  const marketFamily = product === 'market' || product === 'geyim' || product === 'aptek';",
    `  const marketFamily = product === 'market' || product === 'geyim' || product === 'aptek' || product === 'topdan'; /* ${M}: family */`],
  ['vertical', `/* ${M}: vertical */`,
    "    if (product === 'geyim' || product === 'aptek') features.vertical = product;",
    `    if (product === 'geyim' || product === 'aptek' || product === 'topdan') features.vertical = product; /* ${M}: vertical */`],
]);

plan(`${API}/lib/setup-feed.ts`, [
  ['feed type', `/* ${M}: type */`,
    "export type SetupProduct = 'restaurant' | 'market' | 'geyim' | 'aptek';",
    `export type SetupProduct = 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; /* ${M}: type */`],
  ['topdan feed', `/* ${M}: feed */`,
    "    productName: 'AptekPos',\n  },\n};",
    `    productName: 'AptekPos',\n  },\n  /* ${M}: feed */\n  topdan: {\n    publicBase: 'https://possistem.az/topdanpos/updates',\n    localFile: '/var/www/topdanpos/updates/latest.yml',\n    localHttp: 'http://127.0.0.1/topdanpos/updates',\n    productName: 'TopdanPos',\n  },\n};`],
]);

const NAMES = "aptek: 'Aptek POS' /* aptek-product */ }";
const NAMES_NEXT = `aptek: 'Aptek POS' /* aptek-product */, topdan: 'Topdan POS' /* ${M} */ }`;
plan(`${API}/routes/devices.ts`, [['redeem message', `/* ${M} */`, NAMES, NAMES_NEXT]]);
plan(`${API}/routes/tenant.ts`, [['login message', `/* ${M} */`, NAMES, NAMES_NEXT]]);

plan(`${API}/routes/downloads.ts`, [
  ['topdan installer', `/* ${M} */`,
    "product === 'aptek' /* aptek-product */ ? product",
    `product === 'aptek' /* aptek-product */ || product === 'topdan' /* ${M} */ ? product`],
]);

plan(`${API}/routes/customer.ts`, [
  ['requested topdan', `/* ${M}: requested */`,
    "  if (requested === 'geyim' || requested === 'aptek') return requested;",
    `  if (requested === 'geyim' || requested === 'aptek' || requested === 'topdan') return requested; /* ${M}: requested */`],
  ['key products', `/* ${M}: keys */`,
    "k.product IN ('market', 'geyim', 'aptek')",
    `k.product IN ('market', 'geyim', 'aptek', 'topdan') /* ${M}: keys */`],
  ['single vertical', `/* ${M}: vertical */`,
    "  return only === 'geyim' || only === 'aptek' ? only : ('market' as const);",
    `  return only === 'geyim' || only === 'aptek' || only === 'topdan' ? only : ('market' as const); /* ${M}: vertical */`],
]);

plan(`${API}/routes/resellers.ts`, [
  ['filter type', `/* ${M}: type */`,
    "product?: 'restaurant' | 'market' | 'geyim' | 'aptek'; limit?: string };",
    `product?: 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; limit?: string }; /* ${M}: type */`],
  ['filter', `/* ${M}: filter */`,
    "query.product === 'market' || query.product === 'geyim' || query.product === 'aptek'",
    `query.product === 'market' || query.product === 'geyim' || query.product === 'aptek' || query.product === 'topdan' /* ${M}: filter */`],
]);

plan(`${API}/routes/contact.ts`, [
  ['store lead product', `/* ${M}: insert */`,
    "          message: body.message,\n          source: body.source,",
    `          message: body.message,\n          product: body.product ?? null, /* ${M}: insert */\n          source: body.source,`],
  ['email lead product', `/* ${M}: email */`,
    "        message: body.message,\n        source: body.source,\n      });",
    `        message: body.message,\n        product: body.product ?? null, /* ${M}: email */\n        source: body.source,\n      });`],
]);

plan(`${API}/lib/lead-email.ts`, [
  ['email type', `/* ${M}: type */`,
    "  source?: string | null;\n};",
    `  source?: string | null;\n  product?: string | null; /* ${M}: type */\n};`],
  ['email row', `/* ${M}: row */`,
    "    { label: 'Mənbə', value: input.source ?? 'sayt' },",
    `    { label: 'Məhsul', value: ({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS', aptek: 'Aptek POS', topdan: 'Topdan POS' } as Record<string, string>)[input.product ?? ''] ?? 'seçilməyib' }, /* ${M}: row */\n    { label: 'Mənbə', value: input.source ?? 'sayt' },`],
]);

const ADMIN = 'apps/admin-web/src';
plan(`${ADMIN}/components/SaleForm.tsx`, [
  ['product type', `/* ${M}: type */`,
    'type PosProduct = "restaurant" | "market" | "geyim" | "aptek";',
    `type PosProduct = "restaurant" | "market" | "geyim" | "aptek" | "topdan"; /* ${M}: type */`],
  ['label', `/* ${M}: label */`,
    '    value === "aptek" ? "Aptek POS" /* aptek-product: label */ :',
    `    value === "topdan" ? "Topdan POS" /* ${M}: label */ : value === "aptek" ? "Aptek POS" /* aptek-product: label */ :`],
  ['radio', `{/* ${M}: radio */}`,
    '                <small>Apteklər · seriya və son istifadə tarixi, resept, qutu/ədəd satışı</small>\n              </span>\n            </label>',
    `                <small>Apteklər · seriya və son istifadə tarixi, resept, qutu/ədəd satışı</small>\n              </span>\n            </label>\n            {/* ${M}: radio */}\n            <label data-active={product === "topdan" ? "1" : "0"}>\n              <input\n                type="radio"\n                name="product"\n                value="topdan"\n                checked={product === "topdan"}\n                onChange={() => setProduct("topdan")}\n              />\n              <span>\n                <strong>Topdan POS</strong>\n                <small>Topdan satış və anbar · qaimə, 3 qiymət səviyyəsi, nisyə, yeşik/ədəd</small>\n              </span>\n            </label>`],
]);

plan(`${ADMIN}/pages/SalesPage.tsx`, [
  ['product type', `/* ${M}: type */`,
    "  product: 'restaurant' | 'market' | 'geyim' | 'aptek' | null;",
    `  product: 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan' | null; /* ${M}: type */`],
  ['label', `/* ${M}: label */`,
    "  return product === 'aptek' ? 'Aptek POS' /* aptek-product: label */ :",
    `  return product === 'topdan' ? 'Topdan POS' /* ${M}: label */ : product === 'aptek' ? 'Aptek POS' /* aptek-product: label */ :`],
  ['counts', `/* ${M}: counts */`,
    "row.product === 'market' || row.product === 'geyim' || row.product === 'aptek').length,",
    `row.product === 'market' || row.product === 'geyim' || row.product === 'aptek' || row.product === 'topdan').length, /* ${M}: counts */`],
  ['counts restaurant', `/* ${M}: restaurant */`,
    "row.product !== 'market' && row.product !== 'geyim' && row.product !== 'aptek').length,",
    `row.product !== 'market' && row.product !== 'geyim' && row.product !== 'aptek' && row.product !== 'topdan').length, /* ${M}: restaurant */`],
  ['filter option', `{/* ${M}: option */}`,
    '{/* aptek-product: option */}<option value="aptek">Aptek POS</option>\n',
    `{/* aptek-product: option */}<option value="aptek">Aptek POS</option>\n              {/* ${M}: option */}<option value="topdan">Topdan POS</option>\n`],
]);

plan(`${ADMIN}/pages/LeadsPage.tsx`, [
  ['lead type', `/* ${M}: type */`,
    "  message: string | null;\n  source: string;",
    `  message: string | null;\n  product?: string | null; /* ${M}: type */\n  source: string;`],
  ['lead product badge', `{/* ${M}: badge */}`,
    "<p>{lead.name}{lead.city ? ` · ${lead.city}` : ''}</p>",
    `<p>{lead.name}{lead.city ? \` · \${lead.city}\` : ''}{/* ${M}: badge */}{lead.product ? <strong className="lead-product"> · {({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS', aptek: 'Aptek POS', topdan: 'Topdan POS' } as Record<string, string>)[lead.product] ?? lead.product}</strong> : null}</p>`],
]);

const RESELLER = 'apps/reseller-web/src';
plan(`${RESELLER}/api.ts`, [
  ['sale product', `/* ${M} */`,
    "  product?: 'restaurant' | 'market' | 'geyim' | 'aptek';",
    `  product?: 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; /* ${M} */`],
]);
plan(`${RESELLER}/App.tsx`, [
  ['state', `/* ${M}: state */`,
    "useState<'restaurant' | 'market' | 'geyim' | 'aptek'>('restaurant');",
    `useState<'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'>('restaurant'); /* ${M}: state */`],
  ['option', `{/* ${M}: option */}`,
    '{/* aptek-product: option */}<option value="aptek">Aptek POS</option>\n            </select>',
    `{/* aptek-product: option */}<option value="aptek">Aptek POS</option>\n              {/* ${M}: option */}<option value="topdan">Topdan POS</option>\n            </select>`],
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
