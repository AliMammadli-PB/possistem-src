import {afterEach,describe,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {createCloudBranches}=require('../../cloud-branches/client.cjs');
const {MarketSyncService}=require('../../../marketpos/electron/sync-service.cjs');
const target='22222222-2222-4222-8222-222222222222';
const credentials=async()=>({token:'owner-fixture',deviceId:'source',baseUrl:'https://possistem.az/pos/api'});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Market branch transport failures',()=>{
 it('keeps request identity after an uncertain cancellation and never automatically retries writes',async()=>{
  const requests:any[]=[];
  const client=createCloudBranches({credentials,fetchImpl:async(_url:any,options:any)=>{requests.push(JSON.parse(options.body));return {ok:false,status:409,json:async()=>({error:'Nəticə təsdiqlənmədi',uncertain:true})};}});
  const calls=[{method:'inventory.adjust',payload:{qtyDeltaMilli:1000}}];
  await expect(client.rpc(target,calls)).rejects.toMatchObject({uncertain:true,statusCode:409});expect(requests).toHaveLength(1);
  await expect(client.rpc(target,calls)).rejects.toThrow('təsdiqlənmədi');expect(requests[1].requestId).toBe(requests[0].requestId);
 });
 it('replaces raw server/proxy/network failures with readable errors',async()=>{
  for(const reply of [{ok:false,status:500,json:async()=>({error:'Internal Server Error'})},{ok:false,status:502,json:async()=>{throw Error('HTML')}},{ok:true,status:200,json:async()=>null}]){
   const client=createCloudBranches({credentials,fetchImpl:async()=>reply});await expect(client.list()).rejects.toThrow('Filial xidməti');
  }
  const client=createCloudBranches({credentials,fetchImpl:async()=>{throw Error('fetch failed');}});await expect(client.list()).rejects.toThrow('İnternet bağlantısını');
  const timed=createCloudBranches({credentials,fetchImpl:async()=>{const error=Error('timeout');error.name='TimeoutError';throw error;}});await expect(timed.list()).rejects.toThrow('vaxtında');
 });
 it('preserves useful permission messages and strips Electron IPC prefixes in the actual preload',async()=>{
  const client=createCloudBranches({credentials,fetchImpl:async()=>({ok:false,status:403,json:async()=>({error:'Bu bölməyə icazə yoxdur'})})});await expect(client.list()).rejects.toThrow('icazə yoxdur');
  let exposed:any;const preload=fs.readFileSync(new URL('../../../marketpos/electron/preload.cjs',import.meta.url),'utf8');
  vm.runInNewContext(preload,{require:()=>({contextBridge:{exposeInMainWorld:(key:string,api:any)=>{if(key==='marketSystem')exposed=api;}},ipcRenderer:{invoke:()=>Promise.reject(Error("Error invoking remote method 'market:branches:rpc': Error: Filial oflayndır"))}}),process});
  await expect(exposed.branches.rpc('session',target,[])).rejects.toThrow(/^Filial oflayndır$/);
 });
});
describe('Signed Market command delivery',()=>{
 const keys=generateKeyPairSync('ed25519');
 const state={pinnedLicenseKey:{publicKeyHex:keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex')},activation:{serverDeviceId:target,customerId:randomUUID(),deviceId:'fixture-fingerprint'}};
 function command(){const payload={type:'pos-command',id:randomUUID(),kind:'core_batch',payload:{calls:[{method:'inventory.adjust'}],expiresAt:Date.now()+30000},customerId:state.activation.customerId,deviceId:target,issuedAt:Date.now(),expiresAt:Date.now()+30000};return {id:payload.id,signed:{payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),keys.privateKey).toString('hex')}};}
 it('retries lost result delivery without repeating a committed warehouse operation or reporting failure',async()=>{
  const posted:any[]=[];let online=false;
  vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{posted.push(JSON.parse(options.body));return {ok:online,status:online?200:503};}));
  vi.spyOn(console,'warn').mockImplementation(()=>{});
  const execute=vi.fn(async()=>({results:[{success:true,data:{id:'receipt'}}]}));
  const sync=new MarketSyncService({core:{invoke:async()=>({success:true,data:{settings:{}}})},controlApi:(p:string)=>'https://fixture'+p,onCoreBatch:execute});
  const received=command();await sync.dispatchCommands(state,[received]);expect(execute).toHaveBeenCalledTimes(1);expect(sync.commandResults.size).toBe(1);expect(posted.every(p=>p.status==='done')).toBe(true);
  online=true;await sync.dispatchCommands(state,[]);expect(sync.commandResults.size).toBe(0);expect(posted).toHaveLength(2);
  await sync.dispatchCommands(state,[received]);expect(execute).toHaveBeenCalledTimes(1);expect(posted).toHaveLength(2);
 });
 it('refuses forged commands and does not overwrite their server state',async()=>{
  const execute=vi.fn(),post=vi.fn();vi.stubGlobal('fetch',post);vi.spyOn(console,'warn').mockImplementation(()=>{});
  const sync=new MarketSyncService({core:{invoke:async()=>({success:true,data:{settings:{}}})},controlApi:(p:string)=>p,onCoreBatch:execute});
  const received=command();received.signed.payload.payload.calls[0].method='system.exec';await sync.dispatchCommands(state,[received]);expect(execute).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled();
 });
});
