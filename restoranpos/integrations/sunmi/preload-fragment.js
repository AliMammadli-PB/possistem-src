/* POSSISTEM_SUNMI_PRELOAD_v1 — copied inline: sandboxed preloads cannot require arbitrary local modules. */
let _sunmiRrnBusy=false;
async function _sunmiPreparePayment(payload,market=false,refund=false){
 const out=await electron.ipcRenderer.invoke('possistem:sunmi',{action:'get'});
 if(!out?.ok||!out.data?.config?.enabled)return payload;
 const prior=String(market?payload.reference||'':payload.rrn||'');
 if(/^\d{12}$/.test(prior))return payload;
 if(_sunmiRrnBusy)throw Error('Açıq bank RRN pəncərəsini tamamlayın.');_sunmiRrnBusy=true;
 try{return await new Promise((resolve,reject)=>{
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.style.cssText='border:1px solid #bcd0ef;border-radius:18px;padding:26px;width:min(460px,calc(100vw - 32px));box-sizing:border-box;background:#fff;color:#142b4d;font:600 15px/1.7 Montserrat,Arial,sans-serif;';
  const lang=document.documentElement.lang.slice(0,2),text=(az,ru,en,tr=az)=>({az,ru,en,tr}[lang]||az);
  const h=document.createElement('h2');h.textContent=text('Bank çekinin RRN nömrəsi','RRN банковского чека','Bank receipt RRN','Banka fişi RRN numarası');h.style.marginTop='0';
  const p=document.createElement('p');p.textContent=refund?text('Bank qaytarmasının 12 rəqəmli RRN nömrəsini yazın. Fiskal qaytarma bank geri ödənişini əvəz etmir.','Введите 12-значный RRN возврата банка. Фискальный возврат не заменяет возврат денег банком.','Enter the bank refund’s 12-digit RRN. A fiscal return does not replace the bank refund.') :text('Əvvəl bank terminalında ödənişi təsdiqləyin. Çekdəki 12 rəqəmli RRN-i daxil edin. Bu pəncərə bankdan pul çəkmir.','Сначала подтвердите оплату на банковском терминале. Введите 12-значный RRN с чека. Это окно не списывает деньги.','First approve the bank terminal payment, then enter its 12-digit RRN. This dialog does not charge the card.','Önce banka terminalinde ödemeyi onaylayın. Fişteki 12 haneli RRN kodunu girin. Bu pencere karttan para çekmez.');
  const form=document.createElement('form'),label=document.createElement('label');label.textContent='RRN';const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.maxLength=12;input.minLength=12;input.pattern='[0-9]{12}';input.required=true;input.autocomplete='off';input.style.cssText='display:block;width:100%;box-sizing:border-box;min-height:56px;margin:8px 0 20px;padding:12px;border:1px solid #96b9ee;border-radius:10px;font-size:22px;color:#142b4d;background:#f6f9ff;';input.oninput=()=>input.value=input.value.replace(/\D/g,'').slice(0,12);label.append(input);
  const cancel=document.createElement('button'),submit=document.createElement('button');cancel.type='button';cancel.textContent=text('Bağla','Закрыть','Close','Kapat');submit.type='submit';submit.textContent=text('Təsdiqlə','Подтвердить','Confirm','Onayla');for(const b of[cancel,submit])b.style.cssText='min-height:50px;padding:12px 18px;border:1px solid #bfd0e8;border-radius:10px;background:#eef4fd;color:#1457bd;font:inherit;cursor:pointer;margin-right:10px';submit.style.cssText+=';background:#155ddd;color:#fff';
  const finish=(value,error)=>{input.value='';dialog.close();dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});error?reject(error):resolve(value);};cancel.onclick=()=>finish(null,Error(text('Ödəniş təsdiqlənmədi. Bankda artıq ödənilibsə yenidən pul çəkməyin.','Оплата не подтверждена. Если банк уже списал деньги, не списывайте повторно.','Payment was not confirmed. If the bank already charged it, do not charge again.')));dialog.addEventListener('cancel',e=>{e.preventDefault();cancel.click();});
  form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;const value=input.value;finish({...payload,...(market?{reference:value}:{rrn:value})});};form.append(label,cancel,submit);dialog.append(h,p,form);document.body.append(dialog);dialog.showModal();input.focus();
 });}finally{_sunmiRrnBusy=false;}
}

async function _sunmiPrepareRefund(payload,market=false){
 const cfg=await electron.ipcRenderer.invoke('possistem:sunmi',{action:'get'});if(!cfg?.ok||!cfg.data?.config?.enabled)return payload;
 const original=await electron.ipcRenderer.invoke(market?'market:invoke':'pos:invoke',{method:market?'sale.receipt':'payments.get',payload:market?{saleId:payload.saleId}:{paymentId:payload.paymentId}});
 if(original?.success&&(market?original.data?.cardMinor>0:original.data?.method==='card'))return _sunmiPreparePayment(payload,false,true);
 return payload;
}
