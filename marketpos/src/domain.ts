import type { Product, Role, View } from './types';

/** One stock figure per product. `warehouseStock` is only read for state saved by an older build. */
export const stockOf = (product: Product): number =>
  Math.max(0, Number(product.stock ?? 0) ||
    Object.values(product.warehouseStock ?? {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0));
export const cashChange = (totalMinor: number, tenderedMinor: number): number => Math.max(0, Math.round(tenderedMinor) - Math.max(0, Math.round(totalMinor)));
export const parseMoneyInput = (value: string): number => {
  const parsed = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
};
export const ROLE_VIEWS: Record<Role, View[]> = {
  manager: ['dashboard', 'sale', 'inventory', 'warehouses', 'purchases', 'returns', 'reports', 'registers', 'stocktake', 'customers', 'import', 'platform', 'staff', 'mobile', 'settings'],
  head_cashier: ['dashboard', 'sale', 'returns', 'reports', 'registers', 'customers'],
  cashier: ['dashboard', 'sale'],
  warehouse: ['dashboard', 'inventory', 'warehouses', 'purchases', 'stocktake', 'import'],
};
export const canAccess = (role: Role, view: View): boolean => ROLE_VIEWS[role].includes(view);
export const findBarcode = (products: Product[], value: string): Product | undefined => {
  const raw = value.trim();
  // Digits-only first (EAN/UPC labels, where the scanner may add stray symbols),
  // then the code exactly as scanned so an alphanumeric Code128 label still
  // matches instead of being stripped down to a wrong number.
  const digits = raw.replace(/\D/g, '');
  return products.find(
    (product) =>
      product.active && ((digits !== '' && product.barcode === digits) || product.barcode === raw),
  );
};

/** Normalised form of a loyalty card code: spaces and dashes on the printed card are noise. */
export const normalizeLoyaltyCard = (value: string): string =>
  value.replace(/[\s-]/g, '').toLocaleLowerCase();

/**
 * Finds the customer whose loyalty card was scanned.
 *
 * A loyalty card reaches the till through the same wedge scanner as a product
 * barcode, so the sale screen has to tell them apart. Matching is exact on the
 * normalised code — a card must never fuzzy-match onto the wrong customer and
 * credit a stranger's bonus.
 */
export const findLoyaltyCustomer = <T extends { loyaltyCard?: string }>(
  customers: T[],
  value: string,
): T | undefined => {
  const needle = normalizeLoyaltyCard(value);
  if (!needle) return undefined;
  return customers.find(
    (row) => row.loyaltyCard && normalizeLoyaltyCard(row.loyaltyCard) === needle,
  );
};
