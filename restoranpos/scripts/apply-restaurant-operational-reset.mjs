import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(root,'index.js');let main=fs.readFileSync(file,'utf8');
if(!main.includes('/* OPERATIONAL_RESET_SIGNED_V1 */')){
 const anchor='switch(e.command){case"data.wipeAll":{';if(main.split(anchor).length!==2)throw Error('Operational reset command dispatcher changed');
 main=main.replace(anchor,`switch(e.command){/* OPERATIONAL_RESET_SIGNED_V1 */case"data.previewOperations":case"data.resetOperations":return require("./operational-reset.cjs").run({command:e,args:t,credentials:await J(),isTerminal:Boolean(globalThis.__psLanRoute),actor:_psPortalActor,invoke:(method,payload,options)=>et.invoke(method,payload,options),afterReset:()=>setTimeout(()=>_psAfterWipe(),2000)});case"data.wipeAll":{`);
 fs.writeFileSync(file,main);
}
console.log('Signed, device-scoped operation reset; full wipe remains separate');
