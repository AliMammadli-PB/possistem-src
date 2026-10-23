#!/usr/bin/env node
/**
 * Makes the admin panel the authority: entitlements above role policy.
 *
 * Runs on the VPS against /opt/possistem-pos-control, which is a deployed
 * directory and not a git checkout, so every file it touches is backed up
 * beside itself and every edit is guarded to converge on a second run.
 *
 * What changes:
 *  - a per-product permission catalogue, because the two cores do not share a
 *    vocabulary and one list for both is how a panel promises a right the till
 *    has never heard of;
 *  - `pos_entitlements`, what POSSISTEM sold this customer;
 *  - the device pull resolves its product from the licence behind the device
 *    and returns the policy already narrowed to the entitlement, so a right
 *    that was never sold cannot be granted by editing roles.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const API = path.join(ROOT, 'apps/api/src');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function backup(file) {
  const bak = `${file}.bak-${STAMP}`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}
function place(src, dst) {
  must(fs.existsSync(src), `missing ${src}`);
  backup(dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`  + ${path.relative(ROOT, dst)}`);
}

// --- files ----------------------------------------------------------------
place(path.join(HERE, 'api/pos-permissions.ts'), path.join(API, 'routes/pos-permissions.ts'));
place(path.join(HERE, 'api/pos-roles.ts'), path.join(API, 'routes/pos-roles.ts'));
place(
  path.join(HERE, 'migrations/0030_pos_entitlements.sql'),
  path.join(ROOT, 'migrations/0030_pos_entitlements.sql'),
);

// --- the device pull ------------------------------------------------------
const ownerPath = path.join(API, 'routes/owner.ts');
let owner = fs.readFileSync(ownerPath, 'utf8');
backup(ownerPath);

if (!owner.includes('effectiveRolePolicy')) {
  const importLine = "import { readRolePolicy } from './pos-roles.js';";
  must(owner.split(importLine).length - 1 === 1, 'owner.ts import anchor not unique');
  owner = owner.replace(importLine, "import { effectiveRolePolicy } from './pos-roles.js';");

  const old = `    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    return { ok: true, ...(await readRolePolicy(app, customerId)) };`;
  must(owner.split(old).length - 1 === 1, 'device roles route not found');
  owner = owner.replace(
    old,
    `    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    // The product comes from the licence behind this device, never from the
    // caller: the two tills check different permission vocabularies, and a
    // device must not be able to ask for the other one's policy.
    const licensed = (await app.db.execute(sql\`
      SELECT l.product FROM devices d JOIN licenses l ON l.id = d.license_id
      WHERE d.id = \${body.deviceId}::uuid
    \`)) as Array<Record<string, unknown>>;
    const product = licensed[0]?.product === 'market' ? 'market' : 'restaurant';
    return { ok: true, ...(await effectiveRolePolicy(app, customerId, product)) };`,
  );
  fs.writeFileSync(ownerPath, owner);
  console.log('  + device pull resolves product and applies entitlements');
} else {
  console.log('  = device pull');
}

const finalOwner = fs.readFileSync(ownerPath, 'utf8');
must(finalOwner.includes('effectiveRolePolicy(app, customerId, product)'), 'the pull is not clamped');
must(finalOwner.includes('JOIN licenses l ON l.id = d.license_id'), 'the product is not resolved');
must(!finalOwner.includes('readRolePolicy(app, customerId))'), 'the unclamped call survived');
// `sql` must already be imported in owner.ts for the lookup above.
must(/import \{[^}]*\bsql\b[^}]*\} from 'drizzle-orm'/.test(finalOwner), 'sql is not imported in owner.ts');

console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);
