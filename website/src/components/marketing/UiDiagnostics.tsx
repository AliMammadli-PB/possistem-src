'use client';
import { useEffect, useState } from 'react';
import { readUiState, UI_DIAGNOSTIC_EVENT, uiDebugEnabled } from '@/lib/ui-diagnostics';
import { useI18n } from '@/components/providers/I18nProvider';
import './ui-diagnostics.css';
const COPY = {
 az:{title:'Görünüş diaqnostikası',copy:'Hesabatı kopyala',done:'Kopyalandı',manual:'Hesabatı seçib kopyalayın',note:'Yalnız brauzer və görünüş vəziyyəti. Hesab və yazışma məlumatı daxil edilmir.'},
 en:{title:'UI diagnostics',copy:'Copy report',done:'Copied',manual:'Select and copy the report',note:'Browser and UI state only. No account or conversation data.'},
 ru:{title:'Диагностика интерфейса',copy:'Скопировать отчёт',done:'Скопировано',manual:'Выделите и скопируйте отчёт',note:'Только браузер и состояние интерфейса. Без данных аккаунта и переписки.'},
};
export function UiDiagnostics() {
 const {language}=useI18n(),c=COPY[language];
 const [enabled,setEnabled]=useState(false),[report,setReport]=useState(''),[copied,setCopied]=useState(false),[manual,setManual]=useState(false);
 useEffect(()=>{
  if(!uiDebugEnabled())return;
  setEnabled(true);const errors:{name:string;line:number;file:string}[]=[];
  const update=()=>setReport(JSON.stringify({...readUiState(),browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme,
   reducedMotion:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches,
   mascotSvg:(()=>{const svg=document.querySelector('.support-mascot');if(!svg)return null;return {head:svg.querySelector('[data-part="head"]')?.getAttribute('transform'),eye:svg.querySelector('[data-part="eye-left"]')?.getAttribute('transform'),scene:svg.getAttribute('data-scene')};})(),
   features:{intersectionObserver:typeof IntersectionObserver==='function',resizeObserver:typeof ResizeObserver==='function',viewTransition:typeof (document as Document&{startViewTransition?:unknown}).startViewTransition==='function'},errors},null,2));
  const error=(event:ErrorEvent)=>{let file='';try{const p=new URL(event.filename,location.origin).pathname;if(p.startsWith('/_next/'))file=p;}catch{/* no raw URLs */}
   const name=String(event.error?.name??'Error');errors.push({name:/^(Type|Syntax|Reference|Range|Eval|URI)?Error$/.test(name)?name:'Error',file,line:event.lineno||0});if(errors.length>20)errors.shift();update();};
  window.addEventListener(UI_DIAGNOSTIC_EVENT,update);window.addEventListener('error',error);window.addEventListener('resize',update);update();
  return()=>{window.removeEventListener(UI_DIAGNOSTIC_EVENT,update);window.removeEventListener('error',error);window.removeEventListener('resize',update);};
 },[]);
 if(!enabled)return null;
 return <details className="ps-ui-debug"><summary>{c.title}</summary><p>{c.note}</p><button type="button" onClick={()=>{if(!navigator.clipboard?.writeText){setManual(true);return;}void navigator.clipboard.writeText(report).then(()=>setCopied(true)).catch(()=>setManual(true));}}>{copied?c.done:c.copy}</button>{manual&&<p role="status">{c.manual}</p>}<textarea aria-label={c.title} readOnly value={report} onFocus={e=>e.currentTarget.select()}/></details>;
}
