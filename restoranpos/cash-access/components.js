/** The same native readiness check shown on tables, bills and till management. */
function PsSaleAccessNotice(){
 const location=useLocation(),path=location.pathname,has=useAuthStore(s=>s.hasPermission);
 const [state,setState]=reactExports.useState(null),[error,setError]=reactExports.useState(''),[busy,setBusy]=reactExports.useState(false);
 const relevant=path==='/tables'||path.startsWith('/orders/')||(path==='/operations'&&new URLSearchParams(location.search).get('tab')==='kassa');
 const refresh=reactExports.useCallback(async()=>{try{const r=await window.pos.business.call('sale.readiness',{});if(!r.success)throw Error(r.error?.message||'Kassa vəziyyəti yoxlanılmadı');if(typeof r.data?.ready!=='boolean')throw Error('Kassa vəziyyəti alınmadı. POS-u yeniləyin.');setState(r.data);setError('');}catch(e){setState(null);setError(String(e?.message||e));}},[]);
 reactExports.useEffect(()=>{if(!relevant||window.__psCloudBranchMode||psMarketMode())return;let alive=true;const tick=()=>{if(alive)void refresh();};tick();const timer=setInterval(tick,5000);window.addEventListener('focus',tick);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',tick);};},[relevant,refresh]);
 if(!relevant||window.__psCloudBranchMode||psMarketMode()||state?.ready)return null;
 const opening=async()=>{if(busy)return;setBusy(true);try{const r=await window.pos.business.call('sale.open',{idempotencyKey:newIdempotencyKey()});if(!r.success)throw Error(r.error?.message);await refresh();}catch(e){await refresh();setError(String(e?.message||e));}finally{setBusy(false);}};
 return psH('section',{className:'ps-sale-access',role:state?'alert':'status'},psH('div',null,psH('strong',null,state?.reason==='missing_register'?'Kassa təyin edilməyib':state?'Kassa açıq deyil':'Kassa yoxlanılır'),psH('p',null,error||state?.message||'Satış üçün kassa vəziyyəti yoxlanılır.')),
 state?.reason==='closed'&&(has('businessDay.manage')||has('shift.manage'))?psH('button',{className:'btn solid',disabled:busy,onClick:opening},busy?'Açılır…':'Kassanı aç'):null,
 state?.reason==='missing_register'&&has('cash.accounts')?jsxRuntimeExports.jsx(Link,{className:'btn outline',to:'/operations?tab=kassa',children:'Kassalara keç'}):null,
 state?.reason==='closed'&&!(has('businessDay.manage')||has('shift.manage'))?psH('span',null,'Kassanın açılması üçün müdirə müraciət edin.'):null,
 psH('button',{className:'btn outline',disabled:busy,onClick:refresh},'Yenidən yoxla'));
}
