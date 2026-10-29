'use strict';
// Authoritative at the main boundary; renderer flags never grant PIN access.
module.exports=function createAccess({owner,license,status,now=Date.now}){
 let cached=null;
 return async function access(fresh=false){
  const account=owner();if(!account?.token)return {authenticated:false,allowed:false,loginAllowed:false};
  if(!fresh&&cached?.token===account.token&&cached.until>now())return cached.value;
  const local=await license();const proof=local?.success?local.data:null;
  const valid=proof?.customerId===account.customerId&&proof?.status==='active'&&Number(proof.expiresAt)>now();
  const offlinePaid=valid&&proof.features?.billingManaged===true&&proof.features?.billingStatus==='active';
  let value;
  try{
   const remote=await status();if(!remote.ok){if(remote.status===401||remote.status===403)return {authenticated:true,allowed:false,loginAllowed:false,reason:'session'};throw Error('unavailable');}
   const data=remote.data,sub=data.subscriptions?.find(s=>s.product==='restaurant');
   const paid=!!sub?.hasPaidSubscription&&sub.state==='active'&&Date.parse(sub.paidUntil)>now();
   value={authenticated:true,allowed:paid&&!account.billingOnly,loginAllowed:paid&&!account.billingOnly&&valid,subscription:sub||null,paymentsAvailable:!!data.paymentsAvailable,paymentConfirmed:paid&&!!account.billingOnly,reason:paid?'':'payment'};
  }catch{
   value={authenticated:true,allowed:offlinePaid&&!account.billingOnly,loginAllowed:offlinePaid&&!account.billingOnly,offline:true,reason:offlinePaid?'':'connection'};
  }
  cached={token:account.token,until:now()+10000,value};return value;
 };
};
// Apply the same login barrier to nested batches; a renderer cannot bypass the
// normal login dispatcher by wrapping auth.login in core.batch.
module.exports.requiresPin=function requiresPin(method,payload={},depth=0){
 if(['auth.login','auth.provisionPlatformSession','auth.adminPrefix'].includes(method))return true;
 if(method!=='core.batch')return false;
 if(depth>=8)return true;
 return Array.isArray(payload.calls)&&payload.calls.some(c=>requiresPin(c?.method,c?.payload||{},depth+1));
};
