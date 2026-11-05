#!/usr/bin/env node
// After the admin clears a customer's HWID, the first new PC takes the seat of the till seen longest ago.
// Patches a compiled routes/devices.js (the live API is a dist delta):  node apply-seat-handover.mjs <devices.js>
import fs from 'node:fs';
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
if (s.includes('/* SEAT_HANDOVER_1108 */')) process.exit(0);
function replace(old, next) {
  if (s.split(old).length !== 2) throw Error('devices.js anchor changed: ' + old.slice(0, 80));
  s = s.replace(old, () => next);
}
replace('export async function redeemWithKey(', `/* SEAT_HANDOVER_1108 */
// The admin cleared the customer's HWID to move the shop to another PC. Within 7 days the first new PC
// takes the seat of the till seen longest ago, which is revoked; after that new PCs need a free seat again.
export async function handOverSeat(tx, licenseId, customerId, seats) {
    const r = await tx.execute(sql \`
      WITH reset AS (SELECT max(created_at) AS at FROM audit_logs WHERE action = 'customer.clearHwid' AND entity_id = \${String(customerId)}),
      live AS (SELECT id, COALESCE(last_seen_at, created_at) AS seen FROM devices WHERE license_id = \${licenseId}::uuid AND status <> 'revoked')
      UPDATE devices SET status = 'revoked', device_public_key = NULL, updated_at = now()
      WHERE id = (SELECT id FROM live ORDER BY seen ASC LIMIT 1)
        AND (SELECT count(*) FROM live) >= \${seats}
        AND (SELECT at FROM reset) > now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM devices WHERE license_id = \${licenseId}::uuid AND created_at > (SELECT at FROM reset))
      RETURNING id\`);
    const row = (Array.isArray(r) ? r : r.rows)[0];
    if (row)
        await tx.execute(sql \`INSERT INTO audit_logs(action, entity_type, entity_id, meta) VALUES ('device.seatHandover', 'device', \${String(row.id)}, \${JSON.stringify({ customerId, licenseId })}::jsonb)\`);
    return Boolean(row);
}
export async function redeemWithKey(`);
replace(`        const [{ activeDevices }] = await tx
            .select({ activeDevices: sql \`count(*)::int\` })`, `        await handOverSeat(tx, keyRow.licenseId, license.customerId, keyRow.maxDevices);
        const [{ activeDevices }] = await tx
            .select({ activeDevices: sql \`count(*)::int\` })`);
fs.writeFileSync(file, s);
console.log('seat handover added');
