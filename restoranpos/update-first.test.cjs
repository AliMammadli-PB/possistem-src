const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create,CHECK_MS,STALL_MS,TOTAL_MS,RECHECK_MS,INSTALL_WAIT_MS,MAX_TRIES}=require('./update-first.cjs');
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};

function setup(t,{installResult={success:true}}={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'update-first-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const x={started:0,installs:0,checks:0,shown:[],closed:0,statePath:path.join(dir,'state.json')};
 const gate=create({
  subscribe:fn=>{x.emit=fn;},check:async()=>{x.checks+=1;},install:async()=>{x.installs+=1;return installResult;},startCore:()=>{x.started+=1;},
  progress:{show:p=>x.shown.push(p),close:()=>{x.closed+=1;}},statePath:x.statePath,log:{info(){},warn(){}},
 });
 gate.begin();x.gate=gate;return x;
}

test('no update, no network or an unconfigured feed start the core at once, exactly once',t=>{
 for(const state of ['not_available','not_configured','error']){
  const x=setup(t);x.emit({state});x.emit({state});assert.equal(x.started,1,state);assert.equal(x.installs,0);t.mock.timers.reset();
 }
});

test('a feed that never answers does not hold the till',t=>{
 const x=setup(t);x.emit({state:'checking'});t.mock.timers.tick(CHECK_MS-1);assert.equal(x.started,0);t.mock.timers.tick(1);assert.equal(x.started,1);
});

test('a new version installs before the core ever starts',async t=>{
 const x=setup(t);x.emit({state:'checking'});x.emit({state:'available',version:'9.9.9'});x.emit({state:'downloading',percent:40});
 t.mock.timers.tick(CHECK_MS*2);assert.equal(x.started,0);assert.deepEqual(x.shown,[0,40]);
 x.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(x.installs,1);assert.equal(x.started,0);
});

test('a stalled or very slow download gives the till back; it then installs on close, not mid-service',async t=>{
 const stalled=setup(t);stalled.emit({state:'available',version:'9.9.9'});t.mock.timers.tick(STALL_MS);assert.equal(stalled.started,1);assert.equal(stalled.closed,1);
 stalled.emit({state:'downloading',percent:90});stalled.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(stalled.installs,0);assert.deepEqual(stalled.shown,[0]);
 t.mock.timers.reset();
 const slow=setup(t);slow.emit({state:'available',version:'9.9.9'});for(let at=0;at<TOTAL_MS;at+=STALL_MS/2){slow.emit({state:'downloading',percent:1});t.mock.timers.tick(STALL_MS/2);}assert.equal(slow.started,1);
});

test('a failed or silent install still opens the till',async t=>{
 const failed=setup(t,{installResult:{success:false,error:{message:'x'}}});failed.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(failed.started,1);
 t.mock.timers.reset();
 const silent=setup(t);silent.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(silent.started,0);t.mock.timers.tick(INSTALL_WAIT_MS);assert.equal(silent.started,1);
});

test('an install that keeps failing cannot trap the till in a loop of restarts',async t=>{
 const x=setup(t);fs.writeFileSync(x.statePath,JSON.stringify({version:'9.9.9',tries:MAX_TRIES}));
 x.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(x.installs,0);assert.equal(x.started,1);
 t.mock.timers.reset();
 const newer=setup(t);fs.writeFileSync(newer.statePath,JSON.stringify({version:'9.9.9',tries:MAX_TRIES}));
 newer.emit({state:'downloaded',version:'9.9.10'});await flush();assert.equal(newer.installs,1);assert.equal(JSON.parse(fs.readFileSync(newer.statePath,'utf8')).tries,1);
});

test('a broken core keeps asking the feed and installs the fix by itself',async t=>{
 const x=setup(t);x.emit({state:'not_available'});assert.equal(x.started,1);
 x.gate.coreStatus('crash_loop');assert.equal(x.checks,1);t.mock.timers.tick(RECHECK_MS);assert.equal(x.checks,2);
 x.emit({state:'available',version:'9.9.9'});x.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(x.installs,1);assert.equal(x.started,1);
});

test('a working till is not interrupted by an update, and recovery stops the extra checks',async t=>{
 const x=setup(t);x.emit({state:'not_available'});x.gate.coreStatus('ready');
 x.emit({state:'downloaded',version:'9.9.9'});await flush();assert.equal(x.installs,0);
 x.gate.coreStatus('crash_loop');x.gate.coreStatus('ready');const checks=x.checks;t.mock.timers.tick(RECHECK_MS*3);assert.equal(x.checks,checks);
});
