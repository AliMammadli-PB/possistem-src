/** Browser-only warehouse host. Uses the same Restaurant business core as the
 * desktop Market app, in a separate in-memory database. Never calls live APIs. */
import createOps from './ops-core.mjs';
let module, seq = 0, market;
const links=new Map();
export function opsInvoke(method, payload = {}, key) {
  const text = JSON.stringify({requestId:`ops-demo-${++seq}`,method,protocolVersion:1,timestamp:Date.now(),actor:{userId:'usr-admin'},terminal:{id:'market-reg-2',name:'Kassa 2'},payload:key?{...payload,idempotencyKey:key}:payload});
  const ptr=module._malloc(module.lengthBytesUTF8(text)+1);
  try {module.stringToUTF8(text,ptr,module.lengthBytesUTF8(text)+1);const rows=module.UTF8ToString(module._pos_call(ptr)).split('\n').filter(Boolean).map(JSON.parse);return rows.filter(r=>r.type!=='event').at(-1);}
  finally{module._free(ptr);}
}
export async function bootOps(snapshot, callMarket) {
  market=callMarket;
  module=await createOps({print:()=>{},printErr:()=>{}});module.FS.mkdirTree('/data');module.ccall('pos_boot','string',['string'],['/data/ops.db']);
  const must=(method,payload)=>{const r=opsInvoke(method,payload);if(!r?.success)throw Error(`${method}: ${r?.error?.message}`);return r.data;};
  must('auth.login',{pin:'1234',newPin:'5678'});
  must('settings.set',{key:'restaurant.name',value:snapshot.settings.storeName});
  must('settings.set',{key:'printer.receipt',value:'virtual'});
  const imported=must('goods.import',{rows:snapshot.products.map(p=>({name:p.name.az,barcode:p.barcode,unit:p.unit==='kq'?'kg':'ədəd',costMinor:p.costMinor,salePriceMinor:p.priceMinor,category:p.category})),updateExisting:true});
  const goods=must('goods.list',{}).goods||[];
  const byBarcode=new Map(goods.map(g=>[g.barcode,g]));
  for(const p of snapshot.products){const good=byBarcode.get(p.barcode);if(good){p.demoGoodId=good.id;links.set(p.id,good.id);must('inventory.adjust',{ingredientId:good.id,qtyDeltaMilli:Math.round(Number(p.warehouseStock?.[snapshot.settings.defaultWarehouseId]||0)*1000),reason:'Demo başlanğıc qalığı'});}}
  syncRegisters();
  return imported;
}

// The same native external-sale and cash-link endpoints used by Electron main.
export function syncRegisters(){
 const snapshot=market('cash.bridgeSnapshot',{actorId:'system'});
 if(snapshot.success){const r=opsInvoke('cashAccounts.syncMarket',{registers:snapshot.data.registers||[],movements:snapshot.data.movements||[]});if(!r.success)throw Error(r.error?.message);}
}
export function recordSale(sale){
 const p=sale.payment||{},credit=Math.max(0,Number(sale.creditMinor)||0),card=Math.max(0,Number(p.cardMinor??(p.method==='card'?sale.totalMinor-credit:0))||0),cash=Math.max(0,sale.totalMinor-credit-card);
 const lines=(sale.items||[]).map(item=>({productId:item.productId,ingredientId:links.get(item.productId),qtyMilli:item.qtyMilli||Math.round(item.qty*1000),unitPriceMinor:item.unitPriceMinor,totalMinor:item.lineTotalMinor}));
 const result=opsInvoke('sales.recordExternal',{externalId:sale.id,number:sale.receiptNo,at:sale.createdAt,lines,cashMinor:cash,cardMinor:card,creditMinor:credit,customerId:sale.customerId||'',creditInMarketLedger:true,discountMinor:sale.discountMinor||0},'demo-sale-'+sale.id);
 if(!result.success)throw Error(result.error?.message);syncRegisters();
}
export function stockSnapshot(){
 const inventory=opsInvoke('business.call',{action:'stock.snapshot'}),goods=opsInvoke('goods.list',{});
 if(!inventory.success||!goods.success)throw Error(inventory.error?.message||goods.error?.message);
 const byId=new Map(goods.data.goods.map(g=>[g.id,g]));
 return {deviceId:'demo',branchId:'demo',branchName:'Demo filial',online:true,updatedAt:Date.now(),warehouses:inventory.data.warehouses,lines:inventory.data.levels.map(l=>({...l,goodId:l.ingredientId,name:byId.get(l.ingredientId)?.name||'',barcode:byId.get(l.ingredientId)?.barcode||'',unit:byId.get(l.ingredientId)?.unit||'ədəd',salePriceMinor:byId.get(l.ingredientId)?.salePriceMinor||0,costMinor:byId.get(l.ingredientId)?.costMinor||0}))};
}
export function syncGoods(){
 const goods=opsInvoke('goods.list',{});if(!goods.success)throw Error(goods.error?.message);
 const current=market('product.list',{activeOnly:false,actorId:'u-manager',role:'manager'});if(!current.success)throw Error(current.error?.message);
 const byBarcode=new Map(current.data.filter(p=>p.barcode).map(p=>[p.barcode,p]));
 const stock=stockSnapshot();
 for(const g of goods.data.goods){
  const old=byBarcode.get(g.barcode),qty=stock.lines.filter(l=>l.goodId===g.id).reduce((a,l)=>a+l.qtyMilli,0)/1000;
  const product={...old,id:old?.id||'ops-'+g.id,sku:old?.sku||'OPS-'+g.id,barcode:g.barcode,name:{az:g.name,ru:g.name,en:g.name},category:old?.category||g.categoryPath?.split(' / ')[0]||'Digər',unit:g.unit==='kg'?'kq':'əd',priceMinor:g.salePriceMinor,costMinor:g.costMinor||0,minStock:old?.minStock||0,taxRate:old?.taxRate||0,active:true,createdAt:old?.createdAt||Date.now(),image:old?.image||{kind:'sprite',index:0},accent:old?.accent||'#2563eb',stock:qty,stockByWarehouse:[{id:'wh-sales',name:'Satış zalı',qty}]};
  links.set(product.id,g.id);
  const saved=market(old?'product.update':'product.create',{product,actorId:'u-manager',role:'manager'});if(!saved.success)throw Error(saved.error?.message);
 }
}
