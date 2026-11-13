// The owner's chat of the evening of 2026-11-08: pay, set stock "so it is not negative", capabilities, X report.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'about',body:'Mən Possistem köməkçisiyəm — avtomatik cavab verən bilik bazası. Market: “cola qalığını 50 et” (şifrə ilə təsdiq)',links:[],chips:[]});
test('"ödəniş etmək istəyirəm" offers the payment page',async()=>{const c=chat({help:unknown});await c.send('aboneliyme bax');
 const r=await c.send('odenis etmek isteyirem');assert.match(r.body,/ödəniş düyməsini seçin/);assert.ok(r.choices.some(x=>x.value==='subscription:pay'));});
test('"doneri 24 et menfide olmasin" plans stock 24, not the negative list',async()=>{const c=chat({help:unknown});
 const r=await c.send('doneri 24 et menfide olmasin');assert.match(r.body,/-16 ədəd → 24 ədəd/);assert.doesNotMatch(r.body,/Yalnız mənfi/);
 await c.send('Faktiki sayım');await c.send('Təsdiq et');assert.equal(c.state.levels['i-dn'],24000);});
test('"nələr edə bilirsən" and "imkanları de" describe this assistant, never the Market knowledge-base text',async()=>{const c=chat({help:unknown});
 for(const q of ['neler ede bilirsen','imkanlari de']){const r=await c.send(q);assert.match(r.body,/Restoranınızda bunları edə bilərəm/);assert.match(r.body,/panda zalına 5 masa əlavə et/);assert.doesNotMatch(r.body,/Market|şifrə ilə/);}});
test('a Z report Groq files as unsupported goes into the real Z flow',async()=>{const c=chat({help:unknown,understand:async()=>({kind:'commands',commands:[],unsupported:['Z hesabatı çıxar'],reply:''})});
 assert.match((await c.send('gunun sonunu cixar z ile')).body,/Günü hələ bağlamaq olmur|günü bağla/);assert.equal(c.state.z,undefined);});
test('a new question while a stock plan waits for confirmation is still read by Groq',async()=>{const seen=[];
 const c=chat({help:unknown,understand:async text=>{seen.push(text);return text==='qaimeleri pdf formada mene ver'?{kind:'commands',commands:[],unsupported:['qaimələri PDF formada vermək'],reply:''}:{kind:'commands',commands:[],unsupported:[],reply:''};}});
 await c.send('doneri 24 et menfide olmasin');await c.send('Faktiki sayım');const r=await c.send('qaimeleri pdf formada mene ver');
 assert.ok(seen.includes('qaimeleri pdf formada mene ver'));assert.match(r.body,/PDF hazırdır: Alış qaimələri/);assert.equal(r.files[0].name,"Alış qaimələri.pdf");assert.equal(c.state.levels['i-dn'],-16000,'nothing saved');});
