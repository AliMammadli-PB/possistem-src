import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index.js');let s=fs.readFileSync(file,'utf8');
const marker='/* WAITER_PORTAL_V1 */';
// Keep exactly one dispatch branch across repeated patch assemblies.
const dispatch='case\"waiter.portal\":return _psWaiterCommand(e,t);';
if(s.split(dispatch).length>2){s=s.replaceAll(dispatch,'');s=s.replace('case\"core.batch\":return _psPortalBatch(e,t);',dispatch+'case\"core.batch\":return _psPortalBatch(e,t);');fs.writeFileSync(file,s);}
if(!s.includes(marker)){
 const anchor='case"core.batch":return _psPortalBatch(e,t);';if(s.split(anchor).length!==2)throw Error('Waiter signed-command anchor changed');
 if(!s.includes('case"waiter.portal":'))s=s.replace(anchor,'case"waiter.portal":return _psWaiterCommand(e,t);'+anchor);
 const helper='\n'+marker+'\nasync function _psWaiterCommand(cmd,args){try{if(!et)throw Error("Kassa nüvəsi hazır deyil.");const result=await require("./waiter-portal.cjs").run(cmd,args,{context:async()=>{const tenant=ft(),device=await J();return tenant&&device?{customerId:tenant.customerId,deviceId:device.deviceId,host:!globalThis.__psLanRoute}:null;},admin:_psPortalActor,invoke:(method,payload,options)=>et.invoke(method,payload,options)});return{commandId:cmd.id,ok:true,result};}catch(e){return{commandId:cmd.id,ok:false,error:e.message||"Ofisiant əməliyyatı tamamlanmadı.",errorCode:"E_WAITER_PORTAL"};}}\n';const insertion='async function Os(e){';if(s.split(insertion).length!==2)throw Error('Waiter helper insertion anchor changed');s=s.replace(insertion,helper+insertion);fs.writeFileSync(file,s);
}
fs.mkdirSync(path.join(root,'out/main'),{recursive:true});fs.copyFileSync(path.join(root,'waiter/portal.cjs'),path.join(root,'out/main/waiter-portal.cjs'));
console.log('Signed waiter portal, employee-scoped native calls');
