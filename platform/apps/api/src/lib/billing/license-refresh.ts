import {and,eq} from 'drizzle-orm';
import {devices,licenses,customers,type Db} from '@milioner/database';
import {deriveKeyId,signLicensePayload,toHex} from '@milioner/security';
import {loadOrCreateSigningKeys} from '../keys.js';
import {licenseBilling} from './service.js';

// A heartbeat carries a fresh device-bound signature after renewal. The same
// signing identity as activation is used; a redirect never creates this proof.
export async function billingLicenseRefresh(db:Db,deviceId:string){
 const [row]=await db.select({device:devices,license:licenses,customer:customers}).from(devices).innerJoin(licenses,eq(devices.licenseId,licenses.id)).innerJoin(customers,eq(licenses.customerId,customers.id)).where(and(eq(devices.id,deviceId),eq(customers.active,true))).limit(1);
 if(!row||row.device.status==='revoked'||['revoked','suspended'].includes(row.license.status))return null;
 const billing=await licenseBilling(db,row.license.id);if(!billing)return null;
 const keys=loadOrCreateSigningKeys(),l=row.license,d=row.device;
 if(billing.accessUntil||billing.paidUntil)l.validUntil=new Date((billing.accessUntil||billing.paidUntil)!);
 const payload={licenseId:l.id,customerId:l.customerId,customerEmail:row.customer.email,plan:l.plan,seats:l.seats,features:{...(l.features??{}),billingManaged:true,billingStatus:billing.billingStatus,billingAccessMode:billing.accessMode,trialUntil:billing.trialUntil,offlineGraceDays:0},deviceId:d.id,deviceFingerprint:d.deviceFingerprint,devicePublicKey:d.devicePublicKey,validUntil:l.validUntil?.toISOString()??null,expiresAt:l.validUntil?.getTime()??0,status:billing.hasAccess?'active':'expired',offlineGraceDays:0,...billing};
 return {license:{id:l.id,customerId:l.customerId,status:payload.status,plan:l.plan,seats:l.seats,validUntil:payload.validUntil,features:payload.features,...billing},device:d,signedLicense:signLicensePayload(keys.privateKey,payload,keys.publicKey),signingKey:{algorithm:'Ed25519',keyId:deriveKeyId(keys.publicKey),publicKeyHex:toHex(keys.publicKey)}};
}
