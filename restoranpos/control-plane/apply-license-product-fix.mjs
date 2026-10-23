#!/usr/bin/env node
/**
 * Stops two queries selecting a `licenses.product` column that does not exist.
 *
 * Product is derived, and has been since before the market plan: an explicit
 * `features -> product` wins, then the legacy `plan = 'market'`, and everything
 * else is a restaurant. `licensePosProductSql` is that rule, and two queries
 * added earlier today went around it and asked for a column instead.
 *
 * Both were 500s on live traffic: the admin panel's staff-roles editor on every
 * load, and the restaurant till's role pull on every heartbeat - which is to
 * say the feature those queries were written for did not work at all.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const OWNER = path.join(ROOT, 'apps/api/src/routes/owner.ts');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) { if (!cond) throw new Error(msg); }

let src = fs.readFileSync(OWNER, 'utf8');
if (src.includes("nullif(l.features ->> 'product'")) {
  console.log('= device pull already derives the product');
  process.exit(0);
}

const old = `    const licensed = (await app.db.execute(sql\`
      SELECT l.product FROM devices d JOIN licenses l ON l.id = d.license_id
      WHERE d.id = \${body.deviceId}::uuid
    \`)) as Array<Record<string, unknown>>;`;
must(src.split(old).length - 1 === 1, 'device product lookup not found');

fs.copyFileSync(OWNER, `${OWNER}.bak-${STAMP}`);
src = src.replace(
  old,
  `    const licensed = (await app.db.execute(sql\`
      SELECT
        CASE
          WHEN nullif(l.features ->> 'product', '') IS NOT NULL THEN l.features ->> 'product'
          WHEN l.plan = 'market' THEN 'market'
          ELSE 'restaurant'
        END AS product
      FROM devices d JOIN licenses l ON l.id = d.license_id
      WHERE d.id = \${body.deviceId}::uuid
    \`)) as Array<Record<string, unknown>>;`,
);

fs.writeFileSync(OWNER, src);
const final = fs.readFileSync(OWNER, 'utf8');
must(!/SELECT l\.product FROM devices/.test(final), 'the bad column survived');
must(final.includes("WHEN l.plan = 'market' THEN 'market'"), 'the classification did not land');
console.log(`+ device pull derives the product. backup: owner.ts.bak-${STAMP}`);
