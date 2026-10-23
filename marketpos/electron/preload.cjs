const { contextBridge, ipcRenderer } = require('electron');


// A one-operation credential prompt. Main always verifies the current signed
// manager or superadmin record; the dialog never decides permission.
let approvalOpen = false;
const pendingProtected = new Map();
function invokeWithApproval(channel, input) {
  const key = channel + ':' + JSON.stringify(input);
  if (pendingProtected.has(key)) return pendingProtected.get(key);
  const task = (async () => {
    const initial = await ipcRenderer.invoke(channel, input);
    if (!['E_MANAGER_REQUIRED','E_SUPERADMIN_REQUIRED'].includes(initial?.error?.code)) return initial;
    const policyOnly=channel==='market:permissions:save';
    if (approvalOpen) return {success:false,error:{code:'E_APPROVAL_BUSY',message:'Açıq təsdiq pəncərəsini tamamlayın'}};
    approvalOpen = true;
    const previous = document.activeElement;
    const lang = (document.documentElement.lang || 'az').slice(0,2);
    const text = (az,ru,en) => lang === 'ru' ? ru : lang === 'en' ? en : az;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', text('Müdir təsdiqi','Подтверждение руководителя','Manager approval'));
    dialog.style.cssText = 'border:1px solid #b8ccec;border-radius:20px;padding:28px;width:min(440px,calc(100vw - 40px));box-sizing:border-box;background:#fff;color:#142540;font-family:Montserrat,Arial,sans-serif;box-shadow:0 24px 90px #10203e66;';
    const title = document.createElement('h2'); title.textContent = text('Müdir təsdiqi','Подтверждение руководителя','Manager approval'); title.style.cssText='font-size:22px;margin:0 0 12px';
    const hint = document.createElement('p'); hint.textContent = policyOnly ? text('İcazə ayarlarının dəyişməsini idarəçi kodu ilə təsdiqləyin.','Подтвердите изменение прав кодом администратора.','Confirm permission changes with the administrator code.') : text('Silmə, ləğv və qaytarma üçün müdir kodunu daxil edin.','Введите код руководителя для удаления, отмены или возврата.','Enter the manager code to delete, cancel or refund.'); hint.style.cssText='font-size:14px;line-height:1.6';
    const form = document.createElement('form');
    const label = document.createElement('label'); label.textContent = text('Müdir kodu','Код руководителя','Manager code');
    const pin = document.createElement('input'); pin.type='password'; pin.inputMode='numeric'; pin.maxLength=10; pin.autocomplete='off'; pin.required=true; pin.pattern=policyOnly?'[0-9]{10}':'([0-9]{4,8}|[0-9]{10})'; pin.setAttribute('aria-label', label.textContent); pin.style.cssText='display:block;width:100%;box-sizing:border-box;min-height:56px;margin:10px 0;font-size:24px;letter-spacing:6px;border:1px solid #87a7d8;border-radius:10px;padding:10px;color:#142540;background:#f6f9ff;';
    pin.addEventListener('input',()=>{pin.value=pin.value.replace(/\D/g,'').slice(0,10);}); label.append(pin);
    const error = document.createElement('p'); error.setAttribute('role','alert'); error.style.cssText='color:#b42318;font-size:14px;min-height:20px';
    const actions = document.createElement('div'); actions.style.cssText='display:flex;gap:12px;margin-top:16px';
    const cancel = document.createElement('button'); cancel.type='button';cancel.textContent=text('Bağla','Закрыть','Close');
    const submit = document.createElement('button');submit.type='submit';submit.textContent=text('Təsdiqlə','Подтвердить','Confirm');
    for(const button of [cancel,submit])button.style.cssText='min-height:52px;padding:12px 20px;flex:1;border:1px solid #c6d5eb;border-radius:10px;font:700 15px Montserrat,Arial,sans-serif;cursor:pointer;background:#eef4ff;color:#16325d;';
    submit.style.background='#145ce0';submit.style.color='#fff';
    actions.append(cancel,submit);form.append(label,error,actions);dialog.append(title,hint,form);document.body.append(dialog);dialog.showModal();pin.focus();
    return await new Promise(resolve => {
      let running=false,finished=false;
      const finish = result => {if(finished)return;finished=true;pin.value='';dialog.close();dialog.remove();approvalOpen=false;if(previous?.isConnected)previous.focus();resolve(result);};
      const close = () => finish({success:false,error:{code:'E_APPROVAL_CANCELLED',message:text('Əməliyyat təsdiqlənmədi','Операция не подтверждена','Operation was not approved')}});
      cancel.onclick=()=>{if(!running)close();};
      dialog.addEventListener('cancel',event=>{event.preventDefault();if(!running)close();});
      form.onsubmit=async event=>{event.preventDefault();if(running||!form.reportValidity())return;running=true;submit.disabled=true;cancel.disabled=true;error.textContent='';
        try {const result=await ipcRenderer.invoke(channel,{...input,...(policyOnly?{superAdminPin:pin.value}:{managerPin:pin.value})});pin.value='';
          if(['E_MANAGER_REQUIRED','E_SUPERADMIN_REQUIRED'].includes(result?.error?.code)){error.textContent=result.error.message;pin.focus();}
          else finish(result);
        }catch(err){error.textContent=String(err?.message||err).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');pin.value='';pin.focus();}
        finally{running=false;submit.disabled=false;cancel.disabled=false;}
      };
    });
  })().finally(()=>pendingProtected.delete(key));
  pendingProtected.set(key,task);return task;
}

const branchResult=promise=>promise.catch(error=>{const message=String(error?.message||error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');throw new Error(/internal server error/i.test(message)?'Filial xidməti hazırda cavab vermir. Məlumatları yeniləyin.':message);});

contextBridge.exposeInMainWorld('marketSystem', {
  branches: {selection:sessionToken=>branchResult(ipcRenderer.invoke("market:branches:selection",{sessionToken})),manage:(sessionToken,operation)=>branchResult(ipcRenderer.invoke('market:branches:manage',{sessionToken,operation})),assign:(sessionToken,deviceId,name)=>branchResult(ipcRenderer.invoke('market:branches:assign',{sessionToken,deviceId,name})),list:(sessionToken)=>branchResult(ipcRenderer.invoke('market:branches:list',{sessionToken})),rpc:async(sessionToken,deviceId,calls)=>{const result=await invokeWithApproval('market:branches:rpc',{sessionToken,deviceId,calls});if(result?.success===false)throw Error(result.error?.message||'Əməliyyat alınmadı');return result;},stock:(sessionToken)=>ipcRenderer.invoke('market:branches:stock',{sessionToken}),queueEdits:(sessionToken,deviceId,requestId,edits,note)=>branchResult(ipcRenderer.invoke('market:branches:queueEdits',{sessionToken,deviceId,requestId,edits,note})),edits:(sessionToken,deviceId)=>branchResult(ipcRenderer.invoke('market:branches:edits',{sessionToken,deviceId})),cancelEdit:(sessionToken,id)=>branchResult(ipcRenderer.invoke('market:branches:cancelEdit',{sessionToken,id}))},
  branchContext: (sessionToken) => ipcRenderer.invoke('market:branch:context', { sessionToken }),
  staff: {
    list: () => ipcRenderer.invoke('market:staff:list'),
    save: async (sessionToken, profile, pin) => {const res=await invokeWithApproval('market:staff:save', {sessionToken,profile,pin});if(res?.success===false)throw Error(res.error?.message||'İstifadəçi saxlanmadı');return res;},
    remove: async (sessionToken, id) => { const res = await invokeWithApproval('market:staff:delete', { sessionToken, id }); if (res?.success === false) throw new Error(res.error?.message || 'Əməliyyat alınmadı'); return res; },
    places: (sessionToken) => ipcRenderer.invoke('market:staff:places', { sessionToken }),
  },
  permissions: {
    get: (sessionToken) => ipcRenderer.invoke('market:permissions:get', {sessionToken}),
    save: async (sessionToken, role, permissions, expectedVersion) => {const result = await invokeWithApproval('market:permissions:save', {sessionToken,role,permissions,expectedVersion}); if(result?.success === false)throw new Error(result.error?.message || 'İcazələr saxlanmadı'); return result;},
  },
  auth: {
    login: (userId, pin) => ipcRenderer.invoke('market:auth:login', { userId, pin }),
    adminPrefix: (digits) => ipcRenderer.invoke('market:auth:adminPrefix', digits),
    changePin: (sessionToken, newPin) => ipcRenderer.invoke('market:auth:changePin', { sessionToken, newPin }),
    logout: (sessionToken) => ipcRenderer.invoke('market:auth:logout', sessionToken),
    /** Session restored after a restart, or null when nobody is signed in. */
    current: () => ipcRenderer.invoke('market:auth:current'),
    /** Permission keys a user holds (default: the signed-in one). */
    rights: (sessionToken, userId) => ipcRenderer.invoke('market:auth:rights', { sessionToken, userId }),
  },
  support: {
    request: (sessionToken, message) =>
      ipcRenderer.invoke('market:support:request', { sessionToken, message }),
    thread: (sessionToken) => ipcRenderer.invoke('market:support:thread', { sessionToken }),
    /** Downloads an attachment then asks the OS to open it. */
    download: (sessionToken, attachmentId, fileName) =>
      ipcRenderer.invoke('market:support:download', { sessionToken, attachmentId, fileName }),
  },
  backup: {
    status: () => ipcRenderer.invoke('market:backup:status'),
    configure: (sessionToken, directory, password) => ipcRenderer.invoke('market:backup:configure', { sessionToken, directory, password }),
    create: (sessionToken, reason) => ipcRenderer.invoke('market:backup:create', { sessionToken, reason }),
    list: () => ipcRenderer.invoke('market:backup:list'),
    restore: (sessionToken, file, password) => ipcRenderer.invoke('market:backup:restore', { sessionToken, file, password }),
  },
  display: {
    get: () => ipcRenderer.invoke('market:display:get'),
    set: (sessionToken, prefs) => ipcRenderer.invoke('market:display:set', { sessionToken, ...prefs }),
    toggleFullscreen: () => ipcRenderer.invoke('market:display:toggle'),
  },
  image: { pick: (sessionToken) => ipcRenderer.invoke('market:image:pick', sessionToken) },
  scale: {
    get: (sessionToken) => ipcRenderer.invoke('market:scale:get', { sessionToken }),
    set: (sessionToken, cfg) => ipcRenderer.invoke('market:scale:set', { sessionToken, ...cfg }),
    scan: (sessionToken) => ipcRenderer.invoke('market:scale:scan', { sessionToken }),
    send: (sessionToken) => ipcRenderer.invoke('market:scale:send', { sessionToken }),
    test: (sessionToken) => ipcRenderer.invoke('market:scale:test', { sessionToken }),
    diagnose: (sessionToken) => ipcRenderer.invoke('market:scale:diagnose', { sessionToken }),
  },
  activation: {
    status: () => ipcRenderer.invoke('market:activation:status'),
    refresh: () => ipcRenderer.invoke('market:activation:refresh'),
    activate: (sessionToken, activationKey) => ipcRenderer.invoke('market:activation:activate', { sessionToken, activationKey }),
  },
  support: {
    active: () => ipcRenderer.invoke('market:support:active'),
    send: (ticketId, body) => ipcRenderer.invoke('market:support:send', { ticketId, body }),
    messages: (ticketId, after) => ipcRenderer.invoke('market:support:messages', { ticketId, after }),
    /** 1.5.64: a file support attached to the chat; images come back as a data URL, `open` opens it. */
    file: (attachmentId, fileName, mimeType, open = false) => ipcRenderer.invoke('market:support:file', { attachmentId, fileName, mimeType, open }),
  },
  tenant: {
    status: () => ipcRenderer.invoke('market:tenant:status'),
    login: (email, password) => ipcRenderer.invoke('market:tenant:login', { email, password }),
    logout: () => ipcRenderer.invoke('market:tenant:logout'),
  },
  update: {
    status: () => ipcRenderer.invoke('market:update:status'),
    check: (sessionToken) => ipcRenderer.invoke('market:update:check', sessionToken),
    install: (sessionToken) => ipcRenderer.invoke('market:update:install', sessionToken),
    onChanged: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('market:update:changed', listener); return () => ipcRenderer.removeListener('market:update:changed', listener); },
  },
  sync: {
    push: (sessionToken, snapshot, books) => ipcRenderer.invoke('market:sync:push', { sessionToken, snapshot, books }),
    status: () => ipcRenderer.invoke('market:sync:status'),
    bootstrap: (sessionToken) => ipcRenderer.invoke('market:sync:bootstrap', { sessionToken }),
    onChanged: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('market:sync:changed', listener); return () => ipcRenderer.removeListener('market:sync:changed', listener); },
  },
  app: { info: () => ipcRenderer.invoke('market:app:info') },
  printer: {
    list: () => ipcRenderer.invoke('market:printer:list'),
    health: () => ipcRenderer.invoke('market:printer:health'),
    test: (sessionToken, widthMm) => ipcRenderer.invoke('market:printer:test', { sessionToken, widthMm }),
    receipt: (sessionToken, receipt, widthMm) => ipcRenderer.invoke('market:printer:receipt', { sessionToken, receipt, widthMm }),
    station: (sessionToken, target, ticket, widthMm) => ipcRenderer.invoke('market:printer:station', { sessionToken, target, ticket, widthMm }),
    detect: (sessionToken, probe) => ipcRenderer.invoke('market:printer:detect', { sessionToken, probe }),
    report: (sessionToken, report, widthMm) => ipcRenderer.invoke('market:printer:report', { sessionToken, report, widthMm }),
    configure: (sessionToken, target) => ipcRenderer.invoke('market:printer:configure', { sessionToken, target }),
    label: (sessionToken, product, count, operationId, lang) => ipcRenderer.invoke('market:printer:label', { sessionToken, product, count, operationId, lang }),
    setTarget: (sessionToken, target) => ipcRenderer.invoke('market:printer:setTarget', { sessionToken, target }),
  },
  labels: {
    config: (sessionToken) => ipcRenderer.invoke('market:label:config', { sessionToken }),
    save: (sessionToken, profile) => ipcRenderer.invoke('market:label:save', { sessionToken, profile }),
    discover: (sessionToken, network) => ipcRenderer.invoke('market:label:discover', { sessionToken, network }),
    products: (sessionToken) => ipcRenderer.invoke('market:label:products', { sessionToken }),
    generate: (sessionToken, productId, options) => ipcRenderer.invoke('market:label:generate', { sessionToken, productId, options }),
    preview: (sessionToken, productId, profile, lang) => ipcRenderer.invoke('market:label:preview', { sessionToken, productId, profile, lang }),
    print: (sessionToken, request) => ipcRenderer.invoke('market:label:print', { ...request, sessionToken }),
    driver: (sessionToken, vendor) => ipcRenderer.invoke('market:label:driver', { sessionToken, vendor }),
  },
  // Only intent crosses the bridge: who is asking comes from the session in main,
  // and a manager PIN is checked there as part of the privileged operation.
  drawer: {
    open: (sessionToken, options) => ipcRenderer.invoke('market:drawer:open', {
      sessionToken,
      reason: typeof options?.reason === 'string' ? options.reason : 'manual',
      managerPin: typeof options?.managerPin === 'string' ? options.managerPin : undefined,
    }),
  },
  terminal: {
    pay: async (sessionToken, payload) => ipcRenderer.invoke('market:terminal:pay', {sessionToken,...await _sunmiPreparePayment(payload||{},true)}),
  },
  fiscal: {
    processPending: (sessionToken) => ipcRenderer.invoke('market:fiscal:processPending', { sessionToken }),
  },
});

/** Əməliyyatlar (warehouse system) for the embedded screens; main checks the session. */
contextBridge.exposeInMainWorld('marketOps', {
  invoke: (input) => invokeWithApproval('market:ops:invoke', input),
  categories: () => ipcRenderer.invoke('market:ops:categories'),
  status: () => ipcRenderer.invoke('market:ops:status'),
  setHost: (sessionToken, host) => ipcRenderer.invoke('market:ops:setHost', { sessionToken, host }),
  sync: (sessionToken) => ipcRenderer.invoke('market:ops:sync', { sessionToken }),
  cashSummary: (sessionToken) => ipcRenderer.invoke('market:ops:cashSummary', { sessionToken }),
});

contextBridge.exposeInMainWorld('marketCore', {
  /**
   * `options.managerPin` is what the override dialog collected. It is verified
   * in main; the renderer never decides who approved anything.
   */
  invoke: async (method, payload, options) => invokeWithApproval('market:invoke', { method, payload: ['sale.refund','return.partial'].includes(method)?await _sunmiPrepareRefund(payload||{},true):payload, timeoutMs: options?.timeoutMs, sessionToken: options?.sessionToken || payload?.sessionToken, managerPin: options?.managerPin }),
  status: () => ipcRenderer.invoke('market:coreStatus:get'),
  restart: (sessionToken) => ipcRenderer.invoke('market:coreRestart', { sessionToken }),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('market:coreStatus', listener);
    return () => ipcRenderer.removeListener('market:coreStatus', listener);
  },
  onEvent: (callback) => {
    const listener = (_event, evt) => callback(evt);
    ipcRenderer.on('market:coreEvent', listener);
    return () => ipcRenderer.removeListener('market:coreEvent', listener);
  },
});

contextBridge.exposeInMainWorld('sunmiApi',{call:input=>ipcRenderer.invoke('possistem:sunmi',input),onStatus:handler=>{const listener=(_event,value)=>handler(value);ipcRenderer.on('possistem:sunmi-status',listener);return()=>ipcRenderer.removeListener('possistem:sunmi-status',listener)}});

/* POSSISTEM_SUNMI_PRELOAD_v1 — copied inline: sandboxed preloads cannot require arbitrary local modules. */
let _sunmiRrnBusy=false;
async function _sunmiPreparePayment(payload,market=false,refund=false){
 const out=await ipcRenderer.invoke('possistem:sunmi',{action:'get'});
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
 const cfg=await ipcRenderer.invoke('possistem:sunmi',{action:'get'});if(!cfg?.ok||!cfg.data?.config?.enabled)return payload;
 const original=await ipcRenderer.invoke(market?'market:invoke':'pos:invoke',{method:market?'sale.receipt':'payments.get',payload:market?{saleId:payload.saleId}:{paymentId:payload.paymentId}});
 if(original?.success&&(market?original.data?.cardMinor>0:original.data?.method==='card'))return _sunmiPreparePayment(payload,false,true);
 return payload;
}
