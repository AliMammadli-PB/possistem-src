// The owner's chat of 2026-11-09: printer problem → test, "artır" without a number, "xalig", X report on an old open day.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'printer_problem',body:'Printer çap etmirsə: kabeli yoxlayın…',links:[],chips:[]});
test('"printer işləmir": Groq’s "printeri test et" filed as unsupported runs the printer test instead of a refusal',async()=>{
 const c=chat({help:unknown,understand:async()=>({kind:'commands',commands:[],unsupported:['printeri test et'],reply:''})});
 const r=await c.send('printer islemir');assert.doesNotMatch(r.body,/edə bilmir/);assert.match(r.body,/Printer: USB çek printeri/);});
test('"acılı dönəri artır" without a number asks how many, then plans the increase',async()=>{const c=chat({help:async()=>({id:'unknown',body:'x',links:[],chips:[]})});
 const r=await c.send('acili doneri artir indide');assert.match(r.body,/“acili doner” anbarda var\. Neçə ədəd artıraq\?/);
 assert.match((await c.send('5')).body,/0 ədəd → 5 ədəd/);});
test('"xalig" is offered back as "qalıq"',async()=>{const c=chat({help:async()=>({id:'unknown',body:'x',links:[],chips:[]})});
 assert.match((await c.send('xalig')).body,/Bunu demək istəyirdiniz: “qalıq”\?/);});
test('an X report on a business day opened days ago says the day is still open',async()=>{const c=chat({help:async()=>({id:'unknown',body:'x',links:[],chips:[]})});
 await c.send('x hesabat cixar');const r=await c.send('Təsdiq et');assert.match(r.body,/Diqqət: kassa günü 8 noyabr tarixindən bəri bağlanmayıb/);});
