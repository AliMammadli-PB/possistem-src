/** Stock sharing is a branch operation, never an owner-account merge. */
export function marketBranchScope(peers:Array<{id:string;branchId:string|null}>,branchId:string|null,serverOrigin:string){
 return {origins:[...peers.filter(p=>p.branchId===branchId).map(p=>p.id),serverOrigin],multipleBranches:new Set(peers.map(p=>p.branchId)).size>1};
}
export function marketBranchEventVisible(event:{originDeviceId:string;kind:string;payload:Record<string,unknown>},multipleBranches:boolean,serverOrigin:string,device:{id:string;branchId:string|null}){
 return !multipleBranches || event.originDeviceId!==serverOrigin || !event.kind.startsWith('stock.') || event.payload.targetDeviceId===device.id || event.payload.branchId===device.branchId;
}
/** Verify the bytes the POS signed; schema parsing may drop optional/new fields. */
export function signedHeartbeatDocument<T extends {snapshot:unknown}>(parsed:T,raw:unknown):T {
 if(raw && typeof raw==='object' && 'snapshot' in raw)return {...parsed,snapshot:(raw as {snapshot:unknown}).snapshot};
 return parsed;
}
