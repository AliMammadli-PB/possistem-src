'use strict';
/** A single owner-scoped projection for the user editor and its server validator. */
async function staffPlaces({core,ops,network,activation,cache={},remote,allowedBranchId="",links={}}){
 const [rr,aa,ww,net]=await Promise.allSettled([
  core.invoke('cash.listRegisters',{actorId:'system'}),ops.invoke('cashAccounts.list',{}, {timeoutMs:8000}),
  ops.invoke('warehouses.list',{}),network()]);
 const value=r=>r.status==='fulfilled'&&r.value?.success?r.value.data:null;
 const registers=value(rr),accounts=value(aa),warehouses=value(ww);
 if(!registers||!accounts||!warehouses)throw Error('Filial və kassa siyahısı yüklənmədi. Yenidən yoxlayın.');
 const cloud=net.status==='fulfilled'?net.value:null;
 const cloudObjects=cloud?.objects||cache.objects||[];
 const localBranch=activation.cloudBranchId||'';
 const localDevice=(cloud?.branches||[]).find(b=>b.local);
 const currentBranch=localDevice?.branchId||localBranch;
 const objects=(accounts.objects||[]).map(o=>{
  const matches=cloudObjects.filter(c=>c.id===o.id||c.name===o.name||links[c.id]===o.id);
  const branchId=matches.length===1?matches[0].id:((accounts.objects||[]).length===1?currentBranch:'');
  return {id:String(branchId||o.id),localObjectId:String(o.id),name:String(o.name),branchId:String(branchId||''),warehouseId:o.warehouseId||''};
 });
 for(const o of cloudObjects)if(!objects.some(x=>x.id===o.id||x.branchId===o.id))objects.push({id:o.id,name:o.name,branchId:o.id,warehouseId:''});
 const map=Object.fromEntries((accounts.accounts||[]).filter(a=>a.kind==='till'&&String(a.terminalId).startsWith('market-')).map(a=>[a.terminalId.slice(7),a.objectId||'']));
 const mapped=registers.filter(r=>!r.archived).map(r=>({id:String(r.id),name:r.name||r.code||r.id,objectId:objects.find(o=>o.localObjectId===map[r.id])?.id||objects.find(o=>o.branchId===currentBranch)?.id||''}));
 const stores=(warehouses.warehouses||[]).map(w=>({...w,objectId:objects.find(o=>o.warehouseId===w.id)?.id||((objects.length===1)?objects[0].id:'')}));
 if(remote&&cloud){
  const devices=(cloud.branches||[]).filter(d=>!d.local&&d.product==='market'&&d.online&&d.branchId&&(!allowedBranchId||allowedBranchId===d.branchId));
  await Promise.all(devices.map(async d=>{try{
   const batch=await remote(d.deviceId,[{method:'cashAccounts.list',payload:{}},{method:'warehouses.list',payload:{}}]);
   const accountData=batch.results?.[0],storeData=batch.results?.[1];if(!accountData?.success)return;
   const object=objects.find(o=>o.branchId===d.branchId||o.id===d.branchId);if(!object)return;
   for(const r of accountData.data.accounts||[])if(r.kind==='till'&&String(r.terminalId).startsWith('market-')&&!mapped.some(x=>x.id===r.terminalId.slice(7)&&x.objectId===object.id))mapped.push({id:r.terminalId.slice(7),name:r.name,objectId:object.id});
   for(const w of storeData?.data?.warehouses||[])if(!stores.some(x=>x.id===w.id&&x.objectId===object.id))stores.push({...w,objectId:object.id});
  }catch{/* Local selection remains usable if another till is offline. */}}));
 }
 return {objects,registers:mapped,warehouses:stores,offline:!cloud,warning:cloud?'':'İnternet bağlantısı yoxdur. Son filial siyahısı göstərilir.',cloudObjects};
}
function validatePlaces(places,profile,actor){
 const object=profile.objectId?places.objects.find(o=>o.id===profile.objectId||o.localObjectId===profile.objectId):null;
 if(profile.objectId&&!object)throw Error('Seçilmiş filial tapılmadı. Siyahını yeniləyin.');
 if(actor.branchId&&actor.branchId!==object?.branchId)throw Error('Bu filiala istifadəçi təyin etmək icazəniz yoxdur');
 for(const id of profile.registerIds||[]){const r=places.registers.find(r=>r.id===id&&(!object||!r.objectId||r.objectId===object.id));if(!r||object&&r.objectId&&r.objectId!==object.id)throw Error('Kassa seçilmiş filiala aid deyil');}
 for(const id of profile.warehouseIds||[]){const w=places.warehouses.find(w=>w.id===id&&(!object||!w.objectId||w.objectId===object.id));if(!w||object&&w.objectId&&w.objectId!==object.id)throw Error('Anbar seçilmiş filiala aid deyil');}
 return object;
}
module.exports={staffPlaces,validatePlaces};
