import {useCallback,useEffect,useRef,useState} from 'react';
import {marketCoreClient} from './core/client';
import type {CartLine} from './types';
export function useCartApproval(cart:CartLine[],setCart:(rows:CartLine[])=>void,discountMinor:number,enabled:boolean,restoreDiscount:(minor:number)=>void,notify:(message:string)=>void){
 const [ready,setReady]=useState(!enabled),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const queue=useRef<Promise<any>>(Promise.resolve()),current=useRef({cart,discountMinor});current.current={cart,discountMinor};
 useEffect(()=>{if(!enabled){setReady(true);return;}let live=true;setReady(false);void marketCoreClient.cart.state().then(state=>{if(!live)return;if(!current.current.cart.length&&state.lines?.length){setCart(state.lines);restoreDiscount(Number(state.discountMinor)||0);}setDirty(Boolean(state.dirty));setRevision(Number(state.revision)||0);setReady(true);}).catch(e=>{if(live)notify(e.message);});return()=>{live=false;};},[enabled]);
 const flush=useCallback(()=>{
  if(!enabled)return Promise.resolve({dirty:false,revision:0});const snapshot=current.current;
  const job=queue.current.catch(()=>{}).then(()=>marketCoreClient.cart.sync(snapshot.cart,snapshot.discountMinor));queue.current=job;
  return job.then(state=>{setDirty(Boolean(state.dirty));setRevision(Number(state.revision)||0);return state;});
 },[enabled]);
 useEffect(()=>{if(ready&&enabled)void flush().catch(e=>notify(e.message));},[cart,discountMinor,ready,enabled,flush]);
 const approve=async(pin:string)=>{setBusy(true);try{const state=await flush();const approved=await marketCoreClient.cart.approve(state.revision,pin);setDirty(Boolean(approved.dirty));setRevision(Number(approved.revision)||0);}finally{setBusy(false);}};
 return {ready,dirty,busy,revision,flush,approve};
}
