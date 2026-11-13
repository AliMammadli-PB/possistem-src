/* TABLE_QR_PAYMENT_UI_V1 */
function PsTableQrPayment({orderId,onUpdated}){
 const h=psH,[open,setOpen]=reactExports.useState(false),[data,setData]=reactExports.useState(null),[status,setStatus]=reactExports.useState(null),[error,setError]=reactExports.useState(''),[busy,setBusy]=reactExports.useState(false);
 const call=async(method,payload={})=>{const r=await window.possistemTablePay?.call(method,payload);if(!r?.success)throw Error(r?.error?.message||'QR ödənişi açılmadı.');return r.data;};
 const show=async()=>{setOpen(true);setBusy(true);setError('');try{setData(await call('qr.payments.open',{orderId}));}catch(e){setError(e.message);}finally{setBusy(false)}};
 const check=async()=>{if(!data)return;try{const s=await call('qr.payments.status',{sessionId:data.sessionId});setStatus(s);setError('');onUpdated?.();}catch(e){setError(e.message)}};
 reactExports.useEffect(()=>{if(!open||!data)return;void check();const timer=setInterval(()=>void check(),5000);return()=>clearInterval(timer);},[open,data?.sessionId]);
 const stop=async()=>{setBusy(true);setError('');try{await call('qr.payments.stop',{sessionId:data?.sessionId,orderId});setOpen(false);setData(null);setStatus(null);onUpdated?.();}catch(e){setError(e.message)}finally{setBusy(false)}};
 return h(reactExports.Fragment,null,h('div',{className:'ps-table-pay-entry'},h('button',{type:'button',className:'ps-table-pay-open',onClick:()=>void show()},'QR ilə ödə')),open&&h(PsAdminDialog,{title:'Masa hesabını QR ilə ödəyin',busy,onClose:()=>setOpen(false)},
  h('div',{className:'ps-table-pay-content'},error&&h('p',{role:'alert',className:'ps-table-pay-error'},error),busy&&!data&&h('p',null,'Hesab hazırlanır…'),data&&h(reactExports.Fragment,null,
   h('p',null,data.tableLabel,' · Müştəri bu kodu telefonla oxutsun.'),h('img',{className:'ps-table-pay-code',src:data.qr,alt:'Masa hesabının ödəniş QR kodu',width:280,height:280}),
   status&&h('div',{className:'ps-table-pay-totals'},h('span',null,'Ödənilib: ',formatMoney(status.paidMinor)),h('span',null,'Qalıq: ',formatMoney(status.remainingMinor)),status.pendingMinor>0&&h('strong',null,'Bankda gözləyir: ',formatMoney(status.pendingMinor))),
   h('p',{className:'ps-table-pay-hint'},'Hamısını, bərabər payı və ya seçilən yeməkləri ödəmək olar. QR açıqkən hesab dəyişiklikləri kilidlənir. Bu pəncərəni bağlamaq QR ödənişi dayandırmır.'),
   h('div',{className:'ps-table-pay-buttons'},h('button',{disabled:busy,onClick:()=>void check()},'Nəticəni yoxla'),h('button',{disabled:busy,onClick:()=>void navigator.clipboard.writeText(data.url).catch(()=>setError('Linki kopyalamaq alınmadı.'))},'Linki kopyala'),h('button',{disabled:busy||status?.pendingMinor>0,onClick:()=>void stop()},'QR ödənişi dayandır'))),
   !busy&&!data&&h('div',{className:'ps-table-pay-buttons'},h('button',{onClick:()=>void show()},'Yenidən yoxla'),h('button',{onClick:()=>void stop()},'QR kilidini dayandır')))));
}
