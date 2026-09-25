function PsChevronRight({size = 16, ...props}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}><path d="m9 5 7 7-7 7"/></svg>; }
function PsSearch({size = 18}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>; }
/* Compiled into the recovered renderer by apply-restaurant-admin-refresh.mjs.
 * Kept as readable JSX: no observer, DOM rewriting or dependency on Tailwind generation. */
function psAdminText(az, tr, en) {
  const lang = useI18n.getState().lang;
  return lang === 'en' ? en : lang === 'tr' ? tr : az;
}
function psAdminRoute(path) {
  return ['/admin', '/settings', '/operations', '/dashboard', '/reconcile', '/audit', '/diagnostics', '/support']
    .some(prefix => path === prefix || path.startsWith(prefix + '/'));
}
function PsAdminFrame({ children }) {
  const { t } = useI18n();
  const { pathname, search } = useLocation();
  const pages = {'/settings':t.nav.settings,'/admin/catalog':t.nav.catalog,'/admin/staff':t.nav.staff,'/admin/tables':t.nav.adminTables,'/admin/reports':t.nav.reports,'/admin/cash':t.nav.cash,'/admin/backup':psAdminText('Ehtiyat nüsxə','Yedekleme','Backup'),'/admin/gifts':t.nav.gifts,'/dashboard':t.nav.dashboard,'/reconcile':t.nav.reconcile,'/audit':t.nav.audit,'/diagnostics':t.nav.diagnostics,'/settings/license':t.nav.license,'/support':t.nav.support};
  const ops = {stock:['Anbar','Stok','Inventory'],suppliers:['Təchizat','Tedarik','Purchasing'],vendors:['Təchizatçılar','Tedarikçiler','Suppliers'],guests:['Müştərilər','Müşteriler','Customers'],reservations:['Rezervasiya','Rezervasyon','Reservations'],delivery:['Çatdırılma','Teslimat','Delivery'],roster:['İş qrafiki','Çalışma takvimi','Schedule'],export:['İxrac','Dışa aktar','Export']};
  const title = pathname === '/operations' ? psAdminText(...(ops[new URLSearchParams(search).get('tab')] || ops.stock)) : pages[pathname];
  if (!psAdminRoute(pathname)) return children;
  return <div className="ps-admin-workspace" data-page={pathname}>
    {pathname !== '/admin' && <div className="ps-admin-breadcrumb"><Link to="/admin"><LayoutGrid size={15}/>{t.nav.admin}</Link><PsChevronRight size={14}/><span>{title || t.nav.admin}</span></div>}
    <div className="ps-admin-content">{children}</div>
  </div>;
}
function PsAdminHub({ links }) {
  const [query, setQuery] = reactExports.useState('');
  const [activeTone, setActiveTone] = reactExports.useState('blue');
  const groups = [
    { title: psAdminText('Gündəlik idarəetmə', 'Günlük yönetim', 'Daily management'), hint: psAdminText('Menyu, heyət və gündəlik işlər', 'Menü, ekip ve günlük işler', 'Menu, team and daily work'), tone: 'blue', paths: ['/dashboard','/admin/catalog','/admin/staff','/operations?tab=roster','/admin/tables','/admin/gifts'] },
    { title: psAdminText('Anbar və təchizat', 'Stok ve tedarik', 'Inventory & purchasing'), hint: psAdminText('Məhsullar, alışlar və tərəfdaşlar', 'Ürünler, alımlar ve iş ortakları', 'Products, purchases and partners'), tone: 'green', paths: ['/operations?tab=stock','/operations?tab=suppliers','/operations?tab=vendors'] },
    { title: psAdminText('Müştəri xidmətləri', 'Müşteri hizmetleri', 'Guest services'), hint: psAdminText('Qonaqların hər mərhələdə yanında', 'Misafirleriniz için her adımda', 'Everything for your guests'), tone: 'purple', paths: ['/operations?tab=guests','/operations?tab=reservations','/operations?tab=delivery'] },
    { title: psAdminText('Maliyyə və hesabat', 'Finans ve raporlar', 'Finance & reporting'), hint: psAdminText('Gəlirlər, ödənişlər və nəzarət', 'Gelir, ödemeler ve denetim', 'Revenue, payments and oversight'), tone: 'amber', paths: ['/admin/cash','/admin/reports','/reconcile','/audit'] },
    { title: psAdminText('Sistem', 'Sistem', 'System'), hint: psAdminText('Cihaz, təhlükəsizlik və sazlamalar', 'Cihaz, güvenlik ve ayarlar', 'Device, security and preferences'), tone: 'slate', paths: ['/settings','/admin/backup','/settings/license','/diagnostics'] }
  ];
  const descriptions = {
    '/dashboard': ['Günün əsas göstəriciləri','Günün temel göstergeleri','Today at a glance'],
    '/admin/catalog': ['Məhsullar, qiymətlər və kateqoriyalar','Ürünler, fiyatlar ve kategoriler','Products, pricing and categories'],
    '/admin/staff': ['Heyət və giriş səlahiyyətləri','Ekip ve erişim izinleri','Team and access permissions'],
    '/admin/tables': ['Zallar və masa düzülüşü','Salonlar ve masa düzeni','Rooms and table layout'],
    '/admin/gifts': ['Kampaniyalar və hədiyyələr','Kampanyalar ve hediyeler','Campaigns and gifts'],
    '/operations?tab=roster': ['Növbələr və davamiyyət','Vardiyalar ve devam takibi','Shifts and attendance'],
    '/operations?tab=stock': ['Stok qalığı və məhsul hərəkətləri','Stok durumu ve ürün hareketleri','Stock levels and adjustments'],
    '/operations?tab=suppliers': ['Sifarişlər və mal qəbulu','Siparişler ve mal kabulü','Purchase orders and receiving'],
    '/operations?tab=vendors': ['Təchizatçı əlaqələri və hesablar','Tedarikçi bilgileri ve hesapları','Supplier contacts and accounts'],
    '/operations?tab=guests': ['Müştəri bazası və balanslar','Müşteri listesi ve bakiyeler','Customer records and balances'],
    '/operations?tab=reservations': ['Qonaqlar və masa rezervləri','Misafirler ve masa rezervleri','Guests and table bookings'],
    '/operations?tab=delivery': ['Çatdırılmalar və kuryerlər','Teslimatlar ve kuryeler','Deliveries and couriers'],
    '/admin/cash': ['Kassa mədaxili və məxarici','Kasa giriş ve çıkışları','Cash in and cash out'],
    '/admin/reports': ['Satış və iş günü hesabatları','Satış ve iş günü raporları','Sales and business day reports'],
    '/reconcile': ['Ödənişlərin yoxlanılması','Ödeme kontrolü','Payment reconciliation'],
    '/audit': ['Əməliyyat tarixçəsi','İşlem geçmişi','Activity history'],
    '/settings': ['Restoran, ekran və printer','Restoran, ekran ve yazıcı','Restaurant, display and printer'],
    '/admin/backup': ['Ehtiyat nüsxələr və bərpa','Yedekleme ve geri yükleme','Backups and recovery'],
    '/settings/license': ['Lisenziya məlumatları','Lisans bilgileri','License information'],
    '/diagnostics': ['Cihazın və bağlantının vəziyyəti','Cihaz ve bağlantı durumu','Device and connection health']
  };
  const describe = to => psAdminText(...(descriptions[to] || ['', '', '']));
  const needle = query.trim().toLocaleLowerCase(useI18n.getState().lang === 'az' ? 'az' : undefined);
  const visible = links.filter(link => (link.label + ' ' + describe(link.to)).toLocaleLowerCase(useI18n.getState().lang === 'az' ? 'az' : undefined).includes(needle));
  const availableGroups = groups.map(group => ({ ...group, items: group.paths.map(path => links.find(link => link.to === path)).filter(Boolean) })).filter(group => group.items.length);
  const selectedGroup = availableGroups.find(group => group.tone === activeTone) || availableGroups[0];
  const shownGroups = needle
    ? availableGroups.map(group => ({ ...group, items: group.items.filter(item => visible.some(link => link.to === item.to)) })).filter(group => group.items.length)
    : selectedGroup ? [selectedGroup] : [];
  return <div className="ps-admin-hub">
    <header className="ps-hub-header">
      <div className="ps-hub-intro"><span className="ps-eyebrow">POSSİSTEM <span aria-hidden="true">/</span> {psAdminText('İDARƏETMƏ', 'YÖNETİM', 'MANAGEMENT')}</span><h1>{psAdminText('Restoranı rahat idarə edin', 'Restoranı kolayca yönetin', 'Run your restaurant with ease')}</h1><p>{psAdminText('İşiniz üçün lazım olan bölmələr bir toxunuş uzaqlığındadır.', 'İşiniz için gereken bölümler bir dokunuş uzağınızda.', 'Every section you need is one tap away.')}</p></div>
      <div className="ps-hub-search"><PsSearch size={22}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={psAdminText('Bölmə axtar…','Bölüm ara…','Find a section…')} aria-label={psAdminText('Bölmə axtar','Bölüm ara','Find a section')}/>{query && <button type="button" onClick={()=>setQuery('')} aria-label={psAdminText('Axtarışı təmizlə','Aramayı temizle','Clear search')}>×</button>}</div>
    </header>
    <div className="ps-hub-layout">
      <nav className="ps-hub-categories" aria-label={psAdminText('İdarəetmə bölmələri', 'Yönetim bölümleri', 'Management sections')}>
        <div className="ps-hub-categories-label">{psAdminText('BÖLMƏLƏR', 'BÖLÜMLER', 'SECTIONS')}<span>{availableGroups.length}</span></div>
        {availableGroups.map((group, index) => <button type="button" key={group.tone} className={'ps-hub-category' + (group.tone === selectedGroup?.tone && !needle ? ' is-active' : '')} data-tone={group.tone} aria-pressed={group.tone === selectedGroup?.tone && !needle} onClick={() => { setQuery(''); setActiveTone(group.tone); }}><span className="ps-hub-category-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="ps-hub-category-name">{group.title}</span><span className="ps-hub-category-count">{group.items.length}</span></button>)}
      </nav>
      <main className="ps-hub-main">
        <div className="ps-hub-main-heading"><span className="ps-hub-kicker">{needle ? psAdminText('AXTARIŞ NƏTİCƏLƏRİ', 'ARAMA SONUÇLARI', 'SEARCH RESULTS') : psAdminText('SEÇİLMİŞ BÖLMƏ', 'SEÇİLİ BÖLÜM', 'SELECTED SECTION')}</span><h2>{needle ? psAdminText('Axtarış nəticələri', 'Arama sonuçları', 'Search results') : selectedGroup?.title}</h2><p>{needle ? psAdminText(`${visible.length} bölmə tapıldı`, `${visible.length} bölüm bulundu`, `${visible.length} sections found`) : selectedGroup?.hint}</p></div>
        <div className="ps-hub-groups">{shownGroups.map(group => <section className="ps-hub-group" key={group.tone} data-tone={group.tone}>
          {needle && <h3 className="ps-hub-result-group-title">{group.title}</h3>}
          <div className="ps-hub-links">{group.items.map(({to,label,icon:Icon,locked})=><Link className="ps-hub-link" to={to} key={to} aria-disabled={locked || undefined} onClick={locked ? (event)=>{ event.preventDefault(); _psDenied(); } : undefined}><span className="ps-hub-icon"><Icon size={32} strokeWidth={1.8}/></span><span className="ps-hub-link-text"><strong>{label === 'Backup' ? psAdminText('Ehtiyat nüsxə','Yedekleme','Backup') : label}</strong><small>{describe(to)}</small></span><span className="ps-hub-arrow"><PsChevronRight size={22}/></span></Link>)}</div>
        </section>)}</div>
        {!shownGroups.length && <div className="ps-empty-state"><PsSearch size={32}/><h2>{psAdminText('Bölmə tapılmadı','Bölüm bulunamadı','No sections found')}</h2><p>{psAdminText('Başqa sözlə axtarmağa çalışın.','Başka bir kelime deneyin.','Try a different search term.')}</p><button onClick={()=>setQuery('')}>{psAdminText('Axtarışı təmizlə','Aramayı temizle','Clear search')}</button></div>}
      </main>
    </div>
  </div>;
}
function PsAdminDialog({children, onClose, busy = false, title}) {
  const ref = reactExports.useRef(null);
  reactExports.useEffect(()=>{
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return ()=>{ dialog.close(); if (previous?.isConnected) previous.focus(); };
  },[]);
  return <dialog ref={ref} className="ps-admin-dialog" aria-label={title} onCancel={e=>{e.preventDefault(); if(!busy) onClose();}}><div className="ps-dialog-top"><span>{title}</span><button type="button" disabled={busy} onClick={onClose} aria-label={psAdminText('Bağla','Kapat','Close')}><X size={18}/></button></div><div className="ps-dialog-body">{children}</div></dialog>;
}
function psOpsSubtitle(id) {
  const copy = {
    stock: ['Stok qalığını izləyin, məhsul əlavə edin və hərəkətləri idarə edin.','Stokları takip edin, ürün ekleyin ve hareketleri yönetin.','Track stock, add products and manage adjustments.'],
    suppliers: ['Alış sifarişlərini hazırlayın və gələn malları qəbul edin.','Satın alma siparişlerini hazırlayın ve ürünleri teslim alın.','Prepare purchase orders and receive incoming goods.'],
    vendors: ['Təchizatçıları və hesablaşmaları bir yerdə izləyin.','Tedarikçileri ve hesaplarını tek yerden takip edin.','Keep supplier details and accounts together.'],
    guests: ['Müştəri məlumatları, borclar və loyallıq balansları.','Müşteri bilgileri, borçlar ve sadakat bakiyeleri.','Customer details, credit and loyalty balances.'],
    reservations: ['Qonaqların gəlişini planlayın və rezervləri izləyin.','Misafir gelişlerini planlayın ve rezervasyonları takip edin.','Plan guest arrivals and manage bookings.'],
    delivery: ['Sifarişlərin çatdırılmasını və kuryerləri izləyin.','Teslimatları ve kuryeleri takip edin.','Follow deliveries and manage couriers.'],
    roster: ['Heyətin növbələri və işə davamiyyəti.','Ekip vardiyaları ve devam takibi.','Team shifts and attendance.'],
    export: ['Hesabat məlumatlarını fayl olaraq çıxarın.','Rapor verilerini dosyaya aktarın.','Export report data to a file.']
  };
  return psAdminText(...(copy[id] || copy.stock));
}
function psStockInputValid(value, {negative = false, empty = false} = {}) {
  const text = String(value).trim().replace(',', '.');
  if (!text) return empty;
  return /^-?\d+(\.\d{1,3})?$/.test(text) && Number.isFinite(Number(text)) && (negative || Number(text) >= 0);
}
function psOpsTimestamp(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) return Number(value);
  // SQLite CURRENT_TIMESTAMP is UTC, without the ISO T/Z delimiters.
  const text = String(value).trim();
  return Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? text.replace(' ', 'T') + 'Z' : text);
}
function psRoleLabel(role) {
  const labels = {
    waiter: ['Ofisiant','Garson','Waiter'], kitchen: ['Mətbəx','Mutfak','Kitchen'], cashier: ['Kassir','Kasiyer','Cashier'],
    storekeeper: ['Anbardar','Depo sorumlusu','Storekeeper'], supervisor: ['Nəzarətçi','Süpervizör','Supervisor'],
    manager: ['Menecer','Müdür','Manager'], administrator: ['Administrator','Yönetici','Administrator']
  };
  return labels[role] ? psAdminText(...labels[role]) : role;
}
function PsOpsComposer({title, children}) {
  const [open, setOpen] = reactExports.useState(false);
  return <section className="ps-ops-composer"><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}><span>{title}</span><span aria-hidden="true">{open ? '−' : '+'}</span></button>{open && <div className="ps-composer-body">{children}</div>}</section>;
}
function PsOpsLoadState({error, retry}) {
  return <div className="ps-empty-state" role={error ? 'alert' : 'status'}><p>{error || psAdminText('Məlumatlar yüklənir…','Veriler yükleniyor…','Loading data…')}</p>{error && <button onClick={retry}>{psAdminText('Yenidən yoxla','Tekrar dene','Try again')}</button>}</div>;
}
