import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{createRequire}from'node:module';import{advance,newDocument}from'../../platform/apps/api/src/lib/assistant/central-engine.mjs';import{createOnlineConversation}from'./online.mjs';
const require=createRequire(import.meta.url),{createAssistantClient}=require('./online-client.cjs');
test('one client session receives changed server training without rebuilding',async()=>{let revision=1,body='Birinci',doc;const transport=async p=>{if(p.action==='create'){doc=newDocument({surface:'restaurant',tools:p.tools,permissions:p.permissions});return{success:true,data:{sessionId:randomUUID(),secret:'x'.repeat(64)}};}const result=await advance(doc,{type:'message',requestId:p.requestId,text:p.text},{revision,entries:[{id:'x',language:'az',scope:'both',patterns:['necesen'],answer:body}],help:async()=>({id:'wellbeing',body:'Salam'})});doc=result.document;return{success:true,data:result.result};};const chat=createOnlineConversation({api:{},has:()=>false,transport});assert.equal((await chat.send('necesen')).body,'Birinci');revision++;body='Yenilənmiş';assert.equal((await chat.send('necesen')).body,'Yenilənmiş');});
test('offline never falls back to bundled answers or invokes native writes',async()=>{let calls=0;const chat=createOnlineConversation({api:{},has:()=>true,transport:async()=>{calls++;throw Error('Bağlantı yoxdur');}});await assert.rejects(()=>chat.send('doneri 5 eded artir'),/Bağlantı yoxdur/);assert.equal(calls,1);});
test('unapproved write and arbitrary IPC cannot be requested through the bridge',async()=>{for(const task of[{protocol:1,id:randomUUID(),name:'save',args:[{},'quantity','20','reason','key']},{protocol:1,id:randomUUID(),name:'settings.set',args:[]}]){const chat=createOnlineConversation({api:{},has:()=>true,transport:async p=>({success:true,data:p.action==='create'?{sessionId:randomUUID(),secret:'x'.repeat(64)}:{task}})});await assert.rejects(()=>chat.send('salam'),/uyğun deyil|uyğun olmayan/);}});
test('main transport keeps bearer private and rejects owner changes after network wait',async()=>{let who={token:'fixture-private-bearer',customerId:'owner',deviceId:'dev',actorId:'staff',permissions:[],baseUrl:'https://possistem.az/pos/api'};let sent;const client=createAssistantClient({credentials:async()=>who,fetchImpl:async(url,init)=>{sent={url,...init};return new Response(JSON.stringify({protocol:1,sessionId:'safe'}));}});assert.deepEqual(await client.request({action:'create',tools:[],language:'az',actorId:'attacker'}),{protocol:1,sessionId:'safe'});assert.equal(JSON.parse(sent.body).actorId,'staff');assert.ok(!sent.body.includes(who.token));const changing=createAssistantClient({credentials:async()=>who,fetchImpl:async()=>{who={...who,actorId:'another'};return new Response('{}');}});await assert.rejects(()=>changing.request({action:'message'}),/dəyişib/);});

const jsonb=value=>JSON.parse(JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||a.localeCompare(b)).map(k=>[k,v[k]])):v));
test('JSONB reordered state preserves the approved raw-material payload, including legacy exact guards',async()=>{
 let doc,approved,writes=0;const goods=[];const api={inventory:{ingredients:async()=>({success:true,data:{ingredients:goods}}),saveIngredient:async p=>{writes++;goods.push({...p,id:'created'});return{success:true,data:{id:'created'}};}}};
 const transport=async p=>{if(p.action==='create'){doc=newDocument({surface:'restaurant',tools:p.tools,permissions:p.permissions});return{success:true,data:{sessionId:randomUUID(),secret:'x'.repeat(64)}};}
 const out=await advance(jsonb(doc),p.action==='message'?{type:'message',requestId:p.requestId,text:p.text}:{type:'result',requestId:p.requestId,taskId:p.taskId,outcome:p.outcome},{revision:1,help:async()=>({id:'unknown',body:'Unknown'})});doc=jsonb(out.document);
 if(out.result.task?.mutating)assert.equal(JSON.stringify(out.result.task.args),JSON.stringify(approved.args),'The already-installed 1.10.21 exact guard must also accept canonical server plans');
 if(out.result.approval)approved=out.result.approval;
 return{success:true,data:out.result};};
 const chat=createOnlineConversation({api,has:()=>true,transport});
 for(const text of ['mehsul yarat mene','setup:raw','lahmacun','ədəd'])await chat.send(text);
 // Force a pre-fix persisted approval: it must refresh the preview without any write.
 delete doc.approvalFormat;const refreshed=await chat.send('Təsdiq et');assert.match(refreshed.body,/yenidən yoxlayın/);assert.equal(writes,0);
 assert.match((await chat.send('Təsdiq et')).body,/lahmacun yaradıldı/);assert.equal(writes,1);
 await chat.send('Təsdiq et');assert.equal(writes,1);
});
test('a changed approved payload is rejected even with reordered keys',async()=>{
 let next=0;const chat=createOnlineConversation({api:{},has:()=>true,transport:async p=>({success:true,data:p.action==='create'?{sessionId:randomUUID(),secret:'x'.repeat(64)}:next++===0?{reply:{body:'Review'},approval:{name:'setupCreateRaw',args:[{name:'A',unit:'kg'},'k']}}:{task:{protocol:1,id:randomUUID(),name:'setupCreateRaw',args:[{unit:'kg',name:'B'},'k']}}})});
 await chat.send('mehsul yarat');await assert.rejects(()=>chat.send('confirm'),/planla uyğun deyil/);
});
test('server unreachable: the main transport says so with the reason and nothing runs on the till',async()=>{
 const who={token:'t',customerId:'c',deviceId:'d',actorId:'a',permissions:[],baseUrl:'https://possistem.az/pos/api'};
 for(const failure of [Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}}),new DOMException('timed out','TimeoutError')]){
  const client=createAssistantClient({credentials:async()=>who,fetchImpl:async()=>{throw failure;}});
  await assert.rejects(()=>client.request({action:'create',language:'az',tools:[]}),/^Error: Köməkçi serverinə \(possistem\.az\) qoşulmaq alınmadı \((?:ENOTFOUND|25 saniyə cavab gəlmədi)\)\. Köməkçi yalnız serverlə əlaqə olanda işləyir; bir az sonra yenidən yoxlayın\.$/);
 }
 let writes=0;const chat=createOnlineConversation({api:{inventory:{adjust:async()=>{writes++;}}},has:()=>true,transport:async()=>({success:false,error:{message:'Köməkçi serverinə (possistem.az) qoşulmaq alınmadı (ENOTFOUND). Köməkçi yalnız serverlə əlaqə olanda işləyir; bir az sonra yenidən yoxlayın.'}})});
 await assert.rejects(()=>chat.send('doneri 5 eded artir'),/Heç bir əmr icra olunmadı, kassada heç nə dəyişmədi\./);assert.equal(writes,0);});
