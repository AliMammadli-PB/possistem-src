/**
 * AUTO-GENERATED from market-pos/shared/contracts/protocol.json - DO NOT EDIT.
 * Regenerate with: node scripts/gen-market-protocol.mjs
 */
#pragma once
#include <string_view>
namespace market::protocol {
inline constexpr int kVersion = 1;
namespace errors {
inline constexpr std::string_view UnknownMethod = "E_UNKNOWN_METHOD";
inline constexpr std::string_view Validation = "E_VALIDATION";
inline constexpr std::string_view NotFound = "E_NOT_FOUND";
inline constexpr std::string_view Db = "E_DB";
inline constexpr std::string_view DbUnsuitableLocation = "E_DB_UNSUITABLE_LOCATION";
inline constexpr std::string_view MigrationFailed = "E_MIGRATION_FAILED";
inline constexpr std::string_view InsufficientStock = "INSUFFICIENT_STOCK";
inline constexpr std::string_view RegisterClosed = "REGISTER_CLOSED";
inline constexpr std::string_view AlreadyRefunded = "E_ALREADY_REFUNDED";
inline constexpr std::string_view Conflict = "E_CONFLICT";
inline constexpr std::string_view Internal = "E_INTERNAL";
inline constexpr std::string_view PermissionDenied = "PERMISSION_DENIED";
inline constexpr std::string_view ManagerApprovalRequired = "MANAGER_APPROVAL_REQUIRED";
inline constexpr std::string_view ScaleBarcodeInvalid = "SCALE_BARCODE_INVALID";
inline constexpr std::string_view FiscalUnavailable = "FISCAL_UNAVAILABLE";
inline constexpr std::string_view FiscalRejected = "FISCAL_REJECTED";
inline constexpr std::string_view TerminalDeclined = "TERMINAL_DECLINED";
inline constexpr std::string_view PrinterOffline = "PRINTER_OFFLINE";
inline constexpr std::string_view InvalidRefundQuantity = "INVALID_REFUND_QUANTITY";
inline constexpr std::string_view CreditLimitExceeded = "CREDIT_LIMIT_EXCEEDED";
inline constexpr std::string_view PromotionConflict = "PROMOTION_CONFLICT";
inline constexpr std::string_view StockWarn = "STOCK_WARN";
inline constexpr std::string_view ExpiredStock = "E_EXPIRED_STOCK";
}  // namespace errors
inline constexpr std::string_view kMethods[] = {
  "core.ping",
  "core.info",
  "state.get",
  "state.importLegacy",
  "product.list",
  "product.get",
  "product.create",
  "product.update",
  "product.delete",
  "product.importPreview",
  "product.importCommit",
  "barcode.resolve",
  "category.list",
  "warehouse.list",
  "warehouse.create",
  "warehouse.update",
  "inventory.getStock",
  "inventory.movements",
  "inventory.adjust",
  "inventory.transfer",
  "inventory.valuation",
  "inventory.lowStock",
  "sale.create",
  "sale.addItem",
  "sale.removeItem",
  "sale.setQuantity",
  "sale.applyDiscount",
  "sale.complete",
  "sale.get",
  "sale.list",
  "sale.hold",
  "sale.resume",
  "sale.listHeld",
  "sale.cancelHeld",
  "sale.discardDraft",
  "sale.overridePrice",
  "sale.receipt",
  "return.create",
  "return.partial",
  "purchase.create",
  "purchase.receive",
  "purchase.list",
  "cash.openSession",
  "cash.closeSession",
  "cash.currentSession",
  "cash.listRegisters",
  "cash.createRegister",
  "cash.cashIn",
  "cash.movements",
  "cash.cashOut",
  "cash.safeDrop",
  "cash.xReport",
  "cash.zClose",
  "auth.checkPermission",
  "auth.listPermissions",
  "auth.recordApproval",
  "stocktake.create",
  "stocktake.updateLine",
  "stocktake.setStatus",
  "stocktake.post",
  "stocktake.list",
  "stocktake.get",
  "customer.list",
  "customer.create",
  "customer.update",
  "customer.ledger",
  "customer.payDebt",
  "portal.finance",
  "supplier.ledger",
  "supplier.pay",
  "loyalty.earn",
  "loyalty.redeem",
  "loyalty.balance",
  "promo.list",
  "promo.upsert",
  "promo.evaluate",
  "lot.list",
  "lot.receive",
  "lot.expiryReport",
  "fiscal.enqueue",
  "fiscal.listPending",
  "fiscal.updateStatus",
  "fiscal.retry",
  "terminal.record",
  "report.dailySales",
  "report.inventory",
  "report.topProducts",
  "report.profit",
  "settings.get",
  "settings.set",
  "audit.list",
  "audit.append",
  "drawer.openLogged",
  "platform.syncStatus",
  "platform.priceScopes",
  "platform.eqaimeStatus",
  "platform.aggregatorStatus",
};
inline constexpr std::size_t kMethodCount = 97;
}  // namespace market::protocol
