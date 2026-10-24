'use strict';
const assert=require('node:assert/strict');const {randomBytes,generateKeyPairSync,sign,scryptSync}=require('node:crypto');
const {createPlatformAuth}=require('../auth/platform-superadmin.cjs');const proof=require('../../marketpos/electron/superadmin.cjs');
const keys=generateKeyPairSync('ed25519'),publicKeyHex=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
const pin='1234569870',ctx={customerId:'owner-a',deviceId:'till-a'};
function grant(code=pin,context=ctx,updatedAt=1000){
 const salt=randomBytes(16).toString('hex'),prefixSalt=randomBytes(16).toString('hex');
 const kdf=N=>({N,r:8,p:1,maxmem:256*1024*1024});
 const payload={type:'possistem-superadmin',...context,issuedAt:Date.now(),kdf:'scrypt',N:131072,r:8,p:1,prefixN:16384,salt,prefixSalt,
 hash:scryptSync(code,Buffer.from(salt,'hex'),32,kdf(131072)).toString('hex'),prefixHash:scryptSync(code.slice(0,4),Buffer.from(prefixSalt,'hex'),32,kdf(16384)).toString('hex'),updatedAt};
 return {payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),keys.privateKey).toString('hex')};
}
const signed=grant();
function harness(options={}){
 let current={...ctx},saved=options.saved||null,value=signed,offline=false,session=null;const calls=[];let reads=0,logouts=0,logins=0;
 const deps={...proof,keys:()=>[publicKeyHex],context:async()=>current,load:async()=>saved,save:async(_,v)=>{saved=v;},
 fetch:async()=>{reads++;await new Promise(r=>setTimeout(r,20));if(offline)throw Error('network');return value;},
 session:()=>session,logout:async()=>{logouts++;session=null;},authenticated:s=>{session=s;logins++;},fail:(code,message)=>({success:false,error:{code,message}}),
 invoke:async(method,payload,opts)=>{calls.push({method,payload,opts});if(method==='auth.listUsers')return {success:true,data:{users:[{id:'usr-admin',role:'administrator'}]}};
 if(method==='auth.provisionPlatformSession'){assert.equal(opts.actor.userId,'usr-admin');assert.match(payload.secret,/^[a-f0-9]{64}$/);return {success:true,data:{ok:true}};}
 assert.equal(method,'auth.login');assert.equal(payload.userId,'possistem-admin');return {success:true,data:{session:{userId:'possistem-admin',superAdmin:true,role:'administrator'}}};}};
 return {auth:createPlatformAuth(deps),calls,deps,setContext:c=>{current=c;},setValue:v=>{value=v;},offline:()=>{offline=true;},stats:()=>({reads,logouts,logins}),session:()=>session};
}
(async()=>{
 const x=harness();const prefixes=await Promise.all([x.auth.prefix('1234'),x.auth.prefix('1234')]);assert.ok(prefixes.every(p=>p.extended));assert.equal(x.stats().reads,1);
 assert.equal((await x.auth.prefix('1235')).extended,false);assert.equal(await x.auth.login('1234569871'),null);assert.equal(x.calls.length,0);
 const login=await Promise.all([x.auth.login(pin),x.auth.login(pin)]);assert.ok(login.every(r=>r.success));assert.equal(x.stats().logins,1);assert.equal(x.calls.filter(c=>c.method==='auth.provisionPlatformSession').length,1);
 assert.ok(!JSON.stringify(x.calls).includes(pin),'Website PIN must not reach native RPC');
 const rotated=grant('1234569872',ctx,2000);await x.auth.accept(rotated,ctx);assert.equal(x.stats().logouts,1);assert.equal(await x.auth.login(pin),null);assert.equal((await x.auth.login('1234569872')).success,true);
 await x.auth.accept(null,ctx);assert.equal(x.stats().logouts,2);assert.equal((await x.auth.login('1234569872')).error.code,'E_PLATFORM_PIN_UNAVAILABLE');
 const cached=harness({saved:signed});cached.offline();assert.equal((await cached.auth.prefix('1234')).extended,true);assert.equal((await cached.auth.login(pin)).success,true);
 const empty=harness();empty.offline();assert.equal((await empty.auth.login(pin)).error.code,'E_PLATFORM_PIN_UNAVAILABLE');assert.equal(empty.calls.length,0);
 for(const blob of [{...signed,signature:'00'.repeat(64)},{...signed,payload:{...signed.payload,deviceId:'foreign'}},{...signed,payload:{...signed.payload,customerId:'foreign'}}]){
  const bad=harness({saved:blob});bad.offline();assert.equal((await bad.auth.prefix('1234')).extended,false);assert.equal((await bad.auth.login(pin)).error.code,'E_PLATFORM_PIN_UNAVAILABLE');
 }
 const foreign=harness({saved:signed});foreign.setContext({customerId:'owner-b',deviceId:'till-b'});foreign.offline();assert.equal((await foreign.auth.prefix('1234')).extended,false);
 const stale=harness({saved:rotated});stale.offline();assert.equal(await stale.auth.accept(signed,ctx),false);assert.equal((await stale.auth.login('1234569872')).success,true);
 const changed=harness();let unblock;const response=new Promise(r=>{unblock=r;});changed.deps.fetch=()=>response;
 const pending=changed.auth.prefix('1234');await new Promise(r=>setTimeout(r,10));changed.setContext({customerId:'owner-b',deviceId:'till-b'});unblock(signed);assert.equal((await pending).extended,false);assert.equal(changed.calls.length,0);
 console.log('PASS signed platform PIN: 4-digit prefix, full 10-digit check, signature/owner/device isolation, concurrent fetch/login dedup, no native plaintext PIN, rotation/revocation, verified offline cache, rollback and late account change');
})().catch(e=>{console.error(e);process.exitCode=1;});
