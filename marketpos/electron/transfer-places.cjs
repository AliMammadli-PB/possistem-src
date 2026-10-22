'use strict';
/** Use the branch's configured sales warehouse; never silently pick an arbitrary store. */
function defaultWarehouse(warehouses,objects,preferred='',branchId='',branchName='') {
 const active=warehouses.filter(w=>w.active!==false&&w.active!==0),ids=new Set(active.map(w=>w.id));
 if(preferred&&ids.has(preferred))return preferred;
 const linked=objects.find(o=>ids.has(o.warehouseId)&&(o.id===branchId||branchName&&o.name===branchName));
 if(linked)return linked.warehouseId;
 const home=objects.find(o=>ids.has(o.warehouseId)&&(o.isDefault===true||o.isDefault===1));
 if(home)return home.warehouseId;
 if(ids.has('wh-main'))return 'wh-main';
 return active.length===1?active[0].id:'';
}
/** Resolve local stock independently of the cloud. Never turn an RPC failure into an empty select. */
async function transferPlaces({ops,network,remote,activation,scope,deviceId='',sourceDeviceId=''}) {
 if(sourceDeviceId&&sourceDeviceId!==activation.serverDeviceId&&scope.role!=='manager')throw Error('Başqa filialın göndərişini yalnız müdir idarə edə bilər');
 const identity={localDeviceId:activation.serverDeviceId,localBranchName:activation.cloudBranchName||''};
 const checked=async(method,payload={})=>{const r=await ops.invoke(method,{...payload,_marketScope:scope});if(!r.success)throw Error(r.error?.message||'Anbar məlumatları alınmadı');return r.data;};
 const decorate=(warehouses,objects,branchName)=>warehouses.filter(w=>w.active!==false&&w.active!==0).map(w=>({...w,objectName:objects.find(o=>o.warehouseId===w.id)?.name||branchName||''}));
 if(sourceDeviceId&&sourceDeviceId!==activation.serverDeviceId&&!deviceId){
  const source=await transferPlaces({ops,network,remote,activation,scope,deviceId:sourceDeviceId});
  const cloud=await network();return {...source,...identity,devices:(cloud.branches||[]).filter(d=>d.product==='market'),branches:cloud.objects||[],deviceId:sourceDeviceId};
 }
 if(!deviceId||deviceId===activation.serverDeviceId){
  const stores=await checked('warehouses.list');
  const context=await checked('cashAccounts.list');
  const local=decorate(stores.warehouses||[],context.objects||[],activation.cloudBranchName);
  const defaultWarehouseId=defaultWarehouse(local,context.objects||[],ops.settings?.()?.primaryOpsWarehouse,activation.cloudBranchId,activation.cloudBranchName);
  const localContext={...identity,warehouses:local,defaultWarehouseId,deviceId:activation.serverDeviceId};
  if(deviceId)return localContext;
  let cloud;try{cloud=await network();}catch(e){return {...localContext,devices:[],networkError:e.message};}
  return {...localContext,devices:(cloud.branches||[]).filter(d=>d.product==='market'),branches:cloud.objects||[]};
 }
 const cloud=await network(),target=(cloud.branches||[]).find(d=>d.deviceId===deviceId);
 if(!target||target.product!=='market')throw Error('Qəbul edən filial bu sahibkara bağlı deyil');
 if(!target.online)throw Error('Qəbul edən filial oflayndır. POS-u açıb internetə qoşun və yeniləyin.');
 if(String(target.version).localeCompare('1.5.29',undefined,{numeric:true})<0)throw Error('Qəbul edən Market POS-u yeniləyin');
 const batch=await remote(deviceId,[{method:'warehouses.list',payload:{}},{method:'cashAccounts.list',payload:{}},{method:'__session',payload:{}}]);
 const result=batch.results?.[0];if(!result?.success)throw Error(result?.error?.message||'Qəbul edən filialın anbarları alınmadı');
 const objects=batch.results?.[1]?.data?.objects||[];
 const warehouses=decorate(result.data.warehouses||[],objects,target.branchName||target.name);
 const preferred=batch.results?.[2]?.success?batch.results[2].data?.primaryWarehouseId:'';
 return {...identity,deviceId,warehouses,defaultWarehouseId:defaultWarehouse(warehouses,objects,preferred,target.branchId,target.branchName||target.name)};
}
module.exports={transferPlaces,defaultWarehouse};
