'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/browser-ui';
import { useI18n } from '@/components/providers/I18nProvider';
import { startMascotAnimation, type MascotGesture, type MascotMotion, type EffectiveMotion } from './mascot-animation';
import './support-mascot.css';
import { mascotArtwork } from './mascot-artwork';
export type { MascotGesture, MascotMotion } from './mascot-animation';

export function useMascotMotion() {
 const reduced=useReducedMotion(),[mode,setMode]=useState<MascotMotion>('full'),[ready,setReady]=useState(false);
 useEffect(()=>{try{const saved=localStorage.getItem('possistem-mascot-motion');if(saved==='auto'||saved==='full'||saved==='off')setMode(saved);}catch{/* Motion remains usable when storage is denied. */}setReady(true);},[]);
 const change=(value:MascotMotion)=>{setMode(value);try{localStorage.setItem('possistem-mascot-motion',value);}catch{/* Current-tab selection still applies. */}};
 return {mode,change,effective:!ready||mode==='off'?'off':mode==='auto'&&reduced?'quiet':'full'} as const;
}
export function useMascotGesture(activity:MascotGesture,enabled:boolean) {
 const [hover,setHover]=useState(false);
 return {gesture:activity!=='idle'?activity:hover?'hover':enabled?'cycle':'idle',hover:setHover} as const;
}
const COPY={az:{label:'Maskot animasiyası',auto:'Sistemə uyğun',full:'Tam hərəkət',off:'Dayandır'},en:{label:'Mascot animation',auto:'System setting',full:'Full motion',off:'Pause'},ru:{label:'Анимация помощника',auto:'Как в системе',full:'Полная',off:'Остановить'}};
export function MascotMotionMenu({mode,onChange}:{mode:MascotMotion;onChange:(mode:MascotMotion)=>void}) {
 const {language}=useI18n(),c=COPY[language];
 return <details className="support-motion-menu"><summary>{c.label}</summary><div>{(['auto','full','off'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>onChange(value)}>{c[value]}</button>)}</div></details>;
}
export function SupportMascot({gesture='idle',motion='full',preference='full'}:{gesture?:MascotGesture;motion?:EffectiveMotion;preference?:MascotMotion}) {
 const id=useId().replace(/[^a-zA-Z0-9_-]/g,''),artworkId=`mascot-v3-${id}`,artwork=useMemo(()=>({__html:mascotArtwork(artworkId)}),[artworkId]);
 const svg=useRef<SVGSVGElement>(null),canvas=useRef<HTMLCanvasElement>(null),state=useRef({gesture,motion,preference}),[threeReady,setThreeReady]=useState(false);
 useEffect(()=>{state.current={gesture,motion,preference};},[gesture,motion,preference]);
 useEffect(()=>{if(!svg.current)return;return startMascotAnimation(svg.current,()=>state.current);},[motion,threeReady]);
 useEffect(()=>{
  const controller=new AbortController();let cleanup:(()=>void)|undefined;let mounted=true;
  const fail=()=>{if(mounted)setThreeReady(false);};
  const timer=window.setTimeout(()=>controller.abort(),15000);
  // Keep the existing artwork visible until both the model and first 3D frame are ready.
  void import('./mascot-three').then(async({mountMascot3D})=>{
   if(!canvas.current||controller.signal.aborted)return;
   const engine=await mountMascot3D(canvas.current,()=>state.current,controller.signal,fail);cleanup=engine.dispose;
   window.clearTimeout(timer);if(mounted)setThreeReady(true);else engine.dispose();
  }).catch(fail);
  return()=>{mounted=false;window.clearTimeout(timer);controller.abort();cleanup?.();};
 },[]);
 return <span className="support-mascot-frame" data-renderer={threeReady?'three':'svg'} aria-hidden="true"><canvas ref={canvas} className="support-mascot-canvas" style={{opacity:threeReady?1:0}}/>{!threeReady&&<svg ref={svg} className="support-mascot" data-artwork-id={artworkId} data-gesture={gesture} data-motion={motion} data-preference={preference} data-ready="false" viewBox="0 0 627 650" width="96" height="100" fill="none" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={artwork}/>}</span>;
}
