#!/usr/bin/env node
/**
 * Lets the market till pull the staff role policy set on the website.
 *
 * The restaurant till has done this since 20 September; the market till never
 * did, so everything the admin panel and the customer portal could say about
 * market staff stopped at the database. The server half was already built
 * product-aware - `pos_role_policy`, `pos_entitlements` and the permission
 * catalogue all key on 'market' - and nothing was reading it back out.
 *
 * One route, because the market till authenticates differently from the
 * restaurant's: it signs `/market-pos/*` calls with its device key, and
 * `authenticateMarketDevice` already makes the three checks that matter. The
 * product is fixed to 'market' by the route rather than read from the body, so
 * a market device cannot ask for a restaurant policy and receive keys its core
 * has never heard of.
 *
 * Runs on the VPS against /opt/possistem-pos-control, which is a deployed
 * directory rather than a git checkout, so the file is backed up beside itself
 * and the edit is guarded to converge on a second run.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const FILE = path.join(ROOT, 'apps/api/src/routes/market.ts');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let src = fs.readFileSync(FILE, 'utf8');

if (src.includes("'/market-pos/roles'")) {
  console.log('= /market-pos/roles already present');
  process.exit(0);
}

const bak = `${FILE}.bak-${STAMP}`;
fs.copyFileSync(FILE, bak);

// --- import ---------------------------------------------------------------
const importAnchor = "import { resolveTenantToken } from './tenant.js';";
must(src.split(importAnchor).length - 1 === 1, 'tenant import anchor not unique');
src = src.replace(
  importAnchor,
  `${importAnchor}\nimport { effectiveRolePolicy } from './pos-roles.js';`,
);

// --- the route ------------------------------------------------------------
// Placed right after the support request, which is the other route built on
// MarketSupportAuthSchema + authenticateMarketDevice, so the two stay together.
const routeAnchor = `      return reply.code(created ? 201 : 200).send({
        ok: true,
        ticketId: ticket.id,
        messageId: message.id,
        created,
      });
    },
  );`;
must(src.split(routeAnchor).length - 1 === 1, 'support request route anchor not unique');

src = src.replace(
  routeAnchor,
  `${routeAnchor}

  /**
   * The staff role policy for this shop, as the website has it.
   *
   * Polled on the heartbeat. What comes back is already narrowed to what
   * POSSISTEM sold this customer, so a permission the shop was not sold cannot
   * be granted by editing roles in their own portal.
   *
   * 'market' is fixed here rather than taken from the body: the two tills check
   * different permission vocabularies, and a device must not be able to ask for
   * the other product's policy.
   */
  app.post(
    '/market-pos/roles',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parseBody(MarketSupportAuthSchema, req.body ?? {}, reply);
      if (!body) return;
      const auth = await authenticateMarketDevice(body, reply);
      if (!auth) return;
      return { ok: true, ...(await effectiveRolePolicy(app, auth.customerId, 'market')) };
    },
  );`,
);

fs.writeFileSync(FILE, src);

const final = fs.readFileSync(FILE, 'utf8');
must(final.includes("'/market-pos/roles'"), 'the route did not land');
must(final.includes("effectiveRolePolicy(app, auth.customerId, 'market')"), 'the policy is not clamped to market');
must(final.split("import { effectiveRolePolicy }").length - 1 === 1, 'the import was added twice');
// The route must sit after the helper it calls, or TypeScript sees a use before
// declaration inside the same registration function.
must(final.indexOf('authenticateMarketDevice = async') < final.indexOf("'/market-pos/roles'"),
     'the route is declared before authenticateMarketDevice');

console.log(`+ /market-pos/roles added. backup: ${path.basename(bak)}`);
