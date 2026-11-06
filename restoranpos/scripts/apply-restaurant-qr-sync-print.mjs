import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The published QR menu follows the till, and a receipt waiting for its printer says so calmly.
const root = fileURLToPath(new URL('..', import.meta.url));
const patch = (file, edits) => {
  let s = fs.readFileSync(root + file, 'utf8');
  for (const [old, next] of edits) {
    if (s.includes(next)) continue;
    if (s.split(old).length !== 2) throw Error(file + ' anchor changed: ' + old.slice(0, 90));
    s = s.replace(old, () => next);
  }
  fs.writeFileSync(root + file, s);
};

// An earlier patch can drop the tail of index.js, so each edit carries its own guard.
patch('index.js', [
  ["_psQrOrders=require('./qr-orders.cjs')({native:b,identity:J,owner:ft,isTerminal:()=>Boolean(globalThis.__psLanRoute)})",
   "_psQrOrders=require('./qr-orders.cjs')({native:b,identity:J,owner:ft,isTerminal:()=>Boolean(globalThis.__psLanRoute),onStale:()=>void _psQrSync()})"],
]);
{
  let s = fs.readFileSync(root + 'index.js', 'utf8');
  if (!s.includes('/* POS_QR_MENU_SYNC */')) {
    s += `
/* POS_QR_MENU_SYNC */
let _psQrSyncBusy=false;
async function _psQrSync(){if(_psQrSyncBusy||!et)return;_psQrSyncBusy=true;try{const actor=await _psPortalActor();if(!actor)return;if(!_psQrOrders)_psQrHandle('qr.noop',{}).catch(()=>{});const r=await _psQrOrders.sync((m,p)=>et.invoke(m,p,{actor:{userId:actor.id},timeoutMs:15000}));if(r?.status==='published')L.info("qr_menu_synced");}catch(e){L.warn("qr_menu_sync_failed",{message:String(e?.message||e).slice(0,200)});}finally{_psQrSyncBusy=false;}}
setInterval(()=>void _psQrSync(),5*60000).unref();setTimeout(()=>void _psQrSync(),90000).unref();
`;
    fs.writeFileSync(root + 'index.js', s);
  }
}

const waiting = 'psAdminText("Printer qoşulu deyil. Çek növbədədir, printer qoşulanda özü çap olunacaq.","Yazıcı bağlı değil. Fiş sırada, yazıcı bağlanınca kendiliğinden basılacak.","The printer is not connected. The receipt is queued and prints when the printer is back.")';
patch('index-DAmHwBc4.js', [
  ['    else if (mine.status === "failed" || mine.status === "retrying") {\n      toast(mine.lastError || t.payment.printFail, "warning");\n    }',
   '    /* QR_SYNC_PRINT_QUEUE */ else if (mine.status === "retrying") toast(' + waiting + ', "info");\n    else if (mine.status === "failed") {\n      toast(mine.lastError || t.payment.printFail, "warning");\n    }'],
  ['    if (job.status === "failed" || job.status === "retrying") {\n      toast(job.lastError || t.payment.printFail, "warning");\n      return;\n    }',
   '    if (job.status === "retrying") { toast(' + waiting + ', "info"); return; }\n    if (job.status === "failed") {\n      toast(job.lastError || t.payment.printFail, "warning");\n      return;\n    }'],
]);
console.log('QR menu sync and calm print queue');
