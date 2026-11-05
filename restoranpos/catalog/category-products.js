/** Existing dishes are selected here; category changes preserve the native product/recipe record. */
function PsCategoryProductsDialog({parent,category,categories,onClose,onSaved}){
 const R=reactExports,h=psH,{lang}=useI18n();
 const [name,setName]=R.useState(''),[products,setProducts]=R.useState([]),[chosen,setChosen]=R.useState([]),[query,setQuery]=R.useState(''),[source,setSource]=R.useState(''),[busy,setBusy]=R.useState(false),[loading,setLoading]=R.useState(true),[error,setError]=R.useState('');
 const target=R.useRef(category?.id||newIdempotencyKey()),locked=R.useRef(false),created=R.useRef(false);
 const catName=id=>{const c=categories.find(c=>c.id===id);if(!c)return '';const p=categories.find(p=>p.id===c.parentId);return (p?localizedName(p,lang)+' / ':'')+localizedName(c,lang)};
 const load=R.useCallback(async()=>{const r=await window.pos.products.list({includeDrafts:true});if(!r.success)throw Error(r.error?.message||'Məhsullar alınmadı');return r.data.products||[];},[]);
 R.useEffect(()=>{let live=true;load().then(rows=>{if(live)setProducts(rows)}).catch(e=>{if(live)setError(String(e?.message||e))}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[load]);
 const needle=query.trim().toLocaleLowerCase('az');
 const rows=products.filter(p=>(!source||p.categoryId===source)&&(!needle||(localizedName(p,lang)+' '+(p.sku||'')+' '+(p.barcode||'')).toLocaleLowerCase('az').includes(needle)));
 const available=rows.filter(p=>p.categoryId!==target.current),allChosen=available.length>0&&available.every(p=>chosen.includes(p.id));
 const toggle=id=>setChosen(prev=>prev.includes(id)?prev.filter(v=>v!==id):[...prev,id]);
 async function save(){
  if(locked.current||loading)return;
  if(parent&&!name.trim())return setError('Alt kateqoriyanın adını yazın.');
  if(!parent&&!chosen.length)return;
  locked.current=true;setBusy(true);setError('');
  try{
   // Re-read before moving so a stale picker cannot overwrite a renamed or archived dish.
   const fresh=await load();
   if(parent&&!created.current){const r=await window.pos.catalogAdmin.upsertCategory({id:target.current,nameAz:name.trim(),nameTr:name.trim(),nameEn:name.trim(),parentId:parent.id,sortOrder:Math.max(0,...categories.map(c=>c.sortOrder||0))+1},{idempotencyKey:newIdempotencyKey()});if(!r.success)throw Error(r.error?.message||'Alt kateqoriya yaradılmadı');created.current=true;}
   const failed=[];let lastError='';
   for(const id of chosen){
    const p=fresh.find(p=>p.id===id);if(!p){failed.push(id);lastError='Məhsul silinib və ya arxivlənib.';continue;}
    if(p.categoryId===target.current)continue;
    try{const r=await window.pos.catalogAdmin.upsertProduct({id:p.id,categoryId:target.current,nameAz:p.nameAz},{idempotencyKey:newIdempotencyKey()});if(!r.success){failed.push(id);lastError=r.error?.message||'Məhsul köçürülmədi';}}catch(e){failed.push(id);lastError=String(e?.message||e);}
   }
   if(failed.length){setChosen(failed);setProducts(await load());setError(failed.length+' məhsul əlavə edilmədi. '+lastError+' Yenidən sınaya bilərsiniz.');return;}
   await onSaved(target.current);
  }catch(e){setError(String(e?.message||e));}finally{locked.current=false;setBusy(false);}
 }
 return jsxRuntimeExports.jsx(PsAdminDialog,{title:parent?'Alt kateqoriya yarat':catName(category.id)+' — hazır məhsullar',busy,onClose:()=>{if(!locked.current)onClose()},children:h('div',{className:'ps-category-products'},
  parent?h('label',{className:'ps-category-products-name'},h('span',null,'Alt kateqoriyanın adı'),h('input',{autoFocus:true,value:name,disabled:busy||created.current,maxLength:160,onChange:e=>setName(e.target.value),placeholder:'Məsələn: Spirtsiz içkilər'})):null,
  h('p',{className:'ps-category-products-note'},parent?localizedName(parent,lang)+' içində yaradılacaq. Hazır məhsulları indi seçə bilərsiniz.':'Seçilmiş məhsullar bu kateqoriyaya köçürüləcək.'),
  h('div',{className:'ps-category-products-filters'},h('input',{type:'search',autoFocus:!parent,value:query,disabled:busy,onChange:e=>setQuery(e.target.value),'aria-label':'Hazır məhsul axtar',placeholder:'Ad, barkod və ya SKU ilə axtar…'}),h(PsCategoryPick,{categories,value:source,onChange:setSource,blank:'Bütün kateqoriyalar',label:'Mənbə kateqoriya'})),
  h('label',{className:'ps-category-products-all'},h('input',{type:'checkbox',disabled:busy||loading||!available.length,checked:allChosen,onChange:e=>setChosen(prev=>e.target.checked?[...new Set([...prev,...available.map(p=>p.id)])]:prev.filter(id=>!available.some(p=>p.id===id)))}),'Görünənləri seç',h('span',null,chosen.length+' seçildi')),
  h('div',{className:'ps-category-products-list'},loading?h('p',null,'Məhsullar yüklənir…'):rows.length?rows.map(p=>h('label',{key:p.id,className:'ps-category-products-row'+(chosen.includes(p.id)?' is-picked':'')},h('input',{type:'checkbox',checked:chosen.includes(p.id),disabled:busy||p.categoryId===target.current,onChange:()=>toggle(p.id),'aria-label':localizedName(p,lang)}),h('span',null,h('strong',null,localizedName(p,lang)),h('small',null,catName(p.categoryId)+(p.active?'':' · Qaralama')+(p.categoryId===target.current?' · Artıq buradadır':''))),h('b',null,formatMoney(p.priceMinor||0)))):h('p',null,'Bu axtarışa uyğun məhsul yoxdur.')),
  h('p',{className:'ps-category-products-note'},'Ölçü variantları birlikdə köçürülür. Qiymət, anbar qalığı və kalkulyasiya saxlanılır.'),
  error?h('p',{role:'alert',className:'ps-category-products-error'},error):null,
  h('div',{className:'ps-category-products-actions'},h('button',{type:'button',disabled:busy,onClick:onClose},'Ləğv et'),h('button',{type:'button',className:'is-primary',disabled:busy||loading||(parent?!name.trim():!chosen.length),onClick:save},busy?'Saxlanılır…':parent?'Yarat və seçilənləri əlavə et':'Seçilənləri əlavə et ('+chosen.length+')')))});
}
