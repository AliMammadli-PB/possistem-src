#!/usr/bin/env node
/**
 * The customer portal learns every product: registering at /pos/app/register
 * asks which program the business needs (restoran, market, geyim, aptek,
 * topdan) and stores it on the customer (customers.requested_product), and the
 * portal's Downloads page and onboarding hand out that program's installer,
 * with a picker for the others. Needs apply-topdan-product.mjs first.
 *
 * Runs on the VPS against /opt/possistem-pos-control. Backups next to each file
 * (.bak-<stamp>), marker-guarded edits (a second run changes nothing), and an
 * anchor that is not found exactly once stops the run before anything is written.
 *
 *   node apply-portal-products.mjs [root] [--check]
 *
 * NOT DEPLOYED (2026-09-29): the live owner-web dist cannot be reproduced from
 * any source on disk (its StaffRolesPage chunk matches neither the local
 * possistem-control-sync tree nor the VPS src), so rebuilding the portal could
 * silently change a live page. Settle the owner-web source first, then apply
 * this, run migration 0038 and rebuild owner-web.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ROOT = args.find((a) => !a.startsWith('--')) || '/opt/possistem-pos-control';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const M = 'portal-products';

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
  ['register product', `/* ${M} */`,
    "  termsAccepted: z.literal(true),\n  otpCode: otpCodeField,\n});",
    `  termsAccepted: z.literal(true),\n  otpCode: otpCodeField,\n  product: PosProductSchema.optional(), /* ${M} */\n});`],
]);

plan('packages/database/src/schema.ts', [
  ['requested product column', `/* ${M} */`,
    "  registrationSource: text('registration_source').notNull().default('staff'),\n",
    `  registrationSource: text('registration_source').notNull().default('staff'),\n  /** The program chosen when registering on the web (restaurant, market, geyim, aptek, topdan). */ /* ${M} */\n  requestedProduct: text('requested_product'),\n`],
]);

plan('apps/api/src/routes/customer-auth.ts', [
  ['store requested product', `/* ${M} */`,
    "              registrationSource: 'web',\n",
    `              registrationSource: 'web',\n              requestedProduct: body.product ?? null, /* ${M} */\n`],
]);

const OWNER = 'apps/owner-web/src';
plan(`${OWNER}/api.ts`, [
  ['register input', `/* ${M}: register */`,
    "  termsAccepted: boolean;\n  otpCode: string;\n}) {\n  return request<SessionPayload>('/customer-auth/register',",
    `  termsAccepted: boolean;\n  otpCode: string;\n  product?: PortalProduct; /* ${M}: register */\n}) {\n  return request<SessionPayload>('/customer-auth/register',`],
  ['products and latest setup', `/* ${M}: products */`,
    "export function latestSetup(product?: 'restaurant' | 'market') {",
    `/* ${M}: products */
export type PortalProduct = 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan';
export const PORTAL_PRODUCTS: Array<{ id: PortalProduct; name: string; hint: string; feed: string }> = [
  { id: 'restaurant', name: 'Restoran POS', hint: 'Restoran və kafe: masalar, mətbəx ekranı, ofisiantlar, server sinxronu.', feed: '/pos-updates/latest.yml' },
  { id: 'market', name: 'Market POS', hint: 'Market və mağaza: barkod, anbar, kassa, bonus kartı.', feed: '/marketpos/updates/latest.yml' },
  { id: 'geyim', name: 'Geyim POS', hint: 'Geyim və ayaqqabı mağazası: ölçü və rəng variantları, etiket, dəyişmə.', feed: '/geyimpos/updates/latest.yml' },
  { id: 'aptek', name: 'Aptek POS', hint: 'Aptek: seriya və son istifadə tarixi, resept, rəflər, qutu/ədəd satışı.', feed: '/aptekpos/updates/latest.yml' },
  { id: 'topdan', name: 'Topdan POS', hint: 'Topdan satış və anbar: qaimə, 3 qiymət səviyyəsi, nisyə, yeşik/ədəd.', feed: '/topdanpos/updates/latest.yml' },
];
const PORTAL_PRODUCT_KEY = 'possistem.portal.product';
/** The program this browser chose at registration or last picked on Downloads. */
export function storedPortalProduct(): PortalProduct | undefined {
  try {
    const value = localStorage.getItem(PORTAL_PRODUCT_KEY);
    return PORTAL_PRODUCTS.some((row) => row.id === value) ? (value as PortalProduct) : undefined;
  } catch {
    return undefined;
  }
}
export function rememberPortalProduct(product: PortalProduct) {
  try { localStorage.setItem(PORTAL_PRODUCT_KEY, product); } catch { /* private mode */ }
}
export function latestSetup(product?: PortalProduct) {`],
  ['record download for a product', `/* ${M}: record */`,
    "export function recordSetupDownload() {\n  return request<{ setup: SetupInfo; onboarding: OnboardingState }>(\n    '/customer/onboarding/download',",
    `export function recordSetupDownload(product?: PortalProduct) { /* ${M}: record */\n  return request<{ setup: SetupInfo; onboarding: OnboardingState }>(\n    \`/customer/onboarding/download\${product ? \`?product=\${product}\` : ''}\`,`],
]);

plan(`${OWNER}/pages/AuthPages.tsx`, [
  ['imports', `/* ${M}: imports */`,
    "import { Checkbox, Field, PasswordField } from '../ui/forms';",
    `import { Checkbox, Field, PasswordField, SelectField } from '../ui/forms'; /* ${M}: imports */`],
  ['state', `/* ${M}: state */`,
    "    termsAccepted: false,\n  });\n  const [otpCode, setOtpCode] = useState('');",
    `    termsAccepted: false,\n    product: api.storedPortalProduct() ?? 'restaurant', /* ${M}: state */\n  });\n  const [otpCode, setOtpCode] = useState('');`],
  ['send product', `/* ${M}: send */`,
    "        otpCode: otpCode.trim(),\n      });\n      navigate(result.redirectTo",
    `        otpCode: otpCode.trim(),\n        product: values.product as api.PortalProduct, /* ${M}: send */\n      });\n      api.rememberPortalProduct(values.product as api.PortalProduct);\n      navigate(result.redirectTo`],
  ['picker', `{/* ${M}: picker */}`,
    "onChange={(event) => set('businessName', event.target.value)} error={errors.businessName} required />\n          </div>",
    `onChange={(event) => set('businessName', event.target.value)} error={errors.businessName} required />\n          </div>\n          {/* ${M}: picker */}\n          <SelectField label="Hansı proqram lazımdır?" value={values.product} onChange={(event) => set('product', event.target.value)} hint={api.PORTAL_PRODUCTS.find((row) => row.id === values.product)?.hint}>\n            {api.PORTAL_PRODUCTS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}\n          </SelectField>`],
]);

plan(`${OWNER}/pages/DownloadsPage.tsx`, [
  ['imports', `/* ${M}: imports */`,
    "import { formatBytes, isMarketOnlySurface, latestSetup, recordSetupDownload, type SetupInfo } from '../api';",
    `import { formatBytes, isMarketOnlySurface, latestSetup, recordSetupDownload, rememberPortalProduct, storedPortalProduct, PORTAL_PRODUCTS, type PortalProduct, type SetupInfo } from '../api'; /* ${M}: imports */\nimport { SelectField } from '../ui/forms';`],
  ['state', `/* ${M}: state */`,
    "  const { show } = useToast();\n",
    `  const { show } = useToast();\n  const [product, setProduct] = useState<PortalProduct>(() => storedPortalProduct() ?? 'restaurant'); /* ${M}: state */\n  const info = PORTAL_PRODUCTS.find((row) => row.id === product) ?? PORTAL_PRODUCTS[0]!;\n`],
  ['load product', `/* ${M}: load */`,
    "      setSetup(await latestSetup(marketOnly ? 'market' : undefined));",
    `      setSetup(await latestSetup(marketOnly ? 'market' : product)); /* ${M}: load */`],
  ['reload on pick', `/* ${M}: deps */`,
    "  }, [marketOnly]);",
    `  }, [marketOnly, product]); /* ${M}: deps */`],
  ['record product', `/* ${M}: record */`,
    "      const result = await recordSetupDownload();",
    `      const result = await recordSetupDownload(marketOnly ? undefined : product); /* ${M}: record */`],
  ['picker', `{/* ${M}: picker */}`,
    "        description=\"possistem Windows tətbiqinin yoxlanılmış son stabil versiyası.\"\n      />",
    `        description="possistem Windows tətbiqinin yoxlanılmış son stabil versiyası."\n      />\n      {/* ${M}: picker */}\n      <Card>\n        <SelectField label="Proqram" value={product} hint={info.hint} onChange={(event) => { const next = event.target.value as PortalProduct; rememberPortalProduct(next); setProduct(next); }}>\n          {PORTAL_PRODUCTS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}\n        </SelectField>\n      </Card>`],
  ['title', `{/* ${M}: title */}`,
    "<h2>possistem <span className=\"mono\">v{setup.version}</span></h2>",
    `<h2>{info.name}{/* ${M}: title */} <span className="mono">v{setup.version}</span></h2>`],
  ['description', `{/* ${M}: hint */}`,
    "<p>Restoran kassası, masa idarəetməsi və server sinxronizasiyası üçün tam Windows qurulumu.</p>",
    `<p>{info.hint}{/* ${M}: hint */}</p>`],
  ['feed link', `/* ${M}: feed */`,
    "href=\"/pos-updates/latest.yml\" target=\"_blank\"",
    `href={info.feed /* ${M}: feed */} target="_blank"`],
]);

plan(`${OWNER}/pages/OnboardingPage.tsx`, [
  ['imports', `/* ${M}: imports */`,
    "  recordSetupDownload,\n",
    `  recordSetupDownload,\n  storedPortalProduct, /* ${M}: imports */\n`],
  ['record product', `/* ${M}: record */`,
    "      const response = await recordSetupDownload();",
    `      const response = await recordSetupDownload(storedPortalProduct()); /* ${M}: record */`],
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
