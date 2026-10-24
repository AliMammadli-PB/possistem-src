import {describe,it,expect} from 'vitest';
import {createInitialState,readPersistedState} from '../../../marketpos/src/data';
describe('clean Market business state',()=>{
 it('contains no sample products, tills, warehouses, sales, purchase orders or cash balances',()=>{
  const state=createInitialState();
  for(const field of ['products','sales','warehouses','registers','purchaseOrders','heldCarts','audits'] as const)expect(state[field]).toEqual([]);
  expect(state.settings).toMatchObject({storeName:'',taxId:'',address:'',defaultRegisterId:'',defaultWarehouseId:'',showProductImages:false});expect(state.syncQueue).toBe(0);
 });
 it('does not share mutable defaults between installs',()=>{const a=createInitialState(),b=createInitialState();a.settings.storeName='Merchant';expect(b.settings.storeName).toBe('');expect(a.products).not.toBe(b.products);});
 it.each([null,'null','{}','bad json','{"schemaVersion":5,"products":{}}'])('missing/corrupt cache never becomes sample business data (%s)',text=>expect(readPersistedState({getItem:()=>text},'state')).toBeNull());
 it.each([2,3,4,5])('preserves every real legacy SKU and record on schema %s',schemaVersion=>{
  const saved={schemaVersion,products:[{id:'custom-any-id',barcode:'4760000000001'},{id:'p-wolt-0001',name:{az:'Merchant-renamed product'}}],sales:[{id:'real-sale'}],warehouses:[{id:'real-warehouse'}],registers:[{id:'real-register'}],settings:{storeName:'Mənim mağazam'}};
  const state=readPersistedState({getItem:()=>JSON.stringify(saved)},'state')!;
  expect(state.schemaVersion).toBe(5);expect(state.products).toEqual(saved.products);expect(state.sales).toEqual(saved.sales);expect(state.registers).toEqual(saved.registers);expect(state.warehouses).toEqual(saved.warehouses);expect(state.settings.storeName).toBe(saved.settings.storeName);expect(state.purchaseOrders).toEqual([]);
 });
});
