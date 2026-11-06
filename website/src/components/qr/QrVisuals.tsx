'use client';
import {useEffect,useState} from 'react';
const paths:Record<string,string>={
 search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 table:'M3 4h18v14H3zM9 4v14m6-14v14M3 11h18M5 18v3m14-3v3',
 plus:'M12 5v14M5 12h14',
 minus:'M5 12h14',
 close:'M6 6l12 12M18 6 6 18',
 arrow:'M5 12h14m-6-6 6 6-6 6',
 check:'m5 12 4 4L19 6',
 clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v5l3 2',
 utensils:'M4 3v7a3 3 0 0 0 6 0V3M7 3v18M18 3c-3 3-4 7 0 9v9M18 3v9',
};
export function QrIcon({name,className=''}:{name:string;className?:string}){return <svg className={'qr-icon '+className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.utensils}/></svg>}
/** The restaurant's mark on a round plate; its initial when no logo is set or the logo fails. */
export function QrLogo({src,title}:{src:string;title:string}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);return <span className="qr-brand-mark">{src&&!failed?<img src={src} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span aria-hidden="true">{title.trim().charAt(0).toLocaleUpperCase('az')}</span>}</span>}
/** A dish on the table: its photo on a round plate, or the empty plate itself. */
export function QrPlate({src,className=''}:{src:string;className?:string}){const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);return <span className={'qr-plate '+className} aria-hidden="true">{src&&!failed?<img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:null}</span>}
