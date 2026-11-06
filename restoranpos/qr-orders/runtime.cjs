'use strict';
module.exports=function qrOrders({native,identity,owner,isTerminal,onStale}){
 async function cloud(path,payload){
  if(isTerminal())throw Error('QR menyunu əsas kassada idarə edin.');
  const login=owner(),device=await identity();if(!login?.token||!device?.deviceId)throw Error('Restoran hesabına daxil olun və kassanın lisenziyasını yoxlayın.');
  const url=new URL(device.baseUrl.replace(/\/+$/,'')+'/qr/device/'+path);
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+login.token},body:JSON.stringify({...payload,deviceId:device.deviceId}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw Error(data?.error||'QR xidməti ilə bağlantı alınmadı.');return data;
 }
 async function access(manage){const result=await native('qr.access',{manage});if(!result.success)throw Error(result.error?.message||'İcazəniz yoxdur.');}
 async function core(method,payload){const result=await native(method,payload,15000);if(!result.success){const error=Error(result.error?.message||'Kassa əməliyyatı tamamlanmadı.');error.definitive=['E_VALIDATION','E_PERMISSION','E_FORBIDDEN','E_UNAUTHORIZED','E_AUTH','E_LICENSE_EXPIRED','E_NOT_FOUND','E_CONFLICT'].includes(result.error?.code);throw error;}return result.data;}
 // The owner's words, pictures and hidden dishes ride over the till's live menu.
 function merge(catalog,old){catalog.name=old.name;catalog.description=old.description;catalog.logo=old.logo;catalog.cover=old.cover||"";catalog.accent=old.accent;catalog.layout=old.layout;
  catalog.items=catalog.items.map(p=>{const previous=old.items.find(x=>x.id===p.id);return {...p,hidden:previous?.hidden??false,image:previous?.image||p.image,description:previous?.description||p.description};});return catalog;}
 // What a guest can order: ids, names, prices, availability, options, tables. Words and pictures are left to the owner's publish.
 const orderable=d=>JSON.stringify({c:(d.categories||[]).map(c=>[c.id,c.name||'',c.nameTr||'',c.nameEn||'']),t:(d.tables||[]).map(t=>[t.id,t.label||'']),
  i:(d.items||[]).map(p=>[p.id,p.categoryId,p.name||'',p.nameTr||'',p.nameEn||'',Number(p.priceMinor)||0,!!p.available,!!p.hidden,(p.groups||[]).map(g=>[g.id,g.name||'',Number(g.min)||0,Number(g.max)||0,(g.options||[]).map(o=>[o.id,o.name||'',Number(o.priceDeltaMinor)||0])])])});
 // A published menu follows the till by itself: a dish made again, a new price or a sold-out flag reaches guests within minutes.
 async function sync(invoke){
  if(isTerminal())return {status:'terminal'};const login=owner(),device=await identity();if(!login?.token||!device?.deviceId)return {status:'signed_out'};
  const saved=await cloud('config',{action:'get'});if(!saved.menu?.enabled||!saved.menu.document)return {status:'off'};
  const r=await invoke('qr.catalog',{});if(!r?.success)return {status:'no_catalog'};
  const doc=merge(r.data,saved.menu.document);if(!doc.items?.length||!doc.tables?.length)return {status:'empty'};
  if(orderable(doc)===orderable(saved.menu.document))return {status:'current'};
  await cloud('config',{action:'publish',expectedRevision:saved.menu.revision,document:doc});return {status:'published'};
 }
 handle.sync=sync;
 return handle;
 async function handle(method,payload={}){
  try{
   if(method==='qr.inbox'){await access(false);return {success:true,data:await cloud('inbox',{})};}
   if(method==='qr.config'){
    await access(true);
    if(payload.action==='get'||!payload.action){
     const [catalog,saved]=await Promise.all([core('qr.catalog',{}),cloud('config',{action:'get'})]);
     if(saved.menu)merge(catalog,saved.menu.document);
     return {success:true,data:{...saved,document:catalog}};
    }
    if(!['publish','disable','rotate'].includes(payload.action))throw Error('QR əməliyyatı düzgün deyil.');
    return {success:true,data:await cloud('config',payload)};
   }
   if(method==='qr.decision'){
    await access(false);
    if(payload.action==='reject')return {success:true,data:await cloud('decision',{id:payload.id,action:'reject',reason:payload.reason||''})};
    if(payload.action!=='accept')throw Error('QR əməliyyatı düzgün deyil.');
    const claim=await cloud('decision',{id:payload.id,action:'claim'});if(claim.alreadyAccepted)return {success:true,data:{orderId:claim.order.posOrderId,tableId:claim.order.tableId,alreadyAccepted:true}};
    const order=claim.order;
    let imported;
    try{imported=await core('qr.accept',{externalId:order.id,tableId:order.tableId,lines:order.lines,note:order.note});}
    catch(error){if(/yenidən yayımlayın/.test(String(error.message)))try{onStale?.();}catch{}
     if(error.definitive)await cloud('decision',{id:payload.id,action:'release',claimToken:claim.claimToken,reason:String(error.message||error).slice(0,300)}).catch(()=>{});throw error;}
    try{await cloud('decision',{id:payload.id,action:'complete',claimToken:claim.claimToken,posOrderId:imported.orderId});}
    catch{throw Error('Sifariş kassaya əlavə olunub, server təsdiqi alınmadı. Bir dəqiqə sonra yenidən yoxlayın; sifariş təkrarlanmayacaq.');}
    return {success:true,data:imported};
   }
   throw Error('QR əməliyyatı tanınmadı.');
  }catch(error){return {success:false,data:null,error:{code:'E_QR_ORDER',message:String(error.message||error),retryable:false}};}
 };
};
