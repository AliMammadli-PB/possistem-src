import { sql } from 'drizzle-orm';
import type { Db } from '@milioner/database';
import { BillingError } from './domain.js';
import { query, event, type Executor } from './store.js';
import type { Billing } from './service.js';

// Customers only ask to cancel; an admin decides. Refunds are admin-only and go through Billing.refund.
const reject=(code:string,message:string,status=409):never=>{throw new BillingError(code,message,status);};
// Same advisory key as Billing so a renewal and a cancellation never interleave.
const lockSubscription=(db:Executor,id:string)=>db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing-sub:'+id}))`);
const productName:Record<string,string>={market:'Market POS',restaurant:'Restoran POS',geyim:'Geyim POS',aptek:'Aptek POS',topdan:'Topdan POS'};
const bakuDate=(v:string|Date)=>new Date(v).toLocaleDateString('az-AZ',{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric'});
const money=(minor:number)=>(minor/100).toFixed(2)+' ₼';

type Sub={id:string;customer_id:string;product:string;paid_until:string|null;auto_renew:boolean;cancelled_at:string|null};
type Request={id:string;subscription_id:string;customer_id:string;status:string};

async function notify(db:Executor,customerId:string,title:string,body:string,payload:Record<string,unknown>){
  await db.execute(sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload) VALUES(${customerId}::uuid,'billing_cancel',${title},${body},${JSON.stringify({url:'/abunelik',...payload})}::jsonb)`);
}

export async function requestCancel(db:Db,customerId:string,subscriptionId:string,input:{reason:string;details:string}){
  return db.transaction(async tx=>{
    await lockSubscription(tx,subscriptionId);
    const [sub]=await query<Sub>(tx,sql`SELECT * FROM billing_subscriptions WHERE id=${subscriptionId}::uuid AND customer_id=${customerId}::uuid FOR UPDATE`);
    if(!sub)reject('subscription_missing','Abunəlik tapılmadı.',404);
    if(sub!.cancelled_at&&!sub!.auto_renew)reject('already_cancelled','Bu abunəlik artıq ləğv edilib.');
    const [open]=await query(tx,sql`SELECT id FROM billing_cancel_requests WHERE subscription_id=${subscriptionId}::uuid AND status='pending'`);
    if(open)reject('request_pending','Ləğv sorğunuz artıq göndərilib, cavab gözlənilir.');
    const [row]=await query<{id:string}>(tx,sql`INSERT INTO billing_cancel_requests(subscription_id,customer_id,reason,details) VALUES(${subscriptionId}::uuid,${customerId}::uuid,${input.reason},${input.details}) RETURNING id`);
    await event(tx,customerId,'cancel.request',subscriptionId,{requestId:row!.id,reason:input.reason});
    return {ok:true,id:row!.id};
  });
}

export type Decision={requestId?:string;action:'cancel'|'reject';mode?:'period_end'|'immediate';refundOrderIds:string[];refundPercent?:number;note:string};

/** Cancels or declines. Refunds run first, so a bank refusal stops before anything is cancelled. */
export async function decideCancel(db:Db,billing:Billing,actor:string,subscriptionId:string,d:Decision){
  const [sub]=await query<Sub>(db,sql`SELECT * FROM billing_subscriptions WHERE id=${subscriptionId}::uuid`);
  if(!sub)reject('subscription_missing','Abunəlik tapılmadı.',404);
  if(d.requestId){
    const [r]=await query<Request>(db,sql`SELECT * FROM billing_cancel_requests WHERE id=${d.requestId}::uuid`);
    if(!r||r.subscription_id!==subscriptionId)reject('request_missing','Sorğu tapılmadı.',404);
    if(r!.status!=='pending')reject('request_decided','Bu sorğuya artıq cavab verilib.');
  }
  if(d.action==='reject'){
    if(!d.requestId)reject('request_missing','İmtina üçün müştəri sorğusu lazımdır.',400);
    if(d.note.trim().length<3)reject('note_required','Müştəriyə imtina səbəbini yazın.',400);
  }else{
    if(!d.mode)reject('mode_required','Ləğvin vaxtını seçin.',400);
    if(!d.refundOrderIds.length&&d.note.trim().length<3)reject('note_required','Pul qaytarılmırsa, səbəbini müştəriyə yazın.',400);
    if(d.refundOrderIds.length&&(d.refundPercent??100)<100&&d.note.trim().length<3)reject('note_required','Məbləğin hamısı qaytarılmırsa, səbəbini müştəriyə yazın.',400);
  }
  // Admin may refund any paid payment of this customer, never someone else's.
  const pct=Math.min(100,Math.max(1,Math.round(d.refundPercent??100)));
  const refunds:{order_no:string;amount_minor:number;paid_minor:number}[]=[];
  if(d.action==='cancel')for(const orderId of d.refundOrderIds){
    const [o]=await query<{id:string;order_no:string;amount_minor:string;status:string}>(db,sql`SELECT id,order_no,amount_minor,status FROM billing_orders WHERE id=${orderId}::uuid AND customer_id=${sub!.customer_id}::uuid AND paid_at IS NOT NULL`);
    if(!o)reject('order_missing','Qaytarılacaq ödəniş bu müştəriyə aid deyil.',400);
    if(!['paid','paid_review'].includes(o!.status))continue;
    const part=pct===100?Number(o!.amount_minor):Math.max(1,Math.round(Number(o!.amount_minor)*pct/100));
    const r=await billing.refund(actor,o!.id,d.note.trim()||'Abunəlik ləğvi',part);
    if(r&&'ok' in r&&r.ok===false)reject('refund_failed',o!.order_no+': '+(('error' in r&&r.error)||'Bank geri qaytarmanı təsdiqləmədi.')+' Abunəlik ləğv edilmədi.');
    refunds.push({order_no:o!.order_no,amount_minor:part,paid_minor:Number(o!.amount_minor)});
  }
  return db.transaction(async tx=>{
    await lockSubscription(tx,subscriptionId);
    const [s]=await query<Sub>(tx,sql`SELECT * FROM billing_subscriptions WHERE id=${subscriptionId}::uuid FOR UPDATE`);
    const name=productName[s!.product]??s!.product;
    let requestId=d.requestId;
    if(!requestId){
      await tx.execute(sql`UPDATE billing_cancel_requests SET status='cancelled',decision_note='Admin birbaşa ləğv etdi',decided_by=${actor},decided_at=now() WHERE subscription_id=${subscriptionId}::uuid AND status='pending'`);
      const [r]=await query<{id:string}>(tx,sql`INSERT INTO billing_cancel_requests(subscription_id,customer_id,source,reason) VALUES(${subscriptionId}::uuid,${s!.customer_id}::uuid,'admin','Admin qərarı') RETURNING id`);
      requestId=r!.id;
    }
    if(d.action==='reject'){
      await tx.execute(sql`UPDATE billing_cancel_requests SET status='rejected',decision_note=${d.note.trim()},decided_by=${actor},decided_at=now() WHERE id=${requestId}::uuid`);
      await event(tx,actor,'cancel.reject',subscriptionId,{requestId,note:d.note.trim()});
      await notify(tx,s!.customer_id,name+' — ləğv sorğusu qəbul edilmədi',d.note.trim(),{requestId});
      return {ok:true,status:'rejected'};
    }
    const now=new Date();
    const immediate=d.mode==='immediate'||!s!.paid_until||new Date(s!.paid_until)<=now;
    if(immediate){
      await tx.execute(sql`UPDATE billing_subscriptions SET paid_until=LEAST(COALESCE(paid_until,now()),now()) WHERE id=${subscriptionId}::uuid`);
      await tx.execute(sql`UPDATE licenses l SET valid_until=s.paid_until,status='expired',updated_at=now() FROM billing_subscriptions s,billing_license_links b WHERE s.id=${subscriptionId}::uuid AND b.subscription_id=s.id AND l.id=b.license_id AND l.status NOT IN ('revoked','suspended')`);
      await tx.execute(sql`UPDATE activation_keys a SET expires_at=s.paid_until FROM billing_subscriptions s,billing_license_links b WHERE s.id=${subscriptionId}::uuid AND b.subscription_id=s.id AND a.license_id=b.license_id AND a.revoked_at IS NULL`);
    }
    // No further debits: renewal needs auto_renew, a live consent and the stored card token.
    const [after]=await query<{paid_until:string|null}>(tx,sql`UPDATE billing_subscriptions SET auto_renew=false,consent_version=NULL,card_ciphertext=NULL,card_mask=NULL,cancelled_at=now(),cancel_effective_at=CASE WHEN ${immediate} THEN now() ELSE paid_until END,updated_at=now() WHERE id=${subscriptionId}::uuid RETURNING paid_until`);
    await tx.execute(sql`UPDATE billing_consents SET withdrawn_at=now() WHERE subscription_id=${subscriptionId}::uuid AND withdrawn_at IS NULL`);
    const effective=immediate?now:new Date(after!.paid_until!);
    await tx.execute(sql`UPDATE billing_cancel_requests SET status='cancelled',cancel_mode=${immediate?'immediate':'period_end'},effective_at=${effective.toISOString()}::timestamptz,refund_order_ids=${'{'+d.refundOrderIds.join(',')+'}'}::uuid[],decision_note=${d.note.trim()},decided_by=${actor},decided_at=now() WHERE id=${requestId}::uuid`);
    await event(tx,actor,'cancel.accept',subscriptionId,{requestId,mode:immediate?'immediate':'period_end',refunds,note:d.note.trim()});
    const when=immediate?'Abunəlik dərhal dayandırıldı.':'Abunəlik '+bakuDate(effective)+' tarixinədək işləyəcək, sonra yenilənməyəcək.';
    const money_=refunds.length?'Geri qaytarılır: '+refunds.map(r=>money(r.amount_minor)+(r.amount_minor<r.paid_minor?' ('+money(r.paid_minor)+' ödənişin '+pct+'%-i)':'')+' — '+r.order_no).join(', ')+'. Bankdan asılı olaraq hesaba 1–10 iş günü ərzində düşür.':'Ödənilmiş məbləğ geri qaytarılmır'+(d.note.trim()?': '+d.note.trim():'.');
    await notify(tx,s!.customer_id,name+' — abunəlik ləğv edildi',[when,'Kartınızdan artıq avtomatik ödəniş tutulmayacaq.',money_,refunds.length&&d.note.trim()?(pct<100?'Tam qaytarılmama səbəbi: ':'Qeyd: ')+d.note.trim():''].filter(Boolean).join(' '),{requestId});
    return {ok:true,status:'cancelled',effectiveAt:effective.toISOString(),refunds};
  });
}

/** Every amount that moved: payments (+) and refunds (−), newest first. */
export async function ledger(db:Executor,customerId:string|null,limit=500){
  const rows=await query<{type:string;order_id:string;order_no:string;kind:string;product:string|null;amount_minor:string;at:string;status:string;customer_id:string;customer_name:string;email:string;transaction_id:string|null;card_mask:string|null;note:string|null;refunded_minor:string}>(db,sql`
    SELECT * FROM (
      SELECT 'payment' AS type,o.id AS order_id,o.order_no,o.kind,s.product,o.amount_minor,o.paid_at AS at,o.status,o.customer_id,c.name AS customer_name,c.email,a.transaction_id,a.response->>'card_mask' AS card_mask,CASE WHEN o.admin_charge THEN o.note END AS note,o.refunded_minor
      FROM billing_orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN billing_subscriptions s ON s.id=o.subscription_id
      LEFT JOIN LATERAL (SELECT transaction_id,response FROM billing_attempts WHERE order_id=o.id AND kind<>'refund' AND status='succeeded' ORDER BY created_at DESC LIMIT 1) a ON true
      WHERE o.paid_at IS NOT NULL AND (${customerId}::uuid IS NULL OR o.customer_id=${customerId}::uuid)
      UNION ALL
      SELECT 'refund',o.id,o.order_no,o.kind,s.product,-COALESCE(r.amount_minor,o.amount_minor),r.updated_at,r.status,o.customer_id,c.name,c.email,r.transaction_id,NULL,
        (SELECT e.detail->>'reason' FROM billing_events e WHERE e.action='refund.request' AND e.detail->>'attemptId'=r.id::text LIMIT 1),0::bigint
      FROM billing_attempts r JOIN billing_orders o ON o.id=r.order_id JOIN customers c ON c.id=o.customer_id LEFT JOIN billing_subscriptions s ON s.id=o.subscription_id
      WHERE r.kind='refund' AND r.status<>'failed' AND (${customerId}::uuid IS NULL OR o.customer_id=${customerId}::uuid)
    ) x ORDER BY at DESC LIMIT ${limit}`);
  const paid=rows.filter(r=>r.type==='payment').reduce((n,r)=>n+Number(r.amount_minor),0);
  const refunded=rows.filter(r=>r.type==='refund'&&r.status==='refunded').reduce((n,r)=>n-Number(r.amount_minor),0);
  const pending=rows.filter(r=>r.type==='refund'&&r.status!=='refunded').reduce((n,r)=>n-Number(r.amount_minor),0);
  return {entries:rows.map(r=>({...r,amount_minor:Number(r.amount_minor),refunded_minor:Number(r.refunded_minor)})),totals:{paidMinor:paid,refundedMinor:refunded,refundPendingMinor:pending,netMinor:paid-refunded}};
}

export async function cancelRequests(db:Executor,customerId:string|null){
  return query(db,sql`SELECT r.*,s.product,s.paid_until,s.auto_renew,s.monthly_amount_minor,c.name AS customer_name,c.email,
      (SELECT coalesce(json_agg(json_build_object('orderNo',o.order_no,'amountMinor',COALESCE(NULLIF(o.refunded_minor,0),(SELECT x.amount_minor FROM billing_attempts x WHERE x.order_id=o.id AND x.kind='refund' AND x.status<>'failed' ORDER BY x.created_at DESC LIMIT 1),o.amount_minor),'paidMinor',o.amount_minor,'status',o.status)),'[]') FROM billing_orders o WHERE o.id=ANY(r.refund_order_ids)) AS refunds
    FROM billing_cancel_requests r JOIN billing_subscriptions s ON s.id=r.subscription_id JOIN customers c ON c.id=r.customer_id
    WHERE ${customerId}::uuid IS NULL OR r.customer_id=${customerId}::uuid ORDER BY (r.status='pending') DESC,r.created_at DESC LIMIT 300`);
}

/** What the admin needs to decide: the subscription and every payment of its customer. */
export async function cancelContext(db:Executor,subscriptionId:string){
  const [sub]=await query<{customer_id:string}>(db,sql`SELECT s.id,s.customer_id,s.product,s.paid_until,s.auto_renew,s.card_mask,s.monthly_amount_minor,s.cancelled_at,s.cancel_effective_at,c.name,c.email FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=${subscriptionId}::uuid`);
  if(!sub)reject('subscription_missing','Abunəlik tapılmadı.',404);
  const orders=await query(db,sql`SELECT id,order_no,kind,amount_minor,refunded_minor,status,paid_at,period_start,period_end,subscription_id,admin_charge,note FROM billing_orders WHERE customer_id=${sub!.customer_id}::uuid AND paid_at IS NOT NULL ORDER BY paid_at DESC LIMIT 100`);
  const [pending]=await query(db,sql`SELECT * FROM billing_cancel_requests WHERE subscription_id=${subscriptionId}::uuid AND status='pending'`);
  return {subscription:sub,orders,pendingRequest:pending??null};
}
