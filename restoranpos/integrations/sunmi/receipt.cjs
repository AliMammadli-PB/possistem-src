'use strict';
const {documentUuid,SunmiError,VAT_TYPES}=require('./protocol.cjs');
const invalid=message=>{throw new SunmiError('SUNMI_VALIDATION',message);};
const minor=(v,name)=>{if(!Number.isSafeInteger(v)||v<0)invalid(`${name}: qəpik məbləği düzgün deyil.`);return v;};
const azn=v=>minor(v,'Məbləğ')/100;
function allocate(total,weights){
 minor(total,'Yekun');const sum=weights.reduce((n,x)=>n+BigInt(minor(x,'Sətir')),0n);if(!sum)invalid('Məhsulların cəmi sıfırdır.');
 const out=weights.map((w,i)=>({i,n:Number(BigInt(total)*BigInt(w)/sum),r:BigInt(total)*BigInt(w)%sum}));
 let rest=total-out.reduce((n,x)=>n+x.n,0);for(const x of [...out].sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1)){if(!rest--)break;x.n++;}return out.map(x=>x.n);
}
function barcodeType(code,service){
 if(service)return 3;if(!/^\d{8}$|^\d{13}$/.test(code))return 0;
 const chars=[...code].map(Number);const sum=chars.slice(0,-1).reverse().reduce((n,x,i)=>n+x*(i%2?1:3),0);return(10-sum%10)%10===chars.at(-1)?code.length===13?2:1:0;
}
function quantityType(unit){const x=String(unit||'').toLowerCase().trim();if(['kg','kq','kq.','kiloqram'].includes(x))return 1;if(['l','lt','litr','liter'].includes(x))return 2;if(['m','metr','meter'].includes(x))return 3;if(['m²','m2','kv.m','kv.metr'].includes(x))return 4;if(['m³','m3','kub.m','kub.metr'].includes(x))return 5;return 0;}
function buildReceipt(snapshot,config,parent){
 if(!snapshot||!['sale','refund'].includes(snapshot.kind))invalid('Fiskal sənəd növü tanınmır.');
 if(snapshot.kind==='refund'&&!parent?.result?.fiscalReceiptId)throw new SunmiError('SUNMI_PARENT_PENDING','İlkin satışın fiskal nəticəsi gözlənilir.',{retryable:true});
 if(!VAT_TYPES.includes(config.vatType))invalid('SUNMI üçün vergi növünü seçin.');
 const total=minor(snapshot.totalMinor,'Çek');if(!total)invalid('Sıfır məbləğli fiskal çek göndərilmir.');
 let rows=(snapshot.items||[]).filter(x=>x.quantityMilli>0&&x.lineTotalMinor>0).map(x=>({...x}));
 if(snapshot.serviceMinor>0)rows.push({lineId:'service',name:'Xidmət haqqı',barcode:'service',isService:true,unit:'ədəd',quantityMilli:1000,lineTotalMinor:snapshot.serviceMinor});
 if(!rows.length)invalid('Fiskal çekin məhsulları yoxdur.');
 const amounts=allocate(total,rows.map(x=>minor(x.lineTotalMinor,'Sətir')));
 const payments=snapshot.payment||{};
 const cash=minor(payments.cashMinor||0,'Nağd'),card=minor(payments.cardMinor||0,'Kart'),credit=minor(payments.creditMinor||0,'Nisyə'),bonus=minor(payments.bonusMinor||0,'Bonus'),deposit=minor(payments.depositMinor||0,'Avans');
 if(cash+card+credit+bonus+deposit!==total)invalid('Nağd, kart, nisyə, bonus və avansın cəmi çekə uyğun deyil.');
 const items=rows.map((row,i)=>{
  const qty=Number(row.quantityMilli)/1000;if(!Number.isSafeInteger(row.quantityMilli)||qty<=0)invalid('Məhsulun miqdarı düzgün deyil.');
  const overrides=config.vatOverrides||{};const overrideKey=[row.productId,row.barcode].find(key=>key&&Object.hasOwn(overrides,key));const vatType=row.vatType??(overrideKey?overrides[overrideKey]:config.vatType);if(!VAT_TYPES.includes(vatType))invalid('Məhsulun vergi növü düzgün deyil.');
  if(vatType===2&&!Number.isSafeInteger(row.purchasePriceMinor))invalid('Ticarət əlavəsi vergisi üçün məhsulun alış qiyməti tələb olunur.');
  const code=String(row.barcode||row.productId||row.lineId||'');
  const item={name:String(row.name||'').trim(),code,quantity:qty,salePrice:Number((amounts[i]/100/qty).toFixed(2)),sum:azn(amounts[i]),codeType:barcodeType(code,row.isService),quantityType:quantityType(row.unit),vatType,discountAmount:0,itemUuid:documentUuid(snapshot.id+':'+row.lineId)};
  if(row.purchasePriceMinor!==undefined)item.purchasePrice=azn(row.purchasePriceMinor);
  if(row.markingCodes?.length)item.markingCodes=row.markingCodes.map(String);
  if(snapshot.kind==='refund'){
   const original=parent?.request?.items?.find(x=>x.itemUuid===documentUuid(snapshot.parentId+':'+(row.parentLineId||row.lineId)));
   if(!original)invalid('Qaytarılan sətir ilkin fiskal çekdə tapılmadı. Məhsul üzrə qaytarma seçin.');
   item.parentItemUuid=original.itemUuid;item.vatType=original.vatType;item.code=original.code;item.codeType=original.codeType;item.quantityType=original.quantityType;
   if(item.quantity>original.quantity||item.sum>original.sum+.001)invalid('Qaytarma ilkin sətirdən çoxdur.');
  }
  return item;
 });
 const data={documentUUID:documentUuid(config.deviceId+':'+snapshot.id),cashPayment:azn(cash),cardPayment:azn(card),creditPayment:azn(credit),bonusPayment:azn(bonus),depositPayment:azn(deposit),items,cashierName:String(snapshot.cashierName||'Kassir'),currency:'AZN',note:String(snapshot.note||'')};
 if(snapshot.customerName)data.clientName=String(snapshot.customerName);
 if(credit){data.creditContract=String(snapshot.saleId||snapshot.id);data.creditPayer=String(snapshot.customerName||'Müştəri');}
 if(card){if(!/^\d{12}$/.test(String(payments.rrn||'')))invalid('Kart fiskallaşdırması üçün bank çekindəki 12 rəqəmli RRN lazımdır.');data.rrn=String(payments.rrn);}
 if(snapshot.kind==='refund'){
  if(!parent?.result?.fiscalReceiptId)invalid('İlkin satışın fiskal nəticəsi gözlənilir.');
  data.parentDocumentId=parent.result.fiscalReceiptId;data.moneyBackType=0;data.isManual=false;
 }
 return {operation:snapshot.kind==='refund'?'moneyBack':'sale',data,totalMinor:total};
}
module.exports={allocate,buildReceipt,barcodeType,quantityType};
