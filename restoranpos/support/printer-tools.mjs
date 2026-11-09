// Fixed test-page adapter. It cannot print a sale, open a drawer, scan networks or change settings.
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
  need();const fresh=await list();if(!fresh.printers.some(p=>p.target===plan.target))throw Error('Seçilmiş printer artıq mövcud deyil. Yenidən seçin.');
  if(!valid())throw Error('Hesab dəyişib. Sınaq çeki göndərilmədi.');
  if(typeof api.print?.enqueue!=='function')throw Error('Printer sınağı bu tətbiqdə əlçatan deyil.');
  const job=data(await api.print.enqueue({kind:'test_page',printer:plan.target,exactTarget:true,idempotencyKey:key},{idempotencyKey:key}));
  if(!job||typeof (job.id||job.jobId)!=='string'||typeof job.status!=='string')throw Error('Printer cavabı alınmadı. Parametrlər → Printerdə növbəni yoxlayın; avtomatik təkrarlamıram.');
  return{id:job.id||job.jobId,status:job.status,lastError:job.lastError||'',printer:job.printer||plan.target};
 };
 return{printerPermissions:()=>({enabled:typeof api.print?.printers==='function'&&typeof api.print?.enqueue==='function',print:has('receipt.print')&&has('printer.manage')}),printerList:list,printerTest:test};
}
