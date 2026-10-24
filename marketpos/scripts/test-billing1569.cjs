const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const policy=require('../electron/billing.cjs');
test('strict expiry and unknown mutations refuse while reads and exports remain open',()=>{
 const activation={mode:'active',validUntil:Date.now()-1};
 for(const method of ['sale.complete','cart.sync','product.update','inventory.adjust','payments.createCard','unknown.write'])assert.equal(policy.canInvoke(activation,method,{}),false,method);
 for(const method of ['state.get','product.list','sales.list','reports.profit','files.saveText'])assert.equal(policy.canInvoke(activation,method,{}),true,method);
 assert.equal(policy.canInvoke({...activation,validUntil:Date.now()+10000},'sale.complete',{}),true);
 assert.equal(policy.canInvoke(activation,'business.call',{action:'transfer.create'}),false);
 assert.equal(policy.canInvoke(activation,'core.batch',{calls:[{method:'sale.complete'}]}),false);
});
test('real sidecar transport refuses an expired direct IPC before it writes',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../electron/core-supervisor.cjs'),'utf8');
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='electron'?{app:{}}:require(name),process,Buffer,console,setTimeout,clearTimeout});
 const core=new module.exports.CoreSupervisor({canInvoke:(m,p)=>policy.canInvoke({mode:'expired',validUntil:1},m,p)});
 let wrote=0;core.state='ready';core.child={stdin:{writable:true,write(){wrote++;}}};
 const result=await core.invoke('sale.complete',{});assert.equal(result.error.code,'E_SUBSCRIPTION_EXPIRED');assert.equal(wrote,0);
});
test('payment handoff cannot open arbitrary external URLs',()=>{
 assert.match(policy.paymentUrl('https://possistem.az/odenis/davam?handoff=abc'),/^https:/);
 for(const url of ['http://possistem.az/odenis/','https://evil.invalid/odenis/','file:///tmp/a','https://possistem.az.attacker.tld/odenis/','https://possistem.az/pos/app'])assert.throws(()=>policy.paymentUrl(url));
});
