import {createSetupTools} from './setup-tools.mjs';
export const normalize=value=>String(value??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ə/g,'e').replace(/ş/g,'s').replace(/ç/g,'c').replace(/ğ/g,'g').replace(/ö/g,'o').replace(/ü/g,'u').replace(/[^a-z0-9]+/g,' ').trim();
export function parseDecimal(value,places){
 const input=String(value).trim().replace(',','.');if(!new RegExp('^\\d+(?:\\.\\d{1,'+places+'})?$').test(input))return null;
 const [whole,fraction='']=input.split('.'),result=Number(whole)*10**places+Number(fraction.padEnd(places,'0'));
 return Number.isSafeInteger(result)&&result<=1000000000?result:null;
}
export function parseQuantity(value){const raw=String(value).trim(),sign=raw.startsWith('-')?-1:1,amount=parseDecimal(sign<0?raw.slice(1):raw,3);return amount===null?null:sign*amount;}
export function quantityInStockUnit(value,inputUnit,stockUnit){
 const amount=parseQuantity(value);if(amount===null||!inputUnit)return amount;
 const unit=s=>normalize(s).replace(/^kq$/,'kg').replace(/^qram$/,'g').replace(/^q$/,'g').replace(/^dene$/,'eded');
 const units={kg:['mass',1000],g:['mass',1],l:['volume',1000],ml:['volume',1],eded:['count',1]};
 const from=unit(inputUnit),to=unit(stockUnit);if(from===to)return amount;
 if(!units[from]||!units[to]||units[from][0]!==units[to][0])return null;
 const result=amount*units[from][1]/units[to][1];return Number.isSafeInteger(result)?result:null;
}
const dataOf=response=>{if(!response?.success)throw Error(response?.error?.message||'POS məlumatı alınmadı. Yenidən yoxlayın.');return response.data;};
const requireList=(value,label)=>{if(!Array.isArray(value))throw Error(label+' cavabı düzgün deyil. POS-u yeniləyin.');return value;};
export function createTools(api,has,services={}){
 const need=key=>{if(!has(key))throw Error('Bu əməliyyat üçün '+({'inventory.view':'anbara baxış','inventory.manage':'məhsul redaktəsi','inventory.adjust':'qalıq düzəlişi','catalog.manage':'menyu redaktəsi'}[key]||'müvafiq')+' icazəniz yoxdur. Müdirə müraciət edin.');};
 const catalogue=async()=>{need('inventory.view');const [goods,stores]=await Promise.all([api.inventory.ingredients(''),api.inventory.warehouses()]);const data=dataOf(goods),warehouseData=dataOf(stores);return{products:requireList(data?.ingredients,'Məhsul siyahısı').filter(p=>p.active!==0&&p.active!==false),warehouses:requireList(warehouseData?.warehouses,'Anbar siyahısı'),homeWarehouseId:warehouseData.homeWarehouseId||'',version:Number(data.assistantToolsVersion)||0};};
 const read=async(id,warehouseId)=>{const current=await catalogue(),product=current.products.find(row=>row.id===id);if(!product)throw Error('Məhsul artıq mövcud deyil. Siyahıdan yenidən seçin.');const warehouse=current.warehouses.find(row=>row.id===warehouseId);if(!warehouse)throw Error('Qalığı görmək üçün anbar seçin.');const levels=dataOf(await api.inventory.levels(warehouseId));const level=requireList(levels?.levels,'Anbar qalığı').find(row=>row.id===id||row.ingredientId===id);if(!level||!Number.isSafeInteger(level.qtyMilli))throw Error('Bu məhsulun qalıq məlumatı alınmadı. Sıfır qalıq kimi qəbul etməyin.');return{product,warehouse,qtyMilli:Number(level.qtyMilli),version:current.version,readAt:new Date().toISOString()};};
 const save=async(snapshot,field,value,reason,key)=>{
  if(snapshot.version<1)throw Error('Bu POS nüvəsi qorunan redaktəni dəstəkləmir. Tətbiqi yeniləyin.');
  if(field==='quantity'){
   need('inventory.adjust');const qty=parseQuantity(value);if(qty===null)throw Error('Qalığı düzgün yazın: məsələn 12 və ya 1,250.');if(!reason.trim())throw Error('Qalıq düzəlişinin səbəbini yazın.');
   return dataOf(await api.inventory.adjust({ingredientId:snapshot.product.id,warehouseId:snapshot.warehouse.id,qtyDeltaMilli:qty-snapshot.qtyMilli,expectedQtyMilli:snapshot.qtyMilli,reason:reason.trim(),idempotencyKey:key}));
  }
  need('inventory.manage');if(String(snapshot.product.sku).startsWith('MENU-'))need('catalog.manage');
  if(!Number.isSafeInteger(snapshot.product.updatedAt))throw Error('Kartın versiyası alınmadı. Məhsulu yenidən seçin.');
  const patch=field==='name'?{name:value.trim()}:field==='price'?{salePriceMinor:parseDecimal(value,2)}:null;
  if(!patch||patch.name===''||patch.name?.length>100||patch.salePriceMinor===null)throw Error('Yeni dəyəri düzgün yazın.');
  const result=dataOf(await api.inventory.saveIngredient({id:snapshot.product.id,cardPatch:patch,expectedUpdatedAt:snapshot.product.updatedAt,idempotencyKey:key}));
  if(result?.patched!==true)throw Error('Redaktə təsdiqi alınmadı. Təkrar etməzdən əvvəl kartı yoxlayın.');return result;
 };
 const overview=async warehouseId=>{const current=await catalogue();const warehouse=current.warehouses.find(w=>w.id===warehouseId&&w.active!==0&&w.active!==false);if(!warehouse)throw Error('Anbar seçin.');const data=dataOf(await api.inventory.levels(warehouseId));const levels=requireList(data?.levels,'Anbar qalığı');const byId=new Map(levels.map(row=>[row.id||row.ingredientId,row]));return{warehouse,readAt:new Date().toISOString(),products:current.products.map(product=>({...product,qtyMilli:Number.isSafeInteger(byId.get(product.id)?.qtyMilli)?byId.get(product.id).qtyMilli:null}))};};
 const sales=async period=>{need('reports.view');const now=Date.now(),offset=4*3600000,local=new Date(now+offset);let from=Math.floor((now+offset)/86400000)*86400000-offset,to=now;if(period==='yesterday'){to=from-1;from-=86400000;}else if(period==='week')from-=((local.getUTCDay()+6)%7)*86400000;else if(period==='month')from=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),1)-offset;const report=dataOf(await api.reports.period({from,to}));if(!report?.sales||!Number.isSafeInteger(report.sales.netMinor)||!Number.isSafeInteger(report.sales.grossMinor)||!Number.isSafeInteger(report.sales.refundMinor))throw Error('Satış hesabatı düzgün alınmadı.');return{report,from,to};};
 const cash=async()=>{need('cash.accounts');const data=dataOf(await api.cashAccounts.list());return requireList(data?.accounts,'Kassalar');};
 const subscription=async()=>{if(typeof services.billing?.status!=='function')throw Error('Abunəlik məlumatı açıla bilmədi. Hesab və ödəniş səhifəsindən yoxlayın.');const data=dataOf(await services.billing.status());if(!Array.isArray(data?.subscriptions))throw Error('Abunəlik cavabı alınmadı; müddəti təxmin etmirəm.');return{subscription:data.subscriptions.find(s=>s.product==='restaurant')||null,paymentsAvailable:data.paymentsAvailable===true};};
 const openPayment=async(valid=()=>true)=>{const status=await subscription(),sub=status.subscription;if(!valid())throw Error('stale conversation');if(sub?.hasPaidSubscription&&sub.state==='active'&&Date.parse(sub.paidUntil)>Date.now())throw Error('Cari müddət artıq ödənilib. Təkrar ödəniş açılmadı.');if(!status.paymentsAvailable)throw Error('Onlayn ödəniş hazırda açıq deyil. Mövcud istifadə icazəniz bu sorğu ilə dəyişməyib.');if(typeof services.billing?.open!=='function')throw Error('Ödəniş səhifəsi açıla bilmədi.');const data=dataOf(await services.billing.open());if(data?.opened!==true)throw Error('Brauzerdə açılış təsdiqi alınmadı.');return data;};
 const tables=async()=>{need('order.view');if(typeof api.tables?.list!=='function')throw Error('Masa məlumatı açıla bilmədi.');const data=dataOf(await api.tables.list());return requireList(data?.tables,'Masalar');};
 const tableOrder=async tableId=>{need('order.view');const rows=await tables(),table=rows.find(t=>t.id===tableId);if(!table)throw Error('Masa artıq mövcud deyil.');if(!table.orderId)return{table,items:[]};const data=dataOf(await api.orders.get(table.orderId));return{table,items:requireList(data?.items,'Masa məhsulları').filter(i=>i.status!=='voided')};};
 return{catalogue,read,save,overview,sales,cash,subscription,openPayment,tables,tableOrder,...createSetupTools(api,has,{normalize})};
}
