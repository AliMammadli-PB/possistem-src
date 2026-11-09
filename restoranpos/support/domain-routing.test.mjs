import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConversation,createTools,interpret} from './conversation.mjs';
function fixture({version=1,paid=false,payments=true}={}){
 let qty=-16000;const calls=[],writes=[],rights=new Set(['inventory.view','inventory.adjust','inventory.manage','catalog.manage','order.view']);
 const products=[{id:'d',name:'doner',unit:'ədəd',salePriceMinor:500,sku:'D',updatedAt:1},{id:'a',name:'acili doner',unit:'ədəd',salePriceMinor:600,sku:'A',updatedAt:1}];
 const ok=data=>({success:true,data});
 const api={inventory:{ingredients:async()=>{calls.push('catalogue');return ok({ingredients:products,assistantToolsVersion:version})},warehouses:async()=>ok({warehouses:[{id:'w',name:'Əsas'}],homeWarehouseId:'w'}),levels:async()=>ok({levels:[{id:'d',qtyMilli:qty},{id:'a',qtyMilli:0}]}),adjust:async p=>{if(p.expectedQtyMilli!==qty)return{success:false,error:{message:'Qalıq dəyişib'}};writes.push(p);qty+=p.qtyDeltaMilli;return ok({})}},tables:{list:async()=>{calls.push('tables');return ok({tables:[{id:'t',label:'1',areaName:'Zal',orderId:'o',totalMinor:1000,paidMinor:200},{id:'free',label:'2',orderId:null}]})}},orders:{get:async id=>{assert.equal(id,'o');calls.push('order');return ok({items:[{name:'doner',quantity:2,lineTotalMinor:1000},{name:'Ləğv edilmiş',status:'voided',quantity:1,lineTotalMinor:100}]})}}};
 const billing={status:async()=>{calls.push('billing');return ok({paymentsAvailable:payments,subscriptions:[{product:'restaurant',state:paid?'active':'awaiting_payment',monthlyAmountMinor:3000,hasPaidSubscription:paid,paidUntil:paid?new Date(Date.now()+86400000*7).toISOString():null}]})},open:async()=>{calls.push('payment-open');return ok({opened:true})}};
 const help=()=>({id:'unrelated',body:'This would have been the wrong generic sales answer.'});
 const tools=createTools(api,key=>rights.has(key),{billing}),chat=createConversation({tools,help,makeKey:()=> 'qa-key'});
 return{chat,api,billing,calls,writes,products,rights,tools,getQty:()=>qty};
}
test('reported phrases route to the correct domain before a stock search',()=>{
 assert.equal(interpret('abone odenisi etmek isteyirem').intent,'subscription');assert.equal(interpret('aboneme ne qeder var?').intent,'subscription');assert.equal(interpret('masalarimda ne var').intent,'tables');
 assert.deepEqual(interpret('anbardaki doneri 5 eded artir').quantity,{operation:'increase',value:'5'});
 assert.deepEqual(interpret('doneri 17 ele').quantity,{operation:'set',value:'17'});
 assert.equal(interpret('kola qiymətini 3,25 et').field,'price');
});
test('increase and absolute stock requests are distinct, confirmed and never edit the spicy variant',async()=>{
 const f=fixture();await f.chat.send('anbarda ne var');
 const increased=await f.chat.send('anbardaki doneri 5 eded artir');assert.match(increased.body,/-16 ədəd → -11 ədəd/);assert.match(increased.body,/Səbəbini yazın/);assert.equal(f.writes.length,0);
 const preview=await f.chat.send('Faktiki sayım');assert.match(preview.body,/-16 ədəd → -11 ədəd/);await f.chat.send('təsdiq et');assert.equal(f.getQty(),-11000);assert.equal(f.writes[0].ingredientId,'d');assert.equal(f.writes[0].qtyDeltaMilli,5000);
 const set=await f.chat.send('doneri 17 ele');assert.match(set.body,/-11 ədəd → 17 ədəd/);await f.chat.send('Sayım');await f.chat.send('confirm');assert.equal(f.getQty(),17000);assert.equal(f.writes[1].qtyDeltaMilli,28000);
 await f.chat.send('confirm');assert.equal(f.writes.length,2);
});
test('decimal quantities are preserved and piece quantities require whole numbers',async()=>{
 const f=fixture();const a=await f.chat.send('doneri 0,5 eded artir');assert.match(a.body,/tam olmalıdır/);assert.equal(f.writes.length,0);
 f.products[0].unit='kq';const b=await f.chat.send('doneri 0,5 kq artir');assert.match(b.body,/-15[.,]5 kq/);
});
test('a fresh absolute request replaces a pending increase reason',async()=>{
 const f=fixture();await f.chat.send('doneri 5 artir');assert.match((await f.chat.send('doneri 17 ele')).body,/17 ədəd/);await f.chat.send('Sayım');await f.chat.send('confirm');assert.equal(f.getQty(),17000);assert.equal(f.writes.length,1);
});
test('subscription and tables break out of stale product clarification and never search inventory',async()=>{
 const f=fixture();await f.chat.send('unknown ne qeder qalib');const before=f.calls.filter(x=>x==='catalogue').length;
 const payment=await f.chat.send('abone odenisi etmek isteyirem');assert.match(payment.body,/Restoran POS/);assert.match(payment.body,/30[.,]00/);assert.equal(payment.choices[0].value,'subscription:pay');assert.ok(!f.calls.includes('payment-open'),'Asking cannot open a payment or charge a card');
 assert.match((await f.chat.send('aboneme ne qeder var?')).body,/Restoran POS/);
 const tables=await f.chat.send('masalarimda ne var');assert.match(tables.body,/Zal · 1/);assert.match(tables.body,/10[.,]00/);
 const details=await f.chat.send(tables.choices[0].value);assert.match(details.body,/doner × 2/);assert.doesNotMatch(details.body,/Ləğv edilmiş/);assert.equal(f.calls.filter(x=>x==='catalogue').length,before);
});
test('paid subscription shows the deadline and cannot open a duplicate payment',async()=>{
 const f=fixture({paid:true});const a=await f.chat.send('aboneme ne qeder var');assert.match(a.body,/Son tarix/);assert.match(a.body,/gün .*saat qalıb/);assert.match(a.body,/təkrar ödəniş lazım deyil/);assert.equal(a.choices.length,0);await assert.rejects(()=>f.tools.openPayment(),/artıq ödənilib/);assert.ok(!f.calls.includes('payment-open'));
});
test('only a current explicit choice opens the account-scoped payment handoff',async()=>{
 const f=fixture();const a=await f.chat.send('abone odenisi etmek isteyirem');await f.chat.send(a.choices[0].value);assert.equal(f.calls.filter(x=>x==='payment-open').length,1);await f.chat.send('subscription:pay');assert.equal(f.calls.filter(x=>x==='payment-open').length,1);
 const blocked=fixture({payments:false});assert.equal((await blocked.chat.send('abone odenisi')).choices.length,0);await assert.rejects(()=>blocked.tools.openPayment(),/açıq deyil/);
 let valid=true;f.billing.status=async()=>{valid=false;return{success:true,data:{paymentsAvailable:true,subscriptions:[]}}};await assert.rejects(()=>f.tools.openPayment(()=>valid),/stale/);assert.equal(f.calls.filter(x=>x==='payment-open').length,1);
});
test('unrelated business questions invalidate a pending stock approval',async()=>{
 const f=fixture();await f.chat.send('doneri 17 ele');await f.chat.send('Sayım');await f.chat.send('aboneme ne qeder var');await f.chat.send('confirm');assert.equal(f.writes.length,0);
});
test('permissions, missing APIs and old core failures are honest and do not mutate data',async()=>{
 const f=fixture({version:0});await f.chat.send('doneri 17 ele');await f.chat.send('Sayım');assert.match((await f.chat.send('confirm')).body,/köhnə POS nüvəsi/);assert.equal(f.writes.length,0);assert.equal((await f.chat.send('confirm')).choices.length,0);
 f.rights.delete('order.view');assert.match((await f.chat.send('masalarimda ne var')).body,/icazəniz yoxdur/);
 f.billing.status=async()=>({success:false,error:{message:'Server bağlantısı yoxdur'}});assert.match((await f.chat.send('aboneme ne qeder var')).body,/Server bağlantısı yoxdur/);
});

test('specified measurement units are converted exactly, never silently treated as pieces',async()=>{
 const f=fixture();const bad=await f.chat.send('doneri 5 kq artir');assert.match(bad.body,/vahidinə uyğun/);assert.equal(f.writes.length,0);
 f.products[0].unit='kg';const grams=await f.chat.send('doneri 500 qram artir');assert.match(grams.body,/-15[.,]5 kg/);await f.chat.send('Faktiki sayım');await f.chat.send('confirm');assert.equal(f.getQty(),-15500);assert.equal(f.writes[0].qtyDeltaMilli,500);
});
test('inventory list phrasing routes to native data and table deletion is never interpreted as a read',async()=>{const f=fixture();for(const text of ['anbarda mehsullarimin siyahisini ver','anbarımdakı məhsulların siyahısını göstər','bütün mallarımı göstər','stok listesini goster']){assert.equal(interpret(text).intent,'overview',text);assert.match((await f.chat.send(text)).body,/doner: -16/);}assert.equal(interpret('butun masalarimi sil').intent,'table_delete');const before=f.calls.length;const deleted=await f.chat.send('butun masalarimi sil');assert.doesNotMatch(deleted.body,/canlı yerli məlumat/);assert.match(deleted.body,/silinməyib/);assert.equal(f.calls.length,before);assert.equal(f.writes.length,0);});
test('inventory diagnostics read actual low stock; unsupported deletion clears a stale stock approval',async()=>{const f=fixture();const check=await f.chat.send('problem var anbarda kontrol et');assert.match(check.body,/doner: -16 ədəd/);assert.match(check.body,/Qalıqları yoxladım/);assert.equal(f.writes.length,0);await f.chat.send('doneri 5 artir');await f.chat.send('Sayım');await f.chat.send('butun masalarimi sil');await f.chat.send('confirm');assert.equal(f.writes.length,0);});
test('signed-in inventory requests still enforce native staff permissions',async()=>{const f=fixture();f.rights.delete('inventory.view');const result=await f.chat.send('anbarda mehsullarimin siyahisini ver');assert.match(result.body,/icazəniz yoxdur/);assert.doesNotMatch(result.body,/daxil olun/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);});
test('diagnostics ask for a warehouse before claiming to have checked stock',async()=>{const f=fixture();f.api.inventory.warehouses=async()=>({success:true,data:{warehouses:[{id:'one',name:'Birinci'},{id:'two',name:'İkinci'}]}});const response=await f.chat.send('problem var anbarda kontrol et');assert.match(response.body,/Hansı anbara/);assert.doesNotMatch(response.body,/Qalıqları yoxladım/);assert.equal(f.writes.length,0);});

test('subscription payment intent offers a clearly named action without charging or opening anything',async()=>{const f=fixture();const r=await f.chat.send('aboneliymi odemek isteyirem');assert.match(r.body,/aşağıdakı ödəniş düyməsini/);assert.ok(r.choices.some(c=>c.value==='subscription:pay'));assert.equal(f.calls.includes('payment-open'),false);await f.chat.send('subscription:pay');assert.equal(f.calls.filter(c=>c==='payment-open').length,1);});
