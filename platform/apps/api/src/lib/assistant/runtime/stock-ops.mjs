import {normalize,rankProducts,findByName,parseDecimal,quantityInStockUnit} from './stock-assistant.mjs';
// Write-offs and goods receipts. Each asks only for what is missing, shows one plan, and runs once after "Təsdiq et".
// A receipt saves the purchase invoice and receives it; the till then raises stock and the item's cost price.
export function createStockOps({tools,makeKey,language='az'}){
 const t=(az,tr,en)=>language==='tr'?tr:language==='en'?en:az,choice=(label,value)=>({label,value});
 let flow=null,last=null;
 const cancelChoice=()=>choice(t('Ləğv et','İptal','Cancel'),'cancel'),confirmChoice=()=>choice(t('Təsdiq et','Onayla','Confirm'),'confirm');
 const reply=(body,choices=[])=>last={body,choices:[...choices,cancelChoice()]};
 const guard=valid=>{if(!valid())throw Error('stale conversation');};
 const fmt=(n,scale)=>(Number(n)/scale).toLocaleString(language==='en'?'en-GB':language==='tr'?'tr-TR':'az-AZ',{minimumFractionDigits:scale===100?2:0,maximumFractionDigits:scale===100?2:3});
 const unitName=u=>({kg:'kq',l:'litr'})[u]||u;
 const amount=(qty,unit)=>quantityInStockUnit(String(qty).replace(',','.'),unit||null,flow.item.unit);
 async function next(valid){
  if(!flow.item){
   const data=await tools.catalogue();guard(valid);
   flow.store=flow.store||data.warehouses.find(w=>w.id===data.homeWarehouseId)||data.warehouses.find(w=>w.active!==0&&w.active!==false)||null;
   if(!flow.store){const kind=flow.kind;flow=null;return reply(t('Aktiv anbar tapılmadı. Heç nə dəyişməyib.','Aktif depo yok.','No active warehouse.'));}
   const exact=flow.name?findByName(data.products,flow.name):null,matches=exact?[{product:exact}]:flow.name?rankProducts(data.products,flow.name).filter(m=>!m.fuzzy):[];
   if(matches.length===1)flow.item=matches[0].product;
   else if(!flow.name){flow.stage='item';return reply(flow.kind==='waste'?t('Hansı mal silinir? Adını yazın, məsələn “doner 2 ədəd xarab olub”.','Hangi ürün?','Which item?'):t('Hansı mal alınıb? Adını, miqdarını və qiymətini yazın, məsələn “un 25 kq aldım 3 manatdan”.','Hangi ürün alındı?','Which item was bought?'));}
   else if(matches.length>1){flow.stage='item';flow.options=matches.slice(0,8).map(m=>m.product);return reply(t(`“${flow.name}” adında bir neçə mal var. Hansıdır?`,'Hangisi?','Which one?'),flow.options.map(p=>choice(p.name,'stockops:item:'+p.id)));}
   else{const name=flow.name;flow=null;return reply(t(`“${name}” anbarda tapılmadı. Yeni maldırsa, əvvəl “anbara ${name} əlavə et” yazın. Heç nə dəyişməyib.`,`“${name}” depoda yok.`,`“${name}” is not in stock.`));}
  }
  if(!Number.isSafeInteger(flow.qtyMilli)||flow.qtyMilli<=0){
   const q=flow.qty!=null?amount(flow.qty,flow.unit):null;
   if(q&&q>0&&q<=1e9&&(normalize(flow.item.unit)!=='eded'||q%1000===0))flow.qtyMilli=q;
   else{flow.qty=null;flow.stage='qty';return reply(flow.kind==='waste'?t(`${flow.item.name}: nə qədər silinir? Vahid: ${unitName(flow.item.unit)}. Məsələn “2” və ya “500 qram”.`,'Ne kadar?','How much?'):t(`Neçə ${unitName(flow.item.unit)} ${flow.item.name} alınıb? Məsələn “25” və ya “25 kq”.`,'Ne kadar alındı?','How much was bought?'));}
  }
  if(flow.kind==='waste'&&!flow.reason){flow.stage='reason';return reply(t(`${flow.item.name} niyə silinir? Səbəbi yazın, məsələn “xarab olub”, “tökülüb”, “vaxtı keçib”.`,'Neden?','Why?'),[choice(t('Xarab olub','Bozuldu','Spoiled'),'Xarab olub'),choice(t('Vaxtı keçib','Süresi geçti','Expired'),'Vaxtı keçib'),choice(t('Tökülüb','Döküldü','Spilled'),'Tökülüb')]);}
  if(flow.kind==='receive'){
   if(!Number.isSafeInteger(flow.priceMinor)){const p=flow.price!=null?parseDecimal(String(flow.price).replace(/\s*(?:manat|azn|₼)\s*$/i,''),2):null;if(p!==null)flow.priceMinor=p;else{flow.stage='price';return reply(t(`1 ${unitName(flow.item.unit)} ${flow.item.name} neçəyə alınıb? Manatla yazın, məsələn “3” və ya “2,50”.`,'Birim fiyatı?','Unit price?'));}}
   if(!flow.supplier){const list=await tools.suppliersList();guard(valid);
    if(!list.length){flow=null;return reply(t('Hələ tədarükçü yoxdur. Mal qəbulu tədarükçü ilə yazılır: əvvəl Təchizat bölməsində tədarükçü əlavə edin. Heç nə dəyişməyib.','Tedarikçi yok.','No suppliers yet.'));}
    const named=flow.supplierName?findByName(list,flow.supplierName):null;
    if(named||list.length===1)flow.supplier=named||list[0];
    else{flow.stage='supplier';flow.suppliers=list.slice(0,10);return reply(t(`${flow.item.name} kimdən alınıb? Tədarükçünü seçin.`,'Tedarikçi?','Which supplier?'),flow.suppliers.map(x=>choice(x.name,'stockops:supplier:'+x.id)));}}
  }
  const now=await tools.read(flow.item.id,flow.store.id);guard(valid);flow.before=now.qtyMilli;flow.stage='confirm';flow.key=makeKey();flow.receiveKey=makeKey();
  const u=unitName(flow.item.unit);
  if(flow.kind==='waste')return reply(t(`Silinmə (itki):\n${flow.item.name} · ${flow.store.name}\n${fmt(flow.qtyMilli,1000)} ${u} silinəcək, səbəb: ${flow.reason}\nQalıq: ${fmt(flow.before,1000)} → ${fmt(flow.before-flow.qtyMilli,1000)} ${u}${flow.before-flow.qtyMilli<0?`\nDiqqət: anbarda cəmi ${fmt(flow.before,1000)} ${u} var, silinmədən sonra qalıq mənfi olacaq. Əvvəl mal qəbulunu yazmaq və ya miqdarı yoxlamaq daha düzgündür.`:''}\nTəsdiq edirsiniz?`,`${flow.item.name}: ${fmt(flow.qtyMilli,1000)} ${u} silinecek. Onaylıyor musunuz?`,`Write off ${fmt(flow.qtyMilli,1000)} ${u} of ${flow.item.name}. Confirm?`),[confirmChoice()]);
  const total=Math.round(flow.priceMinor*flow.qtyMilli/1000);
  return reply(t(`Mal qəbulu (alış qaiməsi):\nTədarükçü: ${flow.supplier.name} · Anbar: ${flow.store.name}\n• ${flow.item.name}: ${fmt(flow.qtyMilli,1000)} ${u} × ${fmt(flow.priceMinor,100)} ₼ = ${fmt(total,100)} ₼\nQəbuldan sonra qalıq: ${fmt(flow.before,1000)} → ${fmt(flow.before+flow.qtyMilli,1000)} ${u}; maya qiyməti ${fmt(flow.priceMinor,100)} ₼/${u} olacaq.\nQaimə tədarükçünün hesabına yazılır.\nTəsdiq edirsiniz?`,`Alış: ${flow.item.name} ${fmt(flow.qtyMilli,1000)} ${u}, ${fmt(total,100)} ₼. Onaylıyor musunuz?`,`Receive ${fmt(flow.qtyMilli,1000)} ${u} of ${flow.item.name} for ${fmt(total,100)} ₼. Confirm?`),[confirmChoice()]);
 }
 const draft=()=>flow.kind==='waste'?{ingredientId:flow.item.id,warehouseId:flow.store.id,qtyMilli:flow.qtyMilli,reason:flow.reason,expectedQtyMilli:flow.before}:{supplierId:flow.supplier.id,warehouseId:flow.store.id,lines:[{ingredientId:flow.item.id,qtyMilli:flow.qtyMilli,unitCostMinor:flow.priceMinor}],key:flow.key,receiveKey:flow.receiveKey};
 return{
  async start(plan,valid){flow={kind:plan.intent,stage:'item',name:plan.name||'',qty:plan.qty??null,unit:plan.unit||null,reason:plan.reason||'',price:plan.price??null,supplierName:plan.supplier||''};return next(valid);},
  async send(raw,valid){
   if(!flow)return null;const text=normalize(raw);
   if(raw.startsWith('stockops:')&&!last?.choices.some(c=>c.value===raw))return reply(t('Cari addımın seçimindən istifadə edin.','Mevcut seçenekleri kullanın.','Use the current choices.'));
   if(flow.stage==='item'&&/^(?:tesdiq( et|le|leyirem)?|confirm|beli|he|yes|ok)$/.test(text))return reply(t('Əvvəl malın adını yazın.','Önce ürünü yazın.','Name the item first.'),last?.choices.filter(c=>c.value!=='cancel')||[]);
   if(flow.stage==='item'){if(raw.startsWith('stockops:item:')){flow.item=(flow.options||[]).find(p=>p.id===raw.slice(14))||null;if(!flow.item)return last;}else flow.name=raw.trim().slice(0,100);return next(valid);}
   if(flow.stage==='qty'){const m=String(raw).trim().match(/^(\d+(?:[.,]\d{1,3})?)\s*(\p{L}*)$/u);if(!m)return reply(t(`Miqdarı rəqəmlə yazın. Vahid: ${unitName(flow.item.unit)}.`,'Sayıyla yazın.','Enter a number.'));flow.qty=m[1];flow.unit=m[2]?normalize(m[2]):null;return next(valid);}
   if(flow.stage==='price'){flow.price=String(raw).trim();if(parseDecimal(flow.price.replace(/\s*(?:manat|azn|₼)\s*$/i,''),2)===null){flow.price=null;return reply(t('Qiyməti rəqəmlə yazın, məsələn “3” və ya “2,50”.','Fiyatı yazın.','Enter the price.'));}return next(valid);}
   if(flow.stage==='reason'){if(!raw.trim()||raw.trim().length>200)return reply(t('Səbəbi 1–200 simvolla yazın.','Nedeni yazın.','Enter a reason.'));flow.reason=raw.trim();return next(valid);}
   if(flow.stage==='supplier'){const pick=raw.startsWith('stockops:supplier:')?(flow.suppliers||[]).find(x=>x.id===raw.slice(18)):findByName(flow.suppliers||[],raw);if(!pick)return last;flow.supplier=pick;return next(valid);}
   if(flow.stage==='confirm'&&/^(?:tesdiq( et|le|leyirem)?|confirm|beli|he|yes)$/.test(text)){
    const op=flow,d=draft(),u=unitName(op.item.unit);
    if(op.kind==='waste'){await tools.writeOff(d,op.key,valid);guard(valid);flow=null;return{body:t(`Silindi: ${op.item.name} ${fmt(op.qtyMilli,1000)} ${u} (${op.reason}). Qalıq: ${fmt(op.before-op.qtyMilli,1000)} ${u}.`,'Silindi.','Written off.'),choices:[]};}
    const out=await tools.receiveGoods(d,valid);guard(valid);flow=null;
    return{body:t(`Mal qəbulu yazıldı: ${op.supplier.name}, ${op.item.name} ${fmt(op.qtyMilli,1000)} ${u}, cəmi ${fmt(out.totalMinor??Math.round(op.priceMinor*op.qtyMilli/1000),100)} ₼. Qalıq: ${fmt(op.before+op.qtyMilli,1000)} ${u}, maya qiyməti ${fmt(op.priceMinor,100)} ₼/${u}.`,'Alış kaydedildi.','Goods received.'),choices:[]};
   }
   return last;
  },
  approval:()=>flow?.stage==='confirm'?flow.kind==='waste'?{name:'writeOff',args:[draft(),flow.key]}:{name:'receiveGoods',args:[draft()]}:null,
  async recheck(valid){if(!flow)return{body:'Yeni plan qurun.',choices:[]};flow.stage='item';const answer=await next(valid);return{...answer,body:t('Planı yenidən yoxlayın.\n','Planı yeniden kontrol edin.\n','Check the plan again.\n')+answer.body};},
  snapshot:()=>({flow,last}),restore:s=>{flow=s?.flow||null;last=s?.last||null;},
  get active(){return!!flow;},cancel(){flow=null;last=null;},
 };
}
