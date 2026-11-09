// Read-only data questions: Groq writes one SELECT, the till runs it with its own limits, the answer is formatted here.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'Sualınızı tam başa düşmədim.',links:[],chips:[]});
const asks=async()=>({kind:'data_question',commands:[],unsupported:[],reply:''});
test('"keçən həftə hansı ofisiant ən çox satıb" is answered from a read-only query',async()=>{let asked=0;
 const c=chat({help:unknown,understand:asks,writeSql:async q=>{asked++;assert.match(q,/ofisiant/);return{sql:'SELECT u.full_name AS "Ofisiant", ROUND(SUM(o.total_minor)/100.0,2) AS "Satış (₼)" FROM orders o JOIN users u ON u.id=o.user_id GROUP BY u.id ORDER BY 2 DESC LIMIT 50',explain:'Keçən həftə ofisiantların satışı.'};}});
 const r=await c.send('kecen hefte hansi ofisiant en cox satib');assert.match(r.body,/^Keçən həftə ofisiantların satışı\.\n\n1\. Ofisiant: Aysel · Satış \(₼\): 412,5\n2\. Ofisiant: Rauf · Satış \(₼\): 230/);
 assert.match(r.body,/yalnız oxunub; heç nə dəyişməyib/);assert.equal(r.ai,true);assert.equal(asked,1);assert.equal(c.state.queries.length,1);});
test('a query the till refuses is explained and filed, nothing else happens',async()=>{const c=chat({help:unknown,understand:asks,writeSql:async()=>({sql:'SELECT pin_hash FROM users',explain:'x'})});
 const r=await c.send('isci pinlerini goster');assert.match(r.body,/Məlumatı oxumaq alınmadı: Bu məlumat köməkçiyə bağlıdır: users\.pin_hash/);assert.equal(r.missed,true);});
test('no query from Groq: a clear "could not answer" and nothing is run',async()=>{const c=chat({help:unknown,understand:asks,writeSql:async()=>({sql:'',explain:''})});
 const r=await c.send('ayin en yaxsi gunu hansi idi hava necə idi');assert.match(r.body,/məlumatla cavablandıra bilmədim/);assert.equal(c.state.queries,undefined);});
