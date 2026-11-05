import fs from'node:fs';import path from'node:path';import ts from'typescript';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let main=fs.readFileSync(root+'/index.js','utf8');
// An earlier patch can drop the tail of index.js and with it the mark, so each edit keeps its own guard; collapse clears the copies older assembles left.
const collapse=copy=>{while(main.includes(copy+copy))main=main.replace(copy+copy,copy)};
const once=(anchor,copy)=>{collapse(copy);if(!main.includes(anchor+copy))main=main.replace(anchor,anchor+copy)};
once('Cn={','"backup.cloudStatus":{auth:!0,perm:"backup.manage",timeout:10000,idempotent:!1},"backup.cloudNow":{auth:!0,perm:"backup.manage",timeout:180000,idempotent:!1},');
once('async function Is(e,t){','if(e==="backup.cloudStatus")return y(await _psFullBackup().status());if(e==="backup.cloudNow")return y(await _psFullBackup().tick(true));');
collapse('path.extname(r.filePaths[0]).toLowerCase()===".posbackup"?await require("./cloud-backup-client.cjs").importBundle(r.filePaths[0],dest,Ht(),(await J())?.customerId):');
if(!main.includes('/* POS_FULL_CLOUD_BACKUP */')){
 main+=`\n/* POS_FULL_CLOUD_BACKUP */
let _psFullBackupClient=null;
function _psFullBackup(){if(!_psFullBackupClient)_psFullBackupClient=require("./cloud-backup-client.cjs").createClient({credentials:async()=>{const device=await J();return device&&{...device,appVersion:c.app.getVersion()};},isTerminal:()=>Boolean(globalThis.__psLanRoute),assetsDir:()=>Ht(),snapshot:async()=>{const actor=await _psPortalActor();if(!actor||!et)throw Error("CORE_UNAVAILABLE");const r=await et.invoke("backup.cloudSnapshot",{},{actor:{userId:actor.id},timeoutMs:120000});if(!r.success)throw Error("SNAPSHOT_FAILED");return r.data;}});return _psFullBackupClient;}
setInterval(()=>void _psFullBackup().tick(),60000).unref();setTimeout(()=>void _psFullBackup().tick(),15000).unref();
`;
 const ast=ts.createSourceFile('main.js',main,99,true),n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='_psBackupImport');if(!n)throw Error('Backup import function missing');let b=n.getText(ast);
 b=b.replace('extensions:["db"]','extensions:["db","posbackup"]');
 if(!b.includes('importBundle'))b=b.replace('await require("node:fs").promises.copyFile(r.filePaths[0],dest)','path.extname(r.filePaths[0]).toLowerCase()===".posbackup"?await require("./cloud-backup-client.cjs").importBundle(r.filePaths[0],dest,Ht(),(await J())?.customerId):await require("node:fs").promises.copyFile(r.filePaths[0],dest)').replace('path.extname(','m.extname(');
 main=main.slice(0,n.getStart(ast))+b+main.slice(n.end);fs.writeFileSync(root+'/index.js',main);
}
const preloadFile=root+'/out/preload/index.js';let pre=fs.readFileSync(preloadFile,'utf8');if(!pre.includes('cloudStatus:')){const anchor='    exportFile: (backupId) =>';if(!pre.includes(anchor))throw Error('Cloud backup preload anchor missing');pre=pre.replace(anchor,'    cloudStatus: () => call("backup.cloudStatus", {}),\n    cloudNow: () => call("backup.cloudNow", {}),\n'+anchor);fs.writeFileSync(preloadFile,pre);}
const uiFile=root+'/index-DAmHwBc4.js';let ui=fs.readFileSync(uiFile,'utf8');const start='/* FULL_CLOUD_BACKUP_UI_START */',end='/* FULL_CLOUD_BACKUP_UI_END */',block=start+'\n'+fs.readFileSync(root+'/cloud-backup/ui.js','utf8')+'\n'+end;
if(ui.includes(start))ui=ui.slice(0,ui.indexOf(start))+block+ui.slice(ui.indexOf(end)+end.length);else ui=ui.replace('const container = document.getElementById("root");',block+'\nconst container = document.getElementById("root");');
for(const name of['AdminBackupPage','SettingsBackupCompact']){const a=ts.createSourceFile('ui.js',ui,99,true),n=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!n)throw Error('Cloud UI missing '+name);let b=n.getText(a);if(!b.includes('jsxRuntimeExports.jsx(PsCloudBackupCard')){const anchor=name==='AdminBackupPage'?'className: "mx-auto w-full max-w-4xl space-y-6 overflow-auto p-6", children: [':'className: "workspace", children: [';if(!b.includes(anchor))throw Error('Cloud card slot missing '+name);b=b.replace(anchor,anchor+'\n      jsxRuntimeExports.jsx(PsCloudBackupCard,{}),');ui=ui.slice(0,n.getStart(a))+b+ui.slice(n.end);}}
fs.writeFileSync(uiFile,ui);console.log('Full cloud backup: native snapshot, catalogue images, encrypted server bundle, safe import and status UI');
