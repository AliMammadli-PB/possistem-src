import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
if (source.includes('/* FINANCIAL_DOCUMENTS_1103 */')) process.exit(0);

function editFunction(name, marker, update) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw Error('Missing renderer function ' + name);
  const previous = source.slice(start, end + 2);
  if (previous.includes(marker)) return;
  const next = update(previous);
  if (next === previous) throw Error('Unchanged renderer function ' + name);
  source = source.slice(0, start) + next + source.slice(end + 2);
}
function replace(source, old, next) {
  if (!source.includes(old)) throw Error('Renderer anchor changed: ' + old.slice(0, 90));
  return source.replace(old, () => next);
}

editFunction('PsOriginalSalary', 'ps:salary-document-changed', (s) => {
  s = replace(s, '  const [open, setOpen] = reactExports.useState(null);\n', '');
  s = replace(s, 'reactExports.useEffect(() => { void reload(); }, [reload]);', `reactExports.useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener("ps:salary-document-changed", refresh);
    return () => window.removeEventListener("ps:salary-document-changed", refresh);
  }, [reload]);`);
  s = replace(s, 'if (ok) setAsk(null);', 'if (ok) { setAsk(null); window.dispatchEvent(new Event("ps:salary-document-changed")); }');
  const buttons = s.indexOf(',\n          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setAsk({ row: r, kind: "note"');
  const end = s.indexOf('\n      ])', buttons);
  const history = s.indexOf('    open ? (() => {', end);
  const dialog = s.indexOf('    ask ? jsxRuntimeExports.jsx(PsAdminDialog,', history);
  if (Math.min(buttons, end, history, dialog) < 0) throw Error('Salary anchors changed');
  return s.slice(0, buttons) + ')' + s.slice(end, history) + s.slice(dialog);
});

editFunction('OpsExpenses', 'setVoidExpense', s => {
  s = replace(s, 'const [expenseConfirm,expenseConfirmDialog]=useConfirm(); /* POS_EXPENSE_CANCEL_v1 */', 'const [voidExpense,setVoidExpense]=reactExports.useState(null); /* POS_EXPENSE_CANCEL_v1 */');
  const start = s.indexOf('onClick:async()=>{if(!await expenseConfirm(');
  const end = s.indexOf('})])', start);
  if (start < 0 || end < 0) throw Error('Expense void anchor changed');
  s = s.slice(0, start) + 'onClick:()=>setVoidExpense({...m,type:"expense"}),children:"Ləğv et"' + s.slice(end);
  return replace(s, '    expenseConfirmDialog,', '    voidExpense ? psH(PsDocumentVoid1103,{row:voidExpense,onClose:()=>setVoidExpense(null),onSaved:reload}) : null,');
});

editFunction('PsDeliveryDispatch', 'c.dueMinor', s => {
  s = replace(s, '  const [newName, setNewName] = reactExports.useState("");\n', '');
  const start = s.indexOf('  const addCourier = async () => {');
  const end = s.indexOf('  const go = async () => {', start);
  if (start < 0 || end < 0) throw Error('Courier creation anchor changed');
  s = s.slice(0, start) + s.slice(end);
  const controls = s.indexOf('    h("div", { className: "flex items-end gap-2" },');
  const modes = s.indexOf('    h("div", { className: "ps-delivery-modes" },', controls);
  if (controls < 0 || modes < 0) throw Error('Courier selector anchor changed');
  s = s.slice(0, controls) + s.slice(modes);
  s = replace(s, 'Kuryer yoxdur — aşağıda əlavə edin', 'Aktiv kuryer yoxdur. Çatdırılma → Kuryerlər bölməsindən əlavə edin.');
  s = replace(s, 'c.name + (c.openCount ? " · " + c.openCount + " yolda" : "")', 'c.name + " · " + (c.openCount || 0) + " yolda · " + formatMoney(c.dueMinor || 0) + " borc"');
  return replace(s, 'disabled: busy, onClick: () => void go()', 'disabled: busy || !courierId, onClick: () => void go()');
});

editFunction('PsDocumentEdit', 'toAccountId:row.toAccountId', s => {
  s = replace(s, 'accountId:row.accountId||"",note:', 'accountId:row.accountId||"",toAccountId:row.toAccountId||"",note:');
  s = replace(s, 'accountId:form.accountId,note:', 'accountId:form.accountId,toAccountId:form.toAccountId,note:');
  s = replace(s, 'h("label",null,psBizText(lang,"Tarix və saat"', 'row.type==="cash-transfer"?null:h("label",null,psBizText(lang,"Tarix və saat"');
  return replace(s, 'label:psBizText(lang,"Kassa / xəzinə","Kasa / hazine","Till / treasury")}),h("p"', `label:row.type==="cash-transfer"?"Göndərən kassa":psBizText(lang,"Kassa / xəzinə","Kasa / hazine","Till / treasury")}),
    row.type==="cash-transfer"?h(PsAccountSelect,{value:form.toAccountId,onChange:v=>setForm({...form,toAccountId:v||""}),label:"Qəbul edən kassa"}):null,h("p"`);
});

editFunction('PsDocuments', 'FINANCIAL_DOCUMENTS_1103', s => {
  s = replace(s, '{partyId,partyType}', '{partyId,partyType,onChanged,defaultType=""}');
  s = replace(s, 'const h=psH,{lang}=useI18n(),rg=usePsRange("day"),', '/* FINANCIAL_DOCUMENTS_1103 */ const h=psH,{lang}=useI18n(),rg=usePsRange(partyType==="salary"?"month":"day"),');
  s = replace(s, '[type,setType]=reactExports.useState("")', '[type,setType]=reactExports.useState(defaultType),[detail,setDetail]=reactExports.useState(null),[voidRow,setVoidRow]=reactExports.useState(null)');
  s = replace(s, 'reactExports.useEffect(()=>{void reload();},[reload]);', `reactExports.useEffect(()=>{
    void reload();
    const refresh = () => void reload();
    if (partyType==="salary") window.addEventListener("ps:salary-document-changed", refresh);
    return () => window.removeEventListener("ps:salary-document-changed", refresh);
  },[reload,partyType]);
  const saved = async () => {
    if (partyType==="salary") window.dispatchEvent(new Event("ps:salary-document-changed"));
    else await reload();
    if(onChanged) await onChanged();
  };`);
  s = replace(s, '["salary","Maaş","Maaş","Salary"]];', '["salary","Maaş","Maaş","Salary"],["income","Qazanc","Gelir","Income"],["courier","Kuryer ödənişi","Kurye ödemesi","Courier remittance"],["cash-transfer","Kassa köçürməsi","Kasa transferi","Cash transfer"]];');
  s = replace(s, 'r.accountId===account)', 'r.accountId===account||r.toAccountId===account)');
  s = replace(s, '[r.name,r.note,r.id]', '[r.name,r.note,r.id,r.number]');
  s = replace(s, 'const canEdit=r=>has(', 'const canEdit=r=>!r.cancelled&&!["income","courier"].includes(r.type)&&has(r.type==="cash-transfer"?"cash.accounts":');
  const start = s.indexOf('formatMoney(r.amountMinor),r.note||"—",canEdit(r)?');
  const end = s.indexOf('])}),\n', start);
  if (start < 0 || end < 0) throw Error('Document table anchor changed');
  s = s.slice(0, start) + `formatMoney(r.cancelled?r.originalAmountMinor:r.amountMinor),
    r.cancelled ? "Ləğv edilib · " + (r.cancelReason || "") : r.note||"—",
    h("div",{className:"flex flex-wrap gap-1"},
      h(OpsButton,{tone:"quiet",onClick:()=>setDetail(r),children:"Bax"}),
      canEdit(r)?h(OpsButton,{tone:"quiet",onClick:()=>setEdit(r),children:"Düzəliş et"}):null,
      canEdit(r)?h(OpsButton,{tone:"danger",onClick:()=>setVoidRow(r),children:"Ləğv et"}):null)` + s.slice(end);
  return replace(s, 'onSaved:reload}):null);', `onSaved:saved}):null,
    detail?h(PsDocumentDetail1103,{row:detail,onClose:()=>setDetail(null)}):null,
    voidRow?h(PsDocumentVoid1103,{row:voidRow,onClose:()=>setVoidRow(null),onSaved:saved}):null);`);
});
if (!source.includes('function PsDocumentVoid1103(')) source = replace(source, 'function psBizDate(ms)', `function PsDocumentDetail1103({row,onClose}) {
  const h=psH;
  const [detail,setDetail]=reactExports.useState(null),[error,setError]=reactExports.useState("");
  reactExports.useEffect(()=>{
    let live=true;
    void psBusinessCall("document.get",{type:row.type,id:row.id}).then(r=>{
      if(live) r.success?setDetail(r.data.document):setError(r.error.message);
    }).catch(e=>{if(live)setError(String(e.message||e));});
    return()=>{live=false;};
  },[row.type,row.id]);
  const pairs=detail?[
    ["Nömrə",detail.number||detail.id],["Ad / səbəb",detail.courierName||detail.reason||row.name],
    ["Tarix və saat",opsWhen(detail.doc_at||detail.created_at||row.createdAt)],
    ["Məbləğ",formatMoney(detail.cancellation?.originalAmountMinor??detail.amount_minor??row.amountMinor)],
    ["Kassa",detail.accountName],["Qəbul edən kassa",detail.toAccountName],["İşçi",detail.userName],["Qeyd",detail.note],
    ["Ləğv səbəbi",detail.cancellation?.reason],["Ləğv vaxtı",detail.cancellation?.voidedAt?opsWhen(detail.cancellation.voidedAt):null]
  ].filter(([,value])=>value!=null&&value!==""):[];
  return h(PsAdminDialog,{title:"Qaimə",onClose,children:error?h("p",{role:"alert"},error):
    detail?h("dl",{className:"ps-business-invoice"},pairs.map(([key,value])=>h(reactExports.Fragment,{key},h("dt",null,key),h("dd",null,value)))):
    h("p",{role:"status"},"Yüklənir…")});
}

function PsDocumentVoid1103({row,onClose,onSaved}) {
  const h=psH;
  const [reason,setReason]=reactExports.useState(""),[error,setError]=reactExports.useState(""),[busy,setBusy]=reactExports.useState(false);
  const lock=reactExports.useRef(false),key=reactExports.useRef(null);
  const cancel=async(event)=>{
    event.preventDefault();
    if(lock.current||!reason.trim())return;
    if(!key.current)key.current=newIdempotencyKey();
    lock.current=true;setBusy(true);setError("");
    try{
      const r=await psBusinessCall("correct",{type:row.type,id:row.id,cancel:true,note:reason.trim()},key.current);
      if(!r.success){setError(r.error.message);return;}
      await onSaved();onClose();
    }catch(e){setError(String(e.message||e));}
    finally{lock.current=false;setBusy(false);}
  };
  return h(PsAdminDialog,{title:"Qaiməni ləğv et",onClose,busy,children:h("form",{className:"space-y-3",onSubmit:cancel},
    h("p",null,[row.name||row.id,formatMoney(row.amountMinor)].join(" · ")),
    h("label",{className:"block"},"Ləğv səbəbi",h("textarea",{className:psField,required:true,maxLength:1000,value:reason,
      disabled:busy,onChange:e=>{key.current=null;setReason(e.target.value);}})),
    error?h("p",{role:"alert",className:"text-danger"},error):null,
    h("button",{type:"submit",className:"ps-ops-button",disabled:busy||!reason.trim()},busy?"Ləğv edilir…":"Ləğvi təsdiqlə"))});
}

function psBizDate(ms)`);

editFunction('OpsKassalar', 'setShowTransferDocs', s => {
  const start=s.indexOf('  const objectsLoaded = Boolean(data);');
  const end=s.indexOf('  const [busy, run]',start);
  if(start<0||end<0)throw Error('Cash branch anchor changed');
  s=s.slice(0,start)+s.slice(end);
  s=replace(s,'  const [transfer, setTransfer]', '  const [showTransferDocs, setShowTransferDocs] = reactExports.useState(false);\n  const [transfer, setTransfer]');
  return replace(s,'  return h("div", { className: "space-y-4" },',`  return h("div", { className: "space-y-4" },
    !psMarketMode()?h(OpsButton,{tone:"quiet",onClick:()=>setShowTransferDocs(!showTransferDocs),children:showTransferDocs?"Köçürmə qaimələrini gizlət":"Köçürmə qaimələri"}):null,
    showTransferDocs?h(PsDocuments,{partyType:"cash-transfer",defaultType:"cash-transfer",onChanged:reload}):null,`);
});
fs.writeFileSync(bundle, source);
