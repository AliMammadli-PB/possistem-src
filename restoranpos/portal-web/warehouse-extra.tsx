import React,{useEffect,useState} from '../../marketpos/node_modules/react';
import {createRoot} from '../../marketpos/node_modules/react-dom/client';
import {TransfersPage} from '../../marketpos/src/TransfersPage';
import {DocumentsPage} from '../../marketpos/src/DocumentsPage';
import '../../marketpos/src/styles.css';
const deviceId=new URLSearchParams(location.search).get('device')||'',host=window.parent as any,api=host.cloudBranches;
const result=async(method:string,payload:any={},key?:string)=>{try{const batch=await api.rpc(deviceId,[{method,payload,...(key?{idempotencyKey:key}:{})}]);return batch.results?.[0]||{success:false,error:{message:'POS cavabı alınmadı'}};}catch(e){return {success:false,error:{message:(e as Error).message}};}};
const w=window as any;
w.marketOps={invoke:({method,payload,idempotencyKey}:any)=>result(method,payload,idempotencyKey)};
w.marketCore={invoke:async(method:string,payload:any)=>{if(method!=='auth.checkPermission')return {success:false,error:{message:'Bu əməliyyat POS-da edilir'}};return {success:true,data:{allowed:payload.permission==='DOCS_VIEW'||!api.readOnly}};}};
w.marketSystem={branchContext:async()=>({branchName:api.branchName||''})};
const session={id:'owner-portal',name:'Sahibkar',role:'manager',sessionToken:'portal-owner'} as any;
function App(){const [tab,setTab]=useState(()=>new URLSearchParams(location.hash.split('?')[1]).get('tab')||'documents');useEffect(()=>{const onHash=()=>setTab(new URLSearchParams(location.hash.split('?')[1]).get('tab')||'documents');window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash);},[]);return <main style={{minHeight:'100vh',background:'#f3f6fb',padding:'8px',color:'#1b3453'}}>{tab==='transfers'?<TransfersPage session={session} lang="az"/>:<DocumentsPage session={session} lang="az"/>}</main>;}
createRoot(document.getElementById('root')!).render(<App/>);
