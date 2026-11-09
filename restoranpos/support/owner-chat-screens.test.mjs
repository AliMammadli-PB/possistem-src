// "Open" buttons: what the assistant cannot do or explains comes with a button to the right screen.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
test('"çek loqosu qoy" opens the receipt settings; "printer bölməsini aç" the printer screen',async()=>{const c=chat({help:unknown});
 const r=await c.send('ceke logo qoy');assert.match(r.body,/İdarə → Parametrlər → Çek/);assert.ok(r.choices.some(x=>x.value==='nav:/settings?section=receipt'));
 assert.ok((await c.send('printer bolmesini ac')).choices.some(x=>x.value==='nav:/settings?section=printer'));});
test('an unsupported request names where to do it and offers the button; PINs are refused with the staff screen',async()=>{
 const c=chat({help:unknown,understand:async t=>/pin/.test(t)?{kind:'commands',commands:[],unsupported:['işçi pinlərini göstər'],reply:''}:{kind:'commands',commands:[],unsupported:['yeni işçi yarat'],reply:''}});
 const r=await c.send('yeni isci yarat adi Aysel');assert.match(r.body,/İdarə → Heyət və xidmət → İşçilər/);assert.ok(r.choices.some(x=>x.value==='nav:/admin/staff'));
 const p=await c.send('isci pinlerini goster');assert.match(p.body,/PIN-ləri, parollar və giriş açarları köməkçidə heç vaxt göstərilmir/);assert.doesNotMatch(p.body,/komandaya ötürdüm/);});
test('"bütün sifarişləri sil" is refused as history, not forwarded as a wish',async()=>{const c=chat({help:unknown,understand:async()=>({kind:'commands',commands:[],unsupported:['bütün sifarişləri sil'],reply:''})});
 const r=await c.send('butun sifarisleri sil');assert.match(r.body,/Satış, sifariş və ödəniş tarixçəsi silinmir/);assert.doesNotMatch(r.body,/komandaya ötürdüm/);});
test('a pressed "open" button on an old till that cannot navigate gets the place in words',async()=>{const c=chat({help:unknown});await c.send('ceke logo qoy');
 assert.match((await c.send('nav:/settings?section=receipt')).body,/Bu bölmə: İdarə → Parametrlər → Çek/);});
