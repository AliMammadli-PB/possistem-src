import {createHash,randomUUID} from 'node:crypto';
import {createConversation} from './runtime/conversation.mjs';
import {interpret} from './runtime/stock-assistant.mjs';
export const PROTOCOL=1;
export const TOOLS=['catalogue','read','save','overview','sales','cash','subscription','openPayment','tables','tableOrder','setupRaw','setupMenu','setupRecipe','setupCreateRaw','setupCreateMenu','setupSaveRecipe'];
export const WRITES=new Set(['save','setupCreateRaw','setupCreateMenu','setupSaveRecipe']);
const clone=x=>JSON.parse(JSON.stringify(x));
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=(turn,index)=>{const h=digest([turn,index]);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const trainingFold=x=>String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ə/g,'e').replace(/ı/g,'i').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const typo=(a,b)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,miss=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++miss>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return miss+(i<a.length||j<b.length?1:0)<=1;};
export function trainingReply(entries,text,language,surface){
 const n=trainingFold(text),eligible=['social','unknown','help','capabilities'].includes(interpret(text).intent);if(!eligible||!n)return null;
 const hits=entries.filter(e=>e.active!==false&&e.language===language&&(e.scope==='both'||e.scope===surface)).map(e=>({e,score:Math.max(0,...e.patterns.map(p=>{const x=trainingFold(p);return n===x?100:x.length>=8&&typo(n,x)?90:x.length>8&&n.includes(x)?x.length/n.length*80:0;}))})).filter(x=>x.score>=55).sort((a,b)=>b.score-a.score);
 return hits[0]?{id:'training:'+hits[0].e.id,body:hits[0].e.answer,text:hits[0].e.answer,links:[],chips:[]}:null;
}
/** @param {{surface:string,language?:string,permissions?:string[],tools?:string[]}} options */
export function newDocument({surface,language='az',permissions=[],tools=[]}){return{protocol:1,surface,language,permissions,tools:tools.filter(t=>TOOLS.includes(t)),state:null,receipts:{},history:[],revision:0,turn:null,last:null};}
// Durable continuation: only the current turn is replayed, using recorded tool results.
// No historical write is executed during replay or process restart.
export async function advance(document,event,{revision,entries=[],help}){
 const doc=clone(document);
 if(event.type==='message'){
  if(doc.receipts?.[event.requestId])return{document:doc,result:doc.receipts[event.requestId]};
  if(doc.turn)throw Error('TURN_IN_PROGRESS');
  if(doc.history.length>=100)throw Error('SESSION_FULL');
  const recheck=doc.revision!==revision&&!!(doc.state?.approval||doc.state?.setup?.flow?.stage==='confirm');
  doc.revision=revision;doc.turn={id:event.requestId,text:event.text,results:[],help:null,revision,recheck};
 }else{
  const pending=doc.turn?.pending;
  if(!pending){if(doc.receipts?.[event.requestId])return{document:doc,result:doc.receipts[event.requestId]};throw Error('NO_PENDING_TOOL');}
  if(event.requestId!==doc.turn.id||event.taskId!==pending.id)throw Error('TASK_MISMATCH');
  if(WRITES.has(pending.name)&&revision!==doc.turn.revision)throw Error('REVISION_CHANGED');
  doc.turn.results.push({name:pending.name,args:pending.args,...event.outcome});delete doc.turn.pending;
 }
 const turn=doc.turn;let cursor=0,keys=0;
 if(!turn.help){const trained=trainingReply(entries,turn.text,doc.language,doc.surface);turn.help=trained||await help(turn.text,doc.history)||{id:'unknown',body:'Hansı işi görmək istədiyinizi dəqiqləşdirin.',links:[],chips:[]};}
 if(doc.surface==='site'&&!doc.tools.length&&['overview','lookup','tables','subscription','cash','sales','edit','product_create','recipe_create'].includes(interpret(turn.text).intent)){const answer={body:turn.help.body,choices:[],reply:turn.help};const result={protocol:1,requestId:turn.id,revision:doc.revision,reply:answer,approval:null};doc.receipts=doc.receipts||{};doc.receipts[turn.id]=result;doc.history.push({author:'me',body:turn.text},{author:'helper',body:answer.body});doc.last={requestId:turn.id,result};doc.turn=null;return{document:doc,result};}
 const proxy={setupPermissions:()=>({raw:doc.permissions.includes('inventory.manage')&&doc.permissions.includes('inventory.view'),menu:doc.permissions.includes('catalog.manage')&&doc.permissions.includes('inventory.view'),recipe:doc.permissions.includes('recipes.manage')&&doc.permissions.includes('inventory.view')})};
 for(const name of TOOLS)proxy[name]=async(...params)=>{
  const args=clone(params.filter(p=>typeof p!=='function'));const index=cursor++;
  const recorded=turn.results[index];
  if(recorded){if(recorded.name!==name||digest(recorded.args)!==digest(args))throw Error('CONTINUATION_MISMATCH');if(recorded.error)throw Error(recorded.error);return recorded.value;}
  if(!doc.tools.includes(name))throw Error('Bu imkan bu hesabda və ya cihazda əlçatan deyil.');
  const task={id:key(turn.id,index),name,args,mutating:WRITES.has(name),protocol:1};turn.pending=task;
  throw Object.assign(Error('TOOL_REQUIRED'),{pendingTool:task});
 };
 const chat=createConversation({tools:proxy,language:doc.language,makeKey:()=>key(turn.id,1000+keys++),help:()=>turn.help});chat.restore(doc.state?clone(doc.state):null);
 let answer;
 try{answer=turn.recheck?await chat.recheck():await chat.send(turn.text,doc.history);}catch(e){if(!e.pendingTool)throw e;return{document:doc,result:{protocol:1,requestId:turn.id,revision:doc.revision,task:e.pendingTool}};}
 // Published training is authoritative for informational replies, never for a write flow.
 const trained=trainingReply(entries,turn.text,doc.language,doc.surface);if(trained&&!chat.approval()&&!doc.state?.pending&&!doc.state?.setup?.flow)answer={body:trained.body,choices:[],reply:trained};
 doc.state=chat.snapshot();const result={protocol:1,requestId:turn.id,revision:doc.revision,reply:answer,approval:chat.approval()};
 doc.history.push({author:'me',body:turn.text},{author:'helper',body:answer.body});doc.last={requestId:turn.id,result};doc.receipts=doc.receipts||{};doc.receipts[turn.id]=result;doc.turn=null;
 return{document:doc,result};
}
export function validateTask(task){return task?.protocol===1&&TOOLS.includes(task.name)&&Array.isArray(task.args)&&task.args.length<=5&&typeof task.id==='string';}
export {randomUUID};
