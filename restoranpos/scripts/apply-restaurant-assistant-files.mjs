#!/usr/bin/env node
/**
 * Files the assistant makes (PDF reports) are written straight into Sənədlər\Possistem\Köməkçi, with no save dialog,
 * and shown in the chat as a card: open, show in folder, or save a copy elsewhere. Opening is limited to that folder.
 */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const MARK='/* ASSISTANT_FILES_1110 */';
const patch=(file,steps)=>{let s=fs.readFileSync(file,'utf8');if(s.includes(MARK))return;for(const[a,b]of steps){if(s.split(a).length!==2)throw Error('assistant-files: anchor changed in '+path.basename(file)+': '+a.slice(0,80));s=s.replace(a,b);}fs.writeFileSync(file,s);};

const main=path.join(root,'index.js');
patch(main,[
 ['"files.savePdf":{auth:!0,perm:null,timeout:6e4,idempotent:!1},','"files.savePdf":{auth:!0,perm:null,timeout:6e4,idempotent:!1},"files.assistantPdf":{auth:!0,perm:null,timeout:6e4,idempotent:!1},"files.assistantOpen":{auth:!0,perm:null,timeout:6e4,idempotent:!1},'],
 ['case"files.savePdf":return _psSavePdfFile(t);','case"files.savePdf":return _psSavePdfFile(t);case"files.assistantPdf":return _psAssistantPdf(t);case"files.assistantOpen":return _psAssistantOpen(t);'],
]);
fs.appendFileSync(main,fs.readFileSync(main,'utf8').includes(MARK)?'':`
${MARK}
function _psAssistantDir(){return m.join(c.app.getPath("documents"),"Possistem","Köməkçi");}
async function _psAssistantPdf(e){const t=e&&typeof e=="object"?e:{};const base=String(t.filename||"possistem").replace(/[\\\\/:*?"<>|]/g,"_").replace(/\\.pdf$/i,"").trim().slice(0,120)||"possistem";const html=String(t.html??"");try{const dir=_psAssistantDir();p.mkdirSync(dir,{recursive:!0});let file=m.join(dir,base+".pdf");for(let i=2;p.existsSync(file)&&i<1000;i++)file=m.join(dir,base+" ("+i+").pdf");/* Hidden window, as for files.savePdf: printToPDF takes over the page it runs on. */const o=new c.BrowserWindow({show:!1,webPreferences:{offscreen:!0,javascript:!1,sandbox:!0}});try{await o.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html));const d=await o.webContents.printToPDF({printBackground:!0,pageSize:"A4",margins:{marginType:"default"}});p.writeFileSync(file,d);return{success:!0,data:{canceled:!1,path:file,name:m.basename(file),folder:dir,bytes:d.length}}}finally{if(!o.isDestroyed())o.destroy()}}catch(r){return{success:!1,error:{code:"E_IO",message:r instanceof Error?r.message:String(r),retryable:!1}}}}
async function _psAssistantOpen(e){const t=e&&typeof e=="object"?e:{};const dir=m.resolve(_psAssistantDir()),file=m.resolve(String(t.path||""));if(!file.startsWith(dir+m.sep)||!p.existsSync(file))return{success:!1,error:{code:"E_NOT_FOUND",message:"Fayl tapılmadı. Köməkçidən yenidən istəyin.",retryable:!1}};try{if(t.action==="folder"){c.shell.showItemInFolder(file);return{success:!0,data:{}}}if(t.action==="saveAs"){const w=c.BrowserWindow.getFocusedWindow()??c.BrowserWindow.getAllWindows()[0];const a=await c.dialog.showSaveDialog(w,{defaultPath:m.basename(file),filters:[{name:"PDF",extensions:["pdf"]}]});if(a.canceled||!a.filePath)return{success:!0,data:{canceled:!0}};p.copyFileSync(file,a.filePath);return{success:!0,data:{path:a.filePath}}}const err=await c.shell.openPath(file);return err?{success:!1,error:{code:"E_IO",message:err,retryable:!1}}:{success:!0,data:{}}}catch(r){return{success:!1,error:{code:"E_IO",message:r instanceof Error?r.message:String(r),retryable:!1}}}}
`);

const preload=path.join(root,'out/preload/index.js');
patch(preload,[
 ['savePdf: (filename, html) => call("files.savePdf", { filename, html }, { timeoutMs: 60000 })','savePdf: (filename, html) => call("files.savePdf", { filename, html }, { timeoutMs: 60000 }),\n    '+MARK+'\n    assistantPdf: (filename, html) => call("files.assistantPdf", { filename, html }, { timeoutMs: 60000 }),\n    assistantOpen: (path, action) => call("files.assistantOpen", { path, action }, { timeoutMs: 60000 })'],
]);

// A card in the assistant ("doner · 25 ədəd") opens Anbar filtered to that item: /operations?tab=stock&q=doner.
const renderer=path.join(root,'index-DAmHwBc4.js');
patch(renderer,[
 ['  const [query, setQuery] = reactExports.useState("");\n  const [status, setStatus] = reactExports.useState("all");','  '+MARK+' const psStockQ = new URLSearchParams(useLocation().search).get("q") || "";\n  const [query, setQuery] = reactExports.useState(psStockQ);\n  reactExports.useEffect(() => { if (psStockQ) setQuery(psStockQ); }, [psStockQ]);\n  const [status, setStatus] = reactExports.useState("all");'],
]);
