'use strict';
async function run({command,args,credentials,isTerminal,actor,invoke,afterReset}){
 const fail=(message,code='E_VALIDATION')=>({commandId:command.id,ok:false,error:message,errorCode:code});
 if(isTerminal)return fail('Bu kompüter əsas kassa deyil','E_NOT_HOST');
 if(!credentials?.deviceId||args.deviceId!==credentials.deviceId)return fail('Əmr başqa kassaya aiddir','E_DEVICE_MISMATCH');
 if(!['data.previewOperations','data.resetOperations'].includes(command.command))return fail('Əmr tanınmadı');
 const user=await actor();if(!user?.id)return fail('Kassada administrator tapılmadı','E_NO_ADMIN');
 let payload={preview:true};
 if(command.command==='data.resetOperations'){
  if(!/^[a-f0-9]{64}$/.test(args.catalogHash||'')||!/^[a-f0-9-]{36}$/i.test(args.previewId||'')||typeof args.reason!=='string'||args.reason.trim().length<3)return fail('Yoxlama və təsdiq məlumatı yoxdur');
  payload={confirmation:'RESET_TEST_OPERATIONS',commandId:command.id,catalogHash:args.catalogHash,reason:args.reason.trim()};
 }
 try{
  const response=await invoke('system.resetOperational',payload,{actor:{userId:user.id},terminal:{id:'maintenance',name:'Admin paneli · test sıfırlama'},timeoutMs:120000});
  if(!response.success)return fail(response.error?.message||'Sıfırlama alınmadı',response.error?.code||'E_RESET_FAILED');
  if(command.command==='data.resetOperations'){
   if(response.data?.reset!==true||response.data?.catalogHash!==args.catalogHash||!response.data?.keptCopy)return fail('Sıfırlama təsdiqlənmədi','E_RESET_ACK');
   if(!response.data.replayed)afterReset();
  }
  return {commandId:command.id,ok:true,result:response.data};
 }catch(error){return fail(error?.message||'Kassa xidməti cavab vermədi','E_RESET_FAILED');}
}
module.exports={run};
