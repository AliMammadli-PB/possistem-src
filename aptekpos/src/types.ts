export type Lang = 'az' | 'ru' | 'en';
export type Role = 'manager' | 'head_cashier' | 'cashier' | 'warehouse';
export type View = 'dashboard' | 'sale' | 'inventory' | 'warehouses' | 'purchases' | 'returns' | 'reports' | 'registers' | 'staff' | 'mobile' | 'settings' | 'stocktake' | 'customers' | 'import' | 'platform' | 'support' | 'help';
export type LocalizedText = Record<Lang, string>;
export type ProductImage =
  | { kind: 'sprite'; index: number }
  | { kind: 'url'; url: string; remoteUrl?: string };
export type Product = { id: string; sku: string; barcode: string; internalCode?: string; color?: string; size?: string; parentProductId?: string; inn?: string; strength?: string; dosageForm?: string; packUnits?: number; splitAllowed?: boolean; rxRequired?: boolean; storage?: string; manufacturer?: string; country?: string; regNo?: string; shelf?: string; name: LocalizedText; category: string; unit: string; priceMinor: number; costMinor: number; minStock: number; taxRate: number; supplier: string; stock?: number; /** Legacy wire shape; the shop keeps one stock figure. */ warehouseStock: Record<string, number>; accent: string; image: ProductImage; active: boolean; createdAt: number; comment?: string; department?: string; kind?: 'product' | 'service'; minPriceMinor?: number; packQty?: number; packUnit?: string; priceDealerMinor?: number; priceDiscountMinor?: number; priceWholesaleMinor?: number; serial?: boolean; station?: string; tags?: string; weighted?: boolean; };
/** A product as a form submits it: `stock` absent means "leave the quantity alone". */
export type ProductDraft = Omit<Product, 'stock'> & { stock?: number };
export type CartLine = { saleItemId?: number; productId: string; qty: number; discountMinor?: number; note?: string };
export type Payment = { method: 'cash' | 'card' | 'mixed' | 'credit' | 'loyalty'; amountMinor: number; tenderedMinor: number; changeMinor: number; cashMinor?: number; cardMinor?: number; creditMinor?: number; loyaltyMinor?: number; terminalRef?: string };
export type Sale = { id: string; receiptNo: string; createdAt: number; items: CartLine[]; subtotalMinor: number; discountMinor: number; totalMinor: number; payment: Payment; refunded: boolean; cashierId: string; registerId: string; customerId?: string; customerName?: string; loyaltyEarnedMinor?: number; loyaltyRedeemedMinor?: number; creditMinor?: number; note?: string };
export type PurchaseOrder = { id: string; documentNo?: string; supplier: string; expectedAt: string; createdAt: number; updatedAt?: number; createdBy: string; warehouseId: string; status: 'draft' | 'ordered' | 'received'; totalMinor?: number; paymentStatus?: 'unpaid' | 'partial' | 'paid'; lines: Array<{ id?: string; productId: string; qty: number; costMinor: number; returnedQty?: number }> };
/** A pharmacy shelf; `products` is how many active medicines sit on it. */
export type Shelf = { code: string; zone: string; note: string; sort: number; products?: number };
export type Warehouse = { id: string; code: string; name: string; address: string; manager: string; active: boolean };
export type Register = { id: string; code: string; name: string; location: string; status: 'open' | 'closed'; operatorId?: string; openingFloatMinor: number; openedAt?: number };
/**
 * `mustChangePin` is true while the account still carries the PIN shipped in
 * the source. Such a session is stripped of its role for core operations, so
 * manager actions stay blocked until a real PIN is set in Settings.
 */
export type StaffProfile = { id: string; name: string; role: Role; active: boolean; registerIds: string[]; warehouseIds: string[]; mustChangePin?: boolean };
export type AuditEntry = { id: string; createdAt: number; actorId: string; action: string; detail: string };
export type HeldCart = { id: string; label: string; createdAt: number; lines: CartLine[]; discountMinor?: number; customerId?: string; customerName?: string; note?: string };
export type StoreSettings = { storeName: string; legalName: string; taxId: string; phone: string; address: string; terminalName: string; terminalNameUpdatedAt?: number | string; deviceRegisterId?: string; defaultWarehouseId: string; defaultRegisterId: string; logoUrl?: string; syncUrl: string; stockPolicy?: 'BLOCK_NEGATIVE_STOCK' | 'ALLOW_NEGATIVE_STOCK'; catalogSeedVersion?: string; sampleCatalog?: string; loyaltyRateBps?: number | string };
export type PersistedState = { schemaVersion: 4 | 5; products: Product[]; sales: Sale[]; purchaseOrders: PurchaseOrder[]; warehouses: Warehouse[]; registers: Register[]; heldCarts: HeldCart[]; audits: AuditEntry[]; settings: StoreSettings; syncQueue: number };
export type SessionUser = StaffProfile & { sessionToken: string };
export type UpdateStatus = { state: 'idle' } | { state: 'checking' } | { state: 'available'; version: string } | { state: 'not_available' } | { state: 'downloading'; percent: number } | { state: 'downloaded'; version: string } | { state: 'disabled'; message: string } | { state: 'error'; message: string };
export type CustomerBranding = { productName?: string; tagline?: string; appMode?: 'restaurant' | 'market'; fontFamily?: 'montserrat' | 'manrope' | 'system'; density?: 'compact' | 'comfortable' | 'large'; primaryColor?: string; surfaceColor?: string; logoDataUrl?: string; backgroundDataUrl?: string; showProductImages?: boolean };
export type ActivationStatus = { mode: 'unlicensed' | 'trial' | 'active' | 'expired' | 'revoked'; customerName: string; deviceId: string; serverDeviceId?: string; customerId?: string; validUntil: number; controlUrl: string; branding?: CustomerBranding | null; customer?: { legalName: string; address: string; phone: string; taxId: string } };
export type TenantStatus = { authenticated: false } | { authenticated: true; email: string; customerId: string; customerName: string; expiresAt: number; paymentUrl?: string | null; licenses?: unknown[] };
