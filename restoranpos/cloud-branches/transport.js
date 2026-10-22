// Per iframe / authenticated branch session only. Never persisted or shared between devices.
function createBranchTransport({rpc,kind,fail,changed=()=>{},now=Date.now,ttl=60000,maxBytes=24000000,maxEntries=96}) {
 const cache=new Map(),inflight=new Map();let queue=[],timer=null,epoch=0,bytes=0,sessionKey=null,refreshedAt=now();
 const clone=value=>JSON.parse(JSON.stringify(value));
 function clear(){refreshedAt=now();epoch++;cache.clear();bytes=0;inflight.clear();}
 function refresh(){clear();changed(epoch);}
 function remember(key,value,version){
  if(version!==epoch||!value?.success)return;
  const encoded=JSON.stringify(value),size=encoded.length*2;if(size>maxBytes)return;
  if(cache.has(key)){bytes-=cache.get(key).size;cache.delete(key);}
  while(cache.size&&(cache.size>=maxEntries||bytes+size>maxBytes)){const first=cache.keys().next().value;bytes-=cache.get(first).size;cache.delete(first);}
  cache.set(key,{encoded,size,until:now()+ttl});bytes+=size;
 }
 async function flush(){
  timer=null;const batch=queue.splice(0,16);if(queue.length)timer=setTimeout(flush,0);
  if(!batch.length)return;
  let results;
  try{const reply=await rpc(batch.map(({method,payload,idempotencyKey})=>({method,payload,...(idempotencyKey?{idempotencyKey}:{})})));results=reply?.results;}
  catch(error){results=batch.map(()=>fail('E_BRANCH',error.message||String(error)));}
  // Invalidate even after an uncertain failure: the remote write may already be committed.
  const wrote=batch.some(c=>c.write);if(wrote)clear();
  batch.forEach((c,i)=>{const result=results?.[i]||fail('E_BRANCH','Cavab gəlmədi');
   if(c.method==='__session'&&result.success){const {loginAt,...rights}=result.data||{};const next=JSON.stringify(rights);if(sessionKey!==null&&next!==sessionKey)refresh();sessionKey=next;}
   // A late read must not overwrite a post-edit React state either.
   if(c.key&&result.success&&c.epoch!==epoch){void call(c.method,c.payload).then(c.resolve);return;}
   if(c.key)remember(c.key,result,c.epoch);c.resolve(result);
  });
  if(wrote)changed(epoch);
 }
 function call(method,payload={},options={}){
  const mode=kind({method,payload}),read=mode==='r'&&method!=='__session';
  const key=read?JSON.stringify([method,payload]):null;
  if(key){const saved=cache.get(key);if(saved&&saved.until>now()){cache.delete(key);cache.set(key,saved);return Promise.resolve(JSON.parse(saved.encoded));}
   if(saved){bytes-=saved.size;cache.delete(key);}if(inflight.has(key))return inflight.get(key).then(clone);
  }
  const write=mode==='w';if(write)clear();
  const promise=new Promise(resolve=>{queue.push({method,payload,idempotencyKey:options.idempotencyKey,resolve,key,write,epoch});if(!timer)timer=setTimeout(flush,25);});
  if(key){inflight.set(key,promise);void promise.then(()=>{if(inflight.get(key)===promise)inflight.delete(key);});}
  return promise.then(clone);
 }
 return {call,refresh,clear,refreshIfStale(){if(now()-refreshedAt>=ttl)refresh();},get version(){return epoch;}};
}
