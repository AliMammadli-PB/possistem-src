const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'out/main/index.js'),'utf8'),ast=ts.createSourceFile('main.js',source,ts.ScriptTarget.Latest,true);
function fn(name){const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(n,name+' exists in assembled runtime');return n.getText(ast);}
function runtime(wrongCustomer=false){
 let owner={token:'billing-token',customerId:'one',billingOnly:true,email:'fixture@example.invalid'},proof={customerId:'one',status:'expired',expiresAt:1,features:{billingManaged:true,billingStatus:'expired',product:'restaurant'}};const calls=[];
 const data={subscriptions:[{product:'restaurant',hasAccess:true,accessStatus:'trial',accessUntil:new Date(Date.now()+60000).toISOString()}],licenseRefresh:{verifiedFixture:true}};
 const context=vm.createContext({require:n=>n==='./subscription-access.cjs'?require('../subscription/access.cjs'):{now:Date.now},ft:()=>owner,ue:o=>{owner=o;},G:async()=>({success:true,data:proof}),J:async()=>({deviceId:'device-one',fingerprint:'device-fingerprint'}),Zt:()=> 'hardware-one',te:()=> 'https://fixture.invalid',_psApplyLicenseRefresh:async()=>{proof={...proof,status:'active',expiresAt:Date.now()+60000,features:{...proof.features,billingStatus:'active'}};},de:async(_base,url,body,token)=>{calls.push({url,body,token});if(url==='/tenant/resume')return {ok:true,data:{token:'pos-token',expiresAt:Date.now()+60000,billingOnly:false,customer:{id:wrongCustomer?'two':'one'},licenses:[]}};return {ok:true,data};}});
 vm.runInContext('let _psSubscriptionAccessInstance;'+fn('_psSubscriptionAccess'),context);
 return {check:()=>context._psSubscriptionAccess(true,true),owner:()=>owner,calls};
}
test('assembled runtime resumes a granted billing session, imports its lease and requests a UI reload once',async()=>{
 const r=runtime(),first=await r.check();assert.equal(first.allowed,true);assert.equal(first.loginAllowed,true);assert.equal(first.sessionResumed,true);assert.equal(r.owner().token,'pos-token');assert.equal(r.calls.filter(c=>c.url==='/tenant/resume').length,1);assert.equal(r.calls.at(-1).token,'pos-token');assert.equal(r.calls.at(-1).body.deviceId,'device-one');
 const second=await r.check();assert.equal(second.sessionResumed,false);assert.equal(r.calls.filter(c=>c.url==='/tenant/resume').length,1);
});
test('assembled runtime never saves a resumed token belonging to another customer',async()=>{const r=runtime(true),state=await r.check();assert.equal(state.allowed,false);assert.equal(r.owner().token,'billing-token');});
test('the actual login transport forwards the POS product alongside email, password and hardware',async()=>{
 let payload;const context=vm.createContext({K:{info(){}},Re:async(_base,_url,p)=>{payload=p;return {ok:true}}});vm.runInContext(fn('os'),context);await context.os('https://fixture.invalid',{email:'fixture@example.invalid',password:'fixture-password',hwid:'hardware',product:'restaurant'});assert.equal(payload.product,'restaurant');assert.equal(payload.hwid,'hardware');
});
