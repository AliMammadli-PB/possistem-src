#!/usr/bin/env node
/**
 * One restaurant, several PCs, one database.
 *
 * The owner marks one PC per product as "Əsas" on possistem.az (Kompüterlər)
 * and gives every PC a job: Hamısı / Kassa / Ofisiant / Mətbəx / Anbar. The
 * till reads both on its 5 s sync (`device` in the answer).
 *
 *  - Host: listens on the LAN (port 43180) and runs every call it receives
 *    through its own core, as the staff member signed in at the calling PC
 *    (the core's `actor` envelope field - see native lan_actor_test.cpp).
 *  - Terminal (any PC of the same customer while a host exists): sends every
 *    core call to the host instead of its own database, and replays the host's
 *    core events (kds.updated, tables.updated…) to its own screens. A burger
 *    sold at the till therefore leaves the store room's stock on the store
 *    room's PC, because there is only one stock.
 *  - Station: the website's area list is narrowed to the PC's job, so the
 *    kitchen PC shows the kitchen screen, the store-room PC shows Anbar.
 *
 * Calls are signed with an HMAC key the website derives per customer, so no
 * other shop on the same network - and no stray program - can talk to the
 * host. If the host cannot be reached a terminal refuses to write rather than
 * falling back to its own database: two databases is the problem this solves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LAN_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const LAN_BLOCK = `
${MARK}
var _psLan={station:"all",host:false,hostAddress:null,key:null,server:null,actor:null,events:[],seq:0,waiters:[],online:true,polling:false,lastSeq:-1};
var PS_LAN_PORT=43180;
var PS_AREAS_ALL=["tables","kds","refund","stock","suppliers","guests","delivery","roster","catalog","reports","cash","staff","admin","settings"];
var PS_STATION_AREAS={cashier:["tables","cash","refund","guests","delivery","settings"],waiter:["tables","guests","settings"],kitchen:["kds","settings"],warehouse:["stock","suppliers","catalog","reports","settings"]};
/* Stay on this PC: the core's own heartbeat, and the audit trail each PC uploads for itself. */
var PS_LAN_LOCAL=new Set(["core.ping","core.info","core.stats","audit.pending","audit.ack","sync.status","sync.outbox"]);
/* Never from another PC: they take file paths or wipe the shared database. */
var PS_LAN_DENY=new Set(["backup.create","backup.restore","backup.restorePreview","system.resetOperational","receiptLogo.apply","receiptLogo.clear","roles.applyPolicy","settings.applyProvisionedIdentity"]);
function _psLanFile(){return m.join(Wt(),"lan.json")}
function _psLanSign(key,ts,body){return W.createHmac("sha256",key).update(ts+"."+body).digest("hex")}
function _psLanVerify(key,ts,body,sig){if(!key||typeof sig!=="string"||typeof ts!=="string")return false;if(Math.abs(Date.now()-Number(ts))>60000)return false;const want=_psLanSign(key,ts,body);return want.length===sig.length&&W.timingSafeEqual(Buffer.from(want),Buffer.from(sig))}
function _psLanAddresses(){const out=[];for(const list of Object.values(Bt.networkInterfaces()))for(const a of list||[])if(a&&a.family==="IPv4"&&!a.internal)out.push(a.address+":"+PS_LAN_PORT);return out}
function _psLanAccess(list){const allowed=PS_STATION_AREAS[_psLan.station];if(!allowed)return Array.isArray(list)?list:null;return(Array.isArray(list)?list:PS_AREAS_ALL).filter(k=>allowed.includes(k))}
function _psLanBanner(){const text=_psLan.online?"":"Əsas kompüterə qoşulmaq olmur ("+(_psLan.hostAddress||"?")+"). Əsas kompüter açıq və eyni şəbəkədə olmalıdır — yazılar dayandırıldı.";const js="(()=>{let b=document.getElementById('ps-lan-banner');const t="+JSON.stringify(text)+";if(!t){b&&b.remove();return}if(!b){b=document.createElement('div');b.id='ps-lan-banner';b.setAttribute('role','alert');b.style.cssText='position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 16px;background:#b91c1c;color:#fff;font:600 15px/1.4 system-ui;text-align:center';document.body.appendChild(b)}b.textContent=t})()";for(const win of c.BrowserWindow.getAllWindows())if(!win.isDestroyed())void win.webContents.executeJavaScript(js).catch(()=>{})}
function _psLanSetOnline(on){if(_psLan.online===on)return;_psLan.online=on;_psLanBanner()}
function _psLanJson(res,code,obj){const b=JSON.stringify(obj);res.writeHead(code,{"content-type":"application/json","content-length":Buffer.byteLength(b)});res.end(b)}
function _psLanOnEvent(r){if(!_psLan.host||!r||typeof r.event!=="string")return;_psLan.seq+=1;_psLan.events.push({seq:_psLan.seq,event:r.event,payload:r.payload});if(_psLan.events.length>300)_psLan.events.splice(0,_psLan.events.length-300);const w=_psLan.waiters.splice(0);for(const f of w)f()}
function _psLanStart(){if(_psLan.server)return;const http=require("node:http");const srv=http.createServer((req,res)=>{let body="";let size=0;req.on("data",chunk=>{size+=chunk.length;if(size>8388608){req.destroy();return}body+=chunk});req.on("end",async()=>{try{if(!_psLan.host||!_psLanVerify(_psLan.key,req.headers["x-ps-ts"],body,req.headers["x-ps-sig"])){_psLanJson(res,401,{error:"unauthorized"});return}const url=new URL(req.url||"/","http://lan");if(req.method==="POST"&&url.pathname==="/rpc"){const q=JSON.parse(body||"{}");const method=String(q.method||"");const spec=Cn[method];if(!spec||PS_LAN_DENY.has(method)||PS_LAN_LOCAL.has(method)){_psLanJson(res,200,d("E_FORBIDDEN","Bu əməliyyat yalnız əsas kompüterdə edilir"));return}const actor=typeof q.actor?.userId==="string"?q.actor.userId:"";if(spec.auth&&!actor){_psLanJson(res,200,d("E_UNAUTHORIZED","Əvvəlcə PIN ilə daxil olun"));return}const core=globalThis.__psCore;if(!core){_psLanJson(res,200,d("E_CORE_DOWN","Əsas kompüterin nüvəsi hazır deyil",!0));return}const timeoutMs=Math.min(Math.max(Number(q.timeoutMs)||spec.timeout||3e3,1e3),18e4);const out=await core.invoke(method,q.payload&&typeof q.payload==="object"?q.payload:{},{lanLocal:true,actor:{userId:actor},timeoutMs,idempotencyKey:spec.idempotent&&typeof q.idempotencyKey==="string"?q.idempotencyKey:void 0});_psLanJson(res,200,out);return}if(req.method==="GET"&&url.pathname==="/events"){const since=Number(url.searchParams.get("since"));const pick=()=>_psLan.events.filter(e=>e.seq>since);if(!(since>=0)){_psLanJson(res,200,{seq:_psLan.seq,events:[]});return}if(pick().length){_psLanJson(res,200,{seq:_psLan.seq,events:pick()});return}let done=false;const finish=()=>{if(done)return;done=true;const at=_psLan.waiters.indexOf(finish);at>=0&&_psLan.waiters.splice(at,1);_psLanJson(res,200,{seq:_psLan.seq,events:pick()})};_psLan.waiters.push(finish);setTimeout(finish,20000);return}_psLanJson(res,404,{error:"not found"})}catch(err){try{_psLanJson(res,200,d("E_INTERNAL",err instanceof Error?err.message:String(err)))}catch{}}})});srv.on("error",err=>{v.warn("lan_server_error",{message:err instanceof Error?err.message:String(err)});_psLan.server=null});srv.listen(PS_LAN_PORT,"0.0.0.0",()=>v.info("lan_host_listening",{port:PS_LAN_PORT}));_psLan.server=srv}
function _psLanStop(){if(!_psLan.server)return;try{_psLan.server.close()}catch{}_psLan.server=null;const w=_psLan.waiters.splice(0);for(const f of w)f()}
function _psLanRoute(method,payload,opts){if(PS_LAN_LOCAL.has(method))return null;return(async()=>{const body=JSON.stringify({method,payload,actor:{userId:_psLan.actor||""},timeoutMs:opts?.timeoutMs,idempotencyKey:opts?.idempotencyKey});const ts=String(Date.now());try{const res=await fetch("http://"+_psLan.hostAddress+"/rpc",{method:"POST",headers:{"content-type":"application/json","x-ps-ts":ts,"x-ps-sig":_psLanSign(_psLan.key,ts,body)},body,signal:AbortSignal.timeout((opts?.timeoutMs??15e3)+5e3)});if(res.status===401)throw new Error("host refused the LAN key");const out=await res.json();_psLanSetOnline(true);if(out&&out.success){if(method==="auth.login"){const s=out.data?.session??out.data;if(s&&typeof s.userId==="string")_psLan.actor=s.userId}else if(method==="auth.logout")_psLan.actor=null}return out}catch(err){_psLanSetOnline(false);v.warn("lan_route_failed",{method,message:err instanceof Error?err.message:String(err)});return d("E_CORE_DOWN","Əsas kompüterə qoşulmaq olmur ("+_psLan.hostAddress+"). Əsas kompüter açıq və eyni şəbəkədə olmalıdır.",!0)}})()}
async function _psLanPoll(){if(_psLan.polling)return;_psLan.polling=true;try{while(globalThis.__psLanRoute===_psLanRoute){const ts=String(Date.now());try{const res=await fetch("http://"+_psLan.hostAddress+"/events?since="+_psLan.lastSeq,{headers:{"x-ps-ts":ts,"x-ps-sig":_psLanSign(_psLan.key,ts,"")},signal:AbortSignal.timeout(25e3)});const out=await res.json();_psLanSetOnline(true);const core=globalThis.__psCore;if(_psLan.lastSeq>=0&&core)for(const e of out.events||[])if(!/^(core\\.|reports\\.created)/.test(e.event))core.emit("event",{event:e.event,payload:e.payload});if(typeof out.seq==="number")_psLan.lastSeq=out.seq}catch{_psLanSetOnline(false);await new Promise(r=>setTimeout(r,3e3))}}}finally{_psLan.polling=false}}
function _psLanApply(device,persist=true){const dv=device&&typeof device==="object"?device:{};_psLan.station=typeof dv.station==="string"?dv.station:"all";_psLan.key=typeof dv.lanKey==="string"?dv.lanKey:null;_psLan.hostAddress=typeof dv.hostAddress==="string"?dv.hostAddress:null;_psLan.host=!!dv.lanHost&&!!_psLan.key;if(_psLan.host)_psLanStart();else _psLanStop();const terminal=!_psLan.host&&!!_psLan.hostAddress&&!!_psLan.key;const was=globalThis.__psLanRoute;globalThis.__psLanRoute=terminal?_psLanRoute:null;if(!terminal){_psLanSetOnline(true);_psLan.lastSeq=-1}if(terminal&&was!==_psLanRoute){_psLan.lastSeq=-1;void _psLanPoll()}if(persist){const next=JSON.stringify({station:_psLan.station,lanHost:_psLan.host,hostAddress:_psLan.hostAddress,lanKey:_psLan.key});if(next!==_psLan.saved){_psLan.saved=next;try{p.writeFileSync(_psLanFile(),next,"utf8")}catch{}}}}
try{const saved=JSON.parse(p.readFileSync(_psLanFile(),"utf8"));c.app.whenReady().then(()=>_psLanApply(saved,false)).catch(()=>{})}catch{}
`;

let main = fs.readFileSync(MAIN, 'utf8');
if (main.includes(MARK)) {
  console.log('main LAN already applied');
} else {
  // Every core call: to the host when this PC is a terminal, and the actor
  // envelope when the host runs a terminal's call.
  main = replaceOnce(
    main,
    'dispatch(t,n,s){const r=s?.timeoutMs??_.defaultTimeoutMs,a={requestId:W.randomUUID(),method:t,protocolVersion:ne,timestamp:Date.now(),payload:s?.idempotencyKey?{...n,idempotencyKey:s.idempotencyKey}:n};',
    'dispatch(t,n,s){if(globalThis.__psLanRoute&&!s?.lanLocal){const routed=globalThis.__psLanRoute(t,n,s);if(routed)return routed}const r=s?.timeoutMs??_.defaultTimeoutMs,a={requestId:W.randomUUID(),method:t,protocolVersion:ne,timestamp:Date.now(),payload:s?.idempotencyKey?{...n,idempotencyKey:s.idempotencyKey}:n};s?.actor&&(a.actor=s.actor);',
    'core dispatch',
  );
  main = replaceOnce(
    main,
    'function pr(e,t){let n=0;',
    'function pr(e,t){globalThis.__psCore=e;e.on("event",r=>{try{_psLanOnEvent(r)}catch{}});let n=0;',
    'core events',
  );
  // The host tells the website where it can be reached on the LAN.
  main = replaceOnce(
    main,
    'r=s.body;ke&&(r.report=ke,ke=null);',
    'r=s.body;_psLan.host&&(r.lanAddresses=_psLanAddresses());ke&&(r.report=ke,ke=null);',
    'sync lanAddresses',
  );
  // Station narrows the website's areas; the device answer switches LAN mode.
  main = replaceOnce(
    main,
    'try{const access=i.data&&Object.prototype.hasOwnProperty.call(i.data,"access")?i.data.access:null;',
    'try{try{_psLanApply(i.data&&i.data.device)}catch(lanErr){v.warn("lan_apply_failed",{message:lanErr instanceof Error?lanErr.message:String(lanErr)})}const access=_psLanAccess(i.data&&Object.prototype.hasOwnProperty.call(i.data,"access")?i.data.access:null);',
    'access by station',
  );
  // A terminal would upload the host's stock under its own name: the portal
  // would list every line twice.
  main = replaceOnce(
    main,
    'async function _psInventoryPortal(e){',
    'async function _psInventoryPortal(e){if(globalThis.__psLanRoute)return;',
    'inventory once',
  );
  main += LAN_BLOCK;
  fs.writeFileSync(MAIN, main);
  console.log('main LAN applied', MAIN);
}

// --- renderer: send the PC to its own screen ----------------------------------
let bundle = fs.readFileSync(BUNDLE, 'utf8');
if (bundle.includes(MARK)) {
  console.log('renderer LAN already applied');
} else {
  bundle = replaceOnce(
    bundle,
    `  if (!_psArea(location.pathname + location.search)) {
    return jsxRuntimeExports.jsx("div", { className: "flex h-full items-center justify-center text-cream", children: "Buna icazəniz yoxdur" });`,
    `  if (!_psArea(location.pathname + location.search)) {
    ${MARK}const home = Array.isArray(window.__psAccess) ? ["/tables", "/kds", "/operations?tab=stock", "/refund", "/settings"].find((p) => _psArea(p) && p !== location.pathname + location.search) : null;
    if (home) return jsxRuntimeExports.jsx(Navigate, { to: home, replace: true });
    return jsxRuntimeExports.jsx("div", { className: "flex h-full items-center justify-center text-cream", children: "Buna icazəniz yoxdur" });`,
    'PsGate home',
  );
  fs.writeFileSync(BUNDLE, bundle);
  console.log('renderer LAN applied', BUNDLE);
}
