// Stock work: write-off with a reason, goods receipt with supplier and price (updates stock and cost), "unun kilosu 3 manat".
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'Sualınızı tam başa düşmədim.',links:[],chips:[]});
test('"un 2 kq tökülüb" plans a write-off with the reason and runs once after confirmation',async()=>{const c=chat({help:unknown});
 const plan=await c.send('2 kq un tokuldu');assert.match(plan.body,/Silinmə \(itki\):\nUn · bu\n2 kq silinəcək, səbəb: Tökülüb\nQalıq: 25 → 23 kq/);assert.equal(c.state.levels['i-un'],25000);
 const done=await c.send('Təsdiq et');assert.match(done.body,/Silindi: Un 2 kq \(Tökülüb\)\. Qalıq: 23 kq/);assert.equal(c.state.levels['i-un'],23000);assert.equal(c.state.wastes.length,1);});
test('a write-off without a reason asks for one',async()=>{const c=chat({help:unknown});
 const ask=await c.send('doner 2 eded silinme');assert.match(ask.body,/niyə silinir/);assert.ok(ask.choices.some(x=>x.value==='Xarab olub'));
 assert.match((await c.send('Xarab olub')).body,/səbəb: Xarab olub/);});
test('"un 25 kq aldım 3 manatdan" asks the supplier, then receives: stock and cost change',async()=>{const c=chat({help:unknown});
 const who=await c.send('un 25 kq aldım 3 manatdan');assert.match(who.body,/Un kimdən alınıb\?/);
 const plan=await c.send('stockops:supplier:s2');assert.match(plan.body,/Tədarükçü: Un dünyası · Anbar: bu\n• Un: 25 kq × 3,00 ₼ = 75,00 ₼\nQəbuldan sonra qalıq: 25 → 50 kq; maya qiyməti 3,00 ₼\/kq olacaq/);
 const done=await c.send('Təsdiq et');assert.match(done.body,/Mal qəbulu yazıldı: Un dünyası, Un 25 kq, cəmi 75,00 ₼/);assert.equal(c.state.levels['i-un'],50000);assert.equal(c.state.ingredients.find(i=>i.id==='i-un').costMinor,300);
 assert.equal(c.state.saved.length,1);assert.equal(c.state.received,1);});
test('"unun kilosunu 3 manat elə" offers a receipt and asks only what is missing',async()=>{const c=chat({help:unknown});c.state.suppliers=[{id:'s1',name:'Ət evi',active:1}];
 const r=await c.send('unun kilosunu 3 manat ele');assert.match(r.body,/Maya qiyməti mal qəbulu ilə yenilənir/);assert.match(r.body,/Neçə kq Un alınıb\?/);
 const plan=await c.send('10');assert.match(plan.body,/Tədarükçü: Ət evi/);assert.match(plan.body,/10 kq × 3,00 ₼ = 30,00 ₼/);});
