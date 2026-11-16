#!/usr/bin/env node
/**
 * Parametrlər → «QR ödəniş (Epoint)»: the owner connects the restaurant's own Epoint merchant from the till
 * (qr-payments/merchant-settings.js). Main routes qr.payments.merchant / saveMerchant through the existing
 * signed table-payment runtime (copied by apply-restaurant-table-payments.mjs); saving needs settings.manage.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const MARK='/* QR_PAY_SETTINGS_1116 */';
const patch=(file,steps)=>{let s=fs.readFileSync(file,'utf8');if(s.includes(MARK))return;for(const[a,b]of steps){if(s.split(a).length!==2)throw Error('qr-merchant-1116: anchor changed in '+path.basename(file)+': '+a.slice(0,90));s=s.replace(a,()=>b);}fs.writeFileSync(file,s);};
patch(path.join(root,'index.js'),[
 ['"qr.payments.ready":{auth:!0,perm:"payment.take",timeout:6e4,idempotent:!1},','"qr.payments.ready":{auth:!0,perm:"payment.take",timeout:6e4,idempotent:!1},"qr.payments.merchant":{auth:!0,perm:"settings.manage",timeout:6e4,idempotent:!1},"qr.payments.saveMerchant":{auth:!0,perm:"settings.manage",timeout:6e4,idempotent:!1},'],
]);
fs.appendFileSync(path.join(root,'index.js'),fs.readFileSync(path.join(root,'index.js'),'utf8').includes(MARK)?'':'\n'+MARK+'\n');
patch(path.join(root,'out/preload/index.js'),[
 ['["qr.payments.ready","qr.payments.open","qr.payments.stop","qr.payments.status"].includes(method)','["qr.payments.ready","qr.payments.open","qr.payments.stop","qr.payments.status","qr.payments.merchant","qr.payments.saveMerchant"].includes(method) '+MARK],
]);
const renderer=path.join(root,'index-DAmHwBc4.js');
patch(renderer,[
 // Not next to settingsSections: apply-restaurant-qr-orders.mjs rewrites everything up to it on a re-run.
 ['function PaymentPage() {',fs.readFileSync(path.join(root,'qr-payments/merchant-settings.js'),'utf8')+'\nfunction PaymentPage() {'],
 ['icon:PsQr3dIcon,tone:"blue"}]:[]),','icon:PsQr3dIcon,tone:"blue"},{id:"qr-pay",label:"QR ödəniş",hint:"Qonaq hesabı telefonla ödəyir (Epoint)",icon:ReceiptText,tone:"green"}]:[]),'],
 ['      settingsSection === "qr-orders" && jsxRuntimeExports.jsx(PsQrSettings, {}),','      settingsSection === "qr-orders" && jsxRuntimeExports.jsx(PsQrSettings, {}),\n      settingsSection === "qr-pay" && jsxRuntimeExports.jsx(PsQrPaySettings, {}),'],
 ['"qr-orders": "qr", screen: "devices", system: "devices", updates: "updates" }[section]','"qr-orders": "qr", "qr-pay": "qr", screen: "devices", system: "devices", updates: "updates" }[section]'],
 ['    ...!psMarketMode() ? [["qr-orders", psAdminText("QR sifari\\u015Fl\\u0259r", "QR sipari\\u015Fler", "QR orders"), psAdminText("Menyu v\\u0259 masa kodlar\\u0131", "Men\\xFC ve masa kodlar\\u0131", "Menu and table codes")]] : []',
  '    ...!psMarketMode() ? [["qr-orders", psAdminText("QR sifari\\u015Fl\\u0259r", "QR sipari\\u015Fler", "QR orders"), psAdminText("Menyu v\\u0259 masa kodlar\\u0131", "Men\\xFC ve masa kodlar\\u0131", "Menu and table codes")], ["qr-pay", "QR ödəniş", "Epoint: qonaq hesabı telefonla ödəyir"]] : []'],
 ['  const images = { "qr-orders": "qr",','  const images = { "qr-orders": "qr", "qr-pay": "qr",'],
]);
