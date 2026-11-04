// Group sale tiles only. Every size keeps its own product ID and recipe.
function psReadSizeName(name) {
  const match = /^(.+?)(?:\s*[·•|–-]\s*|\s+)(\d+(?:[.,]\d+)?)\s*(sm|cm|qr|kq|ml|l)\s*$/i.exec(name || '');
  if (!match) return null;
  const size = Number(match[2].replace(',', '.'));
  const unit = match[3].toLowerCase().replace(/^cm$/, 'sm');
  if (!Number.isFinite(size) || size <= 0 || size > (unit === 'sm' ? 300 : 100000)) return null;
  return { base: match[1].trim(), size, unit };
}

function psGroupOrderSizes(products, lang) {
  const groups = new Map();
  const keys = new Map();
  for (const product of products) {
    const variant = psReadSizeName(product.nameAz || localizedName(product, lang));
    if (!variant) continue;
    const key = JSON.stringify([product.categoryId, variant.base.replace(/\s+/g, ' ').toLocaleLowerCase('az'), variant.unit]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...variant, product });
    keys.set(product.id, key);
  }
  const emitted = new Set();
  return products.flatMap(product => {
    const key = keys.get(product.id);
    const rows = groups.get(key);
    if (!rows || rows.length < 2 || new Set(rows.map(row => row.size)).size !== rows.length) return [product];
    if (emitted.has(key)) return [];
    emitted.add(key);
    rows.sort((a, b) => a.size - b.size);
    const base = psReadSizeName(localizedName(product, lang))?.base || rows[0].base;
    const available = rows.some(({product: p}) => !p.soldOut && p.available !== false && p.available !== 0);
    return [{
      ...product, id: 'size-family:' + key, nameAz: base, nameTr: base, nameEn: base,
      priceMinor: Math.min(...rows.map(row => row.product.priceMinor)),
      soldOut: !available, available, __psSizeVariants: rows
    }];
  });
}
function PsOrderSizes({family,onPick,onClose,busy,error}){const h=psH,out=row=>!!row.product.soldOut||row.product.available===false||row.product.available===0;return jsxRuntimeExports.jsx(PsAdminDialog,{title:localizedName(family,useI18n().lang)+' — ölçü seçin',onClose,busy,children:h('div',{className:'ps-order-sizes'},h('p',null,'İstədiyiniz ölçünü seçin. Hər ölçünün qiyməti və kalkulyasiyası ayrıdır.'),error?h('p',{className:'ps-order-sizes-error',role:'alert'},error):null,...family.__psSizeVariants.map(row=>h('button',{key:row.product.id,type:'button',disabled:busy||out(row),onClick:()=>onPick(row.product)},h('strong',null,row.size+' '+(row.unit||'sm')),h('span',null,formatMoney(row.product.priceMinor),out(row)?h('small',null,'Bitib'):null))))});}
function PsStockMenuPicker({onClose,onSaved}){const h=psH,[goods,setGoods]=reactExports.useState([]),[query,setQuery]=reactExports.useState(''),[busy,setBusy]=reactExports.useState(false),[loading,setLoading]=reactExports.useState(true),[error,setError]=reactExports.useState(''),lock=reactExports.useRef(false);reactExports.useEffect(()=>{let live=true;void window.pos.erp.call('goods.list',{}).then(r=>{if(!r.success)throw Error(r.error?.message||'Mallar alınmadı');if(live)setGoods(r.data.goods||[])}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[]);return jsxRuntimeExports.jsx(PsAdminDialog,{title:'Anbardan menyuya əlavə et',onClose,busy,children:h('div',{className:'ps-stock-menu-picker'},h('p',null,'Satılan hazır malı seçin. Xammal və resept üçün istifadə edilən malları menyuya çıxarmayın.'),h('label',null,'Mal axtarışı',h('input',{value:query,onChange:e=>setQuery(e.target.value),placeholder:'Ad və ya barkod'})),loading&&h('p',{role:'status'},'Mallar alınır…'),error&&h('p',{role:'alert'},error),...goods.filter(g=>!g.menuActive&&[g.name,g.barcode].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,80).map(g=>h('button',{type:'button',key:g.id,disabled:busy||g.basePriceMinor<=0,onClick:async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await psBusinessCall('catalog.publish',{ingredientId:g.id});if(!r.success)throw Error(r.error?.message||'Əlavə edilmədi');window.dispatchEvent(new Event('possistem-catalog-changed'));await onSaved(r.data);onClose();}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}}},h('strong',null,g.name),h('span',null,g.basePriceMinor>0?formatMoney(g.basePriceMinor):'Əvvəlcə satış qiyməti yazın'))))});}
