import {useCallback,useEffect,useRef,useState} from 'react';

/** Loader changes invalidate in-flight responses, especially when switching POS. */
export function usePolling<T>(loader:()=>Promise<T>,intervalMs:number){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState<Error|null>(null),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false);
 const generation=useRef(0),running=useRef<number|null>(null),latest=useRef<T|null>(null);
 const load=useCallback(async(manual=false,token=generation.current)=>{
  if(token!==generation.current||running.current===token)return;
  running.current=token;if(manual||latest.current)setRefreshing(true);
  try{const value=await loader();if(token!==generation.current)return;latest.current=value;setData(value);setError(null);}
  catch(cause){if(token===generation.current)setError(cause instanceof Error?cause:new Error('Məlumat yüklənmədi.'));}
  finally{if(token===generation.current){running.current=null;setLoading(false);setRefreshing(false);}}
 },[loader]);
 useEffect(()=>{
  const token=++generation.current;running.current=null;latest.current=null;setData(null);setError(null);setLoading(true);setRefreshing(false);
  const run=()=>{if(document.visibilityState!=='hidden')void load(false,token);};run();
  const timer=window.setInterval(run,intervalMs);document.addEventListener('visibilitychange',run);
  return()=>{generation.current++;window.clearInterval(timer);document.removeEventListener('visibilitychange',run);};
 },[load,intervalMs]);
 return {data,error,loading,refreshing,reload:()=>load(true)};
}
