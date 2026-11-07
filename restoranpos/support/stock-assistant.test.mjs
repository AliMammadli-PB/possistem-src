import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalize,rankProducts,interpret,parseDecimal,createTools,compactHelp} from './stock-assistant.mjs';
const products=[{id:'cola',name:'Coca-Cola 0.5 l',sku:'COLA',unit:'ədəd',salePriceMinor:250,updatedAt:10,active:1},{id:'kola',name:'Kola 1 l',sku:'K-1',unit:'ədəd',salePriceMinor:300,updatedAt:20,active:1},{id:'water',name:'Sirab',unit:'ədəd'}];
test('Azerbaijani intents, partial typing, brand aliases and misspellings',()=>{
 assert.equal(normalize('Şəkər ƏRZAQ İÇKİ'),'seker erzaq icki');
 assert.equal(interpret('anbarda məhsulu dəyişmək istəyirəm').intent,'edit');assert.equal(interpret('anbarda məhsulu dəyişmək istəyirəm').query,'');
 assert.equal(interpret('kola nə qədər qalıb?').query,'kola');assert.equal(interpret('kola nə qədər qalıb?').intent,'lookup');
 assert.deepEqual(new Set(rankProducts(products,'ko').map(r=>r.product.id)),new Set(['cola','kola']));
 assert.equal(rankProducts(products,'kolaa')[0].fuzzy,true);assert.equal(rankProducts(products,'kolanın').length,2);
 assert.equal(rankProducts(products,'unknown').length,0);assert.equal(interpret('ləğv').intent,'cancel');
});
test('money/quantity parse exact decimal values and reject unsafe notation',()=>{
 assert.equal(parseDecimal('0,29',2),29);assert.equal(parseDecimal('12.345',3),12345);
 for(const value of['1e4','-1','NaN','1.001','2foo','Infinity','9007199254740991'])assert.equal(parseDecimal(value,2),null);
 assert.equal(compactHelp({body:'text'}).includes('kola'),false);assert.ok(compactHelp({body:'Anbar: 32 yoxlama\n'.repeat(100)}).length<400);
});
test('tools fetch real IPC, scope stock to a warehouse, and patch only the requested field',async()=>{
 const calls=[];const ok=data=>({success:true,data});const api={inventory:{ingredients:async()=>ok({ingredients:products,assistantToolsVersion:1}),warehouses:async()=>ok({warehouses:[{id:'w',name:'Əsas'}],homeWarehouseId:'w'}),levels:async w=>{assert.equal(w,'w');return ok({levels:[{id:'cola',qtyMilli:12000}]})},saveIngredient:async input=>{calls.push(input);return ok({patched:true})},adjust:async input=>{calls.push(input);return ok({})}}};
 const tools=createTools(api,()=>true),snapshot=await tools.read('cola','w');assert.equal(snapshot.qtyMilli,12000);
 await tools.save(snapshot,'price','3,25','','key');assert.deepEqual(calls[0],{id:'cola',cardPatch:{salePriceMinor:325},expectedUpdatedAt:10,idempotencyKey:'key'});
 await tools.save(snapshot,'quantity','15','Sayım','qty');assert.equal(calls[1].qtyDeltaMilli,3000);assert.equal(calls[1].expectedQtyMilli,12000);
 await assert.rejects(()=>tools.read('cola','foreign'),/anbar seçin/);await assert.rejects(()=>createTools(api,()=>false).catalogue(),/icazəniz/);
 api.inventory.levels=async()=>({success:false,error:{message:'offline'}});await assert.rejects(()=>tools.read('cola','w'),/offline/);
 await assert.rejects(()=>tools.save({...snapshot,version:0},'price','1','','old'),/dəstəkləmir/);
});
