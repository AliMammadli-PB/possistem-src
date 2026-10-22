(function(root){
 'use strict';
 const TIMEOUT_MS=5*60*1000;
 function project(data,now=Date.now()){
  const server=Date.parse(data.serverTime||'');
  return {...data,branches:(data.branches||[]).map(d=>{
   const seen=Date.parse(d.lastSeenAt||'');
   if(!Number.isFinite(server)||!Number.isFinite(seen))return {...d,online:Boolean(d.online)};
   const remaining=Math.max(0,Math.min(TIMEOUT_MS,TIMEOUT_MS-(server-seen)));
   return {...d,online:remaining>0,onlineUntil:now+remaining};
  })};
 }
 function online(d,now=Date.now()){return Number.isFinite(d.onlineUntil)?now<d.onlineUntil:Boolean(d.online);}
 const api={TIMEOUT_MS,project,online};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.PossistemBranchPresence=api;
})(globalThis);
