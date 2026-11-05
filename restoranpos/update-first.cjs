'use strict';
// The feed comes before the core: when a release breaks the core, publishing a newer one repairs the
// tills, because they install it before they start the broken part. A till is never locked out: no
// network, a stalled download or installs that keep failing all fall through to a normal start.
const fs=require('node:fs');
const path=require('node:path');
const CHECK_MS=12e3,STALL_MS=60e3,TOTAL_MS=600e3,INSTALL_WAIT_MS=30e3,RECHECK_MS=120e3,MAX_TRIES=3;
const BAD_CORE=new Set(['crash_loop','core_missing','incompatible']);

const PAGE=`<!doctype html><meta charset="utf-8"><title>possistem</title>
<style>body{margin:0;height:100vh;display:grid;place-content:center;gap:16px;width:440px;margin-inline:auto;background:#0c0907;color:#f4efe6;font:16px system-ui,sans-serif;text-align:center}
h1{margin:0;font-size:24px;font-weight:600}p{margin:0;color:#b9b0a2}div{height:8px;border-radius:4px;background:#2c2620;overflow:hidden}i{display:block;height:100%;width:0;background:#e0b15a;transition:width .3s}</style>
<h1>Proqram yenilənir</h1><p>Zəhmət olmasa bağlamayın. Bitəndə özü açılacaq.</p><div><i id="bar"></i></div><p id="pct">0%</p>
<script>function setPct(n){document.getElementById('bar').style.width=n+'%';document.getElementById('pct').textContent=n+'%'}</script>`;

function progressWindow(BrowserWindow){
 let win=null;
 return{
  show(percent){
   if(!win||win.isDestroyed()){
    win=new BrowserWindow({width:620,height:420,frame:false,resizable:false,center:true,alwaysOnTop:true,backgroundColor:'#0c0907',title:'possistem',icon:path.join(__dirname,'../../build/icon.png'),webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(PAGE)).catch(()=>{});
   }
   const n=Math.min(100,Math.max(0,Math.round(Number(percent))||0));
   win.webContents.executeJavaScript(`typeof setPct==='function'&&setPct(${n})`).catch(()=>{});
  },
  close(){if(win&&!win.isDestroyed())win.close();win=null;},
 };
}

function create({subscribe,check,install,startCore,progress,statePath,log}){
 let released=false,coreBad=false,installing=false,checkTimer=null,stallTimer=null,totalTimer=null,recheck=null;
 const clearGate=()=>{clearTimeout(checkTimer);clearTimeout(stallTimer);clearTimeout(totalTimer);};
 // Only a till that has not started yet, or whose core is down, is worth interrupting. A working till
 // keeps serving and installs when it is closed or on its next start.
 const active=()=>!released||coreBad;
 const giveUp=why=>{clearGate();if(!installing)progress.close();if(released)return;released=true;log.info('update_first_release',{why});startCore();};
 const armStall=()=>{clearTimeout(stallTimer);stallTimer=setTimeout(()=>giveUp('stalled'),STALL_MS);};
 const readTries=version=>{try{const s=JSON.parse(fs.readFileSync(statePath,'utf8'));return s.version===version?Number(s.tries)||0:0;}catch{return 0;}};
 const writeTries=(version,tries)=>{try{fs.writeFileSync(statePath,JSON.stringify({version,tries}));}catch(e){log.warn('update_first_state',{message:String(e)});}};
 const tryInstall=async version=>{
  if(installing)return;
  const tries=readTries(version);
  if(tries>=MAX_TRIES){log.warn('update_first_tries_used',{version});giveUp('install_tries');return;}
  installing=true;writeTries(version,tries+1);clearGate();progress.show(100);
  let result;
  try{result=await install();}catch(e){result={success:false,error:e};}
  const failed=why=>{installing=false;giveUp(why);};
  if(!result?.success){log.warn('update_first_install_failed',{message:String(result?.error?.message||result?.error)});failed('install_failed');return;}
  setTimeout(()=>failed('install_no_quit'),INSTALL_WAIT_MS);
 };
 subscribe(status=>{
  switch(status.state){
   case 'available':
    clearTimeout(checkTimer);
    if(!active())break;
    if(!released&&!totalTimer)totalTimer=setTimeout(()=>giveUp('too_slow'),TOTAL_MS);
    progress.show(0);armStall();break;
   case 'downloading':
    if(active()){progress.show(status.percent);armStall();}break;
   case 'downloaded':
    if(active())void tryInstall(status.version);break;
   case 'not_available':case 'not_configured':case 'error':
    giveUp(status.state);break;
  }
 });
 return{
  begin(){checkTimer=setTimeout(()=>giveUp('check_timeout'),CHECK_MS);},
  coreStatus(state){
   if(BAD_CORE.has(state)&&!coreBad){
    coreBad=true;log.warn('update_first_core_down',{state});
    void check();recheck=setInterval(()=>void check(),RECHECK_MS);
   }else if(state==='ready'&&coreBad){coreBad=false;clearInterval(recheck);progress.close();}
  },
 };
}
module.exports={create,progressWindow,CHECK_MS,STALL_MS,TOTAL_MS,RECHECK_MS,INSTALL_WAIT_MS,MAX_TRIES};
