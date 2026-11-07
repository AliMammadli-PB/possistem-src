import {normalize,rankProducts,parseDecimal,quantityInStockUnit} from './stock-assistant.mjs';
// Guided drafts for existing POS APIs. No price, ingredient or recipe is invented.
export function createSetupConversation({tools,language='az',makeKey}){
 const t=(az,tr,en)=>language==='tr'?tr:language==='en'?en:az;
 const choice=(label,value)=>({label,value}),cancel=choice(t('Ləğv et','İptal','Cancel'),'cancel');
 let flow=null,last=null;
 const reply=(body,options=[])=>last={body,choices:[...options,cancel]};
 const guard=valid=>{if(!valid())throw Error('stale conversation');};
 const fmt=(n,scale=1000)=>(n/scale).toLocaleString(language==='en'?'en-GB':language==='tr'?'tr-TR':'az-AZ',{minimumFractionDigits:scale===100?2:0,maximumFractionDigits:scale===100?2:3});
 const preview=()=>{
  flow.stage='confirm';
  if(flow.kind==='raw')return reply(t(`Anbar malı yaradılacaq:\n${flow.name} · ${flow.unit}\nBaşlanğıc qalıq: 0. Satışda göstərilməyəcək.\nMaya və satış qiyməti: 0 ₼; sonra kartda dəyişə bilərsiniz.\nTəsdiq edirsiniz?`,`Depo malı: ${flow.name} · ${flow.unit}. Başlangıç stok ve fiyat 0; satışta gösterilmeyecek. Onaylıyor musunuz?`,`Create raw material: ${flow.name} · ${flow.unit}. Initial stock and prices 0; hidden from sales. Confirm?`),[choice(t('Təsdiq et','Onayla','Confirm'),'setup:save')]);
  if(flow.kind==='menu')return reply(t(`Menyu yeməyi yaradılacaq:\n${flow.name} · ${flow.categoryName}\nSatış qiyməti: ${fmt(flow.priceMinor,100)} ₼\nTəsdiqdən sonra satış menyusunda görünəcək.\nTəsdiq edirsiniz?`,`Menü ürünü: ${flow.name} · ${flow.categoryName} · ${fmt(flow.priceMinor,100)} ₼. Onaylıyor musunuz?`,`Menu item: ${flow.name} · ${flow.categoryName} · ${fmt(flow.priceMinor,100)} ₼. It will appear in sales. Confirm?`),[choice(t('Təsdiq et','Onayla','Confirm'),'setup:save')]);
  return reply(t(`Bir porsiya üçün kalkulyasiya:\n${flow.product.name}\n${flow.lines.map(l=>`• ${l.name}: ${fmt(l.qtyMilli)} ${l.unit}`).join('\n')}\n${flow.baseline.placeholder?'Avtomatik hazır mal çıxışı bu tərkiblə əvəzlənəcək.\n':''}Saxlamaq indi anbardan mal çıxmır; tərkib satış tamamlananda tətbiq olunur.\nTəsdiq edirsiniz?`,`Bir porsiyon ${flow.product.name}:\n${flow.lines.map(l=>`${l.name}: ${fmt(l.qtyMilli)} ${l.unit}`).join('\n')}\nStok satış tamamlandığında düşer. Onaylıyor musunuz?`,`One portion of ${flow.product.name}:\n${flow.lines.map(l=>`${l.name}: ${fmt(l.qtyMilli)} ${l.unit}`).join('\n')}\nSaving does not consume stock; completed sales apply the recipe. Confirm?`),[choice(t('Təsdiq et','Onayla','Confirm'),'setup:save'),choice(t('Tərkib əlavə et','İçerik ekle','Add ingredient'),'setup:add')]);
 };
 const askName=()=>{flow.stage='name';return reply(t('Yeni məhsulun adını yazın.','Yeni ürünün adını yazın.','Enter the new product name.'));};
 const askCategory=async valid=>{flow.catalogue=await tools.setupMenu();guard(valid);flow.stage='category';if(!flow.catalogue.categories.length)return reply(t('Əvvəl Kateqoriyalar bölməsində bir menyu kateqoriyası yaradın. Sonra məhsulu yaradaq.','Önce bir menü kategorisi oluşturun.','First create a menu category, then create the item.'));return reply(t('Hansı menyu kateqoriyasına əlavə edək? Adını yazın və ya seçin.','Hangi menü kategorisine ekleyelim?','Which menu category? Type its name or select one.'),flow.catalogue.categories.slice(0,10).map(c=>choice(c.name,'setup:category:'+c.id)));};
 const askIngredient=()=>{flow.stage='ingredient';return reply(t(`${flow.product.name} üçün anbardan tərkib seçin və ya adını yazın.\n${flow.lines.length?`${flow.lines.length} tərkib əlavə edilib. Hazırdırsa “Planı göstər” seçin.`:'Tərkibi və miqdarları siz seçirsiniz; mən təxmin etmirəm.'}`,`${flow.product.name} için içerik seçin veya adını yazın.`, `Select or type an ingredient for ${flow.product.name}. You choose ingredients and quantities; I do not guess.`),[...flow.goods.slice(0,8).map(g=>choice(g.name,'setup:ingredient:'+g.id)),...(flow.lines.length?[choice(t('Planı göstər','Planı göster','Review recipe'),'setup:review')]:[]),choice(t('Yeni xammal yarat','Yeni hammadde oluştur','Create raw material'),'setup:new-raw')]);};
 const chooseTarget=async(product,valid)=>{flow.product=product;flow.baseline=await tools.setupRecipe(product.id);guard(valid);if(flow.baseline.components.length||flow.baseline.lines.length&&!flow.baseline.placeholder){const body=t(`${product.name} üçün artıq kalkulyasiya var. Onu avtomatik əvəz etmirəm. Mövcud tərkib:\n${flow.baseline.lines.map(l=>`• ${l.name}: ${fmt(l.qtyMilli)} ${l.unit}`).join('\n')}\nDəyişiklik üçün Kalkulyasiya bölməsində bu yeməyi açın.`,`Bu ürünün reçetesi zaten var. Otomatik değiştirmiyorum.`,`This item already has a recipe. I will not replace it automatically; open it in Calculation to edit it.`);flow=null;return reply(body);}
  flow.goods=(await tools.setupRaw()).filter(g=>!String(g.sku||'').startsWith('MENU-'));guard(valid);flow.lines=[];return askIngredient();};
 const findTarget=async(name,valid)=>{const matches=rankProducts(flow.catalogue.products,name),exact=matches.filter(m=>m.nameExact);if(exact.length===1||matches.length===1&&!matches[0].fuzzy)return chooseTarget((exact[0]||matches[0]).product,valid);flow.stage='target';flow.requestedName=name;return reply(matches.length?t('Hansı yeməyin kalkulyasiyasını yaradaq?','Hangi ürünün reçetesi?','Which item should have this recipe?'):t(`Menyuda “${name}” tapmadım. Başqa ad yazın və ya əvvəl bu adlı menyu yeməyi yaradın.`,`Menüde “${name}” yok. Başka ad yazın veya ürünü oluşturun.`,`No “${name}” in the menu. Try another name or create that menu item first.`),[...matches.map(m=>choice(m.product.name,'setup:target:'+m.product.id)),...(!matches.length?[choice(t('Bu adlı menyu yeməyi yarat','Bu menü ürününü oluştur','Create this menu item'),'setup:new-menu')]:[])]);};
 const beginRecipe=async(plan,valid)=>{if(!tools.setupPermissions().recipe)throw Error('Kalkulyasiya yaratmaq üçün recipes.manage və inventory.view icazələri tələb olunur.');flow={kind:'recipe',stage:'target',key:makeKey(),requestedName:plan.name||''};flow.catalogue=await tools.setupMenu();guard(valid);return plan.name?findTarget(plan.name,valid):reply(t('Kalkulyasiyanı hansı menyu yeməyi üçün yaradaq? Adını yazın və ya seçin.','Reçete hangi menü ürünü için?','Which menu item is the recipe for? Type or select its name.'),flow.catalogue.products.slice(0,8).map(p=>choice(p.name,'setup:target:'+p.id)));};
 async function send(raw,valid){
  guard(valid);if(!flow)return null;const text=normalize(raw);
  if(raw==='setup:resume')return last;
  const picked=last?.choices.find(c=>c.value===raw);
  if(raw.startsWith('setup:')&&!picked)return reply(t('Cari addımdakı seçimlərdən istifadə edin.','Geçerli adımdaki seçenekleri kullanın.','Use the choices from the current step.'));
  if(flow.stage==='kind'){
   if(raw==='setup:raw'||/^(xammal|anbar mali|anbar|raw)$/.test(text))flow.kind='raw';else if(raw==='setup:menu'||/^(menyu|yemek|menu)$/.test(text)){flow.kind='menu';flow.resume=null;}else return last;
   return askName();
  }
  if(raw==='setup:new-raw'){if(!tools.setupPermissions().raw)throw Error('Xammal yaratmaq icazəniz yoxdur.');const resume=flow;flow={kind:'raw',stage:'name',key:makeKey(),id:makeKey(),resume};return askName();}
  if(raw==='setup:new-menu'){if(!tools.setupPermissions().menu)throw Error('Menyu yaratmaq icazəniz yoxdur.');const name=flow.requestedName;flow={kind:'menu',stage:'name',key:makeKey(),id:makeKey(),returnRecipe:true,name};return name?askCategory(valid):askName();}
  if(flow.stage==='name'){
   if(!raw.trim()||raw.trim().length>100)return reply(t('Ad 1–100 simvol olmalıdır.','Ad 1–100 karakter olmalı.','Use a name of 1–100 characters.'));
   flow.name=raw.trim();flow.id=flow.id||makeKey();
   if(flow.kind==='menu')return askCategory(valid);
   const goods=await tools.setupRaw();guard(valid);if(goods.some(p=>normalize(p.name)===text))return reply(t('Bu adda mal artıq var. Başqa ad yazın; ikinci nüsxə yaratmıram.','Bu adda mal zaten var. Başka ad yazın.','That material already exists. Enter another name; I will not duplicate it.'));
   flow.stage='unit';return reply(t('Ölçü vahidini seçin.','Ölçü birimini seçin.','Choose the unit.'),[choice('ədəd','setup:unit:ədəd'),choice('kq','setup:unit:kg'),choice('litr','setup:unit:l')]);
  }
  if(flow.stage==='unit'){
   const unit=picked?.value.startsWith('setup:unit:')?raw.slice(11):({eded:'ədəd',dene:'ədəd',kg:'kg',kq:'kg',l:'l',litr:'l'})[text];if(!['kg','l','ədəd'].includes(unit))return last;flow.unit=unit;return preview();
  }
  if(flow.stage==='category'){
   const found=picked?.value.startsWith('setup:category:')?flow.catalogue.categories.find(c=>c.id===raw.slice(15)):flow.catalogue.categories.find(c=>normalize(c.name)===text);
   if(!found){const matches=flow.catalogue.categories.filter(c=>normalize(c.name).includes(text));return reply(t('Kateqoriyanı dəqiqləşdirin.','Kategoriyi netleştirin.','Choose a category.'),matches.slice(0,10).map(c=>choice(c.name,'setup:category:'+c.id)));}
   flow.categoryId=found.id;flow.categoryName=found.name;flow.stage='price';return reply(t(`${flow.name} üçün satış qiymətini manatla yazın, məsələn 8,50.`,`${flow.name} için satış fiyatını yazın.`,`Enter the sale price in AZN for ${flow.name}, e.g. 8.50.`));
  }
  if(flow.stage==='price'){const price=parseDecimal(raw,2);if(price===null)return reply(t('Qiyməti düzgün yazın, məsələn 8,50.','Geçerli fiyat yazın.','Enter a valid price, e.g. 8.50.'));flow.priceMinor=price;return preview();}
  if(flow.kind==='recipe'&&flow.stage==='target'){
   if(picked?.value.startsWith('setup:target:'))return chooseTarget(flow.catalogue.products.find(p=>p.id===raw.slice(13)),valid);
   return findTarget(raw,valid);
  }
  if(raw==='setup:add')return askIngredient();
  if(flow.kind==='recipe'&&flow.stage==='ingredient'){
   if(raw==='setup:review'||/^(hazirdir|tamam|saxla|plani goster)$/.test(text)){if(!flow.lines.length)return askIngredient();return preview();}
   const matches=picked?.value.startsWith('setup:ingredient:')?flow.goods.filter(g=>g.id===raw.slice(17)).map(product=>({product})):rankProducts(flow.goods,raw);
   const exact=matches.filter(m=>m.nameExact);
   if(exact.length===1||matches.length===1&&!matches[0].fuzzy){flow.ingredient=(exact[0]||matches[0]).product;flow.stage='quantity';return reply(t(`1 porsiya ${flow.product.name} üçün ${flow.ingredient.name} miqdarını yazın. Vahid: ${flow.ingredient.unit}. Məsələn kq üçün “0,250” və ya “250 qram”.`, `Bir porsiyon için ${flow.ingredient.name} miktarı nedir? Birim: ${flow.ingredient.unit}.`,`How much ${flow.ingredient.name} per portion? Unit: ${flow.ingredient.unit}.`));}
   return reply(matches.length?t('Hansı xammalı seçirsiniz?','Hangi hammadde?','Which ingredient?'):t('Bu xammal anbarda tapılmadı. Başqa ad yazın və ya “Yeni xammal yarat” seçin.','Hammadde bulunamadı. Başka ad yazın.','That ingredient is not in inventory. Try another name or create it.'),[...matches.map(m=>choice(m.product.name,'setup:ingredient:'+m.product.id)),choice(t('Yeni xammal yarat','Yeni hammadde oluştur','Create raw material'),'setup:new-raw')]);
  }
  if(flow.kind==='recipe'&&flow.stage==='quantity'){
   const match=String(raw).trim().match(/^(\d+(?:[.,]\d{1,3})?)\s*(kg|kq|qram|q|g|l|ml|ədəd|eded|dene|qab)?$/i),qty=match?quantityInStockUnit(match[1],match[2],flow.ingredient.unit):null;
   if(!qty||qty<0||normalize(flow.ingredient.unit)==='eded'&&qty%1000!==0)return reply(t(`Miqdarı ${flow.ingredient.unit} vahidinə uyğun yazın; ədəd tam olmalıdır.`,`Miktarı ${flow.ingredient.unit} birimine uygun yazın.`,`Enter a positive quantity in ${flow.ingredient.unit}; pieces must be whole.`));
   const line={ingredientId:flow.ingredient.id,name:flow.ingredient.name,unit:flow.ingredient.unit,qtyMilli:qty};flow.lines=flow.lines.filter(l=>l.ingredientId!==line.ingredientId).concat(line);return askIngredient();
  }
  if(flow.stage==='confirm'&&(raw==='setup:save'||/^(tesdiq et|tesdiq|tesdiqle|confirm|beli|yes)$/.test(text))){
   const operation=flow;guard(valid);
   if(operation.kind==='raw')await tools.setupCreateRaw(operation,operation.key,valid);
   else if(operation.kind==='menu')await tools.setupCreateMenu(operation,operation.key,valid);
   else await tools.setupSaveRecipe(operation,valid);
   guard(valid);flow=null;
   if(operation.resume){flow=operation.resume;flow.goods=(await tools.setupRaw()).filter(g=>!String(g.sku||'').startsWith('MENU-'));guard(valid);const next=askIngredient();return{...next,body:t('Xammal yaradıldı.\n','Hammadde oluşturuldu.\n','Raw material created.\n')+next.body};}
   if(operation.returnRecipe){await beginRecipe({name:operation.name},valid);return last;}
   return{body:operation.kind==='recipe'?t('Kalkulyasiya saxlanıldı. Tərkib bu yeməyin tamamlanmış satışlarında tətbiq olunacaq. İndi anbar qalığı dəyişməyib.','Reçete kaydedildi.','Recipe saved. It applies to completed sales; current stock is unchanged.'):t(`${operation.name} yaradıldı.`,`${operation.name} oluşturuldu.`,`${operation.name} was created.`),choices:[]};
  }
  return last;
 }
 return{async recheck(valid){if(!flow)return{body:"Yeni plan qurun.",choices:[]};if(flow.kind==='recipe'){const current=await tools.setupRecipe(flow.product.id);guard(valid);if(JSON.stringify(current)!==JSON.stringify(flow.baseline)){flow=null;return{body:"Kalkulyasiya dəyişib. Yenidən plan qurun.",choices:[]};}}const r=preview();r.body="Təlim yenilənib. Planı yenidən yoxlayın.\n"+r.body;return r;},snapshot:()=>({flow,last}),restore:s=>{flow=s?.flow||null;last=s?.last||null},approval:()=>flow?.stage==='confirm'?{name:flow.kind==='raw'?'setupCreateRaw':flow.kind==='menu'?'setupCreateMenu':'setupSaveRecipe',args:flow.kind==='recipe'?[flow]:[flow,flow.key]}:null,get active(){return!!flow},get pricePrompt(){return flow?.stage==='price'},cancel(){flow=null;last=null},resume(){return last},hint(){return flow?t('Yarımçıq yaradılma saxlanılıb. Davam etmək üçün “Yaradılmaya qayıt” seçin.','Taslak saklandı. Devam etmek için geri dönün.','Your draft is kept. Resume creation to continue.'):''},async start(plan,valid){if(plan.intent==='recipe_create')return beginRecipe(plan,valid);const caps=tools.setupPermissions();if(!caps.raw&&!caps.menu)throw Error('Məhsul yaratmaq icazəniz yoxdur.');const resume=flow?.kind==='recipe'?flow:null;flow={kind:'new',stage:'kind',key:makeKey(),resume};return reply(t('Nə yaradaq: anbar malı/xammal, yoxsa satış menyusu üçün yemək?','Hammadde mi, menü ürünü mü oluşturalım?','Create raw material for inventory or a menu item for sales?'),[...(caps.raw?[choice(t('Anbar malı / xammal','Hammadde','Raw material'),'setup:raw')]:[]),...(caps.menu?[choice(t('Menyu yeməyi','Menü ürünü','Menu item'),'setup:menu')]:[])]);},send};
}
