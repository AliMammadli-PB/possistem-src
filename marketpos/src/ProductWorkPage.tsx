import {useState} from 'react';
import {ProductModal} from './forms';
import {marketCoreClient} from './core/client';
import type {Lang,PersistedState,SessionUser} from './types';

/** A closable workspace page; only the native permission-checked handler writes. */
export function ProductWorkPage({state,session,lang,onRefresh,notify}:{state:PersistedState;session:SessionUser;lang:Lang;onRefresh:()=>Promise<unknown>;notify:(message:string)=>void}) {
 const [saved,setSaved]=useState(''),[revision,setRevision]=useState(0);
 if(saved)return <section className="product-work-page"><h2>Məhsul saxlanıldı</h2><p>{saved}</p><button type="button" onClick={()=>{setSaved('');setRevision(v=>v+1);}}>Başqa məhsul yarat</button></section>;
 return <ProductModal key={revision} inline lang={lang} products={state.products} warehouses={state.warehouses} session={session} product={null} onClose={()=>window.dispatchEvent(new CustomEvent('market:work-close',{detail:'new-product'}))} onSave={async product=>{
  const result=await marketCoreClient.products.create(product,session.id);
  setSaved(result.name.az);notify('Məhsul saxlanıldı');
  await onRefresh().catch(()=>notify('Məhsul saxlanıldı; siyahını yeniləyin.'));
 }}/>;
}
