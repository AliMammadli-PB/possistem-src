/* Management navigation. Business screens and their permission checks stay in their owners. */
function psManagementGroups() {
  return [
    {id:'menu',label:psAdminText('Menyu və anbar','Menü ve stok','Menu & stock'),image:'menu',hint:psAdminText('Məhsul, resept və qalıqlar','Ürün, reçete ve stok','Products, recipes and stock')},
    {id:'trade',label:psAdminText('Ticarət','Ticaret','Trade'),image:'trade',hint:psAdminText('Alışlar və satışlar','Alışlar ve satışlar','Purchases and sales')},
    {id:'finance',label:psAdminText('Maliyyə','Finans','Finance'),image:'cash',hint:psAdminText('Kassa, qaimə və hesabat','Kasa, belge ve rapor','Cash, documents and reports')},
    {id:'people',label:psAdminText('Heyət və xidmət','Ekip ve hizmet','People & service'),image:'staff',hint:psAdminText('İşçilər, masalar və çatdırılma','Çalışanlar, masalar ve teslimat','Staff, tables and delivery')},
    {id:'settings',label:psAdminText('Parametrlər','Ayarlar','Settings'),image:'settings',hint:psAdminText('Restoran, printer və cihazlar','Restoran, yazıcı ve cihazlar','Restaurant, printers and devices')}
  ];
}
function psManagementModule(to) {
  const params=new URLSearchParams(to.split('?')[1]||'');
  const section=params.get('section');
  if(to.split('?')[0]==='/settings'&&section)return ['settings',({printer:'printer',receipt:'documents','qr-orders':'qr',screen:'devices',system:'devices',updates:'updates'})[section]||'settings'];
  const tab=params.get('tab');
  const modules={stock:['menu','stock'],goods:['menu','goods'],categories:['menu','categories'],stocktake:['menu','stocktake'],costing:['menu','costing'],menuCatalog:['menu','menu'],sales:['trade','trade'],purchases:['trade','trade'],vendors:['people','partners'],objects:['settings','branches'],kassa:['finance','cash'],staff:['people','staff'],expenses:['finance','expenses'],documents:['finance','documents'],income:['finance','income'],delivery:['people','delivery'],export:['finance','export']};
  const pages={'/admin/catalog':['menu','menu'],'/branches':['settings','branches'],'/admin/staff':['people','staff'],'/admin/tables':['people','tables'],'/admin/gifts':['people','gifts'],'/refund':['trade','returns'],'/dashboard':['finance','reports'],'/admin/reports':['finance','reports'],'/admin/cash':['finance','cash'],'/reconcile':['finance','reconcile'],'/audit':['finance','audit'],'/settings':['settings','settings'],'/admin/backup':['settings','backup'],'/settings/license':['settings','license'],'/diagnostics':['settings','devices']};
  return modules[tab]||pages[to.split('?')[0]]||['settings','settings'];
}
function PsModuleImage({name,className=''}) {
  return <img className={'pm-image '+className} src={'./assets/modules/'+name+'.png'} width="64" height="64" alt="" aria-hidden="true" draggable={false}/>;
}
function PsDeliveryNavIcon(){return <span className="pm-delivery-icon" aria-hidden="true"><img className="pm-delivery-default" src="./assets/modules/delivery-outline-v2.png" width="28" height="28" alt="" draggable={false}/><img className="pm-delivery-selected" src="./assets/modules/delivery-outline-v2.png" width="28" height="28" alt="" draggable={false}/></span>;}
function psManagementAccessPath(to){
  const tab=new URLSearchParams(to.split('?')[1]||'').get('tab');
  if(tab==='kassa')return '/admin/cash';
  return ['goods','categories','stocktake','costing'].includes(tab)?'/operations?tab=stock':to;
}
function PsManagementRail({active,links}) {
  links=links.filter(link=>link.show!==false&&!link.locked);
  return <nav className="pm-rail" aria-label={psAdminText('İdarəetmə bölmələri','Yönetim bölümleri','Management sections')}>
    {psManagementGroups().filter(group=>links.some(link=>psManagementModule(link.to)[0]===group.id)).map(group=><Link key={group.id} to={'/admin?group='+group.id} className={'pm-rail-link'+(active===group.id?' is-active':'')} aria-current={active===group.id?'page':undefined}>
      <PsModuleImage name={group.image}/><span>{group.label}</span>
    </Link>)}
  </nav>;
}
function PsManagementLayout({links,active,children}) {
  return <div className="pm-layout"><PsManagementRail active={active} links={links}/><main className="pm-main">{children}</main></div>;
}
function PsManagementHub({links}) {
  links=links.filter(link=>link.show!==false&&!link.locked&&link.to!=='/operations?tab=delivery');
  const location=useLocation();
  const [query,setQuery]=reactExports.useState('');
  const groups=psManagementGroups().filter(group=>links.some(link=>psManagementModule(link.to)[0]===group.id));
  const requested=new URLSearchParams(location.search).get('group');
  reactExports.useEffect(()=>{setQuery('');},[location.search]);
  const active=groups.some(g=>g.id===requested)?requested:groups[0]?.id;
  const group=groups.find(g=>g.id===active);
  const normal=value=>String(value).toLocaleLowerCase('az').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/ə/g,'e');
  const needle=normal(query.trim());
  const settingsLinks=[
    ['printer',psAdminText('Printerlər','Yazıcılar','Printers'),psAdminText('Printeri qoşun və çap işini seçin','Yazıcı bağlayın ve görevini seçin','Connect a printer and choose its purpose')],
    ['receipt',psAdminText('Çek','Fiş','Receipt'),psAdminText('Çek loqosu, kağız və QR','Fiş logosu, kağıt ve QR','Receipt logo, paper and QR')],
    ['system',psAdminText('Sistem','Sistem','System'),psAdminText('Loglar və POS xidməti','Günlükler ve POS hizmeti','Logs and POS service')],
    ['updates',psAdminText('Yeniləmə','Güncelleme','Updates'),psAdminText('Yeni versiyanı yoxlayın və quraşdırın','Yeni sürümü kontrol edin ve kurun','Check for a new version and install')],
    ['screen',psAdminText('Ekran və dil','Ekran ve dil','Display & language'),psAdminText('Görünüşü və dili dəyişin','Görünümü ve dili değiştirin','Change the display and language')],
    ...(!psMarketMode()?[['qr-orders',psAdminText('QR sifarişlər','QR siparişler','QR orders'),psAdminText('Menyu və masa kodları','Menü ve masa kodları','Menu and table codes')]]:[])
  ].filter(([section])=>section!=='updates'||!psMarketMode()).map(([section,label,hint])=>({...links.find(link=>link.to==='/settings'),to:'/settings?section='+section,label,hint}));
  const searchable=[...links,...(links.some(link=>link.to==='/settings')?settingsLinks:[])].map(link=>({...link,...(link.to==='/admin/catalog'?{label:psAdminText('Menyu','Menü','Menu')}:{}),...(link.to==='/settings'?{label:psAdminText('Restoran','Restoran','Restaurant'),hint:psAdminText('Hesab və restoran məlumatları','Hesap ve restoran bilgileri','Account and restaurant details')}:{}),...(link.to==='/operations?tab=sales'||link.to==='/operations?tab=purchases'?{label:psAdminText('Ticarət','Ticaret','Trade'),hint:psAdminText('Alışlar və satışlar','Alışlar ve satışlar','Purchases and sales')}:{} )}));
  const trade=searchable.filter(link=>link.to==='/operations?tab=sales'||link.to==='/operations?tab=purchases');
  const tradeLink=trade.find(link=>!link.locked)||trade[0];
  const entries=searchable.filter(link=>!trade.includes(link)||link===tradeLink);
  const shown=entries.filter(link=>needle?normal(link.label+' '+(link.hint||psManagementHint(psManagementModule(link.to)[1]))+' '+psManagementGroups().find(g=>g.id===psManagementModule(link.to)[0])?.label).includes(needle):psManagementModule(link.to)[0]===active);
  if(!group)return <div className="pm-empty-access"><h1>{psAdminText('İdarəetmə','Yönetim','Management')}</h1><p>{psAdminText('Bu hesab üçün bölmə təyin edilməyib.','Bu hesaba bölüm atanmamış.','No sections have been assigned to this account.')}</p></div>;
  return <PsManagementLayout links={links} active={active}>
    <header className="pm-heading"><div><h1>{psAdminText('İdarəetmə','Yönetim','Management')}</h1><p>{psAdminText('Gündəlik işlər və proqramın ayarları','Günlük işler ve uygulama ayarları','Daily work and application settings')}</p></div>
      <label className="pm-search"><span>{psAdminText('Bölmə axtar','Bölüm ara','Find a section')}</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={psAdminText('Məsələn: kalkulyasiya, printer…','Örneğin: reçete, yazıcı…','Try: recipes, printers…')}/></label>
    </header>
    <section className="pm-destinations" aria-label={needle?psAdminText('Axtarış nəticələri','Arama sonuçları','Search results'):group.label}>
      <header className="pm-section-heading"><h2>{needle?psAdminText('Axtarış nəticələri','Arama sonuçları','Search results'):group.label}</h2>{!needle&&<p>{group.hint}</p>}</header>
      <div className="pm-module-grid">{shown.map(link=>{
        const [,image]=psManagementModule(link.to);
        return <Link key={link.to} className={'pm-module'+(link.locked?' is-locked':'')} to={link.to} aria-disabled={link.locked||undefined} onClick={event=>{if(link.locked){event.preventDefault();_psDenied();}}}>
          <PsModuleImage name={image}/><span className="pm-module-copy"><strong>{link.label}</strong><small>{link.locked?psAdminText('Giriş icazəsi tələb olunur','Erişim izni gerekiyor','Access permission required'):link.hint||psManagementHint(image)}</small></span><span className="pm-module-arrow" aria-hidden="true">{link.locked?'−':'›'}</span>
        </Link>;
      })}</div>
      {!shown.length&&<p className="pm-no-results" role="status">{psAdminText('Uyğun bölmə tapılmadı. Başqa sözlə axtarın.','Uygun bölüm bulunamadı. Başka sözcük deneyin.','No matching section. Try another word.')}</p>}
    </section>
  </PsManagementLayout>;
}
function psManagementHint(image) {
  const hints={menu:['Menyunu və qiymətləri düzəldin','Menüyü ve fiyatları düzenleyin','Edit your menu and prices'],stock:['Qalıqları və mal hərəkətini izləyin','Stok ve hareketleri izleyin','Track stock and movements'],goods:['Mallar və xammal kartları','Ürün ve hammadde kartları','Products and ingredients'],categories:['Ana və alt kateqoriyalar','Ana ve alt kategoriler','Categories and subcategories'],stocktake:['Faktiki qalığı yoxlayın','Gerçek stok miktarını kontrol edin','Check physical stock'],costing:['Tərkib, porsiya və maya dəyəri','İçerik, porsiyon ve maliyet','Ingredients, portions and cost'],trade:['Alışlar və satışlar','Alışlar ve satışlar','Purchases and sales'],staff:['İşçilər, icazələr və maaşlar','Çalışanlar, izinler ve maaşlar','Staff, permissions and salaries'],tables:['Zallar və masaların düzülüşü','Salonlar ve masa düzeni','Rooms and table layout'],delivery:['Sifarişlər və kuryerlər','Siparişler ve kuryeler','Orders and couriers'],partners:['Təchizatçılar və müştərilər','Tedarikçiler ve müşteriler','Suppliers and customers'],cash:['Kassalar və pul hərəkəti','Kasalar ve para hareketi','Cash accounts and movements'],documents:['Ödənişlərin vahid siyahısı','Ödemelerin ortak listesi','All payment documents'],reports:['Gəlir və satış göstəriciləri','Gelir ve satış verileri','Revenue and sales figures'],updates:['Yeni versiyanı yoxlayın və quraşdırın','Yeni sürümü kontrol edin ve kurun','Check for a new version and install'],settings:['Restoran, printer, çek və sistem','Restoran, yazıcı, fiş ve sistem','Restaurant, printer, receipt and system'],branches:['Obyektlər və bağlı kassalar','İşletmeler ve bağlı kasalar','Locations and connected tills'],backup:['Yedəkləyin və bərpa edin','Yedekleyin ve geri yükleyin','Back up and restore'],license:['İstifadə hüquqları','Kullanım hakları','Usage permissions'],devices:['Bağlantı və cihaz yoxlaması','Bağlantı ve cihaz kontrolü','Connections and device checks'],gifts:['Kampaniya və hədiyyələr','Kampanyalar ve hediyeler','Campaigns and gifts'],returns:['Satışı tapın və qaytarın','Satışı bulun ve iade edin','Find and return a sale'],reconcile:['Ödənişləri tutuşdurun','Ödemeleri karşılaştırın','Reconcile payments'],audit:['Əməliyyat tarixçəsi','İşlem geçmişi','Activity history'],expenses:['Xərcləri qeyd edin','Giderleri kaydedin','Record expenses'],income:['Digər gəlirləri qeyd edin','Diğer gelirleri kaydedin','Record other income'],export:['Məlumatları fayla çıxarın','Verileri dosyaya aktarın','Export your records']};
  return hints[image]?psAdminText(...hints[image]):'';
}
function PsFloorHeading({count,isDelivery=false}) {
  const intro=reactExports.useRef(null),{lang}=useI18n();
  reactExports.useLayoutEffect(()=>{
    const header=intro.current?.closest('.pm-floor-header'),rail=header?.closest('.ps-shell')?.querySelector('.ps-touch-sidebar'),nav=rail?.querySelector(':scope > nav'),divider=nav?.previousElementSibling;
    if(!header||!rail||!nav||!divider)return;
    const property='--pm-floor-nav-gap',previous=nav.style.getPropertyValue(property);
    let active=true,frame=null;
    const request=window.requestAnimationFrame?.bind(window)||(fn=>setTimeout(fn,16)),cancel=window.cancelAnimationFrame?.bind(window)||clearTimeout;
    const align=()=>{frame=null;if(!active)return;const first=nav.querySelector('a,button');if(!first)return;const margin=parseFloat(window.getComputedStyle(nav).marginTop)||0,gap=Math.max(0,margin+header.getBoundingClientRect().bottom-first.getBoundingClientRect().top-nav.scrollTop).toFixed(2)+'px';if(nav.style.getPropertyValue(property)!==gap)nav.style.setProperty(property,gap);};
    const schedule=()=>{if(frame!==null)cancel(frame);frame=request(align);};
    align();
    const observer=typeof window.ResizeObserver==='function'?new window.ResizeObserver(schedule):null;
    observer?.observe(header);observer?.observe(divider);if(rail.firstElementChild)observer?.observe(rail.firstElementChild);
    window.addEventListener('resize',schedule);rail.addEventListener('transitionend',schedule);
    document.fonts?.ready.then(()=>{if(active)schedule();});
    return()=>{active=false;if(frame!==null)cancel(frame);observer?.disconnect();window.removeEventListener('resize',schedule);rail.removeEventListener('transitionend',schedule);if(previous)nav.style.setProperty(property,previous);else nav.style.removeProperty(property);};
  },[count,lang,isDelivery]);
  return <div className="pm-floor-intro" ref={intro}>
    <div className="pm-floor-title-line"><h1>{isDelivery?psAdminText('Çatdırılma','Teslimat','Delivery'):psAdminText('Masalar','Masalar','Tables')}</h1></div>
    {!isDelivery&&<ul className="pm-floor-legend" aria-label={psAdminText('Masa vəziyyətləri','Masa durumları','Table statuses')}>
      <li title={psAdminText('Boş masa','Boş masa','Available table')}><img src="./assets/modules/table-status-free-v1.png" width="22" height="22" alt="" aria-hidden="true"/>{psAdminText('Boş','Boş','Available')}</li>
      <li title={psAdminText('Aktiv hesab','Aktif hesap','Open bill')}><img src="./assets/modules/table-status-active-v1.png" width="22" height="22" alt="" aria-hidden="true"/>{psAdminText('Aktiv','Aktif','Open')}</li>
      <li title={psAdminText('Çek çap olunub','Fiş yazdırıldı','Bill printed')}><img src="./assets/modules/table-status-receipt-v1.png" width="22" height="22" alt="" aria-hidden="true"/>{psAdminText('Çek','Fiş','Printed')}</li>
    </ul>}
  </div>;
}
function AdminHubPage(){return <PsManagementHub links={usePsManagementLinks()}/>;}
function SettingsPage(){return <div className="pm-layout pm-layout-settings"><main className="pm-main"><PsManagementSettingsContent/></main></div>;}
function PsSettingsPicker({sections,value,onChange}) {
  const images={'qr-orders':'qr',sunmi:'devices',restaurant:'branches',screen:'devices',printer:'printer',receipt:'documents',system:'devices',updates:'updates',backup:'backup',danger:'license'};
  const current=sections.find(section=>section.id===value);
  return <><aside className="pm-settings-picker"><Link className="pm-settings-back" to="/admin?group=settings">‹ {psAdminText('İdarəetmə','Yönetim','Management')}</Link><p className="pm-settings-caption">{psAdminText('Parametrlər','Ayarlar','Settings')}</p><nav aria-label={psAdminText('Parametr bölməsi','Ayar bölümü','Settings section')}>{sections.map(section=><button key={section.id} type="button" aria-current={section.id===value?'page':undefined} onClick={()=>onChange(section.id)}><PsModuleImage name={images[section.id]||'settings'}/><span>{section.label}</span></button>)}</nav></aside><header className="pm-settings-heading"><h1>{current?.label||psAdminText('Parametrlər','Ayarlar','Settings')}</h1>{current?.hint&&<p>{current.hint}</p>}</header></>;
}
function PsUpdateSettingsPanel({version,status,checking,statusLabel,onCheck,onInstall,t}) {
  const locked=checking||['checking','downloading','downloaded','disabled'].includes(status.state);
  const percent=Math.max(0,Math.min(100,Number(status.percent)||0));
  return <section className="pm-update-panel" aria-label={psAdminText('Yeniləmə idarəsi','Güncelleme yönetimi','Update controls')}>
    <div className="pm-update-version"><p>{psAdminText('Quraşdırılmış versiya','Yüklü sürüm','Installed version')}</p><strong>{version?'v'+version:'—'}</strong></div>
    <p className={'pm-update-status is-'+status.state} role="status" aria-live="polite" data-update-state={status.state}>{checking?t.settings.updateChecking:statusLabel}</p>
    {status.state==='downloading'&&<div className="pm-update-progress" role="progressbar" aria-label={psAdminText('Yeniləmə endirilir','Güncelleme indiriliyor','Downloading update')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:percent+'%'}}/></div>}
    <div className="pm-update-actions">
      <button type="button" className={status.state==='downloaded'?'':'is-primary'} disabled={locked} onClick={onCheck}>{checking||status.state==='checking'?t.settings.updateChecking:t.settings.checkUpdates}</button>
      {status.state==='downloaded'&&<button type="button" className="is-primary" onClick={onInstall}>{t.settings.installUpdate}</button>}
    </div>
    {status.state==='downloaded'&&<p className="pm-update-note">{psAdminText('Quraşdırma zamanı proqram yenidən başlayacaq.','Kurulum sırasında uygulama yeniden başlayacak.','The application will restart during installation.')}</p>}
  </section>;
}
function PsOperationsWorkspace({tabs,current,onSelect,children}) {
  const groupId=psManagementModule('/operations?tab='+current.id)[0];
  const group=psManagementGroups().find(group=>group.id===groupId);
  const siblings=current.id==='delivery'?[]:tabs.filter(tab=>psManagementModule('/operations?tab='+tab.id)[0]===groupId&&tab.show&&_psArea(psManagementAccessPath('/operations?tab='+tab.id))&&tab.id!=='delivery');
  const label=groupId==='trade'?psAdminText('Ticarət','Ticaret','Trade'):current.label;
  const [menuOpen,setMenuOpen]=reactExports.useState(false);
  const dialog=reactExports.useRef(null),trigger=reactExports.useRef(null),dialogId=reactExports.useId();
  reactExports.useEffect(()=>{setMenuOpen(false);},[current.id]);
  reactExports.useEffect(()=>{
    if(!menuOpen)return;
    const element=dialog.current,previous=document.activeElement;
    element.showModal();element.querySelector('[aria-current="page"],button')?.focus();
    return()=>{element.close();if(previous?.isConnected)previous.focus();else trigger.current?.focus();};
  },[menuOpen]);
  const choices=()=>siblings.map(tab=><button key={tab.id} type="button" aria-current={current.id===tab.id?'page':undefined} onClick={()=>{onSelect(tab.id);setMenuOpen(false);}}><PsModuleImage name={psManagementModule('/operations?tab='+tab.id)[1]}/><span>{tab.label}</span></button>);
  return <div className="ps-operations-page pm-operations" data-module={current.id}>
    <div className={'pm-operation-shell'+(siblings.length?'':' pm-operation-shell--single')}>
      {siblings.length>0&&<div className="pm-operation-rail"><Link className="pm-rail-home" to={'/admin?group='+groupId}>{psAdminText('‹ İdarəetmə','‹ Yönetim','‹ Management')}</Link><nav aria-label={group.label}>{choices()}</nav></div>}
      <div className="pm-operation-main">
        <header className="pm-operation-heading"><div><h1>{label}</h1><span className="pm-operation-group">{group.label}</span></div>
          {siblings.length>0?<button ref={trigger} type="button" className="pm-sections-toggle" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={dialogId} onClick={()=>setMenuOpen(true)}>{psAdminText('Bölmələr','Bölümler','Sections')}</button>:<Link className="pm-back" to={'/admin?group='+groupId}>{psAdminText('İdarəetmə','Yönetim','Management')}</Link>}
        </header>
        <div className="ps-ops-panel pm-operation-panel">{children}</div>
      </div>
    </div>
    {menuOpen&&<dialog id={dialogId} ref={dialog} className="pm-section-drawer" aria-label={psAdminText('Bölmələr','Bölümler','Sections')} onCancel={event=>{event.preventDefault();setMenuOpen(false);}} onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)setMenuOpen(false);}}}>
      <header><h2>{psAdminText('Bölmələr','Bölümler','Sections')}</h2><button type="button" onClick={()=>setMenuOpen(false)}>{psAdminText('Bağla','Kapat','Close')}</button></header><nav aria-label={group.label}>{choices()}</nav><Link to={'/admin?group='+groupId} onClick={()=>setMenuOpen(false)}>{psAdminText('İdarəetməyə qayıt','Yönetime dön','Back to management')}</Link>
    </dialog>}
  </div>;
}

// Size each page from the actual product area, including cart visibility and rail expansion.
// Keep pagination bounded even with a very large catalogue; no stock/payment behavior changes.
function usePsSaleGrid(itemCount,loading,setPage) {
  const ref=reactExports.useRef(null);
  const previous=reactExports.useRef({columns:1,rows:1,cardHeight:100,capacity:1});
  const [layout,setLayout]=reactExports.useState(previous.current);
  reactExports.useLayoutEffect(()=>{
    const section=ref.current;if(!section)return;
    let active=true,frame=null;
    const request=window.requestAnimationFrame?.bind(window)||(fn=>setTimeout(fn,16));
    const cancel=window.cancelAnimationFrame?.bind(window)||clearTimeout;
    const measure=()=>{
      frame=null;if(!active)return;
      const grid=section.querySelector('.pm-sale-fit');if(!grid)return;
      const style=getComputedStyle(grid),font=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
      const horizontal=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
      const vertical=(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0);
      const gap=parseFloat(style.gap)||8,cardHeight=Math.max(100,Math.ceil(font*6.25));
      const columns=Math.max(1,Math.floor((grid.clientWidth-horizontal+gap)/(Math.max(140,font*8.75)+gap)));
      const rows=Math.max(1,Math.floor((grid.clientHeight-vertical+gap)/(cardHeight+gap)));
      const next={columns,rows,cardHeight,capacity:columns*rows},old=previous.current;
      if(Object.keys(next).some(key=>next[key]!==old[key])){
        previous.current=next;
        setPage(page=>Math.floor(page*old.capacity/next.capacity));
        setLayout(next);
      }
    };
    const schedule=()=>{if(frame!==null)cancel(frame);frame=request(measure);};
    measure();
    const observer=typeof window.ResizeObserver==='function'?new window.ResizeObserver(schedule):null;
    observer?.observe(section);
    const grid=section.querySelector('.pm-sale-fit');if(grid)observer?.observe(grid);
    window.addEventListener('resize',schedule);
    document.fonts?.ready.then(()=>{if(active)schedule();});
    return()=>{active=false;if(frame!==null)cancel(frame);observer?.disconnect();window.removeEventListener('resize',schedule);};
  },[itemCount,loading,setPage]);
  return {...layout,ref};
}

function PsPaymentLoadError({message,onRetry,onBack}) {
  return <section className="pm-payment-load-error" role="alert"><h1>{psAdminText('Ödəniş ekranı açılmadı','Ödeme ekranı açılamadı','Payment screen could not open')}</h1><p>{message}</p><div><button type="button" onClick={onRetry}>{psAdminText('Yenidən yoxla','Tekrar dene','Retry')}</button><button type="button" onClick={onBack}>{psAdminText('Geri','Geri','Back')}</button></div></section>;
}
