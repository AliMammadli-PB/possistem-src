#!/usr/bin/env node
/**
 * A licence deleted or revoked on the website locks the till.
 *
 * Deleting a customer cascades to its licences and devices, and the heartbeat
 * then answered 404, which the till logged and ignored: it kept running on its
 * cached signed licence, still signed in to the deleted account, with full
 * rights until the licence's own end date. Now:
 *
 *  - main Re(): control API errors carry the server's `code`.
 *  - main pn(): a heartbeat answered with `LICENSE_REVOKED` stores the local
 *    licence as `revoked` (the core then refuses licensed features and a new
 *    business day), signs the till out of the website account, stops owner
 *    sync and reloads the windows so the licence gate takes over. Only that
 *    explicit code counts - a 404, 401 or a network error never locks a till.
 *    A new activation key restores it as usual.
 *  - LicensePage shows "Lisenziya ləğv edilib" instead of the raw status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LICENSE_REVOKE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let main = fs.readFileSync(MAIN, 'utf8');
if (!main.includes(MARK)) {
  must(main.includes('/* POS_LICENSE_REFRESH_v1 */'), 'run apply-restaurant-license-refresh.mjs first');
  main = replaceOnce(main,
    'return K.warn("control_http_error",{path:t,status:o.status}),{ok:!1,status:o.status,error:h}}',
    'return K.warn("control_http_error",{path:t,status:o.status}),{ok:!1,status:o.status,error:h,code:g&&typeof g.code=="string"?g.code:void 0}}',
    'error code from control API');
  main = replaceOnce(main,
    'g.ok||D.warn("heartbeat_remote_failed",{error:g.error});',
    'g.ok||D.warn("heartbeat_remote_failed",{error:g.error});if(!g.ok&&g.code==="LICENSE_REVOKED"){await _psRevokeLicense(t,g.error);return N("license.heartbeat")}',
    'revoke on heartbeat');
  main = replaceOnce(main,
    'async function _psSyncRolePolicy(){',
    `async function _psRevokeLicense(t,m){${MARK}if(t.status==="revoked"||t.licenseId==="legacy-local"||t.licenseId==="e2e-local")return;const p={status:"revoked",licenseId:t.licenseId||"",customerId:t.customerId||"",branchId:t.branchId||"",deviceId:t.deviceId||"",installationId:t.installationId||"",channel:t.channel||"stable",startsAt:typeof t.startsAt=="number"?t.startsAt:0,expiresAt:typeof t.expiresAt=="number"?t.expiresAt:0,offlineGraceDays:0,features:{},revokedAt:Date.now(),revokedReason:String(m||"LICENSE_REVOKED")};const r=await N("license.activate",{payload:p,signature:"server-revoked",keyId:"revocation"});if(!r.success){D.warn("license_revoke_store_failed",{error:r.error});return}D.warn("license_revoked_by_server",{licenseId:t.licenseId,deviceId:t.deviceId});try{bs()}catch(h){D.warn("license_revoke_logout_failed",{message:h instanceof Error?h.message:String(h)})}try{Le()}catch{}for(const w of c.BrowserWindow.getAllWindows())w.isDestroyed()||w.webContents.reload()}async function _psSyncRolePolicy(){`,
    'revoke helper');
  fs.writeFileSync(MAIN, main);
  console.log('license revoke applied', MAIN);
} else {
  console.log('license revoke already applied', MAIN);
}

let bundle = fs.readFileSync(BUNDLE, 'utf8');
if (!bundle.includes(MARK)) {
  bundle = replaceOnce(bundle,
    'status?.status ? String(status.status) : t.settings.statusUnknown',
    `status?.status === "revoked" ? /* POS_LICENSE_REVOKE_v1 */ "Lisenziya ləğv edilib" : status?.status ? String(status.status) : t.settings.statusUnknown`,
    'revoked label');
  fs.writeFileSync(BUNDLE, bundle);
  console.log('license revoke label applied', BUNDLE);
} else {
  console.log('license revoke label already applied', BUNDLE);
}
