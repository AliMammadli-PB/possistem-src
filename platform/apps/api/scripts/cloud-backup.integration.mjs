// Real route, real till client and a real Postgres engine (PGlite, in memory), so no server is touched.
//   npm i @electric-sql/pglite   (in a scratch folder)
//   NODE_PATH=<that folder>/node_modules node scripts/cloud-backup.integration.mjs   (after tsc)
// The route's guards in app.ts (customer session, superadmin) are read, not run: the session is stubbed below.
import assert from'node:assert/strict';import fs from'node:fs/promises';import os from'node:os';import path from'node:path';import{randomUUID}from'node:crypto';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';import{execFileSync}from'node:child_process';import Fastify from'fastify';import multipart from'@fastify/multipart';import{cloudBackupRoutes}from'../dist/routes/cloud-backups.js';
const req=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),{PGlite}=req('@electric-sql/pglite'),{drizzle}=req('drizzle-orm/pglite');
const pg=new PGlite(),q=(text,params)=>pg.query(text,params);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cloud-api-')),root=path.resolve(here,'../../../..'),format=req(path.join(root,'platform/packages/security/cloud-backup.cjs')),client=req(path.join(root,'restoranpos/out/main/cloud-backup-client.cjs'));
process.env.POS_CLOUD_BACKUP_DIR=path.join(dir,'encrypted');
const A=randomUUID(),B=randomUUID(),L=randomUUID(),D=randomUUID(),L2=randomUUID(),D2=randomUUID(),U=randomUUID(),fingerprint='test-fingerprint-owner-A',fingerprintB='test-fingerprint-owner-B',pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),image=format.sha(pixel)+'.png';
const app=Fastify({logger:false});app.decorate('db',drizzle({client:pg}));app.decorateRequest('customer',null);app.decorateRequest('user',null);app.addHook('onRequest',async r=>{r.customer=r.headers['x-test-customer']?{id:r.headers['x-test-customer']}:null;r.user=r.headers['x-test-admin']==='yes'?{id:U,role:'superadmin'}:null});
// The same multipart limits as app.ts: the route has to widen them for itself.
await app.register(multipart,{limits:{files:1,fileSize:12*1024*1024,fields:8,parts:9}});await app.register(cloudBackupRoutes);
try{
 await pg.exec(`CREATE TABLE customers(id uuid PRIMARY KEY,active boolean DEFAULT true);CREATE TABLE licenses(id uuid PRIMARY KEY,customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,features jsonb,status text,updated_at timestamptz DEFAULT now());CREATE TABLE devices(id uuid PRIMARY KEY,license_id uuid REFERENCES licenses(id) ON DELETE CASCADE,device_fingerprint text,status text,hostname text,app_version text,last_seen_at timestamptz,created_at timestamptz DEFAULT now());CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),actor_user_id uuid,actor_customer_id uuid,action text,entity_type text,entity_id text,meta jsonb,ip text,created_at timestamptz DEFAULT now());`);
 await q('INSERT INTO customers(id) VALUES($1),($2)',[A,B]);
 await q('INSERT INTO licenses(id,customer_id,features,status) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[L,A,JSON.stringify({product:'restaurant'}),'active',L2,B,JSON.stringify({product:'restaurant',cloudBackup:true}),'active']);
 await q(`INSERT INTO devices(id,license_id,device_fingerprint,status,hostname,app_version) VALUES($1,$2,$3,'active','Test kassa','1.9.34'),($4,$5,$6,'active','Other','1.9.34')`,[D,L,fingerprint,D2,L2,fingerprintB]);
 const dbFile=path.join(dir,'pos.db');execFileSync('python3',['-c',`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nfor t in ['orders','payments','backup_manifests','users','app_settings','stock_levels','cash_accounts','customers']: c.execute('CREATE TABLE '+t+'(id TEXT)')\nc.execute('CREATE TABLE menu_items(id TEXT,image TEXT,price_minor INTEGER)')\nc.execute('INSERT INTO menu_items VALUES(?,?,500)',('doner','app://local/user-assets/'+sys.argv[2]))\nc.execute('PRAGMA user_version=67')\nc.commit()`,dbFile,image]);
 const db=await fs.readFile(dbFile),assetsDir=path.join(dir,'catalog-assets');await fs.mkdir(assetsDir);await fs.writeFile(path.join(assetsDir,image),pixel);
 const pack=(meta={},assets=[{name:image,bytes:pixel}])=>format.pack(db,assets,{customerId:A,deviceId:D,appVersion:'1.9.34',...meta});const bytes=await pack();
 const headers={'x-device-fingerprint':fingerprint},owner={'x-test-customer':A},admin={'x-test-admin':'yes'},url=`/devices/${D}/cloud-backup`;
 const upload=(payload,extra={})=>{const boundary='pos-boundary-qa';return app.inject({method:'POST',url,headers:{...headers,...extra,'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="pos.posbackup"\r\nContent-Type: application/octet-stream\r\n\r\n'),payload,Buffer.from('\r\n--'+boundary+'--\r\n')])})};
 // Device proof, with no owner signed in on the till.
 assert.equal((await app.inject({url:url+'/status'})).statusCode,401);
 assert.equal((await app.inject({url:url+'/status',headers:{'x-device-fingerprint':'wrong'}})).statusCode,401);
 assert.equal((await app.inject({url:url+'/status',headers:{'x-device-fingerprint':fingerprintB}})).statusCode,401,'another till\'s proof');
 assert.equal((await app.inject({url:url+'/status',headers})).json().enabled,false,'off until the superadmin turns it on');
 assert.equal((await upload(bytes)).statusCode,403);
 // Superadmin only; per licence.
 assert.equal((await app.inject({url:`/customers/${A}/cloud-backups`})).statusCode,401);
 assert.equal((await app.inject({method:'POST',url:`/customers/${A}/cloud-backups/${D}/enable`,headers:owner,payload:{}})).statusCode,401);
 let r=await app.inject({method:'POST',url:`/customers/${A}/cloud-backups/${D}/enable`,headers:admin,payload:{}});assert.equal(r.statusCode,200,r.body);
 assert.equal((await q('SELECT features FROM licenses WHERE id=$1',[L])).rows[0].features.cloudBackup,true);
 assert.equal((await app.inject({url:url+'/status',headers})).json().enabled,true);
 assert.equal((await app.inject({method:'POST',url:`/customers/${B}/cloud-backups/${D}/request`,headers:admin,payload:{}})).statusCode,404,'a device of another customer');
 r=await app.inject({method:'POST',url:`/customers/${A}/cloud-backups/${D}/request`,headers:admin,payload:{}});assert.equal(r.statusCode,200,r.body);const requestId=(await app.inject({url:url+'/status',headers})).json().requestId;assert.ok(requestId);
 // What is refused and what is only counted.
 assert.equal((await upload(await pack({customerId:B}))).statusCode,409);
 assert.equal((await upload(Buffer.from('junk'))).statusCode,400);
 r=await upload(await pack({},[]));assert.equal(r.statusCode,200,'A lost picture must not cost the whole backup: '+r.body);
 const partialId=r.json().id;
 assert.equal((await app.inject({url:'/owner/cloud-backups',headers:owner})).json().backups.find(b=>b.id===partialId).manifest.missingAssets,1);
 r=await upload(bytes,{'x-backup-request-id':requestId});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().verified,true);const id=r.json().id;
 assert.equal((await upload(bytes)).json().id,id,'unchanged till is one stored copy');
 const listed=(await app.inject({url:'/owner/cloud-backups',headers:owner})).json();
 assert.equal(listed.backups.length,1,'the newer copy replaced the older one');assert.equal(listed.backups[0].id,id);assert.equal(listed.backups[0].manifest.missingAssets,0);await assert.rejects(fs.stat(path.join(process.env.POS_CLOUD_BACKUP_DIR,partialId+'.enc')));assert.equal(listed.devices[0].hostname,'Test kassa');
 assert.equal((await app.inject({url:'/owner/cloud-backups',headers:{'x-test-customer':B}})).json().backups.length,0);
 assert.equal((await app.inject({url:url+'/status',headers})).json().requestId,null,'request acknowledged only after a verified copy');
 // Stored encrypted, private, unreadable by another customer, repairable.
 const file=path.join(process.env.POS_CLOUD_BACKUP_DIR,id+'.enc'),stored=await fs.readFile(file);assert.notDeepEqual(stored,bytes);assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.equal((await fs.stat(process.env.POS_CLOUD_BACKUP_DIR)).mode&0o777,0o700);
 assert.equal((await app.inject({url:`/owner/cloud-backups/${id}/download`})).statusCode,401);
 assert.equal((await app.inject({url:`/owner/cloud-backups/${id}/download`,headers:{'x-test-customer':B}})).statusCode,404);
 assert.equal((await app.inject({url:`/customers/${A}/cloud-backups/${id}/download`,headers:owner})).statusCode,401);
 r=await app.inject({url:`/owner/cloud-backups/${id}/download`,headers:owner});assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.rawPayload,bytes);
 r=await app.inject({url:`/customers/${A}/cloud-backups/${id}/download`,headers:admin});assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.rawPayload,bytes);
 assert.ok((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action='cloud_backup.download'`)).rows[0].n>=2,'every download leaves a trail');
 const corrupted=Buffer.from(stored);corrupted[20]^=1;await fs.writeFile(file,corrupted);assert.equal((await app.inject({url:`/owner/cloud-backups/${id}/download`,headers:owner})).statusCode,409);
 assert.equal((await upload(bytes)).statusCode,200);assert.equal((await app.inject({url:`/owner/cloud-backups/${id}/download`,headers:owner})).statusCode,200,'a verified retry repairs a damaged stored file');
 // Only the newest verified copy of a till stays, and the old files go with their rows.
 const seeded=[];for(let day=1;day<=5;day++){const seed=randomUUID();seeded.push(seed);await fs.writeFile(path.join(process.env.POS_CLOUD_BACKUP_DIR,seed+'.enc'),'x');await q(`INSERT INTO pos_cloud_backups(id,customer_id,device_id,product,sha256,size_bytes,db_bytes,manifest,created_at) VALUES($1,$2,$3,'restaurant',$4,1,1,'{}'::jsonb,now()-($5||' days')::interval)`,[seed,A,D,randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''),String(day)]);}
 r=await upload(await pack({appVersion:'retention'}));assert.equal(r.statusCode,200,r.body);
 const newest=JSON.parse(r.body).id,kept=(await q('SELECT id FROM pos_cloud_backups WHERE device_id=$1',[D])).rows.map(x=>x.id);assert.deepEqual(kept,[newest],'only the newest stays');
 await fs.stat(path.join(process.env.POS_CLOUD_BACKUP_DIR,newest+'.enc'));for(const gone of seeded)await assert.rejects(fs.stat(path.join(process.env.POS_CLOUD_BACKUP_DIR,gone+'.enc')),'its file goes too');
 r=await upload(await pack({appVersion:'retention'}));assert.equal(r.statusCode,200,r.body);assert.equal(JSON.parse(r.body).id,newest,'the same data stays one copy');assert.equal((await q('SELECT count(*)::int AS n FROM pos_cloud_backups WHERE device_id=$1',[D])).rows[0].n,1);
 // The real till client over HTTP: snapshot, pictures, multipart, verified acknowledgement.
 await app.listen({host:'127.0.0.1',port:0});const port=app.server.address().port;let calls=0,terminal=false,changed=false;const creds=()=>({deviceId:D,customerId:changed?B:A,fingerprint,baseUrl:`http://127.0.0.1:${port}`,appVersion:'1.9.34'});
 const snapshots=path.join(dir,'backups');await fs.mkdir(snapshots);await fs.writeFile(path.join(snapshots,'pos-cloud-crashed.db'),'x');await fs.writeFile(path.join(snapshots,'pos-usb-1.db'),'keep');
 const till=client.createClient({credentials:async()=>creds(),isTerminal:()=>terminal,assetsDir:()=>assetsDir,snapshot:async()=>{calls++;const target=path.join(snapshots,'pos-cloud-'+calls+'.db');await fs.copyFile(dbFile,target);return{path:target}}});
 assert.equal((await till.tick(true)).status,'current');assert.equal(calls,1);await till.tick();assert.equal(calls,1,'a fresh server copy avoids another capture');
 assert.deepEqual((await fs.readdir(snapshots)).sort(),['pos-usb-1.db'],'nothing of ours is left behind, and nothing else is touched');
 terminal=true;assert.equal((await till.tick(true)).status,'terminal','an extra till on the LAN must not upload as if it held the data');assert.equal(calls,1);assert.equal((await till.status()).status,'terminal');terminal=false;
 changed=true;assert.equal((await till.tick(true)).status,'error','account changed under the upload');changed=false;
 assert.match((await q('SELECT last_error FROM pos_cloud_backup_state WHERE device_id=$1',[D])).rows[0].last_error,/ACCOUNT|MISMATCH/);
 // Restore side: only into the same account.
 const latest=(await app.inject({url:'/owner/cloud-backups',headers:owner})).json().backups[0].id;
 const download=(await app.inject({url:`/owner/cloud-backups/${latest}/download`,headers:owner})).rawPayload,bundle=path.join(dir,'bundle.posbackup'),restore=path.join(dir,'restored.db'),images=path.join(dir,'restored-images');await fs.writeFile(bundle,download);
 await assert.rejects(client.importBundle(bundle,restore,images,B),/başqa hesaba/);await assert.rejects(client.importBundle(bundle,restore,images,null),/aktivləşdirin/);
 await fs.writeFile(path.join(dir,'junk.posbackup'),'junk');await assert.rejects(client.importBundle(path.join(dir,'junk.posbackup'),restore,images,A),/zədələnib/);
 await client.importBundle(bundle,restore,images,A);assert.deepEqual(await fs.readFile(restore),db);assert.deepEqual(await fs.readFile(path.join(images,image)),pixel);
 // Failure and switching off keep what is already saved.
 const before=(await q('SELECT count(*)::int AS n FROM pos_cloud_backups')).rows[0].n;const failing=client.createClient({credentials:async()=>creds(),assetsDir:()=>assetsDir,snapshot:async()=>{throw Error('SNAPSHOT_FAILED')}});assert.equal((await failing.tick(true)).status,'error');assert.equal((await q('SELECT count(*)::int AS n FROM pos_cloud_backups')).rows[0].n,before);
 assert.equal((await app.inject({method:'POST',url:`/customers/${A}/cloud-backups/${D}/disable`,headers:admin,payload:{}})).statusCode,200);assert.equal((await q('SELECT features FROM licenses WHERE id=$1',[L])).rows[0].features.cloudBackup,false);
 assert.equal((await till.tick(true)).status,'disabled');assert.equal((await upload(await pack({appVersion:'off'}))).statusCode,403);assert.equal((await app.inject({url:`/owner/cloud-backups/${latest}/download`,headers:owner})).statusCode,200,'switching off does not remove what was saved');
 // An existing admin action must keep working once a customer has backups.
 await q('DELETE FROM customers WHERE id=$1',[A]);assert.equal((await q('SELECT count(*)::int AS n FROM pos_cloud_backups')).rows[0].n,0);
 console.log('PASS route + till client + restore on a real Postgres engine: device proof without an owner login, off by default, superadmin switches, account isolation, lost picture counted, unchanged till stored once, encryption, tamper and repair, retention, LAN till skipped, stale snapshots removed, request acknowledged after verification, restore only into the same account, customer delete still works.');
}finally{await app.close();await pg.close();await fs.rm(dir,{recursive:true,force:true})}
