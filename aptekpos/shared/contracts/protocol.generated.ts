/**
 * AUTO-GENERATED from market-pos/shared/contracts/protocol.json - DO NOT EDIT.
 * Regenerate with: node scripts/gen-market-protocol.mjs
 */

export const PROTOCOL_VERSION = 1 as const;

export type ErrorCode =
  | 'E_UNKNOWN_METHOD'
  | 'E_VALIDATION'
  | 'E_NOT_FOUND'
  | 'E_DB'
  | 'E_DB_UNSUITABLE_LOCATION'
  | 'E_MIGRATION_FAILED'
  | 'INSUFFICIENT_STOCK'
  | 'REGISTER_CLOSED'
  | 'E_ALREADY_REFUNDED'
  | 'E_CONFLICT'
  | 'E_INTERNAL'
  | 'PERMISSION_DENIED'
  | 'MANAGER_APPROVAL_REQUIRED'
  | 'SCALE_BARCODE_INVALID'
  | 'FISCAL_UNAVAILABLE'
  | 'FISCAL_REJECTED'
  | 'TERMINAL_DECLINED'
  | 'PRINTER_OFFLINE'
  | 'INVALID_REFUND_QUANTITY'
  | 'CREDIT_LIMIT_EXCEEDED'
  | 'PROMOTION_CONFLICT'
  | 'STOCK_WARN'
  | 'E_EXPIRED_STOCK'
;

export type MethodName =
  | 'core.ping'
  | 'core.info'
  | 'state.get'
  | 'state.importLegacy'
  | 'product.list'
  | 'product.get'
  | 'product.create'
  | 'product.update'
  | 'product.delete'
  | 'product.importPreview'
  | 'product.importCommit'
  | 'barcode.resolve'
  | 'category.list'
  | 'warehouse.list'
  | 'warehouse.create'
  | 'warehouse.update'
  | 'inventory.getStock'
  | 'inventory.movements'
  | 'inventory.adjust'
  | 'inventory.transfer'
  | 'inventory.valuation'
  | 'inventory.lowStock'
  | 'sale.create'
  | 'sale.addItem'
  | 'sale.removeItem'
  | 'sale.setQuantity'
  | 'sale.applyDiscount'
  | 'sale.complete'
  | 'sale.get'
  | 'sale.list'
  | 'sale.hold'
  | 'sale.resume'
  | 'sale.listHeld'
  | 'sale.cancelHeld'
  | 'sale.discardDraft'
  | 'sale.overridePrice'
  | 'sale.receipt'
  | 'return.create'
  | 'return.partial'
  | 'purchase.create'
  | 'purchase.receive'
  | 'purchase.list'
  | 'cash.openSession'
  | 'cash.closeSession'
  | 'cash.currentSession'
  | 'cash.listRegisters'
  | 'cash.createRegister'
  | 'cash.cashIn'
  | 'cash.movements'
  | 'cash.cashOut'
  | 'cash.safeDrop'
  | 'cash.xReport'
  | 'cash.zClose'
  | 'auth.checkPermission'
  | 'auth.listPermissions'
  | 'auth.recordApproval'
  | 'stocktake.create'
  | 'stocktake.updateLine'
  | 'stocktake.setStatus'
  | 'stocktake.post'
  | 'stocktake.list'
  | 'stocktake.get'
  | 'customer.list'
  | 'customer.create'
  | 'customer.update'
  | 'customer.ledger'
  | 'customer.payDebt'
  | 'portal.finance'
  | 'supplier.ledger'
  | 'supplier.pay'
  | 'loyalty.earn'
  | 'loyalty.redeem'
  | 'loyalty.balance'
  | 'promo.list'
  | 'promo.upsert'
  | 'promo.evaluate'
  | 'lot.list'
  | 'lot.receive'
  | 'lot.expiryReport'
  | 'fiscal.enqueue'
  | 'fiscal.listPending'
  | 'fiscal.updateStatus'
  | 'fiscal.retry'
  | 'terminal.record'
  | 'report.dailySales'
  | 'report.inventory'
  | 'report.topProducts'
  | 'report.profit'
  | 'settings.get'
  | 'settings.set'
  | 'audit.list'
  | 'audit.append'
  | 'drawer.openLogged'
  | 'platform.syncStatus'
  | 'platform.priceScopes'
  | 'platform.eqaimeStatus'
  | 'platform.aggregatorStatus'
;

export type EventName =
  | 'core.ready'
  | 'core.stage'
  | 'fiscal.updated'
  | 'stock.warn'
;

export const ERROR_CODES = [
  'E_UNKNOWN_METHOD',
  'E_VALIDATION',
  'E_NOT_FOUND',
  'E_DB',
  'E_DB_UNSUITABLE_LOCATION',
  'E_MIGRATION_FAILED',
  'INSUFFICIENT_STOCK',
  'REGISTER_CLOSED',
  'E_ALREADY_REFUNDED',
  'E_CONFLICT',
  'E_INTERNAL',
  'PERMISSION_DENIED',
  'MANAGER_APPROVAL_REQUIRED',
  'SCALE_BARCODE_INVALID',
  'FISCAL_UNAVAILABLE',
  'FISCAL_REJECTED',
  'TERMINAL_DECLINED',
  'PRINTER_OFFLINE',
  'INVALID_REFUND_QUANTITY',
  'CREDIT_LIMIT_EXCEEDED',
  'PROMOTION_CONFLICT',
  'STOCK_WARN',
  'E_EXPIRED_STOCK',
] as const;

export const METHOD_NAMES = [
  'core.ping',
  'core.info',
  'state.get',
  'state.importLegacy',
  'product.list',
  'product.get',
  'product.create',
  'product.update',
  'product.delete',
  'product.importPreview',
  'product.importCommit',
  'barcode.resolve',
  'category.list',
  'warehouse.list',
  'warehouse.create',
  'warehouse.update',
  'inventory.getStock',
  'inventory.movements',
  'inventory.adjust',
  'inventory.transfer',
  'inventory.valuation',
  'inventory.lowStock',
  'sale.create',
  'sale.addItem',
  'sale.removeItem',
  'sale.setQuantity',
  'sale.applyDiscount',
  'sale.complete',
  'sale.get',
  'sale.list',
  'sale.hold',
  'sale.resume',
  'sale.listHeld',
  'sale.cancelHeld',
  'sale.discardDraft',
  'sale.overridePrice',
  'sale.receipt',
  'return.create',
  'return.partial',
  'purchase.create',
  'purchase.receive',
  'purchase.list',
  'cash.openSession',
  'cash.closeSession',
  'cash.currentSession',
  'cash.listRegisters',
  'cash.createRegister',
  'cash.cashIn',
  'cash.movements',
  'cash.cashOut',
  'cash.safeDrop',
  'cash.xReport',
  'cash.zClose',
  'auth.checkPermission',
  'auth.listPermissions',
  'auth.recordApproval',
  'stocktake.create',
  'stocktake.updateLine',
  'stocktake.setStatus',
  'stocktake.post',
  'stocktake.list',
  'stocktake.get',
  'customer.list',
  'customer.create',
  'customer.update',
  'customer.ledger',
  'customer.payDebt',
  'portal.finance',
  'supplier.ledger',
  'supplier.pay',
  'loyalty.earn',
  'loyalty.redeem',
  'loyalty.balance',
  'promo.list',
  'promo.upsert',
  'promo.evaluate',
  'lot.list',
  'lot.receive',
  'lot.expiryReport',
  'fiscal.enqueue',
  'fiscal.listPending',
  'fiscal.updateStatus',
  'fiscal.retry',
  'terminal.record',
  'report.dailySales',
  'report.inventory',
  'report.topProducts',
  'report.profit',
  'settings.get',
  'settings.set',
  'audit.list',
  'audit.append',
  'drawer.openLogged',
  'platform.syncStatus',
  'platform.priceScopes',
  'platform.eqaimeStatus',
  'platform.aggregatorStatus',
] as const;

export const METHOD_META: Record<MethodName, { description?: string }> = {
  'core.ping': { description: "Liveness check" },
  'core.info': { description: "Core version and db path" },
  'state.get': { description: "Full retail snapshot for UI hydration" },
  'state.importLegacy': { description: "One-shot import from legacy JSON snapshot" },
  'product.list': { description: undefined },
  'product.get': { description: undefined },
  'product.create': { description: undefined },
  'product.update': { description: undefined },
  'product.delete': { description: undefined },
  'product.importPreview': { description: undefined },
  'product.importCommit': { description: undefined },
  'barcode.resolve': { description: undefined },
  'category.list': { description: undefined },
  'warehouse.list': { description: undefined },
  'warehouse.create': { description: undefined },
  'warehouse.update': { description: undefined },
  'inventory.getStock': { description: undefined },
  'inventory.movements': { description: undefined },
  'inventory.adjust': { description: undefined },
  'inventory.transfer': { description: undefined },
  'inventory.valuation': { description: undefined },
  'inventory.lowStock': { description: undefined },
  'sale.create': { description: undefined },
  'sale.addItem': { description: undefined },
  'sale.removeItem': { description: undefined },
  'sale.setQuantity': { description: undefined },
  'sale.applyDiscount': { description: undefined },
  'sale.complete': { description: undefined },
  'sale.get': { description: undefined },
  'sale.list': { description: undefined },
  'sale.hold': { description: undefined },
  'sale.resume': { description: undefined },
  'sale.listHeld': { description: undefined },
  'sale.cancelHeld': { description: undefined },
  'sale.discardDraft': { description: undefined },
  'sale.overridePrice': { description: undefined },
  'sale.receipt': { description: undefined },
  'return.create': { description: undefined },
  'return.partial': { description: undefined },
  'purchase.create': { description: undefined },
  'purchase.receive': { description: undefined },
  'purchase.list': { description: undefined },
  'cash.openSession': { description: undefined },
  'cash.closeSession': { description: undefined },
  'cash.currentSession': { description: undefined },
  'cash.listRegisters': { description: undefined },
  'cash.createRegister': { description: undefined },
  'cash.cashIn': { description: undefined },
  'cash.movements': { description: undefined },
  'cash.cashOut': { description: undefined },
  'cash.safeDrop': { description: undefined },
  'cash.xReport': { description: undefined },
  'cash.zClose': { description: undefined },
  'auth.checkPermission': { description: undefined },
  'auth.listPermissions': { description: undefined },
  'auth.recordApproval': { description: undefined },
  'stocktake.create': { description: undefined },
  'stocktake.updateLine': { description: undefined },
  'stocktake.setStatus': { description: undefined },
  'stocktake.post': { description: undefined },
  'stocktake.list': { description: undefined },
  'stocktake.get': { description: undefined },
  'customer.list': { description: undefined },
  'customer.create': { description: undefined },
  'customer.update': { description: undefined },
  'customer.ledger': { description: undefined },
  'customer.payDebt': { description: undefined },
  'portal.finance': { description: undefined },
  'supplier.ledger': { description: undefined },
  'supplier.pay': { description: undefined },
  'loyalty.earn': { description: undefined },
  'loyalty.redeem': { description: undefined },
  'loyalty.balance': { description: undefined },
  'promo.list': { description: undefined },
  'promo.upsert': { description: undefined },
  'promo.evaluate': { description: undefined },
  'lot.list': { description: undefined },
  'lot.receive': { description: undefined },
  'lot.expiryReport': { description: undefined },
  'fiscal.enqueue': { description: undefined },
  'fiscal.listPending': { description: undefined },
  'fiscal.updateStatus': { description: undefined },
  'fiscal.retry': { description: undefined },
  'terminal.record': { description: undefined },
  'report.dailySales': { description: undefined },
  'report.inventory': { description: undefined },
  'report.topProducts': { description: undefined },
  'report.profit': { description: undefined },
  'settings.get': { description: undefined },
  'settings.set': { description: undefined },
  'audit.list': { description: undefined },
  'audit.append': { description: undefined },
  'drawer.openLogged': { description: undefined },
  'platform.syncStatus': { description: "Multi-branch sync metadata stub" },
  'platform.priceScopes': { description: "Branch/warehouse price scope stub" },
  'platform.eqaimeStatus': { description: "E-qaimə provider interface stub" },
  'platform.aggregatorStatus': { description: "Delivery aggregator provider stub" },
};
