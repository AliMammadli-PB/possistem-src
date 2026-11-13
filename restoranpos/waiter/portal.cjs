'use strict';
// Only signed waiter.portal commands reach this module. No method names are accepted from a phone.
async function run(command,args,deps){
 const context=await deps.context();
 const check=()=>{if(!context||!context.host||args.customerId!==context.customerId||args.deviceId!==context.deviceId)throw Error('Kassa və ya sahibkar uyğun deyil.');if(!Number.isFinite(args.cloudExpiresAt)||Date.now()>args.cloudExpiresAt)throw Error('Sorğunun vaxtı bitib.');};
 check();const action=String(args.action||'');
 const invoke=async(method,payload,actor,key)=>{check();const result=await deps.invoke(method,payload,{actor:{userId:actor},...(key?{idempotencyKey:key}:{}),timeoutMs:12000});if(!result?.success)throw Error(result?.error?.code==='E_UNKNOWN_METHOD'?'Ofisiant bağlantısı üçün kassa proqramını yeniləyin.':result?.error?.message||'Kassa cavab vermədi.');return result.data;};
 if(action==='provision'||action==='staff'){
  const admin=await deps.admin();if(!admin)throw Error('Sahibkar bağlantısı hazır deyil.');
  if(action==='staff'){const r=await invoke('auth.listUsers',{},admin.id);return{staff:(r.users||[]).filter(u=>u.active!==false&&u.active!==0&&u.role==='waiter').map(u=>({id:u.id,fullName:u.fullName}))};}
  return invoke('waiter.provision',{accountId:args.accountId,fullName:args.fullName,nativeUserId:args.nativeUserId||''},admin.id);
 }
 const userId=String(args.nativeUserId||'');if(!userId)throw Error('Ofisiant kassaya bağlanmayıb.');
 await invoke('waiter.identity',{},userId);
 const call=(method,payload={},key)=>invoke(method,payload,userId,key);
 const tables=async()=>{const r=await call('tables.list');return(r.tables||[]).filter(t=>t.areaId!=='area-delivery').map(t=>({id:t.id,label:t.label,areaId:t.areaId,areaName:t.areaName,orderId:t.orderId,totalMinor:t.totalMinor||0,paidMinor:t.paidMinor||0}));};
 if(action==='workspace'){
  const [floor,menu,categories]=await Promise.all([tables(),call('catalog.products'),call('catalog.categories')]);
  return{tables:floor,categories:(categories.categories||[]).map(c=>({id:c.id,name:c.nameAz,parentId:c.parentId})),products:(menu.products||[]).map(p=>({id:p.id,name:p.nameAz,categoryId:p.categoryId,priceMinor:p.priceMinor,available:p.available!==false&&p.available!==0&&!p.soldOut,image:typeof p.image==='string'&&p.image.startsWith('https://')?p.image:''})),checkedAt:new Date().toISOString()};
 }
 if(action==='modifiers'){
  const r=await call('catalog.modifierGroups',{productId:args.productId});return{groups:r.groups||[]};
 }
 if(action==='table'){
  const table=(await tables()).find(t=>t.id===args.tableId);if(!table)throw Error('Masa tapılmadı.');
  if(!table.orderId)return{table,items:[]};const order=await call('orders.get',{orderId:table.orderId});
  return{table,items:(order.items||[]).filter(i=>i.status!=='voided').map(i=>({id:i.id,name:i.name||i.nameSnapshot,quantity:i.quantity,note:i.note,status:i.status,totalMinor:i.lineTotalMinor}))};
 }
 if(action==='status')return call('waiter.status',{externalId:args.requestId});
 if(action==='place'){
  const payload={externalId:args.requestId,tableId:args.tableId,note:args.note||'',lines:args.lines};
  const accepted=await call('waiter.accept',payload,'waiter:'+args.requestId);
  // Native accept is atomic and permanently deduplicated. A submit failure keeps the accepted draft.
  const status=await call('waiter.status',{externalId:args.requestId});
  if(status.kitchenSent)return status;
  try{await call('orders.submit',{orderId:accepted.orderId},'waiter-submit:'+args.requestId);}catch(e){return{...status,accepted:true,kitchenSent:false,error:e.message};}
  return call('waiter.status',{externalId:args.requestId});
 }
 throw Error('Bu əməliyyat ofisiant üçün açıq deyil.');
}
module.exports={run};
