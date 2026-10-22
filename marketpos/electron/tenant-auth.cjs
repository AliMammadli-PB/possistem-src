'use strict';
async function tenantLogin({endpoint,email,password,hwid,fetchImpl=fetch}){
 email=String(email||'').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().toLowerCase();password=String(password||'');
 if(!email||!password)throw Error('E_TENANT_REQUIRED');
 let response;
 try{response=await fetchImpl(endpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({email,password,client:'pos',hwid,product:'market'}),signal:AbortSignal.timeout(20000)});}catch{throw Error('E_TENANT_NETWORK');}
 const payload=await response.json().catch(()=>null);
 if(!response.ok){
  if(response.status===401)throw Error('E_TENANT_CREDENTIALS');
  if(response.status===429)throw Error('E_TENANT_RATE_LIMIT');
  if(response.status>=500)throw Error('E_TENANT_SERVER');
  throw Error(payload?.error||payload?.message||'E_TENANT_SERVER');
 }
 if(!payload?.token||!payload?.customer?.id)throw Error('E_TENANT_RESPONSE');
 return payload;
}
module.exports={tenantLogin};
