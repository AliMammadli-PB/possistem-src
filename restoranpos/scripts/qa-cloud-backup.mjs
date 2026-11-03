// The real packaged core under Wine: a till takes a cloud snapshot, the server checks it, and a new computer restores it.
// A till that dies is the whole point, so the second core is another computer with its own licence.
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),req=createRequire(import.meta.url),format=req(root+'/out/main/cloud-backup-format.cjs'),client=req(root+'/out/main/cloud-backup-client.cjs');
const coreExe=path.join(root,'native/build/restaurant-pos-core.exe'),work=fs.mkdtempSync(path.join(os.tmpdir(),'pos-cloud-')),z=p=>'Z:'+p.replaceAll('/','\\');
function start(dir){fs.mkdirSync(dir+'/logs',{recursive:true});const c=spawn('wine',[coreExe,'--db',z(dir+'/pos.db'),'--log-dir',z(dir+'/logs'),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all'}});let b='',ready;const waiting=new Map(),isReady=new Promise(r=>{ready=r});c.stderr.on('data',()=>{});c.stdout.on('data',d=>{b+=d;let i;while((i=b.indexOf('\n'))>=0){const l=b.slice(0,i).replace(/\r$/,'');b=b.slice(i+1);try{const m=JSON.parse(l);if(m.event==='core.ready')ready();if(m.requestId&&waiting.has(m.requestId)){waiting.get(m.requestId)(m);waiting.delete(m.requestId)}}catch{}}});
 return{ready:isReady,call:(method,payload={})=>new Promise(r=>{const requestId=randomUUID();waiting.set(requestId,r);c.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),payload,actor:{userId:'usr-admin'}})+'\n')}),stop:()=>new Promise(r=>{c.on('close',r);c.stdin.end()})}}
const must=r=>{assert.equal(r.success,true,JSON.stringify(r.error));return r.data};
const dirA=work+'/dead-pc',dirB=work+'/new-pc';fs.mkdirSync(dirA);fs.mkdirSync(dirB);
const seed=async(dir,sql)=>{const c=start(dir);await c.ready;await c.stop();const d=new DatabaseSync(dir+'/pos.db');d.exec(sql);d.close()};
const one=(dir,sql)=>{const d=new DatabaseSync(dir+'/pos.db');const row=d.prepare(sql).get();d.close();return row};
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),image=format.sha(pixel)+'.png';
const license=id=>`INSERT OR REPLACE INTO license_state(id,status,device_id,installation_id,customer_id,updated_at) VALUES('local','active','${id}','${id}','cust-1',1);INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('device.installationId','${id}',1);`;
try{
 const dish=`INSERT INTO menu_categories(id,name_az,name_tr,name_en) VALUES('qa-cat','Yemək','Yemek','Food');INSERT INTO menu_items(id,sku,created_at,updated_at,category_id,name_az,name_tr,name_en,price_minor,image) VALUES('qa-dish','QA-1',1,1,'qa-cat','Dönər','Dönər','Doner',500,'app://local/user-assets/${image}');`;
 await seed(dirA,license('dead-pc')+dish+`INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('qa-marker','pizza-home',1);`);
 const assets=dirA+'/catalog-assets';fs.mkdirSync(assets);fs.writeFileSync(path.join(assets,image),pixel);
 let core=start(dirA);await core.ready;
 const snapshot=must(await core.call('backup.cloudSnapshot'));const listed=must(await core.call('backup.list')).backups.length;
 const file=client.localPath(snapshot.path);assert.ok(fs.existsSync(file),'the Windows path the core gives back maps to a file');
 const bundle=await format.make(file,assets,{customerId:'cust-1',deviceId:'dead-pc',appVersion:'qa'});
 const decoded=await format.decode(bundle),checked=path.join(work,'server-check.db');fs.writeFileSync(checked,decoded.database);
 const info=await format.verifyDatabase(checked,decoded.assets.map(a=>a.name));
 assert.ok(info.schemaVersion>=66,'schema '+info.schemaVersion);assert.equal(info.missingAssets,0);assert.equal(info.tables.menu_items>=1,true);
 assert.equal((await format.verifyDatabase(checked,[])).missingAssets,1,'the real schema names the picture the server would miss');
 assert.equal(must(await core.call('backup.list')).backups.length,listed,'a snapshot is no entry in the owner\'s backup list');
 await core.stop();

 await seed(dirB,license('new-pc'));
 const assetsB=dirB+'/catalog-assets',from=path.join(work,'download.posbackup'),dest=dirB+'/backups/pos-usb-1.db';fs.writeFileSync(from,bundle);fs.mkdirSync(dirB+'/backups',{recursive:true});
 await client.importBundle(from,dest,assetsB,'cust-1');
 core=start(dirB);await core.ready;
 const imported=must(await core.call('backup.import',{path:z(dest)}));
 assert.equal(must(await core.call('backup.restorePreview',{backupId:imported.id})).fileExists,true);
 const restored=must(await core.call('backup.restore',{backupId:imported.id}));assert.equal(restored.restored,true);await core.stop();
 core=start(dirB);await core.ready;must(await core.call('license.status'));await core.stop();
 assert.equal(one(dirB,`SELECT value FROM app_settings WHERE key='qa-marker'`).value,'pizza-home','the shop\'s data came across');
 assert.equal(one(dirB,`SELECT image FROM menu_items WHERE id='qa-dish'`).image,'app://local/user-assets/'+image);assert.ok(fs.existsSync(path.join(assetsB,image)),'and its picture');
 assert.equal(one(dirB,`SELECT device_id AS v FROM license_state WHERE id='local'`).v,'new-pc','the new computer keeps its own licence');
 assert.equal(one(dirB,`SELECT value AS v FROM app_settings WHERE key='device.installationId'`).v,'new-pc');
 assert.deepEqual(fs.readdirSync(dirB).filter(n=>n.includes('-restore-')),[]);
 console.log('PASS real core: snapshot on real schema '+info.schemaVersion+', '+JSON.stringify(info.tables));
 console.log('PASS real core: restored on another computer, core starts again, data and picture present, its own licence kept');
}finally{fs.rmSync(work,{recursive:true,force:true})}
