#!/usr/bin/env node
/**
 * Wires the role-policy endpoints into the control plane.
 *
 * Runs on the VPS, against /opt/possistem-pos-control, which is a deployed
 * directory and not a git checkout - so every file this touches is backed up
 * next to itself first, and every edit is guarded so a second run changes
 * nothing. That is the whole rollback story: restore the .bak files and
 * rebuild.
 *
 * It only ever inserts. Nothing existing is rewritten or removed.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const API = path.join(ROOT, 'apps/api/src');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function backup(file) {
  const bak = `${file}.bak-${STAMP}`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}
function insertOnce(src, anchor, addition, label, marker) {
  // The marker is passed explicitly: deriving it from the first line of the
  // addition silently matched "/**" for any block that opens with a comment,
  // so the insert was skipped and the verification below caught it.
  must(marker, `${label}: no marker given`);
  if (src.includes(marker)) {
    console.log(`  = ${label} already present`);
    return src;
  }
  const n = src.split(anchor).length - 1;
  must(n === 1, `${label}: expected 1 anchor, found ${n}`);
  console.log(`  + ${label}`);
  return src.replace(anchor, addition + anchor);
}

// --- 1. the route module ---------------------------------------------------
const routeSrc = path.join(path.dirname(new URL(import.meta.url).pathname), 'api/pos-roles.ts');
const routeDst = path.join(API, 'routes/pos-roles.ts');
must(fs.existsSync(routeSrc), `missing ${routeSrc}`);
if (fs.existsSync(routeDst)) backup(routeDst);
fs.copyFileSync(routeSrc, routeDst);
console.log(`  + routes/pos-roles.ts`);

// --- 2. the device pull route, where device auth is in scope ---------------
const ownerPath = path.join(API, 'routes/owner.ts');
let owner = fs.readFileSync(ownerPath, 'utf8');
backup(ownerPath);

owner = insertOnce(
  owner,
  "export async function ownerRoutes(app: FastifyInstance) {",
  "import { readRolePolicy } from './pos-roles.js';\n\n",
  'owner.ts import',
  "from './pos-roles.js'",
);

owner = insertOnce(
  owner,
  "  app.post('/owner/device/whatsapp', {",
  `  /**
   * The till pulls the role policy its owner set on possistem.az.
   *
   * POST like every other device endpoint here, because device auth is a
   * signed body rather than a header. Cheap enough to ride the heartbeat: the
   * till compares \`version\` with the one it last applied and does nothing
   * when they match.
   */
  app.post('/owner/device/roles', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = parseBody(OwnerDeviceAuthSchema, req.body, reply);
    if (!body) return;
    const customerId = await deviceCustomer(req, body, reply);
    if (!customerId) return;
    return { ok: true, ...(await readRolePolicy(app, customerId)) };
  });

`,
  'owner.ts /owner/device/roles',
  "'/owner/device/roles'",
);

fs.writeFileSync(ownerPath, owner);

// --- 3. registration -------------------------------------------------------
const appPath = path.join(API, 'app.ts');
let appSrc = fs.readFileSync(appPath, 'utf8');
backup(appPath);

appSrc = insertOnce(
  appSrc,
  "export async function buildApp() {",
  "import { posRoleCustomerRoutes, posRoleAdminRoutes } from './routes/pos-roles.js';\n\n",
  'app.ts import',
  'posRoleCustomerRoutes, posRoleAdminRoutes',
);

appSrc = insertOnce(
  appSrc,
  "      // Bayi paneli",
  "      await api.register(posRoleAdminRoutes);\n\n",
  'app.ts admin routes',
  'api.register(posRoleAdminRoutes)',
);

appSrc = insertOnce(
  appSrc,
  "      await api.register(customerUploadRoutes);",
  "      await api.register(posRoleCustomerRoutes);\n",
  'app.ts customer routes',
  'api.register(posRoleCustomerRoutes)',
);

fs.writeFileSync(appPath, appSrc);

// Prove the wiring, not just that the files were written.
const finalOwner = fs.readFileSync(ownerPath, 'utf8');
const finalApp = fs.readFileSync(appPath, 'utf8');
must(finalOwner.includes("'/owner/device/roles'"), 'device pull route missing');
must(finalOwner.includes("readRolePolicy"), 'owner.ts import missing');
must(finalApp.includes('posRoleAdminRoutes'), 'admin routes not registered');
must(finalApp.includes('posRoleCustomerRoutes'), 'customer routes not registered');
// Compare REGISTER calls, not imports: every one of these names also appears
// in the import block at the top, where the order means nothing.
const reg = (name) => finalApp.indexOf(`api.register(${name})`);
must(reg('posRoleAdminRoutes') > reg('adminProductRoutes'),
     'admin routes registered outside the super-admin block');
must(reg('posRoleAdminRoutes') < reg('resellerPortalRoutes'),
     'admin routes leaked past the super-admin block');
must(reg('posRoleCustomerRoutes') > reg('customerAuthRoutes'),
     'customer routes registered before customer auth');

console.log(`\nwired. backups carry the suffix .bak-${STAMP}`);
