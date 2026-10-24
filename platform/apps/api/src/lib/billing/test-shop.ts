import {createHash} from 'node:crypto';
import type {FastifyRequest} from 'fastify';
import {sql} from 'drizzle-orm';
import {BillingError} from './domain.js';
import {query,type Executor} from './store.js';
import type {Db} from '@milioner/database';

export const TEST_PRODUCT_ID='possistem-private-checkout-test';
const EMAIL='ali.mammadli@possistem.az';
type Actor={kind:'admin'|'customer';id:string;email:string;csrf:string|null};
type Product={id:string;name:string;price_minor:number};
type Row={id:string;product_id:string;qty:number;amount_minor:number;status:'simulated_success'|'simulated_failure';created_at:string|Date;request_hash:string};
export function testActor(req:FastifyRequest):Actor|null {
 const admin=req.user;
 if(admin?.active&&!admin.mustChangePassword&&admin.email.trim().toLowerCase()===EMAIL)return {kind:'admin',id:admin.id,email:EMAIL,csrf:req.csrfToken};
 const customer=req.customer;
 if(customer?.active&&customer.email.trim().toLowerCase()===EMAIL)return {kind:'customer',id:customer.id,email:EMAIL,csrf:req.customerCsrfToken};
 return null;
}
async function product(db:Executor,actor:Actor|null){
 if(!actor)return null;
 const [row]=await query<Product>(db,sql`SELECT id,name,price_minor FROM billing_test_products WHERE id=${TEST_PRODUCT_ID} AND allowed_email=${actor.email} AND enabled=true`);
 return row??null;
}
export async function testCatalogProduct(db:Executor,req:FastifyRequest){
 const p=await product(db,testActor(req));if(!p)return null;
 const image='/assets/brands/logo.png';
 return {id:p.id,name:p.name,slug:p.id,sku:'TEST-ONLY',description:'Açar və kart olmadan sifariş axınının simulyasiyası. Real pul tutulmur, mal təhvil verilmir və abunəlik açılmır.',shortDescription:'Yalnız hesabınız üçün sınaq · 0 ₼ tutulur',brand:'Possistem',category:'Sınaq',categorySlug:'sinaq',parentCategory:'Ticarət avadanlıqları',parentCategorySlug:'ticaret-avadanliqlari',subCategory:'Sınaq',image,images:[image],inStock:true,stockQuantity:10,isHotDeal:false,price:p.price_minor/100,isTest:true};
}
function serialize(row:Row){return {id:row.id,orderNo:'TEST-'+row.id.slice(0,8).toUpperCase(),productId:row.product_id,qty:row.qty,amountMinor:row.amount_minor,status:row.status,createdAt:row.created_at,mode:'simulation' as const,chargedMinor:0,currency:'AZN',provider:null};}
export async function testShopContext(db:Db,req:FastifyRequest){
 const actor=testActor(req),p=await testCatalogProduct(db,req);
 if(!actor||!p)throw new BillingError('test_not_found','Sınaq məhsulu tapılmadı.',404);
 const rows=await query<Row>(db,sql`SELECT * FROM billing_test_orders WHERE actor_kind=${actor.kind} AND actor_id=${actor.id}::uuid ORDER BY created_at DESC LIMIT 10`);
 return {mode:'simulation',email:actor.email,csrfToken:actor.csrf,product:p,orders:rows.map(serialize),notice:'Bu sınaqdır. Epoint çağırılmır, kart məlumatı alınmır və real pul tutulmur.'};
}
export async function simulateCheckout(db:Db,req:FastifyRequest,input:{productId:string;qty:number;outcome:'success'|'failure';requestId:string}){
 const actor=testActor(req);
 if(!actor)throw new BillingError('test_not_found','Sınaq məhsulu tapılmadı.',404);
 if(!actor.csrf||req.headers['x-csrf-token']!==actor.csrf)throw new BillingError('invalid_csrf','Sessiyanı yeniləyib təkrar yoxlayın.',403);
 return db.transaction(async tx=>{
  const p=await product(tx,actor);if(!p||p.id!==input.productId)throw new BillingError('test_not_found','Sınaq məhsulu tapılmadı.',404);
  const fingerprint=createHash('sha256').update(JSON.stringify({productId:p.id,qty:input.qty,outcome:input.outcome})).digest('hex');
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor.kind+actor.id+input.requestId}))`);
  const [prior]=await query<Row>(tx,sql`SELECT * FROM billing_test_orders WHERE actor_kind=${actor.kind} AND actor_id=${actor.id}::uuid AND request_key=${input.requestId}::uuid`);
  if(prior){if(prior.request_hash!==fingerprint)throw new BillingError('request_conflict','Bu sınaq nömrəsi başqa sorğu üçün istifadə olunub.');return serialize(prior);}
  const [made]=await query<Row>(tx,sql`INSERT INTO billing_test_orders(product_id,actor_kind,actor_id,qty,amount_minor,status,request_key,request_hash) VALUES(${p.id},${actor.kind},${actor.id}::uuid,${input.qty},${p.price_minor*input.qty},${input.outcome==='success'?'simulated_success':'simulated_failure'},${input.requestId}::uuid,${fingerprint}) RETURNING *`);
  return serialize(made!);
 });
}
