import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw } from 'lucide-react';
import { marketCoreClient } from './core/client';
import type { Lang } from './types';

type Group = {key:string;label:string;permissions:{key:string;label:string;hint?:string}[]};
type Role = {name:string;permissions:string[]};
type Policy = {version:number;roles:Role[];catalogue:Group[];entitlements?:{unrestricted:boolean;allowed:string[]}};
const ROLES=['manager','head_cashier','cashier','warehouse'];

/** The owner is an ordinary editable manager; only the verified superadmin
 * session may publish grants, using the same server policy as the website. */
export function RolePermissionsPanel({superAdmin=false,sessionToken,lang='az'}:{actorRole:string;superAdmin?:boolean;sessionToken:string;lang?:Lang}) {
  const t=(az:string,ru:string,en:string)=>lang==='ru'?ru:lang==='en'?en:az;
  const [policy,setPolicy]=useState<Policy|null>(null),[role,setRole]=useState('manager'),[draft,setDraft]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    setError('');
    try{
      if(superAdmin){setPolicy(await window.marketSystem!.permissions.get(sessionToken));}
      else {const [cat,list]=await Promise.all([marketCoreClient.auth.permissionCatalogue(),marketCoreClient.auth.roles()]);setPolicy({version:0,roles:list.roles.map(r=>({name:r.role,permissions:r.permissions})),catalogue:Object.entries(cat.groups).map(([key,rows])=>({key,label:key,permissions:rows.map(r=>({key:r.permission,label:r.label}))}))});}
    }catch(e){setError((e as Error).message);}
  },[sessionToken,superAdmin]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{setDraft(policy?.roles.find(r=>r.name===role)?.permissions??[]);},[policy,role]);
  const roleLabel=(key:string)=>({manager:t('Müdir / Sahibkar','Руководитель / Владелец','Manager / Owner'),head_cashier:t('Baş kassir','Старший кассир','Head cashier'),cashier:t('Kassir','Кассир','Cashier'),warehouse:t('Anbardar','Кладовщик','Storekeeper')}[key]||key);
  const save=async()=>{
    if(busy||!policy||!superAdmin)return;setBusy(true);setError('');setNotice('');
    try{const next=await window.marketSystem!.permissions.save(sessionToken,role,draft,policy.version);setPolicy(next);setNotice(t('Saxlanıldı. Bu hesabın onlayn kassalarında icazələr yenilənir.','Сохранено. Права обновляются на кассах этого аккаунта.','Saved. Permissions are updating on this account’s online tills.'));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const locked=(key:string)=>!superAdmin||busy||Boolean(policy?.entitlements&&!policy.entitlements.unrestricted&&!policy.entitlements.allowed.includes(key));
  return <section className="module-page role-permissions"><section className="page-intro"><div><p>{t('SƏLAHİYYƏTLƏR','ПРАВА ДОСТУПА','PERMISSIONS')}</p><h2>{t('Rollar və səlahiyyətlər','Роли и права','Roles and permissions')}</h2><span>{superAdmin?t('Bölmələrə giriş və əməliyyat hüquqları ayrıdır. Dəyişikliklər bu sahibkarın Market kassalarına tətbiq olunur.','Доступ к разделам и действиям настраивается отдельно. Изменения применяются к Market-кассам владельца.','Section access and actions are separate. Changes apply to the owner’s Market tills.'):t('İcazələri yalnız superadmin dəyişir.','Права изменяет только суперадминистратор.','Only the superadmin can change permissions.')}</span></div><ShieldCheck/></section>
    <button type="button" disabled={busy} onClick={()=>void load()}><RefreshCw/>{t('Yenilə','Обновить','Refresh')}</button>
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {policy?<><div className="role-chips">{ROLES.map(key=><button key={key} type="button" disabled={busy} className={role===key?'primary-action':''} onClick={()=>{setRole(key);setNotice('');}}>{roleLabel(key)}</button>)}</div>
    <div className="role-editor">{policy.catalogue.map(group=><fieldset className="role-group" key={group.key} disabled={busy}><legend>{group.label}</legend>{superAdmin&&<button type="button" disabled={busy} onClick={()=>{const keys=group.permissions.map(p=>p.key).filter(k=>!locked(k));const all=keys.every(k=>draft.includes(k));setDraft(prev=>all?prev.filter(k=>!keys.includes(k)):[...new Set([...prev,...keys])]);}}>{t('Hamısını seç / bağla','Выбрать / снять все','Select / clear all')}</button>}{group.permissions.map(p=><label className="role-permission" key={p.key}><input type="checkbox" checked={draft.includes(p.key)} disabled={locked(p.key)} onChange={()=>setDraft(prev=>prev.includes(p.key)?prev.filter(k=>k!==p.key):[...prev,p.key])}/><span>{p.label}{p.hint&&<small>{p.hint}</small>}</span></label>)}</fieldset>)}
    {superAdmin&&<div className="role-actions"><button type="button" className="primary-action" disabled={busy} onClick={()=>void save()}>{busy?'…':t('İcazələri saxla','Сохранить права','Save permissions')}</button></div>}</div></>:!error&&<p role="status">{t('Yüklənir…','Загрузка…','Loading…')}</p>}
  </section>;
}
