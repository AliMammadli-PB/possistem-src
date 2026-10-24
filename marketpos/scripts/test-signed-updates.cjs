const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{verifyRelease,attach}=require('../electron/secure-updater.cjs'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519'),bytes=Buffer.from('installer fixture'),payload={app:'market',version:'1.5.70',file:'MarketPos-Setup-1.5.70.exe',sha512:crypto.createHash('sha512').update(bytes).digest('base64'),size:bytes.length};
const envelope=p=>({payload:p,signature:crypto.sign(null,Buffer.from(JSON.stringify(p)),privateKey).toString('base64')});const info={version:payload.version,files:[{url:payload.file,sha512:payload.sha512,size:payload.size}]};
test('only the pinned signing key can authorize the exact app, version and file',()=>{
 assert.equal(verifyRelease(info,envelope(payload),'market',publicKey).file,payload.file);
 assert.throws(()=>verifyRelease(info,envelope({...payload,app:'restaurant'}),'market',publicKey));
 assert.throws(()=>verifyRelease({...info,version:'9.9.9'},envelope(payload),'market',publicKey));
 assert.throws(()=>verifyRelease(info,{...envelope(payload),payload:{...payload,size:1}},'market',publicKey));
 assert.throws(()=>verifyRelease(info,envelope(payload),'market',crypto.generateKeyPairSync('ed25519').publicKey));
 assert.throws(()=>verifyRelease({...info,files:[{...info.files[0],url:'https://evil.invalid/'+payload.file}]},envelope(payload),'market',publicKey));
 assert.throws(()=>verifyRelease({...info,files:[{...info.files[0],size:1}]},envelope(payload),'market',publicKey));
});
test('installation is blocked until a signed download has passed a full file hash check',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'possistem-updater-')),file=path.join(dir,'installer.exe');fs.writeFileSync(file,bytes);let downloads=0,installs=0;const errors=[],u=new EventEmitter();u.downloadUpdate=async()=>{downloads++;u.emit('update-downloaded',{version:payload.version,downloadedFile:file});};u.quitAndInstall=()=>installs++;
 const previous=global.fetch;global.fetch=async()=>new Response(JSON.stringify(envelope(payload)));
 try{
  attach(u,{app:'market',feed:'https://possistem.az/marketpos/updates/',publicKey,onError:e=>errors.push(e.message)});
  u.autoDownload=true;u.autoInstallOnAppQuit=true;assert.equal(u.autoDownload,false);assert.equal(u.autoInstallOnAppQuit,false);assert.throws(()=>u.quitAndInstall());
  u.emit('update-available',info);for(let i=0;i<50&&downloads===0;i++)await new Promise(r=>setTimeout(r,5));await new Promise(r=>setTimeout(r,30));u.quitAndInstall();assert.equal(installs,1);assert.equal(downloads,1);assert.deepEqual(errors,[]);
  fs.writeFileSync(file,Buffer.alloc(bytes.length));u.emit('update-downloaded',{version:payload.version,downloadedFile:file});await new Promise(r=>setTimeout(r,30));assert.throws(()=>u.quitAndInstall());assert.equal(errors.length,1);
 }finally{global.fetch=previous;fs.rmSync(dir,{recursive:true,force:true});}
});

test('IPC collection and nesting limits reject oversized work before dispatch',()=>{const {withinBudget,install}=require('../electron/ipc-budget.cjs');assert.equal(withinBudget({items:[1,2,3]}),true);assert.equal(withinBudget({items:Array(5001).fill(null)}),false);let deep=null;for(let i=0;i<40;i++)deep={next:deep};assert.equal(withinBudget(deep),false);let handler,calls=0;const ipc={handle:(_name,h)=>{handler=h;}};install(ipc);ipc.handle('write',()=>calls++);assert.throws(()=>handler({},Array(5001)));assert.equal(calls,0);handler({},{ok:true});assert.equal(calls,1);});
