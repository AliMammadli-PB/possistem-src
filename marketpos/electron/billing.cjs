"use strict";
// Mutations are checked in Electron main, never from a renderer flag. Unknown
// methods fail closed after expiry; read/export methods remain available.
// Closing what was opened while paid stays possible after expiry (1.5.74): the shift and its
// Z report, and fiscalising receipts of sales already made. None of these starts a sale.
const CLOSE_OUT=['cash.currentSession','cash.listRegisters','cash.closeSession','cash.zClose','reports.z','businessDay.close','fiscal.enqueue','fiscal.listPending','fiscal.updateStatus','fiscal.retry'];
function readOnly(method,p={}){
 if(CLOSE_OUT.includes(method))return true;
 if(method==='core.batch')return Array.isArray(p.calls)&&p.calls.every(c=>readOnly(c.method,c.payload||{}));
 if(method==='business.call')return ['context','documents','document.get','stock.snapshot.get','transfer.targets','transfer.list','transfer.get','waste.list','waste.get','market.sale.history','party.ledger','staff.list'].includes(String(p.action||''));
 if(['__session','state.get','app.state','app.ping','core.health','auth.login','auth.logout','auth.changePin','backup.create','files.saveText','files.saveBinary','files.savePdf'].includes(method))return true;
 if(method.startsWith('license.'))return true;
 return /^(get|list|search|find|status|state|snapshot|history|report|summary|totals|levels|movements|ledger|moves|returns|lowStock|valuation|expiry|suppliers|stockLoss|permissionCatalogue|checkPermission|myPermissions|listPermissions|getOverrides|roles|xReport|export|exportExcel|exportCsv|remotePeriod|readiness|catalog|categories|product|products|dashboard|stats|balance|balances|session|pending|outbox|ping|receipt|listHeld|courierReport|resolve|recent)$/.test(method.split('.').at(-1)||'')||/^reports\.(?!z$|close|create|delete)/.test(method);
}
// Setting the PC clock back must not stretch a paid month offline (1.5.74). Expiry is judged
// against the latest moment this till has seen, carried forward by the monotonic clock, which
// a wall-clock change does not move; the server's clock (heartbeat Date header) resets it.
// ponytail: time the PC is switched off is not counted until the next heartbeat corrects it.
const mono=()=>Number(process.hrtime.bigint()/1000000n);
let seen=0,seenMono=mono(),saved=0,store=null;
function now(){
 const t=Math.max(Date.now(),seen+(mono()-seenMono));
 seen=t;seenMono=mono();
 if(store&&seen-saved>=60000){saved=seen;try{store.write(seen);}catch{/* kept in memory */}}
 return seen;
}
/** `read` / `write` persist the latest seen moment, so a restart does not forget it. */
function bindClock(s){const v=Number(s.read())||0;if(v>seen){seen=v;seenMono=mono();}saved=seen;store=s;}
function observeServerTime(header){
 const t=Date.parse(String(header||''));
 if(!Number.isFinite(t))return;
 seen=t;seenMono=mono();saved=seen;
 try{store?.write(seen);}catch{/* kept in memory */}
}
const lastSeen=()=>seen;
function paid(activation,at=now()){return activation?.mode==='active'&&Number(activation.validUntil)>at;}
function canInvoke(activation,method,payload){return paid(activation)||readOnly(method,payload);}
function paymentUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='possistem.az'||url.port||!url.pathname.startsWith('/odenis/'))throw Error('Ödəniş ünvanı etibarlı deyil');return url.toString();}
module.exports={readOnly,paid,canInvoke,paymentUrl,now,bindClock,observeServerTime,lastSeen};
