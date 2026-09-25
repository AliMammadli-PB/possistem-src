#!/usr/bin/env node
/**
 * Restaurant till ops: persist tenant+staff so relaunch skips a second login,
 * and open the Linux window fullscreen at startup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_OPS_v1 */';

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
  main = replaceOnce(
    main,
    'case"tenant.status":{const n=ft();return y(!n||!Ue?{authenticated:!1}:{authenticated:!0,email:n.email,customerId:n.customerId,customerName:n.customerName,expiresAt:n.expiresAt,paymentUrl:n.paymentUrl,licenses:n.licenses})}',
    'case"tenant.status":{const n=ft();n&&(Ue=!0);return y(!n?{authenticated:!1}:{authenticated:!0,email:n.email,customerId:n.customerId,customerName:n.customerName,expiresAt:n.expiresAt,paymentUrl:n.paymentUrl,licenses:n.licenses})}',
    'tenant.status honor persisted session',
  );

  main = replaceOnce(
    main,
    'function Yt(e){Ge=e;for(const t of Je)t(Ge)}function Ne(){Yt(null)}',
    `function _psStaffPath(){return m.join(c.app.getPath("userData"),"staff-session.bin")}function _psSaveStaff(e){const t=_psStaffPath();if(!e){try{p.writeFileSync(t,Buffer.alloc(0))}catch{}return}try{const n=JSON.stringify(e);c.safeStorage.isEncryptionAvailable()?p.writeFileSync(t,c.safeStorage.encryptString(n)):p.writeFileSync(t,Buffer.from(n,"utf8"))}catch{}}function _psLoadStaff(){const t=_psStaffPath();if(!p.existsSync(t))return null;try{const r=p.readFileSync(t);if(!r.length)return null;let n;if(c.safeStorage.isEncryptionAvailable())try{n=c.safeStorage.decryptString(r)}catch{n=r.toString("utf8")}else n=r.toString("utf8");return ss(JSON.parse(n))}catch{return null}}function Yt(e){Ge=e;_psSaveStaff(e);for(const t of Je)t(Ge)}function Ne(){Yt(null)}`,
    'persist staff session',
  );

  main = replaceOnce(
    main,
    'c.app.whenReady().then(()=>{L.info("app_ready"',
    'c.app.whenReady().then(()=>{const _psStaff=_psLoadStaff();_psStaff&&Yt(_psStaff);L.info("app_ready"',
    'restore staff on ready',
  );

  main = replaceOnce(
    main,
    't=()=>{e.isDestroyed()||(e.show(),Pe(e,z()),z().mode==="fullscreen"&&!e.isFullScreen()&&e.setFullScreen(!0)),V&&!V.isDestroyed()&&(V.close(),V=null)}',
    't=()=>{e.isDestroyed()||(e.show(),Pe(e,{...z(),mode:"fullscreen"}),e.setFullScreen(!0)),V&&!V.isDestroyed()&&(V.close(),V=null)}',
    'force fullscreen after splash',
  );

  main = replaceOnce(
    main,
    'const e=z(),t=e.mode==="fullscreen",n=e.mode==="windowed"?e.width:1600,s=e.mode==="windowed"?e.height:1e3,r=new c.BrowserWindow({width:n,height:s,minWidth:800,minHeight:560,show:!1,backgroundColor:"#efe8dc",transparent:!1,title:"possistem",icon:yn(),autoHideMenuBar:!0,fullscreen:t,webPreferences:{...wn,preload:gn()}})',
    'const e=z(),n=e.mode==="windowed"?e.width:1600,s=e.mode==="windowed"?e.height:1e3,r=new c.BrowserWindow({width:n,height:s,minWidth:800,minHeight:560,show:!1,backgroundColor:"#efe8dc",transparent:!1,title:"possistem",icon:yn(),autoHideMenuBar:!0,fullscreen:!0,webPreferences:{...wn,preload:gn()}})',
    'create window fullscreen',
  );

  main = replaceOnce(
    main,
    'r.once("ready-to-show",()=>{Pe(r,z())}),r.webContents.on("did-finish-load",()=>{Pe(r,z())})',
    'r.once("ready-to-show",()=>{Pe(r,{...z(),mode:"fullscreen"}),r.setFullScreen(!0)}),r.webContents.on("did-finish-load",()=>{Pe(r,{...z(),mode:"fullscreen"}),r.isFullScreen()||r.setFullScreen(!0)}),r.webContents.on("before-input-event",(e,t)=>{if(t.type!=="keyDown")return;if(t.key==="F11"){e.preventDefault();r.setFullScreen(!r.isFullScreen())}else if(t.key==="Escape"&&r.isFullScreen())r.setFullScreen(!1)})',
    'Esc/F11 fullscreen and apply on load',
  );

  main = `${MARK}\n${main}`;
  must(main.includes('_psLoadStaff'), 'staff persist missing');
  must(main.includes('n&&(Ue=!0)'), 'tenant status restore missing');
  must(main.includes('fullscreen:!0'), 'window fullscreen missing');
  fs.writeFileSync(MAIN, main);
  console.log('patched main', MAIN);
} else {
  console.log('main already applied');
}

let bundle = fs.readFileSync(BUNDLE, 'utf8');
if (!bundle.includes('POS_OPS_v1')) {
  bundle = replaceOnce(
    bundle,
    'const [rememberMe, setRememberMe] = reactExports.useState(false);',
    'const [rememberMe, setRememberMe] = reactExports.useState(true);',
    'remember-me default on',
  );
  bundle = replaceOnce(
    bundle,
    `    toast(hint ? \`\${t.tenant.loginSuccess}. \${hint}\` : t.tenant.loginSuccess, "success");
    navigate("/activate", { replace: true });`,
    `    toast(hint ? \`\${t.tenant.loginSuccess}. \${hint}\` : t.tenant.loginSuccess, "success");
    navigate("/", { replace: true });`,
    'after tenant login go to router',
  );
  bundle = bundle.replace('/* POS_LOGIN_v6 */', `/* POS_LOGIN_v6 */\n/* POS_OPS_v1 */`);
  if (!bundle.includes('POS_OPS_v1')) {
    bundle = bundle.replace('/* POS_LAYOUT_v3 */', `/* POS_LAYOUT_v3 */\n/* POS_OPS_v1 */`);
  }
  must(bundle.includes('POS_OPS_v1'), 'ops mark missing from bundle');
  fs.writeFileSync(BUNDLE, bundle);
  console.log('patched bundle', BUNDLE);
} else {
  console.log('bundle already applied');
}

if (!bundle.includes('POS_OPS_v1b')) {
  bundle = fs.readFileSync(BUNDLE, 'utf8');
  bundle = replaceOnce(
    bundle,
    `      setCoreBusy(false);
      setTenantOk(decision === "pass");
      setTenantReady(true);`,
    `      setCoreBusy(false);
      if (decision === "pass") setTenantOk(true);
      else if (decision === "block") setTenantOk(false);
      setTenantReady(true);`,
    'do not drop tenantOk on retry',
  );
  bundle = bundle.replace('/* POS_OPS_v1 */', '/* POS_OPS_v1 */\n/* POS_OPS_v1b */');
  must(bundle.includes('POS_OPS_v1b'), 'ops v1b mark missing');
  fs.writeFileSync(BUNDLE, bundle);
  console.log('patched tenantOk retry guard');
}

if (!main.includes('POS_OPS_v1c')) {
  main = fs.readFileSync(MAIN, 'utf8');
  main = replaceOnce(
    main,
    'function ss(e){if(typeof e!="object"||e===null)return null;const n=e.session??e;if(typeof n!="object"||n===null)return null;const s=n;if(typeof s.userId!="string"||typeof s.fullName!="string"||typeof s.role!="string"||typeof s.code!="string")return null;const r=Array.isArray(s.permissions)?s.permissions.filter(a=>typeof a=="string"):[];return{userId:s.userId,code:s.code,fullName:s.fullName,role:s.role,shiftId:typeof s.shiftId=="string"?s.shiftId:null,permissions:r,loginAt:typeof s.loginAt=="number"?s.loginAt:Date.now(),authenticated:!0}}',
    'function ss(e){if(typeof e!="object"||e===null)return null;const n=e.session??e.data??e;if(typeof n!="object"||n===null)return null;const s=n.session&&typeof n.session=="object"?n.session:n;const i=typeof s.userId=="string"&&s.userId?s.userId:typeof s.id=="string"?s.id:"";const a=typeof s.fullName=="string"?s.fullName:typeof s.name=="string"?s.name:"";const o=typeof s.role=="string"?s.role:"";if(!i||!o)return null;const d=typeof s.code=="string"?s.code:"";const r=Array.isArray(s.permissions)?s.permissions.filter(u=>typeof u=="string"):[];return{userId:i,code:d,fullName:a,role:o,shiftId:typeof s.shiftId=="string"?s.shiftId:null,permissions:r,loginAt:typeof s.loginAt=="number"?s.loginAt:Date.now(),authenticated:!0}}',
    'ss accept login payload without code',
  );
  main = replaceOnce(
    main,
    'function _psSaveStaff(e){const t=_psStaffPath();if(!e){try{p.writeFileSync(t,Buffer.alloc(0))}catch{}return}try{const n=JSON.stringify(e);c.safeStorage.isEncryptionAvailable()?p.writeFileSync(t,c.safeStorage.encryptString(n)):p.writeFileSync(t,Buffer.from(n,"utf8"))}catch{}}',
    'function _psSaveStaff(e){const t=_psStaffPath();if(!e){try{p.writeFileSync(t,Buffer.alloc(0))}catch{}return}try{const n=JSON.stringify(e);if(!n||n==="null")return;let r;try{r=c.safeStorage.isEncryptionAvailable()?c.safeStorage.encryptString(n):Buffer.from(n,"utf8")}catch{r=Buffer.from(n,"utf8")}if(r&&r.length)p.writeFileSync(t,r)}catch{}}',
    'staff-session write must be non-empty',
  );
  main = replaceOnce(
    main,
    'if(s==="auth.login"&&C.success){const k=ss(C.data);k&&Yt(k)}else s==="auth.logout"&&Ne();',
    'if(s==="auth.login"&&C.success){const k=ss(C.data)||ss(C);k&&Yt(k)}else s==="auth.logout"&&Ne();',
    'login persist try data or envelope',
  );
  if (!main.includes('/* POS_OPS_v1c */') && !main.startsWith('/* POS_OPS_v1c */')) {
    main = main.replace('/* POS_OPS_v1 */', '/* POS_OPS_v1 */\n/* POS_OPS_v1c */');
    if (!main.includes('POS_OPS_v1c')) main = `/* POS_OPS_v1c */\n${main}`;
  }
  must(main.includes('e.session??e.data??e'), 'ss envelope missing');
  must(main.includes('if(r&&r.length)p.writeFileSync(t,r)'), 'non-empty staff write missing');
  must(main.includes('ss(C.data)||ss(C)'), 'login persist fallback missing');
  fs.writeFileSync(MAIN, main);
  console.log('patched staff-session persist v1c');
}

if (!main.includes('POS_OPS_v1d')) {
  main = fs.readFileSync(MAIN, 'utf8');
  // A detached DevTools window opened over the fullscreen till on every single
  // launch — a debug leftover that shipped. Nothing else on this line changes,
  // so fullscreen setup and the renderer load stay exactly as they were.
  main = replaceOnce(
    main,
    'r.webContents.openDevTools({mode:"detach"}),r.loadURL(',
    'r.loadURL(',
    'no auto DevTools on launch',
  );
  main = main.replace('/* POS_OPS_v1 */', '/* POS_OPS_v1 */\n/* POS_OPS_v1d */');
  if (!main.includes('POS_OPS_v1d')) main = `/* POS_OPS_v1d */\n${main}`;
  must(!main.includes('openDevTools'), 'DevTools call still present');
  fs.writeFileSync(MAIN, main);
  console.log('patched: no auto DevTools v1d');
}

if (!main.includes('POS_OPS_v1e')) {
  main = fs.readFileSync(MAIN, 'utf8');
  // The till never showed as online in the customer portal. The wiring was all
  // there - a device heartbeat POST, scheduled at boot - but it fired on a
  // randomised 12-24 HOUR timer, while the control API only counts a device as
  // connected when lastSeenAt is under 10 minutes old (customer-live.ts). So a
  // till that runs a normal shift would heartbeat roughly never, and the portal
  // was right to say "Bağlantı yoxdur".
  //
  // 2-2.5 minutes keeps it comfortably inside that window. The endpoint allows
  // 120 requests/minute per device, so this is nothing; the jitter keeps a room
  // full of tills from beating in lockstep.
  main = replaceOnce(
    main,
    'function Ws(){return Rt+Math.floor(Math.random()*($s-Rt))}',
    'function Ws(){return 12e4+Math.floor(Math.random()*3e4)}',
    'heartbeat cadence',
  );
  // The log line said "delayHours", which would now always print 0.
  main = replaceOnce(
    main,
    'D.info("heartbeat_scheduled",{delayHours:Math.round(e/ge)})',
    'D.info("heartbeat_scheduled",{delaySeconds:Math.round(e/1e3)})',
    'heartbeat log unit',
  );
  main = main.replace('/* POS_OPS_v1 */', '/* POS_OPS_v1 */\n/* POS_OPS_v1e */');
  if (!main.includes('POS_OPS_v1e')) main = `/* POS_OPS_v1e */\n${main}`;
  must(main.includes('function Ws(){return 12e4+'), 'heartbeat interval not applied');
  must(!main.includes('Rt+Math.floor(Math.random()*($s-Rt))'), 'old 12h schedule survived');
  must(main.includes('/devices/${encodeURIComponent(t.deviceId)}/heartbeat'), 'heartbeat call lost');
  fs.writeFileSync(MAIN, main);
  console.log('patched: online heartbeat every ~2min v1e');
}

if (!main.includes('POS_OPS_v1f')) {
  main = fs.readFileSync(MAIN, 'utf8');
  // Staff roles and permissions the owner set on possistem.az.
  //
  // Pulled on the heartbeat tick rather than on its own timer: it is one small
  // POST, it needs exactly the device credentials the heartbeat already has,
  // and a policy that lands two minutes late is fine - the till applies it
  // before the next shift either way.
  //
  // The core compares the version it last applied and no-ops when it matches,
  // so re-posting the same policy every tick costs one read. `roles.applyPolicy`
  // is deliberately absent from the renderer method gate (protocol.json marks
  // it internal), so only this path can reach it.
  main = replaceOnce(
    main,
    'return g.ok||D.warn("heartbeat_remote_failed",{error:g.error}),N("license.heartbeat")}function Ws()',
    'g.ok||D.warn("heartbeat_remote_failed",{error:g.error});'
      + 'try{await _psSyncRolePolicy()}catch(h){D.warn("role_policy_sync_failed",{message:h instanceof Error?h.message:String(h)})}'
      + 'return N("license.heartbeat")}'
      + 'async function _psSyncRolePolicy(){'
      + 'const e=await J();if(!e)return;'
      + 'const t=le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint});'
      + 'const n=await de(e.baseUrl,"/owner/device/roles",t.body,t.token);'
      + 'if(!n.ok){D.warn("role_policy_fetch_failed",{error:n.error});return}'
      + 'const s=n.data,v=typeof s?.version=="number"?s.version:0;'
      + 'if(!v||!Array.isArray(s?.roles))return;'
      + 'const r=await N("roles.applyPolicy",{version:v,roles:s.roles},15e3);'
      + 'if(!r.success){D.warn("role_policy_apply_failed",{version:v,error:r.error});return}'
      + 'r.data?.skipped||D.info("role_policy_applied",{version:v,applied:r.data?.applied,created:r.data?.created})'
      + '}function Ws()',
    'role policy sync on heartbeat',
  );
  main = main.replace('/* POS_OPS_v1 */', '/* POS_OPS_v1 */\n/* POS_OPS_v1f */');
  if (!main.includes('POS_OPS_v1f')) main = `/* POS_OPS_v1f */\n${main}`;
  must(main.includes('_psSyncRolePolicy'), 'policy sync not inserted');
  must(main.includes('"/owner/device/roles"'), 'policy endpoint missing');
  must(main.includes('N("roles.applyPolicy"'), 'policy apply call missing');
  // The renderer must not be able to reach it; the gate is the boundary.
  must(!main.includes('"roles.applyPolicy":{auth:'), 'applyPolicy leaked into the renderer gate');
  fs.writeFileSync(MAIN, main);
  console.log('patched: website role policy sync v1f');
}
