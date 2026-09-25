#!/usr/bin/env node
/**
 * A licence renewed on the website reaches the till.
 *
 * The till got its signed licence only once, at activation, and stopped asking
 * the server as soon as that licence ended - so a partner renewing a customer
 * changed nothing on the till. Now:
 *
 *  - main (pn): an expired till still sends its heartbeat; when the answer
 *    carries `licenseRefresh` (the server signs it only for an active licence)
 *    with a later end date, it is imported exactly like an activation (us() +
 *    license.importOffline). A later date only: the till never shortens itself.
 *  - LicensePage: on the lock screen it asks the server once on open, and a
 *    "Serverdən yoxla" button asks again; an active licence goes to /login.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LICENSE_REFRESH_v1 */';

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
  main = replaceOnce(main,
    'async function pn(){const e=await G();if(!e.success)return e;const t=e.data;if(!ln(t.status)||t.status==="legacy_grace")return N("license.heartbeat");',
    `async function pn(){${MARK}const e=await G();if(!e.success)return e;const t=e.data;if(!ln(t.status)&&t.status!=="expired"||t.status==="legacy_grace")return N("license.heartbeat");`,
    'heartbeat when expired');
  main = replaceOnce(main,
    'g.ok||D.warn("heartbeat_remote_failed",{error:g.error});',
    'g.ok||D.warn("heartbeat_remote_failed",{error:g.error});if(g.ok)try{await _psApplyLicenseRefresh(t,g.data?.licenseRefresh,l)}catch(h){D.warn("license_refresh_failed",{message:h instanceof Error?h.message:String(h)})}',
    'apply refresh');
  main = replaceOnce(main,
    'async function _psSyncRolePolicy(){',
    'async function _psApplyLicenseRefresh(t,e,f){if(!e?.signedLicense?.payload||!e.license||!e.device)return;const u=us(e,{installationId:await ye(t),fingerprint:f||t.deviceFingerprint||""}),p=typeof t.expiresAt=="number"?t.expiresAt:0;if(!(u.payload.expiresAt>p))return;const r=await N("license.importOffline",{licenseFileContents:JSON.stringify({payload:u.payload,signature:u.signature,keyId:u.keyId,signedAt:e.signedLicense?.signedAt})});r.success?D.info("license_refreshed",{expiresAt:u.payload.expiresAt}):D.warn("license_refresh_rejected",{error:r.error})}async function _psSyncRolePolicy(){',
    'refresh helper');
  fs.writeFileSync(MAIN, main);
  console.log('license refresh applied', MAIN);
} else {
  console.log('license refresh already applied', MAIN);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  s = replaceOnce(s,
    `  const refresh = reactExports.useCallback(async () => {
    const res = await window.pos.license.status();
    if (!res.success) {
      toast(res.error.message, "danger");
      setLoading(false);
      return;
    }
    setStatus(res.data);
    setLoading(false);
  }, []);
  reactExports.useEffect(() => {
    void refresh();
  }, [refresh]);`,
    `  ${MARK}
  const [checking, setChecking] = reactExports.useState(false);
  const refresh = reactExports.useCallback(async (online = false) => {
    if (online) {
      try {
        await window.pos.license.heartbeat();
      } catch {
      }
    }
    const res = await window.pos.license.status();
    if (!res.success) {
      toast(res.error.message, "danger");
      setLoading(false);
      return null;
    }
    setStatus(res.data);
    setLoading(false);
    if (online && gateMode && isLicensed(res.data.status) && !isExpired(res.data)) {
      navigate("/login", { replace: true });
    }
    return res.data;
  }, [gateMode, navigate]);
  reactExports.useEffect(() => {
    void refresh(gateMode);
  }, [refresh, gateMode]);
  const recheck = async () => {
    setChecking(true);
    const next = await refresh(true);
    setChecking(false);
    if (next && isLicensed(next.status) && !isExpired(next)) toast("Lisenziya aktivdir", "success");
    else if (next) toast("Lisenziya hələ uzadılmayıb — partnyorunuza və ya POSSISTEM-ə müraciət edin", "danger");
  };`,
    'license page refresh');
  s = replaceOnce(s,
    `            onClick: () => void pay(),
            className: "touch-target mt-4 w-full rounded-xl border border-gold/40 bg-gold/15 px-4 py-3 text-sm text-gold hover:bg-gold/25",
            children: t.license.payNow
          }
        )
      ] }),`,
    `            onClick: () => void pay(),
            className: "touch-target mt-4 w-full rounded-xl border border-gold/40 bg-gold/15 px-4 py-3 text-sm text-gold hover:bg-gold/25",
            children: t.license.payNow
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: checking, onClick: () => void recheck(), className: "touch-target mt-3 w-full rounded-xl border border-hairline px-4 py-3 text-sm text-cream hover:bg-white/5 disabled:opacity-60", children: checking ? "Yoxlanılır…" : "Serverdən yoxla" })
      ] }),`,
    'recheck button');
  fs.writeFileSync(BUNDLE, s);
  console.log('license page refresh applied', BUNDLE);
} else {
  console.log('license page refresh already applied', BUNDLE);
}
