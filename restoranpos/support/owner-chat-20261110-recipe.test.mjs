// cakopc@gmail.com, 2026-11-10: the lahmacun recipe was never saved. "kalkulyasiyanı göstər" said "no recipe" and
// "kalkulyasiya yarat" for the same dish started over, dropping the chosen ingredients.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
const reader=async t=>/kek|istermisin/i.test(t)?{kind:'off_topic',commands:[],unsupported:[],ignored:[],reply:''}:{kind:'answer',commands:[],unsupported:[],ignored:[],reply:''};
test('"kalkulyasiyasını göstər" during an unsaved draft shows it and saves it on "Təsdiq et"',async()=>{const c=chat({help:unknown,understand:reader});
 await c.send('lahmacuna kalkulyasiya yaratmaq lazımdır');await c.send('Qiymə');await c.send('0.31');
 const added=await c.send('Un');assert.match(added.body,/Un miqdarını/);const two=await c.send('0.69');assert.match(two.body,/“Saxla” düyməsini basın/);assert.ok(two.choices.some(x=>x.value==='setup:review'&&x.label==='Saxla'));
 await c.send('Islak kek de istermisin');
 const shown=await c.send('lahmacunun kalkulyasiyasını göstər');assert.match(shown.body,/hələ saxlanmayıb/);assert.match(shown.body,/Qiymə: 0,31/);assert.match(shown.body,/Un: 0,69/);
 assert.match((await c.send('Təsdiq et')).body,/Kalkulyasiya saxlanıldı/);});
test('"kalkulyasiya yarat" again for the same dish keeps the ingredients already chosen',async()=>{const c=chat({help:unknown,understand:reader});
 await c.send('lahmacun üçün kalkulyasiya yarat');await c.send('Qiymə');await c.send('0.31');
 const again=await c.send('lahmacun üçün kalkulyasiya yarat');assert.match(again.body,/artıq açıqdır, seçdiyiniz tərkib saxlanılıb: Qiymə 0,31 kq/);
 await c.send('setup:review');assert.match((await c.send('Təsdiq et')).body,/Kalkulyasiya saxlanıldı/);});
