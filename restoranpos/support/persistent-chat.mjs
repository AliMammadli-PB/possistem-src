import {createOnlineConversation} from './online.mjs';
const cache=new Map(),keys=['inventory.view','inventory.manage','inventory.adjust','catalog.manage','reports.view','cash.accounts','order.view','recipes.manage','tables.layout'];
const id=()=>crypto.randomUUID(),clone=x=>JSON.parse(JSON.stringify(x));
export async function openLocalConversation(options){
 const {transport,has,language='az',valid=()=>true}=options;
 const call=async payload=>{const r=await transport(payload);if(!r?.success)throw Error(r?.error?.message||'Lokal söhbət saxlanmadı.');return r.data;};
 const {scope,record}=await call({action:'history:load'});if(!valid())throw Error('Hesab dəyişib.');
 const key=JSON.stringify([scope,keys.filter(has),language]),old=cache.get(key);
 if(old?.valid()&&old.generation()===record.generation)return old;
 let generation=record.generation,saved=new Set(record.messages.map(m=>m.id)),queue=Promise.resolve(),timer;
 let online=createOnlineConversation({...options,initialState:record.interrupted?null:record.online});
 let state={messages:record.messages,draft:record.draft||'',mode:record.mode||'assistant',busy:false,error:'',failedInput:'',choicesActive:!!online.snapshot().session,reported:Array.isArray(record.online?.reported)?record.online.reported:[]};
 const listeners=new Set(),emit=()=>{for(const f of listeners)f(state);};
 const update=patch=>{state={...state,...patch};emit();};
 const persist=(interrupted=false)=>{
  const snapshot=clone({messages:state.messages,draft:state.draft,mode:state.mode,online:{...online.snapshot(),reported:state.reported},interrupted}),version=generation;
  const work=async()=>{if(!valid())throw Error('Hesab dəyişib.');const pending=snapshot.messages.filter(m=>!saved.has(m.id));for(let i=0;i<Math.max(1,pending.length);i+=10){const messages=pending.slice(i,i+10);await call({action:'history:save',scope,record:{...snapshot,messages,generation:version}});for(const m of messages)saved.add(m.id);}};
  queue=queue.catch(()=>{}).then(work);return queue;
 };
 const append=(author,body,extra={})=>update({messages:[...state.messages,{id:id(),author,body,createdAt:new Date().toISOString(),...extra}]});
 if(record.interrupted){append('helper','Əvvəlki sorğu yarımçıq qalıb. Mesajlarınız saxlanılıb. Dəyişiklik etmişdinizsə, nəticəni müvafiq bölmədən yoxlayın; əməliyyat avtomatik təkrarlanmayacaq.');}
 const controller={valid,generation:()=>generation,get:()=>state,subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},
  setDraft(value){update({draft:value});clearTimeout(timer);timer=setTimeout(()=>{persist(state.busy).catch(e=>update({error:e.message}));},200);},
  setMode(mode){update({mode});persist(state.busy).catch(e=>update({error:e.message}));},
  async send(input,display=input){const value=input.trim();if(!value||state.busy)return;if(!valid()){update({error:'Hesab dəyişib.'});return;}if(globalThis.navigator?.onLine===false){update({error:'İnternet yoxdur. Köməkçi yalnız internet olanda işləyir. Mesaj göndərilmədi.',failedInput:value});return;}clearTimeout(timer);update({busy:true,error:'',draft:'',failedInput:'',choicesActive:false});append('me',display);
   try{await persist(true);const [answer]=await Promise.all([online.send(value,state.messages.slice(-100),valid),new Promise(resolve=>setTimeout(resolve,650))]);if(!valid())return;append('helper',answer.body,{reply:answer.reply,choices:answer.choices,...(answer.ai?{ai:true}:{}),...(Array.isArray(answer.files)&&answer.files.length?{files:answer.files.slice(0,4)}:{}),...(Array.isArray(answer.cards)&&answer.cards.length?{cards:answer.cards.slice(0,24)}:{})});update({choicesActive:!!online.snapshot().session});}
   catch(e){if(valid())update({error:e.message||String(e),failedInput:value});}
   finally{if(valid()){try{await persist(false);}catch(e){update({error:e.message||'Söhbət saxlanmadı.'});}update({busy:false});}}
  },
  async report(messageId){const index=state.messages.findIndex(m=>m.id===messageId);if(index<0||state.messages[index].author!=='helper'||state.reported.includes(messageId))return;
   if(globalThis.navigator?.onLine===false){update({error:'İnternet yoxdur. Şikayət göndərilmədi.'});return;}
   const reported=[...state.reported,messageId],from=Math.max(0,index-60);
   const transcript=state.messages.slice(from,index+20).map(m=>({author:m.author,body:String(m.body||'—').slice(0,16000),...(m.createdAt?{createdAt:m.createdAt}:{}),...(reported.includes(m.id)?{reported:true}:{})}));
   try{await online.report(generation,transcript);update({reported,error:''});await persist(state.busy);}catch(e){update({error:'Şikayət göndərilmədi: '+(e.message||e)});}},
  async clear(){if(state.busy)return;clearTimeout(timer);update({busy:true});try{await queue.catch(()=>{});const result=await call({action:'history:clear',scope,generation});generation=result.record.generation;saved=new Set();online=createOnlineConversation(options);update({messages:[],draft:'',error:'',failedInput:'',choicesActive:false,reported:[]});}finally{update({busy:false});}},
 };
 cache.set(key,controller);
 if(record.interrupted)await persist(false).catch(e=>update({error:e.message}));
 return controller;
}
