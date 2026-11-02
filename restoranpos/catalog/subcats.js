/* POSSISTEM_SUBCATS_1926 */
// One level of sub-categories (İçkilər → Spirtli / Spirtsiz). The order screen lists top-level
// categories; a parent shows its sub-categories as tiles before its own products.
let psOrderCats=[];
const psTopCats=list=>(list||[]).filter(c=>!c.parentId);
const psParentOf=(list,id)=>(list||[]).find(c=>c.id===id)?.parentId||'';
function psSubcatTiles(catId){
 const own=psOrderCats.find(c=>c.id===catId);if(!own)return [];
 if(own.parentId){const parent=psOrderCats.find(c=>c.id===own.parentId);return parent?[{id:'subcat-back:'+parent.id,_psTile:parent,_psBack:true}]:[];}
 return psOrderCats.filter(c=>c.parentId===catId).map(c=>({id:'subcat:'+c.id,_psTile:c}));
}
function psSubcatTile(tile,open,lang){
 const h=psH,c=tile._psTile;
 return h('button',{type:'button',key:tile.id,onClick:open,className:'ps-subcat-tile'+(tile._psBack?' is-back':'')},
  h('span',{className:'ps-subcat-name'},(tile._psBack?'← ':'')+localizedName(c,lang)),
  tile._psBack?null:h('span',{className:'ps-subcat-count'},(c.itemCount??0)+' '+psAdminText('məhsul','ürün','items')));
}
// Catalog: parents first, each followed by its sub-categories (the core already sends that order).
function PsCategoryPick({categories,value,onChange,blank,exclude,topOnly,className,label}){
 const h=psH,{lang}=useI18n();
 const rows=(categories||[]).filter(c=>c.id!==exclude&&(!topOnly||!c.parentId)&&(!exclude||c.parentId!==exclude));
 return h('select',{value:value||'',onChange:e=>onChange(e.target.value),className,'aria-label':label},
  blank==null?null:h('option',{value:''},blank),
  rows.map(c=>h('option',{key:c.id,value:c.id},(c.parentId?'   └ ':'')+localizedName(c,lang))));
}
function PsDishCategory({categories,value,onChange}){
 const h=psH;
 return h('label',{className:'block text-sm'},h('span',{className:'text-faint'},psAdminText('Kateqoriya','Kategori','Category')),
  h(PsCategoryPick,{categories,value,onChange,className:'mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream',label:psAdminText('Kateqoriya','Kategori','Category')}));
}
function PsCategoryMove({cat,categories,onMove}){
 const h=psH,hasChildren=(categories||[]).some(c=>c.parentId===cat.id);
 if(hasChildren)return h('p',{className:'ps-menu-note'},psAdminText('Alt kateqoriyası var — köçürülmür','Alt kategorisi var','Has sub-categories'));
 return h('label',{className:'ps-menu-move'},h('span',null,psAdminText('İçinə köçür','İçine taşı','Move into')),
  h(PsCategoryPick,{categories,value:cat.parentId||'',onChange:v=>onMove(cat,v),blank:psAdminText('— Ana kateqoriya —','— Ana kategori —','— Top level —'),exclude:cat.id,topOnly:true,label:psAdminText('İçinə köçür','İçine taşı','Move into')}));
}
async function psMoveProducts(ids,products,target){
 let failed=0;
 for(const id of ids){
  const p=products.find(x=>x.id===id);if(!p){failed+=1;continue;}
  const res=await window.pos.catalogAdmin.upsertProduct({id:p.id,categoryId:target,nameAz:p.nameAz},{idempotencyKey:newIdempotencyKey()});
  if(!res.success)failed+=1;
 }
 return failed;
}
// Objects made in the Obyektlər tab are portal branches; the till form lists local objects.
async function psSyncCloudObjects(known){
 const cloud=await window.pos.business.cloudList();
 if(!cloud?.success)return 0;
 const names=new Set((known||[]).map(o=>String(o.name||'').trim()));let added=0;
 for(const object of cloud.data?.objects||[]){
  const name=String(object?.name||'').trim();if(!name||names.has(name))continue;
  const saved=await window.pos.cashAccounts.saveObject({name});
  if(saved?.success){names.add(name);added+=1;}
 }
 return added;
}
// A set menu (business lunch): one product made of others. Selling it takes the parts' stock.
const PS_MENU_CATEGORY='cat-menus';
function PsSetMenuDialog({menu,categories,onClose,onSaved}){
 const h=psH,{lang}=useI18n(),R=reactExports;
 const [name,setName]=R.useState(menu?.nameAz||''),[price,setPrice]=R.useState(menu?String((menu.priceMinor||0)/100):''),[categoryId,setCategoryId]=R.useState(menu?.categoryId||'');
 const [all,setAll]=R.useState([]),[parts,setParts]=R.useState([]),[query,setQuery]=R.useState(''),[busy,setBusy]=R.useState(false),[error,setError]=R.useState(''),[loading,setLoading]=R.useState(true);
 R.useEffect(()=>{let live=true;(async()=>{
  const list=await window.pos.products.list({includeDrafts:false});
  if(!live)return;if(!list.success){setError(list.error.message);setLoading(false);return;}
  setAll(list.data.products||[]);
  if(menu?.id){const recipe=await window.pos.inventory.recipe(menu.id);if(!live)return;if(recipe.success)setParts((recipe.data.components||[]).map(c=>({id:c.menuItemId,name:c.name,priceMinor:c.priceMinor||0,qty:String((c.qtyMilli||1000)/1000)})));else setError(recipe.error.message);}
  setLoading(false);
 })();return()=>{live=false;};},[menu?.id]);
 const needle=query.trim().toLocaleLowerCase();
 const found=needle?all.filter(p=>p.id!==menu?.id&&!parts.some(x=>x.id===p.id)&&localizedName(p,lang).toLocaleLowerCase().includes(needle)).slice(0,30):[];
 const qtyOf=p=>Number(String(p.qty).replace(',','.'));
 const sum=parts.reduce((t,p)=>t+Math.round((p.priceMinor||0)*(qtyOf(p)||0)),0);
 const save=async()=>{
  const priceMinor=parseMoneyInput(price);
  if(!name.trim())return setError('Menyunun adını yazın');
  if(priceMinor==null||priceMinor<=0)return setError('Menyunun qiymətini yazın');
  if(!parts.length)return setError('Menyuya ən azı bir məhsul əlavə edin');
  if(parts.some(p=>!(qtyOf(p)>0)))return setError('Məhsulun sayı 0-dan böyük olmalıdır');
  setBusy(true);setError('');
  try{
   let target=categoryId;
   if(!target){
    target=PS_MENU_CATEGORY;
    if(!categories.some(c=>c.id===target)){
     const made=await window.pos.catalogAdmin.upsertCategory({id:target,nameAz:'Menyular',nameTr:'Menüler',nameEn:'Set menus',sortOrder:Math.max(0,...categories.map(c=>c.sortOrder??0))+1},{idempotencyKey:newIdempotencyKey()});
     if(!made.success){setError(made.error.message);return;}
    }
   }
   const res=await window.pos.catalogAdmin.upsertProduct({...(menu?.id?{id:menu.id}:{}),nameAz:name.trim(),nameTr:name.trim(),nameEn:name.trim(),priceMinor,categoryId:target,active:true,components:parts.map(p=>({menuItemId:p.id,qtyMilli:Math.round(qtyOf(p)*1000)}))},{idempotencyKey:newIdempotencyKey()});
   if(!res.success){setError(res.error.message);return;}
   toast(psAdminText('Menyu yadda saxlanıldı','Menü kaydedildi','Menu saved'),'success');await onSaved(target);
  }finally{setBusy(false);}
 };
 return jsxRuntimeExports.jsx(PsAdminDialog,{title:menu?.id?psAdminText('Menyunun tərkibi','Menü içeriği','Menu contents'):psAdminText('Menyu yarat','Menü oluştur','Create menu'),onClose,busy,children:h('div',{className:'ps-set-menu'},
  h('div',{className:'ps-set-menu-grid'},
   h('label',null,psAdminText('Menyunun adı','Menü adı','Menu name'),h('input',{value:name,onChange:e=>setName(e.target.value),placeholder:'Biznes lanç','aria-label':psAdminText('Menyunun adı','Menü adı','Menu name')})),
   h('label',null,psAdminText('Qiymət (₼)','Fiyat (₼)','Price (₼)'),h('input',{value:price,inputMode:'decimal',onChange:e=>setPrice(e.target.value),placeholder:'0.00','aria-label':psAdminText('Menyunun qiyməti','Menü fiyatı','Menu price')})),
   h('label',null,psAdminText('Kateqoriya','Kategori','Category'),h(PsCategoryPick,{categories,value:categoryId,onChange:setCategoryId,blank:psAdminText('Menyular (avtomatik)','Menüler (otomatik)','Set menus (automatic)'),label:psAdminText('Menyunun kateqoriyası','Menü kategorisi','Menu category')}))),
  h('label',null,psAdminText('Məhsul əlavə et','Ürün ekle','Add a product'),h('input',{value:query,onChange:e=>setQuery(e.target.value),placeholder:psAdminText('Məhsulun adı','Ürün adı','Product name'),'aria-label':psAdminText('Məhsul axtar','Ürün ara','Search products')})),
  loading?h('p',{role:'status'},psAdminText('Yüklənir…','Yükleniyor…','Loading…')):null,
  found.length?h('div',{className:'ps-set-menu-results'},found.map(p=>h('button',{type:'button',key:p.id,onClick:()=>{setParts([...parts,{id:p.id,name:localizedName(p,lang),priceMinor:p.priceMinor||0,qty:'1'}]);setQuery('');}},h('span',null,localizedName(p,lang)),h('span',null,formatMoney(p.priceMinor||0))))):null,
  parts.length?h('ul',{className:'ps-set-menu-parts'},parts.map(p=>h('li',{key:p.id},h('span',null,p.name),h('input',{value:p.qty,inputMode:'decimal','aria-label':p.name+' — '+psAdminText('say','adet','quantity'),onChange:e=>setParts(parts.map(x=>x.id===p.id?{...x,qty:e.target.value}:x))}),h('button',{type:'button','aria-label':p.name+' — '+psAdminText('sil','sil','remove'),onClick:()=>setParts(parts.filter(x=>x.id!==p.id))},'×')))):null,
  parts.length?h('p',{className:'ps-set-menu-sum'},psAdminText('Məhsullar ayrı-ayrı: ','Ürünler ayrı ayrı: ','Products separately: ')+formatMoney(sum)):null,
  error?h('p',{className:'ps-set-menu-error',role:'alert'},error):null,
  h('div',{className:'ps-set-menu-actions'},h('button',{type:'button',className:'btn-gold',disabled:busy||loading,onClick:()=>void save()},psAdminText('Yadda saxla','Kaydet','Save')),h('button',{type:'button',disabled:busy,onClick:onClose},psAdminText('Ləğv et','İptal','Cancel')))
 )});
}
/* END_POSSISTEM_SUBCATS_1926 */
/* POSSISTEM_STAFF_EDIT_1926 */
// Staff: change an existing user's name, role and PIN (users.update / users.setPin).
function PsStaffEdit({user,roles,onDone}){
 const h=psH,isAdmin=user.role==='administrator';
 const [name,setName]=reactExports.useState(user.fullName||''),[role,setRole]=reactExports.useState(user.role||'waiter'),[pin,setPin]=reactExports.useState(''),[busy,setBusy]=reactExports.useState(false);
 const options=roles.includes(role)||isAdmin?roles:[role,...roles];
 const save=async()=>{
  if(name.trim().length<2||(pin&&pin.length!==4)||busy)return;
  setBusy(true);
  try{
   const res=await window.pos.auth.updateUser({userId:user.id,fullName:name.trim(),...(isAdmin?{}:{role})});
   if(!res.success){toast(res.error.message,'danger');return;}
   if(pin){const p=await window.pos.auth.setPin(user.id,pin);if(!p.success){toast(p.error.message,'danger');return;}}
   toast(psAdminText('Yadda saxlanıldı','Kaydedildi','Saved'),'success');onDone(true);
  }finally{setBusy(false);}
 };
 const field='mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream outline-none focus:border-gold/50';
 return h('form',{className:'ps-staff-edit',onSubmit:e=>{e.preventDefault();void save();}},
  h('h3',null,psAdminText('Düzəliş: ','Düzenle: ','Edit: ')+user.fullName),
  h('label',{className:'block text-sm'},h('span',{className:'text-faint'},psAdminText('Ad','Ad','Name')),h('input',{value:name,onChange:e=>setName(e.target.value),className:field,'aria-label':psAdminText('Ad','Ad','Name')})),
  isAdmin?null:h('label',{className:'mt-2 block text-sm'},h('span',{className:'text-faint'},'Vəzifə'),
   h('select',{value:role,onChange:e=>setRole(e.target.value),className:field,'aria-label':'Vəzifə'},options.map(r=>h('option',{key:r,value:r},_psRoleAz(r))))),
  h('label',{className:'mt-2 block text-sm'},h('span',{className:'text-faint'},psAdminText('Yeni PIN (4 rəqəm, boş qalsa dəyişmir)','Yeni PIN (4 hane, boşsa değişmez)','New PIN (4 digits, empty keeps it)')),
   h('input',{type:'password',inputMode:'numeric',pattern:'[0-9]*',maxLength:4,value:pin,onChange:e=>setPin(e.target.value.replace(/\D/g,'').slice(0,4)),className:field,'aria-label':'Yeni PIN'})),
  h('div',{className:'ps-staff-edit-actions'},
   h('button',{type:'submit',className:'btn-gold',disabled:busy||name.trim().length<2||(pin&&pin.length!==4)},psAdminText('Yadda saxla','Kaydet','Save')),
   h('button',{type:'button',className:'ps-staff-edit-cancel',onClick:()=>onDone(false)},psAdminText('Ləğv et','İptal','Cancel'))));
}
/* END_POSSISTEM_STAFF_EDIT_1926 */
