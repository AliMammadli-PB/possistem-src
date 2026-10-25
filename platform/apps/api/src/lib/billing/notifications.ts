import {sql} from 'drizzle-orm';
import {query,type Executor} from './store.js';

export function renewalNotice(sub:{enabled?:boolean;paid_until:string|Date|null;monthly_amount_minor:number|string;auto_renew:boolean;product:string},now=new Date(),automaticAvailable=true){
 if(sub.enabled===false||!sub.paid_until)return null;
 const due=new Date(sub.paid_until),remaining=due.getTime()-now.getTime();
 if(remaining<=0||remaining>3*86400000)return null;
 const label=sub.product==='market'?'Market POS':sub.product==='restaurant'?'Restoran POS':sub.product;
 const amount=new Intl.NumberFormat('az-AZ',{style:'currency',currency:'AZN'}).format(Number(sub.monthly_amount_minor)/100);
 const date=due.toLocaleString('az-AZ',{timeZone:'Asia/Baku'});
 return {title:label+' — aylıq ödəniş yaxınlaşır',body:sub.auto_renew&&automaticAvailable?`${date} tarixində ${amount} kartınızdan tutulacaq. Kart balansınızı yoxlayın.`:`İstifadə müddəti ${date} tarixində bitir. Növbəti ay üçün ${amount} ödəyin.`,dueAt:due.toISOString(),amountMinor:Number(sub.monthly_amount_minor)};
}
export async function publishBillingNotifications(db:Executor,now:Date,automaticAvailable:boolean){
 const due=await query<{id:string;customer_id:string;enabled:boolean;product:string;paid_until:string;monthly_amount_minor:string;auto_renew:boolean}>(db,sql`SELECT s.* FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.enabled AND c.active AND s.paid_until>${now.toISOString()}::timestamptz AND s.paid_until<=${new Date(now.getTime()+3*86400000).toISOString()}::timestamptz`);
 for(const sub of due){const n=renewalNotice(sub,now,automaticAvailable);if(!n)continue;
  const payload={billingKey:'renewal:'+sub.id+':'+n.dueAt,product:sub.product,subscriptionId:sub.id,dueAt:n.dueAt,amountMinor:n.amountMinor,url:'/pos/app/abunelik'};
  await db.execute(sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload) VALUES(${sub.customer_id}::uuid,'billing_renewal',${n.title},${n.body},${JSON.stringify(payload)}::jsonb) ON CONFLICT DO NOTHING`);
 }
 // Each material order state creates one notification, even after a restart.
 await db.execute(sql`INSERT INTO owner_notifications(customer_id,kind,title,body,payload)
 SELECT o.customer_id,'billing_order',o.order_no||' — sifariş yeniləndi',
 CASE o.status WHEN 'paid' THEN 'Ödəniş təsdiqləndi.' WHEN 'failed' THEN 'Ödəniş alınmadı.' WHEN 'refunded' THEN 'Ödəniş geri qaytarıldı.' WHEN 'paid_review' THEN 'Ödəniş alınıb. Sifariş əməkdaş tərəfindən yoxlanılır.' ELSE 'Sifariş vəziyyəti yeniləndi.' END ||
 CASE o.fulfillment_status WHEN 'ready' THEN ' Sifariş hazırdır.' WHEN 'dispatched' THEN ' Çatdırılmaya verildi.' WHEN 'completed' THEN ' Təhvil verildi.' ELSE '' END,
 jsonb_build_object('billingKey','order:'||o.id::text||':'||o.status||':'||o.fulfillment_status,'orderId',o.id,'url','/pos/app/sifarisler')
 FROM billing_orders o JOIN customers c ON c.id=o.customer_id WHERE c.active AND o.kind='shop' AND o.status IN ('paid','failed','refunded','paid_review') AND o.updated_at>${new Date(now.getTime()-30*86400000).toISOString()}::timestamptz ON CONFLICT DO NOTHING`);
}
