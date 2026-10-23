#!/usr/bin/env node
/**
 * Makes the admin panel answer per product instead of averaging the two.
 *
 * The panel already knew about Market and Restaurant - a switch in the topbar,
 * persisted per operator - but only two screens out of nine read it. The
 * landing page counted every customer and every licence POSSISTEM has ever had
 * and called the result "Ümumi satış", so an operator who came in to look at
 * Market saw restaurant figures with nothing saying so.
 *
 * `/dashboard/stats` is the half that lives on the server. It gains `?product=`
 * and, with it, figures that are actually about one product: how many shops run
 * it, how many tills are plugged in, how many of those were seen in the last
 * quarter of an hour, and which installer version the update feed is currently
 * handing out. That last one is the panel's only honest answer to "is the site
 * in step with the app", and it was not being asked.
 *
 * Runs on the VPS against /opt/possistem-pos-control, a deployed directory
 * rather than a git checkout: the file is backed up beside itself and the edit
 * converges on a second run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const FILE = path.join(ROOT, 'apps/api/src/routes/misc.ts');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('productScopedStats')) {
  console.log('= dashboard stats already product-scoped');
  process.exit(0);
}

const bak = `${FILE}.bak-${STAMP}`;
fs.copyFileSync(FILE, bak);

// --- imports --------------------------------------------------------------
const importAnchor =
  "import { contactLeads, customers, featureFlags, licenses, resellers } from '@possistem/database';";
must(src.split(importAnchor).length - 1 === 1, 'database import anchor not unique');
src = src.replace(
  importAnchor,
  `import {
  contactLeads,
  customers,
  devices,
  featureFlags,
  licenses,
  resellers,
  supportTickets,
} from '@possistem/database';`,
);

const envAnchor = "import { env } from '../env.js';";
must(src.split(envAnchor).length - 1 === 1, 'env import anchor not unique');
src = src.replace(
  envAnchor,
  `${envAnchor}
import { isPosProduct, licensePosProductSql, type PosProduct } from '../lib/pos-product.js';
import { resolveSetupInfo } from '../lib/setup-feed.js';`,
);

// --- the figures ----------------------------------------------------------
const routeAnchor = `export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/stats', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
`;
must(src.split(routeAnchor).length - 1 === 1, 'dashboard route anchor not unique');

src = src.replace(
  routeAnchor,
  `/**
 * What is true of one product right now.
 *
 * Every count here is bounded by the same product filter, so the numbers on the
 * screen add up to something an operator can act on. A customer who was created
 * but never sold a licence classifies as neither product and is deliberately in
 * none of these - counting them under whichever product happened to be selected
 * is how a panel ends up lying quietly.
 */
async function productScopedStats(app: FastifyInstance, product: PosProduct) {
  const ofProduct = sql\`\${licensePosProductSql} = \${product}\`;

  const [shops] = await app.db
    .select({ count: sql<number>\`count(distinct \${customers.id})::int\` })
    .from(customers)
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .where(ofProduct);

  const [active] = await app.db
    .select({ count: sql<number>\`count(*)::int\` })
    .from(licenses)
    .where(sql\`\${licenses.status} = 'active' and \${ofProduct}\`);

  const [thisMonth] = await app.db
    .select({ count: sql<number>\`count(distinct \${customers.id})::int\` })
    .from(customers)
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .where(sql\`\${customers.createdAt} >= date_trunc('month', now()) and \${ofProduct}\`);

  // A till that has spoken in the last quarter of an hour is plugged in and
  // working. The rest are installed but silent, which is the number worth
  // chasing: it is either a shop that closed or one whose sync is broken.
  const [tills] = await app.db
    .select({
      total: sql<number>\`count(*)::int\`,
      online: sql<number>\`count(*) filter (where \${devices.lastSeenAt} >= now() - interval '15 minutes')::int\`,
    })
    .from(devices)
    .innerJoin(licenses, eq(licenses.id, devices.licenseId))
    .where(sql\`\${devices.status} <> 'revoked' and \${ofProduct}\`);

  // Attributed through the licence, not through the message that opened the
  // ticket: meta.source lives on support_messages, and a ticket is long-lived
  // - a shop that ever wrote to us keeps the same one. Which product the shop
  // runs is the stable answer. A shop running both is counted under both, which
  // is correct: either operator may be the one who has to answer it.
  const [openTickets] = await app.db
    .select({ count: sql<number>\`count(distinct \${supportTickets.id})::int\` })
    .from(supportTickets)
    .innerJoin(customers, eq(customers.id, supportTickets.customerId))
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .where(sql\`\${supportTickets.status} = 'open' and \${ofProduct}\`);

  const recent = await app.db
    .select({
      customerId: customers.id,
      name: customers.name,
      email: customers.email,
      createdAt: customers.createdAt,
      resellerName: resellers.name,
      status: licenses.status,
    })
    .from(customers)
    .innerJoin(licenses, eq(licenses.customerId, customers.id))
    .leftJoin(resellers, eq(customers.resellerId, resellers.id))
    .where(ofProduct)
    .orderBy(desc(customers.createdAt))
    .limit(10);

  // What the update feed is actually serving. The panel hands out this
  // installer and the tills update from it, so a stale or missing feed is a
  // thing an operator should see here rather than discover from a customer.
  let release: { version: string; fileName: string } | null = null;
  try {
    const info = await resolveSetupInfo(product);
    if (info.ok) release = { version: info.info.version, fileName: info.info.fileName };
  } catch {
    release = null;
  }

  return {
    product,
    shops: shops?.count ?? 0,
    activeLicenses: active?.count ?? 0,
    thisMonth: thisMonth?.count ?? 0,
    tills: tills?.total ?? 0,
    tillsOnline: tills?.online ?? 0,
    openTickets: openTickets?.count ?? 0,
    release,
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

${routeAnchor}    // Product is optional so an older panel build keeps working: without it
    // the answer is the whole business, as it always was.
    const requested = (req.query as { product?: string }).product;
    if (requested !== undefined && requested !== '' && !isPosProduct(requested)) {
      return reply.code(400).send({ error: 'product must be "market" or "restaurant"' });
    }
`,
);

// --- return the scoped block alongside the existing figures ---------------
const returnAnchor = `    return {
      panels: panels?.count ?? 0,`;
must(src.split(returnAnchor).length - 1 === 1, 'stats return anchor not unique');
src = src.replace(
  returnAnchor,
  `    const scoped = isPosProduct(requested) ? await productScopedStats(app, requested) : null;

    return {
      scoped,
      panels: panels?.count ?? 0,`,
);

fs.writeFileSync(FILE, src);

const final = fs.readFileSync(FILE, 'utf8');
must(final.includes('async function productScopedStats'), 'the scoped figures did not land');
must(final.includes('scoped,'), 'the route does not return them');
must(final.includes("interval '15 minutes'"), 'the online window is missing');
// The helper has to be declared before the route registers, or TypeScript sees
// a use before declaration inside the same module.
must(final.indexOf('async function productScopedStats') < final.indexOf("app.get('/dashboard/stats'"),
     'the helper is declared after its use');

console.log(`+ /dashboard/stats?product= added. backup: ${path.basename(bak)}`);
