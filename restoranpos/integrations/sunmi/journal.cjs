'use strict';
// One bounded-size file per document; a year's receipts must not be parsed on every checkout.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
function createJournalStore(root,{read,atomic}){
 const indexFile=path.join(root,'journal.json'),index=read(indexFile,{version:2,recent:[],unresolved:[]}),cache=new Map(),original=new Map(),deleted=new Set();
 const hash=id=>createHash('sha256').update(id).digest('hex');
 const file=id=>{const h=hash(id);return path.join(root,'jobs',h.slice(0,2),h+'.json');};
 const parentFile=id=>path.join(root,'parents',hash(id)+'.json');
 const get=id=>{if(deleted.has(id))return undefined;if(!cache.has(id)){const job=read(file(id),null);if(job){cache.set(id,job);original.set(id,JSON.stringify(job));}else return undefined;}return cache.get(id);};
 const jobs=new Proxy(Object.create(null),{get:(_,id)=>typeof id==='string'?get(id):undefined,set:(_,id,value)=>{if(!original.has(id)){const old=read(file(id),null);original.set(id,old?JSON.stringify(old):null);}cache.set(id,value);deleted.delete(id);return true;},deleteProperty:(_,id)=>{deleted.add(id);cache.delete(id);return true;},ownKeys:()=>index.recent.filter(id=>get(id)),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
 const flush=()=>{
  for(const id of deleted){const f=file(id);if(fs.existsSync(f))fs.renameSync(f,f+'.previous');index.recent=index.recent.filter(x=>x!==id);index.unresolved=index.unresolved.filter(x=>x!==id);}
  for(const[id,job]of cache){const data=JSON.stringify(job);if(data===original.get(id))continue;
   atomic(file(id),job);
   if(job.parentId){const parents=read(parentFile(job.parentId),[]);if(!parents.includes(id)){parents.push(id);atomic(parentFile(job.parentId),parents);}}
   if(!index.recent.includes(id))index.recent.push(id);index.recent=index.recent.slice(-100);
   index.unresolved=index.unresolved.filter(x=>x!==id);if(job.state!=='done')index.unresolved.push(id);
   original.set(id,data);
  }
  atomic(indexFile,index);deleted.clear();
 };
 return {jobs,flush,children:parent=>read(parentFile(parent),[]).map(get).filter(Boolean),unresolved:()=>index.unresolved.map(get).filter(Boolean)};
}
module.exports={createJournalStore};
