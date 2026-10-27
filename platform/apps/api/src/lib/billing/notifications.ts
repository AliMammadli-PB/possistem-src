import {sql} from 'drizzle-orm';
import {query,type Executor} from './store.js';
import {env} from '../../env.js';
import {isEmailConfigured,sendSmtpEmail,type SmtpMessage} from '../smtp.js';
import {emailFrom} from '../email-addresses.js';
import {escapeHtml,renderDetailRows,renderEmailTemplate} from '../email-template.js';

export type BillingNotice={customer_id:string;kind:string;title:string;body:string;payload:Record<string,unknown>};
// Invoices go out for payments from this release on; earlier test payments are not mailed.
const INVOICES_SINCE='2026-10-27T00:00:00Z';

export function renewalNotice(sub:{enabled?:boolean;paid_until:string|Date|null;monthly_amount_minor:number|string;auto_renew:boolean;product:string},now=new Date(),automaticAvailable=true){
 if(sub.enabled===false||!sub.paid_until)return null;
 const due=new Date(sub.paid_until),remaining=due.getTime()-now.getTime();
 if(remaining<=0||remaining>3*86400000)return null;
 const label=sub.product==='market'?'Market POS':sub.product==='restaurant'?'Restoran POS':sub.product;
 const amount=new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(Number(sub.monthly_amount_minor)/100);
 const date=due.toLocaleString('az-AZ',{timeZone:'Asia/Baku'});
 return {title:label+' — aylıq ödəniş yaxınlaşır',body:sub.auto_renew&&automaticAvailable?`${date} tarixində ${amount} kartınızdan tutulacaq. Kart balansınızı yoxlayın.`:`İstifadə müddəti ${date} tarixində bitir. Növbəti ay üçün ${amount} ödəyin.`,dueAt:due.toISOString(),amountMinor:Number(sub.monthly_amount_minor)};
}
/** Writes the owner's billing notices (bell + portal) and returns the ones new this sweep, for e-mail. */
export async function publishBillingNotifications(db:Executor,now:Date,automaticAvailable:boolean):Promise<BillingNotice[]>{
 const fresh:BillingNotice[]=[];
 const due=await query<{id:string;customer_id:string;enabled:boolean;product:string;paid_until:string;monthly_amount_minor:string;auto_renew:boolean}>(db,sql`SELECT s.* FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.enabled AND c.active AND s.paid_until>${now.toISOString()}::timestamptz AND s.paid_until<=${new Date(now.getTime()+3*86400000).toISOString()}::timestamptz`);
 for(const sub of due){const n=renewalNotice(sub,now,automaticAvailable);if(!n)continue;
  const payload={billingKey:'renewal:'+sub.id+':'+n.dueAt,product:sub.product,subscriptionId:sub.id,dueAt:n.dueAt,amountMinor:n.amountMinor,url:'/pos/app/abunelik'};
  fresh.push(...await query<BillingNotice>(db,sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload) VALUES(${sub.customer_id}::uuid,'billing_renewal',${n.title},${n.body},${JSON.stringify(payload)}::jsonb) ON CONFLICT DO NOTHING RETURNING customer_id::text,kind,title,body,payload`));
 }
 // Each material order state creates one notification, even after a restart.
 fresh.push(...await query<BillingNotice>(db,sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload)
 SELECT o.customer_id,'billing_order',o.order_no||' — sifariş yeniləndi',
 CASE o.status WHEN 'paid' THEN 'Ödəniş təsdiqləndi.' WHEN 'failed' THEN 'Ödəniş alınmadı.' WHEN 'refunded' THEN 'Ödəniş geri qaytarıldı.' WHEN 'paid_review' THEN 'Ödəniş alınıb. Sifariş əməkdaş tərəfindən yoxlanılır.' ELSE 'Sifariş vəziyyəti yeniləndi.' END ||
 CASE o.fulfillment_status WHEN 'ready' THEN ' Sifariş hazırdır.' WHEN 'dispatched' THEN ' Çatdırılmaya verildi.' WHEN 'completed' THEN ' Təhvil verildi.' ELSE '' END,
 jsonb_build_object('billingKey','order:'||o.id::text||':'||o.status||':'||o.fulfillment_status,'orderId',o.id,'url','/pos/app/sifarisler')
 FROM billing_orders o JOIN customers c ON c.id=o.customer_id WHERE c.active AND o.kind='shop' AND o.status IN ('paid','failed','refunded','paid_review') AND o.updated_at>${new Date(now.getTime()-30*86400000).toISOString()}::timestamptz ON CONFLICT DO NOTHING RETURNING customer_id::text,kind,title,body,payload`));
 // Every paid order - subscription month or shop order - gets one invoice, kept in the portal and e-mailed.
 fresh.push(...await query<BillingNotice>(db,sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload)
 SELECT o.customer_id,'billing_invoice','Invoice '||o.order_no||' — ödəniş qəbul edildi',
 CASE WHEN o.kind='shop' THEN 'Sifariş ödənişi qəbul edildi.' ELSE 'Aylıq abunə ödənişi qəbul edildi.' END,
 jsonb_build_object('billingKey','invoice:'||o.id::text,'orderId',o.id,'url',CASE WHEN o.kind='shop' THEN '/pos/app/sifarisler' ELSE '/pos/app/abunelik' END)
 FROM billing_orders o JOIN customers c ON c.id=o.customer_id WHERE c.active AND o.status='paid' AND o.paid_at>=${INVOICES_SINCE}::timestamptz AND o.paid_at>${new Date(now.getTime()-30*86400000).toISOString()}::timestamptz ON CONFLICT DO NOTHING RETURNING customer_id::text,kind,title,body,payload`));
 return fresh;
}

const money=(minorUnits:number)=>new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(Number(minorUnits)/100);
const bakuTime=(at:string|Date|null)=>at?new Date(at).toLocaleString('az-AZ',{timeZone:'Asia/Baku'}):'';
type InvoiceOrder={order_no:string;kind:string;amount_minor:number|string;paid_at:string|Date|null;delivery_fee_minor:number|string|null;product:string|null;period_start:string|Date|null;period_end:string|Date|null};
type InvoiceItem={name:string;qty:number;unit_price_minor:number|string};

/** The invoice body: what was paid, for which period, and who sold it (billing settings' legal block). */
export function invoiceHtml(o:InvoiceOrder,items:InvoiceItem[],buyer:string,legal:Record<string,string>){
 const product=o.product==='market'?'Market POS':o.product==='restaurant'?'Restoran POS':o.product||'POS';
 const lines=o.kind==='shop'?items.map(i=>`${i.name} × ${i.qty} — ${money(Number(i.unit_price_minor)*i.qty)}`):[`${product} — aylıq abunə`];
 if(o.kind==='shop'&&Number(o.delivery_fee_minor)>0)lines.push('Çatdırılma — '+money(Number(o.delivery_fee_minor)));
 return renderDetailRows([
  {label:'Invoice №',value:o.order_no},
  {label:'Ödəniş tarixi',value:bakuTime(o.paid_at)},
  {label:'Alıcı',value:buyer},
  {label:'Xidmət / mal',value:lines.join('; ')},
  {label:'Dövr',value:o.period_start&&o.period_end?bakuTime(o.period_start)+' — '+bakuTime(o.period_end):''},
  {label:'Məbləğ',value:money(Number(o.amount_minor))},
  {label:'Ödəniş üsulu',value:'Bank kartı (Epoint)'},
  {label:'Satıcı',value:[legal.sellerName,legal.voen?'VÖEN '+legal.voen:'',legal.address].filter(Boolean).join(', ')},
 ]);
}

/** E-mails each new notice to the owner; an invoice notice carries the full invoice. A failed send leaves the notice in the portal. */
export async function emailBillingNotices(db:Executor,notices:BillingNotice[],send:(m:SmtpMessage)=>Promise<boolean>=sendSmtpEmail){
 if(!notices.length||!isEmailConfigured())return 0;
 const [settings]=await query<{legal:Record<string,string>|null}>(db,sql`SELECT legal FROM billing_settings WHERE id=true`);
 let sent=0;
 for(const n of notices){
  const [c]=await query<{email:string;notify_email:string|null;name:string}>(db,sql`SELECT email,notify_email,name FROM customers WHERE id=${n.customer_id}::uuid`);
  const to=c?.notify_email||c?.email;if(!to)continue;
  let bodyHtml=`<p style="margin:0;white-space:pre-line;">${escapeHtml(n.body)}</p>`;
  if(n.kind==='billing_invoice'){
   const id=String(n.payload?.orderId||'');
   const [o]=await query<InvoiceOrder>(db,sql`SELECT o.order_no,o.kind,o.amount_minor,o.paid_at,o.delivery_fee_minor,s.product,g.period_start,g.period_end FROM billing_orders o LEFT JOIN billing_subscriptions s ON s.id=o.subscription_id LEFT JOIN billing_period_grants g ON g.order_id=o.id WHERE o.id=${id}::uuid`);
   if(!o)continue;
   const items=await query<InvoiceItem>(db,sql`SELECT name,qty,unit_price_minor FROM billing_order_items WHERE order_id=${id}::uuid`);
   bodyHtml+=invoiceHtml(o,items,c!.name,settings?.legal??{});
  }
  const {html,text}=renderEmailTemplate({preheader:n.title,eyebrow:n.kind==='billing_invoice'?'Invoice':'Ödəniş',title:n.title,bodyHtml,cta:{label:'Portalı aç',href:env.customerPortalUrl}});
  try{if(await send({from:emailFrom.admin(),replyTo:emailFrom.support(),to,subject:'[possistem] '+n.title,text,html}))sent++;}catch{/* kept in the portal */}
 }
 return sent;
}
