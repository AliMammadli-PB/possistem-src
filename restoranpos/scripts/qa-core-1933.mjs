// Real packaged core over its stdio protocol, on databases as tills really have them.
//   node scripts/qa-core-1933.mjs <restaurant-pos-core.exe>
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {randomUUID} from 'node:crypto';import {fileURLToPath} from 'node:url';
const core=path.resolve(process.argv[2]),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8',maxBuffer:1e9});
const z=p=>'Z:'+p.replaceAll('/','\\');
function start(dir){const logs=path.join(dir,'logs');fs.mkdirSync(logs,{recursive:true});const c=spawn('wine',[core,'--db',z(path.join(dir,'pos.db')),'--log-dir',z(logs),'--protocol','1'],{stdio:['pipe','pipe','pipe'],env:{...process.env,WINEDEBUG:'-all'}});let b='',ready,fail,err='';const waiting=new Map();const isReady=new Promise((r,x)=>{ready=r;fail=x});c.stderr.on('data',d=>err+=d);c.on('close',code=>fail(new Error('core exited '+code+': '+err.split('\n').filter(l=>/FATAL/.test(l)).join(' '))));c.stdout.on('data',d=>{b+=d;let i;while((i=b.indexOf('\n'))>=0){const l=b.slice(0,i).replace(/\r$/,'');b=b.slice(i+1);try{const m=JSON.parse(l);if(m.event==='core.ready')ready();if(m.requestId&&waiting.has(m.requestId)){waiting.get(m.requestId)(m);waiting.delete(m.requestId)}}catch{}}});
 return{ready:isReady,call:(method,payload={})=>new Promise(r=>{const requestId=randomUUID();waiting.set(requestId,r);c.stdin.write(JSON.stringify({requestId,method,protocolVersion:1,timestamp:Date.now(),payload})+'\n')}),stop:()=>new Promise(r=>{c.removeAllListeners('close');c.on('close',r);c.stdin.end()})}}
function fromCommit(dir,commit){const names=git('ls-tree','--name-only',commit,'restoranpos/database/migrations/').trim().split('\n');const db=new DatabaseSync(path.join(dir,'pos.db'));db.exec('CREATE TABLE database_migrations (version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)');for(const f of names){const v=parseInt(path.basename(f));db.exec(git('show',commit+':'+f));db.prepare('INSERT INTO database_migrations VALUES(?,?,?,?)').run(v,path.basename(f),'x',Date.now());db.exec('PRAGMA user_version='+v);}return db;}
const value=(db,sql)=>Object.values(db.prepare(sql).get()??{})[0];
const scene=async(name,fn)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-core-'));try{await fn(dir);console.log('PASS',name)}finally{fs.rmSync(dir,{recursive:true,force:true})}};
const timer=setTimeout(()=>{console.log('TIMEOUT');process.exit(2)},240000);
for(const [name,commit,version] of [['till on the diverged 1.9.25 (schema 66)','01066c2',66],['till on live 1.9.32 (schema 65)','280f90e',65]])await scene(name,async dir=>{
 const db=fromCommit(dir,commit);assert.equal(value(db,'PRAGMA user_version'),version);
 db.exec(`INSERT INTO menu_categories(id,name_az,active,sort_order) VALUES('c1','Pizza',1,1)`);db.close();
 const a=start(dir);await a.ready;await a.stop();
 const d=new DatabaseSync(path.join(dir,'pos.db'));assert.equal(value(d,'PRAGMA user_version'),66);assert.equal(value(d,"SELECT name FROM database_migrations WHERE version=66"),'066_menu_subcategories_components.sql');assert.equal(value(d,"SELECT COUNT(*) FROM menu_categories WHERE id='c1' AND parent_id IS NULL"),1);assert.equal(value(d,"SELECT COUNT(*) FROM menu_item_recipe_expanded"),0);d.close();
 assert.ok(fs.readdirSync(path.join(dir,'backups')).some(f=>f.includes('pre-migration')),'a backup was taken');
});
await scene('wiping a till keeps its licence and a copy',async dir=>{
 let a=start(dir);await a.ready;await a.stop();
 let d=new DatabaseSync(path.join(dir,'pos.db'));d.exec(`INSERT INTO menu_categories(id,name_az) VALUES('c1','Pizza');INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('terminal.id','TERM-7',1)`);if(!d.prepare('SELECT 1 FROM license_state').get())d.exec(`INSERT INTO license_state(id,status,device_id,customer_id,updated_at) VALUES('local','active','dev-9','cust-9',1)`);else d.exec(`UPDATE license_state SET status='active',device_id='dev-9'`);d.close();
 a=start(dir);await a.ready;assert.equal((await a.call('system.wipeAllData',{commandId:'cmd'})).success,true);await a.stop();
 a=start(dir);await a.ready;await a.stop();
 d=new DatabaseSync(path.join(dir,'pos.db'));assert.equal(value(d,"SELECT COUNT(*) FROM menu_categories WHERE id='c1'"),0);assert.equal(value(d,'SELECT device_id FROM license_state'),'dev-9');assert.equal(value(d,"SELECT value FROM app_settings WHERE key='terminal.id'"),'TERM-7');d.close();
 assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(f=>f.includes('before-wipe')).length,1);
});
clearTimeout(timer);process.exit(0);
