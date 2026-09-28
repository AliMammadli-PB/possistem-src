import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PackageSearch, TriangleAlert } from 'lucide-react';

import { ProductVisual } from './ProductVisual';
import { categoryLabel, tr } from './i18n';
import { packLabel, packPrice, packUnitsOf, qtyLabel, unitLabel } from './wholesale';
import type { Lang, Product } from './types';

/** Fixed page size - large tiles that are easy to tap. */
export const CATALOG_PAGE_SIZE = 12;
/** @deprecated use CATALOG_PAGE_SIZE */
export const SALE_PAGE_SIZE = CATALOG_PAGE_SIZE;

type MoneyFn = (minor: number, lang: Lang) => string;

function pageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));
  return [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
}

function useCatalogPage<T extends { id?: string; key?: string }>(products: T[], lang: Lang) {
  const [page, setPage] = useState(1);
  const filterSig = useMemo(
    () => `${products.length}:${products[0]?.id ?? products[0]?.key ?? ''}:${products[products.length - 1]?.id ?? products[products.length - 1]?.key ?? ''}`,
    [products],
  );
  const totalPages = Math.max(1, Math.ceil(products.length / CATALOG_PAGE_SIZE));

  useEffect(() => { setPage(1); }, [filterSig, lang]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * CATALOG_PAGE_SIZE;
    return products.slice(start, start + CATALOG_PAGE_SIZE);
  }, [products, page]);

  const go = useCallback((next: number) => {
    setPage(Math.min(totalPages, Math.max(1, next)));
  }, [totalPages]);

  return {
    page,
    totalPages,
    pageItems,
    filterSig,
    go,
    from: products.length ? (page - 1) * CATALOG_PAGE_SIZE + 1 : 0,
    to: Math.min(products.length, page * CATALOG_PAGE_SIZE),
    windowPages: pageWindow(page, totalPages),
  };
}

function CatalogPager({
  lang,
  page,
  totalPages,
  totalItems,
  from,
  to,
  windowPages,
  go,
}: {
  lang: Lang;
  page: number;
  totalPages: number;
  totalItems: number;
  from: number;
  to: number;
  windowPages: number[];
  go: (page: number) => void;
}) {
  return (
    <nav className="product-pager" aria-label={tr(lang, 'catalogPages')}>
      <button type="button" className="pager-nav" disabled={page <= 1} onClick={() => go(page - 1)} aria-label={tr(lang, 'prevPage')}>
        <ChevronLeft />
        <span>{tr(lang, 'prevPage')}</span>
      </button>
      <div className="pager-pages">
        {windowPages.map((p, index) => {
          const prev = windowPages[index - 1];
          const gap = prev != null && p - prev > 1;
          return (
            <span key={p} className="pager-slot">
              {gap && <em className="pager-ellipsis">…</em>}
              <button
                type="button"
                className={p === page ? 'pager-page active' : 'pager-page'}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => go(p)}
              >
                {p}
              </button>
            </span>
          );
        })}
      </div>
      <p className="pager-meta">
        <b>{from}–{to}</b>
        <span>/ {totalItems}</span>
        <small>{tr(lang, 'pageOf').replace('{page}', String(page)).replace('{pages}', String(totalPages))}</small>
      </p>
      <button type="button" className="pager-nav" disabled={page >= totalPages} onClick={() => go(page + 1)} aria-label={tr(lang, 'nextPage')}>
        <span>{tr(lang, 'nextPage')}</span>
        <ChevronRight />
      </button>
    </nav>
  );
}

const InventoryProductCard = memo(function InventoryProductCard({
  product,
  lang,
  money,
  canEdit,
  onEdit,
}: {
  product: Product;
  lang: Lang;
  money: MoneyFn;
  canEdit: boolean;
  onEdit: (product: Product) => void;
}) {
  const total = Object.values(product.warehouseStock).reduce((sum, qty) => sum + qty, 0);
  const low = total <= product.minStock;
  return (
    <button
      type="button"
      className={low ? 'product-card product-card-lg inventory-card low-stock' : 'product-card product-card-lg inventory-card'}
      onClick={() => canEdit && onEdit(product)}
      disabled={!canEdit}
    >
      <ProductVisual image={product.image} alt={product.name[lang]} accent={product.accent} category={product.category} defer />
      <span className="product-copy">
        <small>{packUnitsOf(product) > 1 && product.packName ? `1 ${packLabel(product, lang)} = ${packUnitsOf(product)} ${unitLabel(product, lang)}` : categoryLabel(product.category, lang)}</small>
        <strong>{product.name[lang]}</strong>
        <em className={low ? 'low' : ''}>
          {low ? <TriangleAlert /> : <PackageSearch />}
          {tr(lang, 'stock')}: {qtyLabel(product, total, lang)}
        </em>
      </span>
      <span className="product-price">{money(packPrice(product, product.priceMinor), lang)}</span>
      <span className={low ? 'inv-status warn' : 'inv-status ok'}>{low ? tr(lang, 'low') : 'OK'}</span>
    </button>
  );
});

type InventoryProductGridProps = {
  products: Product[];
  lang: Lang;
  money: MoneyFn;
  canEdit: boolean;
  onEdit: (product: Product) => void;
};

export function InventoryProductGrid({ products, lang, money, canEdit, onEdit }: InventoryProductGridProps) {
  const catalog = useCatalogPage(products, lang);

  if (!products.length) {
    return (
      <div className="empty inventory-empty">
        <PackageSearch />
        <p>{tr(lang, 'noResults')}</p>
      </div>
    );
  }

  return (
    <div className="product-catalog inventory-catalog">
      <div className="product-grid-page" key={`inv-${catalog.page}-${catalog.filterSig}`}>
        {catalog.pageItems.map((product) => (
          <InventoryProductCard
            key={product.id}
            product={product}
            lang={lang}
            money={money}
            canEdit={canEdit}
            onEdit={onEdit}
          />
        ))}
      </div>
      <CatalogPager
        lang={lang}
        page={catalog.page}
        totalPages={catalog.totalPages}
        totalItems={products.length}
        from={catalog.from}
        to={catalog.to}
        windowPages={catalog.windowPages}
        go={catalog.go}
      />
    </div>
  );
}
