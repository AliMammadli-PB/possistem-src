import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@milioner/database';
import { BillingError, amount } from './domain.js';
import { decryptCard } from './epoint.js';
import { query, event } from './store.js';
import type { Billing } from './service.js';

const reject=(code:string,message:string,status=409):never=>{throw new BillingError(code,message,status);};
const money=(minor:number)=>(minor/100).toFixed(2)+' ₼';

/**
 * One-off charge an admin takes from a customer's saved card (merchant-initiated).
 * It becomes its own paid order, so it shows in every history and can be refunded like any payment.
 * The admin must confirm the cardholder agreed; the customer is notified either way.
 */
export async function chargeSavedCard(db:Db,billing:Billing,actor:string,subscriptionId:string,input:{requestId:string;amountMinor:number;description:string;consent:true}){
  const {gateway}=await billing.available();
  const prepared=await db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing-sub:'+subscriptionId}))`);
    const [sub]=await query<{customer_id:string;card_ciphertext:string|null;card_mask:string|null;name:string;active:boolean}>(tx,sql`SELECT s.customer_id,s.card_ciphertext,s.card_mask,c.name,c.active FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=${subscriptionId}::uuid FOR UPDATE OF s`);
    if(!sub)reject('subscription_missing','Abunəlik tapılmadı.',404);
    if(!sub!.active)reject('customer_inactive','Müştəri hesabı aktiv deyil.');
    if(!sub!.card_ciphertext)reject('card_missing','Bu müştərinin saxlanmış kartı yoxdur.');
    // The same click (requestId) never charges twice.
    const [prior]=await query<{id:string}>(tx,sql`SELECT id FROM billing_orders WHERE customer_id=${sub!.customer_id}::uuid AND request_key=${input.requestId}::uuid`);
    if(prior)return {orderId:prior.id,reused:true as const};
    const [order]=await query<{id:string;order_no:string}>(tx,sql`INSERT INTO billing_orders(order_no,customer_id,kind,amount_minor,request_key,request_hash,delivery_kind,recipient_name,status,note,admin_charge)
      VALUES(${'KRT-'+randomUUID()},${sub!.customer_id}::uuid,'shop',${input.amountMinor},${input.requestId}::uuid,${'admin-charge'},'pickup',${sub!.name},'processing',${input.description},true) RETURNING id,order_no`);
    const [attempt]=await query<{id:string;provider_order_id:string}>(tx,sql`INSERT INTO billing_attempts(order_id,provider_order_id,kind,status) VALUES(${order!.id}::uuid,${'AUTO-'+randomUUID()},'recurring','sending') RETURNING id,provider_order_id`);
    await event(tx,actor,'payment.admin_charge',order!.id,{subscriptionId,amountMinor:input.amountMinor,description:input.description,cardholderConsent:true,attemptId:attempt!.id});
    return {orderId:order!.id,orderNo:order!.order_no,attempt:attempt!,customerId:sub!.customer_id,card:sub!.card_ciphertext!,cardMask:sub!.card_mask};
  });
  if('reused' in prepared)return result(db,prepared.orderId);
  try{
    // Ciphertext is decrypted only for this outgoing server-to-bank call.
    const response=await gateway.call('execute-pay',{card_id:decryptCard(prepared.card,gateway.config.tokenKey),order_id:prepared.attempt.provider_order_id,amount:Number(amount(input.amountMinor)),currency:'AZN',language:'az',description:input.description.slice(0,200)});
    await billing.recordResult(prepared.attempt.id,response,'execute');
  }catch{await billing.markUnknown(prepared.attempt.id);}
  const r=await result(db,prepared.orderId);
  if(r.status==='paid'){
    await db.execute(sql`UPDATE billing_orders SET fulfillment_status='completed' WHERE id=${prepared.orderId}::uuid`);
    await db.execute(sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload) VALUES(${prepared.customerId}::uuid,'billing_invoice',${'Kartınızdan '+money(input.amountMinor)+' tutuldu'},${input.description+(prepared.cardMask?' · Kart '+prepared.cardMask:'')+'. Faktura ödəniş tarixçənizdədir.'},${JSON.stringify({url:'/faturalar/'+prepared.orderId,orderId:prepared.orderId})}::jsonb)`);
  }
  return r;
}

async function result(db:Db,orderId:string){
  const [o]=await query<{id:string;order_no:string;status:string;amount_minor:string;message:string|null}>(db,sql`SELECT o.id,o.order_no,o.status,o.amount_minor,(SELECT a.response->>'message' FROM billing_attempts a WHERE a.order_id=o.id AND a.kind<>'refund' ORDER BY a.created_at DESC LIMIT 1) AS message FROM billing_orders o WHERE o.id=${orderId}::uuid`);
  return {orderId:o!.id,orderNo:o!.order_no,status:o!.status,amountMinor:Number(o!.amount_minor),bankMessage:o!.message};
}
