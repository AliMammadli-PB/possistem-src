/** Only connection-local TEMP fixture tables are changed. Run as PostgreSQL OS user. */
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const apiRequire=createRequire('/opt/possistem-pos-control/apps/api/package.json'),dbRequire=createRequire('/opt/possistem-pos-control/packages/database/package.json');
const Fastify=apiRequire('fastify'),postgres=dbRequire('postgres'),{drizzle}=apiRequire('drizzle-orm/postgres-js');
const {marketRegisterCapacityRoutes}=require(process.argv[2]);
const db=postgres({host:'/var/run/postgresql',database:'possistem_pos_control',username:'postgres',max:1}),orm=drizzle(db),app=Fastify();
app.decorate('db',orm);globalThis.capacityTest={audits:[]};
async function run(){try{
 for(const table of ['licenses','activation_keys','devices'])await db.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
 const customer=randomUUID(),other=randomUUID(),license=randomUUID(),key=randomUUID(),oldKey=randomUUID();
 await db`INSERT INTO licenses(id,customer_id,plan,seats) VALUES(${license}::uuid,${customer}::uuid,'market',2)`;
 await db`INSERT INTO activation_keys(id,license_id,key_hmac,max_devices,product) VALUES(${key}::uuid,${license}::uuid,'fixture-key-1',2,'market'),(${oldKey}::uuid,${license}::uuid,'fixture-key-2',1,'market')`;
 await db`INSERT INTO devices(license_id,device_fingerprint,status) VALUES(${license}::uuid,'fixture-one','active'),(${license}::uuid,'fixture-revoked','revoked')`;
 await marketRegisterCapacityRoutes(app);
 const send=(method='GET',payload,auth=true,id=customer)=>app.inject({method,url:`/market-pos/customers/${id}/${method==='GET'?'registers':'register-capacity'}`,headers:auth?{'x-test-admin':'yes'}:{},...(payload?{payload}:{})});
 assert.equal((await send('POST',{amount:1},false)).statusCode,403);
 for(const amount of [0,-1,1.5,21,'2'])assert.equal((await send('POST',{amount})).statusCode,400);
 assert.equal((await send('POST',{amount:1},true,'bad')).statusCode,400);
 assert.equal((await send('POST',{amount:1},true,other)).statusCode,404);
 let response=await send();assert.equal(response.statusCode,200,response.body);assert.equal(response.json().capacity,2);assert.equal(response.json().used,1);assert.equal(response.json().available,1);
 const results=await Promise.all([send('POST',{amount:2}),send('POST',{amount:3})]);for(const result of results)assert.equal(result.statusCode,200,result.body);
 response=await send();assert.equal(response.json().capacity,7,'Both increments are retained');
 const keys=await db`SELECT max_devices FROM activation_keys WHERE license_id=${license}::uuid`;assert.deepEqual(keys.map(k=>k.max_devices),[7,7],'All usable keys match the licence');
 assert.equal((await db`SELECT seats FROM licenses WHERE id=${license}::uuid`)[0].seats,7);
 const noKeyOwner=randomUUID(),noKeyLicense=randomUUID();await db`INSERT INTO licenses(id,customer_id,plan,seats) VALUES(${noKeyLicense}::uuid,${noKeyOwner}::uuid,'market',1)`;
 response=await send('POST',{amount:1},true,noKeyOwner);assert.equal(response.statusCode,200,response.body);assert.equal(response.json().capacity,2);assert.equal(response.json().activationKeyId,null);
 const restaurantOwner=randomUUID();await db`INSERT INTO licenses(customer_id,plan,seats) VALUES(${restaurantOwner}::uuid,'standart',1)`;
 assert.equal((await send('POST',{amount:1},true,restaurantOwner)).statusCode,404);
 assert.equal(globalThis.capacityTest.audits.length,3);
 console.log('PASS actual Market capacity HTTP + PostgreSQL: superadmin auth, validated inputs, active/revoked PC counts, concurrent increments, licence/key consistency, keyless account, customer/product isolation, audit; TEMP fixtures only.');
}finally{await app.close();await db.end();}}
run().catch(e=>{console.error(e);process.exitCode=1;});
