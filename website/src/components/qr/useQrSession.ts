'use client';
import {useEffect,useRef,useState} from 'react';
type Visit={token:string;expiresAt:string;serverNow:string;active:boolean};
export function useQrSession(endpoint:string){
 const [visit,setVisit]=useState<Visit|null>(null),[left,setLeft]=useState(0),[error,setError]=useState('');
 const inflight=useRef<Promise<void>|null>(null),identity=useRef<string|undefined>(undefined),clock=useRef({at:0,remaining:0});
 const start=()=>{
  if(inflight.current)return inflight.current;
  setError('');
  const params=new URLSearchParams(location.hash.slice(1));
  const existing=identity.current??(params.has('s')?params.get('s')!:undefined);
  inflight.current=(async()=>{try{
   const r=await fetch('/pos/api/'+endpoint+'/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(existing===undefined?{}:{sessionToken:existing}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20000)}),data=await r.json();
   if(!r.ok)throw Error(data.error||'Sifariş sessiyası açıla bilmədi.');
   const next=data as Visit;identity.current=next.token;
   // Personal expiry is carried in the address across refresh, reopen and shared links.
   const url=new URL(location.href);url.hash=new URLSearchParams({s:next.token}).toString();history.replaceState(history.state,'',url);
   clock.current={at:performance.now(),remaining:next.active?Math.max(0,Date.parse(next.expiresAt)-Date.parse(next.serverNow)):0};
   setLeft(clock.current.remaining);setVisit(next);
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{inflight.current=null}})();
  return inflight.current;
 };
 useEffect(()=>{void start();},[endpoint]);
 useEffect(()=>{if(!visit)return;const tick=()=>setLeft(Math.max(0,clock.current.remaining-(performance.now()-clock.current.at)));const visible=()=>{tick();if(!document.hidden)void start()};const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible)};},[visit]);
 return {token:visit?.token,ready:!!visit,expired:!!visit&&left<=0,error,retry:start,seconds:Math.ceil(left/1000)};
}
