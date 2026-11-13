import {createHash,randomUUID} from 'node:crypto';
import {createConversation} from './runtime/conversation.mjs';
import {interpret} from './runtime/stock-assistant.mjs';
export const PROTOCOL=1;
export const TOOLS=['catalogue','read','save','overview','sales','cash','subscription','openPayment','tables','tableOrder','setupRaw','setupMenu','setupRecipe','setupCreateRaw','setupCreateMenu','setupSaveRecipe','setupTables','setupCreateTable','tableLayout','tableApply','tableCreateArea','tableCreateMany','printerList','printerTest','reportX','topProducts','purchases','courierReport','stockValue','writeOff','suppliersList','receiveGoods','dataQuery','zReadiness','reportZ','savePdfTable','printerDiscover','printerUse'];
export const WRITES=new Set(['save','setupCreateRaw','setupCreateMenu','setupSaveRecipe','setupCreateTable','tableApply','tableCreateArea','tableCreateMany','printerTest','reportX','writeOff','receiveGoods','reportZ','printerUse']);
const clone=x=>JSON.parse(JSON.stringify(x));
export const canonical=x=>JSON.parse(JSON.stringify(x,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value));
export const digest=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const key=(turn,index)=>{const h=digest([turn,index]);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const trainingFold=x=>String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ə/g,'e').replace(/ı/g,'i').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const typo=(a,b)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,miss=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++miss>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return miss+(i<a.length||j<b.length?1:0)<=1;};
export function trainingReply(entries,text,language,surface){
 const n=trainingFold(text),eligible=['social','unknown','help','capabilities'].includes(interpret(text).intent);if(!eligible||!n)return null;
 const hits=entries.filter(e=>e.active!==false&&e.language===language&&(e.scope==='both'||e.scope===surface)).map(e=>({e,score:Math.max(0,...e.patterns.map(p=>{const x=trainingFold(p);return n===x?100:x.length>=8&&typo(n,x)?90:x.length>8&&n.includes(x)?x.length/n.length*80:0;}))})).filter(x=>x.score>=55).sort((a,b)=>b.score-a.score);
 return hits[0]?{id:'training:'+hits[0].e.id,body:hits[0].e.answer,text:hits[0].e.answer,links:[],chips:[]}:null;
}
/** @param {{surface:string,language?:string,permissions?:string[],tools?:string[],profile?:{name:string}|null}} options */
export function newDocument({surface,language='az',permissions=[],tools=[],profile=null}){return{protocol:1,surface,language,permissions,tools:tools.filter(t=>TOOLS.includes(t)),profile,state:null,receipts:{},history:[],revision:0,turn:null,last:null};}
// Durable continuation: only the current turn is replayed, using recorded tool results.
// No historical write is executed during replay or process restart.
export async function advance(document,event,{revision,entries=[],help,understand,writeSql}){
 const doc=clone(document);
 if(event.type==='message'){
  if(doc.receipts?.[event.requestId])return{document:doc,result:doc.receipts[event.requestId]};
  if(doc.turn)throw Error('TURN_IN_PROGRESS');
  if(doc.history.length>=100)throw Error('SESSION_FULL');
  const recheck=(doc.revision!==revision||doc.approvalFormat!==1)&&!!(doc.state?.approval||doc.state?.setup?.flow?.stage==='confirm'||doc.state?.table?.flow?.stage==='confirm'||doc.state?.printer?.flow?.stage==='confirm'||doc.state?.stock?.flow?.stage==='confirm');
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
 if(doc.surface==='site'&&!doc.tools.length&&['overview','lookup','tables','subscription','cash','sales','edit','product_create','recipe_create','table_create'].includes(interpret(turn.text).intent)){const answer={body:turn.help.body,choices:[],reply:turn.help};const result={protocol:1,requestId:turn.id,revision:doc.revision,reply:answer,approval:null};doc.receipts=doc.receipts||{};doc.receipts[turn.id]=result;doc.history.push({author:'me',body:turn.text},{author:'helper',body:answer.body});doc.last={requestId:turn.id,result};doc.turn=null;return{document:doc,result};}
 const proxy={printerPermissions:()=>({print:doc.permissions.includes('receipt.print')&&doc.permissions.includes('printer.manage'),enabled:doc.tools.includes('printerList')&&doc.tools.includes('printerTest'),discover:doc.tools.includes('printerDiscover')&&doc.tools.includes('printerUse')}),tablePermissions:()=>({write:doc.permissions.includes('tables.layout'),enabled:doc.tools.includes('tableLayout')&&doc.tools.includes('tableApply')&&doc.tools.includes('tableCreateArea'),many:doc.tools.includes('tableCreateMany')}),setupPermissions:()=>({table:doc.permissions.includes('tables.layout')&&doc.tools.includes('setupTables')&&doc.tools.includes('setupCreateTable'),raw:doc.permissions.includes('inventory.manage')&&doc.permissions.includes('inventory.view'),menu:doc.permissions.includes('catalog.manage')&&doc.permissions.includes('inventory.view'),recipe:doc.permissions.includes('recipes.manage')&&doc.permissions.includes('inventory.view')})};
 for(const name of TOOLS)proxy[name]=async(...params)=>{
  const args=canonical(params.filter(p=>typeof p!=='function'));const index=cursor++;
  const recorded=turn.results[index];
  if(recorded){if(recorded.name!==name||digest(recorded.args)!==digest(args))throw Error('CONTINUATION_MISMATCH');if(recorded.error)throw Error(recorded.error);return recorded.value;}
  if(!doc.tools.includes(name))throw Error('Bu imkan bu hesabda və ya cihazda əlçatan deyil.');
  const task={id:key(turn.id,index),name,args,mutating:WRITES.has(name),protocol:1};turn.pending=task;
  throw Object.assign(Error('TOOL_REQUIRED'),{pendingTool:task});
 };
 // The AI reading is asked at most once per turn and kept with the turn, so tool replays stay identical.
 // A repeated request ("təkrar") is read as its own text; each text is read once per turn.
 const read=async(text=turn.text)=>{if(String(text).trim()!==String(turn.text).trim()){turn.ais=turn.ais||{};if(!(text in turn.ais)){let ai=null;try{ai=understand?await understand(text,doc.history.filter(m=>m.author==='me').map(m=>m.body).slice(-3),''):null;}catch{ai=null;}turn.ais[text]=ai;}return turn.ais[text];}
 if(!('ai' in turn)){let ai=null;try{// Only the assistant's last question goes along (it tells Groq whether this message answers it), never answers with figures.
  const q=String([...doc.history].reverse().find(m=>m.author==='helper')?.body||'').trim().split('\n').filter(Boolean).at(-1)||'';
  ai=understand?await understand(turn.text,doc.history.filter(m=>m.author==='me').map(m=>m.body).slice(-3),/\?$/.test(q)&&q.length<=200?q:''):null;}catch{ai=null;}turn.ai=ai;}return turn.ai;};
 // The query for a data question is written once per turn as well, with today's Baku date for "bu gün / keçən həftə".
 // Each data question in a turn ("SUAL: …" parts included) is written once and kept, so replays ask Groq nothing new.
 const askSql=async(question=turn.text)=>{turn.sqls=turn.sqls||{};if(!(question in turn.sqls)){let out=null;try{out=writeSql?await writeSql(question):null;}catch{out=null;}turn.sqls[question]=out;}return turn.sqls[question];};
 const chat=createConversation({tools:proxy,language:doc.language,makeKey:()=>key(turn.id,1000+keys++),help:()=>turn.help,understand:understand?read:null,askSql:writeSql?askSql:null,profile:doc.profile||null});chat.restore(doc.state?clone(doc.state):null);
 let answer;
 try{answer=turn.recheck?await chat.recheck():await chat.send(turn.text,doc.history);}catch(e){if(!e.pendingTool)throw e;return{document:doc,result:{protocol:1,requestId:turn.id,revision:doc.revision,task:e.pendingTool}};}
 // Published training is authoritative for informational replies, never for a write flow.
 const trained=trainingReply(entries,turn.text,doc.language,doc.surface);if(trained&&!chat.approval()&&!doc.state?.pending&&!doc.state?.setup?.flow)answer={body:trained.body,choices:[],reply:trained};
 doc.state=chat.snapshot();doc.approvalFormat=1;const result={protocol:1,requestId:turn.id,revision:doc.revision,reply:answer,approval:canonical(chat.approval())};
 doc.history.push({author:'me',body:turn.text},{author:'helper',body:answer.body});doc.last={requestId:turn.id,result};doc.receipts=doc.receipts||{};doc.receipts[turn.id]=result;doc.turn=null;
 return{document:doc,result};
}
export function validateTask(task){return task?.protocol===1&&TOOLS.includes(task.name)&&Array.isArray(task.args)&&task.args.length<=5&&typeof task.id==='string';}
export {randomUUID};
