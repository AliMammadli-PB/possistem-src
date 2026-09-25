#!/usr/bin/env node
/**
 * Live ModuleGates: when portal grants Anbar/etc., show it without gir/çıx.
 *
 * 1) Main: after roles.applyPolicy, push returned session via Yt (same as login).
 * 2) Main: on owner sync access list, also pull role policy immediately + event.
 * 3) Renderer: AdminHub/Operations subscribe to session so tabs re-render.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LIVE_ACCESS_v2 */';
const MARK_OLD = '/* POS_LIVE_ACCESS_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function patchMain() {
  let main = fs.readFileSync(MAIN, 'utf8');
  if (main.includes(MARK)) {
    console.log('main already applied');
    return;
  }
  // Upgrade from v1 (had access event + login Yt, missing N()-path Yt).
  if (main.includes(MARK_OLD) && !main.includes('ss(r.data)||ss(r);k&&Yt(k)')) {
    const policyDone =
      'if(!r.success){D.warn("role_policy_apply_failed",{version:v,error:r.error});return}r.data?.skipped||D.info("role_policy_applied",{version:v,applied:r.data?.applied,created:r.data?.created})}';
    const policyDoneNew =
      'if(!r.success){D.warn("role_policy_apply_failed",{version:v,error:r.error});return}{const k=ss(r.data)||ss(r);k&&Yt(k)}r.data?.skipped||D.info("role_policy_applied",{version:v,applied:r.data?.applied,created:r.data?.created})}';
    must(main.includes(policyDone), 'v1→v2 policy Yt needle missing');
    main = main.replace(policyDone, policyDoneNew);
    main = main.replace(MARK_OLD, MARK);
    fs.writeFileSync(MAIN, main);
    console.log('upgraded main live access v1→v2', MAIN);
    return;
  }
  if (main.includes(MARK_OLD)) {
    main = main.replace(MARK_OLD, MARK);
    fs.writeFileSync(MAIN, main);
    console.log('main mark bumped to v2');
    return;
  }

  // Push session whenever applyPolicy returns one (skip or full) — renderer path.
  const loginYt =
    'if(s==="auth.login"&&C.success){const k=ss(C.data)||ss(C);k&&Yt(k)}else s==="auth.logout"&&Ne();';
  const loginYtNew =
    'if((s==="auth.login"||s==="roles.applyPolicy")&&C.success){const k=ss(C.data)||ss(C);k&&Yt(k)}else s==="auth.logout"&&Ne();';
  must(main.includes(loginYt), 'auth.login Yt needle missing');
  main = main.replace(loginYt, loginYtNew);

  // Main's N() bypasses the renderer invoke hook — push session here too.
  const policyDone =
    'if(!r.success){D.warn("role_policy_apply_failed",{version:v,error:r.error});return}r.data?.skipped||D.info("role_policy_applied",{version:v,applied:r.data?.applied,created:r.data?.created})}';
  const policyDoneNew =
    'if(!r.success){D.warn("role_policy_apply_failed",{version:v,error:r.error});return}{const k=ss(r.data)||ss(r);k&&Yt(k)}r.data?.skipped||D.info("role_policy_applied",{version:v,applied:r.data?.applied,created:r.data?.created})}';
  must(main.includes(policyDone), 'policy apply done needle missing');
  main = main.replace(policyDone, policyDoneNew);

  // After access list lands from live sync, re-pull role policy so inventory
  // strip/restore runs within seconds, not on the ~2min heartbeat only.
  const accessSet =
    'try{const access=i.data&&Object.prototype.hasOwnProperty.call(i.data,"access")?i.data.access:null;const js="window.__psAccess="+JSON.stringify(Array.isArray(access)?access:null);for(const win of c.BrowserWindow.getAllWindows()){if(!win.isDestroyed())void win.webContents.executeJavaScript(js).catch(()=>{})}}catch{}';
  const accessSetNew =
    'try{const access=i.data&&Object.prototype.hasOwnProperty.call(i.data,"access")?i.data.access:null;'
    + 'const js="window.__psAccess="+JSON.stringify(Array.isArray(access)?access:null)+";window.dispatchEvent(new CustomEvent(\'ps:access\',{detail:window.__psAccess}));";'
    + 'for(const win of c.BrowserWindow.getAllWindows()){if(!win.isDestroyed())void win.webContents.executeJavaScript(js).catch(()=>{})}'
    + 'try{await _psSyncRolePolicy()}catch(policyErr){v.warn("role_policy_sync_after_access",{message:policyErr instanceof Error?policyErr.message:String(policyErr)})}'
    + '}catch{}';
  must(main.includes(accessSet), 'access inject needle missing');
  main = main.replace(accessSet, accessSetNew);

  main = MARK + '\n' + main;
  fs.writeFileSync(MAIN, main);
  must(main.includes('roles.applyPolicy")&&C.success'), 'applyPolicy Yt missing');
  must(main.includes('ss(r.data)||ss(r);k&&Yt(k)'), 'policy N() Yt missing');
  must(main.includes("ps:access"), 'access event missing');
  must(main.includes('_psSyncRolePolicy()}catch(policyErr)'), 'sync-after-access missing');
  console.log('patched main live access', MAIN);
}

const ACCESS_TICK =
  '  useAuthStore((s) => s.session);\n'
  + '  const[, _psAccessTick]=reactExports.useState(0);reactExports.useEffect(()=>{const fn=()=>_psAccessTick(n=>n+1);window.addEventListener("ps:access",fn);return()=>window.removeEventListener("ps:access",fn);},[]);\n';

/** A second apply used to paste the tick twice → SyntaxError white screen. */
function dedupeAccessTicks(src) {
  const doubled = ACCESS_TICK + ACCESS_TICK;
  let n = 0;
  while (src.includes(doubled)) {
    src = src.replace(doubled, ACCESS_TICK);
    n += 1;
  }
  if (n) console.log('deduped _psAccessTick x' + n);
  return src;
}

function patchBundle() {
  let s = dedupeAccessTicks(fs.readFileSync(BUNDLE, 'utf8'));
  const already = s.includes(MARK) || s.includes('const[, _psAccessTick]=');
  if (already) {
    if (!s.startsWith(MARK) && !s.includes(MARK)) s = MARK + '\n' + s;
    fs.writeFileSync(BUNDLE, s);
    console.log('bundle already applied');
    return;
  }

  // Subscribe to session so hasPermission changes re-render the hub/ops tabs.
  // Selecting only s.hasPermission is stable and never re-renders on grant.
  const opsOld =
    'function OperationsPage() {\n  const hasPermission = useAuthStore((s) => s.hasPermission);\n';
  const opsNew =
    'function OperationsPage() {\n  const hasPermission = useAuthStore((s) => s.hasPermission);\n' + ACCESS_TICK;
  must(s.split(opsOld).length - 1 === 1, 'OperationsPage needle count');
  s = s.replace(opsOld, opsNew);

  const hubOld =
    'function AdminHubPage() {\n  const { t } = useI18n();\n  const hasPermission = useAuthStore((s) => s.hasPermission);\n';
  const hubNew =
    'function AdminHubPage() {\n  const { t } = useI18n();\n  const hasPermission = useAuthStore((s) => s.hasPermission);\n' + ACCESS_TICK;
  must(s.split(hubOld).length - 1 === 1, 'AdminHubPage needle count');
  s = s.replace(hubOld, hubNew);

  must(s.includes('reactExports.useState'), 'reactExports.useState available');
  must((s.match(/const\[, _psAccessTick\]=/g) || []).length === 2, 'expected exactly 2 access ticks');

  s = MARK + '\n' + s;
  fs.writeFileSync(BUNDLE, s);
  must(s.includes('ps:access'), 'bundle access listener missing');
  console.log('patched bundle live access', BUNDLE);
}

patchMain();
patchBundle();

// Mirror into out/ / packaged (electron loads these).
for (const rel of ['out/main/index.js', 'packaged-renderer/index.js']) {
  const dest = path.join(ROOT, rel);
  if (!fs.existsSync(dest)) continue;
  fs.copyFileSync(MAIN, dest);
  console.log('copied main →', rel);
}
for (const rel of [
  'out/renderer/assets/index-BsrHjfOR.js',
  'packaged-renderer/assets/index-BsrHjfOR.js',
]) {
  const dest = path.join(ROOT, rel);
  if (!fs.existsSync(dest)) continue;
  const cur = fs.readFileSync(dest, 'utf8');
  if (!cur.includes('function OperationsPage')) {
    console.log('skip', rel, '(no OperationsPage)');
    continue;
  }
  fs.copyFileSync(BUNDLE, dest);
  console.log('copied bundle →', rel);
}
