import fs from 'node:fs';import path from 'node:path';import{fileURLToPath}from'node:url';import ts from'typescript';import{build,transform}from'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Keep renderer/preload calls compatible with both historical method names.
const pre=path.join(root,'out/preload/index.js');let preload=fs.readFileSync(pre,'utf8');preload=preload.replace('thread: () => call("support.thread")','thread: () => call("support.active")');fs.writeFileSync(pre,preload);
let main=fs.readFileSync(path.join(root,'index.js'),'utf8');if(!main.includes('/* SUPPORT_THREAD_ALIAS */')){const anchor='case"support.active":{';if(main.split(anchor).length!==2)throw Error('Support dispatcher anchor changed');main=main.replace(anchor,'/* SUPPORT_THREAD_ALIAS */case"support.thread":case"support.active":{');const policy='"support.active":{auth:!0,perm:null,timeout:15e3,idempotent:!1},';if(main.split(policy).length!==2)throw Error('Support policy anchor changed');main=main.replace(policy,policy+'"support.thread":{auth:!0,perm:null,timeout:15e3,idempotent:!1},');fs.writeFileSync(path.join(root,'index.js'),main);}

const bridgeMarker='/* CENTRAL_ASSISTANT_MAIN_V1 */';
if(!main.includes(bridgeMarker)){
 const anchor='case"support.request":{';if(main.split(anchor).length!==2)throw Error('Assistant dispatcher anchor changed');
 main=main.replace(anchor,'case"support.assistant":return _psAssistantOnline(t);'+anchor);
 const policy='"support.active":{auth:!0,perm:null,timeout:15e3,idempotent:!1},';
 main=main.replace(policy,policy+'"support.assistant":{auth:!0,perm:null,timeout:30e3,idempotent:!1},');
 main+='\n'+bridgeMarker+'\nlet _psAssistantClient=null;async function _psAssistantOnline(payload){try{if(!_psAssistantClient)_psAssistantClient=require("./assistant-online.cjs").createAssistantClient({credentials:async()=>{const tenant=ft(),device=await J(),staff=ce();if(!tenant||!device||tenant.customerId!==device.customerId||!staff?.userId)throw Error("Hesaba yenidən daxil olun.");return{token:tenant.token,baseUrl:device.baseUrl,customerId:tenant.customerId,deviceId:device.deviceId,actorId:staff.userId,permissions:staff.permissions||[]};}});return y(await _psAssistantClient.request(payload));}catch(e){return d("E_ASSISTANT_ONLINE",e.message||"Köməkçi serveri əlçatan deyil.");}}\n';
 fs.writeFileSync(path.join(root,'index.js'),main);
}
if(!preload.includes('assistant: (payload)')){const anchor='support: {';if(preload.split(anchor).length!==2)throw Error('Assistant preload anchor changed');preload=preload.replace(anchor,anchor+'\n    assistant: (payload) => call("support.assistant", payload),');fs.writeFileSync(pre,preload);}
fs.copyFileSync(path.join(root,'support/online-client.cjs'),path.join(root,'out/main/assistant-online.cjs'));

const file=path.join(root,'index-DAmHwBc4.js');let source=fs.readFileSync(file,'utf8');source=source.replace(/\/\* SUPPORT_KNOWLEDGE_START \*\/[\s\S]*?\/\* SUPPORT_KNOWLEDGE_END \*\//,'');
const stock=await build({entryPoints:[path.join(root,'support/online.mjs')],bundle:true,write:false,format:'iife',globalName:'PsStockAssistant',target:'es2020'});
const jsx=(await transform(fs.readFileSync(path.join(root,'support/components.jsx'),'utf8'),{loader:'jsx',jsxFactory:'psH',jsxFragment:'reactExports.Fragment',target:'es2020'})).code;
if(source.includes('/* SUPPORT_COMPONENTS_START */'))source=source.replace(/\/\* SUPPORT_COMPONENTS_START \*\/[\s\S]*?\/\* SUPPORT_COMPONENTS_END \*\//,'');
else{const ast=ts.createSourceFile('renderer.js',source,99,true),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='SupportPage');if(!node)throw Error('SupportPage missing');source=source.slice(0,node.getStart(ast))+source.slice(node.end);}
source=source.replace('support: \"Dəstək\"','support: \"Köməkçi\"').replace('support: \"Support\"','support: \"Assistant\"').replace('support: \"Destek\"','support: \"Yardımcı\"');
source='/* SUPPORT_KNOWLEDGE_START */\n'+stock.outputFiles[0].text+'\n/* SUPPORT_KNOWLEDGE_END */\n'+source+'\n/* SUPPORT_COMPONENTS_START */\n'+jsx+'\n/* SUPPORT_COMPONENTS_END */\n';await transform(source,{loader:'js',target:'es2020'});fs.writeFileSync(file,source);
const cssFile=path.join(root,'possistem-system.css');let css=fs.readFileSync(cssFile,'utf8').replace(/\/\* SUPPORT_PAGE_START \*\/[\s\S]*?\/\* SUPPORT_PAGE_END \*\//,'');css+='\n/* SUPPORT_PAGE_START */\n'+['style.css','tools.css'].map(name=>fs.readFileSync(path.join(root,'support',name),'utf8')).join('\n')+'\n/* SUPPORT_PAGE_END */\n';fs.writeFileSync(cssFile,css);console.log('Support active/thread compatibility and server-owned online assistant');
