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
for(const [name,commit,version] of [['till on the diverged 1.9.25 (schema 66)','01066c2',66],['till on live 1.9.32 (schema 65)','280f90e',65],['till on live 1.9.34 (schema 66)','5a05cef',66],['till on live 1.10.2 (schema 67)','2793271',67]])await scene(name,async dir=>{
 const db=fromCommit(dir,commit);assert.equal(value(db,'PRAGMA user_version'),version);
 db.exec(`INSERT INTO menu_categories(id,name_az,active,sort_order) VALUES('c1','Pizza',1,1)`);db.close();
 const a=start(dir);await a.ready;await a.stop();
 const d=new DatabaseSync(path.join(dir,'pos.db'));assert.equal(value(d,'PRAGMA user_version'),70);assert.equal(value(d,"SELECT name FROM database_migrations WHERE version=66"),'066_menu_subcategories_components.sql');assert.equal(value(d,"SELECT COUNT(*) FROM catalog_category_links WHERE menu_category_id='c1'"),1);assert.equal(value(d,"SELECT COUNT(*) FROM menu_categories WHERE id='c1' AND parent_id IS NULL"),1);assert.equal(value(d,"SELECT COUNT(*) FROM menu_item_recipe_expanded"),0);d.close();
 assert.ok(fs.readdirSync(path.join(dir,'backups')).some(f=>f.includes('pre-migration')),'a backup was taken');
});
// 067 runs on every till. A shop's real mix: same names on both sides, a sub-category, a deep warehouse tree, goods on sale, goods not on sale, a recipe.
await scene('067 on a shop with real data leaves money, stock and recipes alone',async dir=>{
 const db=fromCommit(dir,'5a05cef');db.exec(`INSERT INTO menu_categories(id,name_az,active,sort_order) VALUES('drinks','İçkilər',1,1),('food','Yemək',1,2),('old','Köhnə',0,3);INSERT INTO menu_categories(id,name_az,parent_id,active,sort_order) VALUES('soft','Spirtsiz','drinks',1,1);
 INSERT INTO stock_categories(id,name,created_at) VALUES('s-drinks','İçkilər',1),('s-raw','Xammal',1);INSERT INTO stock_categories(id,parent_id,name,created_at) VALUES('s-meat','s-raw','Ət',1),('s-beef','s-meat','Mal əti',1);
 INSERT INTO ingredients(id,sku,name,cost_minor,sale_price_minor,category_id,created_at,updated_at) VALUES('cola','C','Kola',100,200,'s-drinks',1,1),('beef','B','Mal əti',900,0,'s-beef',1,1);
 INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,created_at,updated_at) VALUES('m-cola','soft','MC','Kola',200,1,1),('m-burger','food','MB','Burger',800,1,1);
 INSERT INTO catalog_goods_links(menu_id,ingredient_id) VALUES('m-cola','cola');INSERT INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) VALUES('m-burger','beef',150);`);db.close();
 const a=start(dir);await a.ready;await a.stop();
 const d=new DatabaseSync(path.join(dir,'pos.db'));assert.equal(value(d,'PRAGMA user_version'),70);
 assert.equal(value(d,"SELECT price_minor FROM menu_items WHERE id='m-cola'"),200);assert.equal(value(d,"SELECT category_id FROM menu_items WHERE id='m-cola'"),'soft');assert.equal(value(d,"SELECT cost_minor FROM ingredients WHERE id='beef'"),900);assert.equal(value(d,"SELECT qty_milli FROM menu_item_ingredients WHERE menu_item_id='m-burger'"),150);
 assert.equal(value(d,"SELECT category_id FROM ingredients WHERE id='beef'"),'s-beef','a deep warehouse category stays');
 assert.equal(value(d,"SELECT category_id FROM ingredients WHERE id='cola'"),value(d,"SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id='soft'"),'a good on sale files under its dish');
 assert.equal(value(d,"SELECT COUNT(*) FROM menu_categories m LEFT JOIN catalog_category_links l ON l.menu_category_id=m.id WHERE l.menu_category_id IS NULL"),0,'every menu category is linked');
 assert.ok(fs.readdirSync(path.join(dir,'backups')).some(f=>f.includes('pre-migration')),'a backup was taken');d.close();
});
// 068, 069 and 070 run on every till. Live 1.10.2 with salaries, transfers, money and recipes in it.
await scene('1.10.2 with real data: documents appear, prepared dishes become parts, money stays',async dir=>{
 const db=fromCommit(dir,'2793271');db.exec('PRAGMA foreign_keys=OFF');
 const fill=(table,vals)=>{const row={};for(const c of db.prepare(`PRAGMA table_info(${table})`).all()){if(c.name in vals)row[c.name]=vals[c.name];else if(c.notnull&&c.dflt_value==null)row[c.name]=/INT/i.test(c.type)?1:'x-'+c.name+'-'+randomUUID().slice(0,8)}const k=Object.keys(row);db.prepare(`INSERT INTO ${table}(${k.join(',')}) VALUES(${k.map(()=>'?').join(',')})`).run(...k.map(x=>row[x]))};
 fill('menu_categories',{id:'c',name_az:'Yemək'});
 const dish=(id,name)=>{fill('menu_items',{id,category_id:'c',sku:id,name_az:name,price_minor:500});fill('ingredients',{id:'card-'+id,sku:'MENU-'+id,name:name})};
 for(const [id,name] of [['dough','Xəmir'],['pizza','Pizza'],['kola','Kola'],['ring1','Halqa 1'],['ring2','Halqa 2']])dish(id,name);
 fill('ingredients',{id:'flour',sku:'FLOUR',name:'Un'});
 const line=db.prepare('INSERT OR REPLACE INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) VALUES(?,?,?)');
 line.run('dough','flour',200);line.run('pizza','card-dough',2000);line.run('pizza','card-kola',1000);
 line.run('ring1','flour',1);line.run('ring2','flour',1);line.run('ring1','card-ring2',1000);line.run('ring2','card-ring1',1000);
 fill('customers',{id:'emp',name:'İşçi',kind:'employee'});
 fill('cash_accounts',{id:'a',name:'Kassa',kind:'treasury'});fill('cash_accounts',{id:'b',name:'Xəzinə',kind:'treasury'});
 fill('salary_payments',{id:'sal',customer_id:'emp',month:'2026-10',kind:'full',amount_minor:50000,actor_user_id:'usr-admin',created_at:5});
 fill('customer_ledger',{id:'adj',customer_id:'emp',amount_minor:-700,kind:'adjustment',note:'Maaşdan tutuldu',actor_user_id:'usr-admin',created_at:5});
 fill('document_cash_links',{doc_type:'salary',doc_id:'sal',account_id:'a',cash_movement_id:'mv'});
 const move=(id,acc,amount,ref)=>fill('cash_account_moves',{id,account_id:acc,amount_minor:amount,kind:'transfer',ref_type:'transfer',ref_id:ref,note:'Köçürmə',created_at:9});
 move('m1','a',-3000,'tr1');move('m2','b',3000,'tr1');
 fill('orders',{id:'o1',order_number:'N1',status:'closed',total_minor:1500,paid_minor:1500,deposit_minor:0});
 fill('payments',{id:'p1',order_id:'o1',method:'cash',status:'approved',amount_minor:1500});
 const sums="SELECT (SELECT SUM(amount_minor) FROM payments)*1000000+(SELECT SUM(amount_minor) FROM cash_account_moves)+(SELECT COUNT(*) FROM cash_account_moves)";
 const before=value(db,sums);db.close();
 const a=start(dir);await a.ready;await a.stop();
 const d=new DatabaseSync(path.join(dir,'pos.db'));
 assert.equal(value(d,'PRAGMA user_version'),70);
 assert.equal(value(d,sums),before,'no money moved');
 assert.equal(value(d,"SELECT total_minor FROM orders WHERE id='o1'"),1500);
 assert.equal(value(d,"SELECT is_deposit FROM payments WHERE id='p1'"),0);
 assert.equal(value(d,"SELECT salary_adjustment_id FROM document_cash_links WHERE doc_id='sal'"),'adj');
 assert.equal(value(d,"SELECT amount_minor FROM cash_transfer_documents WHERE id='tr1'"),3000);
 assert.equal(value(d,"SELECT qty_milli FROM menu_item_components WHERE menu_item_id='pizza' AND component_menu_item_id='dough'"),2000);
 assert.equal(value(d,"SELECT COUNT(*) FROM menu_item_ingredients WHERE menu_item_id='pizza' AND ingredient_id='card-dough'"),0);
 assert.equal(value(d,"SELECT qty_milli FROM menu_item_recipe_expanded WHERE menu_item_id='pizza' AND ingredient_id='flour'"),400,'the raw material goes out now');
 assert.equal(value(d,"SELECT qty_milli FROM menu_item_ingredients WHERE menu_item_id='pizza' AND ingredient_id='card-kola'"),1000,'a good with no recipe stays a line');
 assert.equal(value(d,"SELECT COUNT(*) FROM menu_item_components WHERE menu_item_id LIKE 'ring%'"),0,'a cycle is left alone');
 assert.equal(value(d,"SELECT COUNT(*) FROM menu_item_ingredients WHERE ingredient_id LIKE 'card-ring%'"),2);
 assert.equal(value(d,"SELECT COUNT(*) FROM sqlite_master WHERE name='_m070_lines'"),0);
 assert.deepEqual(d.prepare('PRAGMA quick_check').all().map(r=>Object.values(r)[0]),['ok']);
 assert.ok(fs.readdirSync(path.join(dir,'backups')).some(f=>f.includes('pre-migration')),'a backup was taken');d.close();
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
