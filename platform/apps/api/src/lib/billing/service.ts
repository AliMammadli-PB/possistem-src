import {TEST_PRODUCT_ID} from './test-shop.js';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@milioner/database';
import { BillingError, amount, minor, nextMonth, localDay, subscriptionState, MAX_MINOR } from './domain.js';
import { Epoint, epointConfig, decryptCard, encryptCard, safeGatewayResponse, type EpointResponse } from './epoint.js';
import { event, query, type Executor, type Subscription } from './store.js';
import { importCatalog, type CommerceProduct } from './catalog.js';
import { trustedPartnerPrices } from './partner.js';

type Order = {
  id:string; order_no:string; customer_id:string; kind:'subscription'|'shop'; subscription_id:string|null;
  amount_minor:number|string; price_version:number|null; status:string; paid_at:string|Date|null;
  consent_id:string|null; save_card_consent:boolean; expires_at:string|Date|null;
};
type Attempt = {id:string;order_id:string;provider_order_id:string;kind:string;status:string;transaction_id:string|null;redirect_url:string|null;created_at:string|Date};
export type Settings = {enforcement_enabled:boolean;enabled:boolean;recurring_enabled:boolean;pickup_address:string;delivery_fee_minor:number|string|null;legal:Record<string,unknown>};
export type Shipping = {kind:'pickup'|'delivery';name:string;phone:string;address:string};
type QuotePayload = {items:{id:string;name:string;qty:number;unitPriceMinor:number}[];shipping:Shipping;deliveryFeeMinor:number;partnerProof?:string;termsVersion:string};
const iso=(value:string|Date)=>new Date(value).toISOString();
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const billUrl='https://possistem.az/pos/app/abunelik';
function publicOrder(order:Order){return {id:order.id,number:order.order_no,kind:order.kind,status:order.status,amountMinor:Number(order.amount_minor)};}
async function lockSubscription(db:Executor,id:string){await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing-sub:'+id}))`);}
const reject=(code:string,message:string,status=409):never=>{throw new BillingError(code,message,status);};

export class Billing {
  constructor(readonly db:Db,private options:{gateway?:Epoint;allowLive?:boolean;now?:()=>Date}={}){}
  now(){return this.options.now?.()??new Date();}
  gateway(){const config=epointConfig();return this.options.gateway??(config?new Epoint(config):null);}
  async settings():Promise<Settings>{const [row]=await query<Settings>(this.db,sql`SELECT * FROM billing_settings WHERE id=true`);return row!;}
  async available(recurring=false){
    const settings=await this.settings(),gateway=this.gateway();
    if(!settings.enabled||!gateway||(!gateway.config.liveVerified&&!this.options.allowLive))reject('payments_unavailable','Onlayn ödəniş hələ aktivləşdirilməyib.',503);
    if(recurring&&!settings.recurring_enabled)reject('recurring_unavailable','Avtomatik yenilənmə hazırda aktiv deyil.',503);
    return {settings,gateway:gateway!};
  }

  async listSubscriptions(customerId:string){
    const rows=await query<Subscription & {has_paid_subscription:boolean}>(this.db,sql`SELECT s.*,EXISTS(SELECT 1 FROM billing_period_grants g WHERE g.subscription_id=s.id) AS has_paid_subscription FROM billing_subscriptions s WHERE s.customer_id=${customerId}::uuid ORDER BY product`);
    const settings=await this.settings(),gateway=this.gateway();
    return {subscriptions:rows.map(s=>({id:s.id,product:s.product,hasPaidSubscription:s.has_paid_subscription,monthlyAmountMinor:Number(s.monthly_amount_minor),currency:'AZN',paidUntil:s.paid_until,state:subscriptionState(s.enabled,s.paid_until,this.now().getTime()),setupAccess:!settings.enforcement_enabled,priceVersion:s.price_version,autoRenew:s.auto_renew,cardMask:s.card_mask,hasSavedCard:Boolean(s.card_ciphertext),paymentUrl:billUrl})),paymentsAvailable:settings.enabled&&Boolean(gateway?.config.liveVerified||this.options.allowLive),enforcementEnabled:settings.enforcement_enabled,recurringAvailable:settings.recurring_enabled,termsVersion:settings.legal?.version??null};
  }

  async configureSubscription(actor:string,input:{customerId:string;product:string;monthlyAmountMinor:number;enabled:boolean;startsAt?:string}){
    const {customerId,product,monthlyAmountMinor,enabled}=input;
    return this.db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'billing:'+customerId+':'+product}))`);
      const [customer]=await query(tx,sql`SELECT id FROM customers WHERE id=${customerId}::uuid AND active=true FOR SHARE`);
      if(!customer)reject('customer_missing','Aktiv müştəri tapılmadı.',404);
      const existing=await query<Subscription>(tx,sql`SELECT * FROM billing_subscriptions WHERE customer_id=${customerId}::uuid AND product=${product}`);
      if(existing[0])await lockSubscription(tx,existing[0].id);
      const eligible=await query<{id:string;valid_until:string|null}>(tx,sql`SELECT id,valid_until FROM licenses WHERE customer_id=${customerId}::uuid AND COALESCE(features->>'vertical',features->>'product',CASE WHEN plan='market' THEN 'market' ELSE 'restaurant' END)=${product} AND status NOT IN ('revoked','suspended') ORDER BY id FOR UPDATE`);
      if(!eligible.length)reject('license_missing','Əvvəl bu müştəriyə uyğun POS lisenziyası əlavə edin.');
      if(!existing.length&&eligible.some(x=>x.valid_until===null)&&!input.startsAt)reject('unlimited_license','Müddətsiz lisenziya üçün ilk ödəniş tarixini ayrıca seçin.');
      const until=input.startsAt??eligible.reduce<string|null>((best,l)=>l.valid_until&&(!best||new Date(l.valid_until)>new Date(best))?iso(l.valid_until):best,null);
      const [sub]=await query<Subscription>(tx,sql`INSERT INTO billing_subscriptions(customer_id,product,monthly_amount_minor,enabled,paid_until)
        VALUES(${customerId}::uuid,${product},${monthlyAmountMinor},${enabled},${until}::timestamptz)
        ON CONFLICT(customer_id,product) DO UPDATE SET monthly_amount_minor=EXCLUDED.monthly_amount_minor,enabled=EXCLUDED.enabled,
          price_version=billing_subscriptions.price_version+CASE WHEN billing_subscriptions.monthly_amount_minor<>EXCLUDED.monthly_amount_minor THEN 1 ELSE 0 END,
          auto_renew=CASE WHEN billing_subscriptions.monthly_amount_minor<>EXCLUDED.monthly_amount_minor OR NOT EXCLUDED.enabled THEN false ELSE billing_subscriptions.auto_renew END,updated_at=now()
        RETURNING *`);
      for(const l of eligible)await tx.execute(sql`INSERT INTO billing_license_links(subscription_id,license_id) VALUES(${sub!.id}::uuid,${l.id}::uuid) ON CONFLICT DO NOTHING`);
      await tx.execute(sql`UPDATE licenses l SET features=COALESCE(features,'{}'::jsonb)||jsonb_build_object('billingManaged',${enabled},'offlineGraceDays',0) FROM billing_license_links b WHERE b.subscription_id=${sub!.id}::uuid AND b.license_id=l.id`);
      if(!enabled||existing[0]&&Number(existing[0].monthly_amount_minor)!==monthlyAmountMinor)await tx.execute(sql`UPDATE billing_consents SET withdrawn_at=now() WHERE subscription_id=${sub!.id}::uuid AND withdrawn_at IS NULL`);
      await event(tx,actor,'subscription.configure',sub!.id,{customerId,product,monthlyAmountMinor,enabled});
      return {id:sub!.id};
    });
  }

  async consent(customerId:string,id:string,input:{enabled:boolean;priceVersion?:number;termsVersion?:string},ip:string){
    const settings=await this.settings();
    return this.db.transaction(async tx=>{
      await lockSubscription(tx,id);
      const [sub]=await query<Subscription>(tx,sql`SELECT * FROM billing_subscriptions WHERE id=${id}::uuid AND customer_id=${customerId}::uuid FOR UPDATE`);
      if(!sub)reject('subscription_missing','Abunəlik tapılmadı.',404);
      if(!input.enabled){
        await tx.execute(sql`UPDATE billing_subscriptions SET auto_renew=false,updated_at=now() WHERE id=${id}::uuid`);
        await tx.execute(sql`UPDATE billing_consents SET withdrawn_at=now() WHERE subscription_id=${id}::uuid AND withdrawn_at IS NULL`);
        await event(tx,customerId,'consent.withdraw',id);return {ok:true};
      }
      if(!settings.recurring_enabled||!sub!.card_ciphertext)reject('card_required','Avtomatik yenilənməni qoşmaq üçün ilk ödənişdə kartı yadda saxlayın.');
      if(!settings.legal?.version||input.termsVersion!==settings.legal.version||input.priceVersion!==sub!.price_version)reject('consent_changed','Məbləğ və şərtləri yeniləyib razılığı təsdiqləyin.');
      await tx.execute(sql`INSERT INTO billing_consents(subscription_id,price_version,amount_minor,terms_version,ip_hash) VALUES(${id}::uuid,${sub!.price_version},${sub!.monthly_amount_minor},${input.termsVersion},${hash(ip)})`);
      await tx.execute(sql`UPDATE billing_subscriptions SET auto_renew=true,consent_version=price_version,updated_at=now() WHERE id=${id}::uuid`);
      await event(tx,customerId,'consent.accept',id,{priceVersion:sub!.price_version});return {ok:true};
    });
  }

  async quote(customerId:string,items:{id:string;qty:number}[],shipping:Shipping,partnerProof?:string){
    if(items.some(i=>i.id===TEST_PRODUCT_ID))reject('test_product','Sınaq məhsulu yalnız simulyasiya səhifəsində istifadə olunur.',400);
    const settings=await this.settings();await importCatalog(this.db);
    const special=await trustedPartnerPrices(this.db,customerId,partnerProof);
    if(shipping.kind==='delivery'&&settings.delivery_fee_minor===null)reject('delivery_unavailable','Çatdırılma hazırda aktiv deyil.');
    if(shipping.kind==='pickup'&&!settings.pickup_address.trim())reject('pickup_unavailable','Təhvil ünvanı hələ təyin edilməyib.');
    const ids=items.map(x=>x.id),rows=await query<CommerceProduct>(this.db,sql`SELECT * FROM billing_catalog WHERE product_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`);
    const payload:QuotePayload={items:items.sort((a,b)=>a.id.localeCompare(b.id)).map(item=>{
      const p=rows.find(x=>x.product_id===item.id);
      if(!p?.sale_enabled||!p.price_minor)reject('price_missing','Məhsul üçün adminin təsdiqlədiyi qiymət yoxdur.');
      if(item.qty>p!.stock_qty-p!.reserved_qty)reject('stock_short','Seçilmiş miqdar stokda yoxdur.');
      return {id:item.id,name:p!.name,qty:item.qty,unitPriceMinor:special[item.id]?minor(special[item.id]):Number(p!.price_minor)};
    }),shipping,deliveryFeeMinor:shipping.kind==='delivery'?Number(settings.delivery_fee_minor):0,...(partnerProof?{partnerProof}:{}),termsVersion:String(settings.legal.version||'')};
    const total=payload.items.reduce((n,i)=>n+i.qty*i.unitPriceMinor,payload.deliveryFeeMinor);
    if(!Number.isSafeInteger(total)||total<=0||total>MAX_MINOR)reject('invalid_total','Sifariş məbləği düzgün deyil.',400);
    const [row]=await query<{id:string;expires_at:string}>(this.db,sql`INSERT INTO billing_quotes(customer_id,payload,amount_minor) VALUES(${customerId}::uuid,${JSON.stringify(payload)}::jsonb,${total}) RETURNING id,expires_at`);
    return {quoteId:row!.id,expiresAt:row!.expires_at,items:payload.items,shipping,deliveryFeeMinor:payload.deliveryFeeMinor,totalMinor:total,currency:'AZN',pickupAddress:settings.pickup_address,termsVersion:payload.termsVersion};
  }

  async shopCheckout(customerId:string,quoteId:string,requestId:string,termsVersion:string){
    await this.available();
    const order=await this.db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${customerId+requestId}))`);
      const requestHash=hash({quoteId});
      const [prior]=await query<Order & {request_hash:string}>(tx,sql`SELECT * FROM billing_orders WHERE customer_id=${customerId}::uuid AND request_key=${requestId}::uuid FOR UPDATE`);
      if(prior){if(prior.request_hash!==requestHash)reject('request_conflict','Əməliyyat açarı başqa sifariş üçündür.');return prior;}
      const [quote]=await query<{payload:QuotePayload;amount_minor:string}>(tx,sql`SELECT * FROM billing_quotes WHERE id=${quoteId}::uuid AND customer_id=${customerId}::uuid AND expires_at>now()`);
      if(!quote)reject('quote_expired','Qiymət təklifini yeniləyin.');
      const p=quote!.payload;
      if(p.items.some(i=>i.id===TEST_PRODUCT_ID))reject('test_product','Sınaq məhsulu real ödənişə göndərilmir.',400);
      if(!termsVersion||termsVersion!==p.termsVersion)reject('terms_changed','Sifariş şərtlərini oxuyub təsdiqləyin.');
      const special=await trustedPartnerPrices(tx,customerId,p.partnerProof);
      const [settings]=await query<Settings>(tx,sql`SELECT * FROM billing_settings WHERE id=true FOR SHARE`);
      if(p.shipping.kind==='delivery'&&(settings!.delivery_fee_minor===null||Number(settings!.delivery_fee_minor)!==p.deliveryFeeMinor))reject('quote_changed','Çatdırılma haqqı dəyişib. Sifarişi yeniləyib təsdiqləyin.');
      for(const item of p.items){
        const [row]=await query<CommerceProduct>(tx,sql`SELECT * FROM billing_catalog WHERE product_id=${item.id} FOR UPDATE`);
        if(!row?.sale_enabled||(special[item.id]?minor(special[item.id]):Number(row.price_minor))!==item.unitPriceMinor)reject('quote_changed','Məhsul qiyməti dəyişib. Sifarişi yeniləyib təsdiqləyin.');
        if(row!.stock_qty-row!.reserved_qty<item.qty)reject('stock_short','Sifariş üçün kifayət qədər stok yoxdur.');
      }
      const [made]=await query<Order>(tx,sql`INSERT INTO billing_orders(order_no,customer_id,kind,amount_minor,request_key,request_hash,delivery_kind,delivery_fee_minor,recipient_name,recipient_phone,delivery_address,expires_at,terms_version)
        VALUES(${'PS-'+randomUUID()},${customerId}::uuid,'shop',${quote!.amount_minor},${requestId}::uuid,${requestHash},${p.shipping.kind},${p.deliveryFeeMinor},${p.shipping.name},${p.shipping.phone},${p.shipping.address},now()+interval '15 minutes',${termsVersion}) RETURNING *`);
      for(const item of p.items){
        await tx.execute(sql`UPDATE billing_catalog SET reserved_qty=reserved_qty+${item.qty},updated_at=now() WHERE product_id=${item.id}`);
        await tx.execute(sql`INSERT INTO billing_order_items(order_id,product_id,name,qty,unit_price_minor) VALUES(${made!.id}::uuid,${item.id},${item.name},${item.qty},${item.unitPriceMinor})`);
      }
      await event(tx,customerId,'order.create',made!.id,{amountMinor:Number(quote!.amount_minor)});
      return made!;
    });
    return this.sendCheckout(order.id,customerId);
  }

  async subscriptionCheckout(customerId:string,id:string,input:{requestId:string;priceVersion:number;saveCard:boolean;termsVersion?:string},ip:string){
    const {settings}=await this.available(input.saveCard);
    const order=await this.db.transaction(async tx=>{
      await lockSubscription(tx,id);
      const [sub]=await query<Subscription>(tx,sql`SELECT * FROM billing_subscriptions WHERE id=${id}::uuid AND customer_id=${customerId}::uuid AND enabled=true FOR UPDATE`);
      if(!sub)reject('subscription_missing','Abunəlik tapılmadı.',404);
      if(input.priceVersion!==sub!.price_version)reject('price_changed','Aylıq haqq dəyişib. Yeniləyib təsdiqləyin.');
      const fingerprint=hash({id,priceVersion:input.priceVersion,saveCard:input.saveCard,termsVersion:input.termsVersion??null});
      const [prior]=await query<Order & {request_hash:string}>(tx,sql`SELECT * FROM billing_orders WHERE customer_id=${customerId}::uuid AND request_key=${input.requestId}::uuid`);
      if(prior){if(prior.request_hash!==fingerprint)reject('request_conflict','Əməliyyat məlumatları dəyişib.');return prior;}
      const [open]=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE subscription_id=${id}::uuid AND status IN ('awaiting_payment','processing','unknown','paid_review','refund_pending') FOR UPDATE`);
      if(open){
        if(open.price_version===input.priceVersion&&open.save_card_consent===input.saveCard)return open;
        const [active]=await query(tx,sql`SELECT id FROM billing_attempts WHERE order_id=${open.id}::uuid AND status IN ('sending','pending','redirect','unknown','succeeded')`);
        if(active)reject('payment_pending','Əvvəlki ödənişin nəticəsi gözlənilir.');
        await tx.execute(sql`UPDATE billing_orders SET status='expired',updated_at=now() WHERE id=${open.id}::uuid`);
      }
      let consentId:string|null=null;
      if(input.saveCard){
        if(!settings.legal?.version||input.termsVersion!==settings.legal.version)reject('terms_changed','Avtomatik ödəniş şərtlərini təsdiqləyin.');
        const [c]=await query<{id:string}>(tx,sql`INSERT INTO billing_consents(subscription_id,price_version,amount_minor,terms_version,ip_hash) VALUES(${id}::uuid,${sub!.price_version},${sub!.monthly_amount_minor},${input.termsVersion},${hash(ip)}) RETURNING id`);consentId=c!.id;
      }
      const [made]=await query<Order>(tx,sql`INSERT INTO billing_orders(order_no,customer_id,kind,subscription_id,price_version,billing_due_at,amount_minor,request_key,request_hash,save_card_consent,consent_id,terms_version)
        VALUES(${'AB-'+randomUUID()},${customerId}::uuid,'subscription',${id}::uuid,${sub!.price_version},${sub!.paid_until?iso(sub!.paid_until):null}::timestamptz,${sub!.monthly_amount_minor},${input.requestId}::uuid,${fingerprint},${input.saveCard},${consentId}::uuid,${String(settings.legal.version||'')}) RETURNING *`);
      await event(tx,customerId,'subscription.invoice',made!.id,{subscriptionId:id,amountMinor:Number(made!.amount_minor)});return made!;
    });
    return this.sendCheckout(order.id,customerId);
  }

  async sendCheckout(orderId:string,customerId:string){
    const {gateway}=await this.available();
    const claim=await this.db.transaction(async tx=>{
      const [order]=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE id=${orderId}::uuid AND customer_id=${customerId}::uuid FOR UPDATE`);
      if(!order)reject('order_missing','Sifariş tapılmadı.',404);
      const [attempt]=await query<Attempt>(tx,sql`SELECT * FROM billing_attempts WHERE order_id=${orderId}::uuid AND kind<>'refund' AND status IN ('sending','redirect','pending','unknown','succeeded') ORDER BY created_at DESC LIMIT 1`);
      if(attempt)return {order:order!,attempt,reused:true};
      if(order!.paid_at||['paid','paid_review','refunded','refund_pending','expired'].includes(order!.status))return {order:order!,attempt:null,reused:true};
      if(order!.kind==='shop'&&order!.expires_at&&new Date(order!.expires_at)<=this.now())reject('order_expired','Sifarişin rezerv müddəti bitib.');
      const [created]=await query<Attempt>(tx,sql`INSERT INTO billing_attempts(order_id,provider_order_id,kind,status) VALUES(${orderId}::uuid,${'PAY-'+randomUUID()},'checkout','sending') RETURNING *`);
      await tx.execute(sql`UPDATE billing_orders SET status='processing',updated_at=now() WHERE id=${orderId}::uuid`);
      return {order:order!,attempt:created!,reused:false};
    });
    if(claim.reused)return {...publicOrder(claim.order),redirectUrl:claim.attempt?.redirect_url??null,paymentState:claim.attempt?.status??claim.order.status};
    const a=claim.attempt!,o=claim.order;
    try{
      const response=await gateway.call(o.save_card_consent?'card-registration-with-pay':'request',{order_id:a.provider_order_id,amount:Number(amount(Number(o.amount_minor))),currency:'AZN',language:'az',description:o.order_no,success_redirect_url:gateway.config.origin+'/odenis/ugurlu?order='+o.id,error_redirect_url:gateway.config.origin+'/odenis/ugursuz?order='+o.id});
      if(response.status==='success'&&typeof response.redirect_url==='string'){
        const u=new URL(response.redirect_url);if(u.protocol!=='https:')throw new Error('Invalid checkout URL');
        await this.db.transaction(async tx=>{
          const [current]=await query<Attempt>(tx,sql`SELECT * FROM billing_attempts WHERE id=${a.id}::uuid FOR UPDATE`);
          if(current?.transaction_id&&response.transaction&&current.transaction_id!==response.transaction)reject('transaction_conflict','Ödəniş əməliyyatı uyğun deyil.');
          await tx.execute(sql`UPDATE billing_attempts SET status=CASE WHEN status IN ('succeeded','refunded') THEN status ELSE 'redirect' END,transaction_id=COALESCE(transaction_id,${response.transaction??null}),redirect_url=${u.toString()},response=${JSON.stringify(safeGatewayResponse(response))}::jsonb,updated_at=now() WHERE id=${a.id}::uuid`);
        });
        return {...publicOrder(o),redirectUrl:u.toString(),paymentState:'redirect'};
      }
      await this.recordResult(a.id,response,'create');
      return {...publicOrder(o),redirectUrl:null,paymentState:response.status==='error'||response.status==='failed'?'failed':'unknown'};
    }catch{
      await this.markUnknown(a.id);
      return {...publicOrder(o),redirectUrl:null,paymentState:'unknown'};
    }
  }

  async markUnknown(attemptId:string){
    await this.db.transaction(async tx=>{
      const [a]=await query<Attempt>(tx,sql`UPDATE billing_attempts SET status='unknown',updated_at=now() WHERE id=${attemptId}::uuid AND status NOT IN ('succeeded','refunded','failed') RETURNING *`);
      if(a)await tx.execute(sql`UPDATE billing_orders SET status='unknown',updated_at=now() WHERE id=${a.order_id}::uuid AND paid_at IS NULL`);
    });
  }

  async recordResult(attemptId:string,result:EpointResponse,source:'callback'|'status'|'execute'|'create',eventKey?:string){
    const [look]=await query<Attempt & {subscription_id:string|null}>(this.db,sql`SELECT a.*,o.subscription_id FROM billing_attempts a JOIN billing_orders o ON o.id=a.order_id WHERE a.id=${attemptId}::uuid`);
    if(!look)reject('payment_missing','Ödəniş tapılmadı.',404);
    return this.db.transaction(async tx=>{
      if(look!.subscription_id)await lockSubscription(tx,look!.subscription_id);
      const [order]=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE id=${look!.order_id}::uuid FOR UPDATE`);
      const [attempt]=await query<Attempt>(tx,sql`SELECT * FROM billing_attempts WHERE id=${attemptId}::uuid FOR UPDATE`);
      if(eventKey){const old=await query(tx,sql`SELECT id FROM billing_events WHERE event_key=${eventKey}`);if(old.length)return {duplicate:true};}
      if(result.transaction&&attempt!.transaction_id&&result.transaction!==attempt!.transaction_id)reject('transaction_mismatch','Epoint əməliyyatı uyğun deyil.',400);
      if(result.amount!==undefined&&minor(result.amount)!==Number(order!.amount_minor))reject('amount_mismatch','Epoint məbləği uyğun deyil.',400);
      if(result.currency!==undefined&&result.currency!=='AZN')reject('currency_mismatch','Valyuta uyğun deyil.',400);
      if(result.order_id!==undefined&&result.order_id!==attempt!.provider_order_id)reject('order_mismatch','Sifariş uyğun deyil.',400);
      if(order!.status==='refunded')return {alreadyRefunded:true};
      const confirmed=result.status==='success'&&source!=='create'&&result.amount!==undefined&&Boolean(result.transaction||attempt!.transaction_id);
      const returned=result.status==='returned';
      if(returned&&(result.amount===undefined||!Boolean(result.transaction||attempt!.transaction_id)))reject('refund_unverified','Geri qaytarmanın məbləği və bank nömrəsi təsdiqlənmədi.',400);
      if(attempt!.kind==='refund'&&!returned){
        await tx.execute(sql`UPDATE billing_attempts SET status='pending',response=${JSON.stringify(safeGatewayResponse(result))}::jsonb,updated_at=now() WHERE id=${attemptId}::uuid`);
        return {pending:true};
      }
      if(confirmed&&!order!.paid_at){
        if(result.operation_code!==undefined&&!['100','200'].includes(String(result.operation_code)))reject('operation_mismatch','Bu əməliyyat ödəniş deyil.',400);
        const [customer]=await query<{active:boolean}>(tx,sql`SELECT active FROM customers WHERE id=${order!.customer_id}::uuid FOR SHARE`);
        let applied=Boolean(customer?.active);
        if(applied&&order!.kind==='subscription')applied=await this.applyPeriod(tx,order!,result);
        if(applied&&order!.kind==='shop')applied=await this.consumeStock(tx,order!);
        await tx.execute(sql`UPDATE billing_orders SET status=${applied?'paid':'paid_review'},paid_at=${this.now().toISOString()}::timestamptz,updated_at=now() WHERE id=${order!.id}::uuid`);
      }
      if(returned){
        if(order!.paid_at)await this.applyRefund(tx,order!);
        else{
          await this.releaseStock(tx,order!);
          await tx.execute(sql`UPDATE billing_orders SET status='refunded',updated_at=now() WHERE id=${order!.id}::uuid`);
        }
      }
      const successAlready=Boolean(order!.paid_at)||attempt!.status==='succeeded';
      const finalState=returned?'refunded':confirmed||successAlready?'succeeded':['failed','error'].includes(String(result.status))?'failed':'pending';
      await tx.execute(sql`UPDATE billing_attempts SET status=${finalState},transaction_id=COALESCE(transaction_id,${result.transaction??null}),response=${JSON.stringify(safeGatewayResponse(result))}::jsonb,updated_at=now() WHERE id=${attemptId}::uuid`);
      if(finalState==='failed'&&!order!.paid_at)await tx.execute(sql`UPDATE billing_orders SET status='failed',updated_at=now() WHERE id=${order!.id}::uuid`);
      await event(tx,'epoint','payment.'+finalState,order!.id,{attemptId,source,...safeGatewayResponse(result)},eventKey??null);
      return {ok:true};
    });
  }

  private async applyPeriod(tx:Executor,order:Order,response:EpointResponse):Promise<boolean>{
    const [sub]=await query<Subscription>(tx,sql`SELECT * FROM billing_subscriptions WHERE id=${order.subscription_id}::uuid FOR UPDATE`);
    if(!sub?.enabled)return false;
    const [valid]=await query(tx,sql`SELECT l.id FROM licenses l JOIN billing_license_links b ON b.license_id=l.id WHERE b.subscription_id=${sub.id}::uuid AND l.status NOT IN ('revoked','suspended') LIMIT 1`);
    if(!valid)return false;
    const start=new Date(Math.max(this.now().getTime(),sub.paid_until?new Date(sub.paid_until).getTime():0));
    const anchor=sub.paid_until&&new Date(sub.paid_until)>this.now()?(sub.anchor_day??localDay(start)):localDay(start),end=nextMonth(start,anchor);
    const inserted=await query(tx,sql`INSERT INTO billing_period_grants(order_id,subscription_id,period_start,period_end) VALUES(${order.id}::uuid,${sub.id}::uuid,${start.toISOString()}::timestamptz,${end.toISOString()}::timestamptz) ON CONFLICT DO NOTHING RETURNING order_id`);
    if(!inserted.length)return true;
    await tx.execute(sql`UPDATE billing_subscriptions SET paid_until=${end.toISOString()}::timestamptz,anchor_day=${anchor},retry_stage=0,last_attempt_at=NULL,updated_at=now() WHERE id=${sub.id}::uuid`);
    await tx.execute(sql`UPDATE licenses l SET valid_until=${end.toISOString()}::timestamptz,status='active',updated_at=now() FROM billing_license_links b WHERE b.license_id=l.id AND b.subscription_id=${sub.id}::uuid AND l.status NOT IN ('revoked','suspended')`);
    await tx.execute(sql`UPDATE activation_keys a SET expires_at=${end.toISOString()}::timestamptz FROM billing_license_links b WHERE b.license_id=a.license_id AND b.subscription_id=${sub.id}::uuid AND a.revoked_at IS NULL`);
    await tx.execute(sql`UPDATE billing_orders SET period_start=${start.toISOString()}::timestamptz,period_end=${end.toISOString()}::timestamptz WHERE id=${order.id}::uuid`);
    if(order.save_card_consent&&response.card_id&&order.consent_id&&order.price_version===sub.price_version){
      const [consent]=await query(tx,sql`SELECT id FROM billing_consents WHERE id=${order.consent_id}::uuid AND withdrawn_at IS NULL AND price_version=${sub.price_version}`);
      const gateway=this.gateway();
      if(consent&&gateway){
        const safe=safeGatewayResponse(response);
        await tx.execute(sql`UPDATE billing_subscriptions SET card_ciphertext=${encryptCard(response.card_id,gateway.config.tokenKey)},card_mask=${String(safe.card_mask||'')},consent_version=price_version,auto_renew=true,updated_at=now() WHERE id=${sub.id}::uuid`);
      }
    }
    return true;
  }

  private async consumeStock(tx:Executor,order:Order):Promise<boolean>{
    const items=await query<{product_id:string;qty:number;reservation_state:string}>(tx,sql`SELECT * FROM billing_order_items WHERE order_id=${order.id}::uuid ORDER BY product_id FOR UPDATE`);
    const products=new Map<string,CommerceProduct>();
    for(const item of items){
      const [p]=await query<CommerceProduct>(tx,sql`SELECT * FROM billing_catalog WHERE product_id=${item.product_id} FOR UPDATE`);products.set(item.product_id,p!);
      if(item.reservation_state==='released'&&p!.stock_qty-p!.reserved_qty<item.qty)return false;
    }
    for(const item of items){
      if(item.reservation_state==='consumed')continue;
      await tx.execute(sql`UPDATE billing_catalog SET stock_qty=stock_qty-${item.qty},reserved_qty=reserved_qty-${item.reservation_state==='reserved'?item.qty:0},updated_at=now() WHERE product_id=${item.product_id}`);
      await tx.execute(sql`UPDATE billing_order_items SET reservation_state='consumed' WHERE order_id=${order.id}::uuid AND product_id=${item.product_id}`);
    }
    return true;
  }

  private async releaseStock(tx:Executor,order:Order){
    const items=await query<{product_id:string;qty:number}>(tx,sql`SELECT * FROM billing_order_items WHERE order_id=${order.id}::uuid AND reservation_state='reserved' ORDER BY product_id FOR UPDATE`);
    for(const item of items){
      await tx.execute(sql`UPDATE billing_catalog SET reserved_qty=reserved_qty-${item.qty},updated_at=now() WHERE product_id=${item.product_id}`);
      await tx.execute(sql`UPDATE billing_order_items SET reservation_state='released' WHERE order_id=${order.id}::uuid AND product_id=${item.product_id}`);
    }
  }

  private async applyRefund(tx:Executor,order:Order){
    if(order.subscription_id){
      const [g]=await query<{period_start:string;period_end:string}>(tx,sql`UPDATE billing_period_grants SET reversed_at=now() WHERE order_id=${order.id}::uuid AND reversed_at IS NULL RETURNING *`);
      if(g){
        await tx.execute(sql`UPDATE billing_subscriptions SET paid_until=${iso(g.period_start)}::timestamptz,auto_renew=false,updated_at=now() WHERE id=${order.subscription_id}::uuid AND paid_until=${iso(g.period_end)}::timestamptz`);
        await tx.execute(sql`UPDATE licenses l SET valid_until=s.paid_until,status=CASE WHEN s.paid_until>now() THEN 'active' ELSE 'expired' END,updated_at=now() FROM billing_subscriptions s,billing_license_links b WHERE s.id=${order.subscription_id}::uuid AND b.subscription_id=s.id AND l.id=b.license_id AND l.status NOT IN ('revoked','suspended')`);
        await tx.execute(sql`UPDATE activation_keys a SET expires_at=s.paid_until FROM billing_subscriptions s,billing_license_links b WHERE s.id=${order.subscription_id}::uuid AND b.subscription_id=s.id AND a.license_id=b.license_id`);
      }
    }
    // Physical returns must be inspected before an admin increases stock.
    await tx.execute(sql`UPDATE billing_orders SET status='refunded',updated_at=now() WHERE id=${order.id}::uuid`);
  }

  async callback(data:unknown,signature:unknown){
    const gateway=this.gateway();if(!gateway)reject('payments_unavailable','Ödəniş konfiqurasiyası yoxdur.',503);
    const {verifyCallback}=await import('./epoint.js');
    const response=verifyCallback(data,signature,gateway!.config.privateKey);
    if(response.public_key!==undefined&&response.public_key!==gateway!.config.publicKey)reject('merchant_mismatch','Merchant uyğun deyil.',400);
    // Card registration alone never grants a paid subscription.
    if(response.operation_code==='001')return {ok:true};
    if(typeof response.order_id!=='string')reject('order_missing','Sifariş nömrəsi yoxdur.',400);
    const [a]=await query<Attempt>(this.db,sql`SELECT * FROM billing_attempts WHERE provider_order_id=${String(response.order_id)} AND kind<>'refund'`);
    if(!a)reject('payment_missing','Ödəniş tapılmadı.',404);
    return this.recordResult(a!.id,response,'callback','epoint:'+hash(data));
  }

  async reconcile(attemptId:string){
    const gateway=this.gateway();if(!gateway)return;
    const [a]=await query<Attempt>(this.db,sql`SELECT * FROM billing_attempts WHERE id=${attemptId}::uuid`);
    if(!a?.transaction_id)return;
    const response=await gateway.call('get-status',{transaction:a.transaction_id});
    await this.recordResult(a.id,response,'status');
  }

  async orders(customerId:string,limit=100){
    return query(this.db,sql`SELECT id,order_no,kind,amount_minor,currency,status,fulfillment_status,created_at,paid_at,period_start,period_end,subscription_id FROM billing_orders WHERE customer_id=${customerId}::uuid ORDER BY created_at DESC LIMIT ${limit}`);
  }
  async order(customerId:string,id:string){
    const [o]=await query(this.db,sql`SELECT id,order_no,kind,amount_minor,currency,status,fulfillment_status,delivery_kind,delivery_fee_minor,recipient_name,recipient_phone,delivery_address,note,expires_at,paid_at,created_at,period_start,period_end FROM billing_orders WHERE id=${id}::uuid AND customer_id=${customerId}::uuid`);
    if(!o)reject('order_missing','Sifariş tapılmadı.',404);
    const items=await query(this.db,sql`SELECT product_id,name,qty,unit_price_minor FROM billing_order_items WHERE order_id=${id}::uuid ORDER BY product_id`);
    return {order:o,items};
  }

  async refund(actor:string,id:string,reason:string){
    const {gateway}=await this.available();
    const [lookup]=await query<Order>(this.db,sql`SELECT * FROM billing_orders WHERE id=${id}::uuid`);
    if(!lookup)reject('order_missing','Sifariş tapılmadı.',404);
    const claim=await this.db.transaction(async tx=>{
      if(lookup!.subscription_id)await lockSubscription(tx,lookup!.subscription_id);
      const [o]=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE id=${id}::uuid FOR UPDATE`);
      if(o!.status==='refunded'||o!.status==='refund_pending')return null;
      if(!o!.paid_at||!['paid','paid_review'].includes(o!.status))reject('refund_not_allowed','Yalnız təsdiqlənmiş ödənişi geri qaytarmaq olar.');
      const [original]=await query<Attempt>(tx,sql`SELECT * FROM billing_attempts WHERE order_id=${id}::uuid AND kind<>'refund' AND status='succeeded' AND transaction_id IS NOT NULL ORDER BY created_at LIMIT 1`);
      if(!original)reject('transaction_missing','Epoint əməliyyat nömrəsi yoxdur.');
      const [attempt]=await query<Attempt>(tx,sql`INSERT INTO billing_attempts(order_id,provider_order_id,kind,status,transaction_id) VALUES(${id}::uuid,${'REF-'+randomUUID()},'refund','sending',${original!.transaction_id}) RETURNING *`);
      await tx.execute(sql`UPDATE billing_orders SET status='refund_pending',updated_at=now() WHERE id=${id}::uuid`);
      await event(tx,actor,'refund.request',id,{reason,attemptId:attempt!.id});return {attempt:attempt!,order:o!};
    });
    if(!claim)return {ok:true,pending:true};
    try{
      const response=await gateway.call('reverse',{transaction:claim.attempt.transaction_id,amount:Number(amount(Number(claim.order.amount_minor))),currency:'AZN',language:'az'});
      if(['failed','error'].includes(String(response.status))){
        await this.db.transaction(async tx=>{
          await tx.execute(sql`UPDATE billing_attempts SET status='failed',response=${JSON.stringify(safeGatewayResponse(response))}::jsonb,updated_at=now() WHERE id=${claim.attempt.id}::uuid`);
          await tx.execute(sql`UPDATE billing_orders SET status=${claim.order.status},updated_at=now() WHERE id=${id}::uuid AND status='refund_pending'`);
          await event(tx,actor,'refund.failed',id,safeGatewayResponse(response));
        });
        return {ok:false,error:'Bank geri qaytarmanı təsdiqləmədi.'};
      }
      await this.db.execute(sql`UPDATE billing_attempts SET status='pending',response=${JSON.stringify(safeGatewayResponse(response))}::jsonb,updated_at=now() WHERE id=${claim.attempt.id}::uuid`);
      await this.reconcile(claim.attempt.id);
    }catch{await this.markUnknown(claim.attempt.id);}
    return {ok:true,pending:true};
  }

  async expireReservations(){
    await this.db.transaction(async tx=>{
      const orders=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE kind='shop' AND paid_at IS NULL AND expires_at<now() AND status IN ('awaiting_payment','processing','failed','unknown') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 50`);
      for(const o of orders){
        const items=await query<{product_id:string;qty:number}>(tx,sql`SELECT * FROM billing_order_items WHERE order_id=${o.id}::uuid AND reservation_state='reserved' ORDER BY product_id FOR UPDATE`);
        for(const item of items){
          await tx.execute(sql`UPDATE billing_catalog SET reserved_qty=reserved_qty-${item.qty},updated_at=now() WHERE product_id=${item.product_id}`);
          await tx.execute(sql`UPDATE billing_order_items SET reservation_state='released' WHERE order_id=${o.id}::uuid AND product_id=${item.product_id}`);
        }
        await tx.execute(sql`UPDATE billing_orders SET status=CASE WHEN status='unknown' THEN 'unknown' ELSE 'expired' END,updated_at=now() WHERE id=${o.id}::uuid`);
        if(items.length)await event(tx,'system','stock.release',o.id);
      }
      await tx.execute(sql`DELETE FROM billing_quotes WHERE expires_at<now()-interval '1 day'`);
      await tx.execute(sql`DELETE FROM billing_handoffs WHERE expires_at<now()-interval '1 day'`);
    });
  }

  async renew(id:string){
    const {gateway}=await this.available(true);
    const claim=await this.db.transaction(async tx=>{
      await lockSubscription(tx,id);
      const [sub]=await query<Subscription>(tx,sql`SELECT s.* FROM billing_subscriptions s JOIN customers c ON c.id=s.customer_id WHERE s.id=${id}::uuid AND s.enabled AND s.auto_renew AND c.active AND s.consent_version=s.price_version AND s.card_ciphertext IS NOT NULL AND s.paid_until<=now() FOR UPDATE OF s`);
      if(!sub)return null;
      if(sub.retry_stage>=3)return null;
      const delay=sub.retry_stage===1?24*3600_000:sub.retry_stage===2?48*3600_000:0;
      if(sub.last_attempt_at&&new Date(sub.last_attempt_at).getTime()+delay>this.now().getTime())return null;
      const [accepted]=await query(tx,sql`SELECT id FROM billing_consents WHERE subscription_id=${id}::uuid AND price_version=${sub.price_version} AND withdrawn_at IS NULL LIMIT 1`);
      if(!accepted)return null;
      let [order]=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE subscription_id=${id}::uuid AND status IN ('awaiting_payment','processing','unknown','paid_review','refund_pending') FOR UPDATE`);
      if(order){
        if(order.status!=='awaiting_payment'||order.save_card_consent||order.price_version!==sub.price_version)return null;
        const [a]=await query(tx,sql`SELECT id FROM billing_attempts WHERE order_id=${order.id}::uuid AND status IN ('sending','redirect','pending','unknown','succeeded')`);
        if(a)return null;
      }else{
        const [failed]=await query<Order>(tx,sql`SELECT * FROM billing_orders WHERE subscription_id=${id}::uuid AND status='failed' AND price_version=${sub.price_version} AND billing_due_at IS NOT DISTINCT FROM ${sub.paid_until?iso(sub.paid_until):null}::timestamptz ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
        if(failed)order=failed;
        else [order]=await query<Order>(tx,sql`INSERT INTO billing_orders(order_no,customer_id,kind,subscription_id,price_version,billing_due_at,amount_minor,request_key,request_hash) VALUES(${'AB-'+randomUUID()},${sub.customer_id}::uuid,'subscription',${id}::uuid,${sub.price_version},${iso(sub.paid_until!)}::timestamptz,${sub.monthly_amount_minor},${randomUUID()}::uuid,${hash({id,version:sub.price_version,until:sub.paid_until})}) RETURNING *`);
      }
      const [attempt]=await query<Attempt>(tx,sql`INSERT INTO billing_attempts(order_id,provider_order_id,kind,status) VALUES(${order!.id}::uuid,${'AUTO-'+randomUUID()},'recurring','sending') RETURNING *`);
      await tx.execute(sql`UPDATE billing_orders SET status='processing',updated_at=now() WHERE id=${order!.id}::uuid`);
      await tx.execute(sql`UPDATE billing_subscriptions SET retry_stage=retry_stage+1,last_attempt_at=now(),updated_at=now() WHERE id=${id}::uuid`);
      await event(tx,'system','renewal.attempt',order!.id,{attemptId:attempt!.id});
      return {sub,order:order!,attempt:attempt!};
    });
    if(!claim)return;
    try{
      // Ciphertext is decrypted only for this outgoing server-to-bank call.
      const cardId=decryptCard(claim.sub.card_ciphertext!,gateway.config.tokenKey);
      const response=await gateway.call('execute-pay',{card_id:cardId,order_id:claim.attempt.provider_order_id,amount:Number(amount(Number(claim.order.amount_minor))),currency:'AZN',language:'az',description:claim.order.order_no});
      await this.recordResult(claim.attempt.id,response,'execute');
    }catch{await this.markUnknown(claim.attempt.id);}
  }

  async sweep(){
    await this.expireReservations();
    // A process can die after transmitting a debit but before storing its reply.
    await this.db.execute(sql`UPDATE billing_attempts SET status='unknown',updated_at=now() WHERE status='sending' AND created_at<now()-interval '2 minutes'`);
    const uncertain=await query<{id:string}>(this.db,sql`SELECT id FROM billing_attempts WHERE transaction_id IS NOT NULL AND status IN ('redirect','pending','unknown') AND updated_at<now()-interval '30 seconds' ORDER BY updated_at LIMIT 25`);
    for(const a of uncertain){try{await this.reconcile(a.id);}catch{/* retain uncertainty, never issue a second debit */}}
    const settings=await this.settings(),gateway=this.gateway();
    if(!settings.enabled||!settings.recurring_enabled||!gateway||(!gateway.config.liveVerified&&!this.options.allowLive))return;
    const due=await query<{id:string}>(this.db,sql`SELECT id FROM billing_subscriptions WHERE enabled AND auto_renew AND paid_until<=now() AND retry_stage<3 ORDER BY paid_until LIMIT 20`);
    for(const sub of due){try{await this.renew(sub.id);}catch{/* durable attempt state is reconciled on the next sweep */}}
  }
}

export async function licenseBilling(db:Executor,licenseId:string){
  const [settings]=await query<Settings>(db,sql`SELECT * FROM billing_settings WHERE id=true`);
  const enforced=Boolean(settings?.enforcement_enabled&&settings.enabled&&epointConfig()?.liveVerified);
  const [sub]=await query<Subscription>(db,sql`SELECT s.* FROM billing_subscriptions s JOIN billing_license_links b ON b.subscription_id=s.id WHERE b.license_id=${licenseId}::uuid AND s.enabled=true`);
  return sub?{billingEnforced:enforced,accessUntil:!enforced?new Date(Date.now()+7*86400000).toISOString():null,billingStatus:subscriptionState(sub.enabled,sub.paid_until),paidUntil:sub.paid_until?iso(sub.paid_until):null,monthlyAmountMinor:Number(sub.monthly_amount_minor),subscriptionId:sub.id,paymentUrl:billUrl}:null;
}

export function startBillingWorker(billing:Billing,log:{warn:(data:unknown,message:string)=>void}){
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await billing.sweep();}catch{log.warn({component:'billing'},'billing_sweep_failed');}finally{running=false;}};
  const timer=setInterval(()=>void tick(),30000);timer.unref();void tick();return ()=>clearInterval(timer);
}
