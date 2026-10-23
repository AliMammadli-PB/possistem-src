import type {FastifyInstance} from 'fastify';
import {and,desc,eq,sql} from 'drizzle-orm';
import {activationKeys,devices,licenses} from '@milioner/database';
import {z} from 'zod';
import {requireSuperadmin,currentUser} from '../plugins/auth.js';
import {clientIp,parseBody} from '../lib/validate.js';
import {writeAudit} from '../lib/audit.js';

const Params=z.object({id:z.string().uuid()});
const Capacity=z.object({amount:z.number().int().min(1).max(20).default(1)});
export async function marketRegisterCapacityRoutes(app:FastifyInstance){
 app.get('/market-pos/customers/:id/registers',async(req,reply)=>{
  if(!requireSuperadmin(req,reply))return;
  const params=Params.safeParse(req.params);if(!params.success)return reply.code(400).send({error:'Müştəri düzgün seçilməyib'});
  const [license]=await app.db.select({id:licenses.id,seats:licenses.seats}).from(licenses).where(and(eq(licenses.customerId,params.data.id),eq(licenses.plan,'market'))).orderBy(desc(licenses.createdAt)).limit(1);
  if(!license)return reply.code(404).send({error:'Market lisenziyası tapılmadı'});
  const [key]=await app.db.select({id:activationKeys.id,maxDevices:activationKeys.maxDevices}).from(activationKeys).where(and(eq(activationKeys.licenseId,license.id),sql`${activationKeys.revokedAt} IS NULL`)).orderBy(desc(activationKeys.createdAt)).limit(1);
  const rows=await app.db.select({id:devices.id,status:devices.status,deviceFingerprint:devices.deviceFingerprint,hostname:devices.hostname,appVersion:devices.appVersion,lastSeenAt:devices.lastSeenAt,registerName:sql<string|null>`register_name`,nameUpdatedAt:sql<number>`COALESCE(extract(epoch FROM register_name_updated_at)*1000,0)`}).from(devices).where(eq(devices.licenseId,license.id)).orderBy(desc(devices.lastSeenAt));
  const used=rows.filter(row=>row.status!=='revoked').length,capacity=Math.max(license.seats,key?.maxDevices??0);
  return {licenseId:license.id,activationKeyId:key?.id??null,capacity,used,available:Math.max(0,capacity-used),registers:rows.map(row=>({deviceId:row.id,name:row.registerName,hwid:row.deviceFingerprint,hostname:row.hostname,status:row.status,connected:Boolean(row.lastSeenAt&&Date.now()-row.lastSeenAt.getTime()<90000),appVersion:row.appVersion,lastSeenAt:row.lastSeenAt?.toISOString()??null,nameUpdatedAt:Number(row.nameUpdatedAt)||0}))};
 });
 app.post('/market-pos/customers/:id/register-capacity',async(req,reply)=>{
  if(!requireSuperadmin(req,reply))return;
  const params=Params.safeParse(req.params);if(!params.success)return reply.code(400).send({error:'Müştəri düzgün seçilməyib'});
  const body=parseBody(Capacity,req.body??{},reply);if(!body)return;
  const result=await app.db.transaction(async tx=>{
   // Serialize increments for the same licence, including accounts with no activation key.
   const [license]=await tx.select({id:licenses.id,seats:licenses.seats}).from(licenses).where(and(eq(licenses.customerId,params.data.id),eq(licenses.plan,'market'))).orderBy(desc(licenses.createdAt)).limit(1).for('update');
   if(!license)return null;
   const keys=await tx.select({id:activationKeys.id,maxDevices:activationKeys.maxDevices}).from(activationKeys).where(and(eq(activationKeys.licenseId,license.id),sql`${activationKeys.revokedAt} IS NULL`)).for('update');
   const previousCapacity=Math.max(license.seats,...keys.map(key=>key.maxDevices));
   const capacity=previousCapacity+body.amount;
   await tx.update(licenses).set({seats:capacity,updatedAt:new Date()}).where(eq(licenses.id,license.id));
   for(const key of keys)await tx.update(activationKeys).set({maxDevices:capacity}).where(eq(activationKeys.id,key.id));
   return {licenseId:license.id,activationKeyId:keys[0]?.id??null,capacity,previousCapacity};
  });
  if(!result)return reply.code(404).send({error:'Market lisenziyası tapılmadı'});
  await writeAudit(app,{actorUserId:currentUser(req).id,action:'market.registerCapacity.increase',entityType:'customer',entityId:params.data.id,ip:clientIp(req),meta:{amount:body.amount,...result}});
  return {ok:true,...result};
 });
}
