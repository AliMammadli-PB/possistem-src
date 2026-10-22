'use strict';
const {randomUUID}=require('node:crypto');
const METHODS=require('./cloud-branches-methods.json');
const {project}=require('./branch-presence.cjs');
const READ=['context','documents','document.get','staff','branch.summary','transfer.list','transfer.get','waste.list','waste.get'];
const WRITE=['correct','delivery.update','staff.save','staff.link','catalog.publish','transfer.save','transfer.dispatch','transfer.receive','transfer.returnConfirm','transfer.cancel','transfer.reverse','transfer.recall','transfer.revoke','transfer.sync','waste.save','waste.delete'];
function kind(call){if(call?.method==='business.call')return READ.includes(call.payload?.action)?'r':WRITE.includes(call.payload?.action)?'w':null;if(call?.method==='settings.set'&&call.payload?.key!=='costing.resetAt')return null;return METHODS[call?.method]||null;}
function createCloudBranches({credentials,fetchImpl=fetch}){
 const pendingWrites=new Map();
 async function request(path,body){const c=await credentials();if(!c?.token||!c?.deviceId)throw Error('Sahibkar hesabına yenidən daxil olun');const url=new URL(c.baseUrl.replace(/\/$/,'')+path);if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost')throw Error('Təhlükəsiz server bağlantısı tələb olunur');
 let response;
 try{response=await fetchImpl(url,{method:body?'POST':'GET',headers:{accept:'application/json',authorization:'Bearer '+c.token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify({...body,sourceDeviceId:c.deviceId})}:{}),signal:AbortSignal.timeout(body?45000:10000)});}
 catch(cause){const error=Error(cause?.name==='TimeoutError'||cause?.name==='AbortError'?'Filial serverindən vaxtında cavab alınmadı. İnternet bağlantısını yoxlayın.':'Filial serverinə qoşulmaq olmadı. İnternet bağlantısını yoxlayın.');error.cause=cause;error.uncertain=Boolean(body);throw error;}
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data||typeof data!=='object'){
  const raw=typeof data?.error==='string'?data.error:'';
  const generic=!raw||/internal server error|bad gateway|service unavailable|gateway timeout/i.test(raw);
  const error=Error(generic?(response.status===401?'Sahibkar hesabına yenidən daxil olun.':'Filial xidməti hazırda cavab vermir. Bir qədər sonra məlumatları yeniləyin.'):raw);
  error.statusCode=response.ok?502:response.status;error.code=data?.code;error.uncertain=Boolean(data?.uncertain)||error.statusCode>=500;throw error;
 }
 return data;}
 return {manage:async(input)=>request('/tenant/pos/branches/objects',input),assign:async(deviceId,choice)=>request("/tenant/pos/branches/location",{deviceId,...(typeof choice==="string"?{name:choice}:{branchId:choice?.branchId})}),list:async()=>{const c=await credentials();return project(await request('/tenant/pos/branches?sourceDeviceId='+encodeURIComponent(c.deviceId)));},rpc:async(deviceId,calls)=>{if(!/^[0-9a-f-]{36}$/i.test(deviceId)||!Array.isArray(calls)||!calls.length||calls.length>16||calls.some(c=>!kind(c)))throw Error('Filial əməliyyatı düzgün deyil');const source=await credentials(),write=calls.some(c=>kind(c)==='w');
 const fingerprint=JSON.stringify([source.deviceId,deviceId,calls.map(c=>({method:c.method,payload:c.payload||{}}))]);
 const now=Date.now();for(const [k,v] of pendingWrites)if(now-v.at>300000)pendingWrites.delete(k);
 let operation=write?pendingWrites.get(fingerprint):null;if(!operation)operation={requestId:randomUUID(),calls,at:now};
 if(write){if(pendingWrites.size>100)pendingWrites.delete(pendingWrites.keys().next().value);pendingWrites.set(fingerprint,operation);}
 try{const result=await request('/tenant/pos/branches/rpc',{deviceId,calls:operation.calls,requestId:operation.requestId});pendingWrites.delete(fingerprint);return result;}
 catch(error){if(!error.uncertain&&error.statusCode>0&&error.statusCode<500)pendingWrites.delete(fingerprint);throw error;}
}};
}
module.exports={createCloudBranches,kind,METHODS};
