// Reports the till keeps: X report (confirmed, printed once), best sellers, purchase invoices, courier report, stock value.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'Sualınızı tam başa düşmədim.',links:[],chips:[]});
test('"x hesabat cixar" is a plan; after confirmation the report is printed once and summarised',async()=>{const c=chat({help:unknown});
 const plan=await c.send('x hesabat cixar');assert.match(plan.body,/X hesabatı çıxarılacaq/);assert.match(plan.body,/Gün bağlanmır/);assert.equal(c.state.x,undefined,'nothing before confirmation');
 const r=await c.send('Təsdiq et');assert.equal(c.state.x,1);assert.match(r.body,/X hesabatı №1 · 2026-11-08/);assert.match(r.body,/• Nağd: 122,60 ₼ \(7\)\n• Kart: 50,00 ₼ \(2\)/);assert.match(r.body,/Kassada gözlənilən nağd: 222,60 ₼/);assert.match(r.body,/Açıq masalar: 2 \(43,00 ₼\)/);
 assert.match((await c.send('Təsdiq et')).body,/təsdiq gözləyən dəyişiklik yoxdur/);assert.equal(c.state.x,1,'a second confirm never prints again');});
test('best sellers, purchase invoices (with the PDF pointer), courier report and stock value',async()=>{const c=chat({help:unknown});
 assert.match((await c.send('en cox satilan mallar')).body,/1\. doner — 31 ədəd · 155,00 ₼/);
 const q=await c.send('qaimelerimi goster');assert.match(q.body,/Alış qaimələri · cəmi 2, tədarükçülərə borc 120,00 ₼/);assert.match(q.body,/• №Q-8 · Un dünyası · 90,00 ₼ · sifariş edilib/);
 const k=await c.send('catdirilmadaki bu ayin statistikasin goster mene');assert.match(k.body,/Kuryer hesabatı · Bu ay\n• Elvin: 5 çatdırılma \(4 tamamlanıb, 1 alınmayıb\) · sifarişlər 75,00 ₼/);assert.doesNotMatch(k.body,/Rauf/);
 assert.match((await c.send('anbarin deyeri')).body,/Anbarın maya dəyəri: 680,00 ₼ \(5 mal, orta maya üsulu\)/);});
