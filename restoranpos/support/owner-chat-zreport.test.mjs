// Z closes the day: readiness first, a typed "günü bağla", then "Təsdiq et"; open bills block it.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
test('open bills block the Z report and nothing closes',async()=>{const c=chat({help:unknown});
 const r=await c.send('z hesabat cixar');assert.match(r.body,/Günü hələ bağlamaq olmur: 2 açıq hesab/);assert.equal(c.state.z,undefined);});
test('Z needs the typed phrase and the button; a stray "Təsdiq et" alone does nothing',async()=>{const c=chat({help:unknown});c.state.tables.forEach(t=>t.orderId=null);
 const warn=await c.send('gunu bagla, z hesabati ver');assert.match(warn.body,/geri qaytarılmır/);assert.match(warn.body,/“günü bağla” yazın/);
 assert.match((await c.send('Təsdiq et')).body,/təsdiq gözləyən dəyişiklik yoxdur/);assert.equal(c.state.z,undefined);
 await c.send('z hesabati');const last=await c.send('günü bağla');assert.match(last.body,/Son təsdiq/);assert.equal(c.state.z,undefined);
 const done=await c.send('Təsdiq et');assert.equal(c.state.z,1);assert.match(done.body,/Z hesabatı №1/);assert.match(done.body,/Kassa günü bağlandı/);
 assert.match((await c.send('Təsdiq et')).body,/təsdiq gözləyən dəyişiklik yoxdur/);assert.equal(c.state.z,1,'never twice');});
