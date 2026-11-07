import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConversation,createTools} from './conversation.mjs';
function fixture({multiple=false,noHome=false}={}){
 const products=[{id:'cola',name:'Coca-Cola',sku:'COLA',unit:'ədəd',salePriceMinor:250,updatedAt:10},...(multiple?[{id:'cola2',name:'Kola 1 l',sku:'KOLA',unit:'ədəd',salePriceMinor:400,updatedAt:20}]:[])];
 const writes=[],reads=[];let qty=12000;
 const ok=data=>({success:true,data});
 const api={inventory:{ingredients:async()=>{reads.push('products');return ok({ingredients:products,assistantToolsVersion:1})},warehouses:async()=>ok({warehouses:[{id:'main',name:'Əsas anbar'},...(noHome?[{id:'bar',name:'Bar'}]:[])],homeWarehouseId:noHome?'':'main'}),levels:async warehouseId=>{reads.push(warehouseId);return ok({levels:products.map(p=>({id:p.id,qtyMilli:qty}))})},saveIngredient:async input=>{writes.push(input);Object.assign(products.find(p=>p.id===input.id),input.cardPatch);return ok({patched:true})},adjust:async input=>{writes.push(input);qty+=input.qtyDeltaMilli;return ok({})}}};
 const help=input=>/^salam|necesen|sag ol|tesekkur/.test(input)?{id:'greeting',body:'Salam, buyurun!'}:{id:'unknown',body:'Bir az ətraflı danışın, sizi dinləyirəm.'};
 const chat=createConversation({tools:createTools(api,()=>true),help,makeKey:()=> 'test-operation'});
 return{chat,api,writes,reads,products};
}
test('normal conversation never searches inventory or displays product guidance',async()=>{
 const f=fixture();
 for(const text of ['salam','necesen','sag ol','bu gun isler yaxsidir','sen ne bacarirsan']){
  const answer=await f.chat.send(text);assert.doesNotMatch(answer.body,/məhsul.*(ad|axtar)/i);assert.equal(answer.choices.length,0);
 }
 assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
});
test('stock lookup answers directly in chat',async()=>{
 const f=fixture();assert.match((await f.chat.send('kola nə qədər qalıb')).body,/12 ədəd/);assert.equal(f.writes.length,0);
});
test('ambiguous products and warehouses are selected with message choices',async()=>{
 const f=fixture({multiple:true,noHome:true});
 const first=await f.chat.send('kola nə qədər qalıb');assert.equal(first.choices.length,2);
 const second=await f.chat.send(first.choices[0].value);assert.match(second.body,/Hansı anbarda/);assert.equal(second.choices.length,2);
 assert.match((await f.chat.send(second.choices[1].value)).body,/Bar/);assert.equal(f.writes.length,0);
});
test('edit conversation asks field, value and approval without forms',async()=>{
 const f=fixture();const first=await f.chat.send('anbarda kola dəyiş');assert.match(first.body,/nəyi dəyişək/);
 await f.chat.send('field:price');await f.chat.send('3,25');assert.equal(f.writes.length,0);
 await f.chat.send('təsdiq et');assert.deepEqual(f.writes[0].cardPatch,{salePriceMinor:325});assert.equal(f.writes[0].expectedUpdatedAt,10);
 await f.chat.send('təsdiq et');assert.equal(f.writes.length,1);
});
test('quantity correction asks a reason and uses expected warehouse stock',async()=>{
 const f=fixture();await f.chat.send('kola qalığını 15 et');
 assert.match((await f.chat.send('Faktiki sayım')).body,/12 ədəd → 15 ədəd/);
 await f.chat.send('confirm');assert.equal(f.writes[0].qtyDeltaMilli,3000);assert.equal(f.writes[0].expectedQtyMilli,12000);
});
test('social messages during product clarification do not trigger searches',async()=>{
 const f=fixture({multiple:true});await f.chat.send('kola nə qədər qalıb');const count=f.reads.length;
 assert.match((await f.chat.send('salam')).body,/Salam/);assert.equal(f.reads.length,count);
 await f.chat.send('sen ne bacarirsan');assert.equal(f.reads.length,count);
});
test('cancel and unrelated conversation invalidate an approval',async()=>{
 const f=fixture();await f.chat.send('kola qiymətini 3 et');await f.chat.send('ləğv et');await f.chat.send('təsdiq et');assert.equal(f.writes.length,0);
 await f.chat.send('kola qiymətini 4 et');await f.chat.send('printer işləmir');await f.chat.send('təsdiq et');assert.equal(f.writes.length,0);
});
test('failed reads stay errors, rather than fake zero balances or product forms',async()=>{
 const f=fixture();f.api.inventory.levels=async()=>({success:false,error:{message:'Kassa əlaqəsi yoxdur'}});
 assert.match((await f.chat.send('kola nə qədər qalıb')).body,/Kassa əlaqəsi yoxdur/);assert.equal(f.writes.length,0);
});
test('account change while reading prevents subsequent work',async()=>{
 const f=fixture();let active=true;f.api.inventory.levels=async()=>{active=false;return{success:true,data:{levels:[{id:'cola',qtyMilli:12000}]}}};
 await f.chat.send('kola qiymətini 3 et',[],()=>active);assert.equal(f.writes.length,0);
});

test('warehouse overview reads fresh quantities even with a greeting and offers safe pagination',async()=>{
 const f=fixture();assert.match((await f.chat.send('salam anbarımda nə var?')).body,/Coca-Cola: 12 ədəd/);
 f.api.inventory.levels=async()=>({success:true,data:{levels:[{id:'cola',qtyMilli:8000}]}});
 assert.match((await f.chat.send('anbarıma bax')).body,/Coca-Cola: 8 ədəd/);assert.equal(f.writes.length,0);
 const many=fixture();for(let i=0;i<26;i++)many.products.push({id:'p'+i,name:'Mal '+i,unit:'kq'});
 const first=await many.chat.send('anbarıma bax');assert.match(first.body,/1–12 \/ 27/);
 const second=await many.chat.send(first.choices.find(c=>c.label==='Növbəti məhsullar').value);assert.match(second.body,/13–24 \/ 27/);
});
test('overview asks warehouse, errors are not zero and new question cancels pending write',async()=>{
 const f=fixture({noHome:true});const a=await f.chat.send('anbarıma bax');assert.match(a.body,/Hansı anbara/);
 assert.match((await f.chat.send(a.choices[1].value)).body,/Bar/);
 f.api.inventory.levels=async()=>({success:false,error:{message:'Offline'}});const again=await f.chat.send('anbarıma bax');assert.match((await f.chat.send(again.choices[0].value)).body,/Offline/);
 const g=fixture();await g.chat.send('kola qiymətini 4 et');await g.chat.send('anbarımda nə var');await g.chat.send('təsdiq et');assert.equal(g.writes.length,0);
 const denied=createConversation({tools:createTools(g.api,()=>false)});assert.match((await denied.send('anbarıma bax')).body,/icazəniz/);
});
test('sales and cash summaries use exact read-only values and recheck access',async()=>{
 const f=fixture();f.api.reports={period:async({from,to})=>{assert.ok(to>=from);return{success:true,data:{sales:{grossMinor:4500,refundMinor:1000,netMinor:3500}}}}};
 f.api.cashAccounts={list:async()=>({success:true,data:{accounts:[{name:'Kassa',balanceMinor:12500}]}})};
 const a=await f.chat.send('bugünkü satış');assert.match(a.body,/35[.,]00/);assert.match(a.body,/mənfəət deyil/);
 assert.match((await f.chat.send('kassada nə qədər pul var')).body,/125[.,]00/);assert.equal(f.writes.length,0);
});
