#!/usr/bin/env node
/**
 * Lets a till whose fingerprint legitimately changed bind itself again.
 *
 * The problem this fixes, seen live: a till reinstalled or restored from a
 * backup derives a new device fingerprint (it hangs off the installation id in
 * the local POS database). The server then rejects every `/owner/device/*`
 * call with `owner_device_fp_mismatch` - forever, because the mismatch branch
 * returns null without ever trying to re-bind. One customer's floor sync has
 * been 401ing for two days while their portal quietly served a stale snapshot
 * as if it were live: the till showed 304 AZN across five tables, the website
 * showed 149 across three.
 *
 * The existing rejection is right and stays: a deviceId alone is a UUID that
 * travels in every request and is shown in the admin UI as `hwid`, so accepting
 * a mismatch would let anyone holding it push fabricated floor totals and X/Z
 * reports into an owner's dashboard.
 *
 * What is added is one narrow recovery path: re-bind when the request carries a
 * VERIFIED signed tenant token whose customer is the device's own. That token is
 * only ever issued against the owner's email and password, so the bar is the
 * owner's own credentials - strictly higher than the deviceId, and higher than
 * the device fingerprint it replaces.
 *
 * Deliberately NOT used: `loginCustomerIdFromAuth`. That helper falls back to
 * `body.tenantEmail` and `body.customerId`, both of which the caller supplies
 * freely - gating a re-bind on it would hand the whole attack back.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || '/opt/possistem-pos-control';
const OWNER = path.join(ROOT, 'apps/api/src/routes/owner.ts');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let s = fs.readFileSync(OWNER, 'utf8');
const bak = `${OWNER}.bak-${STAMP}`;
if (!fs.existsSync(bak)) fs.copyFileSync(OWNER, bak);

// --- 1. the helper: the only trustworthy source of a caller's identity ------
if (!s.includes('function verifiedCustomerIdFromAuth')) {
  const anchor = 'async function loginCustomerIdFromAuth(';
  must(s.split(anchor).length - 1 === 1, 'loginCustomerIdFromAuth anchor not unique');
  s = s.replace(
    anchor,
    `/**
 * The caller's customer id, and only when they proved it.
 *
 * Unlike \`loginCustomerIdFromAuth\` this has no email or body fallback: a
 * signed tenant token or nothing. Use it for decisions that change stored
 * identity, never for merely reading.
 */
function verifiedCustomerIdFromAuth(req: { headers: { authorization?: string } }): string | null {
  const token = resolveTenantToken(bearer(req) ?? undefined);
  return token?.customerId ?? null;
}

${anchor}`,
  );
  console.log('  + verifiedCustomerIdFromAuth');
} else {
  console.log('  = verifiedCustomerIdFromAuth');
}

// --- 2. the parameter, optional so nothing else has to change --------------
if (!s.includes('verifiedCustomerId?: string | null')) {
  const anchor = `async function resolveDeviceCustomer(
  app: FastifyInstance,
  deviceId: string,
  fingerprint: string,
  loginCustomerId?: string | null,
): Promise<ResolvedOwnerDevice | null> {`;
  must(s.split(anchor).length - 1 === 1, 'resolveDeviceCustomer signature not found');
  s = s.replace(
    anchor,
    `async function resolveDeviceCustomer(
  app: FastifyInstance,
  deviceId: string,
  fingerprint: string,
  loginCustomerId?: string | null,
  /** Set only from a signed tenant token - see verifiedCustomerIdFromAuth. */
  verifiedCustomerId?: string | null,
): Promise<ResolvedOwnerDevice | null> {`,
  );
  console.log('  + resolveDeviceCustomer parameter');
} else {
  console.log('  = resolveDeviceCustomer parameter');
}

// --- 3. the recovery, inside the branch that used to be a dead end ---------
if (!s.includes('owner_device_fp_rebound')) {
  const anchor = `      'owner_device_fp_mismatch',
    );
    return null;`;
  must(s.split(anchor).length - 1 === 1, 'mismatch branch not found');
  s = s.replace(
    anchor,
    `      'owner_device_fp_mismatch',
    );
    // The owner, proving who they are, may re-bind their own device. This is
    // the documented way back for hardware that genuinely changed; without it
    // a reinstalled till is locked out permanently and its dashboard silently
    // freezes on the last figures that got through.
    if (verifiedCustomerId) {
      const [owned] = await app.db
        .select({ customerId: licenses.customerId })
        .from(licenses)
        .where(eq(licenses.id, device.licenseId))
        .limit(1);
      if (owned && owned.customerId === verifiedCustomerId) {
        const rebound = await bindDeviceToCustomer(
          app,
          deviceId,
          fingerprint,
          verifiedCustomerId,
          device,
        );
        if (rebound) {
          app.log.warn({ deviceId, customerId: verifiedCustomerId }, 'owner_device_fp_rebound');
          return rebound;
        }
      }
    }
    return null;`,
  );
  console.log('  + re-bind on a verified tenant token');
} else {
  console.log('  = re-bind on a verified tenant token');
}

// --- 4. pass it wherever the request is in scope ---------------------------
const callSite = `    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
    );`;
const callSiteNew = `    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
      verifiedCustomerIdFromAuth(req),
    );`;
const sites = s.split(callSite).length - 1;
if (sites > 0) {
  s = s.split(callSite).join(callSiteNew);
  console.log(`  + ${sites} call site(s)`);
} else {
  console.log('  = call sites');
}

// deviceCustomer() is the other door; it wraps resolveDeviceCustomer itself.
const wrapper = `    const resolved = await resolveDeviceCustomer(
      app,
      body.deviceId,
      body.deviceFingerprint,
      loginId,
    );
    if (!resolved) {
      reply.code(401).send({ error: 'Device not recognized' });`;
if (s.includes(wrapper)) {
  s = s.replace(
    wrapper,
    wrapper.replace('      loginId,\n', '      loginId,\n      verifiedCustomerIdFromAuth(req),\n'),
  );
  console.log('  + deviceCustomer wrapper');
}

fs.writeFileSync(OWNER, s);

const out = fs.readFileSync(OWNER, 'utf8');
must(out.includes('verifiedCustomerIdFromAuth'), 'helper missing');
must(out.includes('owner_device_fp_rebound'), 'recovery missing');
must(out.includes('verifiedCustomerId?: string | null'), 'parameter missing');
// The unsafe helper must not have crept into the re-bind decision.
const branch = out.slice(out.indexOf("'owner_device_fp_mismatch'"), out.indexOf('owner_device_fp_rebound'));
must(!branch.includes('loginCustomerId'), 're-bind gated on the spoofable id');
must(out.includes("'owner_device_fp_mismatch'"), 'the rejection itself was removed');

console.log(`\nwired. backup: ${path.basename(bak)}`);
