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
  if(to.split('?')[0]==='/settings'&&section)return ['settings',({printer:'printer',receipt:'documents','qr-orders':'qr',screen:'devices'})[section]||'settings'];
  const tab=params.get('tab');
  const modules={stock:['menu','stock'],goods:['menu','goods'],categories:['menu','categories'],stocktake:['menu','stocktake'],costing:['menu','costing'],menuCatalog:['menu','menu'],sales:['trade','trade'],purchases:['trade','trade'],vendors:['people','partners'],objects:['settings','branches'],kassa:['finance','cash'],staff:['people','staff'],expenses:['finance','expenses'],documents:['finance','documents'],income:['finance','income'],delivery:['people','delivery'],export:['finance','export']};
  const pages={'/admin/catalog':['menu','menu'],'/branches':['settings','branches'],'/admin/staff':['people','staff'],'/admin/tables':['people','tables'],'/admin/gifts':['people','gifts'],'/refund':['trade','returns'],'/dashboard':['finance','reports'],'/admin/reports':['finance','reports'],'/admin/cash':['finance','cash'],'/reconcile':['finance','reconcile'],'/audit':['finance','audit'],'/settings':['settings','settings'],'/admin/backup':['settings','backup'],'/settings/license':['settings','license'],'/diagnostics':['settings','devices']};
  return modules[tab]||pages[to.split('?')[0]]||['settings','settings'];
}
function PsModuleImage({name,className=''}) {
  return <img className={'pm-image '+className} src={'./assets/modules/'+name+'.png'} width="64" height="64" alt="" aria-hidden="true" draggable={false}/>;
}
function PsDeliveryNavIcon(){return <img className="pm-delivery-icon" src="./assets/modules/delivery-sidebar-white.png" width="28" height="28" alt="" aria-hidden="true" draggable={false}/>;}
function psManagementAccessPath(to){
  const tab=new URLSearchParams(to.split('?')[1]||'').get('tab');
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
  const normal=value=>String(value).toLocaleLowerCase('az').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
  const needle=normal(query.trim());
  const settingsLinks=[
    ['printer',psAdminText('Printerlər','Yazıcılar','Printers'),psAdminText('Printeri qoşun və çap işini seçin','Yazıcı bağlayın ve görevini seçin','Connect a printer and choose its purpose')],
    ['receipt',psAdminText('Çek','Fiş','Receipt'),psAdminText('Çek loqosu, kağız və QR','Fiş logosu, kağıt ve QR','Receipt logo, paper and QR')],
    ['screen',psAdminText('Ekran və dil','Ekran ve dil','Display & language'),psAdminText('Görünüşü və dili dəyişin','Görünümü ve dili değiştirin','Change the display and language')],
    ...(!psMarketMode()?[['qr-orders',psAdminText('QR sifarişlər','QR siparişler','QR orders'),psAdminText('Menyu və masa kodları','Menü ve masa kodları','Menu and table codes')]]:[])
  ].map(([section,label,hint])=>({...links.find(link=>link.to==='/settings'),to:'/settings?section='+section,label,hint}));
  const searchable=[...links,...(links.some(link=>link.to==='/settings')?settingsLinks:[])].map(link=>({...link,...(link.to==='/admin/catalog'?{label:psAdminText('Menyu','Menü','Menu')}:{}),...(link.to==='/operations?tab=sales'||link.to==='/operations?tab=purchases'?{label:psAdminText('Ticarət','Ticaret','Trade'),hint:psAdminText('Alışlar və satışlar','Alışlar ve satışlar','Purchases and sales')}:{} )}));
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
  const hints={menu:['Menyunu və qiymətləri düzəldin','Menüyü ve fiyatları düzenleyin','Edit your menu and prices'],stock:['Qalıqları və mal hərəkətini izləyin','Stok ve hareketleri izleyin','Track stock and movements'],goods:['Mallar və xammal kartları','Ürün ve hammadde kartları','Products and ingredients'],categories:['Ana və alt kateqoriyalar','Ana ve alt kategoriler','Categories and subcategories'],stocktake:['Faktiki qalığı yoxlayın','Gerçek stok miktarını kontrol edin','Check physical stock'],costing:['Tərkib, porsiya və maya dəyəri','İçerik, porsiyon ve maliyet','Ingredients, portions and cost'],trade:['Alışlar və satışlar','Alışlar ve satışlar','Purchases and sales'],staff:['İşçilər, icazələr və maaşlar','Çalışanlar, izinler ve maaşlar','Staff, permissions and salaries'],tables:['Zallar və masaların düzülüşü','Salonlar ve masa düzeni','Rooms and table layout'],delivery:['Sifarişlər və kuryerlər','Siparişler ve kuryeler','Orders and couriers'],partners:['Təchizatçılar və müştərilər','Tedarikçiler ve müşteriler','Suppliers and customers'],cash:['Kassalar və pul hərəkəti','Kasalar ve para hareketi','Cash accounts and movements'],documents:['Ödənişlərin vahid siyahısı','Ödemelerin ortak listesi','All payment documents'],reports:['Gəlir və satış göstəriciləri','Gelir ve satış verileri','Revenue and sales figures'],settings:['Restoran, printer, çek və sistem','Restoran, yazıcı, fiş ve sistem','Restaurant, printer, receipt and system'],branches:['Obyektlər və bağlı kassalar','İşletmeler ve bağlı kasalar','Locations and connected tills'],backup:['Yedəkləyin və bərpa edin','Yedekleyin ve geri yükleyin','Back up and restore'],license:['İstifadə hüquqları','Kullanım hakları','Usage permissions'],devices:['Bağlantı və cihaz yoxlaması','Bağlantı ve cihaz kontrolü','Connections and device checks'],gifts:['Kampaniya və hədiyyələr','Kampanyalar ve hediyeler','Campaigns and gifts'],returns:['Satışı tapın və qaytarın','Satışı bulun ve iade edin','Find and return a sale'],reconcile:['Ödənişləri tutuşdurun','Ödemeleri karşılaştırın','Reconcile payments'],audit:['Əməliyyat tarixçəsi','İşlem geçmişi','Activity history'],expenses:['Xərcləri qeyd edin','Giderleri kaydedin','Record expenses'],income:['Digər gəlirləri qeyd edin','Diğer gelirleri kaydedin','Record other income'],export:['Məlumatları fayla çıxarın','Verileri dosyaya aktarın','Export your records']};
  return hints[image]?psAdminText(...hints[image]):'';
}
function AdminHubPage(){return <PsManagementHub links={usePsManagementLinks()}/>;}
function SettingsPage(){return <PsManagementLayout links={usePsManagementLinks()} active="settings"><PsManagementSettingsContent/></PsManagementLayout>;}
function PsSettingsPicker({sections,value,onChange}) {
  const images={'qr-orders':'qr',sunmi:'devices',restaurant:'branches',screen:'devices',printer:'printer',receipt:'documents',system:'devices',backup:'backup',danger:'license'};
  return <div className="pm-settings-picker"><PsModuleImage name={images[value]||'settings'}/><div><h1>{psAdminText('Parametrlər','Ayarlar','Settings')}</h1><p>{psAdminText('Dəyişmək istədiyiniz bölməni seçin','Düzenlemek istediğiniz bölümü seçin','Choose the settings to edit')}</p></div><label><span>{psAdminText('Parametr bölməsi','Ayar bölümü','Settings section')}</span><select aria-label={psAdminText('Parametr bölməsi','Ayar bölümü','Settings section')} value={value} onChange={event=>onChange(event.target.value)}>{sections.map(section=><option key={section.id} value={section.id}>{section.label}</option>)}</select></label></div>;
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
