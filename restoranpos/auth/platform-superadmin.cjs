'use strict';
const {randomBytes}=require('node:crypto');
const ID='possistem-admin';
/** Signed website grant -> independent native support identity. No merchant PIN reset. */
function createPlatformAuth(deps){
 let scope='',record=null,lastAttempt=0,inflight=null,pendingLogin=null,generation=0;
 const same=(a,b)=>a&&b&&a.customerId===b.customerId&&a.deviceId===b.deviceId;
 const scopeOf=c=>c.customerId+':'+c.deviceId;
 function verify(value,c){
  if(!value||value.payload?.deviceId!==c.deviceId||value.payload?.customerId!==c.customerId||
     value.payload?.kdf!=='scrypt'||value.payload?.N!==131072||value.payload?.prefixN!==16384||
     value.payload?.r!==8||value.payload?.p!==1||
     !(value.payload.issuedAt>0)||value.payload.issuedAt>Date.now()+300000)return null;
  for(const publicKeyHex of deps.keys()){
   const r=deps.verifySuperAdmin(value,{...c,publicKeyHex});if(r&&r.updatedAt>0)return r;
  }
  return null;
 }
 async function context(){
  const c=await deps.context();if(!c?.customerId||!c?.deviceId)return null;
  if(scope!==scopeOf(c)){
   scope=scopeOf(c);record=null;lastAttempt=0;generation++;
   const selected=scope;
   try{const saved=await deps.load(c);const valid=verify(saved,c);if(scope===selected&&valid)record=valid;}catch{}
  }
  return c;
 }
 async function accept(value,c){
  const current=await context();if(!same(c,current))return false;
  const next=value===null?null:verify(value,c);if(value!==null&&!next)return false;
  if(next&&record&&next.updatedAt<record.updatedAt)return false;
  const changed=Boolean(record)!==Boolean(next)||(next&&record&&(next.hash!==record.hash||next.prefixHash!==record.prefixHash));
  record=next;lastAttempt=Date.now();
  try{await deps.save(c,value);}catch{/* memory remains verified; never write secrets in the clear */}
  if(changed&&scope===scopeOf(c)&&deps.session()?.superAdmin)await deps.logout();
  return true;
 }
 async function get(refresh=true){
  const c=await context();if(!c)return {context:null,record:null};
  if(inflight?.scope===scope)await inflight.promise;
  else if(refresh&&Date.now()-lastAttempt>=30000){
   const job={scope,promise:null};lastAttempt=Date.now();
   job.promise=(async()=>{try{const value=await deps.fetch(c);if(scope===job.scope)await accept(value,c);}
    catch{/* offline keeps a previously verified, tenant-bound record */}})().finally(()=>{if(inflight===job)inflight=null;});
   inflight=job;await job.promise;
  }
  const current=await context();return same(c,current)?{context:c,record}: {context:null,record:null};
 }
 async function performLogin(pin){
   if(!/^\d{10}$/.test(String(pin)))return null;
   const data=await get();if(!data.record)return deps.fail('E_PLATFORM_PIN_UNAVAILABLE','POSSISTEM girişi üçün internetə qoşulun və yenidən sınayın');
   const started=generation;
   if(!deps.isSuperAdminPin(data.record,pin))return null; // native PIN-only lockout counts wrong ten-digit attempts too
   const users=await deps.invoke('auth.listUsers',{});
   const admin=users.data?.users?.find(u=>u.id==='usr-admin')||users.data?.users?.find(u=>u.role==='administrator');
   if(!users.success||!admin)return deps.fail('E_UNAUTHORIZED','Yerli administrator tapılmadı');
   if(started!==generation||!same(await context(),data.context))return deps.fail('E_UNAUTHORIZED','Hesab dəyişdi. Yenidən daxil olun');
   const secret=randomBytes(32).toString('hex');
   const ready=await deps.invoke('auth.provisionPlatformSession',{secret,grantUpdatedAt:data.record.updatedAt},{actor:{userId:admin.id},timeoutMs:8000});
   if(!ready.success)return ready;
   const result=await deps.invoke('auth.login',{userId:ID,pin:secret},{timeoutMs:8000});
   if(result.success&&result.data?.session){
    const current=await context();
    if(started!==generation||!same(current,data.context)||record?.hash!==data.record.hash){await deps.logout();return deps.fail('E_UNAUTHORIZED','Giriş məlumatları dəyişdi. Yenidən daxil olun');}
    deps.authenticated(result.data.session);
   }
   return result;
 }
 async function login(pin){
  if(pendingLogin){if(pendingLogin.pin===pin)return pendingLogin.promise;await pendingLogin.promise.catch(()=>{});}
  const job={pin,promise:null};job.promise=performLogin(pin).finally(()=>{if(pendingLogin===job)pendingLogin=null;});pendingLogin=job;return job.promise;
 }
 return {
  accept,login,
  async prefix(digits){
   if(!/^\d{4}$/.test(String(digits)))return {extended:false};
   const data=await get();return {extended:Boolean(data.record&&deps.startsSuperAdmin(data.record,digits)),available:Boolean(data.record),length:10};
  },
  clear(){scope='';record=null;lastAttempt=0;generation++;},
 };
}
module.exports={createPlatformAuth};
