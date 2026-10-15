#!/usr/bin/env node
/**
 * 1.8.0 — the restaurant managed from the possistem.az portal.
 *
 * The portal runs the till's own Əməliyyatlar screens; each core call they
 * make arrives here as one signed `core.batch` command (via
 * /pos/api/customer/pos/rpc). Each call:
 *   - must be one of the screens' own methods (the API checks the same list),
 *   - runs as this till's administrator (scoped: whoever is signed in at the
 *     till stays signed in), from the "Sayt paneli" terminal,
 *   - answers like the till would, packed with deflate.
 * `__session` returns the administrator's session for the portal's renderer.
 *
 * While someone works in the portal the API says `fastPoll`, and the till
 * then checks for commands every second (/owner/device/commands) instead of
 * waiting for its five-second sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'index.js');
const MARK = '/* POS_PORTAL_RPC_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

/** Shared with the portal bridge (portal-web/bridge.template.js) and mirrored by the API. */
const METHODS = JSON.parse(fs.readFileSync(path.join(ROOT, "portal-web", "remote-methods.json"), "utf8"));

let m = fs.readFileSync(MAIN, 'utf8');
if (m.includes(MARK)) {
  console.log('main already applied');
} else {
  const helpers = `${MARK}
const _PS_PORTAL_METHODS=new Set(${JSON.stringify(METHODS)});
let _psPortalAdmin=null,_psFastBusy=!1;
async function _psPortalActor(){
  if(_psPortalAdmin&&Date.now()-_psPortalAdmin.at<6e4)return _psPortalAdmin;
  const r=await b("auth.listUsers",{},8e3);
  const users=r.success&&r.data&&Array.isArray(r.data.users)?r.data.users:[];
  const role=u=>String(u&&(u.role||u.roleName)||"").toLowerCase();
  const admin=users.find(u=>role(u)==="administrator")||users.find(u=>role(u).includes("admin"));
  if(!admin)return null;
  _psPortalAdmin={id:String(admin.id),name:String(admin.fullName||"Administrator"),code:String(admin.code||""),at:Date.now()};
  return _psPortalAdmin;
}
async function _psPortalBatch(cmd,args){
  if(globalThis.__psLanRoute)return{commandId:cmd.id,ok:!1,error:"Bu kompüter əsas kassa deyil",errorCode:"E_NOT_HOST"};
  if(!et)return{commandId:cmd.id,ok:!1,error:"Kassa nüvəsi hazır deyil",errorCode:"E_CORE_UNAVAILABLE"};
  const calls=Array.isArray(args.calls)?args.calls.slice(0,16):[];
  const actor=await _psPortalActor();
  if(!actor)return{commandId:cmd.id,ok:!1,error:"Kassada administrator tapılmadı",errorCode:"E_NO_ADMIN"};
  const scope={actor:{userId:actor.id},terminal:{id:"portal",name:"Sayt paneli"}};
  const deny=m=>({success:!1,data:null,error:{code:"E_FORBIDDEN",message:m,retryable:!1}});
  const results=[];
  for(const c of calls){
    const method=String(c&&c.method||"");
    const payload=c&&c.payload&&typeof c.payload=="object"&&!Array.isArray(c.payload)?c.payload:{};
    if(method==="__session"){
      const perms=await et.invoke("permissions.list",{},{...scope,timeoutMs:8e3});
      const keys=[];
      if(perms.success)for(const list of Object.values(perms.data&&perms.data.groups||{}))for(const p of Array.isArray(list)?list:[])if(p&&p.key)keys.push(String(p.key));
      results.push({success:!0,data:{userId:actor.id,code:actor.code,fullName:actor.name,role:"administrator",shiftId:null,permissions:keys,loginAt:Date.now(),authenticated:!0},error:null});
      continue;
    }
    const spec=Cn[method];
    if(!_PS_PORTAL_METHODS.has(method)||!spec){results.push(deny("Bu əməliyyat saytdan açıq deyil"));continue}
    if(method==="settings.set"&&payload.key!=="costing.resetAt"){results.push(deny("Bu parametr saytdan dəyişdirilmir"));continue}
    const key=typeof c.idempotencyKey=="string"&&spec.idempotent?c.idempotencyKey.slice(0,120):void 0;
    try{results.push(await et.invoke(method,payload,{...scope,idempotencyKey:key,timeoutMs:Math.min(Math.max(Number(spec.timeout)||8e3,3e3),6e4)}))}
    catch(err){results.push({success:!1,data:null,error:{code:"E_INTERNAL",message:String(err&&err.message||err),retryable:!1}})}
  }
  const z=require("node:zlib").deflateRawSync(Buffer.from(JSON.stringify(results),"utf8")).toString("base64");
  return{commandId:cmd.id,ok:!0,result:{z}};
}
async function _psFastCommands(){
  if(_psFastBusy||!((globalThis.__psFastUntil||0)>Date.now())||globalThis.__psLanRoute)return;
  _psFastBusy=!0;
  try{
    const e=await J();
    if(!e)return;
    const res=await de(e.baseUrl,"/owner/device/commands",le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint}).body,an().token);
    if(!res.ok)return;
    globalThis.__psFastUntil=res.data&&res.data.fastPoll?Date.now()+6e4:0;
    const report=async l=>{const g=await de(e.baseUrl,"/owner/device/command-result",le({deviceId:e.deviceId,deviceFingerprint:e.fingerprint,...l}).body,an().token);g.ok||v.warn("command_result_failed",{id:l.commandId,error:g.error})};
    const u=[];
    for(const cmd of res.data&&Array.isArray(res.data.commands)?res.data.commands:[]){
      const ok=_psVerifyCommand(cmd,e);
      if(ok){u.push(ok);continue}
      v.warn("command_refused_unsigned",{id:cmd&&cmd.id});
      cmd&&cmd.id&&await report({commandId:cmd.id,ok:!1,error:"Əmr imzası etibarsızdır",errorCode:"E_COMMAND_SIGNATURE"}).catch(()=>{});
    }
    u.length>0&&await Ps(u,report);
  }catch(err){v.warn("portal_fast_poll_failed",{message:err instanceof Error?err.message:String(err)})}
  finally{_psFastBusy=!1}
}
async function Os(e){`;
  m = replaceOnce(m, 'async function Os(e){', helpers, 'helpers');
  m = replaceOnce(m, 'switch(e.command){case"report.x":{', 'switch(e.command){case"core.batch":return _psPortalBatch(e,t);case"report.x":{', 'command case');
  // The sync's answer says whether the portal is in use.
  m = replaceOnce(m, 'try{await _psInventoryPortal(e)}catch(invErr)',
    'globalThis.__psFastUntil=i.data&&i.data.fastPoll?Date.now()+6e4:(globalThis.__psFastUntil||0);try{await _psInventoryPortal(e)}catch(invErr)', 'fast flag');
  m = replaceOnce(m, 'ae.unref?.(),v.info("owner_sync_started",{intervalMs:Ct})',
    'ae.unref?.(),globalThis.__psFastTimer||(globalThis.__psFastTimer=setInterval(()=>{_psFastCommands().catch(()=>{})},1e3),globalThis.__psFastTimer.unref?.()),v.info("owner_sync_started",{intervalMs:Ct})', 'fast timer');
  fs.writeFileSync(MAIN, m);
  console.log('main: portal rpc');
}
