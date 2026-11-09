// Mixed messages from the real-core run of 2026-11-09: every part is answered, refused or named, none silently lost.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
test('refusals stay next to a command Groq also found (PIN + delete history + X report)',async()=>{
 const c=chat({help:unknown,understand:async()=>({kind:'commands',commands:['X hesabatı çıxar'],unsupported:['işçi pinlərini göstər','bütün sifarişləri sil'],ignored:[],reply:''})});
 const r=await c.send('isci pinlerini goster, butun sifarisleri sil, x hesabati cixart');
 assert.match(r.body,/X hesabatı çıxarılacaq/);assert.match(r.body,/PIN-ləri/);assert.match(r.body,/tarixçəsi silinmir/);});
test('"sən kimsən" filed by Groq as unsupported is answered, not forwarded',async()=>{
 const c=chat({help:unknown,profile:{name:'Panda Kafe'},understand:async()=>({kind:'commands',commands:['bugünkü satış'],unsupported:['salam sen kimsen','menim restoranimin adi nedir'],ignored:['bu gun hava necedir'],reply:''})});
 const r=await c.send('salam sen kimsen, menim restoranimin adi nedir, bu gun hava necedir, bugunku satis ne qederdir');
 assert.match(r.body,/köməkçisiyəm/);assert.match(r.body,/Panda Kafe/);assert.match(r.body,/Satış hesabatı/);assert.doesNotMatch(r.body,/komandaya ötürdüm/);});
test('a new several-part sentence drops an open confirmation and is read afresh',async()=>{let calls=0;
 const c=chat({help:unknown,understand:async t=>{calls++;return /printer/.test(t)?{kind:'commands',commands:['printeri test et'],unsupported:[],ignored:[],reply:''}:{kind:'commands',commands:['açıq masalar nə qədər işləyib','bugünkü satış'],unsupported:[],ignored:[],reply:''};}});
 assert.match((await c.send('printeri test et')).body,/Təsdiq edirsiniz/);
 const r=await c.send('aciq masalar ne qeder isleyib, bugunku satis ne qederdir, bir de hava');
 assert.equal(calls,2);assert.match(r.body,/2 istək/);assert.equal(c.state.jobs.length,0);});
test('a sum over nothing is "no data", not a dash',async()=>{
 const c=chat({help:unknown,understand:async()=>({kind:'data_question',commands:[],unsupported:[],ignored:[],reply:''}),writeSql:async()=>({sql:'SELECT NULL AS "Xərc (₼)"',explain:'Bu ayın xərcləri.'})});
 assert.match((await c.send('bu ay xerclerim ne qederdir')).body,/uyğun məlumat tapılmadı/);});
test('a part Groq dropped is put back (rules first, else a data question); "sən kimsən" in ignored is answered',async()=>{const asked=[];
 const c=chat({help:unknown,understand:async()=>({kind:'commands',commands:['ən çox satılan mallar'],unsupported:[],ignored:['salam sen kimsen'],reply:''}),writeSql:async q=>{asked.push(q);return{sql:'SELECT 12.5 AS "Orta çek (₼)"',explain:'Orta çek.'};}});
 const r=await c.send('salam sen kimsen, en cox satilan yemekler, ortalama cek ne qederdir');
 assert.match(r.body,/köməkçisiyəm/);assert.match(r.body,/Ən çox satılanlar/);assert.deepEqual(asked,['ortalama cek ne qederdir']);});
test('restaurant work Groq filed under ignored is answered; a two-word follow-on is not a new question',async()=>{const asked=[];
 const c=chat({help:unknown,understand:async()=>({kind:'commands',commands:['masa 1 nə qədər işləyib'],unsupported:[],ignored:['bugunku satis ne qederdir','bu gun hava necedir'],reply:''}),writeSql:async q=>{asked.push(q);return{sql:'',explain:''};}});
 const r=await c.send('1 masada ne var, ne yeyibler, bu gun hava necedir, bugunku satis ne qederdir');
 assert.match(r.body,/Satış hesabatı/);assert.match(r.body,/«bu gun hava necedir»/);assert.deepEqual(asked,[]);});
