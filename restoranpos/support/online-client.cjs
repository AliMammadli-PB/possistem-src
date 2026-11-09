'use strict';
// Main process only. Tokens never reach the renderer or conversation payload.
function createAssistantClient({credentials,fetchImpl=fetch,historyStore}){
 const clean=c=>JSON.stringify([c.customerId,c.deviceId,c.actorId,[...(c.permissions||[])].sort()]);
 async function request(payload){
  const before=await credentials();if(!before?.token||!before.actorId)throw Error('Köməkçi üçün hesabınıza və PIN ilə daxil olun.');
  const scope=clean(before),action=String(payload?.action||'');
  if(['history:load','history:save','history:clear'].includes(action)){const {scopeOf,createHistoryStore}=require('./history-store.cjs'),key=scopeOf(before);if(payload.scope&&payload.scope!==key)throw Error('Hesab dəyişib. Söhbət saxlanmadı.');if(!historyStore){const electron=require('electron');historyStore=createHistoryStore({directory:electron.app.getPath('userData'),safeStorage:electron.safeStorage});}if(clean(await credentials())!==scope)throw Error('Hesab dəyişib.');return{scope:key,record:action==='history:load'?historyStore.load(key):action==='history:clear'?historyStore.clear(key,payload.generation):historyStore.save(key,payload.record)};}
  const paths={create:'sessions',message:'message',result:'result',report:'report'};
  if(!Object.hasOwn(paths,action))throw Error('Dəstəklənməyən köməkçi sorğusu.');
  const body=action==='create'?{protocol:1,surface:'restaurant',language:payload.language||'az',deviceId:before.deviceId,actorId:before.actorId,permissions:before.permissions||[],tools:payload.tools||[]}:
   action==='message'?{sessionId:payload.sessionId,secret:payload.secret,requestId:payload.requestId,text:payload.text}:
   action==='report'?{chatKey:payload.chatKey,language:payload.language||'az',comment:payload.comment||'',transcript:payload.transcript}:
   {sessionId:payload.sessionId,secret:payload.secret,requestId:payload.requestId,taskId:payload.taskId,outcome:payload.outcome};
  const base=new URL(before.baseUrl);if(base.protocol!=='https:'||base.hostname!=='possistem.az')throw Error('Köməkçi server ünvanı uyğun deyil.');
  const url=base.href.replace(/\/$/,'')+'/customer/assistant/v1/'+paths[action];
  // The assistant is online only: no network means no answer and no command, never a local fallback.
  let response;try{response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+before.token,'content-type':'application/json','x-pos-device':before.deviceId,'x-pos-actor':before.actorId},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});}catch(error){if(['TypeError','AbortError','TimeoutError'].includes(error?.name))throw Error('Köməkçi serverinə (possistem.az) qoşulmaq alınmadı'+(error?.cause?.code?' ('+String(error.cause.code).slice(0,40)+')':error?.name==='TimeoutError'?' (25 saniyə cavab gəlmədi)':'')+'. Köməkçi yalnız serverlə əlaqə olanda işləyir; bir az sonra yenidən yoxlayın.');throw error;}
  if(clean(await credentials())!==scope)throw Error('Hesab və ya icazələr dəyişib. Yeni söhbət başladın.');
  const data=await response.json();if(!response.ok)throw Error(data.error||'Serverlə əlaqə yoxdur. Yenidən yoxlayın.');return data;
 }
 return{request};
}
module.exports={createAssistantClient};
