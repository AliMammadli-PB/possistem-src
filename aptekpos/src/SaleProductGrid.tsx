import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PackageSearch, TriangleAlert } from 'lucide-react';

import { ProductVisual } from './ProductVisual';
import { categoryLabel, tr } from './i18n';
import { expiryState, formInfo, nextLot, packPriceOf, packUnitsOf, qtyLabel, type Lot } from './pharmacy';
import { stockOf } from './domain';
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
      <ProductVisual image={product.image} alt={product.name[lang]} accent={product.accent} category={product.category} dosageForm={product.dosageForm} defer />
      <span className="product-copy">
        <small>{[product.strength, formInfo(product.dosageForm).labels[lang]].filter(Boolean).join(' · ') || categoryLabel(product.category, lang)}</small>
        <strong>{product.name[lang]}</strong>
        <em className={low ? 'low' : ''}>
          {low ? <TriangleAlert /> : <PackageSearch />}
          {tr(lang, 'stock')}: {qtyLabel(product, total, lang)}
        </em>
      </span>
      <span className="product-price">{money(product.priceMinor, lang)}</span>
      <span className={low ? 'inv-status warn' : 'inv-status ok'}>{low ? tr(lang, 'low') : 'OK'}</span>
    </button>
  );
});

type Lots = Map<string, Lot[]>;

/**
 * The pharmacist looks medicines up by name, active ingredient or barcode, so
 * the sale screen is a list rather than picture tiles: one row per medicine
 * with its strength, form, prescription flag, nearest expiry and stock, and
 * buttons to add a whole pack or, when the pack may be opened, one unit.
 */
export function SaleMedicineList({ products, lots, lang, money, inCart, onAdd }: { products: Product[]; lots: Lots; lang: Lang; money: MoneyFn; inCart: (productId: string) => number; onAdd: (product: Product, units: number) => void }) {
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [products]);
  if (!products.length) {
    return (
      <div className="empty">
        <PackageSearch />
        <p>{tr(lang, 'noStockedProducts')}</p>
      </div>
    );
  }
  return (
    <div className="med-list" role="list">
      <div className="med-row med-head" aria-hidden="true">
        <span />
        <span>{tr(lang, 'medicine')}</span>
        <span>{tr(lang, 'expiryDate')}</span>
        <span>{tr(lang, 'stock')}</span>
        <span>{tr(lang, 'price')}</span>
        <span />
      </div>
      {products.slice(0, limit).map((product) => {
        const per = packUnitsOf(product);
        const left = stockOf(product) - inCart(product.id);
        const lot = nextLot(lots.get(product.id) ?? []);
        const state = expiryState(lot?.expires_at);
        return (
          <div className="med-row" role="listitem" key={product.id}>
            <ProductVisual image={product.image} compact alt={product.name[lang]} accent={product.accent} category={product.category} dosageForm={product.dosageForm} />
            <span className="med-name">
              <strong>{product.name[lang]}{product.strength ? <em> {product.strength}</em> : null}</strong>
              <small>{[formInfo(product.dosageForm).labels[lang], product.inn, product.manufacturer].filter(Boolean).join(' · ')}</small>
              <span className="med-badges">
                {product.rxRequired && <b className="badge-rx">{tr(lang, 'rxBadge')}</b>}
                {product.storage === 'cool' && <b className="badge-cold">2-8 °C</b>}
              </span>
            </span>
            <span className={`med-expiry is-${state}`}>{lot?.expires_at ? new Date(lot.expires_at).toLocaleDateString('az-AZ') : '—'}{lot ? <small>{lot.lot_number}</small> : null}</span>
            <span className="med-stock">{qtyLabel(product, Math.max(0, left), lang)}</span>
            <span className="med-price">{money(packPriceOf(product), lang)}{per > 1 ? <small>{money(product.priceMinor, lang)} / {formInfo(product.dosageForm).unit[lang]}</small> : null}</span>
            <span className="med-add">
              <button type="button" disabled={left < per} onClick={() => onAdd(product, per)}>+ {tr(lang, 'pack')}</button>
              {per > 1 && <button type="button" disabled={left < 1} onClick={() => onAdd(product, 1)}>+ {formInfo(product.dosageForm).unit[lang]}</button>}
            </span>
          </div>
        );
      })}
      {products.length > limit && <button type="button" className="med-more" onClick={() => setLimit((value) => value + 60)}>{tr(lang, 'showMore')} · {products.length - limit}</button>}
    </div>
  );
}

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
