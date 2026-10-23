#!/usr/bin/env node
/**
 * One customer, several PCs - and the portal Anbar routes back in app.ts.
 *
 * Runs on the VPS against /opt/possistem-pos-control (a deployed directory,
 * not a git checkout): every touched file is backed up next to itself, every
 * edit is guarded so a second run changes nothing, and nothing existing is
 * removed. Rollback = restore the .bak files and rebuild.
 *
 *  1. Restores inventoryRoutes / accessRoutes. dist/app.js was rebuilt on
 *     2026-09-24 03:08 from a src/app.ts that never registered them, so the
 *     portal Anbar, /customer/access and the tills' /owner/device/inventory
 *     disappear on the next API restart. Their sources are shipped here.
 *  2. Per-device station (kassa / ofisiant / mətbəx / anbar / hamısı) and LAN
 *     host, set from the customer portal (/customer/devices).
 *  3. The restaurant sync answer carries `access` (website areas, which the
 *     till already reads) and `device` (station, host address, LAN key).
 *     The market heartbeat carries `access` and `device` too.
 *  4. Tenant login: one e-mail may sign in on as many PCs as the customer's
 *     active licences have seats, instead of exactly one.
 *  5. Role policy: an entitlement change bumps the version (the till skipped
 *     it before), and licence switches are read from the right product.
 *
 * Then: psql -f migrations/0031_device_stations.sql, build the API, restart.
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
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-${STAMP}`);
}
function ship(from, to) {
  const dst = path.join(API, to);
  const src = fs.readFileSync(path.join(HERE, from), 'utf8');
  if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === src) {
    console.log(`  = ${to}`);
    return;
  }
  backup(dst);
  fs.writeFileSync(dst, src);
  console.log(`  + ${to}`);
}
function patch(rel, edits) {
  const file = path.join(API, rel);
  let src = fs.readFileSync(file, 'utf8');
  const before = src;
  for (const [label, marker, anchor, replacement] of edits) {
    if (src.includes(marker)) {
      console.log(`  = ${rel}: ${label}`);
      continue;
    }
    const n = src.split(anchor).length - 1;
    must(n === 1, `${rel}: ${label}: expected 1 anchor, found ${n}`);
    src = src.replace(anchor, replacement);
    console.log(`  + ${rel}: ${label}`);
  }
  if (src !== before) {
    backup(file);
    fs.writeFileSync(file, src);
  }
}

// --- 1 & 2. route modules ----------------------------------------------------
console.log('sources');
ship('api/inventory.ts', 'routes/inventory.ts');
ship('api/inventory-access.ts', 'routes/inventory-access.ts');
ship('api/access.ts', 'routes/access.ts');
ship('api/access-areas.ts', 'lib/access-areas.ts');
ship('api/pos-roles.ts', 'routes/pos-roles.ts');
ship('api/device-stations.ts', 'routes/device-stations.ts');

console.log('app.ts');
patch('app.ts', [
  ['imports', "from './routes/device-stations.js'",
    "import { posRoleCustomerRoutes, posRoleAdminRoutes } from './routes/pos-roles.js';",
    "import { posRoleCustomerRoutes, posRoleAdminRoutes } from './routes/pos-roles.js';\n" +
    "import { inventoryRoutes } from './routes/inventory.js';\n" +
    "import { accessRoutes } from './routes/access.js';\n" +
    "import { deviceStationRoutes } from './routes/device-stations.js';"],
  ['registrations', 'api.register(deviceStationRoutes)',
    '      await api.register(posRoleCustomerRoutes);',
    '      await api.register(posRoleCustomerRoutes);\n' +
    '      await api.register(inventoryRoutes);\n' +
    '      await api.register(accessRoutes);\n' +
    '      await api.register(deviceStationRoutes);'],
]);

// --- 3. what the tills are told -----------------------------------------------
console.log('owner.ts');
patch('routes/owner.ts', [
  ['imports', "from './device-stations.js'",
    "import { effectiveRolePolicy } from './pos-roles.js';",
    "import { effectiveRolePolicy } from './pos-roles.js';\n" +
    "import { surfaceAccess } from './access.js';\n" +
    "import { deviceStation } from './device-stations.js';"],
  ['sync answer', 'device: await deviceStation(',
    '    return { ok: true, commands, mysql: mysqlEnabled() };',
    '    return {\n' +
    '      ok: true,\n' +
    '      commands,\n' +
    '      mysql: mysqlEnabled(),\n' +
    "      access: await surfaceAccess(app, customerId, 'restaurant').catch(() => null),\n" +
    '      // Read from the raw body: the host announces its LAN address, and the\n' +
    '      // sync schema would strip a field it does not know.\n' +
    '      device: await deviceStation(app, customerId, resolved.device.id,\n' +
    '        (req.body as { lanAddresses?: unknown }).lanAddresses).catch(() => null),\n' +
    '    };'],
  ['clear-hwid clears every PC', 'DELETE FROM customer_hwids',
    `      .set({ boundHwid: null, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });`,
    `      .set({ boundHwid: null, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    if (!row) return reply.code(404).send({ error: 'Not found' });
    await app.db.execute(sql\`DELETE FROM customer_hwids WHERE customer_id = \${id}::uuid\`);`],
]);

console.log('market.ts');
patch('routes/market.ts', [
  ['imports', "from './device-stations.js'",
    "export async function marketRoutes(",
    "import { surfaceAccess as marketSurfaceAccess } from './access.js';\n" +
    "import { deviceStation as marketDeviceStation } from './device-stations.js';\n\n" +
    "export async function marketRoutes("],
  ['heartbeat answer', 'marketDeviceStation(app',
    `          terminalNameUpdatedAt: terminalNameUpdatedAt.getTime(),
        },
        commands,
      };`,
    `          terminalNameUpdatedAt: terminalNameUpdatedAt.getTime(),
        },
        commands,
        access: await marketSurfaceAccess(app, license.customerId, 'market').catch(() => null),
        device: await marketDeviceStation(app, license.customerId, device.id, null).catch(() => null),
      };`],
]);

// --- 4. several PCs per e-mail ----------------------------------------------
console.log('tenant.ts');
patch('routes/tenant.ts', [
  ['seat-bounded HWIDs', 'customer_hwids',
    `          } else if (customer.boundHwid !== hwid) {
            return reply.code(403).send({
              error:
                'Bu email artıq başqa kompüterə bağlıdır. Admin HWID-i sıfırlamalıdır.',
              code: 'HWID_MISMATCH',
            });
          }`,
    `          } else if (customer.boundHwid !== hwid) {
            // A shop runs the till, the kitchen and the store room on separate
            // PCs under one account. The first PC stays in bound_hwid; the rest
            // are listed, up to the seats the customer's active licences have.
            const known = (await app.db.execute(sql\`
              SELECT hwid FROM customer_hwids WHERE customer_id = \${customer.id}::uuid
            \`)) as unknown as Array<{ hwid: string }>;
            if (!known.some((row) => row.hwid === hwid)) {
              const [seatRow] = (await app.db.execute(sql\`
                SELECT COALESCE(SUM(seats), 1)::int AS seats FROM licenses
                WHERE customer_id = \${customer.id}::uuid AND status = 'active'
              \`)) as unknown as Array<{ seats: number }>;
              const seats = Math.max(1, Number(seatRow?.seats ?? 1));
              if (1 + known.length >= seats) {
                return reply.code(403).send({
                  error: \`Bu hesabda boş kompüter yeri qalmayıb (\${seats}). Admin yer əlavə etməli və ya HWID-i sıfırlamalıdır.\`,
                  code: 'HWID_MISMATCH',
                });
              }
              await app.db.execute(sql\`
                INSERT INTO customer_hwids (customer_id, hwid) VALUES (\${customer.id}::uuid, \${hwid})
                ON CONFLICT DO NOTHING
              \`);
            }
          }`],
]);

// --- checks -----------------------------------------------------------------
const app = fs.readFileSync(path.join(API, 'app.ts'), 'utf8');
for (const name of ['inventoryRoutes', 'accessRoutes', 'deviceStationRoutes']) {
  must(app.includes(`api.register(${name})`), `${name} is not registered`);
}
must(fs.readFileSync(path.join(API, 'routes/owner.ts'), 'utf8').includes("surfaceAccess(app, customerId, 'restaurant')"),
  'restaurant sync does not carry access');

console.log(`
done. backups end in .bak-${STAMP}. Next, on the VPS:
  sudo -u postgres psql possistem_pos_control -f ${path.join(HERE, 'migrations/0031_device_stations.sql')}
  cd ${ROOT} && pnpm --filter @possistem/api build   # or: cd apps/api && npx tsc -p .
  systemctl restart possistem-pos-control && curl -s localhost:3210/pos/api/health`);
