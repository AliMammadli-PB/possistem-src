"use strict";
// Mutations are checked in Electron main, never from a renderer flag. Unknown
// methods fail closed after expiry; read/export methods remain available.
function readOnly(method,p={}){
 if(method==='core.batch')return Array.isArray(p.calls)&&p.calls.every(c=>readOnly(c.method,c.payload||{}));
 if(method==='business.call')return ['context','documents','document.get','stock.snapshot.get','transfer.targets','transfer.list','transfer.get','waste.list','waste.get','market.sale.history','party.ledger','staff.list'].includes(String(p.action||''));
 if(['__session','state.get','app.state','app.ping','core.health','auth.login','auth.logout','auth.changePin','backup.create','files.saveText','files.saveBinary','files.savePdf'].includes(method))return true;
 if(method.startsWith('license.'))return true;
 return /^(get|list|search|find|status|state|snapshot|history|report|summary|totals|levels|movements|ledger|moves|returns|lowStock|valuation|expiry|suppliers|stockLoss|permissionCatalogue|checkPermission|myPermissions|listPermissions|getOverrides|roles|xReport|export|exportExcel|exportCsv|remotePeriod|readiness|catalog|categories|product|products|dashboard|stats|balance|balances|session|pending|outbox|ping|receipt|listHeld|courierReport|resolve|recent)$/.test(method.split('.').at(-1)||'')||/^reports\.(?!z$|close|create|delete)/.test(method);
}
function paid(activation,now=Date.now()){return activation?.mode==='active'&&Number(activation.validUntil)>now;}
function canInvoke(activation,method,payload){return paid(activation)||readOnly(method,payload);}
function paymentUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.hostname!=='possistem.az'||url.port||!url.pathname.startsWith('/odenis/'))throw Error('Ödəniş ünvanı etibarlı deyil');return url.toString();}
module.exports={readOnly,paid,canInvoke,paymentUrl};
