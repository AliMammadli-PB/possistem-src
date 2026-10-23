#!/usr/bin/env node
/**
 * Geyim POS (clothing-store till) as a third product on the control plane.
 *
 * What makes it its own product: the activation key (product 'geyim'), the
 * sale choice in the admin and partner panels, the sales list, and its own
 * installer feed (/var/www/geyimpos/updates). What it shares with Market POS:
 * everything behind the licence. A Geyim licence is a market licence
 * (plan 'market', features.product 'market', features.market true) marked
 * features.vertical 'geyim', so the portal, roles, stock and /market-pos/*
 * treat it exactly as a market till, with no change there.
 * ponytail: a customer with both a Market and a Geyim licence shares one market
 * data set; split them with a product of their own if such a customer appears.
 *
 * Runs on the VPS against /opt/possistem-pos-control (not a git checkout).
 * Every touched file is backed up next to itself (.bak-<stamp>), every edit is
 * guarded by a marker so a second run changes nothing, and an anchor that is
 * not found exactly once stops the run before anything is written.
 *
 *   node apply-geyim-product.mjs [root] [--check]
 *
 * Then: migration 0035, contracts + api build, admin-web + reseller-web build.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ROOT = args.find((a) => !a.startsWith('--')) || '/opt/possistem-pos-control';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const M = 'geyim-product'; // marker prefix

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

// ---------- contracts ----------
plan('packages/contracts/src/index.ts', [
  ['product enum', `/* ${M} */`,
    "export const PosProductSchema = z.enum(['restaurant', 'market']);",
    `/* ${M} */ export const PosProductSchema = z.enum(['restaurant', 'market', 'geyim']);`],
]);

// ---------- api ----------
const API = 'apps/api/src';
plan(`${API}/lib/provision.ts`, [
  ['product type', `/* ${M}: type */`,
    "export type ActivationProduct = 'restaurant' | 'market';",
    `/* ${M}: type */ export type ActivationProduct = 'restaurant' | 'market' | 'geyim';`],
  ['market-family plan', `/* ${M}: plan */`,
    "  const plan =\n    product === 'market'\n      ? 'market'",
    `  const marketFamily = product === 'market' || product === 'geyim'; /* ${M}: plan */\n  const plan =\n    marketFamily\n      ? 'market'`],
  ['no subscription plan', `/* ${M}: planId */`,
    "  const planId = product === 'market' ? null : plan;",
    `  const planId = marketFamily ? null : plan; /* ${M}: planId */`],
  ['market licence, geyim vertical', `/* ${M}: features */`,
    "  if (product === 'market') {\n    features.product = 'market';\n    features.market = true;\n    features.kds = false;\n  }",
    `  if (marketFamily) {\n    features.product = 'market';\n    features.market = true;\n    features.kds = false;\n    // The till, the portal and /market-pos/* see a market licence; the key and\n    // the installer say Geyim POS. /* ${M}: features */\n    if (product === 'geyim') features.vertical = 'geyim';\n  }`],
]);

plan(`${API}/lib/setup-feed.ts`, [
  ['feed type', `/* ${M}: type */`,
    "export type SetupProduct = 'restaurant' | 'market';",
    `/* ${M}: type */ export type SetupProduct = 'restaurant' | 'market' | 'geyim';`],
  ['geyim feed', `/* ${M}: feed */`,
    "    productName: 'MarketPos',\n  },\n};",
    `    productName: 'MarketPos',\n  },\n  /* ${M}: feed */\n  geyim: {\n    publicBase: 'https://possistem.az/geyimpos/updates',\n    localFile: '/var/www/geyimpos/updates/latest.yml',\n    localHttp: 'http://127.0.0.1/geyimpos/updates',\n    productName: 'GeyimPos',\n  },\n};`],
]);

const PRODUCT_NAMES = "({ restaurant: 'Restoran POS', market: 'Market POS', geyim: 'Geyim POS' } as Record<string, string>)";
plan(`${API}/routes/devices.ts`, [
  ['key/till mismatch message', `/* ${M}: redeem */`,
    "          error:\n            requestedProduct === 'market'\n              ? 'Bu aktivləşdirmə açarı Restoran POS üçündür'\n              : 'Bu aktivləşdirmə açarı Market POS üçündür',",
    `          /* ${M}: redeem */\n          error: \`Bu aktivləşdirmə açarı \${${PRODUCT_NAMES}[keyRow.product ?? 'restaurant'] ?? 'başqa POS'} üçündür\`,`],
]);

plan(`${API}/routes/tenant.ts`, [
  ['not licensed message', `/* ${M}: login */`,
    "            error:\n              requestedProduct === 'market'\n                ? 'Bu hesab üçün Market POS lisenziyası yoxdur'\n                : 'Bu hesab üçün Restoran POS lisenziyası yoxdur',",
    `            /* ${M}: login */\n            error: \`Bu hesab üçün \${${PRODUCT_NAMES}[requestedProduct]} lisenziyası yoxdur\`,`],
]);

plan(`${API}/routes/downloads.ts`, [
  ['geyim installer', `/* ${M} */`,
    "    const result = await resolveSetupInfo(isPosProduct(product) ? product : 'restaurant');",
    `    const result = await resolveSetupInfo(isPosProduct(product) || product === 'geyim' ? product : 'restaurant'); /* ${M} */`],
]);

// The owner portal of a Geyim shop is the market portal and asks for the market
// installer; the shop's key says which one it actually runs.
plan(`${API}/routes/customer.ts`, [
  ['setup product helper', `/* ${M}: helper */`,
    'async function ensureOnboarding(app: FastifyInstance, customerId: string) {',
    `/* ${M}: helper */
async function setupProductFor(app: FastifyInstance, customerId: string, requested: string | undefined) {
  if (requested === 'geyim') return 'geyim' as const;
  if (requested !== 'market') return isPosProduct(requested) ? requested : ('restaurant' as const);
  const rows = (await app.db.execute(sql\`
    SELECT k.product FROM activation_keys k JOIN licenses l ON l.id = k.license_id
    WHERE l.customer_id = \${customerId}::uuid AND k.product IN ('market', 'geyim') AND k.revoked_at IS NULL
  \`)) as unknown as Array<{ product: string }>;
  return rows.length > 0 && rows.every((row) => row.product === 'geyim') ? ('geyim' as const) : ('market' as const);
}

async function ensureOnboarding(app: FastifyInstance, customerId: string) {`],
  ['downloads/latest', `/* ${M}: latest */`,
    "    const { product } = req.query as { product?: string };\n    const setup = await resolveSetupInfo(isPosProduct(product) ? product : 'restaurant');\n    if (!setup.ok) {\n      req.log.warn(",
    `    const { product } = req.query as { product?: string };\n    const setup = await resolveSetupInfo(await setupProductFor(app, identity.id, product)); /* ${M}: latest */\n    if (!setup.ok) {\n      req.log.warn(`],
  ['onboarding/download', `/* ${M}: onboarding */`,
    "    const { product } = req.query as { product?: string };\n    const setup = await resolveSetupInfo(isPosProduct(product) ? product : 'restaurant');\n    if (!setup.ok) {\n      return reply.code(503).send({\n        error: 'Yükləmə məlumatı hazırda əlçatan deyil.',",
    `    const { product } = req.query as { product?: string };\n    const setup = await resolveSetupInfo(await setupProductFor(app, identity.id, product)); /* ${M}: onboarding */\n    if (!setup.ok) {\n      return reply.code(503).send({\n        error: 'Yükləmə məlumatı hazırda əlçatan deyil.',`],
]);

plan(`${API}/routes/resellers.ts`, [
  ['sales filter type', `/* ${M}: type */`,
    "const query = req.query as { resellerId?: string; product?: 'restaurant' | 'market'; limit?: string };",
    `const query = req.query as { resellerId?: string; product?: 'restaurant' | 'market' | 'geyim'; limit?: string }; /* ${M}: type */`],
  ['sales filter', `/* ${M}: filter */`,
    "      query.product === 'market'\n        ? eq(activationKeys.product, 'market')",
    `      query.product === 'market' || query.product === 'geyim' /* ${M}: filter */\n        ? eq(activationKeys.product, query.product)`],
]);

// Partner sales ignored the product they chose and sold a restaurant key.
plan(`${API}/routes/reseller-portal.ts`, [
  ['partner sale product', `/* ${M} */`,
    "        plan: body.plan,\n        label: body.label ?? null,\n        resellerId: reseller.id,",
    `        plan: body.plan,\n        product: body.product, /* ${M} */\n        label: body.label ?? null,\n        resellerId: reseller.id,`],
]);

// ---------- admin web ----------
const ADMIN = 'apps/admin-web/src';
plan(`${ADMIN}/components/SaleForm.tsx`, [
  ['product type', `/* ${M}: type */`,
    'type PosProduct = "restaurant" | "market";',
    `/* ${M}: type */ type PosProduct = "restaurant" | "market" | "geyim";`],
  ['plan', `/* ${M}: plan */`,
    'plan: product === "market" ? "market" : "standard",',
    `plan: product === "restaurant" ? "standard" : "market", /* ${M}: plan */`],
  ['bonus config', `/* ${M}: config */`,
    '      if (product === "market") {\n        try {',
    `      if (product !== "restaurant") { /* ${M}: config */\n        try {`],
  ['label', `/* ${M}: label */`,
    '    value === "market" ? t.sale.productMarket : t.sale.productRestaurant;',
    `    value === "geyim" ? "Geyim POS" : value === "market" ? t.sale.productMarket : t.sale.productRestaurant; /* ${M}: label */`],
  ['radio', `{/* ${M}: radio */}`,
    '                <strong>{t.sale.productMarket}</strong>\n                <small>{t.sale.productMarketHint}</small>\n              </span>\n            </label>',
    `                <strong>{t.sale.productMarket}</strong>\n                <small>{t.sale.productMarketHint}</small>\n              </span>\n            </label>\n            {/* ${M}: radio */}\n            <label data-active={product === "geyim" ? "1" : "0"}>\n              <input\n                type="radio"\n                name="product"\n                value="geyim"\n                checked={product === "geyim"}\n                onChange={() => setProduct("geyim")}\n              />\n              <span>\n                <strong>Geyim POS</strong>\n                <small>Geyim, ayaqqabı və aksesuar mağazaları · ölçü/rəng, barkod, etiket</small>\n              </span>\n            </label>`],
  ['register count', `/* ${M}: registers */`,
    '            {product === "market" ? t.sale.registerCount : t.sale.maxDevices}',
    `            {product !== "restaurant" /* ${M}: registers */ ? t.sale.registerCount : t.sale.maxDevices}`],
  ['bonus field', `/* ${M}: bonus */`,
    '          {product === "market" && (\n            <label>\n              Bonus faizi (%)',
    `          {product !== "restaurant" /* ${M}: bonus */ && (\n            <label>\n              Bonus faizi (%)`],
]);

plan(`${ADMIN}/pages/SalesPage.tsx`, [
  ['product type', `/* ${M}: type */`,
    "  product: 'restaurant' | 'market' | null;",
    `  product: 'restaurant' | 'market' | 'geyim' | null; /* ${M}: type */`],
  ['label', `/* ${M}: label */`,
    "  return product === 'market' ? 'Market POS' : 'Restoran POS';",
    `  return product === 'geyim' ? 'Geyim POS' : product === 'market' ? 'Market POS' : 'Restoran POS'; /* ${M}: label */`],
  ['counts', `/* ${M}: counts */`,
    "        market: rows.filter((row) => row.product === 'market').length,\n        restaurant: rows.filter((row) => row.product !== 'market').length,",
    `        market: rows.filter((row) => row.product === 'market' || row.product === 'geyim').length, /* ${M}: counts */\n        restaurant: rows.filter((row) => row.product !== 'market' && row.product !== 'geyim').length,`],
  ['filter option', `{/* ${M}: option */}`,
    '              <option value="market">Market POS</option>',
    `              <option value="market">Market POS</option>\n              {/* ${M}: option */}<option value="geyim">Geyim POS</option>`],
]);

// ---------- partner web ----------
const RESELLER = 'apps/reseller-web/src';
plan(`${RESELLER}/api.ts`, [
  ['sale product and plan', `/* ${M} */`,
    'export async function createSale(input: {\n  name: string;',
    `export async function createSale(input: {\n  product?: 'restaurant' | 'market' | 'geyim'; /* ${M} */\n  plan?: 'market';\n  name: string;`],
]);
plan(`${RESELLER}/App.tsx`, [
  ['state', `/* ${M}: state */`,
    "  const [days, setDays] = useState('30');\n  const [maxDevices, setMaxDevices] = useState('1');\n  const [busy, setBusy] = useState(false);",
    `  const [product, setProduct] = useState<'restaurant' | 'market' | 'geyim'>('restaurant'); /* ${M}: state */\n  const [days, setDays] = useState('30');\n  const [maxDevices, setMaxDevices] = useState('1');\n  const [busy, setBusy] = useState(false);`],
  ['send', `/* ${M}: send */`,
    '      const data = await api.createSale({\n        name,',
    `      const data = await api.createSale({\n        product, /* ${M}: send */\n        plan: product === 'restaurant' ? undefined : 'market',\n        name,`],
  ['select', `{/* ${M}: select */}`,
    '          <p className="form-section">Lisenziya</p>',
    `          <p className="form-section">Lisenziya</p>\n          {/* ${M}: select */}\n          <label className="span-2">\n            Məhsul\n            <select value={product} onChange={(e) => setProduct(e.target.value as typeof product)} disabled={locked}>\n              <option value="restaurant">Restoran POS</option>\n              <option value="market">Market POS</option>\n              <option value="geyim">Geyim POS</option>\n            </select>\n          </label>`],
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
