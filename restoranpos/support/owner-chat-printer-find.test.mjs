// "printeri tap": with nothing installed the assistant searches the network itself, tests the printer it finds and,
// once confirmed, makes it the receipt printer. X/Z never claim paper when no printer is set.
import test from 'node:test';import assert from 'node:assert/strict';
import {chat} from './owner-chat-harness.mjs';
const unknown=async()=>({id:'unknown',body:'x',links:[],chips:[]});
test('no printer → "özün tap" searches, tests the found printer, then sets it as the receipt printer',async()=>{
 globalThis.posPrinterNetwork={call:async m=>m==='print.xprinterDiscover'?{success:true,data:{devices:[{ip:'192.168.30.176',mac:'00:61:C6:FA:C1:F3'}]}}:{success:false,error:{message:'no'}}};
 try{const c=chat({help:unknown});c.state.noPrinters=true;
  const a=await c.send('printeri tap');assert.match(a.body,/Kassa heç bir printer görmür/);assert.ok(a.choices.some(x=>x.value==='printer:discover'));assert.ok(a.choices.some(x=>x.value==='nav:/settings?section=printer'));
  const b=await c.send('ozun tap');assert.match(b.body,/Şəbəkədə 1 printer tapdım/);assert.match(b.body,/192\.168\.30\.176/);
  const d=await c.send('Təsdiq et');assert.match(d.body,/printer qəbul etdi/);assert.match(d.body,/çek printeri edim/);assert.equal(c.state.receipt,undefined,'nothing saved before the second yes');
  const e=await c.send('printer:use');assert.match(e.body,/indi çek printeridir/);assert.equal(c.state.receipt,'tcp:192.168.30.176:9100');
 }finally{delete globalThis.posPrinterNetwork;}});
test('nothing on the network either: says so, offers another search and the printer settings',async()=>{
 globalThis.posPrinterNetwork={call:async()=>({success:true,data:{devices:[]}})};
 try{const c=chat({help:unknown});c.state.noPrinters=true;await c.send('printer axtar');const r=await c.send('printer:discover');
  assert.match(r.body,/Şəbəkədə printer tapılmadı/);assert.ok(r.choices.some(x=>x.value==='printer:discover'));}finally{delete globalThis.posPrinterNetwork;}});
test('X with no receipt printer set says no paper came out',async()=>{const c=chat({help:unknown});c.state.noPrinters=true;
 await c.send('x hesabati cixar');const r=await c.send('Təsdiq et');assert.match(r.body,/çek printeri seçilməyib, ona görə kağız çıxmadı/);assert.doesNotMatch(r.body,/çek printerinə göndərildi/);});
