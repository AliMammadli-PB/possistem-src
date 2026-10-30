const {test}=require('node:test');const assert=require('node:assert/strict');const create=require('./access.cjs');
const at=1800000000000;function run({account,proof,remote,throwRemote=false}={}){return create({now:()=>at,owner:()=>account===null?null:{token:'token',customerId:'customer',...(account||{})},license:async()=>({success:true,data:{customerId:'customer',status:'active',expiresAt:at+100000,features:{billingManaged:true,billingStatus:'active'},...(proof||{})}}),status:async()=>{if(throwRemote)throw Error('offline');return remote||{ok:true,data:{paymentsAvailable:true,subscriptions:[{product:'restaurant',hasPaidSubscription:true,state:'active',paidUntil:new Date(at+100000).toISOString()}]}};}})(true)}
test('paid subscription permits UI and PIN; no owner permits neither',async()=>{assert.equal((await run()).loginAllowed,true);assert.equal((await run({account:null})).allowed,false)});
test('unpaid setup access cannot grant a PIN session',async()=>{const v=await run({remote:{ok:true,data:{enforcementEnabled:false,subscriptions:[{product:'restaurant',hasPaidSubscription:false,state:'active',paidUntil:new Date(at+100000).toISOString(),setupAccess:true}]}}});assert.equal(v.allowed,false);assert.equal(v.loginAllowed,false)});
test('paid account can activate a new till, but cannot use PIN without its license',async()=>{const v=await run({proof:{status:'unlicensed',expiresAt:0}});assert.equal(v.allowed,true);assert.equal(v.loginAllowed,false)});
test('expired or different customer license cannot grant PIN',async()=>{assert.equal((await run({proof:{expiresAt:at-1}})).loginAllowed,false);assert.equal((await run({proof:{customerId:'other'}})).loginAllowed,false)});
test('billing-only sign-in requires a fresh sign-in after successful payment',async()=>{const v=await run({account:{billingOnly:true}});assert.equal(v.allowed,false);assert.equal(v.paymentConfirmed,true)});
test('offline accepts only unexpired signed managed active billing proof',async()=>{assert.equal((await run({throwRemote:true})).loginAllowed,true);assert.equal((await run({throwRemote:true,proof:{expiresAt:at-1}})).allowed,false);assert.equal((await run({throwRemote:true,proof:{features:{billingManaged:true,billingStatus:'awaiting_payment'}}})).allowed,false)});
test('revoked server session does not fall back to a local paid license',async()=>{assert.equal((await run({remote:{ok:false,status:401}})).loginAllowed,false)});
test('a batch cannot bypass the PIN barrier',()=>{assert.equal(create.requiresPin('auth.login'),true);assert.equal(create.requiresPin('core.batch',{calls:[{method:'core.batch',payload:{calls:[{method:'auth.login'}]}}]}),true);assert.equal(create.requiresPin('core.batch',{calls:[{method:'license.status'}]}),false)});

test('administrator free access is valid without a bank payment and stays product scoped',async()=>{
 const proof={customerId:'owner',status:'active',expiresAt:Date.now()+60000,features:{billingManaged:true,billingStatus:'active',product:'restaurant'}};
 const access=create({owner:()=>({token:'owner-token',customerId:'owner'}),license:async()=>({success:true,data:proof}),status:async()=>({ok:true,data:{subscriptions:[{product:'restaurant',hasAccess:true,accessStatus:'free',hasPaidSubscription:false}],productAssigned:true}})});
 assert.equal((await access(true)).loginAllowed,true);proof.features.product='market';assert.equal((await access(true)).loginAllowed,false);
});
test('a fresh check rereads the newly signed license after confirmation',async()=>{
 let proof={customerId:'owner',status:'expired',expiresAt:1,features:{billingManaged:true,billingStatus:'expired'}};
 const access=create({owner:()=>({token:'owner-token',customerId:'owner'}),license:async()=>({success:true,data:proof}),status:async verify=>{assert.equal(verify,true);proof={...proof,status:'active',expiresAt:Date.now()+60000,features:{billingManaged:true,billingStatus:'active'}};return {ok:true,data:{subscriptions:[{product:'restaurant',hasAccess:true,accessStatus:'trial'}],productAssigned:true}};}});
 assert.equal((await access(true,true)).loginAllowed,true);
});
test('a confirmed trial resumes the same billing-only account without re-entering a password',async()=>{
 let owner={token:'billing-token',customerId:'owner',billingOnly:true};
 const access=create({owner:()=>owner,license:async()=>({success:true,data:{customerId:'owner',status:'active',expiresAt:Date.now()+60000,features:{billingManaged:true,billingStatus:'active',product:'restaurant'}}}),status:async()=>{owner={...owner,token:'pos-token',billingOnly:false};return {ok:true,data:{subscriptions:[{product:'restaurant',hasAccess:true,accessStatus:'trial',accessUntil:new Date(Date.now()+60000).toISOString()}],sessionResumed:true}};}});
 const result=await access(true,true);assert.equal(result.allowed,true);assert.equal(result.loginAllowed,true);assert.equal(result.sessionResumed,true);
});
test('switching customer while a trial check is in flight never opens the former account',async()=>{
 let owner={token:'one',customerId:'one'};
 const access=create({owner:()=>owner,license:async()=>({success:true,data:{customerId:'one',status:'active',expiresAt:Date.now()+60000}}),status:async()=>{owner={token:'two',customerId:'two'};return {ok:true,data:{subscriptions:[{product:'restaurant',hasAccess:true,accessStatus:'trial'}]}};}});
 assert.equal((await access(true,true)).allowed,false);
});
test('cached access cannot extend a trial past its exact deadline',async()=>{
 let clock=at,calls=0;const end=at+1000;
 const access=create({now:()=>clock,owner:()=>({token:'one',customerId:'one'}),license:async()=>({success:true,data:{customerId:'one',status:'active',expiresAt:end,features:{billingManaged:true,billingStatus:'active'}}}),status:async()=>{calls++;return {ok:true,data:{subscriptions:[{product:'restaurant',hasAccess:clock<end,accessStatus:clock<end?'trial':'payment_required',accessUntil:new Date(end).toISOString()}]}};}});
 assert.equal((await access()).loginAllowed,true);clock=end;assert.equal((await access()).loginAllowed,false);assert.equal(calls,2);
});
