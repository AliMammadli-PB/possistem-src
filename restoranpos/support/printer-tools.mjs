// Fixed test-page adapter: lists printers, finds network Xprinters, prints a test page and, once confirmed, sets the receipt printer.
// It cannot print a sale or open a drawer.
export function createPrinterTools(api,has){
 const need=()=>{if(!has('receipt.print')||!has('printer.manage'))throw Error('Printer sınağı üçün printer idarəsi və çap icazəsi lazımdır.');};
 const data=r=>{if(!r?.success)throw Error(r?.error?.message||'Printer məlumatı alınmadı.');return r.data;};
 const virtual=name=>/^(?:auto|virtual|spool|offline|pdf|none|disabled)(?::|$)/i.test(name)||/microsoft print to pdf|onenote|xps document/i.test(name);
 const list=async()=>{
  need();if(typeof api.print?.printers!=='function')throw Error('Printer bağlantısı üçün NEWEST-i tam bağlayıb açın.');
  const result=data(await api.print.printers());if(!Array.isArray(result?.printers))throw Error('Printer siyahısı alınmadı.');
  const targets=result.printers.map(p=>typeof p==='string'?p:p.name||p.target).filter(p=>typeof p==='string'&&p&&!virtual(p));
  const current=typeof result.receipt==='string'?result.receipt:'';if(current&&!virtual(current))targets.push(current);
  return{current,printers:[...new Set(targets)].map(target=>({target,name:target}))};
 };
 const test=async(plan,key,valid=()=>true)=>{
  need();const fresh=await list();const found=/^tcp:\d{1,3}(?:\.\d{1,3}){3}:9100$/.test(String(plan.target));if(!found&&!fresh.printers.some(p=>p.target===plan.target))throw Error('Seçilmiş printer artıq mövcud deyil. Yenidən seçin.');
  if(!valid())throw Error('Hesab dəyişib. Sınaq çeki göndərilmədi.');
  if(typeof api.print?.enqueue!=='function')throw Error('Printer sınağı bu tətbiqdə əlçatan deyil.');
  const job=data(await api.print.enqueue({kind:'test_page',printer:plan.target,exactTarget:true,idempotencyKey:key},{idempotencyKey:key}));
  if(!job||typeof (job.id||job.jobId)!=='string'||typeof job.status!=='string')throw Error('Printer cavabı alınmadı. Parametrlər → Printerdə növbəni yoxlayın; avtomatik təkrarlamıram.');
  return{id:job.id||job.jobId,status:job.status,lastError:job.lastError||'',printer:job.printer||plan.target};
 };
 // Network Xprinters answer the till's UDP search; a USB printer must be installed in Windows to be listed at all.
 const discover=async()=>{need();const net=globalThis.posPrinterNetwork;if(typeof net?.call!=='function')throw Error('Şəbəkədə printer axtarmaq üçün Restoran POS-u yeniləyin.');
  const r=data(await net.call('print.xprinterDiscover',{}));const devices=Array.isArray(r?.devices)?r.devices:[];
  return{printers:[...new Set(devices.map(d=>d?.ip).filter(ip=>/^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(ip))))].map(ip=>({target:`tcp:${ip}:9100`,name:`tcp:${ip}:9100`}))};};
 const use=async(target,key)=>{need();if(typeof api.settings?.set!=='function')throw Error('Printer ayarı bu tətbiqdə dəyişdirilə bilmir.');data(await api.settings.set('printer.receipt',String(target)));return{target:String(target)};};
 return{printerPermissions:()=>({enabled:typeof api.print?.printers==='function'&&typeof api.print?.enqueue==='function',print:has('receipt.print')&&has('printer.manage')}),printerList:list,printerTest:test,printerDiscover:discover,printerUse:use};
}
