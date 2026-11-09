import {createTools} from './local-tools.mjs';
export {copyChatText,chatTranscript} from './clipboard.mjs';
const methods=['catalogue','read','save','overview','sales','cash','subscription','openPayment','tables','tableOrder','setupRaw','setupMenu','setupRecipe','setupCreateRaw','setupCreateMenu','setupSaveRecipe','setupTables','setupCreateTable','tableLayout','tableApply','tableCreateArea','tableCreateMany','printerList','printerTest','reportX','topProducts','purchases','courierReport','stockValue','writeOff','suppliersList','receiveGoods','dataQuery','zReadiness','reportZ','savePdfTable'];
const stable=x=>JSON.stringify(x,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const writes=new Set(['save','setupCreateRaw','setupCreateMenu','setupSaveRecipe','setupCreateTable','tableApply','tableCreateArea','tableCreateMany','printerTest','reportX','writeOff','receiveGoods','reportZ']);
export const normalize=x=>String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ə/g,'e').replace(/ı/g,'i').replace(/ş/g,'s').replace(/ç/g,'c').trim();
export function createOnlineConversation({api,has,billing,transport,language='az',initialState=null}){
 const tools=createTools(api,has,{billing});let session=null,approval=null,locked=false,startedAt=0;
 const permissions=['inventory.view','inventory.manage','inventory.adjust','catalog.manage','reports.view','cash.accounts','order.view','recipes.manage','tables.layout','receipt.print','printer.manage','reports.x','suppliers.view','delivery.view','suppliers.manage','suppliers.receive','reports.z'].filter(has);
 const call=async(action,payload)=>{const r=await transport({action,...payload});if(!r?.success)throw Error(r?.error?.message||'Serverlə əlaqə yoxdur. Yenidən yoxlayın.');return r.data;};
 if(stable(initialState?.tools||[])===stable(methods)&&initialState?.session&&Date.now()-initialState.startedAt<23*60*60*1000&&initialState.language===language&&stable(initialState.permissions)===stable(permissions)){session=initialState.session;approval=initialState.approval;startedAt=initialState.startedAt;}
 return{snapshot:()=>({session,approval,startedAt,permissions,language,tools:methods}),
  // "Səhv cavab": the conversation goes to the admin's complaint list; no till data is read or changed.
  report:(chatKey,transcript,comment='')=>call('report',{chatKey,language,comment,transcript}),
  async send(input,history=[],valid=()=>true){
  if(locked)throw Error('Cavab hazırlanır.');locked=true;let sentWrite=false,lastWrite='';
  try{
   if(!valid())throw Error('Hesab dəyişib.');
   if(!session){session=await call('create',{protocol:1,language,permissions,tools:methods});startedAt=Date.now();}
   const approved=approval;approval=null;const requestId=crypto.randomUUID();
   let response=await call('message',{sessionId:session.sessionId,secret:session.secret,requestId,text:input});
   for(let step=0;response.task;step++){
    if(step>=24)throw Error('Əməliyyat çox uzandı. Heç bir yeni əməliyyat göndərilmədi.');
    if(!valid())throw Error('Hesab dəyişib.');
    const task=response.task;
    if(task.protocol!==1||!methods.includes(task.name)||!Array.isArray(task.args)||task.args.length>5)throw Error('Server uyğun olmayan əməliyyat istədi.');
    const write=writes.has(task.name);
    if(write&&(!/^(confirm|tesdiq( et|le|leyirem)?|beli|he|yes|setup:save)$/.test(normalize(input))||!approved||approved.name!==task.name||stable(approved.args)!==stable(task.args)))throw Error('Dəyişiklik əvvəlcədən göstərilən planla uyğun deyil. Yenidən plan qurun.');
    if(task.name==='openPayment'&&input!=='subscription:pay')throw Error('Ödəniş açmaq üçün düyməni seçin.');
    let outcome;try{sentWrite=sentWrite||write;if(write)lastWrite=task.name;const value=await tools[task.name](...task.args,...(['openPayment','setupCreateRaw','setupCreateMenu','setupSaveRecipe','setupCreateTable','tableApply','tableCreateArea','tableCreateMany','printerTest','reportX','writeOff','receiveGoods','reportZ'].includes(task.name)?[valid]:[]));outcome={value};}catch(e){outcome={error:e.message||'Yerli əməliyyat alınmadı.'};}
    if(!valid())throw Error('Hesab dəyişib.');
    response=await call('result',{sessionId:session.sessionId,secret:session.secret,requestId,taskId:task.id,outcome});
   }
   if(!valid())throw Error('Hesab dəyişib.');approval=response.approval||null;return response.reply;
  }catch(e){session=null;approval=null;throw Error((e.message||'Bağlantı yoxdur.')+(!sentWrite&&/^(?:İnternet yoxdur|Köməkçi serverinə)/.test(e.message||'')?' Heç bir əmr icra olunmadı, kassada heç nə dəyişmədi.':'')+(sentWrite?' Nəticəni '+(lastWrite==='printerTest'?'Parametrlər → Printerdən':['tableApply','tableCreateArea','setupCreateTable'].includes(lastWrite)?'Masa idarəsindən':lastWrite==='setupSaveRecipe'?'Kalkulyasiyadan':'Anbardan')+' yoxlayın; əməliyyat avtomatik təkrarlanmayacaq.':''));}finally{locked=false;}
 }};
}

export {openLocalConversation} from './persistent-chat.mjs';
