import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../index-DAmHwBc4.js', import.meta.url));
let source = fs.readFileSync(bundle, 'utf8');
if (source.includes('/* PREPAID_DEPOSIT_1103 */')) process.exit(0);
function replace(old, next) {
  if (source.split(old).length !== 2) throw Error('Deposit anchor changed: ' + old.slice(0, 90));
  source = source.replace(old, () => next);
}

replace('const [depositInput, setDepositInput] = reactExports.useState("0.00");', `/* PREPAID_DEPOSIT_1103 */ const [depositInput, setDepositInput] = reactExports.useState("");
  const [depositMode, setDepositMode] = reactExports.useState("cash");
  const [depositRrn, setDepositRrn] = reactExports.useState("");
  const [depositConfirmed, setDepositConfirmed] = reactExports.useState(false);
  const depositLock = reactExports.useRef(false);
  const depositAttempt = reactExports.useRef(null);`);
replace('    setDepositInput(((ord.depositMinor ?? 0) / 100).toFixed(2));\n','');
const start = source.indexOf('  const saveDeposit = async () => {');
const end = source.indexOf('  const payCash = async () => {',start);
if(start<0||end<0)throw Error('Deposit save function changed');
source=source.slice(0,start)+`  const saveDeposit = async () => {
    if (!order || busy || depositLock.current || !depositConfirmed) return;
    const amountMinor = parseMoneyInput(depositInput);
    if (!amountMinor || amountMinor < 0 || (depositMode==="card"&&!/^\\d{12}$/.test(depositRrn))) {
      toast("Depozitin məbləğini və bank çekinin RRN nömrəsini yoxlayın.", "warning");
      return;
    }
    const fingerprint = [order.id,depositMode,amountMinor,depositRrn].join("/");
    if (depositAttempt.current?.fingerprint !== fingerprint)
      depositAttempt.current = {fingerprint,key:newIdempotencyKey()};
    depositLock.current=true;
    setBusy(true);
    try {
      const payload={orderId:order.id,amountMinor,isDeposit:true};
      const options={idempotencyKey:depositAttempt.current.key};
      const res=depositMode==="cash"
        ? await window.pos.payments.createCash({...payload,tenderedMinor:amountMinor},options)
        : await window.pos.payments.createCard({...payload,rrn:depositRrn},options);
      if (!res.success) { toast(res.error.message,"danger"); return; }
      setDepositConfirmed(false);
      setDepositInput("");
      setDepositRrn("");
      toast("Depozit alındı. Masa açıq qalır.", "success");
      syncedRemainingRef.current=null;
      await refresh();
    } catch(error) {
      toast(String(error?.message||error),"danger");
    } finally {
      depositLock.current=false;
      setBusy(false);
    }
  };
`+source.slice(end);
const panel = source.indexOf('        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-4 rounded-xl border border-gold/25 bg-gold/5 p-3", children: [\n          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-gold", children: t.payment.deposit })');
const panelEnd = source.indexOf('        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "mb-3 block text-sm text-muted", children: [\n          t.payment.amount,',panel);
if(panel<0||panelEnd<0)throw Error('Deposit panel changed');
source=source.slice(0,panel)+`        order.tableId ? psH("section",{className:"mb-4 rounded-xl border border-hairline bg-elevated p-3 space-y-2"},
          psH("strong",null,"Masa depoziti"),
          order.prepaidDepositMinor>0
            ? psH("p",{className:"text-sm text-muted"},"Əvvəlcədən alınıb · "+formatMoney(order.prepaidDepositMinor))
            : order.status==="closed"||order.paidMinor>0||hasUnknown ? null
            : psH(reactExports.Fragment,null,
              order.depositMinor>0 ? psH("p",{className:"text-sm text-muted"},
                "Köhnə hesab əlavəsi · "+formatMoney(order.depositMinor)+". Bu məbləğ ödənilmiş avans kimi qeydə alınmayıb.") : null,
              psH("label",{className:"block text-sm"},"Alınan məbləğ (₼)",psH("input",{className:psField,inputMode:"decimal",
                value:depositInput,placeholder:"0.00",onChange:e=>{setDepositInput(e.target.value);setDepositConfirmed(false);}})),
              psH("label",{className:"block text-sm"},"Ödəniş üsulu",psH("select",{className:psField,value:depositMode,
                onChange:e=>{setDepositMode(e.target.value);setDepositConfirmed(false);}},
                psH("option",{value:"cash"},"Nağd"),psH("option",{value:"card"},"Bank terminalı ilə kart"))),
              depositMode==="card"?psH("label",{className:"block text-sm"},
                "Əvvəl bank terminalında ödənişi qəbul edin. Çekdəki 12 rəqəmli RRN-i yazın.",
                psH("input",{className:psField,inputMode:"numeric",maxLength:12,autoComplete:"off",value:depositRrn,
                  onChange:e=>{setDepositRrn(e.target.value.replace(/[^0-9]/g,""));setDepositConfirmed(false);}})):null,
              psH("label",{className:"flex items-center gap-2 text-sm"},psH("input",{type:"checkbox",checked:depositConfirmed,
                onChange:e=>setDepositConfirmed(e.target.checked)}),"Məbləği müştəridən aldım"),
              psH("button",{type:"button",className:"ps-ops-button",disabled:busy||!depositConfirmed,
                onClick:()=>void saveDeposit()},"Depoziti qeydə al"))) : null,
`+source.slice(panelEnd);
replace('order.depositMinor > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(Row$1, { label: t.payment.deposit, minor: order.depositMinor }),',`order.depositMinor > 0 && jsxRuntimeExports.jsx(Row$1,{label:"Köhnə depozit əlavəsi",minor:order.depositMinor}),
          order.minimumTableMinor > 0 && jsxRuntimeExports.jsx(Row$1,{label:"Minimum masa fərqi",minor:order.minimumTableMinor}),`);
replace('(order.depositMinor ?? 0) > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between", children: [', '(order.minimumTableMinor || order.depositMinor || 0) > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between", children: [');
replace('children: t.payment.deposit }),\n            /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(MoneyText, { minor: order.depositMinor ?? 0,', 'children: order.minimumTableMinor ? "Minimum masa fərqi" : "Köhnə depozit əlavəsi" }),\n            /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(MoneyText, { minor: order.minimumTableMinor || order.depositMinor || 0,');
fs.writeFileSync(bundle, source);
