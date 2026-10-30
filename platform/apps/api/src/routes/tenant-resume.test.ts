import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import Fastify from 'fastify';
import {sql} from 'drizzle-orm';
import {createDb} from '@milioner/database';
import {hashPassword,hashSessionToken} from '@milioner/security';
import {tenantRoutes,tenantRequestGuard,resolveTenantToken} from './tenant.js';
import {Billing} from '../lib/billing/service.js';
import {env} from '../env.js';
const url=process.env.TENANT_RESUME_TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.includes('billing_test_resume'))throw Error('Use an isolated billing_test_resume database.');
process.env.EPOINT_PUBLIC_KEY='fixture-public';process.env.EPOINT_PRIVATE_KEY='fixture-private';process.env.EPOINT_TOKEN_ENCRYPTION_KEY='ab'.repeat(32);process.env.EPOINT_LIVE_VERIFIED='true';globalThis.fetch=async()=>{throw Error('Network calls are forbidden in tenant resumption tests');};
const db=createDb(url),billing=new Billing(db),app=Fastify({logger:false});
const cid=randomUUID(),other=randomUUID(),lid=randomUUID(),sid=randomUUID(),email='trial-fixture@example.invalid';let passwordHash='';
before(async()=>{passwordHash=await hashPassword('fixture-password-2026');app.decorate('db',db);app.addHook('preHandler',(r,p)=>tenantRequestGuard(app,r,p));await app.register(tenantRoutes,{prefix:'/pos/api'});await app.ready();});
beforeEach(async()=>{
 await db.$client.unsafe('TRUNCATE customers CASCADE');
 await db.$client.unsafe('INSERT INTO billing_settings(id) VALUES(true) ON CONFLICT DO NOTHING; UPDATE billing_settings SET enabled=true,enforcement_enabled=true');
 await db.execute(sql`INSERT INTO customers(id,name,email,password_hash,active) VALUES(${cid}::uuid,'Trial fixture',${email},${passwordHash},true),(${other}::uuid,'Other fixture','other-trial@example.invalid',${passwordHash},true)`);
 await db.execute(sql`INSERT INTO licenses(id,customer_id,plan,plan_id,seats,status,features,valid_until) VALUES(${lid}::uuid,${cid}::uuid,'standart',NULL,1,'billing_pending','{"product":"restaurant","billingManaged":true}'::jsonb,now()-interval '1 day')`);
 await db.execute(sql`INSERT INTO activation_keys(id,license_id,key_hmac,product,max_devices,expires_at) VALUES(${randomUUID()}::uuid,${lid}::uuid,${randomUUID()},'restaurant',1,now()+interval '30 days')`);
 await db.execute(sql`INSERT INTO billing_subscriptions(id,customer_id,product,monthly_amount_minor) VALUES(${sid}::uuid,${cid}::uuid,'restaurant',3000)`);
 await db.execute(sql`INSERT INTO billing_license_links(subscription_id,license_id) VALUES(${sid}::uuid,${lid}::uuid)`);
});
after(async()=>{await app.close();await db.$client.end({timeout:5});});
function signed(customerId=cid,client='billing',exp=Date.now()+3600000){const body=Buffer.from(JSON.stringify({customerId,email:customerId===cid?email:'other-trial@example.invalid',client,iat:Date.now(),exp,jti:randomUUID()})).toString('base64url');return 't1.'+body+'.'+createHmac('sha256',env.sessionSecret).update(body).digest('base64url');}
function resume(token:string,hwid='fixture-hardware-primary',product='restaurant'){return app.inject({method:'POST',url:'/pos/api/tenant/resume',headers:{authorization:'Bearer '+token},payload:{product,hwid}});}
async function grant(){return billing.accessControl('fixture-operator',{customerId:cid,product:'restaurant',action:'trial',days:7,reason:'Fixture trial',requestId:randomUUID()});}
test('normal login enters billing mode before a grant and resumes directly after a seven-day trial',async()=>{
 const login=await app.inject({method:'POST',url:'/pos/api/tenant/login',payload:{email,password:'fixture-password-2026',client:'pos',product:'restaurant',hwid:'fixture-hardware-primary'}});assert.equal(login.statusCode,200,login.body);assert.equal(login.json().billingOnly,true);
 const token=login.json().token;assert.equal((await resume(token)).statusCode,403);
 const access=await grant();const result=await resume(token);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().billingOnly,false);assert.equal(result.json().billing.accessMode,'trial');assert.equal(result.json().billing.accessUntil,access.trialUntil);assert.equal(resolveTenantToken(result.json().token)?.client,'pos');assert.ok(result.json().expiresAt<=login.json().expiresAt);
 const fresh=await app.inject({method:'POST',url:'/pos/api/tenant/login',payload:{email,password:'fixture-password-2026',client:'pos',product:'restaurant',hwid:'fixture-hardware-primary'}});assert.equal(fresh.statusCode,200,fresh.body);assert.equal(fresh.json().billingOnly,false);assert.equal(fresh.json().billing.accessMode,'trial');
});
test('trial resumption enforces customer, product, expiration, deactivation and logout',async()=>{
 await grant();assert.equal((await resume(signed(other))).statusCode,403);assert.equal((await resume(signed(),undefined,'market')).statusCode,403);assert.equal((await resume(signed(cid,'billing',Date.now()-1))).statusCode,401);assert.equal((await resume(signed(cid,'owner'))).statusCode,401);
 const token=signed();await db.execute(sql`INSERT INTO tenant_session_revocations(token_hash,expires_at) VALUES(${hashSessionToken(token)},now()+interval '1 hour')`);assert.equal((await resume(token)).statusCode,401);
 await db.execute(sql`UPDATE customers SET active=false WHERE id=${cid}::uuid`);assert.equal((await resume(signed())).statusCode,401);
});
test('simultaneous resumption on two PCs cannot consume the same single seat',async()=>{
 await grant();const token=signed();const results=await Promise.all([resume(token,'fixture-hardware-one'),resume(token,'fixture-hardware-two')]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,403]);const denied=results.find(r=>r.statusCode===403)!;assert.equal(denied.json().code,'HWID_MISMATCH');
});
test('a revoked license or expired free period cannot resume a billing session',async()=>{
 await grant();await db.execute(sql`UPDATE licenses SET status='revoked' WHERE id=${lid}::uuid`);assert.equal((await resume(signed())).statusCode,403);
 await db.execute(sql`UPDATE licenses SET status='active' WHERE id=${lid}::uuid`);await db.execute(sql`UPDATE billing_subscriptions SET trial_until=now()-interval '1 second' WHERE id=${sid}::uuid`);assert.equal((await resume(signed())).statusCode,403);
});
