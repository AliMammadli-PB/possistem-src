import { sql } from 'drizzle-orm';
import { listAdminProducts } from '../product-catalog.js';
import { BillingError, minor } from './domain.js';
import { query, event, type Executor } from './store.js';

export type CommerceProduct = {product_id:string; name:string; stock_qty:number; reserved_qty:number; price_minor:number|string|null; sale_enabled:boolean};
let importJob: Promise<void> | null = null;
export async function importCatalog(db: Executor): Promise<void> {
  if (importJob) return importJob;
  importJob = (async()=>{
    const products = await listAdminProducts();
    const rows=products.map(p=>({id:p.id,name:p.name,stock:p.stockQuantity,archive:{price:p.price,partnerPrice:p.partnerPrice,hidden:p.hidden}}));
    await db.execute(sql`INSERT INTO billing_catalog(product_id,name,stock_qty,archived_values)
      SELECT x.id,x.name,GREATEST(0,LEAST(1000000,x.stock)),x.archive FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(id text,name text,stock integer,archive jsonb)
      ON CONFLICT(product_id) DO NOTHING`);
  })().finally(()=>{importJob=null;});
  return importJob;
}

export async function overlayCommerce<T extends {id:string; price?:unknown; inStock?:boolean}>(db: Executor, products:T[], admin=false):Promise<(T & Record<string,unknown>)[]> {
  await importCatalog(db);
  const rows=await query<CommerceProduct>(db,sql`SELECT * FROM billing_catalog`), byId=new Map(rows.map(r=>[r.product_id,r]));
  return products.map(p=>{
    const row=byId.get(p.id); const available=row?row.stock_qty-row.reserved_qty:0;
    const priced=Boolean(row?.sale_enabled&&row.price_minor&&Number(row.price_minor)>0);
    return {...p,price:priced?Number(row!.price_minor)/100:null,hasAdminPrice:priced,purchasable:priced&&available>0,inStock:available>0,stockQuantity:available,...(admin?{stockQuantity:row?.stock_qty??0,reservedQuantity:row?.reserved_qty??0,saleEnabled:priced}: {})};
  });
}

export async function updateCommerceProduct(db:Executor,id:string,patch:{price?:number|null;stockQuantity?:number|null;hidden?:boolean},actor:string):Promise<void> {
  await importCatalog(db);
  const [row]=await query<CommerceProduct>(db,sql`SELECT * FROM billing_catalog WHERE product_id=${id} FOR UPDATE`);
  if(!row)throw new BillingError('product_missing','Məhsul tapılmadı.',404);
  if(patch.stockQuantity!==undefined&&Number(patch.stockQuantity)<row.reserved_qty)throw new BillingError('stock_reserved','Bu miqdarın bir hissəsi ödəniş gözləyən sifarişlər üçün rezervdir.');
  const price=patch.price!==undefined?(patch.price&&patch.price>0?minor(patch.price):null):row.price_minor;
  const enabled=patch.hidden===true?false:patch.price!==undefined?price!==null:row.sale_enabled;
  await db.execute(sql`UPDATE billing_catalog SET price_minor=${price},sale_enabled=${enabled},stock_qty=${patch.stockQuantity??row.stock_qty},confirmed_by=${actor}::uuid,confirmed_at=now(),updated_at=now() WHERE product_id=${id}`);
  await event(db,actor,'catalog.update',id,{priceMinor:price,stockQuantity:patch.stockQuantity??row.stock_qty,saleEnabled:enabled});
}
