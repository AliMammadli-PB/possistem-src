import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** The two things POSSISTEM sells. Mirrors PosProduct on the API side. */
export type PosProduct = 'restaurant' | 'market';

export const POS_PRODUCTS: PosProduct[] = ['market', 'restaurant'];

type ProductState = {
  product: PosProduct;
  setProduct: (next: PosProduct) => void;
  /**
   * False until somebody has actually picked one.
   *
   * The difference matters: `product` has always had to hold something, so it
   * fell back to 'restaurant', and an operator who came in to look at Market
   * was shown restaurant figures by a panel that never asked. Separating "the
   * current product" from "a product was chosen" is what lets the panel ask.
   */
  chosen: boolean;
};

const ProductContext = createContext<ProductState | null>(null);

// v2 because the meaning changed: the old key was a preference with a silent
// default, so every browser that ever opened the panel holds one and would skip
// the question entirely. A new key asks everyone once, which is the point.
const STORAGE_KEY = 'possistem_admin_product_v2';

function isProduct(value: unknown): value is PosProduct {
  return value === 'market' || value === 'restaurant';
}

function readStored(): PosProduct | null {
  // localStorage rather than the sessionStorage used for the session token:
  // which product an operator works on is a standing preference, not something
  // to re-pick after every browser restart. Wrapped because a locked-down
  // browser profile makes the accessor itself throw.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isProduct(raw)) return raw;
  } catch {
    /* no storage — the panel will ask, every time */
  }
  return null;
}

/**
 * Which product the admin panel is currently looking at.
 *
 * Kept in context rather than the URL: it is global chrome affecting several
 * pages at once, so putting it in the query string would force every Link in
 * the app to carry and forward it. The per-customer `?product=` param stays as
 * it is — this only supplies its default when the param is absent.
 */
export function ProductProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<PosProduct | null>(readStored);

  useEffect(() => {
    if (!stored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, stored);
    } catch {
      /* preference simply will not persist */
    }
  }, [stored]);

  const setProduct = useCallback((next: PosProduct) => {
    setStored(next);
  }, []);

  return (
    <ProductContext.Provider
      value={{ product: stored ?? 'restaurant', setProduct, chosen: stored !== null }}
    >
      {children}
    </ProductContext.Provider>
  );
}

export function useProduct(): ProductState {
  const ctx = useContext(ProductContext);
  if (!ctx) throw new Error('useProduct must be used inside ProductProvider');
  return ctx;
}
