import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {sql} from 'drizzle-orm';
import {z} from 'zod/v3';
import QRCode from 'qrcode';
import {resolveTenantToken} from './tenant.js';
import {query} from '../lib/billing/store.js';
import {QrDocument,QrCart,QrError,priceQrCart,type QrMenuDocument} from '../lib/qr-menu.js';
const uuid=z.string().uuid(),opaque=z.string().regex(/^[a-f0-9]{48}$/),token=()=>randomBytes(24).toString('hex');
type Menu={id:string;customer_id:string;device_id:string;public_token:string;enabled:boolean;revision:number;document:QrMenuDocument;table_tokens:Record<string,string>;last_seen_at:string|Date|null};
const Device=z.object({deviceId:uuid});
const publicUrl=(m:Menu,t:string)=>`https://possistem.az/qr/${m.public_token}/${t}/`;
const orderView=(o:Record<string,unknown>)=>({id:o.id,status:o.status,tableLabel:o.table_label,tableId:o.table_id,lines:o.lines,note:o.note,subtotalMinor:Number(o.subtotal_minor),createdAt:o.created_at,reason:o.reason,posOrderId:o.pos_order_id,claimUntil:o.claim_until});
export async function qrOrderRoutes(app:FastifyInstance){
 const route=(fn:(req:FastifyRequest,reply:FastifyReply)=>Promise<unknown>)=>async(req:FastifyRequest,reply:FastifyReply)=>{reply.header('Cache-Control','no-store');try{return await fn(req,reply);}catch(e){if(e instanceof z.ZodError)return reply.code(400).send({error:e.issues[0]?.message||'Məlumat düzgün deyil.'});if(e instanceof QrError)return reply.code(e.statusCode).send({error:e.message});throw e;}};
 async function device(req:FastifyRequest,body:{deviceId:string}){
  const auth=resolveTenantToken(req.headers.authorization?.replace(/^Bearer\s+/i,''));if(!auth)throw new QrError('Hesaba yenidən daxil olun.',401);
  const [row]=await query(app.db,sql`SELECT d.id FROM devices d JOIN licenses l ON l.id=d.license_id JOIN customers c ON c.id=l.customer_id
   WHERE d.id=${body.deviceId}::uuid AND l.customer_id=${auth.customerId}::uuid AND c.active=true AND d.status='active'
   AND l.status='active' AND l.valid_until>now() AND COALESCE(l.features->>'product',CASE WHEN l.plan='market' THEN 'market' ELSE 'restaurant' END)='restaurant'`);
  if(!row)throw new QrError('Aktiv Restoran POS kassası tapılmadı.',403);return auth.customerId;
 }
 async function licenseActive(m:Menu,db:Parameters<typeof query>[0]=app.db){const [row]=await query(db,sql`SELECT d.id FROM devices d JOIN licenses l ON l.id=d.license_id JOIN customers c ON c.id=l.customer_id WHERE d.id=${m.device_id}::uuid AND c.id=${m.customer_id}::uuid AND c.active=true AND d.status='active' AND l.status='active' AND l.valid_until>now() AND COALESCE(l.features->>'product',CASE WHEN l.plan='market' THEN 'market' ELSE 'restaurant' END)='restaurant'`);return !!row;}
 const deviceMenu=async(customerId:string,deviceId:string)=>{
  const [menu]=await query<Menu>(app.db,sql`SELECT * FROM restaurant_qr_menus WHERE customer_id=${customerId}::uuid AND device_id=${deviceId}::uuid`);return menu;
 };
 async function config(menu:Menu|undefined){if(!menu)return {menu:null,tables:[]};return {menu:{enabled:menu.enabled,revision:menu.revision,document:menu.document},tables:await Promise.all(menu.document.tables.map(async t=>{const url=publicUrl(menu,menu.table_tokens[t.id]!);return {...t,url,qr:await QRCode.toDataURL(url,{width:240,margin:2,errorCorrectionLevel:'M'})};}))};}
 app.post('/qr/device/config',{bodyLimit:1024*1024},route(async(req)=>{
  const b=Device.extend({action:z.enum(['get','publish','disable','rotate']).default('get'),document:QrDocument.optional(),expectedRevision:z.number().int().nonnegative().optional()}).parse(req.body),customerId=await device(req,b);
  if(b.action==='get')return config(await deviceMenu(customerId,b.deviceId));
  const menu=await app.db.transaction(async tx=>{
   await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'qr:'+b.deviceId}))`);
   const [old]=await query<Menu>(tx,sql`SELECT * FROM restaurant_qr_menus WHERE customer_id=${customerId}::uuid AND device_id=${b.deviceId}::uuid FOR UPDATE`);
   if(b.expectedRevision!==undefined&&b.expectedRevision!==(old?.revision??0))throw new QrError('Menyu başqa kassada dəyişib. Yeniləyin.',409);
   if(b.action==='disable'){if(old)await tx.execute(sql`UPDATE restaurant_qr_menus SET enabled=false,revision=revision+1,updated_at=now() WHERE id=${old.id}::uuid`);return old?{...old,enabled:false,revision:old.revision+1}:undefined;}
   if(b.action==='rotate'&&!old)throw new QrError('Əvvəl menyunu yayımlayın.');
   const doc=b.action==='rotate'?old!.document:b.document;if(!doc)throw new QrError('Menyu yoxdur.');
   const tableTokens=Object.fromEntries(doc.tables.map(t=>[t.id,b.action!=='rotate'&&old?.table_tokens[t.id]||token()]));
   const menuId=old?.id??randomUUID(),publicToken=b.action==='rotate'?token():old?.public_token??token();
   const [fresh]=await query<Menu>(tx,sql`INSERT INTO restaurant_qr_menus(id,customer_id,device_id,public_token,enabled,revision,document,table_tokens,last_seen_at)
    VALUES(${menuId}::uuid,${customerId}::uuid,${b.deviceId}::uuid,${publicToken},true,${(old?.revision??0)+1},${JSON.stringify(doc)}::jsonb,${JSON.stringify(tableTokens)}::jsonb,now())
    ON CONFLICT(device_id) DO UPDATE SET public_token=EXCLUDED.public_token,enabled=true,revision=EXCLUDED.revision,document=EXCLUDED.document,table_tokens=EXCLUDED.table_tokens,updated_at=now() RETURNING *`);
   await tx.execute(sql`INSERT INTO restaurant_qr_events(menu_id,action,detail) VALUES(${menuId}::uuid,${b.action},${JSON.stringify({revision:fresh!.revision,deviceId:b.deviceId})}::jsonb)`);return fresh;
  });return config(menu);
 }));
 app.post('/qr/device/inbox',route(async(req)=>{
  const b=Device.parse(req.body),customerId=await device(req,b),menu=await deviceMenu(customerId,b.deviceId);if(!menu)return {orders:[],enabled:false};
  await app.db.execute(sql`UPDATE restaurant_qr_menus SET last_seen_at=now() WHERE id=${menu.id}::uuid`);
  await app.db.execute(sql`UPDATE restaurant_qr_orders SET status='expired',reason='Sifarişin gözləmə müddəti bitdi.',updated_at=now() WHERE menu_id=${menu.id}::uuid AND status='pending' AND created_at<now()-interval '30 minutes'`);
  const rows=await query(app.db,sql`SELECT * FROM restaurant_qr_orders WHERE menu_id=${menu.id}::uuid AND (status IN ('pending','accepting') OR updated_at>now()-interval '1 day') ORDER BY created_at DESC LIMIT 100`);
  return {enabled:menu.enabled,orders:rows.map(orderView)};
 }));
 app.post('/qr/device/decision',route(async(req)=>{
  const b=Device.extend({id:uuid,action:z.enum(['claim','reject','complete','release']),claimToken:opaque.optional(),posOrderId:z.string().min(1).max(120).optional(),reason:z.string().trim().max(300).default('')}).parse(req.body),customerId=await device(req,b);
  return app.db.transaction(async tx=>{
   const [o]=await query<Record<string,any>>(tx,sql`SELECT o.* FROM restaurant_qr_orders o JOIN restaurant_qr_menus m ON m.id=o.menu_id WHERE o.id=${b.id}::uuid AND m.customer_id=${customerId}::uuid AND m.device_id=${b.deviceId}::uuid FOR UPDATE OF o`);
   if(!o)throw new QrError('Sifariş tapılmadı.',404);if(o.status==='accepted')return {order:orderView(o),alreadyAccepted:true};
   if(['rejected','expired'].includes(o.status))throw new QrError('Sifariş artıq bağlanıb.',409);
   if(b.action==='claim'){
    if(o.status==='accepting'&&new Date(o.claim_until).getTime()>Date.now())throw new QrError('Sifariş başqa kassir tərəfindən işlənir.',409);
    const claim=token();await tx.execute(sql`UPDATE restaurant_qr_orders SET status='accepting',claim_token=${claim},claim_until=now()+interval '60 seconds',updated_at=now() WHERE id=${b.id}::uuid`);
    return {claimToken:claim,order:orderView({...o,status:'accepting'})};
   }
   if(b.action==='reject'){
    if(o.status!=='pending')throw new QrError('Qəbul edilən sifarişi rədd etmək olmaz.',409);
    await tx.execute(sql`UPDATE restaurant_qr_orders SET status='rejected',reason=${b.reason||'Restoran sifarişi qəbul etmədi.'},updated_at=now() WHERE id=${b.id}::uuid`);
   }else{
    if(o.status!=='accepting'||!b.claimToken||o.claim_token!==b.claimToken)throw new QrError('Qəbul təsdiqi etibarsızdır.',409);
    if(b.action==='complete'&&!b.posOrderId)throw new QrError('Kassa hesabı yoxdur.');
    await tx.execute(sql`UPDATE restaurant_qr_orders SET status=${b.action==='complete'?'accepted':'pending'},pos_order_id=${b.posOrderId??null},claim_token=NULL,claim_until=NULL,reason=${b.reason},updated_at=now() WHERE id=${b.id}::uuid`);
   }
   await tx.execute(sql`INSERT INTO restaurant_qr_events(menu_id,order_id,action,detail) VALUES(${o.menu_id}::uuid,${b.id}::uuid,${b.action},${JSON.stringify({posOrderId:b.posOrderId??null})}::jsonb)`);return {ok:true};
  });
 }));
 app.get('/public/qr/:menu/:table',{config:{rateLimit:{max:1200,timeWindow:'1 minute'}}},route(async(req)=>{
  const b=z.object({menu:opaque,table:opaque}).parse(req.params);
  const [m]=await query<Menu>(app.db,sql`SELECT * FROM restaurant_qr_menus WHERE public_token=${b.menu}`);
  const table=m?.document.tables.find(t=>m.table_tokens[t.id]===b.table);if(!m||!m.enabled||!table)throw new QrError('QR menyu hazırda bağlıdır. Restoran əməkdaşına müraciət edin.',404);
  const {tables,...document}=m.document;return {revision:m.revision,table,document:{...document,items:document.items.filter(i=>!i.hidden)},ordersAvailable:await licenseActive(m)&&!!m.last_seen_at&&Date.now()-new Date(m.last_seen_at).getTime()<90000};
 }));
 app.post('/public/qr/:menu/:table/orders',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},route(async(req)=>{
  const p=z.object({menu:opaque,table:opaque}).parse(req.params),b=QrCart.parse(req.body),hash=createHash('sha256').update(JSON.stringify({table:p.table,...b})).digest('hex');
  return app.db.transaction(async tx=>{
   const [m]=await query<Menu>(tx,sql`SELECT * FROM restaurant_qr_menus WHERE public_token=${p.menu} FOR UPDATE`);if(!m)throw new QrError('Menyu tapılmadı.',404);
   const table=m.document.tables.find(t=>m.table_tokens[t.id]===p.table);if(!table)throw new QrError('Masa tapılmadı.',404);
   const [old]=await query<Record<string,any>>(tx,sql`SELECT * FROM restaurant_qr_orders WHERE menu_id=${m.id}::uuid AND request_id=${b.requestId}::uuid`);
   if(old){if(old.request_hash!==hash)throw new QrError('Sifariş sorğusu dəyişib. Yenidən yoxlayın.',409);return {order:orderView(old),receiptToken:old.receipt_token};}
   if(!m.enabled||!m.last_seen_at||Date.now()-new Date(m.last_seen_at).getTime()>=90000)throw new QrError('Kassa hazırda oflayndır. Əməkdaşa müraciət edin.',409);
   if(!await licenseActive(m,tx))throw new QrError('Restoran hazırda yeni sifariş qəbul etmir.',409);
   if(m.revision!==b.revision)throw new QrError('Menyu dəyişib. Səhifəni yeniləyin.',409);
   const [count]=await query<{count:number}>(tx,sql`SELECT count(*)::int AS count FROM restaurant_qr_orders WHERE menu_id=${m.id}::uuid AND status IN ('pending','accepting')`);if(Number(count?.count)>=100)throw new QrError('Restoran hazırda çox sifariş qəbul edir. Əməkdaşa müraciət edin.',429);
   const priced=priceQrCart(m.document,b),orderId=randomUUID(),receipt=token();
   const [order]=await query(tx,sql`INSERT INTO restaurant_qr_orders(id,menu_id,request_id,request_hash,receipt_token,table_id,table_label,menu_revision,lines,note,subtotal_minor)
    VALUES(${orderId}::uuid,${m.id}::uuid,${b.requestId}::uuid,${hash},${receipt},${table.id},${table.label},${m.revision},${JSON.stringify(priced.lines)}::jsonb,${b.note},${priced.subtotal}) RETURNING *`);
   return {order:orderView(order!),receiptToken:receipt};
  });
 }));
 app.get('/public/qr/orders/:id',{config:{rateLimit:{max:3000,timeWindow:'1 minute'}}},route(async(req)=>{
  const {id}=z.object({id:uuid}).parse(req.params),{receipt}=z.object({receipt:opaque}).parse(req.query);
  await app.db.execute(sql`UPDATE restaurant_qr_orders SET status='expired',reason='Sifarişin gözləmə müddəti bitdi.',updated_at=now() WHERE id=${id}::uuid AND receipt_token=${receipt} AND status='pending' AND created_at<now()-interval '30 minutes'`);
  const [o]=await query(app.db,sql`SELECT * FROM restaurant_qr_orders WHERE id=${id}::uuid AND receipt_token=${receipt}`);if(!o)throw new QrError('Sifariş tapılmadı.',404);return {order:orderView(o)};
 }));
}
