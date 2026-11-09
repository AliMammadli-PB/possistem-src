// The owner's chat of 2026-11-07, replayed through the central engine and the till's own tools over a stand-in POS.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
test('warehouse list is numbered, in order, and explains negative and empty stock',async()=>{const c=chat();const r=await c.send('anbarimda neler var sirayla yaz');
 assert.match(r.body,/Anbar: “bu”/);assert.match(r.body,/Cəmi 5 mal: 2-də qalıq var, 2 bitib, 1 mənfidədir/);assert.match(r.body,/^2\. doner: -16 ədəd — mənfi$/m);
 assert.match(r.body,/Mənfi qalıq \(doner\)/);assert.match(r.body,/“doner 16 ədəd artır”/);assert.match(r.body,/Bitənlər: acili doner, lahmacun/);assert.doesNotMatch(r.body,/PM|AM/);});
test('"not a menu, a recipe" keeps the open recipe of the matched dish and "Təsdiq et" shows the plan',async()=>{const c=chat();
 assert.match((await c.send('lahmacuna kalkulasiya elave et')).body,/^lahmacun üçün/);
 const r=await c.send('menyu istemirem kalkulasiy isteyirem');assert.match(r.body,/menyuya yeni yemək əlavə etmirəm/);assert.doesNotMatch(r.body,/lahmacuna/);assert.ok(r.choices.some(x=>x.label==='Un'));
 await c.send('Un');await c.send('0.15 kq');await c.send('Qiymə');await c.send('100 qram');
 const plan=await c.send('Təsdiq et');assert.match(plan.body,/Bir porsiya üçün kalkulyasiya/);assert.match(plan.body,/Un: 0,15 kq/);assert.match(plan.body,/Qiymə: 0,1 kq/);
 await c.send('Təsdiq et');assert.deepEqual(c.state.recipes['m-lh'].map(l=>[l.ingredientId,l.qtyMilli]),[['i-un',150],['i-et',100]]);});
test('printer test names the printer plainly and explains a printer that is not connected',async()=>{const c=chat();
 const ask=await c.send('printer modellerini istemedim kontrol et printerimden cek cixar');assert.match(ask.body,/Printer: USB çek printeri \(USB 0483:5840\)/);assert.doesNotMatch(ask.body,/usbraw|\\\\\?/);
 const done=await c.send('Təsdiq et');assert.equal(c.state.jobs.length,1);assert.match(done.body,/növbəyə alındı/);assert.match(done.body,/USB kabeli/);assert.doesNotMatch(done.body,/retrying|E_PRINTER_SEND/);});
test('"delete my tables" twice keeps busy tables, offers the free one, and a typed choice label selects it',async()=>{const c=chat();
 for(const text of ['masalarimin hamisini sil','masalarimi sil deyirem gosterme']){const r=await c.send(text);assert.match(r.body,/3 masadan 2-də açıq hesab/);assert.match(r.body,/yalnız boş 1 masanı \(11 · panda\)/);}
 const plan=await c.send('Yalnız boş masaları seç');assert.match(plan.body,/1 masa silinəcək:\n11 · panda/);
 assert.equal(c.state.tables.length,3,'nothing deleted before confirmation');await c.send('Təsdiq et');assert.deepEqual(c.state.tables.map(t=>t.label),['Masa 1','Masa 2']);});
test('picking a table by typing its label works like tapping it',async()=>{const c=chat();await c.send('panda masasini sil');
 const r=await c.send('11 · panda');assert.match(r.body,/1 masa silinəcək/);});
test('after "delete all" is blocked, naming one free table picks it; a busy one stays protected',async()=>{const c=chat();await c.send('masalarimi sil deyirem gosterme');
 const plan=await c.send('11 · panda');assert.match(plan.body,/1 masa silinəcək:\n11 · panda/);await c.send('Ləğv et');
 await c.send('masalarimin hamisini sil');const busy=await c.send('11 · Masa 1');assert.doesNotMatch(busy.body,/1 masa silinəcək/);assert.equal(c.state.tables.length,3);});
