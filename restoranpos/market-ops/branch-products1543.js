function PsMarketBranchProductPicker({items,value,onChange,onImported,onBusy,allowForeign,disabled}) {
  const h=psH, [search,setSearch]=reactExports.useState(''), [open,setOpen]=reactExports.useState(false), [scope,setScope]=reactExports.useState('all'), [snapshots,setSnapshots]=reactExports.useState([]), [error,setError]=reactExports.useState(''), [busy,setBusy]=reactExports.useState(false), lock=reactExports.useRef(false);
  const load=reactExports.useCallback(async()=>{
    if(!allowForeign || !window.__psBranchProductStock)return;
    try {
      const data=await window.__psBranchProductStock();
      const best=new Map();
      for(const s of data.branches||[]) {
        if(s.deviceId===data.own?.deviceId || s.branchId && s.branchId===data.own?.branchId)continue;
        const key=s.branchId||s.deviceId, old=best.get(key);
        if(!old || s.updatedAt>old.updatedAt)best.set(key,s);
      }
      setSnapshots([...best.values()]);setError('');
    } catch(e) {setError(String(e.message||e));}
  },[allowForeign]);
  reactExports.useEffect(()=>{void load();if(!allowForeign)return;const timer=setInterval(()=>void load(),15000);return()=>clearInterval(timer);},[load,allowForeign]);
  const foreign=reactExports.useMemo(()=>snapshots.flatMap(s=>{
    const goods=new Map();
    for(const g of s.lines||[]) {
      const old=goods.get(g.goodId);
      if(old)old.qtyMilli+=g.qtyMilli;
      else goods.set(g.goodId,{...g,id:'branch:'+s.deviceId+':'+g.goodId,deviceId:s.deviceId,goodId:g.goodId,branch:s.branchName||s.hostname||'—',branchKey:s.branchId||s.deviceId,costMinor:0});
    }
    return [...goods.values()];
  }),[snapshots]);
  const selected=items.find(i=>i.id===value),needle=search.toLocaleLowerCase('az');
  const candidates=(scope==='local'?items:scope==='all'?[...items,...foreign]:foreign.filter(g=>g.branchKey===scope));
  const found=candidates.filter(i=>[i.name,i.barcode,i.sku,i.branch].join(' ').toLocaleLowerCase('az').includes(needle)).slice(0,40);
  const choose=async i=>{
    if(lock.current)return;
    if(!i.deviceId){onChange(i.id,i);setOpen(false);return;}
    lock.current=true;setBusy(true);onBusy(true);setError('');
    try {
      const res=await window.__psImportBranchProduct({deviceId:i.deviceId,goodId:i.goodId});
      if(!res?.success)throw Error(res?.error?.message||psMarketWords('Məhsul seçilmədi','Не удалось выбрать товар','Could not select product'));
      onImported(res.data.good);onChange(res.data.good.id,res.data.good);setOpen(false);
    } catch(e){setError(String(e.message||e));}
    finally {lock.current=false;setBusy(false);onBusy(false);}
  };
  return h('div',{style:{position:'relative',minWidth:0},'data-branch-product-picker':true},
    allowForeign&&snapshots.length?h('label',{style:{display:'block',fontSize:12,color:'#486580'}},psMarketWords('Məhsulun filialı','Филиал товара','Product branch'),h('select',{'aria-label':psMarketWords('Məhsulun filialı','Филиал товара','Product branch'),disabled:busy,value:scope,onChange:e=>{setScope(e.target.value);setOpen(true);},style:{width:'100%',minHeight:48,border:'1px solid #bbd3ee',borderRadius:10,background:'#eff6ff',color:'#173b5e',padding:8}},h('option',{value:'all'},psMarketWords('Bütün filialların məhsulları','Товары всех филиалов','All branches products')),h('option',{value:'local'},psMarketWords('Bu filial','Этот филиал','This branch')),snapshots.map(s=>h('option',{key:s.branchId||s.deviceId,value:s.branchId||s.deviceId},s.branchName||s.hostname||'—')))):null,
    h('input',{className:psField,disabled:disabled||busy,'aria-label':psMarketWords('Alış məhsulu axtar','Поиск товара для закупки','Search purchase product'),placeholder:psMarketWords('Ad, barkod və ya kod…','Название, штрихкод или код…','Name, barcode or code…'),value:open?search:selected?.name||'',onFocus:()=>{setOpen(true);setSearch('');},onChange:e=>{setSearch(e.target.value);setOpen(true);},onKeyDown:e=>{if(e.key==='Escape')setOpen(false);if(e.key==='Enter'&&found.length){e.preventDefault();void choose(found[0]);}},onBlur:()=>setTimeout(()=>setOpen(false),180)}),
    busy?h('p',{role:'status'},psMarketWords('Məhsul seçilir…','Выбираем товар…','Selecting product…')):null,
    error?h('p',{role:'alert',style:{color:'#b42318',fontSize:13}},error,h('button',{type:'button',onClick:()=>void load(),style:{minHeight:48}},psMarketWords('Yenidən yoxla','Повторить','Retry'))):null,
    open&&!busy?h('div',{style:{position:'absolute',zIndex:100,left:0,right:0,top:'100%',maxHeight:300,overflow:'auto',background:'#fff',border:'1px solid #bbd3ee',borderRadius:12,boxShadow:'0 12px 30px #16375422'}},found.length?found.map(i=>h('button',{type:'button',key:i.id,onMouseDown:e=>e.preventDefault(),onClick:()=>void choose(i),style:{display:'block',width:'100%',minHeight:56,padding:12,textAlign:'left',color:'#173b5e',background:'#fff',borderBottom:'1px solid #e4edf6'}},i.name,h('small',{style:{display:'block',color:'#486580'}},[i.barcode,i.unit,i.branch||psMarketWords('Bu filial','Этот филиал','This branch'),i.deviceId?psMarketWords('Qalıq: ','Остаток: ','Stock: ')+(i.qtyMilli/1000):''].filter(Boolean).join(' · ')))):h('p',{style:{padding:12}},psMarketWords('Məhsul tapılmadı','Товар не найден','No products found'))):null);
}
