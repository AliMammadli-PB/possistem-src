'use strict';
module.exports=function createAccess({owner,license,status,now=Date.now}){
 let cached=null;
 return async function access(fresh=false,verifyPayment=false){
  let account=owner();if(!account?.token)return {authenticated:false,allowed:false,loginAllowed:false};
  if(!fresh&&!verifyPayment&&cached?.token===account.token&&cached.until>now())return cached.value;
  let local=await license(),proof=local?.success?local.data:null;
  const valid=()=>proof?.customerId===account.customerId&&proof?.status==='active'&&Number(proof.expiresAt)>now()&&(!(proof.features?.vertical||proof.features?.product)|| (proof.features?.vertical||proof.features?.product)==='restaurant');
  let value;
  try{
   const remote=await status(verifyPayment);if(!remote.ok){if(remote.status===401||remote.status===403){cached=null;return {authenticated:false,allowed:false,loginAllowed:false,reason:'session'};}throw Error('unavailable');}
   if(fresh){local=await license();proof=local?.success?local.data:null;}
   const latest=owner();if(!latest?.token||latest.customerId!==account.customerId){cached=null;return {authenticated:false,allowed:false,loginAllowed:false,reason:'session'};}account=latest;
   const data=remote.data,sub=data.subscriptions?.find(s=>s.product==='restaurant');
   const paid=!!sub?.hasPaidSubscription&&sub.state==='active'&&Date.parse(sub.paidUntil)>now();
   const access=sub?.hasAccess??paid;
   const legacy=!sub&&data.productAssigned&&valid()&&proof.features?.billingManaged!==true;
   const granted=!!access||!!legacy;
   value={authenticated:true,allowed:granted&&!account.billingOnly,loginAllowed:granted&&!account.billingOnly&&valid(),subscription:sub||null,paymentsAvailable:!!data.paymentsAvailable,paymentConfirmed:granted&&!!account.billingOnly,accessStatus:sub?.accessStatus,availableProducts:data.availableProducts||[],checkedAt:data.checkedAt,sessionResumed:!!data.sessionResumed,resumeError:data.resumeError||null,accountEmail:account.email||null,reason:granted?'':data.productAssigned===false?'product_not_assigned':'payment'};
  }catch{
   const offline=valid()&&proof.features?.billingManaged===true&&proof.features?.billingStatus==='active';
   value={authenticated:true,allowed:offline&&!account.billingOnly,loginAllowed:offline&&!account.billingOnly,offline:true,reason:offline?'':'connection'};
  }
  const deadlines=[now()+10000];if(value.allowed||value.loginAllowed){const end=Date.parse(value.subscription?.accessUntil||'');if(Number.isFinite(end))deadlines.push(end);if(Number(proof?.expiresAt)>0)deadlines.push(Number(proof.expiresAt));}cached={token:account.token,until:Math.min(...deadlines),value};return value;
 };
};
module.exports.requiresPin=function requiresPin(method,payload={},depth=0){
 if(['auth.login','auth.provisionPlatformSession','auth.adminPrefix'].includes(method))return true;
 if(method!=='core.batch')return false;
 if(depth>=8)return true;
 return Array.isArray(payload.calls)&&payload.calls.some(c=>requiresPin(c?.method,c?.payload||{},depth+1));
};
