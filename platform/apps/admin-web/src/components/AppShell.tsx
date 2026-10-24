import { SupportDesk } from './SupportDesk';
import {Icon,type IconName} from './ConsoleIcon';
import {BrandMark} from './BrandMark';
import { useEffect, useRef, useState } from 'react';
import { resetLiveDrafts } from '../lib/live';
import { NavLink, Outlet,useLocation,useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { POS_PRODUCTS, useProduct } from '../lib/product';
import { ProductGate } from './ProductGate';
import { useI18n } from '../i18n';

export function AppShell() {
  const { user, logout, insecureTransport } = useAuth();
  const { product, setProduct, chosen } = useProduct();
  const t = useI18n();
  const navigate=useNavigate();
  const changeProduct=(next:'market'|'restaurant')=>{if(window.__possistemDirty&&!window.confirm('Saxlanmamış dəyişikliklər var. POS seçimini dəyişmək istəyirsiniz?'))return;setProduct(next);const query=new URLSearchParams(location.search);if(query.has('product')){query.set('product',next);navigate({pathname:location.pathname,search:'?'+query.toString()},{replace:true});}};
  const location=useLocation(),[menuOpen,setMenuOpen]=useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(()=>{setMenuOpen(false);resetLiveDrafts();},[location.pathname, product]);
  useEffect(() => {
    const back = () => { if (menuOpen) { setMenuOpen(false); return true; } return false; };
    window.__possistemBack = back;
    if (menuOpen) sidebar.current?.querySelector<HTMLElement>('a,button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (!menuOpen) return;
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab') {
        const nodes = sidebar.current?.querySelectorAll<HTMLElement>('a,button,select');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length-1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown',key);
    return () => { document.removeEventListener('keydown',key); delete window.__possistemBack; };
  }, [menuOpen]);

  // Open-request count in the sidebar. Support was invisible unless someone was
  // already standing on the Support page, so a shop could wait days for a reply.
  const [openTickets, setOpenTickets] = useState(0);
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const data = await api<{ openCount?: number }>('/support/tickets?status=open');
        if (alive) setOpenTickets(Number(data.openCount ?? 0));
      } catch {
        /* a failed poll must not break the shell */
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // Asked once per browser, then remembered. Placed here rather than in a
  // route so it covers every screen the shell wraps, including the ones
  // reached by typing an address.
  if (!chosen&&!location.pathname.startsWith('/support')) return <ProductGate />;

  const NAV = [
    { to: '/', label: t.nav.dashboard, end: true },
    { to: '/admins', label: t.nav.admins },
    { to: '/new-customer', label: t.nav.newCustomer },
    { to: '/sales', label: t.nav.sales },
    { to: '/leads', label: t.nav.leads },
    { to: '/support', label: t.nav.support, badge: openTickets },
    { to: '/setup', label: t.nav.setup },
    { to: '/products', label: t.nav.products },
    { to: '/partners', label: 'Partnyorlar' },
    { to: '/billing/subscriptions', label: 'Abunəliklər' },
    { to: '/billing/payments', label: 'Ödənişlər' },
    { to: '/billing/orders', label: 'Sifarişlər' },
    { to: '/billing/settings', label: 'Ödəniş parametrləri' },
    { to: '/settings', label: t.nav.settings },
    { to: '/support-service', label: 'Dəstək ayarları' },
  ];

  return (
    <div className={'shell console-shell'+(menuOpen?' console-menu-open':'')}>
      {insecureTransport && (
        <div className="banner-insecure" role="alert">
          {t.insecure}
        </div>
      )}
      <header className="topbar console-topbar"><div className="console-topbar-heading"><button ref={menuButton} className="console-menu" aria-label="Menyunu aç" aria-expanded={menuOpen} aria-controls="console-navigation" onClick={()=>setMenuOpen(v=>!v)}><Icon name="menu"/></button><span><small>İDARƏETMƏ MƏRKƏZİ</small><strong>{NAV.find(n=>n.to==='/'?location.pathname==='/':(location.pathname===n.to||location.pathname.startsWith(n.to+'/')))?.label||'Müştəri məlumatları'}</strong></span></div><div className="console-topbar-actions"><span className="console-live">Admin hesabı</span><label className="console-product"><span>POS seçimi</span><select aria-label="Admin POS seçimi" value={product} onChange={e=>changeProduct(e.target.value as 'market'|'restaurant')}>{POS_PRODUCTS.map(p=><option key={p} value={p}>{p==='market'?t.nav.productMarket:t.nav.productRestaurant}</option>)}</select></label><span className="console-avatar" title={user?.email}>PS</span></div></header>
      <aside ref={sidebar} className="sidebar" id="console-navigation">
        <a className="brand" href="/" aria-label="Possistem ana səhifə" style={{textDecoration:'none',color:'inherit'}}>
          <BrandMark/>
          <div>
            <div className="brand-name">{t.brand}</div>
            <div className="brand-sub">{t.brandSub}</div>
          </div>
        </a>
        <button className="console-menu-close btn" onClick={()=>{setMenuOpen(false);menuButton.current?.focus();}} aria-label="Menyunu bağla">Bağla ×</button><p className="console-nav-caption">İŞ SAHƏSİ</p>
        <nav className="nav" aria-label={t.brandSub}>
          {NAV.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={event=>{if(window.__possistemDirty&&!window.confirm('Saxlanmamış dəyişikliklər var. Başqa bölməyə keçmək istəyirsiniz?'))event.preventDefault();}}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon name={(['home','user','building','activity','mail','help','download','file','user','key','integrations','settings'] as IconName[])[index]||'file'} size={19}/>
              <span>{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-email">{user?.email}</div>
          <button type="button" className="btn ghost" onClick={() => void logout()}>
            {t.logout}
          </button>
        </div>
      </aside>
      {menuOpen&&<button className="console-scrim" aria-label="Menyunu bağla" onClick={()=>setMenuOpen(false)}/>}
      <main className="main"><SupportDesk/>
        <div key={product}><Outlet /></div>
      </main>
    </div>
  );
}
