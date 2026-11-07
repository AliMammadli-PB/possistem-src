import {createSetupConversation} from './setup-conversation.mjs';
import {interpret,normalize,rankProducts,parseDecimal,parseQuantity,quantityInStockUnit,compactHelp} from './stock-assistant.mjs';

// Conversation owns the pending operation. The UI only renders messages and choices.
export function createConversation({tools,help,language='az',makeKey=()=>crypto.randomUUID()}){
 const setup=createSetupConversation({tools,language,makeKey});
 const t=(az,tr,en)=>language==='tr'?tr:language==='en'?en:az;
 let lastOverview=null,selected=null,pending=null,approval=null,choices=[],locked=false;
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
  return result(t('Bir neçə uyğun məhsul var. Hansını nəzərdə tutursunuz?','Birkaç ürün eşleşiyor. Hangisini kastediyorsunuz?','Several products match. Which one do you mean?'),matches.map(({product})=>choice(product.name,'product:'+product.id)));
 };
 const showOverview=async(store,low,offset,valid)=>{
  const snapshot=await tools.overview(store);if(!valid())throw Error('stale conversation');
  const products=snapshot.products.filter(p=>!low||p.qtyMilli!==null&&p.qtyMilli<=Number(p.minQtyMilli||0));
  const shown=products.slice(offset,offset+12),lines=shown.map(p=>`• ${p.name}: ${p.qtyMilli===null?t('qalıq alınmadı','stok alınamadı','stock unavailable'):fmt(p.qtyMilli,1000)+' '+p.unit}`);
  if(pending?.kind!=='reason'){pending=null;approval=null;}lastOverview={store,products:snapshot.products};
  return result(`${snapshot.warehouse.name} · ${t('Canlı yerli məlumat','Canlı yerel veri','Live local data')}
${products.length?lines.join('\n'):t('Bu seçimə uyğun məhsul yoxdur.','Bu seçime uygun ürün yok.','No products match this selection.')}
${offset+1>products.length?0:offset+1}–${Math.min(offset+12,products.length)} / ${products.length}
${t('Yoxlanıldı','Kontrol edildi','Checked')}: ${new Date(snapshot.readAt).toLocaleTimeString()}`, [ ...(offset>0?[choice(t('Əvvəlki','Önceki','Previous'),`overview:${store}:${low?1:0}:${Math.max(0,offset-12)}`)]:[]),...(offset+12<products.length?[choice(t('Növbəti məhsullar','Sonraki ürünler','Next products'),`overview:${store}:${low?1:0}:${offset+12}`)]:[]),choice(t(low?'Bütün məhsullar':'Bitən / minimum qalıq',low?'Tüm ürünler':'Tükenen / minimum stok',low?'All products':'Out / minimum stock'),`overview:${store}:${low?0:1}:0`)]);
 };
 const overview=async(low,valid)=>{const data=await tools.catalogue();if(!valid())throw Error('stale conversation');const stores=data.warehouses.filter(w=>w.active!==0&&w.active!==false);const store=stores.find(w=>w.id===data.homeWarehouseId)||(stores.length===1?stores[0]:null);if(store)return showOverview(store.id,low,0,valid);return result(t('Hansı anbara baxaq?','Hangi depoya bakalım?','Which warehouse should I check?'),stores.map(w=>choice(w.name,`overview:${w.id}:${low?1:0}:0`)));};
 const fallback=async(input,history)=>{
  const reply=await help?.(input,history),body=compactHelp(reply);
  if(/Başa düşmək üçün bir az dəqiqləşdirək|32 yoxlama/.test(body))return result(t('Bu cümlədə hansı işi istədiyinizi ayıra bilmədim. Aşağıdan işi seçin və ya məhsulun adını daha dəqiq yazın.','Ne yapmak istediğinizi netleştiremedim. Bir işlem seçin veya ürün adını yazın.','I could not identify the task in that sentence. Choose an action below or give the exact item name.'),[choice(t('Anbara bax','Depoya bak','Check inventory'),'Anbarımda nə var?'),choice(t('Yeni məhsul','Yeni ürün','New product'),'Yeni məhsul yarat'),choice(t('Kalkulyasiya','Reçete','Recipe'),'Kalkulyasiya yarat'),choice(t('Abunəlik','Abonelik','Subscription'),'Abunəliyimə bax'),choice(t('Masalar','Masalar','Tables'),'Masaları göstər')]);
  return result(body,[],reply);
 };
 async function respond(input,history,valid){
  const raw=String(input).trim(),text=normalize(raw),plan=interpret(raw),picked=choices.find(c=>c.value===raw);
  const knowledge=await help?.(raw,history);
  if(plan.intent==='cancel'||picked?.value==='cancel'){setup.cancel();clear();selected=null;return result(t('Ləğv etdim. Başqa nə edək?','İptal ettim. Başka ne yapalım?','Cancelled. What else can I help with?'));}
  if(plan.intent==='social'||plan.intent==='unknown'&&!pending&&!setup.active&&['greeting','thanks','wellbeing','farewell','identity','about','invite','resolved'].includes(knowledge?.id))return result(compactHelp(knowledge),[],knowledge);
  if(['recipe_create','product_create','table_create'].includes(plan.intent)){clear();selected=null;lastOverview=null;const answer=await setup.start(plan,valid);return result(answer.body,answer.choices);}
  if(setup.active&&(plan.intent==='unknown'||plan.intent==='confirm'||raw.startsWith('setup:')||setup.tablePrompt&&plan.intent==='tables'||setup.pricePrompt&&plan.intent==='lookup'&&/qiymet/.test(text))){const answer=await setup.send(raw,valid);if(answer)return result(answer.body,answer.choices);}
  if(picked?.value.startsWith('overview:')){const [,store,low,offset]=raw.split(':');if(pending?.kind!=='reason')clear();return showOverview(store,low==='1',Number(offset),valid);}
  if(plan.intent==='overview'){
   if(pending?.kind!=='reason'){clear();selected=null;}
   const answer=await overview(plan.low,valid);
   if(plan.low)answer.body+='\n'+t('Minimum həddi olmayan mallardan yalnız sıfır və mənfi qalıqlar göstərilir.','Minimumu olmayan ürünlerde yalnız sıfır/negatif stok gösterilir.','Items without a minimum threshold are listed only when stock is zero or negative.');
   if(pending?.kind==='reason'&&selected){answer.body+='\n\n'+t(`${selected.product.name} · ${selected.warehouse.name}: gözləyən qalıq düzəlişiniz saxlanılıb. Səbəbi yazın və ya Ləğv et seçin.`, 'Bekleyen stok taslağı saklandı. Neden yazın veya iptal edin.','Your pending stock correction is kept. Enter a reason or cancel.');answer.choices.push(choice(cancel,'cancel'));}
   if(setup.active){answer.body+='\n\n'+setup.hint();answer.choices.push(choice(t('Yaradılmaya qayıt','Oluşturmaya dön','Resume creation'),'setup:resume'));}
   return result(answer.body,answer.choices);
  }
  if(plan.intent==='sales'){clear();const {report,from,to}=await tools.sales(plan.period);if(!valid())throw Error('stale conversation');return result(`${t('Satış hesabatı','Satış raporu','Sales report')} · ${new Date(from).toLocaleDateString()} – ${new Date(to).toLocaleDateString()} (Bakı)
${t('Ümumi satış','Brüt satış','Gross sales')}: ${fmt(report.sales.grossMinor,100)} ₼
${t('Qaytarma','İade','Refunds')}: ${fmt(report.sales.refundMinor,100)} ₼
${t('Xalis satış','Net satış','Net sales')}: ${fmt(report.sales.netMinor,100)} ₼
${t('Canlı yerli hesabat; xalis satış mənfəət deyil.','Canlı yerel rapor; net satış kâr değildir.','Live local report; net sales is not profit.')}`);}
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
   if(data.paymentUrl)return result(body,[],{links:[{href:data.paymentUrl,label:t('Abunəlik və ödənişlər','Abonelik ve ödemeler','Subscription and payments')}]});
   return result(body,!paid&&!free&&data.paymentsAvailable?[choice(t('Ödəniş səhifəsini aç','Ödeme sayfasını aç','Open payment page'),'subscription:pay')]:[]);
  }
  if(plan.intent==='tables'||picked?.value.startsWith('table:')||picked?.value.startsWith('tables-page:')){
   setup.cancel();clear();selected=null;lastOverview=null;
   if(picked?.value.startsWith('table:')){const data=await tools.tableOrder(raw.slice(6));if(!valid())throw Error('stale conversation');return result(`${data.table.areaName||''} · ${data.table.label}\n`+(data.items.length?data.items.slice(0,40).map(i=>`• ${i.name||i.nameSnapshot||'—'} × ${i.quantity} · ${fmt(i.lineTotalMinor??i.totalMinor,100)} ₼`).join('\n'):t('Məhsul əlavə edilməyib.','Ürün eklenmemiş.','No items have been added.')));}
   const tables=await tools.tables();if(!valid())throw Error('stale conversation');const active=tables.filter(table=>table.orderId),offset=picked?.value.startsWith('tables-page:')?Number(raw.slice(12)):0,shown=active.slice(offset,offset+16);
   return result(t('Masalar · canlı yerli məlumat','Masalar · canlı yerel veri','Tables · live local data')+'\n'+(active.length?shown.map(table=>`• ${table.areaName||''} · ${table.label}: ${fmt(table.totalMinor,100)} ₼ · ${t('Ödənilib','Ödendi','Paid')}: ${fmt(table.paidMinor,100)} ₼`).join('\n'):t('Açıq masa hesabı yoxdur.','Açık masa hesabı yok.','There are no open table accounts.')),[...shown.map(table=>choice(`${table.areaName||''} · ${table.label} — ${t('Məhsulları göstər','Ürünleri göster','Show items')}`,'table:'+table.id)),...(offset>0?[choice(t('Əvvəlki masalar','Önceki masalar','Previous tables'),'tables-page:'+Math.max(0,offset-16))]:[]),...(offset+16<active.length?[choice(t('Növbəti masalar','Sonraki masalar','Next tables'),'tables-page:'+(offset+16))]:[])]);
  }
  if(plan.intent==='capabilities'){clear();return result(t('Sualınızı izah edə, problemə addım-addım baxa və iş planı qura bilərəm. Anbarla bağlı istəsəniz qalığı yoxlayar, məhsul dəyişikliklərini təsdiqinizlə edərəm. Nədən başlayaq?','Sorunuzu açıklayabilir, sorunu adım adım inceleyebilir ve plan yapabilirim. İsterseniz stok kontrolü ve onayınızla ürün düzenleme de yapabilirim. Nereden başlayalım?','I can explain questions, work through problems and make a plan. If needed, I can check stock and edit items with your approval. Where should we start?'));}
  if(/^(bu gun )?(isler |her sey )?(cox )?(yaxsi(dir)?|ela(dir)?)( gedir)?$/.test(text))return result(t('Yaxşı xəbərdir! İşlərinizdə kömək lazım olsa, buradayam.','Güzel haber! Yardım gerekirse buradayım.','Good to hear! I’m here if you need a hand.'));
  if(plan.intent==='help'){clear();if(/anbar|stok|qaliq/.test(text)&&/problem|islemir|xeta/.test(text))return result(t('Anbarda hansı problem var: qalıq səhvdir, məhsul görünmür, yoxsa giriş/çıxış alınmır? Məhsulun adını və gözlədiyiniz qalığı yazın.','Depoda sorun nedir: stok yanlış mı, ürün görünmüyor mu, giriş/çıkış yapılamıyor mu?','What is wrong in inventory: incorrect stock, a missing product or a failed movement? Tell me the item and expected quantity.'));return fallback(raw,history);}
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
   if(raw.length>200)return result(t('Səbəbi 200 simvoldan qısa yazın.','Nedeni 200 karakterden kısa yazın.','Keep the reason under 200 characters.'));
   return preview(pending.field,pending.value,raw);
  }
  if(pending?.kind==='value'&&plan.intent==='unknown'){
   if(pending.field==='name'||/^[+\-]?\d/.test(raw))return takeValue(pending.field,raw);
   clear();return fallback(raw,history);
  }
  if(pending?.kind==='product'&&plan.intent==='unknown'){
   if(text.split(' ').length>4||/\b(sen|siz|men|kim|niye|nece|neyin|neynirsen)\b/.test(text)){clear();return fallback(raw,history);}
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
 return{async recheck(){if(approval){const op=approval;await fresh(op.snapshot.product,op.snapshot.warehouse.id,()=>true);const r=preview(op.field,op.value,op.reason);r.body="Təlim yenilənib. Planı yenidən yoxlayın.\n"+r.body;return r;}return setup.recheck(()=>true);},snapshot:()=>({lastOverview,selected,pending,approval,choices,setup:setup.snapshot()}),restore:s=>{if(!s)return;({lastOverview=null,selected=null,pending=null,approval=null,choices=[]}=s);setup.restore(s.setup)},approval:()=>approval?{name:'save',args:[approval.snapshot,approval.field,approval.value,approval.reason,approval.key]}:setup.approval(),async send(input,history=[],valid=()=>true){
  if(locked)return result(t('Bir az gözləyin…','Biraz bekleyin…','Please wait…'));locked=true;
  try{return await respond(input,history,valid);}catch(error){if(error?.pendingTool)throw error;if(/qorunan redaktəni dəstəkləmir/.test(error?.message||'')){clear();return result(t('İstəyinizi başa düşdüm, amma hazırda işləyən köhnə POS nüvəsi köməkçi ilə təhlükəsiz redaktəni dəstəkləmir. Məlumat dəyişməyib. Yeni nüvə build edilənədək Anbar bölməsindən düzəliş edin.','İsteğinizi anladım, ancak mevcut eski çekirdek güvenli yardımcı düzenlemesini desteklemiyor. Veri değişmedi.','I understood the request, but this older core does not support protected assistant edits. Nothing changed. Use Inventory until the new core is built.'));}return result(error?.message||String(error),approval?[choice(confirm,'confirm'),choice(cancel,'cancel')]:[]);}finally{locked=false;}
 }};
}
