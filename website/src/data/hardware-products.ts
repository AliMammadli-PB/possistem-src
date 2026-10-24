export type HardwareAudience = 'restaurant' | 'market' | 'both' | 'info';

export type HardwareCategory = {
  id: string;
  labelKey: string;
};

export type HardwareProduct = {
  id: string;
  categoryId: string;
  image: string;
  titleKey: string;
  descKey: string;
  audience: HardwareAudience;
  featured?: boolean;
};

export const HARDWARE_CATEGORIES: HardwareCategory[] = [
  { id: 'all', labelKey: 'hardware.cat.all' },
  { id: 'core', labelKey: 'hardware.cat.core' },
  { id: 'print', labelKey: 'hardware.cat.print' },
  { id: 'cashier', labelKey: 'hardware.cat.cashier' },
  { id: 'scan', labelKey: 'hardware.cat.scan' },
  { id: 'display', labelKey: 'hardware.cat.display' },
  { id: 'accessories', labelKey: 'hardware.cat.accessories' },
];

export const HARDWARE_PRODUCTS: HardwareProduct[] = [
  {
    id: 'touch-pos-apc-pro-s2',
    categoryId: 'core',
    image: '/assets/hardware/touch-pos-apc-pro-s2.png',
    titleKey: 'hardware.item.touchPosApcProS2.title',
    descKey: 'hardware.item.touchPosApcProS2.desc',
    audience: 'both',
    featured: true,
  },
  {
    id: 'dual-pos-apc-s1m',
    categoryId: 'core',
    image: '/assets/hardware/dual-pos-apc-s1m.png',
    titleKey: 'hardware.item.dualPosApcS1m.title',
    descKey: 'hardware.item.dualPosApcS1m.desc',
    audience: 'both',
    featured: true,
  },
  {
    id: 'receipt-printer-xp-q806k',
    categoryId: 'print',
    image: '/assets/hardware/receipt-printer-xp-q806k.png',
    titleKey: 'hardware.item.receiptPrinter806k.title',
    descKey: 'hardware.item.receiptPrinter806k.desc',
    audience: 'both',
    featured: true,
  },
  {
    id: 'label-printer-xp-428b',
    categoryId: 'print',
    image: '/assets/hardware/label-printer-xp-428b.png',
    titleKey: 'hardware.item.labelPrinter428b.title',
    descKey: 'hardware.item.labelPrinter428b.desc',
    audience: 'market',
  },
  {
    id: 'cash-drawer-apc-405cb',
    categoryId: 'cashier',
    image: '/assets/hardware/cash-drawer-apc-405cb.png',
    titleKey: 'hardware.item.cashDrawer405cb.title',
    descKey: 'hardware.item.cashDrawer405cb.desc',
    audience: 'both',
  },
  {
    id: 'barcode-scanner-sunlux-xl3620',
    categoryId: 'scan',
    image: '/assets/hardware/barcode-scanner-sunlux-xl3620.png',
    titleKey: 'hardware.item.scannerSunlux.title',
    descKey: 'hardware.item.scannerSunlux.desc',
    audience: 'market',
  },
  {
    id: 'barcode-scale-merc-rombi7',
    categoryId: 'scan',
    image: '/assets/hardware/barcode-scale-merc-rombi7.png',
    titleKey: 'hardware.item.scaleMercRombi7.title',
    descKey: 'hardware.item.scaleMercRombi7.desc',
    audience: 'market',
  },
  {
    id: 'data-terminal-chainway-c61',
    categoryId: 'scan',
    image: '/assets/hardware/data-terminal-chainway-c61.png',
    titleKey: 'hardware.item.terminalChainwayC61.title',
    descKey: 'hardware.item.terminalChainwayC61.desc',
    audience: 'market',
  },
  {
    id: 'customer-display-apex-prm1520',
    categoryId: 'display',
    image: '/assets/hardware/customer-display-apex-prm1520.png',
    titleKey: 'hardware.item.customerDisplayApex.title',
    descKey: 'hardware.item.customerDisplayApex.desc',
    audience: 'restaurant',
  },
  {
    id: 'price-checker-ocpc-002',
    categoryId: 'display',
    image: '/assets/hardware/price-checker-ocpc-002.png',
    titleKey: 'hardware.item.priceCheckerOcpc.title',
    descKey: 'hardware.item.priceCheckerOcpc.desc',
    audience: 'market',
  },
  {
    id: 'cat6-cable-biyikci',
    categoryId: 'accessories',
    image: '/assets/hardware/cat6-cable-biyikci.png',
    titleKey: 'hardware.item.cat6Cable.title',
    descKey: 'hardware.item.cat6Cable.desc',
    audience: 'both',
  },
  {
    id: 'thermal-paper-80x80',
    categoryId: 'accessories',
    image: '/assets/hardware/thermal-paper-80x80.png',
    titleKey: 'hardware.item.thermalPaper80.title',
    descKey: 'hardware.item.thermalPaper80.desc',
    audience: 'both',
  },
];

export const HARDWARE_STARTER_IDS = [
  'touch-pos-apc-pro-s2',
  'receipt-printer-xp-q806k',
  'cash-drawer-apc-405cb',
  'label-printer-xp-428b',
] as const;
