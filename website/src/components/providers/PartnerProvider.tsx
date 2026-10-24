'use client';
import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
export type Partner={id:string;name:string;login:string;phone:string};
type Session={partner:Partner;csrfToken:string};
type State={partner:Partner|null;prices:Record<string,number>;loading:boolean;error:boolean};
type Value=State&{checkoutProof:()=>Promise<string|undefined>;login:(login:string,password:string)=>Promise<void>;logout:()=>Promise<void>;refresh:()=>Promise<void>};
const Context=createContext<Value|null>(null);
async function request(path:string,options:RequestInit={}){
 const response=await fetch(`/pos/api/partner/${path}`,{...options,credentials:'include',cache:'no-store',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 if(response.status===401&&path==='me')return null;
 const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.error||'Sorğu tamamlanmadı.');return data;
}
export function PartnerProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<State>({partner:null,prices:{},loading:true,error:false});
 const authenticated=useRef(false);
 const csrf=useRef(''),sequence=useRef(0),channel=useRef<BroadcastChannel|null>(null);
 const refresh=useCallback(async()=>{
  const generation=++sequence.current;
  try{
   const session=await request('me') as Session|null;
   if(generation!==sequence.current)return;
   if(!session){authenticated.current=false;csrf.current='';setState({partner:null,prices:{},loading:false,error:false});return;}
   const {prices}=await request('prices') as {prices:Record<string,number>};
   if(generation!==sequence.current)return;
   authenticated.current=true;csrf.current=session.csrfToken;setState({partner:session.partner,prices,loading:false,error:false});
  }catch(err){if(generation===sequence.current){authenticated.current=false;csrf.current='';setState({partner:null,prices:{},loading:false,error:true});}throw err;}
 },[]);
 useEffect(()=>{
  let alive=true;const sync=()=>{if(alive)void refresh().catch(()=>{});};sync();
  const timer=window.setInterval(()=>{if(authenticated.current)sync();},60_000);window.addEventListener('focus',sync);window.addEventListener('pageshow',sync);
  const visibility=()=>{if(document.visibilityState==='visible')sync();};document.addEventListener('visibilitychange',visibility);
  if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('possistem-partner-session');channel.current.onmessage=sync;}
  return()=>{alive=false;sequence.current++;clearInterval(timer);window.removeEventListener('focus',sync);window.removeEventListener('pageshow',sync);document.removeEventListener('visibilitychange',visibility);channel.current?.close();channel.current=null;};
 },[refresh]);
 const login=useCallback(async(login:string,password:string)=>{await request('login',{method:'POST',body:JSON.stringify({login,password})});await refresh();channel.current?.postMessage('changed');},[refresh]);
 const logout=useCallback(async()=>{
  try{await request('logout',{method:'POST',headers:{'x-partner-csrf':csrf.current}});}catch(err){await refresh().catch(()=>{});throw err;}
  sequence.current++;authenticated.current=false;csrf.current='';setState({partner:null,prices:{},loading:false,error:false});channel.current?.postMessage('changed');
 },[refresh]);
 const checkoutProof=useCallback(async()=>{if(!authenticated.current)return undefined;const result=await request('checkout-proof',{method:'POST',headers:{'x-partner-csrf':csrf.current}});return result.proof as string;},[]);
 return <Context.Provider value={{...state,login,logout,refresh,checkoutProof}}>{children}</Context.Provider>;
}
export function usePartner(){const value=useContext(Context);if(!value)throw new Error('PartnerProvider is required');return value;}
