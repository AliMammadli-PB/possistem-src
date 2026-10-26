'use client';
import {useEffect,useRef,useState} from 'react';
import type {MascotState} from '@/components/marketing/mascot-animation';
export default function MascotStudio(){
 const canvas=useRef<HTMLCanvasElement>(null),[ready,setReady]=useState(false),[error,setError]=useState(false),[playing,setPlaying]=useState(true),[yaw,setYaw]=useState(0);
 const state=useRef<MascotState>({gesture:'cycle',motion:'full',preference:'full'}),view=useRef(0);
 state.current={gesture:'cycle',motion:playing?'full':'off',preference:playing?'full':'off'};view.current=yaw*Math.PI/180;
 useEffect(()=>{const ac=new AbortController();let cleanup:(()=>void)|undefined;let mounted=true;const timer=setTimeout(()=>ac.abort(),15000);
 void import('@/components/marketing/mascot-three').then(async({mountMascot3D})=>{if(!canvas.current||ac.signal.aborted)return;const c=await mountMascot3D(canvas.current,()=>state.current,ac.signal,()=>{if(mounted)setError(true);},()=>view.current);cleanup=c.dispose;clearTimeout(timer);if(mounted)setReady(true);else c.dispose();}).catch(()=>{if(mounted)setError(true);});
 return()=>{mounted=false;clearTimeout(timer);ac.abort();cleanup?.();};},[]);
 return <main style={{maxWidth:1060,margin:'0 auto',padding:'32px 20px 48px'}}><a href="/">← Possistem</a><h1 style={{fontSize:'clamp(26px,4vw,42px)',margin:'20px 0 8px'}}>Possistem · 3D maskot</h1><p>Ön, yan və arxa görünüşü çevirərək yoxlayın. Gözlər kursoru izləyir.</p>
 <div style={{position:'relative',height:'min(65vh,600px)',minHeight:320,borderRadius:24,background:'radial-gradient(ellipse at 50% 35%,#204d7b,#0a1930 75%)',margin:'24px 0',overflow:'hidden'}}>
 <canvas ref={canvas} aria-label="Possistem maskotunun interaktiv üçölçülü görünüşü" style={{width:'100%',height:'100%',display:'block'}}/>
 {!ready&&!error&&<p role="status" style={{position:'absolute',bottom:20,left:24,color:'white'}}>3D model yüklənir…</p>}
 {error&&<p role="alert" style={{position:'absolute',bottom:20,left:24,color:'white'}}>Bu brauzerdə 3D görünüş açıla bilmədi. GLB faylını endirib Blender-də aça bilərsiniz.</p>}
 </div>
 <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>{[['Ön',0],['Yan',90],['Arxa',180]] .map(([label,angle])=><button key={label} type="button" onClick={()=>setYaw(Number(angle))} style={{padding:'10px 20px',borderRadius:10,border:'1px solid #7698bd',background:'#173b66',color:'white'}}>{label}</button>)}<button type="button" aria-pressed={!playing} onClick={()=>setPlaying(!playing)} style={{padding:'10px 20px',borderRadius:10,border:'1px solid #7698bd',background:'#173b66',color:'white'}}>{playing?'Hərəkəti dayandır':'Hərəkəti davam et'}</button><a href="/assets/mascot-3d/possistem-assistant-v1.glb" download style={{marginLeft:'auto'}}>GLB-ni endir ↓</a></div>
 <label style={{display:'flex',alignItems:'center',gap:16,margin:'22px 0'}}>Döndər <input type="range" min="-180" max="180" value={yaw} onChange={e=>setYaw(Number(e.target.value))} style={{flex:1}}/><output style={{minWidth:48}}>{yaw}°</output></label>
 <p style={{fontSize:14,opacity:.75}}>Tam həcmli model · keramika və metal materiallar · oynaq qollar · hərəkətli baxış</p></main>;
}
