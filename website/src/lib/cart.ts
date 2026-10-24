export const CART_STORAGE_KEY = 'possistem-cart-v1';

export type CartItem = {
  id: string;
  name: string;
  sku: string;
  image: string;
  price: number;
  qty: number;
  maxQty: number;
};

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function readStoredCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const item = row as Partial<CartItem>;
        const price = Number(item.price);
        const qty = Math.trunc(Number(item.qty));
        const maxQty = Math.max(1, Math.trunc(Number(item.maxQty) || qty || 1));
        if (!item.id || !item.name || !Number.isFinite(price) || price < 0 || qty < 1) return null;
        return {
          id: String(item.id),
          name: String(item.name),
          sku: String(item.sku ?? ''),
          image: String(item.image ?? ''),
          price,
          qty: Math.min(maxQty, qty),
          maxQty,
        };
      })
      .filter((item): item is CartItem => Boolean(item));
  } catch {
    return [];
  }
}
