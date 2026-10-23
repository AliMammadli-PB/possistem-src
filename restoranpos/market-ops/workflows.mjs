/** Market-only UI integration. Every replacement is checked against the current
 * bundled Restaurant UI, so packaging fails rather than silently losing a flow. */
export function patchMarketWorkflows(source) {
 if(source.includes('POS_MARKET_WORKFLOWS_1529'))return source;
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Market workflow anchor missing: '+a.slice(0,120));source=source.replace(a,b);};
 const section=(name,fn)=>{const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);if(start<0||end<0)throw Error('Missing component '+name);source=source.slice(0,start)+fn(source.slice(start,end))+source.slice(end);};
 source=`${source}\n`;
 const helpers=`// POS_MARKET_WORKFLOWS_1529
function psMarketWords(az,ru,en){return window.__psMarketLang==="ru"?ru:window.__psMarketLang==="en"?en:az;}
function psMarketOpenDoc(row,mode="view"){const host=window.parent;host.__marketDocumentRequest={row,mode};host.dispatchEvent(new host.CustomEvent("market:document-open"));}
function PsMarketDocActions({row}){const h=psH,rights=window.__psMarketRights||{};return h("div",{style:{display:"flex",flexWrap:"wrap",gap:8}},h("button",{className:"ps-period-chip",onClick:()=>psMarketOpenDoc(row)},psMarketWords("Bax","Просмотр","View")),rights.canDocsEdit&&!row.cancelled?h("button",{className:"ps-period-chip",onClick:()=>psMarketOpenDoc(row,"edit")},psMarketWords("Düzəliş","Изменить","Edit")):null,rights.canDocsDelete&&!row.cancelled?h("button",{className:"ps-period-chip",onClick:()=>psMarketOpenDoc(row,"cancel")},psMarketWords("Sil","Удалить","Cancel")):null);}
function PsMarketProductPicker({items,value,onChange,disabled}){const h=psH,[search,setSearch]=reactExports.useState(""),[open,setOpen]=reactExports.useState(false);const selected=items.find(i=>i.id===value),needle=search.toLocaleLowerCase();const found=items.filter(i=>[i.name,i.barcode,i.sku,i.id].join(" ").toLocaleLowerCase().includes(needle)).slice(0,30);return h("div",{style:{position:"relative",minWidth:0}},h("input",{className:psField,disabled,placeholder:psMarketWords("Ad, barkod və ya kod…","Название, штрихкод или код…","Name, barcode or code…"),value:open?search:selected?.name||"",onFocus:()=>{setOpen(true);setSearch("");},onChange:e=>{setSearch(e.target.value);setOpen(true);},onKeyDown:e=>{if(e.key==="Escape")setOpen(false);if(e.key==="Enter"&&found.length){e.preventDefault();onChange(found[0].id);setOpen(false);}},onBlur:()=>setTimeout(()=>setOpen(false),150)}),open?h("div",{style:{position:"absolute",zIndex:100,left:0,right:0,top:"100%",maxHeight:300,overflow:"auto",background:"#fff",border:"1px solid #bbd3ee",borderRadius:12,boxShadow:"0 12px 30px #16375422"}},found.map(i=>h("button",{type:"button",key:i.id,onMouseDown:e=>e.preventDefault(),onClick:()=>{onChange(i.id);setOpen(false);},style:{display:"block",width:"100%",minHeight:52,padding:12,textAlign:"left",color:"#173b5e",background:"#fff",borderBottom:"1px solid #e4edf6"}},i.name,h("small",{style:{display:"block",color:"#647b91"}},[i.barcode,i.sku].filter(Boolean).join(" · "))))):null);}
`;
 replace('function psGoodForm(',helpers+'\nfunction psGoodForm(');
 // Return the saved id to callers using the same full goods editor.
 section('useMarketGoodsDialogRun',s=>{if(!s.includes('await onDone();'))throw Error('Goods saved callback missing');return s.replace('await onDone();','await onDone(res.data);');});
 section('OpsStock',s=>{
  s=s.replace('  const [drawer, setDrawer] = reactExports.useState(null);','  const [drawer, setDrawer] = reactExports.useState(null);\n  const [goodsMeta,setGoodsMeta]=reactExports.useState({categories:[],objects:[]});\n  reactExports.useEffect(()=>{void Promise.all([psErp("categories.list",{}),window.pos.cashAccounts.list(...psToday())]).then(([c,a])=>setGoodsMeta({categories:c.success?(c.data.categories||[]):[],objects:a.success?(a.data.objects||[]):[]}));},[]);');
  const button='onClick: () => setDrawer({ name: "", unit: "kg", cost: "", sale: "", barcode: "" })';if(!s.includes(button))throw Error('Stock create button missing');s=s.replace(button,'onClick:()=>setDrawer({...psGoodForm(null,false),stockWarehouseId:warehouseId})');
  const dialog='drawer && psStockItemDialog({ drawer, setDrawer, busy, run, levels })';if(!s.includes(dialog))throw Error('Stock product dialog missing');s=s.replace(dialog,'drawer && jsxRuntimeExports.jsx(PsGoodDialog,{form:drawer,setForm:setDrawer,categories:goodsMeta.categories,objects:goodsMeta.objects,warehouses,onSaved:reload})');return s;
 });
 section('OpsPurchases',s=>{
  s=s.replace('  const [invoice, setInvoice]', '  const [productForm,setProductForm]=reactExports.useState(null);\n  const [productMeta,setProductMeta]=reactExports.useState({categories:[],warehouses:[]});\n  reactExports.useEffect(()=>{void Promise.all([psErp("categories.list",{}),window.pos.inventory.warehouses()]).then(([c,w])=>setProductMeta({categories:c.success?(c.data.categories||[]):[],warehouses:w.success?(w.data.warehouses||[]):[]}));},[]);\n  const [invoice, setInvoice]');
  const select=`h("select", { value: l.ingredientId, className: field, onChange: (e) => setLine(form, setForm, i, { ingredientId: e.target.value }) },
            h("option", { value: "" }, "Anbar məhsulu seçin…"),
            data.ingredients.map((x) => h("option", { key: x.id, value: x.id }, x.name + " (" + x.unit + ")")))`;
  if(!s.includes(select))throw Error('Purchase product select missing');
  s=s.replace(select,'jsxRuntimeExports.jsx(PsMarketProductPicker,{items:data.ingredients,value:l.ingredientId,onChange:id=>setLine(form,setForm,i,{ingredientId:id})})');
  const button='onClick: () => setInvoice({ ...invoice, lines: [...invoice.lines, { ingredientId: "", isNew: true, name: "", unit: "kg", qty: "", price: "" }] })';
  if(!s.includes(button))throw Error('Purchase new product anchor missing');
  s=s.replace(button,'onClick:()=>setProductForm(psGoodForm(null,false))');
  s=s.replace('invoice ? jsxRuntimeExports.jsx(PsAdminDialog','invoice && !productForm ? jsxRuntimeExports.jsx(PsAdminDialog');
  const ui=`    productForm ? jsxRuntimeExports.jsx(PsGoodDialog,{form:productForm,setForm:setProductForm,categories:productMeta.categories,warehouses:productMeta.warehouses,objects:data.objects,onSaved:async(saved)=>{const good={id:saved.id,name:productForm.name,unit:productForm.unit,barcode:productForm.barcode,costMinor:psMoneyIn(productForm.cost||"0")};setData(d=>({...d,ingredients:[...d.ingredients.filter(i=>i.id!==good.id),good]}));setInvoice(p=>({...p,lines:[...p.lines.filter(l=>l.ingredientId||l.qty||l.price),{ingredientId:good.id,qty:"1",price:(good.costMinor/100).toFixed(2)}]}));}}) : null,\n`;
  s=s.replace('  return h("div", { className: "space-y-4" },','  return h("div", { className: "space-y-4" },\n'+ui);
  return s;
 });
 section('PsDocuments',s=>{
  const old='canEdit(r)?jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setEdit(r),children:psBizText(lang,"Düzəliş","Düzenle","Edit")}):null';
  if(!s.includes(old))throw Error('Payment document actions missing');
  return s.replace(old,'jsxRuntimeExports.jsx(PsMarketDocActions,{row:r})');
 });
 section('OpsExpenses',s=>{
  const a=s.indexOf('jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setDocEdit('),b=s.indexOf('])\n',a);
  if(a<0||b<0)throw Error('Expense actions missing');
  return s.slice(0,a)+'jsxRuntimeExports.jsx(PsMarketDocActions,{row:{...m,type:"expense",name:m.reason}})'+s.slice(b);
 });
 section('OpsIncome',s=>s.replaceAll('Cəmi qazanc','Digər gəlirlər').replaceAll('+ Qazanc','+ Digər gəlir').replaceAll('Bu dövrdə qazanc yoxdur','Bu dövrdə əlavə gəlir qaiməsi yoxdur').replace('h("span", { className: "flex gap-1" },','h("span", { className: "flex gap-1" },jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>psMarketOpenDoc({...d,type:"income",createdAt:d.docAt},"view"),children:psMarketWords("Bax","Просмотр","View")}),'));
 // Only the outer operations entry manages tills/users; inner cash ledger remains reachable by its direct URL.
 source=source.replace('tab.id === "costing" || tab.id === "delivery"','tab.id === "costing" || tab.id === "delivery"');
 source=source.replaceAll('"+ Yeni mal"','psMarketWords("+ Yeni məhsul","+ Новый товар","+ New product")').replaceAll('"Yeni mal"','psMarketWords("Yeni məhsul","Новый товар","New product")').replaceAll('"+ Mal"','psMarketWords("+ Yeni məhsul","+ Новый товар","+ New product")').replaceAll('"İnventarizasiya"','psMarketWords("Sayım","Пересчёт","Stock count")');
 return source;
}
