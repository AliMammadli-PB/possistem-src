'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {useAdminSession} from '@/components/providers/AdminSessionProvider';
import {useCustomerSession} from '@/components/providers/CustomerSessionProvider';
import { useI18n } from '@/components/providers/I18nProvider';
import { fetchPublicCatalog, type CatalogProduct } from '@/lib/catalog-products';
import {
  CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_PARENT,
  buildCatalogTree,
  catalogHref,
  filterCatalogProducts,
} from '@/lib/catalog-tree';
import { HardwareCard } from './HardwareCard';
import './catalog.css';

export function HardwareCatalog() {
  const { t,language } = useI18n();
  const copy=language==='ru'?{title:'Магазин оборудования',intro:'Подберите оборудование для ежедневной работы.',departments:'Разделы',categories:'Категории',results:'товаров',clear:'Очистить поиск',reset:'Сбросить фильтры',orders:'Мои заказы',search:'Найти',retry:'Повторить'}:language==='en'?{title:'Equipment store',intro:'Find the equipment for your everyday work.',departments:'Departments',categories:'Categories',results:'products',clear:'Clear search',reset:'Reset filters',orders:'My orders',search:'Search',retry:'Try again'}:{title:'Məhsullar',intro:'İşinizə uyğun avadanlıqları bir yerdə tapın.',departments:'Şöbələr',categories:'Kateqoriyalar',results:'məhsul',clear:'Axtarışı təmizlə',reset:'Filtrləri sıfırla',orders:'Sifarişlərim',search:'Axtar',retry:'Yenidən yoxla'};
  const adminSession=useAdminSession(),customerSession=useCustomerSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedParent = searchParams.get('bolme');
  const parentSlug = requestedParent && requestedParent.length > 0 ? requestedParent : DEFAULT_CATALOG_PARENT;
  const categorySlug = searchParams.get('kateqoriya') || 'all';
  const query = searchParams.get('q') || '';
  const page = Math.max(1, Math.trunc(Number(searchParams.get('sehife') || '1') || 1));

  const [revision,setRevision]=useState(0);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(query);

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setProducts([]);
      setError(null);
      try {
        const data = await fetchPublicCatalog();
        if (!cancelled) setProducts(data.products);
      } catch {
        if (!cancelled) setError('load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminSession.authenticated,adminSession.email,customerSession.authenticated,customerSession.email,revision]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchDraft.trim() === query.trim()) return;
      router.replace(catalogHref({ parent: parentSlug, category: categorySlug, q: searchDraft, page: 1 }), {
        scroll: false,
      });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [searchDraft, query, parentSlug, categorySlug, router]);

  const tree = useMemo(() => buildCatalogTree(products), [products]);
  const activeDept = tree.find((item) => item.slug === parentSlug) ?? null;
  const filtered = useMemo(
    () => filterCatalogProducts(products, { parent: parentSlug, category: categorySlug, q: query }),
    [products, parentSlug, categorySlug, query],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * CATALOG_PAGE_SIZE, safePage * CATALOG_PAGE_SIZE);

  return (
    <div className="catalog-shell">
      <header className="catalog-heading"><div><p>POSSİSTEM / {language==='az'?'MAĞAZA':language==='ru'?'МАГАЗИН':'SHOP'}</p><h1>{copy.title}</h1><span>{copy.intro}</span></div><a href="/pos/app/sifarisler" className="catalog-orders">{copy.orders}<span aria-hidden="true">↗</span></a></header>
      <form className="catalog-searchbar" role="search" onSubmit={event=>{event.preventDefault();router.replace(catalogHref({parent:parentSlug,category:categorySlug,q:searchDraft,page:1}),{scroll:false});}}>
        <label className="catalog-search-field"><svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><span className="sr-only">{t('hardware.search.label')}</span><input type="search" value={searchDraft} onChange={event=>setSearchDraft(event.target.value)} placeholder={t('hardware.search.placeholder')} autoComplete="off"/>{searchDraft&&<button type="button" className="catalog-clear" onClick={()=>setSearchDraft('')} aria-label={copy.clear}>×</button>}</label><button className="catalog-search-submit" type="submit">{copy.search}</button>
      </form>
      <div className="catalog-layout">
      <aside className="catalog-sidebar" aria-label={copy.departments}>
        <h2>{copy.departments}</h2><nav aria-label={copy.departments}><Link href={catalogHref({parent:'all',q:query})} aria-current={parentSlug==='all'?'page':undefined}>{t('hardware.cat.all')}<span>{products.length}</span></Link>{tree.map(dept=><Link key={dept.slug} href={catalogHref({parent:dept.slug,q:query})} aria-current={parentSlug===dept.slug?'page':undefined}>{dept.name}<span>{dept.count}</span></Link>)}</nav>
        {activeDept&&activeDept.categories.length>1&&<><h2>{copy.categories}</h2><nav className="catalog-category-list" aria-label={copy.categories}><Link href={catalogHref({parent:activeDept.slug,q:query})} aria-current={categorySlug==='all'?'page':undefined}>{t('hardware.cat.all')}<span>{activeDept.count}</span></Link>{activeDept.categories.map(cat=><Link key={cat.slug} href={catalogHref({parent:activeDept.slug,category:cat.slug,q:query})} aria-current={categorySlug===cat.slug?'page':undefined}>{cat.name}<span>{cat.count}</span></Link>)}</nav></>}
      </aside>
      <section className="catalog-results" aria-label={copy.title}>
      <div className="catalog-mobile-filters"><label>{copy.departments}<select value={parentSlug} onChange={event=>router.push(catalogHref({parent:event.target.value,q:query}),{scroll:false})}><option value="all">{t('hardware.cat.all')}</option>{tree.map(dept=><option key={dept.slug} value={dept.slug}>{dept.name}</option>)}</select></label>{activeDept&&activeDept.categories.length>1&&<label>{copy.categories}<select value={categorySlug} onChange={event=>router.push(catalogHref({parent:parentSlug,category:event.target.value,q:query}),{scroll:false})}><option value="all">{t('hardware.cat.all')}</option>{activeDept.categories.map(cat=><option key={cat.slug} value={cat.slug}>{cat.name}</option>)}</select></label>}</div>
      <div className="catalog-resultbar"><h2>{activeDept?.name??t('hardware.cat.all')}</h2><span role="status" aria-live="polite">{loading?'…':filtered.length+' '+copy.results}</span>{(categorySlug!=='all'||query)&&<Link href={catalogHref({parent:parentSlug})}>{copy.reset}</Link>}</div>
      {loading ? <div role="status" className="catalog-loading"><span>{t('hardware.loading')}</span><div aria-hidden="true" className="catalog-loading-grid">{Array.from({length:6},(_,i)=><i key={i}/>)}</div></div> : null}
      {error ? (
        <p className="hardware-status hardware-status--error" role="alert">
          {t('hardware.loadError')} <button type="button" onClick={()=>setRevision(v=>v+1)}>{copy.retry}</button>
        </p>
      ) : null}

      {!loading && !error ? (
        paged.length ? (
          <>
            <div className="hardware-grid">
              {paged.map((product) => (
                <HardwareCard key={product.id} product={product} />
              ))}
            </div>
            {pageCount > 1 ? (
              <nav className="catalog-pager" aria-label={t('hardware.page.label')}>
                <Link
                  className="catalog-pager-btn"
                  href={catalogHref({
                    parent: parentSlug,
                    category: categorySlug,
                    q: query,
                    page: Math.max(1, safePage - 1),
                  })}
                  aria-disabled={safePage <= 1}
                  tabIndex={safePage <= 1 ? -1 : undefined}
                >
                  {t('hardware.page.prev')}
                </Link>
                <span>
                  {safePage} / {pageCount}
                </span>
                <Link
                  className="catalog-pager-btn"
                  href={catalogHref({
                    parent: parentSlug,
                    category: categorySlug,
                    q: query,
                    page: Math.min(pageCount, safePage + 1),
                  })}
                  aria-disabled={safePage >= pageCount}
                  tabIndex={safePage >= pageCount ? -1 : undefined}
                >
                  {t('hardware.page.next')}
                </Link>
              </nav>
            ) : null}
          </>
        ) : (
          <div className="catalog-empty"><h3>{t('hardware.empty')}</h3><p>{language==='az'?'Başqa ad və ya SKU ilə axtarın, yaxud filtrləri sıfırlayın.':language==='ru'?'Попробуйте другое название или сбросьте фильтры.':'Try another name or reset the filters.'}</p><Link href={catalogHref({parent:'all'})}>{copy.reset}</Link></div>
        )
      ) : null}
      </section></div>
    </div>
  );
}
