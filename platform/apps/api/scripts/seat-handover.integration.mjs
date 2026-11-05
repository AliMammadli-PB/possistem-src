// handOverSeat from the patched compiled devices.js, on a real Postgres engine (PGlite, in memory).
//   NODE_PATH=<folder with @electric-sql/pglite>/node_modules node scripts/seat-handover.integration.mjs <patched devices.js>
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath,pathToFileURL} from 'node:url';
const req=createRequire(import.meta.url),here=path.dirname(fileURLToPath(import.meta.url)),{PGlite}=req('@electric-sql/pglite'),{drizzle}=req('drizzle-orm/pglite');
// Next to the real routes so its own imports resolve.
const copy=path.join(here,'../dist/routes/__seat-handover-under-test.js');fs.copyFileSync(process.argv[2],copy);
try{
 const {handOverSeat}=await import(pathToFileURL(copy).href);
 const pg=new PGlite(),db=drizzle({client:pg}),q=(t,p)=>pg.query(t,p);
 await pg.exec(`CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action text NOT NULL,entity_type text,entity_id text,meta jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE devices(id uuid PRIMARY KEY,license_id uuid,status text NOT NULL DEFAULT 'active',device_public_key text,last_seen_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz);`);
 const C=randomUUID(),L=randomUUID(),old=randomUUID(),other=randomUUID();
 const status=async id=>(await q('SELECT status FROM devices WHERE id=$1',[id])).rows[0].status;
 const run=seats=>db.transaction(tx=>handOverSeat(tx,L,C,seats));
 await q(`INSERT INTO devices(id,license_id,last_seen_at,created_at,device_public_key) VALUES($1,$2,now()-interval '2 hours',now()-interval '30 days','k1')`,[old,L]);
 assert.equal(await run(1),false,'no reset: the seat stays taken');
 await q(`INSERT INTO audit_logs(action,entity_type,entity_id,created_at) VALUES('customer.clearHwid','customer',$1,now()-interval '8 days')`,[C]);
 assert.equal(await run(1),false,'a reset older than 7 days does not count');
 await q(`INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('customer.clearHwid','customer',$1)`,[randomUUID()]);
 assert.equal(await run(1),false,'another customer\'s reset does not count');
 await q(`INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('customer.clearHwid','customer',$1)`,[C]);
 assert.equal(await run(2),false,'a free seat: nothing is revoked');
 assert.equal(await run(1),true,'reset, seat full: the old till lets go');
 assert.equal(await status(old),'revoked');assert.equal((await q('SELECT device_public_key FROM devices WHERE id=$1',[old])).rows[0].device_public_key,null);
 assert.equal((await q(`SELECT count(*)::int n FROM audit_logs WHERE action='device.seatHandover' AND entity_id=$1`,[old])).rows[0].n,1);
 // The new PC is created after the reset; the next one needs a free seat again.
 await q(`INSERT INTO devices(id,license_id,last_seen_at) VALUES($1,$2,now())`,[other,L]);
 assert.equal(await run(1),false,'one hand-over per reset');assert.equal(await status(other),'active');
 // Two seats, both taken: the till seen longest ago goes.
 const C2=randomUUID(),L2=randomUUID(),a=randomUUID(),b=randomUUID();
 await q(`INSERT INTO devices(id,license_id,last_seen_at,created_at) VALUES($1,$3,now()-interval '1 minute',now()-interval '9 days'),($2,$3,now()-interval '3 days',now()-interval '9 days')`,[a,b,L2]);
 await q(`INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('customer.clearHwid','customer',$1)`,[C2]);
 assert.equal(await db.transaction(tx=>handOverSeat(tx,L2,C2,2)),true);
 assert.equal(await status(b),'revoked');assert.equal(await status(a),'active');
 console.log('PASS seat hand-over: only after an admin HWID reset within 7 days, only when seats are full, once, oldest-seen till');
}finally{fs.rmSync(copy,{force:true})}
