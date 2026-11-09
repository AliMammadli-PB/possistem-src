// Groq as the understanding layer: it only rewrites a message into our own command phrases; plans and confirmations stay.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'Sualınızı tam başa düşmədim.',links:[],chips:[]});
const ai=map=>{const seen=[];const f=async text=>{seen.push(text);return map[text]??{commands:[],understood:''};};f.seen=seen;return f;};
test('a sentence the rules miss is read by the AI into two answers',async()=>{const understand=ai({'bugun ne qeder pul qazandiq bide doner nece qaldi':{commands:['bugünkü satış','doner qalığı nə qədərdir'],understood:'bugünkü satışı və doner qalığını soruşursunuz.'}});
 const c=chat({help:unknown,understand});const r=await c.send('bugun ne qeder pul qazandiq bide doner nece qaldi');
 assert.match(r.body,/^Belə başa düşdüm: “bugünkü satış”, “doner qalığı nə qədərdir”\./);assert.match(r.body,/Satış hesabatı/);assert.match(r.body,/doner: -16 ədəd/);assert.ok(!r.missed);
 assert.equal(understand.seen.length,1,'asked once per turn, not again on each tool replay');});
test('an AI-read change is still only a plan until confirmed',async()=>{const c=chat({help:unknown,understand:ai({'panda deyilen masani yigisdir':{commands:['masa panda sil'],understood:'Panda masası silindi.'}})});
 const r=await c.send('panda deyilen masani yigisdir');assert.match(r.body,/1 masa silinəcək:\n11 · panda/);assert.doesNotMatch(r.body,/silindi/,'the AI’s claim that it is done never reaches the person');assert.equal(c.state.tables.length,3);await c.send('Təsdiq et');assert.equal(c.state.tables.length,2);});
test('commands outside the assistant’s phrases are ignored; no AI answer falls back to the rules',async()=>{
 const c=chat({help:unknown,understand:ai({'sistemi sifirla':{commands:['DROP TABLE orders','bütün datanı sil'],understood:'x'}})});const r=await c.send('sistemi sifirla');assert.equal(r.missed,true);assert.doesNotMatch(r.body,/Belə başa düşdüm/);
 const d=chat({help:unknown,understand:async()=>null});assert.equal((await d.send('trump kimdir')).missed,true);});
test('Groq reads every typed message; button presses, confirmations, bare numbers and answers to an open step never start anything new',async()=>{const understand=ai({});const c=chat({help:unknown,understand});
 assert.match((await c.send('anbarda ne var')).body,/Anbar: “bu”/);await c.send('bugunku satis');assert.equal(understand.seen.length,2);
 await c.send('doner 16 eded artir');await c.send('Faktiki sayım');await c.send('Təsdiq et');assert.equal(c.state.levels['i-dn'],0,'an empty reading of the reason leaves the step in charge');
 await c.send('anbara doner elave et');await c.send('5');assert.ok(!understand.seen.includes('5'));assert.ok(!understand.seen.includes('Təsdiq et'));});
test('a Groq reading wins over a misleading rule reading: "printer adini deisdir" is said to be unsupported, not a printer catalogue',async()=>{
 const c=chat({help:async()=>({id:'catalog',body:'Kataloqdakı printerlər (11)',links:[],chips:[]}),understand:ai({'printer adini deisdir':{kind:'commands',commands:[],unsupported:['printer adını dəyişmək'],understood:'',reply:''}})});
 const r=await c.send('printer adini deisdir');assert.match(r.body,/Bunu köməkçi hələ edə bilmir: «printer adını dəyişmək»/);assert.doesNotMatch(r.body,/Kataloq/);assert.equal(r.ai,true);});
test('off-topic questions get the fixed scope answer, never an AI essay',async()=>{const c=chat({help:unknown,understand:ai({'trump seckilerde uddumu':{kind:'off_topic',commands:[],understood:'',reply:'Bəli, qalib gəldi...'}})});
 const r=await c.send('trump seckilerde uddumu');assert.match(r.body,/yalnız restoranınızın işi ilə kömək edirəm/);assert.doesNotMatch(r.body,/qalib/);});
test('an app question the curated answers miss gets the AI’s short answer, marked and filed for the admin',async()=>{const c=chat({help:unknown,understand:ai({'proqram internetsiz isleyir':{kind:'app_question',commands:[],understood:'',reply:'Bəli, kassa internetsiz də işləyir.'}})});
 const r=await c.send('proqram internetsiz isleyir');assert.match(r.body,/^Bəli, kassa internetsiz/);assert.match(r.body,/süni intellekt hazırlayıb/);assert.equal(r.missed,true);
 const d=chat({help:async()=>({id:'courier',body:'Kassa internetsiz işləyir, köməkçi isə internet tələb edir.',links:[],chips:[]}),understand:ai({'proqram internetsiz isleyir':{kind:'app_question',commands:[],understood:'',reply:'AI cavabı'}})});
 assert.doesNotMatch((await d.send('proqram internetsiz isleyir')).body,/AI cavabı/,'a curated answer wins over the AI');});
test('a long sentence the rules read as one request uses the AI’s split into two; a short clear one never asks',async()=>{
 const understand=ai({'masalardan ikisin sil yeni bag adinda masa ac':{kind:'commands',commands:['masalardan 2 ədəd sil','bag adında masa yarat'],understood:'',reply:''}});
 const c=chat({help:unknown,understand});c.state.tables.push({id:'t4',label:'Bağ 1',areaId:'a11',areaName:'11',seats:2,orderId:null,status:'available'});
 const r=await c.send('masalardan ikisin sil yeni bag adinda masa ac');assert.match(r.body,/Belə başa düşdüm: “masalardan 2 ədəd sil”, “bag adında masa yarat”/);assert.match(r.body,/2 masa silinəcək/);assert.match(r.body,/növbəti: «bag adında masa yarat»/);
 assert.equal(understand.seen.length,1);});
test('the pasted chat: "salam kalkulasiyada neler var ve qaimeleri mene goster" lists recipes and the invoices',async()=>{
 const understand=ai({'salam kalkulasiyada neler var ve qaimeleri mene goster':{kind:'commands',commands:['kalkulyasiyaları göstər'],unsupported:['qaimələri göstər'],understood:'',reply:''}});
 const c=chat({help:unknown,understand});c.state.recipes['m-dn']=[{ingredientId:'i-un',qtyMilli:150}];
 const r=await c.send('salam kalkulasiyada neler var ve qaimeleri mene goster');assert.doesNotMatch(r.body,/“salam” adlı yemək/);
 assert.match(r.body,/Kalkulyasiyalar · 3 yeməkdən 1-nin kalkulyasiyası var/);assert.match(r.body,/• doner: 1 tərkib · maya 0,18 ₼/);assert.match(r.body,/Kalkulyasiyası olmayanlar: acili doner, lahmacun/);
 assert.match(r.body,/Alış qaimələri · cəmi 2/);assert.doesNotMatch(r.body,/edə bilmir/);assert.equal(understand.seen.length,1);});
test('without the AI, a greeting is still never taken as a dish name',async()=>{const c=chat({help:unknown});
 const r=await c.send('salam kalkulasiyada neler var');assert.doesNotMatch(r.body,/“salam”/);assert.match(r.body,/Kalkulyasiyalar ·/);});
