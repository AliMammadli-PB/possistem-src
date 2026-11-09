import {createPrinterConversation} from './printer-conversation.mjs';
import {createTableConversation} from './table-conversation.mjs';
import {createSetupConversation} from './setup-conversation.mjs';
import {createStockOps} from './stock-ops.mjs';
import {isCommand,periodBounds} from '../understand.mjs';
import {screensFor,SCREENS} from './app-map.mjs';
import {interpret,normalize,rankProducts,parseDecimal,parseQuantity,quantityInStockUnit,compactHelp,suggestCorrection,splitRequests,findByName} from './stock-assistant.mjs';

// Conversation owns the pending operation. The UI only renders messages and choices.
export function createConversation({tools,help,understand=null,askSql=null,profile=null,language='az',makeKey=()=>crypto.randomUUID()}){
 const printerOps=createPrinterConversation({tools,makeKey});
 const tableOps=createTableConversation({tools,language,makeKey});
 const setup=createSetupConversation({tools,language,makeKey});
 const stockOps=createStockOps({tools,language,makeKey});
 const t=(az,tr,en)=>language==='tr'?tr:language==='en'?en:az;
 let lastOverview=null,selected=null,pending=null,approval=null,choices=[],locked=false,queue=[],lastData=null;
 const idle=()=>!pending&&!approval&&!setup.active&&!tableOps.active&&!printerOps.active&&!stockOps.active;
 // An answer that did not understand the question; the server files it under Admin → Chat şikayətləri.
 const miss=answer=>({...answer,missed:true});
 const clear=()=>{pending=null;approval=null;choices=[];};
 const result=(body,options=[],reply)=>{choices=options;return{body,choices:options,reply};};
 const choice=(label,value=label)=>({label,value});
 const cancel=t('Ləğv et','İptal','Cancel'),confirm=t('Təsdiq et','Onayla','Confirm');
 const fields={name:t('Adını dəyiş','Adını değiştir','Change name'),price:t('Satış qiymətini dəyiş','Satış fiyatını değiştir','Change price'),quantity:t('Qalığı düzəlt','Stoku düzelt','Set stock')};
 const label={name:t('Ad','Ad','Name'),price:t('Satış qiyməti','Satış fiyatı','Sale price'),quantity:t('Qalıq','Stok','Stock')};
 const fmt=(n,scale)=>n!==null&&n!==undefined&&n!==''&&Number.isSafeInteger(Number(n))?(Number(n)/scale).toLocaleString(language==='en'?'en-US':language==='tr'?'tr-TR':'az-AZ',{minimumFractionDigits:scale===100?2:0,maximumFractionDigits:scale===100?2:3}):'—';
 const valueOf=(snapshot,field)=>field==='name'?snapshot.product.name:field==='price'?fmt(snapshot.product.salePriceMinor,100)+' ₼':fmt(snapshot.qtyMilli,1000)+' '+snapshot.product.unit;
 const describe=s=>`${s.product.name}: ${fmt(s.qtyMilli,1000)} ${s.product.unit}. ${label.price}: ${fmt(s.product.salePriceMinor,100)} ₼. ${t('Anbar','Depo','Warehouse')}: ${s.warehouse.name}.`;
 const fresh=async(product,warehouseId,valid)=>{const snapshot=await tools.read(product.id,warehouseId);if(!valid())throw Error('stale conversation');selected=snapshot;return snapshot;};
 const askField=()=>{pending={kind:'field'};return result(t(`${selected.product.name} üçün nəyi dəyişək: adını, satış qiymətini, yoxsa qalığını?`,`${selected.product.name} için neyi değiştirelim: adını, fiyatını veya stokunu?`,`What should change for ${selected.product.name}: name, price or stock?`),Object.entries(fields).map(([field,name])=>choice(name,'field:'+field)));};
 const askValue=field=>{pending={kind:'value',field};return result(t(`${selected.product.name} üçün yeni ${label[field].toLowerCase()} dəyərini yazın.`,`${selected.product.name} için yeni ${label[field].toLowerCase()} değerini yazın.`,`Enter the new ${label[field].toLowerCase()} for ${selected.product.name}.`),[choice(cancel,'cancel')]);};
 const preview=(field,value,reason='')=>{
  const after=field==='name'?value:field==='price'?fmt(parseDecimal(value,2),100)+' ₼':fmt(parseQuantity(value),1000)+' '+selected.product.unit;
  approval={snapshot:selected,field,value,reason,key:makeKey()};pending=null;
  return result(t(`Plan hazırdır:\n${selected.product.name} · ${selected.warehouse.name}\n${label[field]}: ${valueOf(selected,field)} → ${after}${reason?'\nSəbəb: '+reason:''}\nTəsdiq etsəniz, saxlayacağam.`,`Plan hazır:\n${selected.product.name} · ${selected.warehouse.name}\n${label[field]}: ${valueOf(selected,field)} → ${after}${reason?'\nNeden: '+reason:''}\nOnaydan sonra kaydedeceğim.`,`Plan ready:\n${selected.product.name} · ${selected.warehouse.name}\n${label[field]}: ${valueOf(selected,field)} → ${after}${reason?'\nReason: '+reason:''}\nI will save after confirmation.`),[choice(confirm,'confirm'),choice(cancel,'cancel')]);
 };
 const takeValue=(field,raw)=>{
  const value=String(raw).trim();
  const parsed=field==='name'?value:field==='quantity'?parseQuantity(value):parseDecimal(value,2);
  if(parsed===null||parsed===''||field==='name'&&value.length>100||field==='quantity'&&selected.product.unit==='ədəd'&&parsed%1000!==0)return result(t('Dəyər düzgün deyil. Yeni dəyəri bir rəqəm kimi yazın; ədəd tam olmalıdır.','Değer geçersiz. Tek sayı yazın; adet tam sayı olmalı.','Invalid value. Enter one number; pieces must be whole.'),[choice(cancel,'cancel')]);
  if(field==='quantity'){pending={kind:'reason',field,value};return result(t('Qalığı niyə düzəldirik? Səbəbini yazın, məsələn: “Faktiki sayım”.','Stoku neden düzeltiyoruz? Örneğin: “Fiziksel sayım”.','Why are we correcting stock? For example: “Physical count”.'),[choice(cancel,'cancel')]);}
  return preview(field,value);
 };
 const inlineValue=(raw,product,field)=>{
  let detail=String(raw).toLocaleLowerCase('az');
  for(const key of [product.name,product.sku,product.barcode].filter(Boolean))detail=detail.replace(String(key).toLocaleLowerCase('az'),'');
  if(field==='name')return detail.match(/[“"]([^”"]+)[”"]/u)?.[1]||'';
  const values=detail.match(/[+-]?\d+(?:[.,]\d+)?/g)||[];
  return values.length===1?values[0]:'';
 };
 const ready=async(product,store,request,valid)=>{
  await fresh(product,store,valid);
  if(request.intent!=='edit'){pending=null;return result(describe(selected));}
  if(request.quantity){
   const amount=quantityInStockUnit(request.quantity.value,request.quantityUnit,selected.product.unit);if(amount===null||request.quantity.operation!=='set'&&amount<0)return result(t(`Miqdarı ${selected.product.unit} vahidinə uyğun, dəqiq rəqəmlə yazın. Artırma və azaltmada müsbət miqdar istifadə edin.`,`Miktarı ${selected.product.unit} biriminde doğru yazın.`,`Enter a precise quantity compatible with ${selected.product.unit}. Use positive amounts for increases/decreases.`));
   const target=request.quantity.operation==='increase'?selected.qtyMilli+amount:request.quantity.operation==='decrease'?selected.qtyMilli-amount:amount;
   if(!Number.isSafeInteger(target)||Math.abs(target)>1000000000)return result(t('Miqdar çox böyükdür.','Miktar çok büyük.','The quantity is too large.'));
   const answer=takeValue('quantity',String(target/1000));
   if(pending?.kind==='reason')answer.body=`${selected.product.name} · ${selected.warehouse.name}\n${fmt(selected.qtyMilli,1000)} ${selected.product.unit} → ${fmt(target,1000)} ${selected.product.unit}\n`+answer.body;
   return answer;
  }
  if(!request.field)return askField();
  const value=inlineValue(request.raw,product,request.field);
  return value?takeValue(request.field,value):askValue(request.field);
 };
 const chooseProduct=async(product,request,valid)=>{
  const data=await tools.catalogue();if(!valid())throw Error('stale conversation');
  const stores=data.warehouses.filter(w=>w.active!==0&&w.active!==false);
  const store=stores.find(w=>w.id===(request.warehouseId||lastOverview?.store))||stores.find(w=>w.id===data.homeWarehouseId)|| (stores.length===1?stores[0]:null);
  if(!store){pending={kind:'warehouse',product,request,stores};return result(t(`Hansı anbarda ${product.name} üçün baxaq?`,`${product.name} için hangi depoya bakalım?`,`Which warehouse should I check for ${product.name}?`),stores.map(w=>choice(w.name,'warehouse:'+w.id)));}
  return ready(product,store.id,request,valid);
 };
 const lookup=async(request,valid)=>{
  const data=await tools.catalogue();if(!valid())throw Error('stale conversation');
  const matches=rankProducts(data.products,request.query);const exact=matches.filter(m=>m.nameExact&&!m.fuzzy);
  if(exact.length===1)return chooseProduct(exact[0].product,request,valid);
  if(!matches.length){pending={kind:'product',request,products:data.products};return result(t(`“${request.query}” adında məhsul tapmadım. Başqa adla və ya barkodla yoxlayaq?`,`“${request.query}” adlı ürün bulunamadı. Başka ad veya barkod deneyelim mi?`,`I could not find “${request.query}”. Try another name or barcode?`));}
  if(matches.length===1&&!matches[0].fuzzy)return chooseProduct(matches[0].product,request,valid);
  pending={kind:'product',request,products:data.products};
  if(matches.every(m=>m.fuzzy))return result(t(`“${request.query}” adında məhsul tapmadım. Bunu demək istəyirdiniz: ${matches.map(m=>m.product.name).join(', ')}?`,`“${request.query}” bulunamadı. Bunu mu demek istediniz: ${matches.map(m=>m.product.name).join(', ')}?`,`No “${request.query}”. Did you mean: ${matches.map(m=>m.product.name).join(', ')}?`),matches.map(({product})=>choice(product.name,'product:'+product.id)));
  return result(t('Bir neçə uyğun məhsul var. Hansını nəzərdə tutursunuz?','Birkaç ürün eşleşiyor. Hangisini kastediyorsunuz?','Several products match. Which one do you mean?'),matches.map(({product})=>choice(product.name,'product:'+product.id)));
 };
 const showOverview=async(store,mode,offset,valid)=>{
  const snapshot=await tools.overview(store);if(!valid())throw Error('stale conversation');
  const low=mode===1,negativeOnly=mode===2;
  const products=snapshot.products.filter(p=>negativeOnly?p.qtyMilli!==null&&p.qtyMilli<0:!low||p.qtyMilli!==null&&p.qtyMilli<=Number(p.minQtyMilli||0));
  const shown=products.slice(offset,offset+12),qty=p=>p.qtyMilli===null?t('qalıq alınmadı','stok alınamadı','stock unavailable'):fmt(p.qtyMilli,1000)+' '+p.unit;
  const lines=shown.map((p,i)=>`${offset+i+1}. ${p.name}: ${qty(p)}${p.qtyMilli<0?t(' — mənfi',' — negatif',' — negative'):p.qtyMilli===0?t(' — bitib',' — bitti',' — out'):''}`);
  if(pending?.kind!=='reason'){pending=null;approval=null;}lastOverview={store,products:snapshot.products};
  const all=snapshot.products,negative=all.filter(p=>p.qtyMilli!==null&&p.qtyMilli<0),zero=all.filter(p=>p.qtyMilli===0),inStock=all.filter(p=>p.qtyMilli>0);
  const time=new Date(snapshot.readAt).toLocaleTimeString(language==='en'?'en-GB':language==='tr'?'tr-TR':'az-AZ',{timeZone:'Asia/Baku',hour12:false,hour:'2-digit',minute:'2-digit'});
  const notes=[];
  if(!low&&offset===0&&negative.length)notes.push(t(`Mənfi qalıq (${negative.map(p=>p.name).join(', ')}) o deməkdir ki, satış anbara qəbul ediləndən çox olub: ya alış (mal qəbulu) yazılmayıb, ya da faktiki sayım fərqlidir. Düzəltmək üçün, məsələn, “${negative[0].name} ${Math.abs(negative[0].qtyMilli/1000)} ${negative[0].unit} artır” yazın; təsdiqinizdən əvvəl plan göstərəcəyəm.`,`Negatif stok (${negative.map(p=>p.name).join(', ')}): satış girişten fazla. Alış yazılmamış veya sayım farklı.`,`Negative stock (${negative.map(p=>p.name).join(', ')}) means more was sold than received: a purchase is missing or the count differs.`));
  if(!low&&!negativeOnly&&offset===0&&zero.length)notes.push(t(`Bitənlər: ${zero.map(p=>p.name).join(', ')}. Yeni alış lazımdırsa, Təchizat → Mal qəbulu bölməsindən daxil edin.`,`Bitenler: ${zero.map(p=>p.name).join(', ')}.`,`Out of stock: ${zero.map(p=>p.name).join(', ')}.`));
  return result(`${t('Anbar','Depo','Warehouse')}: “${snapshot.warehouse.name}” · ${t('canlı məlumat','canlı veri','live data')}, ${time} (${t('Bakı vaxtı','Bakü saati','Baku time')})
${t(`Cəmi ${all.length} mal: ${inStock.length}-də qalıq var, ${zero.length} bitib, ${negative.length} mənfidədir.`,`Toplam ${all.length} ürün: ${inStock.length} stokta, ${zero.length} bitti, ${negative.length} negatif.`,`${all.length} items: ${inStock.length} in stock, ${zero.length} out, ${negative.length} negative.`)}${low?'\n'+t('Yalnız bitən və minimum həddə çatanlar:','Yalnızca biten ve minimumdakiler:','Only out-of-stock and minimum-level items:'):negativeOnly?'\n'+t('Yalnız mənfi qalıqda olanlar:','Yalnızca negatif stoktakiler:','Only items with negative stock:'):''}

${products.length?lines.join('\n'):negativeOnly?t('Mənfi qalıqda mal yoxdur.','Negatif stokta ürün yok.','No item has negative stock.'):t('Bu seçimə uyğun məhsul yoxdur.','Bu seçime uygun ürün yok.','No products match this selection.')}${products.length>12?`\n(${offset+1}–${Math.min(offset+12,products.length)} / ${products.length})`:''}${notes.length?'\n\n'+notes.join('\n\n'):''}`, [ ...(offset>0?[choice(t('Əvvəlki','Önceki','Previous'),`overview:${store}:${mode}:${Math.max(0,offset-12)}`)]:[]),...(offset+12<products.length?[choice(t('Növbəti məhsullar','Sonraki ürünler','Next products'),`overview:${store}:${mode}:${offset+12}`)]:[]),...(mode?[choice(t('Bütün məhsullar','Tüm ürünler','All products'),`overview:${store}:0:0`)]:[]),...(mode!==1?[choice(t('Bitən / minimum qalıq','Tükenen / minimum stok','Out / minimum stock'),`overview:${store}:1:0`)]:[]),...(negativeOnly&&products.length===1?[choice(t(`${products[0].name} qalığını düzəlt`,`${products[0].name} stokunu düzelt`,`Fix ${products[0].name} stock`),`${products[0].name} qalığını dəyiş`)]:[])]);
 };
 const overview=async(mode,valid)=>{const data=await tools.catalogue();if(!valid())throw Error('stale conversation');const stores=data.warehouses.filter(w=>w.active!==0&&w.active!==false);const store=stores.find(w=>w.id===data.homeWarehouseId)||(stores.length===1?stores[0]:null);if(store)return showOverview(store.id,mode,0,valid);return result(t('Hansı anbara baxaq?','Hangi depoya bakalım?','Which warehouse should I check?'),stores.map(w=>choice(w.name,`overview:${w.id}:${mode}:0`)));};
 const scope=()=>t('Bu sualın cavabını verə bilmirəm: mən Possistem köməkçisiyəm və yalnız restoranınızın işi ilə kömək edirəm — satış və kassa, masalar və açıq hesablar, anbar qalığı, menyu və kalkulyasiya, printer, abunəlik. Sualınızı bu mövzularda bir cümlə ilə yazın, məsələn: “bugünkü satış”, “açıq masalar nə qədər işləyib”, “anbarda mənfi olanları göstər”.','Bu soruyu cevaplayamam: yalnızca restoranınızın işleriyle (satış, masalar, depo, reçete, yazıcı, abonelik) yardım ediyorum.','I can’t answer that: I only help with your restaurant’s work — sales, tables, stock, recipes, printer and subscription.');
 const scopeChoices=()=>[choice(t('Bugünkü satış','Bugünkü satış','Today’s sales'),'Bugünkü satış'),choice(t('Açıq masalar','Açık masalar','Open tables'),'açıq masalar nə qədər işləyib'),choice(t('Anbara bax','Depoya bak','Check inventory'),'Anbarımda nə var?'),choice(t('Kalkulyasiya','Reçete','Recipe'),'Kalkulyasiya yarat')];
 const fallback=async(input,history)=>{
  const reply=await help?.(input,history),body=compactHelp(reply);
  if(reply?.id==='account_context')return result(body,[choice(t('Anbara bax','Depoya bak','Check inventory'),'Anbarımda nə var?'),choice(t('Bugünkü satış','Bugünkü satış','Today’s sales'),'Bugünkü satış'),choice(t('Kassa balansı','Kasa bakiyesi','Cash balance'),'Kassada nə qədər pul var?'),choice(t('Masalar','Masalar','Tables'),'Masaları göstər')],reply);
  if(reply?.id==='unknown')return miss(result(scope(),scopeChoices(),reply));
  if(reply?.id==='clarify'){const options=(reply.chips||[]).filter(c=>c?.label&&c?.send&&!String(c.send).startsWith('#agent:')).map(c=>choice(c.label,c.send));if(options.length)return miss(result(body,options,reply));}
  if(/Başa düşmək üçün bir az dəqiqləşdirək|32 yoxlama/.test(body))return miss(result(t('Bu cümlədə hansı işi istədiyinizi ayıra bilmədim. Aşağıdan işi seçin və ya məhsulun adını daha dəqiq yazın.','Ne yapmak istediğinizi netleştiremedim. Bir işlem seçin veya ürün adını yazın.','I could not identify the task in that sentence. Choose an action below or give the exact item name.'),[choice(t('Anbara bax','Depoya bak','Check inventory'),'Anbarımda nə var?'),choice(t('Yeni məhsul','Yeni ürün','New product'),'Yeni məhsul yarat'),choice(t('Kalkulyasiya','Reçete','Recipe'),'Kalkulyasiya yarat'),choice(t('Abunəlik','Abonelik','Subscription'),'Abunəliyimə bax'),choice(t('Masalar','Masalar','Tables'),'Masaları göstər')]));
  return result(body,[],reply);
 };
 // Several requests in one message: read-only answers first, then the first change as a plan; further changes wait their turn.
 const WRITES=new Set(['z_report','waste','receive','x_report','edit','table_delete','table_edit','area_create','tables_add','recipe_create','product_create','table_create','stock_add','printer_test']);
 async function many(parts,history,valid,inner=false){
  const greeting=parts.some(p=>/^(?:salam|slm|sa|merhaba|hello)$/.test(normalize(p))),notes=[];
  const asks=parts.filter(p=>!/^(?:salam|slm|sa|merhaba|hello)$/.test(normalize(p))).map(p=>{if(interpret(p).intent!=='unknown')return p;const fixed=suggestCorrection(p);if(fixed&&interpret(fixed).intent!=='unknown'){notes.push(`«${p}» → «${fixed}»`);return fixed;}return p;});
  if(asks.length<2||asks.some(p=>['unknown','help','social','cancel','confirm'].includes(interpret(p).intent)))return null;
  const reads=asks.filter(p=>!WRITES.has(interpret(p).intent)),changes=asks.filter(p=>WRITES.has(interpret(p).intent)),out=[];let n=0,last=null;
  for(const p of reads){const a=await respond(p,history,valid,true);out.push(`${++n}) ${p}\n${a.body}`);}
  if(changes.length){last=await respond(changes[0],history,valid,true);out.push(`${++n}) ${changes[0]}\n${last.body}`);}
  queue=changes.slice(1);
  const head=(greeting?t('Salam! ','Merhaba! ','Hello! '):'')+t(`Mesajınızda ${asks.length} istək var, sırayla cavab verirəm.`,`Mesajınızda ${asks.length} istek var, sırayla yanıtlıyorum.`,`Your message has ${asks.length} requests; answering in order.`)+(notes.length?'\n'+t(`Yazı səhvlərini belə başa düşdüm: ${notes.join(', ')}.`,`Yazım hatalarını böyle anladım: ${notes.join(', ')}.`,`I read typos as: ${notes.join(', ')}.`):'');
  const tail=queue.length?'\n\n'+t(`Dəyişiklikləri bir-bir edirəm, çünki hər birini ayrıca təsdiq etməlisiniz. Bu plandan sonra növbəti: ${queue.map(q=>'«'+q+'»').join(', ')}.`,`Değişiklikleri tek tek yapıyorum. Sırada: ${queue.map(q=>'«'+q+'»').join(', ')}.`,`Changes go one at a time. Next: ${queue.map(q=>'«'+q+'»').join(', ')}.`):'';
  return result(head+'\n\n'+out.join('\n\n')+tail,last?last.choices:[]);
 }
 // The core lets the assistant change only a card's name and sale price; a cost wish is explained, not attempted.
 async function costNote({name,value},valid){
  let product=null;try{product=findByName((await tools.catalogue()).products,name);}catch(error){if(error?.pendingTool)throw error;}if(!valid())throw Error('stale conversation');
  const label=product?.name||name,unit=product?.unit||'',now=Number.isSafeInteger(product?.costMinor)&&product.costMinor>0?t(` İndiki maya qiyməti: ${fmt(product.costMinor,100)} ₼${unit?' / '+unit:''}.`,` Şu anki maliyet: ${fmt(product.costMinor,100)} ₼.`,` Current cost: ${fmt(product.costMinor,100)} ₼.`):'';
  return t(`“${label}” üçün maya (alış) qiymətini ${fmt(Math.round(Number(value)*100),100)} ₼${unit?' / '+unit:''} etməyi istədiniz. Maya qiyməti mal qəbulu ilə yenilənir.${now} Bunun üçün alışı yazın, məsələn “${label} 25 ${unit||'kq'} aldım ${value} manatdan”; qalıq artacaq və maya qiyməti ${fmt(Math.round(Number(value)*100),100)} ₼ olacaq.`,`“${label}” maliyetini köməkçi henüz değiştiremez; Depo'da kartı açıp yazın.${now}`,`I can’t change the cost of “${label}” yet; open its card in Inventory.${now}`);
 }
 async function showRecipe(name,valid){
  const menu=await tools.setupMenu();if(!valid())throw Error('stale conversation');
  const ask=body=>result(body,menu.products.slice(0,8).map(p=>choice(p.name,`${p.name} kalkulyasiyasını göstər`)));
  if(!name){
   // "kalkulyasiyada nələr var": which dishes have a recipe, and their cost where it is known.
   const goods=await tools.setupRaw(),shown=menu.products.slice(0,15),rows=[];if(!valid())throw Error('stale conversation');
   for(const dish of shown){const r=await tools.setupRecipe(dish.id);if(!valid())throw Error('stale conversation');const has=!r.placeholder&&(r.lines.length||r.components.length);
    let cost=0,known=!r.components.length;for(const l of r.lines){const each=Number(goods.find(g=>g.id===l.ingredientId)?.costMinor);if(Number.isSafeInteger(each)&&each>0)cost+=Math.round(each*l.qtyMilli/1000);else known=false;}
    rows.push({dish,has,count:r.lines.length+r.components.length,cost:known&&cost?cost:null});}
   const done=rows.filter(r=>r.has),missing=rows.filter(r=>!r.has);
   if(!menu.products.length)return result(t('Menyuda hələ yemək yoxdur, ona görə kalkulyasiya da yoxdur.','Menüde ürün yok.','There are no dishes yet.'));
   return result(t(`Kalkulyasiyalar · ${menu.products.length} yeməkdən ${done.length}-nin kalkulyasiyası var${menu.products.length>shown.length?` (ilk ${shown.length} yeməyə baxdım)`:''}.`,`Reçeteler: ${done.length} / ${menu.products.length}.`,`Recipes: ${done.length} of ${menu.products.length}.`)
    +(done.length?'\n\n'+done.map(r=>`• ${r.dish.name}: ${r.count} tərkib${r.cost?` · maya ${fmt(r.cost,100)} ₼`:''}`).join('\n'):'')
    +(missing.length?'\n\n'+t(`Kalkulyasiyası olmayanlar: ${missing.map(r=>r.dish.name).join(', ')}. Bunlar satılanda anbardan tərkib silinmir.`,`Reçetesi olmayanlar: ${missing.map(r=>r.dish.name).join(', ')}.`,`Without a recipe: ${missing.map(r=>r.dish.name).join(', ')}.`):''),
    [...done.slice(0,4).map(r=>choice(r.dish.name,`${r.dish.name} kalkulyasiyasını göstər`)),...missing.slice(0,3).map(r=>choice(t(`${r.dish.name}: yarat`,`${r.dish.name}: oluştur`,`${r.dish.name}: create`),`${r.dish.name} kalkulyasiya yarat`))]);
  }
  // A good named exactly ("un") wins over a dish that only contains the word ("lahmacun").
  let dish=findByName(menu.products,name);const stockGoods=dish?[]:await tools.setupRaw().catch(e=>{if(e?.pendingTool)throw e;return[];}),stock=dish?null:findByName(stockGoods.filter(g=>!/^MENU-/.test(g.sku||'')),name);if(!valid())throw Error('stale conversation');
  if(!dish&&!stock)dish=(()=>{const m=rankProducts(menu.products,name);return m.length===1&&!m[0].fuzzy?m[0].product:null;})();
  if(!dish){
   if(stock)return result(t(`“${stock.name}” anbarda mal kimi var, amma menyuda yemək kimi yoxdur, ona görə kalkulyasiyası da yoxdur. Kalkulyasiya satılan yeməyə yazılır: istəsəniz “${stock.name}” yeməyini yaradım və tərkibini birlikdə yazaq.`,`“${stock.name}” menüde yok.`,`“${stock.name}” is not on the menu.`),[choice(t(`“${stock.name}” yeməyini yarat və kalkulyasiya yaz`,`“${stock.name}” oluştur`,`Create “${stock.name}”`),`${stock.name} kalkulyasiya yarat`),...menu.products.slice(0,3).map(p=>choice(p.name,`${p.name} kalkulyasiyasını göstər`))]);
   return ask(t(`Menyuda “${name}” adlı yemək tapmadım. Aşağıdan seçin.`,`Menüde “${name}” yok.`,`No “${name}” on the menu.`));}
  const [recipe,goods]=[await tools.setupRecipe(dish.id),await tools.setupRaw()];if(!valid())throw Error('stale conversation');
  const create=choice(t(`${dish.name} üçün kalkulyasiya yarat`,`${dish.name} reçetesi oluştur`,`Create a recipe for ${dish.name}`),`${dish.name} kalkulyasiya yarat`);
  if(recipe.placeholder||!recipe.lines.length&&!recipe.components.length)return result(t(`${dish.name} üçün kalkulyasiya hələ yazılmayıb.${recipe.placeholder?' İndi hər satışda anbardan “'+dish.name+'” kartının özündən 1 ədəd silinir.':' Satılanda anbardan heç nə silinmir.'}\nKalkulyasiya 1 porsiyanın hansı xammaldan, nə qədər hazırlandığını göstərir. Yaratmaq üçün aşağıdakı düyməni seçin.`,`${dish.name} için reçete yok.`,`${dish.name} has no recipe yet.`),[create]);
  let cost=0,known=true;
  const lines=recipe.lines.map(l=>{const good=goods.find(g=>g.id===l.ingredientId),unit=l.unit||good?.unit||'',each=Number(good?.costMinor);if(Number.isSafeInteger(each)&&each>0)cost+=Math.round(each*l.qtyMilli/1000);else known=false;return`• ${l.name||good?.name||'—'}: ${fmt(l.qtyMilli,1000)} ${unit}${Number.isSafeInteger(each)&&each>0?` · ${fmt(Math.round(each*l.qtyMilli/1000),100)} ₼`:''}`;});
  const parts=recipe.components.map(c=>`• ${menu.products.find(p=>p.id===c.menuItemId)?.name||'hazır resept'}: ${fmt(c.qtyMilli,1000)} porsiya`);if(parts.length)known=false;
  const price=Number(dish.priceMinor);
  return result(`${t('Kalkulyasiya','Reçete','Recipe')} · ${dish.name} · ${t('1 porsiya','1 porsiyon','1 portion')}\n${[...lines,...parts].join('\n')}${known&&cost?'\n'+t(`Maya dəyəri: ${fmt(cost,100)} ₼`,`Maliyet: ${fmt(cost,100)} ₼`,`Cost: ${fmt(cost,100)} ₼`)+(Number.isSafeInteger(price)&&price>0?t(` · satış qiyməti ${fmt(price,100)} ₼ · qazanc ${fmt(price-cost,100)} ₼`,` · satış ${fmt(price,100)} ₼`,` · price ${fmt(price,100)} ₼`):''):'\n'+t('Bəzi xammalların maya qiyməti yazılmayıb, ona görə ümumi maya dəyərini hesablamadım.','Bazı maliyetler eksik.','Some costs are missing.')}\n${t('Satış olanda bu miqdarlar anbardan avtomatik silinir. Dəyişmək üçün Kalkulyasiya bölməsində bu yeməyi açın.','Satışta stoktan düşer.','Sales consume these amounts.')}`);
 }
 // A question about the restaurant's own records: Groq writes one read-only query, the till runs it with its own limits.
 async function answerData(question,valid){
    const q=await askSql(question);
    if(!q?.sql)return{...miss(result(t('Bu sualı məlumatla cavablandıra bilmədim. Başqa sözlə yazın və ya daha dar soruşun, məsələn “keçən həftə hansı ofisiant ən çox satıb”.','Bu soruyu verilerle yanıtlayamadım.','I could not answer that from the data.'),scopeChoices())),ai:true};
    let data;try{data=await tools.dataQuery(q.sql);}catch(error){if(error?.pendingTool)throw error;return{...miss(result(t(`Məlumatı oxumaq alınmadı: ${error?.message||error}. Sualı başqa cür yazın.`,'Veri okunamadı.','Could not read the data.'),scopeChoices())),ai:true};}
    if(!valid())throw Error('stale conversation');
    const cell=v=>v===null||v===undefined?'—':typeof v==='number'?v.toLocaleString(language==='en'?'en-GB':language==='tr'?'tr-TR':'az-AZ',{maximumFractionDigits:3}):String(v);
    // SUM over nothing is one row of NULLs: that is "no data", not a dash.
    if(data.rows.length&&data.rows.every(r=>r.every(v=>v===null||v===undefined)))data={...data,rows:[]};
    const lines=data.rows.slice(0,20).map((row,i)=>data.columns.length===1?`• ${cell(row[0])}`:`${i+1}. `+data.columns.map((c,j)=>`${c}: ${cell(row[j])}`).join(' · '));
    lastData={title:String(q.explain||question).replace(/[.\s]+$/,'').slice(0,80),sql:q.sql};
    return{...result((q.explain?q.explain+'\n\n':'')+(data.rows.length?lines.join('\n')+(data.rows.length>20||data.truncated?'\n'+t(`… daha çox sətir var; sualı daraldın.`,'… daha fazla satır var.','… more rows.'):''):t('Bu suala uyğun məlumat tapılmadı.','Uygun veri yok.','No matching data.'))+'\n'+t('Canlı məlumat, yalnız oxunub; heç nə dəyişməyib.','Canlı veri, yalnızca okundu.','Live data, read only.'),data.rows.length?[choice(t('📄 PDF kimi yüklə','📄 PDF olarak indir','📄 Download as PDF'),'pdf:last')]:[]),ai:true};
 }
 async function respond(input,history,valid,inner=false){
  // A choice typed as it reads on screen ("11 · panda") is the same as tapping it.
  const typed=!choices.some(c=>c.value===String(input).trim())&&choices.find(c=>c.value!==c.label&&normalize(c.label)&&normalize(c.label)===normalize(input));
  if(typed)return respond(typed.value,history,valid,inner);
  const raw=String(input).trim(),text=normalize(raw),plan=interpret(raw),picked=choices.find(c=>c.value===raw);
  // A product search left open by an earlier answer does not swallow a new sentence.
  if(!inner&&!picked&&pending?.kind==='product'&&text.split(' ').length>=3&&plan.intent!=='unknown')pending=null;
  // A new sentence of several requests ("1 masada nə var, masa 99-u sil, …") is not an answer to the open step: that step is dropped, the message read afresh.
  if(!inner&&!picked&&!idle()&&text.split(' ').length>=6&&raw.split(/,(?!\d)|;|\n/).filter(p=>normalize(p).split(' ').length>=2).length>=2){printerOps.cancel();tableOps.cancel();setup.cancel();stockOps.cancel();clear();selected=null;}
  if(picked?.value==='queue:next'&&queue.length){const next=queue.shift();return respond(next,history,valid,inner);}
  if(picked?.value==='queue:clear'){queue=[];return result(t('Yaxşı, qalan istəkləri buraxdım. Başqa nə edək?','Tamam, kalan istekleri bıraktım.','OK, I dropped the remaining requests.'));}
  if(picked?.value==='typo:no')return miss(result(t('Yaxşı, onda sualı başqa sözlə yazın. Mən satış, masalar, anbar, kalkulyasiya, printer və abunəlik üzrə kömək edirəm.','Tamam, soruyu başka sözlerle yazın.','OK, please rephrase the question.')));
  const knowledge=await help?.(raw,history);
  // Groq reads every free message first and rewrites it into our own command phrases. It never acts:
  // each phrase still passes interpret(), every change still waits for confirmation, and without an answer from Groq the rules below take over.
  // Groq reads every typed message that is not an answer to an open step (a step's own question is answered by the step).
  // When Groq finds no command but the rules know the request ("bütün masaları sil"), the rules answer; Groq never turns a known request into "cannot".
  const weak=plan.multi||plan.intent==='unknown'||plan.intent==='help'&&(!knowledge||['unknown','clarify'].includes(knowledge.id))||plan.intent==='lookup'&&text.split(' ').length>=6||plan.intent==='tables'&&!plan.money&&!plan.count&&!plan.table&&!/\b(?:goster\w*|siyahi\w*|bax|list\w*|var|butun|hamisi\w*|bos|aciq)\b/.test(text);
  // A plan waiting only for "Təsdiq et" asks for no typed answer, so a typed message there is read like any other.
  const onlyConfirm=!!approval&&!pending&&!setup.active&&!tableOps.active&&!printerOps.active&&!stockOps.active;
  if(!inner&&!picked&&(idle()||onlyConfirm)&&understand&&!['cancel','confirm','social'].includes(plan.intent)&&!/^[+-]?\d+(?:[.,]\d+)?\s*\p{L}{0,6}$/u.test(raw)&&!/^[a-z]+:[\w:.-]+$/i.test(raw)){
   // A copy: the reading is kept for replays of this turn, so nothing below may change the original.
   const reading=structuredClone(await understand()),usable=c=>isCommand(c)&&!['unknown','help','social','cancel','confirm'].includes(interpret(c).intent);
   // Groq sometimes files one of our own forms ("printeri test et") under unsupported; that is a command, not a refusal.
   // "salam sən kimsən", "restoranımın adı": requests the rules know by heart are commands too, in our own form.
   const known={identity:'sən kimsən',profile:'restoranımın adı nədir'};
   if(reading)reading.unsupported=(reading.unsupported||[]).filter(u=>{const form=usable(u)?u:known[interpret(u).intent];if(form){reading.commands=[...(reading.commands||[]),form];return false;}return true;});
   // An "ignored" part the rules read as restaurant work ("bugünkü satış nə qədərdir") is not off-topic.
   const ownWork=c=>!['unknown','help','social','cancel','confirm','lookup','capabilities'].includes(interpret(c).intent);
   const recovered=[];
   if(reading)reading.ignored=(reading.ignored||[]).filter(u=>{const form=known[interpret(u).intent];if(form)reading.commands=[...(reading.commands||[]),form];else if(ownWork(u))recovered.push(u);return!form&&!ownWork(u);});
   // Groq sometimes drops a part of a long message. A comma part none of its items shares a word with is put back: as the rules read it, or as a data question.
   if(reading){const said=[...(reading.commands||[]),...(reading.unsupported||[]),...(reading.ignored||[]),...recovered].map(x=>normalize(x).split(' ').filter(w=>w.length>=4).map(w=>w.slice(0,4))).flat();
    const clauses=raw.split(/,(?!\d)|;|\n/).map(c=>c.trim()).filter(c=>normalize(c).split(' ').length>=3);
    if(clauses.length>=2)for(const c of clauses){const words=normalize(c).split(' ').filter(w=>w.length>=4);if(!words.length||words.some(w=>said.includes(w.slice(0,4))))continue;const p=interpret(c).intent,question=p==='lookup'&&/\b(?:ne qeder|nece|hansi\w*|kim|orta\w*|xerc\w*)\b/.test(normalize(c))&&!/\b(?:qal\w*|anbar\w*|stok\w*)\b/.test(normalize(c));
     if(!question&&!['unknown','help','social','cancel','confirm'].includes(p))recovered.push(c);else if(askSql&&tools.dataQuery)recovered.push('SUAL: '+c);}}
   // Groq's own phrases must be in a listed form; the person's own words put back above go as they are.
   const commands=[...(reading?.commands||[]).filter(usable),...recovered].slice(0,6);
   // Our own words say what was understood: the AI's sentence may claim a change that has not happened.
   const said=t(`Belə başa düşdüm: ${commands.map(c=>'“'+c+'”').join(', ')}.`,`Şöyle anladım: ${commands.map(c=>'“'+c+'”').join(', ')}.`,`I understood: ${commands.map(c=>'“'+c+'”').join(', ')}.`);
   // Some requests are not missing features but things the assistant must never do; say so plainly.
   const never=(reading?.unsupported||[]).filter(u=>/\b(?:pin\w*|parol\w*|sifre\w*|kod\w*|token\w*|acar\w*)\b/.test(normalize(u))||/\b(?:sil\w*|legv\w*|temizle\w*|poz\w*)\b/.test(normalize(u))&&/\b(?:sifaris\w*|satis\w*|hesabat\w*|cek\w*|odenis\w*|tarixce\w*|z\b)/.test(normalize(u)));
   if(reading&&never.length){reading.unsupported=reading.unsupported.filter(u=>!never.includes(u));}
   const refused=never.length?'\n\n'+[never.some(u=>/\b(?:pin\w*|parol\w*|sifre\w*|kod\w*|token\w*|acar\w*)\b/.test(normalize(u)))?t('Təhlükəsizlik üçün işçi PIN-ləri, parollar və giriş açarları köməkçidə heç vaxt göstərilmir. PIN-i yalnız işçinin özü İdarə → İşçilər bölməsində dəyişə bilər.','PIN ve parolalar asla gösterilmez.','PINs and passwords are never shown.'):'',never.some(u=>/\b(?:sil\w*|legv\w*|temizle\w*|poz\w*)\b/.test(normalize(u)))?t('Satış, sifariş və ödəniş tarixçəsi silinmir: hesabatlar və vergi uçotu ona əsaslanır. Səhv sifariş kassada səbəb yazılaraq ləğv edilir, ləğv də tarixçədə qalır.','Satış geçmişi silinmez.','Sales history is never deleted.'):''].filter(Boolean).join('\n'):'';
   const cannot=(reading?.unsupported||[]).length?'\n\n'+t(`Bunu köməkçi hələ edə bilmir: ${reading.unsupported.map(u=>'«'+u+'»').join(', ')}. Bu istəyi komandaya ötürdüm.${reading.unsupported.some(u=>/qaim/i.test(normalize(u)))?' Qaimələrə İdarə → Maliyyə bölməsində baxa bilərsiniz.':''}${reading.unsupported.some(u=>/\b[xz]\b.*hesabat|hesabat\w* [xz]\b/.test(normalize(u)))?' X və Z hesabatını kassada İdarə paneli səhifəsindən çıxara bilərsiniz.':''}`,`Bunu henüz yapamıyorum: ${reading.unsupported.join(', ')}.`,`I can’t do this yet: ${reading.unsupported.join(', ')}.`):'';
   // Off-topic parts of a mixed message are named, not answered and not filed as a missing feature.
   const skipped=(reading?.ignored||[]).length?'\n\n'+t(`«${reading.ignored.join('», «')}» restoranınızın işinə aid olmadığı üçün ona cavab vermədim.`,`«${reading.ignored.join('», «')}» işinize ait değil.`,`I skipped «${reading.ignored.join('», «')}»: not about the restaurant.`):'';
   const doors=screensFor([...(reading?.unsupported||[]),...never,raw].join(' '));
   // What the assistant cannot do comes with the screen where the person can do it ("çekə loqo qoy" → Çek: loqo).
   const flag=answer=>cannot||refused||skipped?{...(cannot?miss(answer):answer),body:answer.body+refused+cannot+skipped,choices:[...(answer.choices||[]),...(cannot||refused?screensFor([...(reading?.unsupported||[]),...never].join(' ')):[])].slice(0,6)}:answer;
   if(refused&&!commands.length&&!cannot)return{...result(refused.trim(),screensFor(never.join(' ')).concat(scopeChoices()).slice(0,4)),ai:true};
   // Groq agreeing with a clear rule reading adds nothing; the rules' own reading keeps the person's details ("bütün", names).
   // A single Groq command never overrides a confident rule reading: the rules know the till's own words ("töküldü" is a write-off, "kilosu 3 manat" a receipt).
   const same=commands.length===1&&!weak&&!cannot&&!refused&&!skipped&&plan.intent!=='help'&&!splitRequests(raw).length;
   if(commands.length===1&&!same){const answer=await respond(commands[0],history,valid,true);return flag({...answer,body:said+'\n\n'+answer.body,ai:true});}
   if(commands.length>1){const answer=await many(commands,history,valid,true);if(answer)return flag({...answer,body:said+'\n'+answer.body,ai:true});}
   // A question about the restaurant's own records: Groq writes one read-only query, the till runs it with its own limits.
   if(reading?.kind==='data_question'&&!commands.length&&(weak||plan.intent==='help'||['tables','lookup'].includes(plan.intent)&&!plan.money&&!plan.table)&&askSql&&tools.dataQuery)return answerData(raw,valid);
   if(cannot&&(weak||plan.intent==='help'))return{...miss(result(cannot.trim()+(doors.length?'\n'+t(`Bunu proqramda özünüz edə bilərsiniz: ${doors.map(d=>d.where).join('; ')}.`,'',''):''),doors.length?doors:scopeChoices())),ai:true};
   if(weak&&reading?.kind==='off_topic')return{...result(scope(),scopeChoices()),ai:true};
   // An app question: a curated answer wins; otherwise the AI's short answer, marked and filed for the admin to check.
   if(weak&&reading?.kind==='app_question'&&reading.reply&&(!knowledge||['unknown','clarify'].includes(knowledge.id)))return{...miss(result(reading.reply+'\n\n'+t('Bu cavabı süni intellekt hazırlayıb. Dəqiq deyilsə, “👎 Səhv cavab” basın və ya Əməkdaş bölməsinə yazın.','Bu yanıtı yapay zekâ hazırladı.','This answer was written by AI.'),screensFor(raw))),ai:true};
  }
  if(!inner&&!picked&&idle()&&plan.intent!=='cancel'){const parts=splitRequests(raw);if(parts.length){const answer=await many(parts,history,valid);if(answer)return answer;}}
  // A misspelt request is offered back as a question; nothing runs until the person agrees.
  if(!inner&&!picked&&idle()&&plan.intent==='unknown'&&(!knowledge||['unknown','clarify'].includes(knowledge.id))){const fixed=suggestCorrection(raw);if(fixed&&interpret(fixed).intent!=='unknown')return result(t(`Bunu demək istəyirdiniz: “${fixed}”?`,`Bunu mu demek istediniz: “${fixed}”?`,`Did you mean: “${fixed}”?`),[choice(t(`Bəli, “${fixed}”`,`Evet, “${fixed}”`,`Yes, “${fixed}”`),fixed),choice(t('Xeyr, başqa şey','Hayır, başka','No, something else'),'typo:no')]);}
  if(plan.intent==='cancel'||picked?.value==='cancel'){queue=[];printerOps.cancel();tableOps.cancel();setup.cancel();stockOps.cancel();clear();selected=null;return result(t('Ləğv etdim. Başqa nə edək?','İptal ettim. Başka ne yapalım?','Cancelled. What else can I help with?'));}
  if(plan.intent==='social'||plan.intent==='unknown'&&!pending&&!setup.active&&!tableOps.active&&!printerOps.active&&['greeting','thanks','wellbeing','farewell','identity','about','invite','resolved'].includes(knowledge?.id))return result(compactHelp(knowledge),[],knowledge);
  if(plan.intent==='printer_test'){tableOps.cancel();setup.cancel();clear();const answer=await printerOps.start(valid);return result(answer.body,answer.choices);}
  if(printerOps.active&&(raw.startsWith('printer:')||plan.intent==='confirm')){const answer=await printerOps.send(raw,valid);return result(answer.body,answer.choices);}
  if(printerOps.active&&plan.intent!=='social')printerOps.cancel();
  if(plan.intent==='recipe_context'){const answer=setup.explainRecipe();return result(answer.body,answer.choices);}
  // "Yeni zal yarat, ora əlavə et" answers "which area for the tables?" instead of starting over.
  if(tableOps.addWaiting&&plan.intent==='area_create'){const answer=await tableOps.send(raw,valid);if(answer)return result(answer.body,answer.choices);}
  if(['table_delete','table_edit','area_create','tables_add'].includes(plan.intent)){setup.cancel();clear();selected=null;lastOverview=null;const answer=await tableOps.start(plan,valid);return result(answer.body,answer.choices);}
  if(tableOps.active&&(raw.startsWith('tableops:')||plan.intent==='unknown'||plan.intent==='confirm')){const answer=await tableOps.send(raw,valid);if(answer)return result(answer.body,answer.choices);}
  if(tableOps.active&&plan.intent!=='social')tableOps.cancel();
  if(plan.intent==='recipe_show'){clear();return showRecipe(plan.name,valid);}
  // "Xarab olub" answering "niyə silinir?" names no item: it answers the open step.
  const stockAnswer=stockOps.active&&['waste','receive'].includes(plan.intent)&&!plan.name;
  if(['waste','receive'].includes(plan.intent)&&!stockAnswer){tableOps.cancel();setup.cancel();printerOps.cancel();clear();selected=null;const answer=await stockOps.start(plan,valid);return result(answer.body,answer.choices);}
  if(stockOps.active&&(stockAnswer||raw.startsWith('stockops:')||plan.intent==='unknown'||plan.intent==='confirm'||plan.intent==='edit'&&/^\d/.test(raw))){const answer=await stockOps.send(raw,valid);if(answer)return result(answer.body,answer.choices);}
  if(stockOps.active&&plan.intent!=='social')stockOps.cancel();
  // "unun kilosu 3 manat": the cost price changes through a goods receipt, so that is what the assistant offers.
  if(plan.intent==='cost'){clear();const answer=await stockOps.start({intent:'receive',name:plan.name,price:plan.value},valid);return result(t('Maya qiyməti mal qəbulu ilə yenilənir: alışı qaimə ilə yazıram, qalıq artır və maya qiyməti yeni qiymətə keçir.\n','Maliyet mal kabulü ile güncellenir.\n','The cost price is updated by a goods receipt.\n')+answer.body,answer.choices);}
  if(['recipe_create','product_create','table_create'].includes(plan.intent)){clear();selected=null;lastOverview=null;const answer=await setup.start(plan,valid);if(plan.cost)answer.body+='\n\n'+await costNote(plan.cost,valid);return result(answer.body,answer.choices);}
  if(setup.active&&(plan.intent==='unknown'||plan.intent==='confirm'||raw.startsWith('setup:')||setup.tablePrompt&&plan.intent==='tables'||setup.pricePrompt&&plan.intent==='lookup'&&/qiymet/.test(text))){const answer=await setup.send(raw,valid);if(answer)return result(answer.body,answer.choices);}
  if(picked?.value.startsWith('overview:')){const [,store,low,offset]=raw.split(':');if(pending?.kind!=='reason')clear();return showOverview(store,Number(low)||0,Number(offset),valid);}
  if(plan.intent==='overview'){
   if(pending?.kind!=='reason'){clear();selected=null;}
   const previousOverview=lastOverview,answer=await overview(plan.negative?2:plan.low?1:0,valid);
   if(plan.diagnostic&&lastOverview!==previousOverview)answer.body+='\n'+t('Qalıqları yoxladım. Sıfır, mənfi və minimum həddə çatan mallar yuxarıda göstərilir. Bu, qiymət və ya giriş/çıxış problemini təsdiqləmir; fərqli problem varsa, məhsulun adını yazın.','Stokları kontrol ettim. Sıfır, negatif ve minimum stoklar yukarıdadır. Farklı bir sorun varsa ürün adını yazın.','I checked stock levels. Zero, negative and minimum-level items are listed above. This does not diagnose pricing or movement failures; name the item if the issue is different.');
   if(plan.low)answer.body+='\n'+t('Minimum həddi olmayan mallardan yalnız sıfır və mənfi qalıqlar göstərilir.','Minimumu olmayan ürünlerde yalnız sıfır/negatif stok gösterilir.','Items without a minimum threshold are listed only when stock is zero or negative.');
   if(pending?.kind==='reason'&&selected){answer.body+='\n\n'+t(`${selected.product.name} · ${selected.warehouse.name}: gözləyən qalıq düzəlişiniz saxlanılıb. Səbəbi yazın və ya Ləğv et seçin.`, 'Bekleyen stok taslağı saklandı. Neden yazın veya iptal edin.','Your pending stock correction is kept. Enter a reason or cancel.');answer.choices.push(choice(cancel,'cancel'));}
   if(setup.active){answer.body+='\n\n'+setup.hint();answer.choices.push(choice(t('Yaradılmaya qayıt','Oluşturmaya dön','Resume creation'),'setup:resume'));}
   return result(answer.body,answer.choices);
  }
  if(plan.intent==='recall'){
   const mine=(history||[]).filter(m=>m.author==='me'&&!/^#|^[a-z]+:/.test(m.body||'')),said=mine.at(-1),answer=[...(history||[])].reverse().find(m=>m.author==='helper')?.body||'';
   return result(said?t(`Sonuncu yazdığınız: “${said.body}”.\nMənim cavabım belə başlayırdı: “${answer.split('\n')[0].slice(0,160)}”.${mine.length>1?`\nOndan əvvəl: “${mine.at(-2).body}”.`:''}`,`Son yazdığınız: “${said.body}”.`,`You last wrote: “${said.body}”.`):t('Bu söhbətdə hələ başqa sual yazmamısınız.','Bu sohbette henüz başka bir şey yazmadınız.','You have not asked anything else in this chat yet.'));
  }
  if(plan.intent==='stock_add'){
   if(!plan.name)return result(t('Anbara nə əlavə edək? Malın adını və miqdarını yazın, məsələn: “cola 24 ədəd artır”. Anbarda olmayan yeni mal üçün “Yeni mal yarat” seçin. Alış qiyməti ilə gələn mal üçün Təchizat → Mal qəbulu bölməsi daha düzgündür.','Depoya ne ekleyelim? Ad ve miktar yazın, örn. “cola 24 adet artır”.','What should go into stock? Write the item and amount, e.g. “cola 24 pcs increase”.'),[choice(t('Yeni mal yarat','Yeni ürün','New item'),'Yeni məhsul yarat'),choice(t('Anbara bax','Depoya bak','Check inventory'),'Anbarımda nə var?')]);
   const data=await tools.catalogue();if(!valid())throw Error('stale conversation');
   const matches=rankProducts(data.products,plan.name),exact=matches.filter(m=>m.nameExact&&!m.fuzzy),found=exact.length===1?exact[0].product:matches.length===1&&!matches[0].fuzzy?matches[0].product:null;
   if(found){clear();setup.cancel();pending={kind:'add',product:found};return result(t(`“${found.name}” anbarda var. Neçə ${found.unit} artıraq? Yalnız rəqəmi yazın, məsələn “24”. Təsdiqdən əvvəl köhnə və yeni qalığı göstərəcəyəm.`,`“${found.name}” depoda var. Kaç ${found.unit} artıralım?`,`“${found.name}” is in stock. How many ${found.unit} should I add?`),[choice(cancel,'cancel')]);}
   if(matches.length){clear();return result(t(`“${plan.name}” adında bir neçə mal var. Hansını artıraq?`,`Birkaç ürün eşleşiyor.`,`Several items match.`),matches.slice(0,6).map(({product})=>choice(product.name,`anbara ${product.name} əlavə et`)));}
   clear();selected=null;lastOverview=null;const answer=await setup.start({intent:'product_create',name:plan.name},valid);
   return result(t(`“${plan.name}” anbarda yoxdur, ona görə əvvəl kartını yaradaq.\n`,`“${plan.name}” depoda yok; önce kartını oluşturalım.\n`,`“${plan.name}” is not in stock; let’s create it first.\n`)+answer.body,answer.choices);
  }
  if(pending?.kind==='add'&&/^\d+(?:[.,]\d{1,3})?\s*[\p{L}]*$/u.test(raw)){const [,value,unit]=raw.match(/^(\d+(?:[.,]\d{1,3})?)\s*([\p{L}]*)$/u);const product=pending.product;pending=null;return chooseProduct(product,{intent:'edit',field:'quantity',quantityUnit:unit?normalize(unit):null,quantity:{operation:'increase',value:value.replace(',','.')},raw},valid);}
  if(plan.intent==='sales'){clear();const {report,from,to}=await tools.sales(plan.period);if(!valid())throw Error('stale conversation');
   const day=x=>new Date(x).toLocaleDateString(language==='en'?'en-GB':language==='tr'?'tr-TR':'az-AZ',{timeZone:'Asia/Baku',day:'numeric',month:'long'}),clock=x=>new Date(x).toLocaleTimeString('az-AZ',{timeZone:'Asia/Baku',hour12:false,hour:'2-digit',minute:'2-digit'});
   const name={today:t('Bu gün','Bugün','Today'),yesterday:t('Dünən','Dün','Yesterday'),week:t('Bu həftə','Bu hafta','This week'),month:t('Bu ay','Bu ay','This month'),lastweek:t('Keçən həftə','Geçen hafta','Last week'),lastmonth:t('Keçən ay','Geçen ay','Last month')}[plan.period]||'';
   let open=[];try{open=(await tools.tables()).filter(r=>r.orderId);}catch(error){if(error?.pendingTool)throw error;}if(!valid())throw Error('stale conversation');
   const openNote=plan.period==='today'&&open.length?'\n'+t(`Açıq masalarda hələ ${open.length} hesab var (${fmt(open.reduce((n,r)=>n+(Number(r.totalMinor)||0),0),100)} ₼). Onlar bağlanana qədər bu rəqəmə düşmür.`,`Açık ${open.length} hesap (${fmt(open.reduce((n,r)=>n+(Number(r.totalMinor)||0),0),100)} ₼) kapanınca eklenir.`,`${open.length} open bills (${fmt(open.reduce((n,r)=>n+(Number(r.totalMinor)||0),0),100)} ₼) are added when closed.`):'';
   return result(`${t('Satış hesabatı','Satış raporu','Sales report')} · ${name?name+', ':''}${plan.period==='today'?`${day(from)}, 00:00 – ${clock(to)}`:`${day(from)} – ${day(to)}`} (${t('Bakı vaxtı','Bakü saati','Baku time')})
${t('Ümumi satış','Brüt satış','Gross sales')}: ${fmt(report.sales.grossMinor,100)} ₼
${t('Qaytarma','İade','Refunds')}: ${fmt(report.sales.refundMinor,100)} ₼
${t('Xalis satış','Net satış','Net sales')}: ${fmt(report.sales.netMinor,100)} ₼
${t('Canlı yerli hesabat; xalis satış mənfəət deyil.','Canlı yerel rapor; net satış kâr değildir.','Live local report; net sales is not profit.')}${openNote}`,open.length&&plan.period==='today'?[choice(t('Açıq masalar','Açık masalar','Open tables'),'açıq masalar nə qədər işləyib')]:[]);}
  // Z closes the day for good: readiness first, then the person types "günü bağla", then a last "Təsdiq et".
  if(pending?.kind==='zphrase'&&/^gunu bagla$/.test(text)){pending=null;approval={kind:'tool',name:'reportZ',args:[makeKey()]};return result(t('Son təsdiq: Z hesabatı çıxarılacaq, çap olunacaq və kassa günü bağlanacaq. Bundan sonra satış üçün yeni gün açılmalıdır. Təsdiq edirsiniz?','Son onay: Z raporu alınacak ve gün kapanacak. Onaylıyor musunuz?','Last check: the Z report is taken and the day closes. Confirm?'),[choice(confirm,'confirm'),choice(cancel,'cancel')]);}
  if(plan.intent==='z_report'){clear();const ready=await tools.zReadiness();if(!valid())throw Error('stale conversation');
   if(!ready?.ready){const why=[ready.openOrders?t(`${ready.openOrders} açıq hesab (masa və ya çatdırılma)`,`${ready.openOrders} açık hesap`,`${ready.openOrders} open bills`):'',ready.unresolvedPayments?t(`${ready.unresolvedPayments} yarımçıq ödəniş`,`${ready.unresolvedPayments} bekleyen ödeme`,`${ready.unresolvedPayments} unresolved payments`):'',ready.pendingKitchen?t(`${ready.pendingKitchen} mətbəxdə gözləyən sifariş`,`${ready.pendingKitchen} mutfakta`,`${ready.pendingKitchen} in the kitchen`):''].filter(Boolean);
    return result(t(`Günü hələ bağlamaq olmur: ${why.join(', ')||'kassa hazır deyil'}. Əvvəl açıq hesabları ödənişlə bağlayın və ya ləğv edin, sonra yenidən “Z hesabatı” yazın. Heç nə dəyişməyib.`,'Gün henüz kapatılamaz.','The day cannot close yet.'),[choice(t('Açıq masalar','Açık masalar','Open tables'),'açıq masalar nə qədər işləyib')]);}
   pending={kind:'zphrase'};return result(t('Z hesabatı günü BAĞLAYIR və bu geri qaytarılmır: günün satışı yekunlaşır, hesabat çap olunur, sonrakı satış üçün kassa günü yenidən açılmalıdır. Davam etmək üçün “günü bağla” yazın.','Z raporu günü kapatır ve geri alınamaz. Devam için “günü bağla” yazın.','The Z report closes the day and cannot be undone. Type “günü bağla” to go on.'),[choice(cancel,'cancel')]);}
  // PDF reports: the queries are written here, not by the AI, so the figures are the till's own; the till's save dialog asks where to put the file.
  if(plan.intent==='pdf_report'||picked?.value==='pdf:last'){clear();
   // Only day boundaries go into the query ("until now" needs no upper bound), so a replayed turn asks for exactly the same thing.
   const kind=picked?.value==='pdf:last'?'last':plan.kind,b=periodBounds(Date.now()),day=b.day;
   const span=plan.days>0?{from:b.todayStart-(plan.days-1)*day,to:null,label:t(`son ${plan.days} gün`,`son ${plan.days} gün`,`last ${plan.days} days`)}:({today:{from:b.todayStart,to:null,label:t('bu gün','bugün','today')},yesterday:{from:b.todayStart-day,to:b.todayStart,label:t('dünən','dün','yesterday')},week:{from:b.weekStart,to:null,label:t('bu həftə','bu hafta','this week')},lastweek:{from:b.weekStart-7*day,to:b.weekStart,label:t('keçən həftə','geçen hafta','last week')},month:{from:b.monthStart,to:null,label:t('bu ay','bu ay','this month')},lastmonth:{from:b.lastMonthStart,to:b.monthStart,label:t('keçən ay','geçen ay','last month')}})[plan.period]||null;
   const local="'unixepoch','+4 hours'";let sql,title;
   if(kind==='purchases'){sql=`SELECT po.number AS "Qaimə №", COALESCE(s.name,'—') AS "Tədarükçü", date(po.created_at/1000,${local}) AS "Tarix", po.stage AS "Vəziyyət", ROUND(po.total_minor/100.0,2) AS "Məbləğ (₼)", ROUND(po.due_minor/100.0,2) AS "Borc (₼)" FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id WHERE po.stage<>'cancelled'${span?` AND po.created_at>=${span.from}${span.to?` AND po.created_at<${span.to}`:''}`:''} ORDER BY po.created_at DESC LIMIT 200`;title=t('Alış qaimələri','Alış faturaları','Purchase invoices')+(span?' · '+span.label:'');}
   else if(kind==='payments'){const s=span||{from:b.todayStart,to:null,label:t('bu gün','bugün','today')};sql=`SELECT date(p.created_at/1000,${local}) AS "Tarix", CASE p.method WHEN 'cash' THEN 'Nağd' WHEN 'card' THEN 'Kart' WHEN 'account' THEN 'Hesaba (nisyə)' ELSE p.method END AS "Ödəniş növü", COUNT(*) AS "Say", ROUND(SUM(p.amount_minor)/100.0,2) AS "Məbləğ (₼)" FROM payments p WHERE p.status IN ('approved','refunded') AND p.method<>'mixed' AND COALESCE(p.is_deposit,0)=0 AND p.created_at>=${s.from}${s.to?` AND p.created_at<${s.to}`:''} GROUP BY 1,2 ORDER BY 1,2`;title=t('Ödənişlər','Ödemeler','Payments')+' · '+s.label;}
   else if(kind==='sales'){const s=span||{from:b.monthStart,to:null,label:t('bu ay','bu ay','this month')};sql=`SELECT date(o.closed_at/1000,${local}) AS "Tarix", COUNT(*) AS "Sifariş", ROUND(SUM(o.total_minor)/100.0,2) AS "Satış (₼)", ROUND(SUM(o.discount_minor)/100.0,2) AS "Endirim (₼)" FROM orders o WHERE o.status IN ('paid','closed') AND o.deleted_at IS NULL AND o.closed_at>=${s.from}${s.to?` AND o.closed_at<${s.to}`:''} GROUP BY 1 ORDER BY 1`;title=t('Satış','Satış','Sales')+' · '+s.label;}
   else if(lastData){sql=lastData.sql;title=lastData.title;}
   else return result(t('Hansı məlumatı PDF kimi verim? Məsələn: “qaimələri pdf ver”, “son 4 günün ödənişlərini pdf ver”, “keçən ayın satışını pdf ver” və ya əvvəl bir sual verin, sonra “PDF kimi yüklə” düyməsini basın.','Hangi veriyi PDF olarak vereyim?','Which data should I export as PDF?'),[choice(t('Qaimələr','Faturalar','Invoices'),'qaimələri pdf ver'),choice(t('Son 7 günün ödənişləri','Son 7 gün ödemeler','Last 7 days payments'),'son 7 günün ödənişlərini pdf ver'),choice(t('Keçən ayın satışı','Geçen ay satış','Last month sales'),'keçən ayın satışını pdf ver')]);
   const data=await tools.dataQuery(sql);if(!valid())throw Error('stale conversation');
   if(!data.rows.length)return result(t(`${title}: bu dövrdə məlumat yoxdur, ona görə PDF yaratmadım.`,`${title}: veri yok.`,`${title}: no data.`));
   const total=data.columns.map((c,i)=>i===0?t('Cəmi','Toplam','Total'):/\(₼\)|^Say$|^Sifariş$/.test(c)?Math.round(data.rows.reduce((n,r)=>n+(Number(r[i])||0),0)*100)/100:'');
   const out=await tools.savePdfTable({filename:title,title,subtitle:t(`Hazırlandı: ${b.date} · ${data.rows.length} sətir`,`Hazırlandı: ${b.date}`,`Prepared ${b.date}`),columns:data.columns,rows:data.rows,total:total.some((v,i)=>i&&v!=='')?total:null});if(!valid())throw Error('stale conversation');
   const sums=data.columns.map((c,i)=>/\(₼\)/.test(c)?`${c.replace(/\s*\(₼\)/,'')}: ${fmt(Math.round(Number(total[i])*100),100)} ₼`:'').filter(Boolean).join(' · ');
   return result(out.canceled?t('PDF saxlanmadı: saxlama pəncərəsi bağlandı. Yenidən istəsəniz, təkrar yazın.','PDF kaydedilmedi.','The PDF was not saved.'):t(`PDF hazırdır: ${out.path}\n${title} · ${data.rows.length} sətir${sums?'\n'+sums:''}\nFaylı həmin qovluqdan açıb çap edə və ya göndərə bilərsiniz.`,`PDF hazır: ${out.path}`,`PDF saved: ${out.path}`));
  }
  // An "open" button pressed on a till that cannot navigate yet arrives here as text: name the place instead.
  if(picked?.value.startsWith('nav:')){const where=SCREENS.find(x=>'nav:'+x.route===raw);return result(where?t(`Bu bölmə: ${where.where}.`,where.where,where.where):t('Bu bölməni proqramın İdarə menyusundan açın.','İdarə menüsünden açın.','Open it from the İdarə menu.'));}
  if(plan.intent==='identity'){clear();return result(t('Mən Possistem Restoran POS-un köməkçisiyəm. Məni Possistem komandası yaradıb. Yazdıqlarınızı süni intellekt oxuyur, işi isə kassa proqramının özü görür: məlumatı canlı oxuyuram, dəyişikliyi yalnız sizin təsdiqinizlə edirəm. Satış, masalar, anbar, kalkulyasiya, hesabatlar (X, Z, PDF), printer və abunəlik üzrə kömək edirəm.','Ben Possistem Restoran POS asistanıyım.','I am the Possistem Restaurant POS assistant.'),[choice(t('Nələr edə bilirsən?','Neler yapabilirsin?','What can you do?'),'nələr edə bilirsən'),...scopeChoices().slice(0,3)]);}
  if(plan.intent==='profile'){clear();return result(profile?.name?t(`Restoranınız: ${profile.name}. Bu ad sayt hesabınızdan gəlir. Çekdə görünən adı və loqonu İdarə → Parametrlər → Çek bölməsində dəyişə bilərsiniz.`,`Restoranınız: ${profile.name}.`,`Your restaurant: ${profile.name}.`):t('Restoranın adını hesab məlumatından ala bilmədim. Çekdə görünən adı İdarə → Parametrlər → Çek bölməsində görə bilərsiniz.','Restoran adını alamadım.','I could not read the restaurant name.'),screensFor('cek loqo'));}
  if(plan.intent==='data_question'){clear();if(!askSql)return result(t('Bu sual üçün süni intellekt lazımdır, hazırda əlçatan deyil. Bir az sonra yenidən soruşun.','Bu soru için yapay zekâ gerekli.','This needs the AI, which is unavailable.'));return answerData(plan.question,valid);}
  if(plan.intent==='open_screen'){clear();const doors=screensFor(raw);
   return result(doors.length?t(`${doors.map(d=>d.where).join('\n')}\nAçmaq üçün düyməni basın.`,doors.map(d=>d.where).join('\n'),doors.map(d=>d.where).join('\n')):t('Hansı bölməni açım? Məsələn: anbar, işçilər, printer, çek loqosu, hesabatlar, xərclər, geri qaytarma.','Hangi bölümü açayım?','Which screen should I open?'),doors.length?doors:screensFor('anbar isci printer hesabat').slice(0,4));}
  if(plan.intent==='x_report'){clear();approval={kind:'tool',name:'reportX',args:[makeKey()]};return result(t('X hesabatı çıxarılacaq: bu günün satışı, ödəniş növləri və kassada gözlənilən nağd pul. Hesabat qeydə alınır və çek printerinə göndərilir. Gün bağlanmır, satış davam edir.\nTəsdiq edirsiniz?','X raporu alınacak ve yazdırılacak; gün kapanmaz. Onaylıyor musunuz?','An X report will be recorded and printed; the day stays open. Confirm?'),[choice(confirm,'confirm'),choice(cancel,'cancel')]);}
  if(plan.intent==='top_products'){clear();const rows=await tools.topProducts(10);if(!valid())throw Error('stale conversation');
   return result(rows.length?t('Ən çox satılanlar (bütün dövr, ləğv olunmamış sifarişlər):','En çok satılanlar:','Best sellers:')+'\n'+rows.map((r,i)=>`${i+1}. ${r.name||'—'} — ${fmt(Math.round(Number(r.quantity)*1000),1000)} ədəd · ${fmt(r.revenueMinor,100)} ₼`).join('\n'):t('Hələ satış yoxdur.','Henüz satış yok.','No sales yet.'),[choice(t('Bugünkü satış','Bugünkü satış','Today’s sales'),'Bugünkü satış')]);}
  if(plan.intent==='purchases'){clear();const rows=(await tools.purchases()).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));if(!valid())throw Error('stale conversation');
   const status={draft:'qaralama',ordered:'sifariş edilib',partial:'qismən qəbul',received:'qəbul edilib',closed:'bağlanıb',cancelled:'ləğv edilib',returned:'qaytarılıb'},day=x=>x?new Date(x).toLocaleDateString('az-AZ',{timeZone:'Asia/Baku',day:'numeric',month:'short'}):'';
   const due=rows.reduce((n,r)=>n+(Number(r.dueMinor)||0),0),pdf=/pdf|excel|cap|yukle|fayl/.test(text);
   return result(rows.length?t(`Alış qaimələri · cəmi ${rows.length}${due?`, tədarükçülərə borc ${fmt(due,100)} ₼`:''}. Sonuncu ${Math.min(10,rows.length)}:`,`Alış faturaları: ${rows.length}.`,`Purchase invoices: ${rows.length}.`)+'\n'+rows.slice(0,10).map(r=>`• №${r.number||'—'} · ${r.supplierName||t('tədarükçü yoxdur','tedarikçi yok','no supplier')} · ${fmt(r.totalMinor,100)} ₼${Number(r.dueMinor)>0?` · borc ${fmt(r.dueMinor,100)} ₼`:''} · ${status[r.status]||r.status||''}${r.createdAt?' · '+day(r.createdAt):''}`).join('\n')+(pdf?'\n\n'+t('PDF faylını köməkçi hazırlamır. Qaiməni İdarə → Maliyyə bölməsində açıb çap edə və ya PDF kimi saxlaya bilərsiniz.','PDF için İdarə → Maliyyə.','For a PDF open İdarə → Maliyyə.'):''):t('Hələ alış qaiməsi yoxdur. Yeni alış Təchizat → Mal qəbulu bölməsindən yazılır.','Henüz alış faturası yok.','No purchase invoices yet.'));}
  if(plan.intent==='courier_report'){clear();const r=await tools.courierReport(plan.period||'today');if(!valid())throw Error('stale conversation');
   const name={today:t('Bu gün','Bugün','Today'),yesterday:t('Dünən','Dün','Yesterday'),week:t('Bu həftə','Bu hafta','This week'),month:t('Bu ay','Bu ay','This month')}[plan.period||'today'];
   const rows=r.couriers.filter(c=>Number(c.deliveries)>0);
   return result(`${t('Kuryer hesabatı','Kurye raporu','Courier report')} · ${name}\n`+(rows.length?rows.map(c=>`• ${c.courierName||'—'}: ${c.deliveries} çatdırılma (${Number(c.completed)||0} tamamlanıb${Number(c.failed)?`, ${c.failed} alınmayıb`:''}) · sifarişlər ${fmt(c.collectedMinor,100)} ₼ · çatdırılma haqqı ${fmt(c.feeMinor,100)} ₼`).join('\n')+'\n'+t('Kuryerin yığdığı nağd pul təhvil verilənə qədər onun borcu sayılır; kuryerlər Partnyorlar bölməsindədir.','Kuryenin topladığı nakit teslim edilene kadar borçtur.','Cash a courier collected is owed until handed over.'):t('Bu dövrdə kuryerə verilmiş çatdırılma yoxdur.','Bu dönemde kurye teslimatı yok.','No courier deliveries in this period.')),[choice(t('Bu ayın kuryer hesabatı','Bu ayın kurye raporu','This month'),'bu ayın kuryer hesabatı')]);}
  if(plan.intent==='stock_value'){clear();const v=await tools.stockValue('');if(!valid())throw Error('stale conversation');
   return result(t(`Anbarın maya dəyəri: ${fmt(v.totalMinor,100)} ₼ (${v.lines} mal${v.method?`, ${({fifo:'FIFO',average:'orta maya',avg:'orta maya',last:'son alış'})[v.method]||v.method} üsulu`:''}).\nMənfi qalıqlar bu məbləği azaldır; dəqiq rəqəm üçün mənfi malları düzəldin.`,`Depo değeri: ${fmt(v.totalMinor,100)} ₼.`,`Stock value: ${fmt(v.totalMinor,100)} ₼.`),[choice(t('Mənfi olanlar','Negatifler','Negative stock'),'anbarda mənfi olanları göstər')]);}
  if(plan.intent==='cash'){clear();const accounts=await tools.cash();if(!valid())throw Error('stale conversation');return result(t('Kassa balansları (canlı yerli məlumat):','Kasa bakiyeleri (canlı yerel veri):','Cash account balances (live local data):')+'\n'+(accounts.length?accounts.map(a=>`• ${a.name}: ${fmt(a.balanceMinor,100)} ₼`).join('\n'):t('Kassa yaradılmayıb.','Kasa oluşturulmamış.','No cash accounts configured.')));}
  if(plan.intent==='subscription'||picked?.value==='subscription:pay'){
   setup.cancel();clear();selected=null;lastOverview=null;
   if(picked?.value==='subscription:pay'){await tools.openPayment(valid);if(!valid())throw Error('stale conversation');return result(t('Ödəniş səhifəsi brauzerdə açıldı. Kartı yalnız bank səhifəsində daxil edin. Ödənişin nəticəsini buradan yenidən soruşa bilərsiniz.','Ödeme sayfası tarayıcıda açıldı. Kartı yalnızca banka sayfasına girin.','The payment page opened in your browser. Enter card details only on the bank page.'));}
   const data=await tools.subscription();if(!valid())throw Error('stale conversation');const sub=data.subscription;
   if(!sub)return result(t('Bu hesab üçün Restoran POS abunəliyi tapılmadı. Administratorun bu hesaba Restoran POS təyin etməsini yoxlayın.','Bu hesap için Restoran POS aboneliği bulunamadı.','No Restaurant POS subscription was found for this account.'));
   const end=Date.parse(sub.accessStatus==='trial'?sub.accessUntil:sub.paidUntil||sub.accessUntil||''),paid=sub.hasPaidSubscription===true&&sub.state==='active'&&Number.isFinite(end)&&end>Date.now(),free=['exempt','free'].includes(sub.accessStatus),trial=sub.accessStatus==='trial';
   const state=trial?t('Pulsuz test istifadəsi','Ücretsiz deneme','Free trial'):free?t('Administratorun pulsuz icazəsi','Yöneticinin ücretsiz izni','Administrator free access'):paid?t('Ödənilib','Ödendi','Paid'):t('Ödəniş tələb olunur','Ödeme gerekiyor','Payment required');
   let body=`Restoran POS · ${state}`;
   if(Number.isSafeInteger(sub.monthlyAmountMinor))body+=`\n${t('Aylıq məbləğ','Aylık tutar','Monthly amount')}: ${fmt(sub.monthlyAmountMinor,100)} ₼`;
   if(Number.isFinite(end)){const remaining=Math.max(0,end-Date.now()),hours=Math.ceil(remaining/3600000);body+=`\n${t('Son tarix','Son tarih','End date')}: ${new Date(end).toLocaleString(language==='en'?'en-GB':language==='tr'?'tr-TR':'az-AZ',{timeZone:'Asia/Baku'})} (Bakı)\n${remaining>0?t(`${Math.floor(hours/24)} gün ${hours%24} saat qalıb`,`${Math.floor(hours/24)} gün ${hours%24} saat kaldı`,`${Math.floor(hours/24)} days ${hours%24} hours remaining`):t('Müddət bitib.','Süre doldu.','The period has expired.')}`;}
   if(paid)body+='\n'+t('Cari müddət üçün təkrar ödəniş lazım deyil.','Mevcut dönem için tekrar ödeme gerekmiyor.','No repeat payment is needed for the current period.');
   else if(!free&&!data.paymentsAvailable)body+='\n'+t('Onlayn ödəniş hazırda açıq deyil; kartdan pul tutulmayıb.','Çevrimiçi ödeme şu an açık değil; karttan tahsilat yapılmadı.','Online payment is currently unavailable; no card was charged.');
   if(plan.pay&&!paid&&!free&&data.paymentsAvailable)body+='\nDavam etmək üçün aşağıdakı ödəniş düyməsini seçin. Təkcə bu mesaj kartdan pul tutmur.';
   if(!paid&&!free&&!plan.pay&&data.paymentsAvailable)body+='\n'+t('Müddət bitəndə yeni satış və əməliyyatlar üçün ödəniş tələb olunacaq. Ödəmək üçün aşağıdakı düyməni seçin və ya “abunəliyimi ödəmək istəyirəm” yazın; kart məlumatı yalnız bankın ödəniş səhifəsində daxil edilir.','Süre bitince yeni işlemler için ödeme gerekir. Ödemek için aşağıdaki düğmeyi seçin.','When the period ends, new operations require payment. Use the button below to pay.');
   if(data.paymentUrl)return result(body,[],{links:[{href:data.paymentUrl,label:t('Abunəlik və ödənişlər','Abonelik ve ödemeler','Subscription and payments')}]});
   return result(body,!paid&&!free&&data.paymentsAvailable?[choice(t('Ödəniş səhifəsini aç','Ödeme sayfasını aç','Open payment page'),'subscription:pay')]:[]);
  }
  if(plan.intent==='tables'||picked?.value.startsWith('table:')||picked?.value.startsWith('tables-page:')){
   setup.cancel();clear();selected=null;lastOverview=null;
   if(picked?.value.startsWith('table:')){const data=await tools.tableOrder(raw.slice(6));if(!valid())throw Error('stale conversation');return result(`${data.table.areaName||''} · ${data.table.label}\n`+(data.items.length?data.items.slice(0,40).map(i=>`• ${i.name||i.nameSnapshot||'—'} × ${i.quantity} · ${fmt(i.lineTotalMinor??i.totalMinor,100)} ₼`).join('\n'):t('Məhsul əlavə edilməyib.','Ürün eklenmemiş.','No items have been added.')));}
   const tables=await tools.tables();if(!valid())throw Error('stale conversation');const floor=tables.filter(table=>table.areaId!=='area-delivery');
   if(plan.money||plan.table){
    const named=plan.table?tables.filter(r=>['', 'masa ','stol '].some(p=>normalize(r.label)===p+plan.table)):null,rows=named||tables.filter(r=>r.orderId);
    const sum=key=>rows.filter(r=>r.orderId).reduce((n,r)=>n+(Number(r[key])||0),0),money=n=>fmt(n,100)+' ₼';
    const line=r=>`• ${r.areaName?r.areaName+' · ':''}${r.label}: ${r.orderId?t(`hesab ${money(r.totalMinor||0)} · ödənilib ${money(r.paidMinor||0)} · qalıq ${money((r.totalMinor||0)-(r.paidMinor||0))}`,`hesap ${money(r.totalMinor||0)} · ödenen ${money(r.paidMinor||0)}`,`bill ${money(r.totalMinor||0)} · paid ${money(r.paidMinor||0)}`):t('boşdur, açıq hesab yoxdur','boş, açık hesap yok','free, no open bill')}`;
    const closed=t('Bağlanmış hesabları köməkçi masa-masa göstərmir, onlar günün ümumi satışına düşür. Bugünkü cəmi üçün “bugünkü satış” yazın.','Kapanan hesaplar günün satışına düşer; “bugünkü satış” yazın.','Closed bills go into the day’s sales; ask for “today’s sales”.');
    const items=rows.filter(r=>r.orderId).slice(0,8).map(r=>choice(`${r.areaName?r.areaName+' · ':''}${r.label} — ${t('Məhsulları göstər','Ürünleri göster','Show items')}`,'table:'+r.id)).concat(choice(t('Bugünkü satış','Bugünkü satış','Today’s sales'),'Bugünkü satış'));
    if(named&&!named.length)return result(t(`“${plan.table}” adlı masa tapmadım. Masalar: ${floor.slice(0,15).map(r=>r.label).join(', ')||'—'}.`,`“${plan.table}” masası yok.`,`No table “${plan.table}”.`),[choice(t('Bütün masaları göstər','Tüm masaları göster','Show all tables'),'Bütün masaları göstər')]);
    // "1 masada nə var, nə yeyiblər": the open bill's items.
    if(named?.length===1&&named[0].orderId&&/\b(?:ne var|yeyib\w*|ne alib\w*|sifaris\w*|mehsul\w*|ne yeyir\w*|icinde)\b/.test(text)){const order=await tools.tableOrder(named[0].id);if(!valid())throw Error('stale conversation');return result(`${named[0].areaName?named[0].areaName+' · ':''}${named[0].label} · ${t('açıq hesab','açık hesap','open bill')} ${fmt(named[0].totalMinor||0,100)} ₼\n`+(order.items.length?order.items.slice(0,40).map(i=>`• ${i.name||i.nameSnapshot||'—'} × ${i.quantity} · ${fmt(i.lineTotalMinor??i.totalMinor,100)} ₼`).join('\n'):t('Hesaba hələ məhsul əlavə olunmayıb.','Henüz ürün yok.','No items yet.')),[choice(t('Bugünkü satış','Bugünkü satış','Today’s sales'),'Bugünkü satış')]);}
    if(named)return result(`${t('Masa','Masa','Table')} ${plan.table} · ${t('canlı məlumat','canlı veri','live data')}\n${named.map(line).join('\n')}\n\n${named.some(r=>r.orderId)?t('Bu, hazırda açıq olan hesabdır: hesab bağlananda məbləğ günün satışına keçir.','Bu açık hesaptır; kapanınca satışa geçer.','This is the open bill; it moves to sales when closed.'):t('Masa hazırda boşdur.','Masa şu an boş.','The table is free now.')} ${closed}`,items);
    return result(rows.length?`${t('Açıq masalar','Açık masalar','Open tables')} · ${t('canlı məlumat','canlı veri','live data')}\n${t(`${rows.length} açıq hesab, cəmi ${money(sum('totalMinor'))} (ödənilib ${money(sum('paidMinor'))}, qalıq ${money(sum('totalMinor')-sum('paidMinor'))}).`,`${rows.length} açık hesap, toplam ${money(sum('totalMinor'))}.`,`${rows.length} open bills, total ${money(sum('totalMinor'))}.`)}\n\n${rows.slice(0,16).map(line).join('\n')}${rows.length>16?`\n… +${rows.length-16}`:''}\n\n${t('Bu məbləğlər hələ bağlanmayıb, ona görə satış hesabatına düşməyib.','Bu tutarlar henüz kapanmadı, satış raporunda yok.','These bills are not closed yet, so they are not in the sales report.')} ${closed}`:t('Hazırda açıq masa hesabı yoxdur. ','Açık masa hesabı yok. ','There are no open bills. ')+closed,items);
   }
   if(plan.count)return result(t(`Cəmi ${floor.length} masa: ${floor.filter(t=>!t.orderId).length} boş, ${floor.filter(t=>t.orderId).length} açıq hesablı. Çatdırılma hesabları: ${tables.length-floor.length}.`,`${floor.length} masa: ${floor.filter(t=>!t.orderId).length} boş. Teslimat hesapları: ${tables.length-floor.length}.`,`${floor.length} tables: ${floor.filter(t=>!t.orderId).length} free; ${floor.filter(t=>t.orderId).length} with open accounts. Delivery accounts: ${tables.length-floor.length}.`),[choice(t('Bütün masaları göstər','Tüm masaları göster','Show all tables'),'Bütün masaları göstər')]);const active=plan.all?tables:tables.filter(table=>table.orderId),offset=picked?.value.startsWith('tables-page:')?Number(raw.slice(12)):0,shown=active.slice(offset,offset+16);
   return result(t('Masalar · canlı yerli məlumat','Masalar · canlı yerel veri','Tables · live local data')+'\n'+(active.length?shown.map(table=>`• ${table.areaName||''} · ${table.label}: ${fmt(table.totalMinor,100)} ₼ · ${t('Ödənilib','Ödendi','Paid')}: ${fmt(table.paidMinor,100)} ₼`).join('\n'):t('Açıq masa hesabı yoxdur.','Açık masa hesabı yok.','There are no open table accounts.')),[...shown.map(table=>choice(`${table.areaName||''} · ${table.label} — ${t('Məhsulları göstər','Ürünleri göster','Show items')}`,'table:'+table.id)),...(offset>0?[choice(t('Əvvəlki masalar','Önceki masalar','Previous tables'),'tables-page:'+Math.max(0,offset-16))]:[]),...(offset+16<active.length?[choice(t('Növbəti masalar','Sonraki masalar','Next tables'),'tables-page:'+(offset+16))]:[])]);
  }
  if(plan.intent==='capabilities'&&tools.tablePermissions?.().enabled){clear();return result(t(`Restoranınızda bunları edə bilərəm. Dəyişiklikdən əvvəl plan göstərirəm və təsdiqinizi gözləyirəm.
• Satış: bugünkü, dünənki, həftəlik, aylıq satış; kassada nə qədər pul var.
• Masalar: açıq masaların hesabı, “masa 1 nə qədər işləyib”; masa silmək, “panda zalına 5 masa əlavə et”, zal yaratmaq, masanın adını və yer sayını dəyişmək.
• Anbar: qalıq, mənfi və bitən mallar; qalığı artırmaq, azaltmaq, düzəltmək; malın adı və satış qiyməti; anbara yeni mal.
• Menyu: kalkulyasiyaya baxmaq və yaratmaq, yeni menyu yeməyi.
• Hesabatlar: X hesabatı (çap olunur, gün bağlanmır), Z hesabatı (günü bağlayır, iki dəfə təsdiq soruşur), ən çox satılanlar, alış qaimələri, kuryer hesabatı, anbarın dəyəri.
• Anbar işləri: silinmə (“doner 2 ədəd xarab olub”), mal qəbulu (“un 25 kq aldım 3 manatdan”, maya qiyməti də yenilənir).
• Printerə sınaq çeki, abunəlik və ödəniş səhifəsi.
• Hesabatı PDF kimi: “qaimələri PDF ver”, “son 4 günün ödənişlərini PDF et”, “keçən ay nə qədər qazanmışam, PDF-ə qoy”.
• Proqramda harada nə var: “printer bölməsini aç”, “çekə loqo necə qoyum” — düymə birbaşa o bölməni açır.
Bir mesajda bir neçə istək yaza bilərsiniz, məsələn: “bugünkü satışı de, bir də doner neçə qalıb”.
İstənilən məlumat sualı da verə bilərsiniz, məsələn “keçən həftə hansı ofisiant ən çox satıb”.
Hələ edə bilmədiklərim: işçi yaratmaq, endirim kampaniyası, geri qaytarma, çek loqosunu dəyişmək. Belə istəklər komandaya ötürülür ki, sonra əlavə edilsin.`,'Satış, masalar, depo, reçete, yazıcı testi ve abonelikte yardım edebilirim; değişiklikten önce plan gösterir, onayınızı beklerim.','I can help with sales, tables, stock, recipes, a printer test and the subscription; every change is shown as a plan first.'),[choice(t('Bugünkü satış','Bugünkü satış','Today’s sales'),'Bugünkü satış'),choice(t('Açıq masalar','Açık masalar','Open tables'),'açıq masalar nə qədər işləyib'),choice(t('Anbara bax','Depoya bak','Check inventory'),'Anbarımda nə var?'),choice(t('Kalkulyasiyalar','Reçeteler','Recipes'),'kalkulyasiyaları göstər')]);}
  if(plan.intent==='capabilities'){clear();return result(t('Sualınızı izah edə, problemə addım-addım baxa və iş planı qura bilərəm. Anbarla bağlı istəsəniz qalığı yoxlayar, məhsul dəyişikliklərini təsdiqinizlə edərəm. Nədən başlayaq?','Sorunuzu açıklayabilir, sorunu adım adım inceleyebilir ve plan yapabilirim. İsterseniz stok kontrolü ve onayınızla ürün düzenleme de yapabilirim. Nereden başlayalım?','I can explain questions, work through problems and make a plan. If needed, I can check stock and edit items with your approval. Where should we start?'));}
  if(/^(bu gun )?(isler |her sey )?(cox )?(yaxsi(dir)?|ela(dir)?)( gedir)?$/.test(text))return result(t('Yaxşı xəbərdir! İşlərinizdə kömək lazım olsa, buradayam.','Güzel haber! Yardım gerekirse buradayım.','Good to hear! I’m here if you need a hand.'));
  if(plan.intent==='help'){clear();if(/anbar|stok|qaliq/.test(text)&&/problem|islemir|xeta/.test(text))return result(t('Anbarda hansı problem var: qalıq səhvdir, məhsul görünmür, yoxsa giriş/çıxış alınmır? Məhsulun adını və gözlədiyiniz qalığı yazın.','Depoda sorun nedir: stok yanlış mı, ürün görünmüyor mu, giriş/çıkış yapılamıyor mu?','What is wrong in inventory: incorrect stock, a missing product or a failed movement? Tell me the item and expected quantity.'));return fallback(raw,history);}
  if((plan.intent==='confirm'||picked?.value==='confirm')&&approval?.kind==='tool'){
   const op=approval;const out=await tools[op.name](...op.args,valid);if(!valid())throw Error('stale conversation');clear();
   if(op.name==='reportZ'){const s=out.sales||{};return result(`${t('Z hesabatı','Z raporu','Z report')} №${out.sequenceNo??'—'} · ${out.businessDate||''}\n${t('Ümumi satış','Brüt','Gross')}: ${fmt(s.grossMinor,100)} ₼ · ${t('Qaytarma','İade','Refunds')}: ${fmt(s.refundMinor,100)} ₼ · ${t('Xalis','Net','Net')}: ${fmt(s.netMinor,100)} ₼${(s.byMethod||[]).length?'\n'+s.byMethod.map(m=>`• ${({cash:'Nağd',card:'Kart',account:'Hesaba (nisyə)',mixed:'Qarışıq'})[m.method]||m.method}: ${fmt(m.totalMinor,100)} ₼ (${m.count})`).join('\n'):''}${out.cash?`\n${t('Kassada gözlənilən nağd','Beklenen nakit','Expected cash')}: ${fmt(out.cash.expectedCashMinor,100)} ₼`:''}\n${t('Kassa günü bağlandı və hesabat çap olundu. Sonrakı satış üçün kassanı yenidən açın.','Gün kapandı.','The day is closed.')}`);}
   const methods={cash:'Nağd',card:'Kart',account:'Hesaba (nisyə)',mixed:'Qarışıq'},s=out.sales||{};
   return result(`${t('X hesabatı','X raporu','X report')} №${out.sequenceNo??'—'} · ${out.businessDate||''}
${t('Ümumi satış','Brüt satış','Gross')}: ${fmt(s.grossMinor,100)} ₼
${t('Qaytarma','İade','Refunds')}: ${fmt(s.refundMinor,100)} ₼
${t('Xalis satış','Net satış','Net')}: ${fmt(s.netMinor,100)} ₼${(s.byMethod||[]).length?'\n'+s.byMethod.map(m=>`• ${methods[m.method]||m.method}: ${fmt(m.totalMinor,100)} ₼ (${m.count})`).join('\n'):''}${out.orders?`\n${t('Sifariş','Sipariş','Orders')}: ${out.orders.count}${Number(out.orders.discountMinor)?` · ${t('endirim','indirim','discount')} ${fmt(out.orders.discountMinor,100)} ₼`:''}`:''}${out.cash?`\n${t('Kassada gözlənilən nağd','Kasada beklenen nakit','Expected cash')}: ${fmt(out.cash.expectedCashMinor,100)} ₼`:''}${out.openTableCount?`\n${t(`Açıq masalar: ${out.openTableCount} (${fmt(out.openTablesTotalMinor,100)} ₼), hələ satışa düşməyib.`,`Açık masalar: ${out.openTableCount}.`,`Open tables: ${out.openTableCount}.`)}`:''}
${t('Hesabat qeydə alındı və çek printerinə göndərildi. Gün bağlanmadı.','Rapor kaydedildi ve yazdırıldı.','Recorded and sent to the printer.')}${out.businessDate&&out.businessDate<new Date(Date.now()+4*3600000).toISOString().slice(0,10)?'\n'+t(`Diqqət: kassa günü ${new Date(out.businessDate+'T12:00:00Z').toLocaleDateString('az-AZ',{day:'numeric',month:'long'})} tarixindən bəri bağlanmayıb, ona görə bu hesabat həmin gündən bu ana qədər olan satışı göstərir. Günü Z hesabatı ilə bağlayın (İdarə paneli).`,`Kasa günü ${out.businessDate} tarihinden beri kapanmadı.`,`The business day has been open since ${out.businessDate}.`):''}`);
  }
  if(plan.intent==='confirm'||picked?.value==='confirm'){
   if(!approval)return result(t('Hazırda təsdiq gözləyən dəyişiklik yoxdur.','Onay bekleyen değişiklik yok.','There is no change waiting for confirmation.'));
   const operation=approval;if(!valid())throw Error('stale conversation');
   await tools.save(operation.snapshot,operation.field,operation.value,operation.reason,operation.key);
   if(!valid())throw Error('stale conversation');clear();
   try{await fresh(operation.snapshot.product,operation.snapshot.warehouse.id,valid);}catch(error){if(error?.pendingTool)throw error;selected=null;}
   return result(t('Dəyişiklik saxlanıldı. Başqa nə edək?','Değişiklik kaydedildi. Başka ne yapalım?','The change was saved. What else can I help with?'));
  }
  if(picked?.value.startsWith('product:')&&pending?.kind==='product'){
   const product=pending.products.find(p=>'product:'+p.id===raw);return chooseProduct(product,pending.request,valid);
  }
  if(picked?.value.startsWith('warehouse:')&&pending?.kind==='warehouse'){
   const store=pending.stores.find(w=>'warehouse:'+w.id===raw);return ready(pending.product,store.id,pending.request,valid);
  }
  if(picked?.value.startsWith('field:')&&selected)return askValue(raw.slice(6));
  if(plan.intent==='plan'){
   clear();
   return result(plan.stock?t('Anbar planı: əvvəl azalan məhsulları yoxlayaq, sonra lazım olan miqdarı dəqiqləşdirək və Təchizat bölməsində alış yaradaq. Hansı məhsuldan başlayaq?','Depo planı: azalan ürünleri kontrol edelim, gereken miktarı belirleyelim, sonra Tedarik bölümünde alış oluşturalım. Hangi ürünle başlayalım?','Inventory plan: check low items, decide quantities, then create a purchase in Supply. Which item should we start with?'):t('Nə üçün plan quraq? Məqsədi yazın, addımlara bölək.','Ne için plan yapalım? Hedefi yazın, adımlara bölelim.','What should we plan? Tell me the goal and we can break it into steps.'));
  }
  if(pending?.kind==='reason'&&plan.intent==='unknown'){
   // A question typed at the reason step ("stkumda nə var") is not a reason.
   const question=suggestCorrection(raw);if(question&&interpret(question).intent!=='unknown'||/\?$/.test(raw))return result(t(`Qalıq düzəlişinin səbəbini gözləyirəm (${selected?.product.name||'mal'}). “${question||raw}” yeni sualdırsa, əvvəl bu düzəlişi ləğv edin, sonra soruşun; ya da səbəbi yazın, məsələn “Faktiki sayım”.`,`Düzeltme nedenini bekliyorum. Yeni soru ise önce iptal edin.`,`I am waiting for the correction reason. For a new question, cancel this first.`),[choice(cancel,'cancel')]);
   if(raw.length>200)return result(t('Səbəbi 200 simvoldan qısa yazın.','Nedeni 200 karakterden kısa yazın.','Keep the reason under 200 characters.'));
   return preview(pending.field,pending.value,raw);
  }
  if(pending?.kind==='value'&&plan.intent==='unknown'){
   if(pending.field==='name'||/^[+\-]?\d/.test(raw))return takeValue(pending.field,raw);
   clear();return fallback(raw,history);
  }
  if(pending?.kind==='product'&&plan.intent==='unknown'){
   if(text.split(' ').length>4||/\b(sen|siz|men|kim|kimdir|kimsen|nedir|niye|nece|neyin|neynirsen)\b/.test(text)){clear();return fallback(raw,history);}
   const request={...pending.request,query:raw};return lookup(request,valid);
  }
  if(pending?.kind==='warehouse'&&plan.intent==='unknown'){
   const stores=pending.stores.filter(w=>normalize(w.name)===text);
   if(stores.length===1)return ready(pending.product,stores[0].id,pending.request,valid);
  }
  if(plan.intent==='edit'||plan.intent==='lookup'){
   if(plan.intent==='edit')setup.cancel();
   approval=null;pending=null;
   const request={...plan,raw};
   if(plan.query)return lookup(request,valid);
   if(selected){await fresh(selected.product,selected.warehouse.id,valid);return plan.intent==='lookup'?result(describe(selected)):plan.field?(inlineValue(raw,selected.product,plan.field)?takeValue(plan.field,inlineValue(raw,selected.product,plan.field)):askValue(plan.field)):askField();}
   if(lastOverview?.products.length===1)return chooseProduct(lastOverview.products[0],request,valid);
   pending={kind:'product',request,products:lastOverview?.products||[]};return result(t('Hansı məhsulu nəzərdə tutursunuz? Adını çatda yazın.','Hangi ürünü kastediyorsunuz? Adını sohbete yazın.','Which item do you mean? Type its name here.'));
  }
  clear();return fallback(raw,history);
 }
 return{async recheck(){if(approval?.kind==='tool'){approval={...approval,args:[makeKey()]};return result(t('Təlim yenilənib. Planı yenidən təsdiqləyin.','Planı yeniden onaylayın.','Please confirm the plan again.'),[choice(confirm,'confirm'),choice(cancel,'cancel')]);}if(approval){const op=approval;await fresh(op.snapshot.product,op.snapshot.warehouse.id,()=>true);const r=preview(op.field,op.value,op.reason);r.body="Təlim yenilənib. Planı yenidən yoxlayın.\n"+r.body;return r;}if(printerOps.active)return printerOps.recheck(()=>true);if(stockOps.active)return stockOps.recheck(()=>true);if(tableOps.active)return tableOps.recheck(()=>true);return setup.recheck(()=>true);},snapshot:()=>({lastOverview,selected,pending,approval,choices,queue,lastData,setup:setup.snapshot(),table:tableOps.snapshot(),printer:printerOps.snapshot(),stock:stockOps.snapshot()}),restore:s=>{if(!s)return;({lastOverview=null,selected=null,pending=null,approval=null,choices=[],queue=[],lastData=null}=s);setup.restore(s.setup);tableOps.restore(s.table);printerOps.restore(s.printer);stockOps.restore(s.stock)},approval:()=>approval?approval.kind==='tool'?{name:approval.name,args:approval.args}:{name:'save',args:[approval.snapshot,approval.field,approval.value,approval.reason,approval.key]}:setup.approval()||tableOps.approval()||printerOps.approval()||stockOps.approval(),async send(input,history=[],valid=()=>true){
  if(locked)return result(t('Bir az gözləyin…','Biraz bekleyin…','Please wait…'));locked=true;
  try{const answer=await respond(input,history,valid);if(queue.length&&idle()&&!/^(?:Mesajınızda|Mesajınızda|Your message)/.test(answer.body)){answer.body+='\n\n'+t(`Sıradakı istəyiniz: «${queue[0]}». Davam edək?`,`Sıradaki isteğiniz: «${queue[0]}». Devam edelim mi?`,`Next request: «${queue[0]}». Continue?`);answer.choices=[...answer.choices,choice(t(`Davam: ${queue[0]}`,`Devam: ${queue[0]}`,`Continue: ${queue[0]}`),'queue:next'),choice(t('Qalanını burax','Kalanını bırak','Drop the rest'),'queue:clear')];choices=answer.choices;}return answer;}catch(error){if(error?.pendingTool)throw error;if(/qorunan redaktəni dəstəkləmir/.test(error?.message||'')){clear();return result(t('İstəyinizi başa düşdüm, amma hazırda işləyən köhnə POS nüvəsi köməkçi ilə təhlükəsiz redaktəni dəstəkləmir. Məlumat dəyişməyib. Yeni nüvə build edilənədək Anbar bölməsindən düzəliş edin.','İsteğinizi anladım, ancak mevcut eski çekirdek güvenli yardımcı düzenlemesini desteklemiyor. Veri değişmedi.','I understood the request, but this older core does not support protected assistant edits. Nothing changed. Use Inventory until the new core is built.'));}return result(error?.message||String(error),approval?[choice(confirm,'confirm'),choice(cancel,'cancel')]:[]);}finally{locked=false;}
 }};
}
