'use strict';
/** Read-only projection: staff see this POS's location; managers may select an existing owner location. */
async function selection({manager,list,localContext}){
 try{
  const data=await list(),own=(data.branches||[]).find(d=>d.local);
  if(!own)throw Error('Cari POS sahibkar hesabında tapılmadı');
  const objects=(data.objects||[]).map(o=>({id:o.id,name:o.name}));
  const current=own.branchId?{id:own.branchId,name:own.name}:null;
  return {manager:Boolean(manager),offline:false,deviceId:own.deviceId,current,objects:manager?objects:current?[current]:[]};
 }catch(e){
  const local=await Promise.resolve().then(localContext).catch(()=>null);
  return {manager:Boolean(manager),offline:true,current:local?.name?{id:local.id||null,name:local.name}:null,objects:[],error:String(e?.message||e)};
 }
}
module.exports={selection};
