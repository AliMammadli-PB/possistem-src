// A stand-in POS driven through the central engine and the till's own tools, for replaying owner chats.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {advance,newDocument,TOOLS} from '../../platform/apps/api/src/lib/assistant/central-engine.mjs';
import {createTools} from './local-tools.mjs';
export function chat({menu=true,help:answer,understand,writeSql,profile=null}={}){
  const ok=data=>({success:true,data});
  const state={ingredients:[
   {id:'i-acd',sku:'MENU-m-acd',name:'acili doner',unit:'ədəd',salePriceMinor:600,costMinor:0,active:1,updatedAt:1},
   {id:'i-dn',sku:'MENU-m-dn',name:'doner',unit:'ədəd',salePriceMinor:500,costMinor:0,active:1,updatedAt:1},
   {id:'i-lh',sku:'MENU-m-lh',name:'lahmacun',unit:'ədəd',salePriceMinor:300,costMinor:0,active:1,updatedAt:1},
   {id:'i-un',sku:'R-UN',name:'Un',unit:'kq',salePriceMinor:0,costMinor:120,active:1,updatedAt:1},
   {id:'i-et',sku:'R-ET',name:'Qiymə',unit:'kq',salePriceMinor:0,costMinor:1400,active:1,updatedAt:1}],
   levels:{'i-acd':0,'i-dn':-16000,'i-lh':0,'i-un':25000,'i-et':4000},
   menu:[{id:'m-acd',nameAz:'acili doner',categoryId:'c1',priceMinor:600,active:true},{id:'m-dn',nameAz:'doner',categoryId:'c1',priceMinor:500,active:true},{id:'m-lh',nameAz:'lahmacun',categoryId:'c1',priceMinor:300,active:true}],
   recipes:{},
   areas:[{id:'a11',nameAz:'11'}],
   tables:[{id:'t1',label:'Masa 1',areaId:'a11',areaName:'11',seats:4,orderId:'o1',status:'occupied',totalMinor:2500,paidMinor:0},{id:'t2',label:'Masa 2',areaId:'a11',areaName:'11',seats:4,orderId:'o2',status:'occupied',totalMinor:1800,paidMinor:500},{id:'t3',label:'panda',areaId:'a11',seats:2,orderId:null,status:'available'}],
   jobs:[]};
  const api={
   inventory:{ingredients:async()=>ok({ingredients:state.ingredients,assistantToolsVersion:1}),warehouses:async()=>ok({warehouses:[{id:'w1',name:'bu',active:1}],homeWarehouseId:'w1'}),
    levels:async()=>ok({levels:Object.entries(state.levels).map(([id,q])=>({ingredientId:id,qtyMilli:q}))}),
    recipe:async id=>ok({lines:state.recipes[id]||[],components:[]}),saveRecipe:async(id,lines)=>{state.recipes[id]=lines;return ok({saved:true});},
    adjust:async p=>{state.levels[p.ingredientId]+=p.qtyDeltaMilli;return ok({ok:true});},valuation:async()=>ok({warehouseId:'',method:'average',totalMinor:68000,lines:5}),waste:async p=>{state.wastes=[...(state.wastes||[]),p];state.levels[p.ingredientId]-=p.qtyMilli;return ok({ok:true});},saveIngredient:async p=>{if(!p.id){const id='i-'+(state.ingredients.length+1);state.ingredients.push({id,sku:p.sku,name:p.name,unit:p.unit,salePriceMinor:0,costMinor:0,active:1,updatedAt:1});state.levels[id]=0;return ok({id});}return ok({patched:true,id:p.id});}},
   products:{list:async()=>ok({products:state.menu}),categories:async()=>ok({categories:[{id:'c1',nameAz:'Yeməklər'}]})},
   catalogAdmin:{upsertProduct:async p=>{if(!state.menu.some(m=>m.id===p.id))state.menu.push({id:p.id,nameAz:p.nameAz,categoryId:p.categoryId,priceMinor:p.priceMinor,active:true});return ok({id:p.id});}},
   cashAccounts:{list:async()=>ok({accounts:[{id:'k1',name:'Kassa',kind:'till',balanceMinor:27230,todayCashMinor:17260,todayCardMinor:0}]})},
   reports:{assistantQuery:async sql=>{state.queries=[...(state.queries||[]),sql];return /^SELECT NULL/.test(sql)?ok({columns:['Xərc (₼)'],rows:[[null]],truncated:false}):/pin_hash/.test(sql)?{success:false,error:{code:'E_VALIDATION',message:'Bu məlumat köməkçiyə bağlıdır: users.pin_hash.'}}:ok({columns:['Ofisiant','Satış (₼)'],rows:[['Aysel',412.5],['Rauf',230]],truncated:false});},
    period:async()=>ok({sales:{netMinor:17260,grossMinor:17260,refundMinor:0,refundsMinor:0,count:9,orders:9}}),
    z:async(_day,_note,o)=>{state.z=(state.z||0)+1;state.dayOpen=false;/* the core's real shape */return ok({businessDay:{id:'day-1',status:'closed'},zReport:{sequenceNo:state.z,canonical:{businessDate:'2026-11-08',sales:{grossMinor:17260,netMinor:17260,refundMinor:0,byMethod:[{method:'cash',count:7,totalMinor:12260}]},cash:{expectedCashMinor:22260}}}});},
    x:async(_day,o)=>{state.x=(state.x||0)+1;state.xKeys=[...(state.xKeys||[]),o?.idempotencyKey];return ok({sequenceNo:state.x,canonical:{businessDate:'2026-11-08',sales:{grossMinor:17260,netMinor:17260,refundMinor:0,byMethod:[{method:'cash',count:7,totalMinor:12260},{method:'card',count:2,totalMinor:5000}]},orders:{count:9,discountMinor:0},cash:{expectedCashMinor:22260},openTableCount:2,openTablesTotalMinor:4300}});},
    topProducts:async n=>ok({products:[{name:'doner',quantity:31,revenueMinor:15500},{name:'acili doner',quantity:3,revenueMinor:1800}].slice(0,n)})},
   files:{get assistantPdf(){return state.oldTill?undefined:async(name,html)=>{state.pdfs=[...(state.pdfs||[]),{name,html}];return ok({canceled:false,path:'C:\\Users\\owner\\Documents\\Possistem\\Köməkçi\\'+name,name,bytes:html.length});};},savePdf:async(name,html)=>{state.pdfs=[...(state.pdfs||[]),{name,html}];return ok(state.cancelPdf?{canceled:true}:{canceled:false,path:'/home/owner/Sənədlər/'+name,bytes:html.length});}},
   businessDay:{readiness:async()=>ok(state.tables.some(t=>t.orderId)?{ready:false,openOrders:state.tables.filter(t=>t.orderId).length,unresolvedPayments:0,pendingKitchen:0}:{ready:true,openOrders:0,unresolvedPayments:0,pendingKitchen:0})},
   suppliers:{list:async()=>ok({suppliers:state.suppliers||[{id:'s1',name:'Ət evi',active:1},{id:'s2',name:'Un dünyası',active:1}]}),
    savePurchase:async p=>{state.saved=[...(state.saved||[]),p];return ok({id:'po-'+state.saved.length,totalMinor:p.lines.reduce((n,l)=>n+Math.round(l.qtyMilli*l.unitCostMinor/1000),0),status:'ordered'});},
    receiveLines:async p=>{const po=state.saved[Number(p.purchaseId.slice(3))-1];for(const l of po.lines){state.levels[l.ingredientId]+=l.qtyMilli;const ing=state.ingredients.find(i=>i.id===l.ingredientId);ing.costMinor=l.unitCostMinor;}state.received=(state.received||0)+1;return ok({received:true});},
    purchases:async()=>ok({purchases:[{id:'p1',number:'Q-7',supplierName:'Ət evi',status:'received',totalMinor:42000,dueMinor:12000,createdAt:Date.parse('2026-11-05T10:00:00Z')},{id:'p2',number:'Q-8',supplierName:'Un dünyası',status:'ordered',totalMinor:9000,dueMinor:0,createdAt:Date.parse('2026-11-07T10:00:00Z')}]})},
   delivery:{courierReport:async p=>ok({from:p.from,to:p.to,couriers:[{courierId:'k1',courierName:'Elvin',deliveries:5,completed:4,failed:1,feeMinor:1000,collectedMinor:7500},{courierId:'k2',courierName:'Rauf',deliveries:0,completed:0,failed:0,feeMinor:0,collectedMinor:0}]})},
   tables:{list:async()=>ok({areas:state.areas,tables:state.tables,assistantLayoutVersion:1}),assistantArchive:async p=>{const ids=(p.assistantExpectedTables||[]).map(t=>t.id);state.tables=state.tables.filter(t=>!ids.includes(t.id));return ok({archived:ids.length});},assistantUpdate:async p=>ok({updated:true}),upsertArea:async p=>{state.areas.push({id:p.id,nameAz:p.nameAz});return ok({id:p.id});},upsertTable:async p=>{state.tables.push({id:p.id,label:p.label,areaId:p.areaId,seats:p.seats,orderId:null,status:'available'});return ok({id:p.id});}},
   orders:{get:async id=>ok({items:[{name:'doner',quantity:2,status:'sent'}]})},
   settings:{set:async(key,value)=>{state.settings={...(state.settings||{}),[key]:value};if(key==='printer.receipt')state.receipt=value;return ok({key,value});}},
   print:{printers:async()=>ok(state.noPrinters?{printers:[],receipt:state.receipt||'auto'}:{printers:['usbraw:\\\\?\\usb#vid_0483&pid_5840#aclass-8888-12340'],receipt:'usbraw:\\\\?\\usb#vid_0483&pid_5840#aclass-8888-12340'}),enqueue:async p=>{const job=/^tcp:/.test(p.printer||'')?{id:'job'+state.jobs.length,status:'completed',lastError:'',printer:p.printer}:{id:'job'+state.jobs.length,status:'retrying',lastError:'E_PRINTER_SEND: USB printer açıla bilmədi (kod 2)',printer:p.printer};state.jobs.push(job);return ok(job);}}
  };
  const perms=['inventory.view','inventory.manage','inventory.adjust','catalog.manage','recipes.manage','reports.view','cash.accounts','order.view','tables.layout','receipt.print','printer.manage','reports.x','suppliers.view','delivery.view','suppliers.manage','suppliers.receive','reports.z'];
  const services={billing:{status:async()=>ok({paymentsAvailable:true,subscriptions:[{product:'restaurant',state:'trial',planName:'Pulsuz test istifadəsi',monthlyMinor:1000,accessUntil:'2026-11-13T09:03:15Z',paidUntil:null,hasPaidSubscription:false}]}),open:async()=>ok({opened:true,url:'https://possistem.az/pay'})}};
  const tools=createTools(api,p=>perms.includes(p),services);
  const help=answer||(async text=>({id:'kb',body:'Anbar belə işləyir:\n\n1. Məhsul kartı...\n\nHansı addımı ətraflı izah edim?',links:[],chips:[]}));
  if(!menu)state.menu=state.menu.filter(m=>m.id!=='m-lh');
  let doc=newDocument({surface:"restaurant",language:"az",permissions:perms,tools:TOOLS,profile});
  async function send(text){const id=randomUUID();let out=await advance(doc,{type:'message',text,requestId:id},{revision:1,entries:[],help,understand,writeSql});doc=out.document;
   for(let n=0;out.result.task;n++){assert.ok(n<30);const task=out.result.task;let outcome;try{outcome={value:await tools[task.name](...task.args)};}catch(e){outcome={error:String(e.message||e)};}
    out=await advance(doc,{type:'result',requestId:id,taskId:task.id,outcome},{revision:1,entries:[],help,understand,writeSql});doc=out.document;}
   return out.result.reply;}
  return{send,state};
}
