#!/usr/bin/env node
/**
 * The till accepts a licence only when possistem signed it.
 *
 * Before this, nothing on the restaurant side checked a licence signature: the
 * offline import (license.importOffline) stored whatever JSON it was given and
 * even defaulted a missing status to "active", so a hand-written file unlocked
 * the till for any date. Now, in main:
 *
 *  - _psVerifyLicenseEnvelope() checks the Ed25519 signature over the payload
 *    (exactly what the control plane signs: JSON.stringify(payload)) against
 *    the keys this build trusts, and that the payload names this device's
 *    fingerprint. POS_TRUSTED_LICENSE_KEYS ("keyId:publicKeyHex,...") replaces
 *    the list for a staging control plane.
 *  - Activation (Bs), the heartbeat renewal (_psApplyLicenseRefresh) and the
 *    offline file import (dn) all refuse an envelope that fails it.
 *  - POS_E2E_BYPASS_LICENSE works only in an unpackaged (developer) build.
 *  - A packaged Windows build never writes the device key, the staff session or
 *    the tenant session in the clear when OS secure storage is unavailable
 *    (POS_REQUIRE_SECURE_STORAGE=1 enforces the same elsewhere).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const MARK = '/* POS_LICENSE_SIGNATURE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const HELPERS = `${MARK}const _PS_TRUSTED_LICENSE_KEYS=(()=>{const m=new Map([["ed25519-42cd45bfa4ca3125","1338db4cbec4934a387a1cc73c3589f3b0f58dac63be7fed0bf2a7e455e336c3"]]);const x=process.env.POS_TRUSTED_LICENSE_KEYS;if(x){m.clear();for(const part of x.split(",")){const[k,h]=part.split(":").map(v=>(v||"").trim());if(k&&/^[0-9a-f]{64}$/i.test(h))m.set(k,h)}}return m})();function _psVerifyLicenseEnvelope(e,f){try{if(!e||typeof e.payload!=="object"||e.payload===null||!/^[0-9a-f]{128}$/i.test(String(e.signature||"")))return!1;const keys=e.keyId?(_PS_TRUSTED_LICENSE_KEYS.has(e.keyId)?[_PS_TRUSTED_LICENSE_KEYS.get(e.keyId)]:[]):[..._PS_TRUSTED_LICENSE_KEYS.values()];const msg=Buffer.from(JSON.stringify(e.payload),"utf8"),sig=Buffer.from(e.signature,"hex");const ok=keys.some(h=>W.verify(null,msg,W.createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(h,"hex")]),format:"der",type:"spki"}),sig));if(!ok)return!1;const fp=e.payload.deviceFingerprint;return!(f&&typeof fp=="string"&&fp&&fp!==f)}catch{return!1}}function _psSecureRequired(){return c.app.isPackaged&&process.platform==="win32"||process.env.POS_REQUIRE_SECURE_STORAGE==="1"}function _psThrowNoSecureStorage(){throw new Error("Təhlükəsiz yaddaş (OS keyring) əlçatan deyil — cihaz açarı açıq mətnlə yazılmadı")}`;

let main = fs.readFileSync(MAIN, 'utf8');
if (!main.includes(MARK)) {
  must(main.includes('/* POS_LICENSE_REVOKE_v1 */'), 'run apply-restaurant-license-revoke.mjs first');
  main = replaceOnce(main,
    'if(!o.ok)return d((o.status===401,"E_LICENSE_REQUIRED"),o.error,o.status===0);const u=us(o.data,{installationId:r,fingerprint:a.fingerprint})',
    'if(!o.ok)return d((o.status===401,"E_LICENSE_REQUIRED"),o.error,o.status===0);if(!_psVerifyLicenseEnvelope(o.data?.signedLicense,a.fingerprint))return d("E_LICENSE_REQUIRED","Lisenziya imzası etibarsızdır");const u=us(o.data,{installationId:r,fingerprint:a.fingerprint})',
    'verify on activation');
  main = replaceOnce(main,
    'if(!e?.signedLicense?.payload||!e.license||!e.device)return;',
    'if(!e?.signedLicense?.payload||!e.license||!e.device)return;if(!_psVerifyLicenseEnvelope(e.signedLicense,f||t.deviceFingerprint)){D.warn("license_refresh_bad_signature");return}',
    'verify on renewal');
  main = replaceOnce(main,
    ',r=await ye(),a=he(r),i=Q(s.payload??s);',
    ',r=await ye(),a=he(r);if(!_psVerifyLicenseEnvelope(s.payload?{payload:s.payload,signature:s.signature,keyId:s.keyId}:null,a.fingerprint))return d("E_LICENSE_REQUIRED","Lisenziya faylının imzası etibarsızdır");const i=Q(s.payload??s);',
    'verify on offline import');
  main = replaceOnce(main,
    'process.env.POS_E2E_BYPASS_LICENSE==="1"&&(ue(',
    'process.env.POS_E2E_BYPASS_LICENSE==="1"&&!c.app.isPackaged&&(ue(',
    'e2e tenant bypass dev-only');
  main = replaceOnce(main,
    'if(process.env.POS_E2E_BYPASS_LICENSE==="1"){',
    'if(process.env.POS_E2E_BYPASS_LICENSE==="1"&&!c.app.isPackaged){',
    'e2e licence bypass dev-only');
  main = replaceOnce(main,
    'try{r=c.safeStorage.isEncryptionAvailable()?c.safeStorage.encryptString(n):Buffer.from(n,"utf8")}catch{r=Buffer.from(n,"utf8")}',
    'if(c.safeStorage.isEncryptionAvailable())r=c.safeStorage.encryptString(n);else if(_psSecureRequired())return;else r=Buffer.from(n,"utf8");',
    'staff session storage');
  main = replaceOnce(main,
    'c.safeStorage.isEncryptionAvailable()?p.writeFileSync(t,c.safeStorage.encryptString(n)):p.writeFileSync(t,Buffer.from(n,"utf8"))',
    'c.safeStorage.isEncryptionAvailable()?p.writeFileSync(t,c.safeStorage.encryptString(n)):_psSecureRequired()?re.warn("tenant_persist_skipped_no_secure_storage"):p.writeFileSync(t,Buffer.from(n,"utf8"))',
    'tenant session storage');
  main = replaceOnce(main,
    '(p.writeFileSync(e.privateEnc,s,{encoding:"utf8",mode:384}),be.warn("safe_storage_unavailable_wrote_plaintext_key"))',
    '(_psSecureRequired()&&_psThrowNoSecureStorage(),p.writeFileSync(e.privateEnc,s,{encoding:"utf8",mode:384}),be.warn("safe_storage_unavailable_wrote_plaintext_key"))',
    'device key storage');
  main = replaceOnce(main, 'async function _psRevokeLicense(', `${HELPERS}async function _psRevokeLicense(`, 'helpers');
  fs.writeFileSync(MAIN, main);
  console.log('license signature checks applied', MAIN);
} else {
  console.log('license signature checks already applied', MAIN);
}
