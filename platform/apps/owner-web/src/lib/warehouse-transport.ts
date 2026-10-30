import {warehouseBatch,type WarehouseCall} from '../api';
const reads=new Set(['context','documents','document.get','staff','branch.summary','transfer.list','transfer.get','transfer.targets']);
export const warehouseWrite=(call:WarehouseCall)=>call.method==='business.call'?!reads.has(String(call.payload?.action)):!(/\.(list|get|levels|lowStock|movements|valuation|pricesList|pricelist|returns|suggestions|costing|expiry|stockLoss|suppliers|export|dashboard|salesSummary|period|topProducts|getSnapshot|categories|products|ledger|moves)$/.test(call.method)||['__session','settings.getAll','recipes.get','catalog.modifierGroups','catalog.product','catalog.priceHistory'].includes(call.method));
/** One instance per authenticated owner page. Retain request + original native keys on uncertain writes. */
export function createWarehouseTransport(send=warehouseBatch){
 const pending=new Map<string,{requestId:string;calls:WarehouseCall[]}>(),inflight=new Map<string,ReturnType<typeof warehouseBatch>>();
 return {rpc(deviceId:string,calls:WarehouseCall[]){
  const fingerprint=JSON.stringify([deviceId,calls.map(c=>({method:c.method,payload:c.payload||{}}))]);
  if(inflight.has(fingerprint))return inflight.get(fingerprint)!;
  const write=calls.some(warehouseWrite);
  let operation=write?pending.get(fingerprint):undefined;
  if(!operation){const requestId=crypto.randomUUID();operation={requestId,calls:calls.map((c,i)=>({...c,...(warehouseWrite(c)?{idempotencyKey:c.idempotencyKey||`${requestId}:${i}`}:{})}))};}
  if(write){if(pending.size>=100&&!pending.has(fingerprint))throw Error('Çox sayda təsdiqlənməmiş əməliyyat var. Qaimələri yoxlayıb səhifəni yeniləyin.');pending.set(fingerprint,operation);}
  const run=send(deviceId,operation.requestId,operation.calls).then(result=>{
   if(!Array.isArray(result.results)||result.results.length!==calls.length)throw Error('POS cavabı tam deyil. Qaimələri yoxlayın.');
   if(!result.queued)pending.delete(fingerprint);return result;
  }).catch(error=>{if(error.status>=400&&error.status<500&&error.status!==409)pending.delete(fingerprint);throw error;}).finally(()=>inflight.delete(fingerprint));
  inflight.set(fingerprint,run);return run;
 },clear(){pending.clear();inflight.clear();}};
}
