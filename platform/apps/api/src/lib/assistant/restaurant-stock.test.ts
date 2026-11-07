import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRestaurantStock} from './restaurant-stock.js';
import {detectAccountIntent, answerAccount} from './account.js';
test('inventory overview variants are requests for actual account data', () => {
 for(const question of ['anbarımda nə var?', 'anbarıma bax', 'salam anbarıma bax', 'anbarı yoxla', 'mallarımın siyahısı']) assert.equal(detectAccountIntent(question)?.kind, 'product_list', question);
 assert.equal(detectAccountIntent('anbar necə işləyir?'), null);
});
test('stock is read per owner-supplied device and warehouse; malformed quantities stay unknown', async () => {
 const calls: unknown[]=[];
 const result=await readRestaurantStock([{id:'mine',name:'Pizza'}],()=>true,async(d,m,p)=>{
  calls.push([d.id,m,p]);
  if(m==='warehouses.list')return{warehouses:[{id:'w1',name:'Mətbəx'},{id:'w2',name:'Bar'}]};
  return{levels:[{id:'flour',name:'Un',unit:'kq',qtyMilli:p?.warehouseId==='w1'?5250:0},{id:'unknown',name:'Duz',qtyMilli:'invalid'}]};
 });
 assert.equal(result.sections.length,2);assert.equal(result.sections.find(s=>s.warehouse==='Mətbəx')?.products[0]?.qtyMilli,5250);
 assert.equal(result.sections.find(s=>s.warehouse==='Bar')?.products[0]?.qtyMilli,0);assert.equal(result.sections[0]?.products[1]?.qtyMilli,null);
 assert.deepEqual(calls,[['mine','warehouses.list',undefined],['mine','inventory.levels',{warehouseId:'w1'}],['mine','inventory.levels',{warehouseId:'w2'}]]);
});
test('offline and failed reads cannot claim the warehouse is empty', async () => {
 const r=await readRestaurantStock([{id:'1',name:'Offline'},{id:'2',name:'Failed'}],d=>d.id!=='1',async()=>null);
 assert.equal(r.sections.length,0);assert.deepEqual(r.unavailable,['Offline','Failed']);
});
test('unauthenticated account request reads no business data', async () => {
 const r=await answerAccount({} as never,null,{kind:'product_list'},'az');assert.equal(r.needLogin,true);
});
