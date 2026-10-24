import { asset } from '@/lib/assets';

export type DemoMode = 'restaurant' | 'market';

/** Screens the site deep-links into (the "Quraşdırma" illustration hotspots). */
export type DemoScreen =
  | 'choose'
  | 'pos'
  | 'dashboard'
  | 'sales'
  | 'menu'
  | 'stock'
  | 'customers'
  | 'staff'
  | 'reports'
  | 'license'
  | 'notifications'
  | 'settings';

export const img = (path: string) => asset(`/assets/pos-demo/${path}`);

/**
 * The demo is the real till: its UI and its C++ core compiled to WebAssembly,
 * served from public/pos-demo-app/. Staff PINs come from the demo seed
 * (restoranpos/demo-web/seed.js, marketpos/demo-web/bridge.template.js).
 */
export const MODE_META: Record<
  DemoMode,
  { name: string; store: string; login: string; app: string; pins: [string, string][] }
> = {
  restaurant: {
    name: 'Restoran POS',
    store: 'Demo Restoran',
    login: 'restoran-login.webp',
    app: '/pos-demo-app/restoran/index.html',
    pins: [
      ['Admin', '1234'],
      ['Ofisiant Elvin', '2222'],
      ['Ofisiant Nigar', '3333'],
    ],
  },
  market: {
    name: 'Market POS',
    store: 'Demo Market',
    login: 'market-login.webp',
    app: '/pos-demo-app/market/index.html',
    pins: [
      ['Müdir', '1234'],
      ['Kassir', '2222'],
      ['Anbar', '3333'],
      ['Baş kassir', '4444'],
    ],
  },
};

/** Restaurant routes (HashRouter) for each deep-linked screen. */
export const RESTAURANT_ROUTE: Partial<Record<DemoScreen, string>> = {
  pos: '#/tables',
  dashboard: '#/dashboard',
  sales: '#/admin/reports',
  reports: '#/admin/reports',
  menu: '#/admin/catalog',
  staff: '#/admin/staff',
  stock: '#/operations',
  customers: '#/operations',
  license: '#/settings/license',
  notifications: '#/dashboard',
  settings: '#/settings',
};
