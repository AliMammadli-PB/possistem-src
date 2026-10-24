'use strict';
function withinBudget(value,{maxNodes=50000,maxArray=5000,maxDepth=32,maxBytes=32*1024*1024}={}){
 const stack=[[value,0]];let nodes=0,bytes=0;
 while(stack.length){const[v,depth]=stack.pop();if(++nodes>maxNodes||depth>maxDepth)return false;
  if(typeof v==='string'){bytes+=v.length*2;if(bytes>maxBytes)return false;}
  else if(v instanceof ArrayBuffer||ArrayBuffer.isView(v)){bytes+=v.byteLength;if(bytes>maxBytes)return false;}
  else if(v&&typeof v==='object'){
   if(Array.isArray(v)){if(v.length>maxArray)return false;for(const x of v)stack.push([x,depth+1]);}
   else{const keys=Object.keys(v);if(keys.length>maxArray)return false;for(const k of keys)stack.push([v[k],depth+1]);}
  }
 }
 return true;
}
function install(ipcMain){
 if(ipcMain.__possistemInputBudget)return;ipcMain.__possistemInputBudget=true;
 const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,listener)=>handle(channel,(event,...args)=>{for(const input of args)if(!withinBudget(input))throw Error('Sorğunun ölçüsü və ya dərinliyi limiti keçir.');return listener(event,...args);});
}
module.exports={withinBudget,install};
