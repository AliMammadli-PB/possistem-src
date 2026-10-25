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
  syncError:string;
  refresh:()=>void;
  rememberOrder:(orderId:string,customerId:string)=>void;
  completeOrder:(orderId:string,customerId:string)=>void;
};

const ORDER_CART_KEY='possistem-cart-orders-v1';
type PendingCart={orderId:string;customerId:string;at:number;items:{id:string;qty:number;lineId?:string}[]};
function pendingCarts():PendingCart[]{try{const raw=JSON.parse(localStorage.getItem(ORDER_CART_KEY)||'[]');return Array.isArray(raw)?raw.filter(x=>x&&typeof x.orderId==='string'&&typeof x.customerId==='string'&&Number.isFinite(x.at)&&Date.now()-x.at<7*86400000&&Array.isArray(x.items)).slice(-20):[];}catch{return [];}}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const {prices}=usePartner();
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [syncError,setSyncError]=useState('');
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);

  useEffect(() => {
    let alive=true;
    const stored=readStoredCart();
    void fetchPublicCatalog().then(data=>{if(!alive)return;setSyncError('');setItems(current=>(hydrated?current:stored).flatMap(item=>{const product=data.products.find(p=>p.id===item.id);if(!product||product.isTest||!hasPublicPrice(product)||stockRemaining(product)<1)return [];return [{...item,name:product.name,image:product.image,price:product.price,maxQty:stockRemaining(product),qty:Math.min(item.qty,stockRemaining(product))}];}));setHydrated(true);}).catch(()=>{if(alive){if(!hydrated)setItems(stored);setSyncError('Qiymət və stok yenilənmədi. Səbətiniz saxlanılır; sifarişdə məbləği yenidən yoxlayın.');setHydrated(true);}});
    return()=>{alive=false;};
  }, [revision]);
  useEffect(()=>{if(open)refresh();},[open,refresh]);
  useEffect(()=>{const update=()=>{if(document.visibilityState==='visible')refresh();};window.addEventListener('focus',update);return()=>window.removeEventListener('focus',update);},[refresh]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Cart still works in memory if storage is unavailable.
    }
  }, [hydrated, items]);

  const add = useCallback((product: CatalogProduct, qty = 1) => {
    if(product.isTest||!Number.isSafeInteger(qty)||qty<1)return;
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
        lineId:existing?.lineId??(typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+':'+Math.random()),
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
    if(!Number.isFinite(qty))return;
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
  const rememberOrder=useCallback((orderId:string,customerId:string)=>{try{const rest=pendingCarts().filter(o=>o.orderId!==orderId);localStorage.setItem(ORDER_CART_KEY,JSON.stringify([...rest,{orderId,customerId,at:Date.now(),items:items.map(i=>({id:i.id,qty:i.qty,lineId:i.lineId}))}].slice(-20)));}catch{/* Checkout remains usable when storage is blocked. */}},[items]);
  const completeOrder=useCallback((orderId:string,customerId:string)=>{if(!hydrated)return;const all=pendingCarts(),pending=all.find(o=>o.orderId===orderId&&o.customerId===customerId);if(!pending)return;
    try{localStorage.setItem(ORDER_CART_KEY,JSON.stringify(all.filter(o=>o!==pending)));}catch{return;}
    setItems(current=>current.flatMap(item=>{const bought=pending.items.find(i=>i&&i.id===item.id);if(!bought||bought.lineId!==item.lineId||!Number.isSafeInteger(bought.qty)||bought.qty<1)return [item];const qty=Math.max(0,item.qty-bought.qty);return qty?[{...item,qty}]:[];}));
  },[hydrated]);

  const displayItems=useMemo(()=>items.map(item=>({...item,price:partnerProductPrice(item.id,item.price,prices)??0})).filter(item=>item.price>0),[items,prices]);
  const value = useMemo<CartContextValue>(
    () => ({
      items:displayItems,
      syncError,refresh,rememberOrder,completeOrder,
      count: cartCount(displayItems),
      total: cartTotal(displayItems),
      open,
      setOpen,
      add,
      setQty,
      remove,
      clear,
    }),
    [displayItems, open, add, setQty, remove, clear,syncError,refresh,rememberOrder,completeOrder],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
}
