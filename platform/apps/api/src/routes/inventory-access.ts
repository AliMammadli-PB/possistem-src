export type PortalProduct = 'market' | 'restaurant';

const KINDS = new Set([
  'warehouse.create',
  'warehouse.rename',
  'warehouse.close',
  'stock.receive',
  'stock.transfer',
  'stock.waste',
  'stock.adjust',
  'stock.count',
  'product.save',
  'product.deactivate',
  'menu.product.save',
  'menu.category.save',
  'cash.in',
  'cash.out',
  'customer.pay',
  'supplier.pay',
  'purchase.order',
  'purchase.receive',
]);

/** Sold module. Missing flag stays open so existing shops are not locked out. */
export function inventoryEnabled(features: Record<string, unknown> | null | undefined): boolean {
  return features?.inventory !== false;
}

export function portalAccess(featureRows: Array<Record<string, unknown>>): {
  products: PortalProduct[];
  catalogProducts: PortalProduct[];
  cost: Record<PortalProduct, boolean>;
} {
  const cost: Record<PortalProduct, boolean> = { market: false, restaurant: false };
  if (featureRows.length === 0) {
    return { products: ['market', 'restaurant'], catalogProducts: ['restaurant'], cost: { market: true, restaurant: true } };
  }
  const products: PortalProduct[] = [];
  const catalogProducts: PortalProduct[] = [];
  for (const features of featureRows) {
    const market = features.product === 'market' || features.market === true;
    const key: PortalProduct = market ? 'market' : 'restaurant';
    if (!market && !catalogProducts.includes('restaurant')) catalogProducts.push('restaurant');
    if (!inventoryEnabled(features)) continue;
    if (!products.includes(key)) products.push(key);
    if (market) cost.market = features.viewCost !== false;
    else cost.restaurant = true;
  }
  return { products, catalogProducts, cost };
}

export function commandError(kind: string, body: Record<string, unknown>): string | null {
  if (!KINDS.has(kind)) return 'Əmr tanınmadı';
  const nonEmpty = (key: string) => typeof body[key] === 'string' && String(body[key]).trim().length > 0;
  const whole = (key: string) => typeof body[key] === 'number' && Number.isSafeInteger(body[key]);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (kind === 'product.deactivate' && (!nonEmpty('productId') || !nonEmpty('deviceId'))) return 'Məhsul və POS cihazı seçilməlidir';
  if ((kind === 'warehouse.create' || kind === 'warehouse.rename' || kind === 'product.save') && !name) {
    return 'Ad tələb olunur';
  }
  if (kind === 'menu.product.save' && (!name || !nonEmpty('categoryId') ||
      typeof body.salePrice !== 'number' || !Number.isSafeInteger(body.salePrice) || Number(body.salePrice) < 0)) {
    return 'Menyu məhsulunun adı, kateqoriyası və qiyməti tələb olunur';
  }
  if (kind === 'menu.category.save' && !name) return 'Kateqoriya adı tələb olunur';
  if (kind === 'cash.in' || kind === 'cash.out') {
    if (!whole('amountMinor') || Number(body.amountMinor) <= 0) return 'Məbləğ sıfırdan böyük olmalıdır';
    if (!nonEmpty('reason')) return 'Səbəb tələb olunur';
  }
  if (kind === 'customer.pay' || kind === 'supplier.pay') {
    if (!whole('amountMinor') || Number(body.amountMinor) <= 0) return 'Məbləğ sıfırdan böyük olmalıdır';
    if (kind === 'customer.pay' && !nonEmpty('customerId')) return 'Müştəri seçilməlidir';
    if (kind === 'supplier.pay' && !nonEmpty('supplierId') && !nonEmpty('supplierName')) return 'Təchizatçı seçilməlidir';
  }
  if (kind === 'purchase.order') {
    if (!nonEmpty('warehouseId')) return 'Anbar seçilməlidir';
    if (!nonEmpty('supplierId') && !nonEmpty('supplierName')) return 'Təchizatçı seçilməlidir';
    if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 200) return 'Alış sətri tələb olunur';
    for (const value of body.lines) {
      if (!value || typeof value !== 'object') return 'Alış sətri düzgün deyil';
      const line = value as Record<string, unknown>;
      if (typeof (line.productId ?? line.ingredientId) !== 'string' ||
          !Number.isSafeInteger(line.qty ?? line.qtyMilli) || Number(line.qty ?? line.qtyMilli) <= 0 ||
          !Number.isSafeInteger(line.unitCostMinor) || Number(line.unitCostMinor) < 0) return 'Alış sətri düzgün deyil';
    }
  }
  if (kind === 'purchase.receive' && !nonEmpty('purchaseId')) return 'Alış seçilməlidir';
  if ((kind === 'warehouse.rename' || kind === 'warehouse.close') && (typeof body.id !== 'string' || !body.id)) {
    return 'Anbar seçilməlidir';
  }
  if (kind.startsWith('stock.')) {
    const id = body.productId ?? body.ingredientId;
    if (typeof id !== 'string' || !id) return 'Məhsul seçilməlidir';
    if (kind !== 'stock.transfer' && !nonEmpty('warehouseId')) return 'Anbar seçilməlidir';
    const quantity = whole('qtyMilli') ? Number(body.qtyMilli) : whole('qty') ? Number(body.qty) : NaN;
    if (!Number.isSafeInteger(quantity)) return 'Düzgün miqdar daxil edin';
    if (kind !== 'stock.count' && kind !== 'stock.adjust' && quantity <= 0) return 'Miqdar sıfırdan böyük olmalıdır';
    if (kind === 'stock.count' && quantity < 0) return 'Sayım qalığı mənfi ola bilməz';
  }
  if (kind === 'stock.transfer') {
    if (!nonEmpty('fromWarehouseId') || !nonEmpty('toWarehouseId')) {
      return 'İki anbar seçilməlidir';
    }
    if (body.fromWarehouseId === body.toWarehouseId) return 'Eyni anbara köçürmək olmaz';
  }
  return null;
}
