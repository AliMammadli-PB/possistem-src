import {describe,it,expect,vi} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {OpsEngine}=require('../../../marketpos/electron/ops-engine.cjs');
describe('warehouse screen reads',()=>{
 it('opens accounts while a large catalog reconciliation is still pending',async()=>{
  const source=fs.readFileSync(new URL('../../../marketpos/electron/main.cjs',import.meta.url),'utf8');
  const start=source.indexOf("  ipcMain.handle('market:ops:invoke'");
  const end=source.indexOf("  ipcMain.handle('market:ops:cashSummary'",start);
  let handler:any;
  const flush=vi.fn(()=>new Promise(()=>{}));
  const context={ipcMain:{handle:(_name:string,fn:any)=>handler=fn},assertTrusted:()=>{},requireSession:()=>({role:'manager',name:'Test'}),opsFail:()=>({success:false}),opsEngine:{allowed:()=>true,flushCatalog:flush,invoke:async()=>({success:true,data:{accounts:[],terminals:[]}})},require:()=>({isCatalogWrite:()=>false,docPermission:()=>''}),staffCan:()=>true,console};
  vm.runInNewContext(source.slice(start,end),context);
  const result=await Promise.race([handler({}, {method:'cashAccounts.list'}),new Promise(resolve=>setTimeout(()=>resolve('blocked'),200))]);
  expect(result).toMatchObject({success:true});expect(flush).not.toHaveBeenCalled();
 });
 it('resolves the current register branch instead of the first register',async()=>{
  const engine=Object.create(OpsEngine.prototype);engine.settings=()=>({});engine.cashCurrentRegisterId='two';
  engine.market={invoke:async()=>({success:true,data:{defaultRegisterId:'two'}})};
  engine.invoke=async()=>({success:true,data:{accounts:[{kind:'till',terminalId:'market-one',objectId:'a'},{kind:'till',terminalId:'market-two',objectId:'b'}],objects:[{id:'a',name:'Bakı'},{id:'b',name:'Gəncə'}]}});
  expect(await engine.branchObject()).toBe('b');expect(await engine.branchContext()).toMatchObject({registerId:'two',branchName:'Gəncə',objectId:'b'});
 });
});
