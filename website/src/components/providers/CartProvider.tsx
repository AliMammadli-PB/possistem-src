'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CatalogProduct } from '@/lib/catalog-products';
import { hasPublicPrice, stockRemaining, fetchPublicCatalog } from '@/lib/catalog-products';
import {usePartner} from './PartnerProvider';
import {partnerProductPrice} from '@/lib/partner-pricing';
import { CART_STORAGE_KEY, cartCount, cartTotal, readStoredCart, type CartItem } from '@/lib/cart';

type CartContextValue = {
  items: CartItem[];
  count: number;
  total: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  add: (product: CatalogProduct, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const {prices}=usePartner();
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let alive=true;
    const stored=readStoredCart();
    void fetchPublicCatalog().then(data=>{if(!alive)return;setItems(stored.flatMap(item=>{const product=data.products.find(p=>p.id===item.id);if(!product||!hasPublicPrice(product)||stockRemaining(product)<1)return [];return [{...item,price:product.price,maxQty:stockRemaining(product),qty:Math.min(item.qty,stockRemaining(product))}];}));setHydrated(true);}).catch(()=>{if(alive){setItems([]);setHydrated(true);}});
    return()=>{alive=false;};
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Cart still works in memory if storage is unavailable.
    }
  }, [hydrated, items]);

  const add = useCallback((product: CatalogProduct, qty = 1) => {
    const effectivePrice=partnerProductPrice(product.id,product.price,prices);
    if(typeof product.price!=='number'||product.price<=0)return;
    if(typeof effectivePrice!=='number'||effectivePrice<=0)return;
    const maxQty = Math.max(0, stockRemaining(product));
    if (maxQty <= 0) return;
    setItems((current) => {
      const existing = current.find((item) => item.id === product.id);
      const nextQty = Math.min(maxQty, (existing?.qty ?? 0) + qty);
      const nextItem: CartItem = {
        id: product.id,
        name: product.name,
        sku: product.sku ?? '',
        image: product.image ?? '',
        // Persist only the public price. Partner prices remain in authenticated memory.
        price: product.price??0,
        qty: nextQty,
        maxQty,
      };
      if (existing) {
        return current.map((item) => (item.id === product.id ? nextItem : item));
      }
      return [...current, nextItem];
    });
    setOpen(true);
  }, [prices]);

  const setQty = useCallback((id: string, qty: number) => {
    setItems((current) =>
      current
        .map((item) => {
          if (item.id !== id) return item;
          const next = Math.min(item.maxQty, Math.max(0, Math.trunc(qty)));
          return { ...item, qty: next };
        })
        .filter((item) => item.qty > 0),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const displayItems=useMemo(()=>items.map(item=>({...item,price:partnerProductPrice(item.id,item.price,prices)??0})).filter(item=>item.price>0),[items,prices]);
  const value = useMemo<CartContextValue>(
    () => ({
      items:displayItems,
      count: cartCount(displayItems),
      total: cartTotal(displayItems),
      open,
      setOpen,
      add,
      setQty,
      remove,
      clear,
    }),
    [displayItems, open, add, setQty, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
