'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),format=require('./cloud-backup-format.cjs');
function localPath(p){return process.platform!=='win32'&&/^Z:\\/i.test(p)?p.slice(2).replaceAll('\\','/'):p;}
// A snapshot left behind by a crash or a power cut is a whole database on the till's disk.
async function removeStaleSnapshots(current){const dir=path.dirname(current);for(const name of await fs.readdir(dir).catch(()=>[]))if(/^pos-cloud-.*\.db$/.test(name)&&name!==path.basename(current))await fs.unlink(path.join(dir,name)).catch(()=>{});}
function createClient(options){
 const states=new Map();let busy=false;
 const get=async()=>{const c=await options.credentials();if(!c||!c.deviceId||!c.customerId||!c.fingerprint)return null;const u=new URL(c.baseUrl);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('HTTPS_REQUIRED');return c};
 const request=async(c,suffix,init={})=>{const r=await (options.fetch||fetch)(c.baseUrl.replace(/\/$/,'')+'/devices/'+encodeURIComponent(c.deviceId)+'/cloud-backup'+suffix,{...init,headers:{'x-device-fingerprint':c.fingerprint,...init.headers},signal:AbortSignal.timeout(suffix?30000:900000)});if(!r.ok){let code='HTTP_'+r.status;try{code=(await r.json()).code||code}catch{}throw Error(code)}return r.json()};
 async function status(){if(options.isTerminal?.())return{status:'terminal',lastSuccessAt:null};try{const c=await get();return c?(states.get(c.deviceId)||{status:'waiting',lastSuccessAt:null}):{status:'not_activated',lastSuccessAt:null};}catch(e){return{status:'error',lastSuccessAt:null,error:e.message};}}
 async function tick(force=false){if(busy)return{status:'busy'};busy=true;let c,temp;
  try{if(options.isTerminal?.())return{status:'terminal'};c=await get();if(!c)return{status:'not_activated'};const previous=states.get(c.deviceId)||{};if(!force&&previous.retryAt>Date.now())return previous;
   const remote=await request(c,'/status');if(!remote.enabled){const s={status:'disabled',lastSuccessAt:remote.lastSuccessAt};states.set(c.deviceId,s);return s;}
   if(!force&&!remote.requestId&&remote.lastSuccessAt&&Date.now()-Date.parse(remote.lastSuccessAt)<remote.intervalMs){const s={status:'current',lastSuccessAt:remote.lastSuccessAt};states.set(c.deviceId,s);return s;}
   states.set(c.deviceId,{status:'uploading',lastSuccessAt:remote.lastSuccessAt});const snapshot=await options.snapshot();temp=localPath(snapshot.path);await removeStaleSnapshots(temp);
   const bytes=await format.make(temp,options.assetsDir(),{customerId:c.customerId,deviceId:c.deviceId,appVersion:c.appVersion});
   // A tenant switch mid-upload must not associate an old till with the new account.
   const latest=await get();if(!latest||latest.deviceId!==c.deviceId||latest.customerId!==c.customerId)throw Error('ACCOUNT_CHANGED');
   const form=new FormData();form.append('file',new Blob([bytes],{type:'application/octet-stream'}),'snapshot.posbackup');const result=await request(c,'',{method:'POST',body:form,headers:remote.requestId?{'x-backup-request-id':remote.requestId}:{}});
   if(!result.verified||result.sha256!==format.sha(bytes))throw Error('UPLOAD_ACK_INVALID');const s={status:'current',lastSuccessAt:new Date().toISOString(),id:result.id};states.set(c.deviceId,s);return s;
  }catch(e){const code=/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'BACKUP_FAILED';const old=c?states.get(c.deviceId)||{}:{};if(c&&code==='BACKUP_BUSY'){const s={status:'waiting',lastSuccessAt:old.lastSuccessAt||null,retryAt:Date.now()+2*60_000};states.set(c.deviceId,s);return s;}const s={status:'error',lastSuccessAt:old.lastSuccessAt||null,error:code,retryAt:Date.now()+5*60_000};if(c){states.set(c.deviceId,s);try{await request(c,'/error',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})})}catch{}}return s;
  }finally{if(temp)await fs.unlink(temp).catch(()=>{});busy=false;}
 }
 // A new computer of the same account: the newest copy of each till, and one brought into this till's backups folder.
 async function available(){const c=await get();if(!c)throw Error('NOT_ACTIVATED');return(await request(c,'/available')).backups||[];}
 async function fetchBackup(id,dest,assetsDir){const c=await get();if(!c)throw Error('NOT_ACTIVATED');if(!/^[a-f0-9-]{36}$/i.test(String(id)))throw Error('BACKUP_INVALID');
  const r=await (options.fetch||fetch)(c.baseUrl.replace(/\/$/,'')+'/devices/'+encodeURIComponent(c.deviceId)+'/cloud-backup/download/'+id,{headers:{'x-device-fingerprint':c.fingerprint},signal:AbortSignal.timeout(600000)});
  if(!r.ok){let code='HTTP_'+r.status;try{code=(await r.json()).code||code}catch{}throw Error(code)}
  const file=dest+'.posbackup';await fs.writeFile(file,Buffer.from(await r.arrayBuffer()),{mode:0o600});
  try{return await importBundle(file,dest,assetsDir,c.customerId);}finally{await fs.unlink(file).catch(()=>{});}}
 return{tick,status,available,fetchBackup};
}
async function importBundle(file,dest,assetsDir,customerId){const bytes=await fs.readFile(file);let data;try{data=await format.decode(bytes);}catch{throw Error('Bu fayl zədələnib və ya Possistem yedəyi deyil.');}if(!customerId)throw Error('Yedəyi bərpa etmək üçün əvvəlcə kassanı aktivləşdirin.');if(data.meta.customerId!==customerId)throw Error('Bu yedək başqa hesaba aiddir.');await format.unpack(bytes,dest,assetsDir);return{path:dest,manifest:{assets:data.assets.length,sha256:format.sha(bytes)}};}
module.exports={createClient,importBundle,localPath};
