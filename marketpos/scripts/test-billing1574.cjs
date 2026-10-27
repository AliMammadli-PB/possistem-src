// 1.5.74: an expired till can still close its shift and fiscalise past sales; setting the PC clock back does not reopen sales.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const fresh=()=>{const file=path.join(__dirname,'../electron/billing.cjs');delete require.cache[require.resolve(file)];return require(file);};
const D=86400000;

test('after expiry the shift closes and receipts fiscalise, but nothing new is sold',()=>{
 const policy=fresh(),ended={mode:'active',validUntil:Date.now()-60000};
 for(const m of ['cash.currentSession','cash.listRegisters','cash.closeSession','cash.zClose','reports.z','businessDay.close','fiscal.enqueue','fiscal.listPending','fiscal.updateStatus','fiscal.retry','product.list','cash.xReport'])assert.equal(policy.canInvoke(ended,m,{}),true,m);
 for(const m of ['sale.complete','sale.refund','return.create','cash.openSession','cash.cashIn','cash.cashOut','product.upsert','purchase.receive'])assert.equal(policy.canInvoke(ended,m,{}),false,m);
 assert.equal(policy.canInvoke(ended,'core.batch',{calls:[{method:'cash.zClose'},{method:'cash.closeSession'}]}),true);
 assert.equal(policy.canInvoke(ended,'core.batch',{calls:[{method:'cash.zClose'},{method:'sale.complete'}]}),false);
});

test('setting the clock back does not stretch the paid period',()=>{
 const policy=fresh(),real=Date.now,start=policy.now(),validUntil=start-60000;
 try{
  Date.now=()=>real()-40*D;
  assert.ok(policy.now()>=start);
  assert.equal(policy.paid({mode:'active',validUntil}),false);
  assert.equal(policy.canInvoke({mode:'active',validUntil},'sale.complete',{}),false);
  // Time still moves on while the clock is held back.
  const t=policy.now();const until=real()+30;while(real()<until){/* spin */}
  assert.ok(policy.now()>t);
 }finally{Date.now=real;}
});

test('the latest moment survives a restart and the server clock corrects it',()=>{
 const real=Date.now,saved=[];let policy=fresh();
 policy.bindClock({read:()=>real()+5*D,write:(v)=>saved.push(v)});
 assert.ok(policy.now()>=real()+5*D,'a restart keeps the moment seen before it');
 try{Date.now=()=>real()+6*D;policy.now();}finally{Date.now=real;}
 assert.ok(saved.length>=1&&saved.at(-1)>=real()+6*D-1000,'written at most a minute behind');
 policy.observeServerTime(new Date(real()).toUTCString());
 assert.ok(Math.abs(policy.lastSeen()-real())<2000,'the server time replaces a clock that ran ahead');
 assert.equal(policy.paid({mode:'active',validUntil:real()+D}),true);
 policy=fresh();policy.observeServerTime('not a date');assert.ok(policy.lastSeen()<=real()+1000);
});
