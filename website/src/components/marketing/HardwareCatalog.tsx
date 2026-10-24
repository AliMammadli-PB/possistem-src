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

export function HardwareCatalog() {
  const { t } = useI18n();
  const adminSession=useAdminSession(),customerSession=useCustomerSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedParent = searchParams.get('bolme');
  const parentSlug = requestedParent && requestedParent.length > 0 ? requestedParent : DEFAULT_CATALOG_PARENT;
  const categorySlug = searchParams.get('kateqoriya') || 'all';
  const query = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('sehife') || '1') || 1);

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
  }, [adminSession.authenticated,adminSession.email,customerSession.authenticated,customerSession.email]);

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
      <div className="catalog-toolbar">
        <label className="catalog-search">
          <span className="sr-only">{t('hardware.search.label')}</span>
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t('hardware.search.placeholder')}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="hardware-filters" role="tablist" aria-label={t('hardware.filtersLabel')}>
        <Link
          href={catalogHref({ parent: 'all', q: query })}
          role="tab"
          aria-selected={parentSlug === 'all'}
          className={parentSlug === 'all' ? 'is-active' : undefined}
        >
          {t('hardware.cat.all')}
        </Link>
        {tree.map((dept) => (
          <Link
            key={dept.slug}
            href={catalogHref({ parent: dept.slug, q: query })}
            role="tab"
            aria-selected={parentSlug === dept.slug}
            className={parentSlug === dept.slug ? 'is-active' : undefined}
          >
            {dept.name}
          </Link>
        ))}
      </div>

      {activeDept && activeDept.categories.length > 1 ? (
        <div className="hardware-filters" role="tablist" aria-label={t('hardware.nav.categories')}>
          <Link
            href={catalogHref({ parent: activeDept.slug, q: query })}
            role="tab"
            aria-selected={categorySlug === 'all'}
            className={categorySlug === 'all' ? 'is-active' : undefined}
          >
            {t('hardware.cat.all')}
          </Link>
          {activeDept.categories.map((cat) => (
            <Link
              key={cat.slug}
              href={catalogHref({ parent: activeDept.slug, category: cat.slug, q: query })}
              role="tab"
              aria-selected={categorySlug === cat.slug}
              className={categorySlug === cat.slug ? 'is-active' : undefined}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      ) : null}

      {loading ? <p className="hardware-status">{t('hardware.loading')}</p> : null}
      {error ? (
        <p className="hardware-status hardware-status--error" role="alert">
          {t('hardware.loadError')}
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
          <p className="hardware-status">{t('hardware.empty')}</p>
        )
      ) : null}
    </div>
  );
}
