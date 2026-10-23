import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { checkoutErrorMessage } from '../../../marketpos/src/PaymentModal';
import type { Product } from '../../../marketpos/src/types';
const root=path.resolve(__dirname,'../../..');
const source=fs.readFileSync(path.join(root,'marketpos/src/App.tsx'),'utf8');
function task(name:string, context:Record<string,unknown>){
 const start=source.indexOf(`    const ${name} = async () => {`);
 const end=source.indexOf(`    void ${name}();`,start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const js=transformSync(source.slice(start,end)+`\n${name}();`,{loader:'ts',target:'es2022'}).code;
 return vm.runInNewContext(js,context);
}
const native={schemaVersion:5,products:[{id:'p-wolt-3065',priceMinor:777,stock:0,name:{az:'Mağaza malı'}}]};
describe('native checkout catalogue is authoritative',()=>{
 it('starts with the native zero and merchant price; never injects missing demo products',async()=>{
  const setState=vi.fn(),client={available:()=>true,status:async()=>({state:'ready'}),getState:async()=>structuredClone(native)};
  await task('boot',{marketCoreClient:client,cancelled:false,setState,setCoreReady:vi.fn(),setCoreError:vi.fn()});
  expect(setState).toHaveBeenCalledWith(native);
 });
 it('missing old catalogue flags never overwrite a populated native shop',async()=>{
  const setState=vi.fn(),importLegacy=vi.fn(),save=vi.fn(),setItem=vi.fn();
  await task('migrate',{marketCoreClient:{getState:async()=>structuredClone(native),importLegacy,products:{save}},cancelled:false,setState,localStorage:{getItem:()=>null,setItem},LEGACY_MIGRATED_KEY:'legacy',CATALOG_SYNC_KEY:'catalog',CATALOG_SYNC_TOKEN:'v1'});
  expect(importLegacy).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(setState).toHaveBeenCalledWith(native);expect(setItem).toHaveBeenCalledTimes(2);
 });
 it('still imports browser-era data into an empty native database',async()=>{
  const importLegacy=vi.fn(async()=>native),setState=vi.fn();
  await task('migrate',{marketCoreClient:{getState:async()=>({products:[]}),importLegacy},cancelled:false,setState,legacyState:native,localStorage:{getItem:()=>null,setItem:vi.fn()},LEGACY_MIGRATED_KEY:'legacy',CATALOG_SYNC_KEY:'catalog',CATALOG_SYNC_TOKEN:'v1'});
  expect(importLegacy).toHaveBeenCalledOnce();expect(setState).toHaveBeenCalledWith(native);
 });
 it('a fresh install never imports an invented browser catalogue',async()=>{
  const importLegacy=vi.fn(),setState=vi.fn();
  await task('migrate',{marketCoreClient:{getState:async()=>({products:[]}),importLegacy},legacyState:null,cancelled:false,setState,localStorage:{getItem:()=>null,setItem:vi.fn()},LEGACY_MIGRATED_KEY:'legacy',CATALOG_SYNC_KEY:'catalog',CATALOG_SYNC_TOKEN:'v1'});
  expect(importLegacy).not.toHaveBeenCalled();expect(setState).toHaveBeenCalledWith({products:[],schemaVersion:5});
 });
 it('failed legacy import keeps native state instead of creating an in-memory seed',async()=>{
  const setState=vi.fn(),setItem=vi.fn();
  await task('migrate',{marketCoreClient:{getState:async()=>({products:[]}),importLegacy:async()=>{throw Error('denied')}},cancelled:false,setState,legacyState:native,localStorage:{getItem:()=>null,setItem},LEGACY_MIGRATED_KEY:'legacy',CATALOG_SYNC_KEY:'catalog',CATALOG_SYNC_TOKEN:'v1'});
  expect(setState).not.toHaveBeenCalled();expect(setItem).not.toHaveBeenCalled();
 });
});
describe('payment failures',()=>{
 const products=[{id:'p-wolt-3065',name:{az:'Şəkər',ru:'Сахар',en:'Sugar'}}] as Product[];
 it.each(['az','ru','en'] as const)('stock failure in %s contains a product name and counts, never an internal ID',lang=>{
  const message=checkoutErrorMessage({code:'INSUFFICIENT_STOCK',details:{productId:'p-wolt-3065',available:0,requested:2}},products,lang);
  expect(message).toContain(products[0].name[lang]);expect(message).toContain('0');expect(message).toContain('2');expect(message).not.toContain('wolt');
 });
 it('also conceals internal IDs in unexpected errors',()=>expect(checkoutErrorMessage(new Error('database p-wolt-3065'),products,'az')).not.toContain('wolt'));
 it('explains that a closed register must be opened',()=>expect(checkoutErrorMessage({code:'REGISTER_CLOSED'},products,'az')).toContain('açın'));
});
