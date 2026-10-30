// Xprinter setup that works on a fresh till (1.9.21): the search reports when Windows Firewall
// has no rule for the printer's reply (UDP 9600), "İcazə ver (Administrator)" adds it through a
// UAC prompt, and longer timeouts cover the printer's restart. The installer adds the same rule.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('xprinter-access anchor missing/repeated: '+a.slice(0,80));return s.replace(a,b)};
const edit=(file,marker,fn)=>{const p=path.join(root,file);const s=fs.readFileSync(p,'utf8');if(!s.includes(marker))fs.writeFileSync(p,fn(s));};

edit('index.js','/* POSSISTEM_XPRINTER_ACCESS */',main=>{
 main=once(main,'"print.xprinterDiscover":{auth:!0,perm:"settings.manage",timeout:15e3,idempotent:!1}','"print.xprinterDiscover":{auth:!0,perm:"settings.manage",timeout:3e4,idempotent:!1},"print.xprinterFirewall":{auth:!0,perm:"settings.manage",timeout:18e4,idempotent:!1}');
 main=once(main,'"print.xprinterConfigure":{auth:!0,perm:"settings.manage",timeout:3e4,idempotent:!1}','"print.xprinterConfigure":{auth:!0,perm:"settings.manage",timeout:6e4,idempotent:!1}');
 main=once(main,'var PS_LAN_DENY=new Set([','var PS_LAN_DENY=new Set(["print.xprinterDiscover","print.xprinterConfigure","print.xprinterFirewall",');
 main=once(main,'async function Is(e,t){',`/* POSSISTEM_XPRINTER_ACCESS */
const _psXpRuleName="possistem Xprinter";
function _psXpRule(){if(process.platform!=="win32")return Promise.resolve(!0);return new Promise(r=>require("node:child_process").execFile("netsh.exe",["advfirewall","firewall","show","rule","name="+_psXpRuleName],{windowsHide:!0},x=>r(!x)))}
async function _psXpFirewall(){if(await _psXpRule())return y({granted:!0});const args=('advfirewall firewall add rule name="'+_psXpRuleName+'" dir=in action=allow protocol=UDP localport=9600 profile=any program="'+ut()+'"').replace(/'/g,"''");await new Promise(r=>require("node:child_process").execFile("powershell.exe",["-NoProfile","-NonInteractive","-Command","Start-Process -FilePath netsh.exe -ArgumentList '"+args+"' -Verb RunAs -Wait -WindowStyle Hidden"],{windowsHide:!0},()=>r()));return await _psXpRule()?y({granted:!0}):d("E_FORBIDDEN","İcazə verilmədi. Windows-un Administrator sualına “Bəli” deyin.")}
async function Is(e,t){if(e==="print.xprinterFirewall")return _psXpFirewall();if(e==="print.xprinterDiscover"){const r=await b("print.xprinterDiscover",t||{},3e4);if(r?.success&&r.data&&!(r.data.devices||[]).length)r.data.firewall=await _psXpRule();return r}`);
 return main;
});

edit('out/preload/index.js','print.xprinterFirewall',pre=>once(pre,
 "['print.xprinterDiscover','print.xprinterConfigure'].includes(method)?electron.ipcRenderer.invoke(IPC.invoke,{method,payload:payload||{},options:{timeoutMs:30000}})",
 "['print.xprinterDiscover','print.xprinterConfigure','print.xprinterFirewall'].includes(method)?electron.ipcRenderer.invoke(IPC.invoke,{method,payload:payload||{},options:{timeoutMs:method==='print.xprinterFirewall'?180000:60000}})"));

// apply-restaurant-1917 appends subscription/style.css only once; later card styles go here.
edit('possistem-system.css','/* POSSISTEM_XPRINTER_ACCESS_STYLE */',css=>css+'\n/* POSSISTEM_XPRINTER_ACCESS_STYLE */\n.ps-xprinter-match{margin-top:16px;padding:14px;border:1px solid #f0c36b;background:#fff8e6;border-radius:8px;color:#5c4100}.ps-xprinter-match p{margin:0 0 10px}\n');
console.log('xprinter-access: firewall permission prompt, longer timeouts, network match styles');
