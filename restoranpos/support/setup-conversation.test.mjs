import {test} from 'node:test';import assert from 'node:assert/strict';
import {createConversation,createTools,interpret} from './conversation.mjs';
function fixture(){
 const raw=[{id:'flour',sku:'F',name:'Un',unit:'kg',qtyMilli:0,costMinor:0}],menu=[{id:'pizza',nameAz:'Pizza',categoryId:'food',priceMinor:900}],categories=[{id:'food',nameAz:'Yeməklər'}],recipes=new Map(),writes=[];let key=0;
 const permissions=new Set(['inventory.view','inventory.manage','inventory.adjust','catalog.manage','recipes.manage']);const ok=data=>({success:true,data});
 const api={inventory:{ingredients:async()=>ok({ingredients:raw,assistantToolsVersion:1}),warehouses:async()=>ok({warehouses:[{id:'w',name:'Əsas'}],homeWarehouseId:'w'}),levels:async()=>ok({levels:raw.map(p=>({id:p.id,qtyMilli:p.qtyMilli,minQtyMilli:p.minQtyMilli}))}),saveIngredient:async p=>{writes.push(['raw',p]);const id='created-'+raw.length;raw.push({...p,id});return ok({id})},adjust:async p=>{writes.push(['adjust',p]);return ok({})},recipe:async id=>ok(recipes.get(id)||{lines:[],components:[]}),saveRecipe:async(id,lines,components)=>{writes.push(['recipe',id,lines,components]);recipes.set(id,{lines,components});return ok({saved:lines.length})}},catalog:{list:async()=>ok({products:menu}),categories:async()=>ok({categories})},catalogAdmin:{upsertProduct:async(p,o)=>{writes.push(['menu',p,o]);menu.push(p);return ok({id:p.id})}}};
 const tools=createTools(api,p=>permissions.has(p)),chat=createConversation({tools,help:()=>({body:'Fallback',id:'unknown'}),makeKey:()=> 'test-'+(++key)});return{chat,raw,menu,recipes,api,writes,permissions,tools};
}
test('word order and low-stock variants are understood without a generic fallback',async()=>{
 const f=fixture();f.raw.push({id:'none',name:'Duz',unit:'kg',qtyMilli:0},{id:'plenty',name:'Su',unit:'l',qtyMilli:10000});
 for(const question of ['ne var anbarda','anbarimda ne var','anbarda nələr var'])assert.equal(interpret(question).intent,'overview',question);
 const a=await f.chat.send('anbarimda az olan mallarin siyahisini ver');assert.match(a.body,/Duz: 0 kg/);assert.doesNotMatch(a.body,/Su:/);assert.match(a.body,/Minimum həddi/);
});
test('stock reason survives an inventory read but no write happens automatically',async()=>{
 const f=fixture();f.raw[0].qtyMilli=-16000;f.raw[0].name='doner';f.raw[0].unit='ədəd';
 await f.chat.send('doneri 20 eded artir');const read=await f.chat.send('ne var anbarda');assert.match(read.body,/gözləyən qalıq düzəlişiniz saxlanılıb/);
 const preview=await f.chat.send('faktiki sayim');assert.match(preview.body,/-16 ədəd → 4 ədəd/);assert.equal(f.writes.length,0);
 await f.chat.send('ləğv et');await f.chat.send('confirm');assert.equal(f.writes.length,0);
});
test('recipe requests ask for a real menu item and use actual ingredient quantities',async()=>{
 const f=fixture();const a=await f.chat.send('kalkulasiya yaratmaq isteyirem yeni');assert.match(a.body,/hansı menyu yeməyi/);await f.chat.send('Pizza');await f.chat.send('Un');await f.chat.send('250 qram');assert.equal(f.writes.length,0);const plan=await f.chat.send('setup:review');assert.match(plan.body,/Un: 0[.,]25 kg/);await f.chat.send('confirm');assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0],['recipe','pizza',[{ingredientId:'flour',qtyMilli:250}],[]]);
 await f.chat.send('confirm');assert.equal(f.writes.length,1);assert.equal(f.raw[0].qtyMilli,0,'Defining a recipe does not consume stock');
});
test('a recipe draft survives reading inventory and never guesses pizza ingredients',async()=>{
 const f=fixture();const a=await f.chat.send('kalkulasiya yarat pizza adinda olsun pizzaya neler daxildir elave et');assert.match(a.body,/Tərkibi və miqdarları siz seçirsiniz/);assert.doesNotMatch(a.body,/Pendir|Pomidor/);
 const stock=await f.chat.send('ne var anbarda');assert.match(stock.body,/Yarımçıq yaradılma/);await f.chat.send('setup:resume');await f.chat.send('Un');await f.chat.send('0,5');assert.match((await f.chat.send('setup:review')).body,/Un: 0[.,]5 kg/);assert.equal(f.writes.length,0);
});
test('new raw materials are created only after unit and confirmation, with stable replay identity',async()=>{
 const f=fixture();await f.chat.send('yeni mehsul yarat');await f.chat.send('setup:raw');await f.chat.send('Duz');await f.chat.send('setup:unit:kg');assert.equal(f.writes.length,0);await f.chat.send('confirm');assert.equal(f.writes.length,1);assert.equal(f.writes[0][1].name,'Duz');assert.equal(f.writes[0][1].id,undefined);assert.match(f.writes[0][1].sku,/ASSIST-/);assert.equal(f.writes[0][1].showInSale,false);await f.chat.send('confirm');assert.equal(f.writes.length,1);
 const draft={id:'retry',name:'Pendir',unit:'kg'};await f.tools.setupCreateRaw(draft,'key');await f.tools.setupCreateRaw(draft,'key');assert.equal(f.raw.filter(p=>p.name==='Pendir').length,1);
});
test('menu creation asks category and sale price, instead of inventing either',async()=>{
 const f=fixture();await f.chat.send('yeni mehsul yarat');await f.chat.send('setup:menu');await f.chat.send('Marqarit 28 sm');await f.chat.send('setup:category:food');const bad=await f.chat.send('qiymeti bilmirəm');assert.match(bad.body,/Qiyməti düzgün/);await f.chat.send('8,50');assert.equal(f.writes.length,0);await f.chat.send('confirm');assert.equal(f.writes[0][0],'menu');assert.equal(f.writes[0][1].priceMinor,850);assert.equal(f.writes[0][1].categoryId,'food');
});
test('a missing recipe target can first be created as a menu item and then costed',async()=>{
 const f=fixture();const a=await f.chat.send('kalkulasiya yarat Marqarit adinda olsun');assert.match(a.body,/tapmadım/);await f.chat.send('setup:new-menu');await f.chat.send('setup:category:food');await f.chat.send('12');await f.chat.send('confirm');assert.equal(f.writes[0][0],'menu');await f.chat.send('Un');await f.chat.send('0,250');await f.chat.send('setup:review');await f.chat.send('confirm');assert.equal(f.writes[1][0],'recipe');assert.equal(f.writes[1][1],f.writes[0][1].id);
});
test('existing recipes are not silently replaced and cancellations/permissions prevent writes',async()=>{
 const f=fixture();f.recipes.set('pizza',{lines:[{ingredientId:'flour',name:'Un',qtyMilli:100,unit:'kg'}],components:[]});assert.match((await f.chat.send('Pizza üçün kalkulyasiya yarat')).body,/artıq kalkulyasiya/);assert.equal(f.writes.length,0);
 f.permissions.delete('recipes.manage');assert.match((await f.chat.send('kalkulasiya yarat')).body,/icazələri tələb/);
 await f.chat.send('yeni mehsul yarat');await f.chat.send('setup:raw');await f.chat.send('Duz');await f.chat.send('setup:unit:kg');await f.chat.send('ləğv et');await f.chat.send('confirm');assert.equal(f.writes.length,0);
});
test('a recipe changed after preview is not overwritten on confirmation',async()=>{
 const f=fixture();await f.chat.send('Pizza üçün kalkulyasiya yarat');await f.chat.send('Un');await f.chat.send('0,250');await f.chat.send('setup:review');f.recipes.set('pizza',{lines:[{ingredientId:'flour',qtyMilli:500}],components:[]});const r=await f.chat.send('confirm');assert.match(r.body,/Kalkulyasiya dəyişib/);assert.equal(f.writes.length,0);
});

test('revoked permissions and account changes before a write stop creation',async()=>{
 const f=fixture();await f.chat.send('yeni mehsul yarat');await f.chat.send('setup:raw');await f.chat.send('Duz');await f.chat.send('setup:unit:kg');f.permissions.delete('inventory.manage');assert.match((await f.chat.send('confirm')).body,/icazəniz yoxdur/);assert.equal(f.writes.length,0);
 f.permissions.add('inventory.manage');let valid=true;f.api.inventory.ingredients=async()=>{valid=false;return{success:true,data:{ingredients:f.raw}}};await assert.rejects(()=>f.tools.setupCreateRaw({id:'stale',name:'Duz',unit:'kg'},'same-key',()=>valid),/stale/);assert.equal(f.writes.length,0);
});
test('an incomplete recipe response cannot be mistaken for an empty recipe',async()=>{
 const f=fixture();f.api.inventory.recipe=async()=>({success:true,data:{lines:[]}});assert.match((await f.chat.send('Pizza üçün kalkulyasiya yarat')).body,/components/);assert.equal(f.writes.length,0);
});

test('a capability question does not become a product name inside a creation draft',async()=>{
 const f=fixture();await f.chat.send('yeni mehsul yarat');await f.chat.send('setup:raw');await f.chat.send('sen ne bacarirsan');await f.chat.send('Duz');assert.equal(f.writes.length,0);const plan=await f.chat.send('setup:unit:kg');assert.match(plan.body,/Duz · kg/);assert.doesNotMatch(plan.body,/sen ne bacarirsan/);
});
