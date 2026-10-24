export type AccessSurface = 'portal' | 'market' | 'restaurant';

export type AccessGrant = {
  portal: string[] | null;
  market: string[] | null;
  restaurant: string[] | null;
};

/** Screens that already exist. A missing list means every key is allowed. */
export const ACCESS_AREAS: Record<AccessSurface, Array<[string, string]>> = {
  portal: [
    ['home', 'Ana səhifə'],
    ['anbar', 'Anbar'],
    ['product', 'Məhsul və xidmətlər'],
    ['enter', 'Daxilolmalar'],
    ['loss', 'Silinmələr'],
    ['move', 'Yerdəyişmələr'],
    ['inventory', 'İnventarizasiyalar'],
    ['stock', 'Anbar qalığı'],
    ['supply', 'Alışlar'],
    ['purchaseorder', 'Alış sifarişi'],
    ['demand', 'Satışlar'],
    ['demandreturns', 'Satış qaytarması'],
    ['customerorders', 'Müştəri sifarişi'],
    ['customer', 'Tərəf-müqabillər'],
    ['transactions', 'Ödənişlər'],
    ['settlements', 'Borclar'],
    ['cashtransactions', 'Transferlər'],
    ['shifts', 'Növbələr'],
    ['retailsales', 'Pərakəndə satış'],
    ['retailreturns', 'Pərakəndə qaytarma'],
    ['credittransaction', 'Kredit ödəniş'],
    ['cashins', 'Kassa mədaxil'],
    ['cashouts', 'Kassa məxaric'],
    ['salepoints', 'Satış nöqtələri'],
    ['salereports', 'Mənfəət'],
    ['profit', 'Mənfəət və ya zərər'],
    ['dailyreports', 'Gündəlik hesabat'],
    ['producttransactions', 'Dövriyyə'],
    ['comprehensive', 'Təchizatçı hesabatı'],
    ['cashes', 'Hesablar'],
    ['stockbalance', 'Hesabat: anbar qalığı'],
    ['anbar.write', 'Anbar dəyişiklikləri'],
    ['product.write', 'Məhsul dəyişiklikləri'],
    ['enter.write', 'Daxilolma yaratmaq'],
    ['loss.write', 'Silinmə yaratmaq'],
    ['move.write', 'Yerdəyişmə yaratmaq'],
    ['inventory.write', 'Sayım yaratmaq'],
    ['cashins.write', 'Kassa mədaxili yaratmaq'],
    ['cashouts.write', 'Kassa məxarici yaratmaq'],
    ['transactions.write', 'Borc ödənişi yaratmaq'],
    ['credittransaction.write', 'Kredit ödənişi yaratmaq'],
    ['purchaseorder.write', 'Alış sifarişi yaratmaq'],
    ['supply.write', 'Alışı qəbul etmək'],
    ['emeliyyat', 'Satış və hesabat'],
    ['chat', 'Chat'],
    ['setup', 'Quraşdırma'],
    ['downloads', 'Yükləmələr'],
    ['activity', 'Fəaliyyət'],
    ['integrations', 'İnteqrasiyalar'],
    ['settings', 'Parametrlər'],
    ['support', 'Dəstək'],
  ],
  market: [
    ['dashboard', 'Panel'],
    ['sale', 'Satış'],
    ['inventory', 'Anbar qalığı'],
    ['warehouses', 'Anbarlar'],
    ['purchases', 'Alış'],
    ['returns', 'Qaytarma'],
    ['reports', 'Hesabat'],
    ['registers', 'Kassa'],
    ['stocktake', 'Sayım'],
    ['customers', 'Müştərilər'],
    ['import', 'İdxal'],
    ['staff', 'İşçilər'],
    ['settings', 'Parametrlər'],
  ],
  restaurant: [
    ['tables', 'Zal'],
    ['kds', 'Mətbəx'],
    ['refund', 'Qaytarma'],
    ['stock', 'Anbar'],
    ['suppliers', 'Alış / təchizat'],
    ['guests', 'Müştərilər'],
    ['delivery', 'Çatdırılma'],
    ['roster', 'İş qrafiki'],
    ['catalog', 'Menyu'],
    ['reports', 'Hesabat'],
    ['cash', 'Kassa'],
    ['staff', 'İşçilər'],
    ['admin', 'İdarə'],
    ['settings', 'Parametrlər'],
  ],
};

const KEYS: Record<AccessSurface, string[]> = {
  portal: ACCESS_AREAS.portal.map(([key]) => key),
  market: ACCESS_AREAS.market.map(([key]) => key),
  restaurant: ACCESS_AREAS.restaurant.map(([key]) => key),
};

export function areaKeys(surface: AccessSurface): string[] {
  return KEYS[surface];
}

/** null = the head admin has not taken anything away. */
export function tighten(surface: AccessSurface, keys: string[] | null): string[] | null {
  if (keys == null) return null;
  const known = KEYS[surface];
  const picked = [...new Set(keys.filter((key) => known.includes(key)))];
  if (picked.length === known.length) return null;
  return picked;
}

export function areaAllowed(list: string[] | null | undefined, key: string): boolean {
  if (list == null) return true;
  return list.includes(key);
}

export const PORTAL_STOCK_KEYS = ['anbar', 'product', 'enter', 'loss', 'move', 'inventory', 'stock', 'stockbalance', 'supply', 'purchaseorder'] as const;

export const PORTAL_BOOK_KEYS = [
  'emeliyyat', 'supply', 'purchaseorder', 'demand', 'demandreturns', 'customerorders', 'customer',
  'transactions', 'settlements', 'cashtransactions', 'shifts', 'retailsales', 'retailreturns',
  'credittransaction', 'cashins', 'cashouts', 'salepoints', 'salereports', 'profit', 'dailyreports',
  'producttransactions', 'comprehensive', 'cashes',
] as const;

export function anyAllowed(list: string[] | null | undefined, keys: readonly string[]): boolean {
  if (list == null) return true;
  return keys.some((key) => list.includes(key));
}

export function readGrant(features: Record<string, unknown> | null | undefined): AccessGrant | null {
  const raw = features?.access;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const list = (surface: AccessSurface): string[] | null => {
    const value = row[surface];
    if (!Array.isArray(value)) return null;
    return tighten(surface, value.filter((key): key is string => typeof key === 'string'));
  };
  return { portal: list('portal'), market: list('market'), restaurant: list('restaurant') };
}
