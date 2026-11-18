import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {BillingError} from './domain.js';
import {query,type Executor} from './store.js';

type Stamp=string|Date|null;
export type Buyer={name:string;email:string;contactPerson:string;phone:string;address:string;voen:string;snapshotAt:Stamp;snapshotSource:string};
export type DocumentOrder={id:string;order_no:string;kind:string;product:string|null;status:string;amount_minor:string|number;refunded_minor:string|number;currency:string;created_at:Stamp;paid_at:Stamp;period_start:Stamp;period_end:Stamp;delivery_fee_minor:string|number;recipient_name:string|null;delivery_address:string|null;note:string|null;payment_mode:string|null;terms_version:string|null};
export type PaymentProof={id:string;transaction_id:string|null;provider_order_id:string;kind:string;status:string;created_at:Stamp;updated_at:Stamp;card_mask:string|null;card_name:string|null;rrn:string|null;code:string|null;operation_code:string|null;message:string|null;amount:string|null};
export type ConsentProof={id:string;accepted_at:Stamp;withdrawn_at:Stamp;amount_minor:string|number;price_version:number;terms_version:string;ip_hash:string|null};
export type BillingDocument={order:DocumentOrder;items:{name:string;qty:number;unit_price_minor:number|string}[];invoice:{buyer:Buyer;seller:{name:string;voen:string;address:string;phone:string};sellerSource:string;payment:PaymentProof|null;payments:PaymentProof[];consent:ConsentProof|null;terms:Record<string,string>|null;events:{action:string;created_at:Stamp;source:string|null;transaction:string|null}[];dataSha256:string;generatedAt:string}};
const value=(x:unknown)=>typeof x==='string'?x:'';

/** Caller must authorize customerId. No card tokens, passwords, PINs or raw bank payloads leave this projection. */
export async function loadBillingDocument(db:Executor,customerId:string,id:string):Promise<BillingDocument>{
  const [row]=await query<DocumentOrder&{buyer_snapshot:Record<string,unknown>|null;buyer_snapshot_at:Stamp;buyer_snapshot_source:string;consent_id:string|null;price_version:number|null}>(db,sql`
    SELECT o.id,o.order_no,o.kind,o.amount_minor,o.refunded_minor,o.currency,o.status,o.fulfillment_status,o.delivery_kind,o.delivery_fee_minor,o.recipient_name,o.recipient_phone,o.delivery_address,o.delivery_details,o.estimated_at,o.updated_at,o.note,o.expires_at,o.paid_at,o.created_at,o.period_start,o.period_end,o.payment_mode,o.terms_version,o.consent_id,o.price_version,o.buyer_snapshot,o.buyer_snapshot_at,o.buyer_snapshot_source,o.admin_charge,s.product
    FROM billing_orders o LEFT JOIN billing_subscriptions s ON s.id=o.subscription_id
    WHERE o.id=${id}::uuid AND o.customer_id=${customerId}::uuid`);
  if(!row)throw new BillingError('order_missing','Sifariş tapılmadı.',404);
  const items=await query<BillingDocument['items'][number]>(db,sql`SELECT product_id,name,qty,unit_price_minor FROM billing_order_items WHERE order_id=${id}::uuid ORDER BY product_id`);
  const [archived]=await query<{content:Record<string,string>}>(db,sql`SELECT content FROM billing_terms WHERE version=${row.terms_version}`);
  const [settings]=archived?[]:await query<{legal:Record<string,string>}>(db,sql`SELECT legal FROM billing_settings WHERE id=true`);
  const legal=archived?.content??settings?.legal??{};
  const payments=await query<PaymentProof>(db,sql`SELECT id,transaction_id,provider_order_id,kind,status,created_at,updated_at,
    response->>'card_mask' AS card_mask,response->>'card_name' AS card_name,response->>'rrn' AS rrn,response->>'code' AS code,response->>'operation_code' AS operation_code,response->>'message' AS message,response->>'amount' AS amount
    FROM billing_attempts WHERE order_id=${id}::uuid ORDER BY created_at,id`);
  const [consent]=await query<ConsentProof>(db,sql`SELECT c.id,c.accepted_at,c.withdrawn_at,c.amount_minor,c.price_version,c.terms_version,c.ip_hash
    FROM billing_consents c JOIN billing_subscriptions s ON s.id=c.subscription_id
    JOIN billing_orders o ON o.subscription_id=c.subscription_id AND o.consent_id=c.id
    WHERE o.id=${id}::uuid AND s.customer_id=${customerId}::uuid AND c.amount_minor=o.amount_minor AND c.price_version=o.price_version AND c.terms_version=o.terms_version`);
  const events=await query<BillingDocument['invoice']['events'][number]>(db,sql`SELECT action,created_at,detail->>'source' AS source,detail->>'transaction' AS transaction
    FROM billing_events WHERE entity_id=${id} AND action IN ('payment.succeeded','payment.failed','payment.unknown','refund.succeeded') ORDER BY created_at,id`);
  const {buyer_snapshot:snapshot,buyer_snapshot_at,buyer_snapshot_source,consent_id:_consentId,price_version:_priceVersion,...order}=row;
  const buyer:Buyer={name:value(snapshot?.name),email:value(snapshot?.email),contactPerson:value(snapshot?.contact_person),phone:value(snapshot?.phone),address:value(snapshot?.address),voen:value(snapshot?.voen),snapshotAt:buyer_snapshot_at,snapshotSource:buyer_snapshot_source};
  const payment=[...payments].reverse().find(p=>p.kind!=='refund'&&p.status==='succeeded')??null;
  const evidence={order,items,buyer,seller:{name:legal.sellerName??'',voen:legal.voen??'',address:legal.address??'',phone:legal.phone??''},sellerSource:archived?'accepted_terms':'current_settings',payment,payments,consent:consent??null,terms:archived?.content??null,events};
  const dataSha256=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const {order:_order,items:_items,...invoice}=evidence;
  return {order,items,invoice:{...invoice,dataSha256,generatedAt:new Date().toISOString()}};
}
