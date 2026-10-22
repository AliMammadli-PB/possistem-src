/**
 * Market 1.5.47 warehouse screens:
 *  - Anbar → "Bu filialın anbarı" rows keep only Zay (Redaktə, Düzəliş and Sil
 *    stay in Mallar).
 *  - Zay creates a document (core business.call waste.*), listed in
 *    Alışlar → Zaylar where it can be viewed, edited, deleted and printed.
 *  - Every document here prints on A4 (Alış qaimələri, Qaytarmalar, Zaylar)
 *    through the bridge's files.savePdf → system print dialog.
 * Anchors are exact; a changed Restaurant bundle fails the build, not the till.
 */
export function patchWaste1547(source) {
  if (source.includes('POS_MARKET_WASTE_1547')) return source;
  const replace = (a, b) => { if (!source.includes(a)) throw Error('Market 1.5.47 anchor missing: ' + a.slice(0, 120)); source = source.replace(a, b); };

  // 1. Row actions: Zay only.
  replace(`            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setDrawer({ id: row.id, name: row.name, unit: row.unit, cost: ((row.costMinor ?? 0) / 100).toFixed(2), sale: ((row.salePriceMinor ?? 0) / 100).toFixed(2), barcode: row.barcode || "", minQtyMilli: row.minQtyMilli || 0 }), children: "Redaktə" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEdit({ mode: "adjust", row, value: "", reason: "" }), children: "Düzəliş" }),
`, '');
  replace(`            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: async () => {
              if (!(await confirmAsk('"' + row.name + '" anbardan silinsin? Keçmiş hərəkətlər qalır. Reseptlərdə varsa, oradan da çıxarın.', { danger: true }))) return;
              void run(window.pos.inventory.deactivateIngredient(row.id), "Silindi");
            }, children: "Sil" })
`, '');

  // 2. Zay → a Z-… document.
  replace(`            const call = edit.mode === "waste"
              ? window.pos.inventory.waste({ ...payload, qtyMilli: opsMilli(edit.value) })
              : window.pos.inventory.adjust({ ...payload, qtyDeltaMilli: opsMilli(edit.value) });
            void run(call, "Saxlanıldı").then((ok) => { if (ok) setEdit(null); });`,
  `            const call = edit.mode === "waste"
              ? window.pos.business.call("waste.save", { warehouseId, lines: [{ ingredientId: edit.row.id, qtyMilli: opsMilli(edit.value) }], note: payload.reason })
              : window.pos.inventory.adjust({ ...payload, qtyDeltaMilli: opsMilli(edit.value) });
            void run(call, edit.mode === "waste" ? psMarketWords("Zay qaiməsi yaradıldı (Alışlar → Zaylar)", "Акт списания создан (Закупки → Списания)", "Waste document created (Purchases → Waste)") : "Saxlanıldı").then((ok) => { if (ok) setEdit(null); });`);

  // 3. Alışlar: Zaylar tab and A4 printing.
  replace(`["returns", "Qaytarmalar"], ["prices", "Təchizatçı qiymətləri"], ["report", "Hesabat"]].map(`,
    `["returns", "Qaytarmalar"], ...(psMarketMode() ? [["waste", "Zaylar"]] : []), ["prices", "Təchizatçı qiymətləri"], ["report", "Hesabat"]].map(`);
  replace(`    view === "prices" ? jsxRuntimeExports.jsx(PsSupplierPrices, {}) : null,`,
    `    view === "waste" ? jsxRuntimeExports.jsx(PsWasteDocs, {}) : null,\n    view === "prices" ? jsxRuntimeExports.jsx(PsSupplierPrices, {}) : null,`);
  replace(`          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openDetail(p), children: "Bax" }),`,
    `          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openDetail(p), children: "Bax" }),\n          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void psPrintPurchase(p), children: "Çap (A4)" }),`);
  // Returns rows: the print button goes first in the row's action span (the
  // span's contents differ between the local and remote builds).
  {
    const table = source.indexOf('view === "returns" ? jsxRuntimeExports.jsx(OpsTable, {');
    const span = '        h("span", { className: "flex flex-wrap gap-1" },\n';
    const at = table < 0 ? -1 : source.indexOf(span, table);
    if (at < 0) throw Error('Market 1.5.47 anchor missing: returns actions');
    const button = `          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => psPrintDocA4({ title: "Geri qaytarma qaiməsi", number: r.number, date: opsWhen(r.createdAt), meta: [["Təchizatçı", r.supplierName || "—"], ["Filial", r.objectName || "—"], ["Alış qaiməsi", r.purchaseNumber || "—"]], head: ["#", "Mal", "Miqdar"], rows: (r.lines ?? []).map((l, i) => [i + 1, l.name, opsQty(l.qtyMilli) + " " + l.unit]), totals: [["Borcdan silindi", formatMoney(r.totalMinor ?? 0)]] }), children: "Çap (A4)" }),\n`;
    source = source.slice(0, at + span.length) + button + source.slice(at + span.length);
  }

  const helpers = `// POS_MARKET_WASTE_1547
function psA4Escape(v){return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function psPrintDocA4(doc){const e=psA4Escape,pairs=xs=>(xs||[]).map(([k,v])=>"<div><span>"+e(k)+"</span><b>"+e(v)+"</b></div>").join("");
 const html='<!doctype html><html><head><meta charset="utf-8"><title>'+e(doc.number||doc.title)+'</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0}h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin-bottom:12px}.meta,.totals{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;margin:10px 0}.meta div,.totals div{display:flex;justify-content:space-between;border-bottom:1px dotted #bbb;padding:2px 0}.meta span,.totals span{color:#555}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eee}.sign{display:flex;justify-content:space-between;margin-top:36px}.sign div{width:40%;border-top:1px solid #333;padding-top:4px;color:#555}</style></head><body>'
  +'<h1>'+e(doc.title)+(doc.number?' · '+e(doc.number):'')+'</h1><div class="sub">'+e(doc.date||new Date().toLocaleString("az-AZ"))+'</div><div class="meta">'+pairs(doc.meta)+'</div><table><thead><tr>'+doc.head.map(x=>'<th>'+e(x)+'</th>').join("")+'</tr></thead><tbody>'
  +doc.rows.map(r=>'<tr>'+r.map(c=>'<td>'+e(c)+'</td>').join("")+'</tr>').join("")+'</tbody></table><div class="totals">'+pairs(doc.totals)+'</div><div class="sign"><div>Təhvil verdi</div><div>Təhvil aldı</div></div></body></html>';
 void window.pos.files.savePdf((doc.number||"qaime")+".pdf",html);}
async function psPrintPurchase(p){const r=await window.pos.suppliers.purchase(p.id);if(!r.success){alert(r.error?.message||"Qaimə açılmadı");return;}const d=r.data;
 psPrintDocA4({title:"Alış qaiməsi",number:d.number,date:opsWhen(d.receivedAt||d.createdAt),meta:[["Təchizatçı",d.supplierName||"—"],["Filial",d.objectName||d.warehouseName||"—"],["Faktura",d.invoiceNo||"—"],["Qeyd",d.note||"—"]],head:["#","Mal","Miqdar","Qiymət","Cəm"],rows:(d.lines??[]).map((l,i)=>[i+1,l.name,opsQty(l.qtyMilli)+" "+l.unit,formatMoney(l.unitCostMinor??0),formatMoney(Math.round((l.unitCostMinor??0)*(l.qtyMilli??0)/1000))]),totals:[["Cəm",formatMoney(d.totalMinor??0)],["Qalan borc",formatMoney(d.dueMinor??0)]]});}
function psPrintWaste(d){psPrintDocA4({title:"Zay qaiməsi",number:d.number,date:opsWhen(d.createdAt),meta:[["Anbar",d.warehouseName||"—"],["Səbəb",d.note||"—"],["Vəziyyət",d.status==="cancelled"?"Ləğv edilib":"Aktiv"],["Yaradan",d.actorName||"—"]],head:["#","Mal","Miqdar","Maya","Cəm"],rows:(d.lines??[]).map((l,i)=>[i+1,l.name,opsQty(l.qtyMilli)+" "+l.unit,formatMoney(l.costMinor??0),formatMoney(l.totalMinor??0)]),totals:[["Cəm",formatMoney(d.totalMinor??0)]]});}
/** Alışlar → Zaylar: Zay documents (list, view, edit, delete, A4). */
function PsWasteDocs(){
 const h=psH,range=usePsRange("month"),rights=window.__psMarketRights||{};
 const [rows,setRows]=reactExports.useState([]),[detail,setDetail]=reactExports.useState(null),[edit,setEdit]=reactExports.useState(null),[goods,setGoods]=reactExports.useState([]),[busy,setBusy]=reactExports.useState(false),[error,setError]=reactExports.useState("");
 const call=(a,p)=>window.pos.business.call(a,p);
 const load=async()=>{const r=await call("waste.list",{from:range.from,to:range.to});if(r.success){setRows(r.data.documents||[]);setError("");}else setError(r.error?.message||"Zaylar alınmadı");};
 reactExports.useEffect(()=>{void load();},[range.from,range.to]);
 const get=async id=>{const r=await call("waste.get",{id});if(!r.success){setError(r.error?.message||"Qaimə açılmadı");return null;}return r.data;};
 const openEdit=async row=>{const d=await get(row.id);if(!d)return;if(!goods.length){const g=await psErp("goods.list",{warehouseId:d.warehouseId});if(g.success)setGoods(g.data?.goods||[]);}setEdit({id:d.id,number:d.number,warehouseId:d.warehouseId,note:d.note,lines:d.lines.map(l=>({ingredientId:l.ingredientId,name:l.name,unit:l.unit,qty:opsQty(l.qtyMilli)}))});};
 const save=async()=>{const lines=edit.lines.filter(l=>l.ingredientId&&opsMilli(l.qty)>0).map(l=>({ingredientId:l.ingredientId,qtyMilli:opsMilli(l.qty)}));if(!lines.length){setError("Ən azı bir mal və miqdar yazın");return;}if(!String(edit.note||"").trim()){setError("Zay səbəbini yazın");return;}
  setBusy(true);const r=await call("waste.save",{id:edit.id,lines,note:edit.note.trim()});setBusy(false);if(!r.success){setError(r.error?.message||"Saxlanılmadı");return;}setEdit(null);void load();};
 const remove=async row=>{if(!window.confirm(row.number+" silinsin? Mallar anbara qayıdır."))return;setBusy(true);const r=await call("waste.delete",{id:row.id});setBusy(false);if(!r.success){setError(r.error?.message||"Silinmədi");return;}void load();};
 const setLine=(i,patch)=>setEdit(e=>({...e,lines:e.lines.map((l,j)=>j===i?{...l,...patch}:l)}));
 const total=rows.filter(r=>r.status!=="cancelled").reduce((n,r)=>n+(r.totalMinor||0),0);
 return h("div",{className:"space-y-3"},
  h("div",{className:"flex flex-wrap items-center gap-2"},psRangeBar(range),h("span",{className:"ml-auto text-sm text-muted"},"Cəm zay: "+formatMoney(total))),
  error?h("p",{className:"ps-empty-state",role:"alert",style:{color:"var(--ps-danger)"}},error):null,
  jsxRuntimeExports.jsx(OpsTable,{head:["Qaimə","Tarix","Anbar","Mallar","Cəm","Səbəb","Vəziyyət",""],empty:"Bu dövrdə zay yoxdur",
   rows:rows.map(r=>[h("b",null,r.number),opsWhen(r.createdAt),r.warehouseName||"—",String(r.lineCount),formatMoney(r.totalMinor??0),r.note||"—",r.status==="cancelled"?"Ləğv edilib":"Aktiv",
    h("span",{className:"flex flex-wrap gap-1"},
     jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:async()=>{const d=await get(r.id);if(d)setDetail(d);},children:"Bax"}),
     jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:async()=>{const d=await get(r.id);if(d)psPrintWaste(d);},children:"Çap (A4)"}),
     r.status!=="cancelled"?jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",disabled:busy||!rights.canDocsEdit,onClick:()=>void openEdit(r),children:"Düzəliş et"}):null,
     r.status!=="cancelled"?jsxRuntimeExports.jsx(OpsButton,{tone:"danger",disabled:busy||!rights.canDocsDelete,onClick:()=>void remove(r),children:"Sil"}):null)])}),
  detail?jsxRuntimeExports.jsx(PsAdminDialog,{title:"Zay qaiməsi "+detail.number,onClose:()=>setDetail(null),busy:false,children:h("div",{className:"space-y-3"},
   h("p",{className:"text-sm text-muted"},opsWhen(detail.createdAt)+" · "+(detail.warehouseName||"")+" · "+(detail.note||"")+(detail.status==="cancelled"?" · Ləğv edilib":"")),
   jsxRuntimeExports.jsx(OpsTable,{head:["Mal","Miqdar","Maya","Cəm"],empty:"Sətir yoxdur",rows:(detail.lines||[]).map(l=>[l.name,opsQty(l.qtyMilli)+" "+l.unit,formatMoney(l.costMinor??0),formatMoney(l.totalMinor??0)])}),
   h("div",{className:"flex gap-2"},h("b",null,"Cəm: "+formatMoney(detail.totalMinor??0)),h("span",{className:"ml-auto"}),jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>psPrintWaste(detail),children:"Çap (A4)"})))}):null,
  edit?jsxRuntimeExports.jsx(PsAdminDialog,{title:"Zay qaiməsi "+edit.number+" · düzəliş",onClose:()=>setEdit(null),busy,children:h("fieldset",{disabled:busy,className:"space-y-3",style:{border:0,padding:0,margin:0,minWidth:0}},
   ...edit.lines.map((l,i)=>h("div",{key:"wl"+i,className:"flex flex-wrap items-center gap-2"},
    h("div",{style:{flex:"1 1 240px",minWidth:0}},jsxRuntimeExports.jsx(PsMarketProductPicker,{items:goods,value:l.ingredientId,onChange:id=>{const g=goods.find(x=>x.id===id);setLine(i,{ingredientId:id,name:g?.name||"",unit:g?.unit||""});}})),
    h("input",{className:psField,style:{width:120},inputMode:"decimal",value:l.qty,onChange:e=>setLine(i,{qty:e.target.value}),"aria-label":"Miqdar"}),h("span",{className:"text-sm text-muted"},l.unit||""),
    jsxRuntimeExports.jsx(OpsButton,{tone:"danger",onClick:()=>setEdit(e=>({...e,lines:e.lines.filter((_,j)=>j!==i)})),children:"×"}))),
   jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setEdit(e=>({...e,lines:[...e.lines,{ingredientId:"",name:"",unit:"",qty:""}]})),children:"+ Mal"}),
   h("input",{className:psField,placeholder:"Zay səbəbi",value:edit.note||"",onChange:e=>setEdit(x=>({...x,note:e.target.value}))}),
   h("div",{className:"flex gap-2"},jsxRuntimeExports.jsx(OpsButton,{disabled:busy,onClick:()=>void save(),children:busy?"Saxlanılır…":"Yadda saxla"}),jsxRuntimeExports.jsx(OpsButton,{tone:"quiet",onClick:()=>setEdit(null),children:"İmtina"})))}):null);
}
`;
  replace('function OpsPurchases(', helpers + '\nfunction OpsPurchases(');
  return source;
}
