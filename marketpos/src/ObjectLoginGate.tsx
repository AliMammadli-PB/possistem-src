import {useEffect,useRef} from 'react';
import type {Lang} from './types';
export function ObjectLoginGate({lang,onDone,onLogout}:{lang:Lang;onDone:()=>void;onLogout:()=>void}){
 const frame=useRef<HTMLIFrameElement>(null);
 const confirmed=useRef(false);
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||event.origin!==location.origin)return;if(event.data?.type==='pos:object:selected'&&!confirmed.current){confirmed.current=true;onDone();}if(event.data?.type==='pos:object:logout')onLogout();};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[onDone,onLogout]);
 return <iframe ref={frame} title={lang==='ru'?'Выбор филиала':lang==='en'?'Choose branch':'Filial seçimi'} src={'./cloud-branches/selection.html?lang='+lang} style={{display:'block',width:'100vw',height:'100dvh',border:0,background:'#f1f5fb'}}/>;
}
