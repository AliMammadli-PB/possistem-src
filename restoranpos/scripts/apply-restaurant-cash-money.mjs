#!/usr/bin/env node
/**
 * Kassalar → card menu → Mədaxil / Məxaric. Since 1.10.16 the till could record only expenses and transfers;
 * money put in (morning change) or taken out (bank deposit) had no place. The core already books cash_in/cash_out
 * against an account (cash.movement + accountId); this wires the dialog from management/cash.jsx into OpsKassalar.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const file=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','index-DAmHwBc4.js');
let s=fs.readFileSync(file,'utf8');
const MARK='/* CASH_MONEY_1110 */';
const once=(a,b)=>{if(s.split(a).length!==2)throw Error('cash-money: anchor changed: '+a.slice(0,90));s=s.replace(a,b);};
if(!s.includes(MARK)){
 const start=s.indexOf('function OpsKassalar() {');if(start<0)throw Error('cash-money: OpsKassalar missing');
 const head=s.slice(0,start),body=s.slice(start);
 const swap=(a,b)=>{if(body.split(a).length<2)throw Error('cash-money: anchor changed: '+a.slice(0,90));return body.replace(a,b);};
 let b=body;
 b=b.replace('const [busy, run] = useOpsAction(reload);','const [busy, run] = useOpsAction(reload);\n  '+MARK+' const [psMoney, setPsMoney] = reactExports.useState(null);');
 if(!b.includes(MARK))throw Error('cash-money: busy/run anchor changed');
 const grid='onRemove:remove}),';if(!b.includes(grid))throw Error('cash-money: grid anchor changed');
 b=b.replace(grid,`onRemove:remove,onMoney:useAuthStore.getState().hasPermission("cash.manage")?(a,kind)=>setPsMoney({account:a,kind,value:"",reason:"",note:"",key:newIdempotencyKey()}):null}),`);
 const dialog='    transfer ? h(PsCashTransferDialog,';if(!b.includes(dialog))throw Error('cash-money: dialog anchor changed');
 b=b.replace(dialog,`    psMoney ? h(PsCashMoneyDialog,{form:psMoney,onChange:setPsMoney,busy,onClose:()=>setPsMoney(null),onSave:()=>{const m=psMoney;void run(window.pos.cash.movement({kind:m.kind,amountMinor:Math.round(Number(String(m.value).replace(",","."))*100),reason:m.reason,note:m.note.trim(),accountId:m.account.id},{idempotencyKey:m.key}),m.kind==="cash_in"?"Mədaxil yazıldı":"Məxaric yazıldı").then(ok=>{if(ok)setPsMoney(null);});}}) : null,\n`+dialog);
 s=head+b;fs.writeFileSync(file,s);
}
