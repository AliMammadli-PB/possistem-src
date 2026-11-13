// PDF reports: fixed queries, the till's save dialog, and a PDF button under data answers.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
test('"son 4 günün ödənişlərini pdf ver" runs a fixed payments query and saves the PDF',async()=>{const c=chat({help:unknown});
 const r=await c.send('son 4 gunun odenisini pdf ver');assert.match(r.body,/^PDF hazırdır: Ödənişlər · son 4 gün · 2 sətir/);assert.equal(r.files[0].name,'Ödənişlər · son 4 gün.pdf');assert.match(r.files[0].path,/Possistem\\Köməkçi\\Ödənişlər · son 4 gün\.pdf$/);
 assert.match(c.state.queries.at(-1),/FROM payments p WHERE p\.status IN \('approved','refunded'\)/);assert.match(c.state.pdfs[0].html,/<th>Ofisiant<\/th>/);assert.match(c.state.pdfs[0].html,/Cəmi/);});
test('"qaimeni pdf olaraq ver" and "keçən ayın satışını pdf et" use the right tables and periods',async()=>{const c=chat({help:unknown});
 await c.send('qaimeni pdf olaraq ver mene');assert.match(c.state.queries.at(-1),/FROM purchase_orders po LEFT JOIN suppliers/);
 await c.send('kecen ayin satisini pdf et');assert.match(c.state.queries.at(-1),/FROM orders o WHERE o\.status IN \('paid','closed'\)/);assert.match(c.state.pdfs.at(-1).name,/Satış · keçən ay/);});
test('a data answer offers "PDF kimi yüklə"; pressing it reruns the same query into a PDF; a closed dialog saves nothing',async()=>{
 const c=chat({help:unknown,understand:async()=>({kind:'data_question',commands:[],unsupported:[],reply:''}),writeSql:async()=>({sql:'SELECT 1 AS "x"',explain:'Ofisiantların satışı.'})});
 const r=await c.send('kecen hefte hansi ofisiant en cox satib');assert.ok(r.choices.some(x=>x.value==='pdf:last'));
 const p=await c.send('pdf:last');assert.match(p.body,/PDF hazırdır: Ofisiantların satışı/);assert.equal(p.files[0].name,'Ofisiantların satışı.pdf');assert.equal(c.state.queries.at(-1),'SELECT 1 AS "x"');
 // An older till still asks where to save; closing that dialog saves nothing.
 c.state.oldTill=true;c.state.cancelPdf=true;assert.match((await c.send('pdf:last')).body,/PDF saxlanmadı/);});
test('"bunu pdf ver" with nothing before asks what to export',async()=>{const c=chat({help:unknown});
 const r=await c.send('bunu pdf ver');assert.match(r.body,/Hansı məlumatı PDF kimi verim/);assert.equal(c.state.pdfs,undefined);});
