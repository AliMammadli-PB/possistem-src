'use strict';
// Main process only. Tokens never reach the renderer or conversation payload.
function createAssistantClient({credentials,fetchImpl=fetch}){
 const clean=c=>JSON.stringify([c.customerId,c.deviceId,c.actorId,[...(c.permissions||[])].sort()]);
 async function request(payload){
  const before=await credentials();if(!before?.token||!before.actorId)throw Error('Köməkçi üçün hesabınıza və PIN ilə daxil olun.');
  const scope=clean(before),action=String(payload?.action||''),paths={create:'sessions',message:'message',result:'result'};
  if(!Object.hasOwn(paths,action))throw Error('Dəstəklənməyən köməkçi sorğusu.');
  const body=action==='create'?{protocol:1,surface:'restaurant',language:payload.language||'az',deviceId:before.deviceId,actorId:before.actorId,permissions:before.permissions||[],tools:payload.tools||[]}:
   action==='message'?{sessionId:payload.sessionId,secret:payload.secret,requestId:payload.requestId,text:payload.text}:
   {sessionId:payload.sessionId,secret:payload.secret,requestId:payload.requestId,taskId:payload.taskId,outcome:payload.outcome};
  const base=new URL(before.baseUrl);if(base.protocol!=='https:'||base.hostname!=='possistem.az')throw Error('Köməkçi server ünvanı uyğun deyil.');
  const url=base.href.replace(/\/$/,'')+'/customer/assistant/v1/'+paths[action];
  const response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+before.token,'content-type':'application/json','x-pos-device':before.deviceId,'x-pos-actor':before.actorId},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  if(clean(await credentials())!==scope)throw Error('Hesab və ya icazələr dəyişib. Yeni söhbət başladın.');
  const data=await response.json();if(!response.ok)throw Error(data.error||'Serverlə əlaqə yoxdur. Yenidən yoxlayın.');return data;
 }
 return{request};
}
module.exports={createAssistantClient};
