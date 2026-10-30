function PsSizeVariants({rows,onChange,price,disabled}) {
 const h=psH,{lang}=useI18n(),L=(a,t,e)=>psBizText(lang,a,t,e);
 const update=(i,key,value)=>onChange(rows.map((row,n)=>n===i?{...row,[key]:value}:row));
 return h('fieldset',{className:'ps-size-variants',disabled},h('legend',null,L('Ölçü variantları','Boyut seçenekleri','Size variants')),
 h('label',{className:'ps-size-toggle'},h('input',{type:'checkbox',checked:rows.length>0,onChange:e=>onChange(e.target.checked?[{size:'28',price:price||''},{size:'30',price:price||''},{size:'32',price:price||''}]:[])}),L('Müxtəlif ölçülər əlavə et','Farklı boyutlar ekle','Add different sizes')),
 rows.length?h('div',{},h('p',null,L('Ölçünü özünüz yazın. Hər ölçü ayrıca məhsul, qiymət və kalkulyasiya ilə saxlanılır.','Boyutu kendiniz yazın. Her boyut ayrı ürün, fiyat ve reçeteyle kaydedilir.','Enter any size. Each size has its own product, price and recipe.')),
 ...rows.map((row,i)=>h('div',{className:'ps-size-row',key:i},h('label',null,L('Ölçü (sm)','Boyut (cm)','Size (cm)'),h('input',{'aria-label':L('Ölçü','Boyut','Size')+' '+(i+1),inputMode:'decimal',value:row.size,onChange:e=>update(i,'size',e.target.value),placeholder:'29'})),h('label',null,L('Qiymət (₼)','Fiyat (₼)','Price (₼)'),h('input',{'aria-label':L('Variantın qiyməti','Boyut fiyatı','Variant price')+' '+(i+1),inputMode:'decimal',value:row.price,onChange:e=>update(i,'price',e.target.value),placeholder:'0.00'})),h('button',{type:'button',disabled:rows.length===1,onClick:()=>onChange(rows.filter((_,n)=>n!==i)),'aria-label':L('Ölçünü sil','Boyutu sil','Remove size')+' '+(i+1)},'×'))),
 h('button',{type:'button',disabled:rows.length>=24,onClick:()=>onChange([...rows,{size:'',price:price||''}])},L('+ Ölçü əlavə et','+ Boyut ekle','+ Add size'))):null);
}
