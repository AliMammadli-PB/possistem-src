// clang-format off
// AUTO-GENERATED from shared/contracts/protocol.json - DO NOT EDIT.
// Regenerate with: node scripts/gen-protocol.mjs
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <string_view>

namespace pos::protocol {

inline constexpr int kProtocolVersion = 1;

namespace limits {
inline constexpr std::int64_t kMaxMessageBytes = 8388608;
inline constexpr std::int64_t kMaxInboundQueue = 256;
inline constexpr std::int64_t kMaxPendingRequests = 200;
inline constexpr std::int64_t kDefaultTimeoutMs = 3000;
inline constexpr std::int64_t kHandshakeTimeoutMs = 10000;
inline constexpr std::int64_t kHeartbeatIntervalMs = 5000;
inline constexpr std::int64_t kHeartbeatTimeoutMs = 2000;
inline constexpr std::int64_t kHeartbeatMissLimit = 3;
inline constexpr std::int64_t kCoreStallKillMs = 90000;
inline constexpr std::int64_t kPrintTimeoutMs = 20000;
inline constexpr std::int64_t kPaymentTimeoutMs = 120000;
inline constexpr std::int64_t kTerminalTimeoutMs = 90000;
inline constexpr std::int64_t kTerminalAckTimeoutMs = 15000;
inline constexpr std::array<std::int64_t, 3> kRestartBackoffMs{500, 2000, 5000};
inline constexpr std::int64_t kCrashWindowMs = 60000;
inline constexpr std::int64_t kCrashStrikeLimit = 3;
}  // namespace limits

namespace err {
inline constexpr std::string_view kInternal = "E_INTERNAL";
inline constexpr std::string_view kInvalidRequest = "E_INVALID_REQUEST";
inline constexpr std::string_view kUnknownMethod = "E_UNKNOWN_METHOD";
inline constexpr std::string_view kProtocolVersion = "E_PROTOCOL_VERSION";
inline constexpr std::string_view kPayloadTooLarge = "E_PAYLOAD_TOO_LARGE";
inline constexpr std::string_view kQueueFull = "E_QUEUE_FULL";
inline constexpr std::string_view kTimeout = "E_TIMEOUT";
inline constexpr std::string_view kCanceled = "E_CANCELED";
inline constexpr std::string_view kCoreDown = "E_CORE_DOWN";
inline constexpr std::string_view kCoreUnavailable = "E_CORE_UNAVAILABLE";
inline constexpr std::string_view kCoreMissing = "E_CORE_MISSING";
inline constexpr std::string_view kCoreIncompatible = "E_CORE_INCOMPATIBLE";
inline constexpr std::string_view kCrashLoop = "E_CRASH_LOOP";
inline constexpr std::string_view kDbBusy = "E_DB_BUSY";
inline constexpr std::string_view kDbOpen = "E_DB_OPEN";
inline constexpr std::string_view kDbCorrupt = "E_DB_CORRUPT";
inline constexpr std::string_view kDbReadonly = "E_DB_READONLY";
inline constexpr std::string_view kDbUnsuitableLocation = "E_DB_UNSUITABLE_LOCATION";
inline constexpr std::string_view kDiskFull = "E_DISK_FULL";
inline constexpr std::string_view kConstraint = "E_CONSTRAINT";
inline constexpr std::string_view kMigrationFailed = "E_MIGRATION_FAILED";
inline constexpr std::string_view kValidation = "E_VALIDATION";
inline constexpr std::string_view kNotFound = "E_NOT_FOUND";
inline constexpr std::string_view kUnauthorized = "E_UNAUTHORIZED";
inline constexpr std::string_view kForbidden = "E_FORBIDDEN";
inline constexpr std::string_view kInvalidPin = "E_INVALID_PIN";
inline constexpr std::string_view kPinLocked = "E_PIN_LOCKED";
inline constexpr std::string_view kManagerApprovalRequired = "E_MANAGER_APPROVAL_REQUIRED";
inline constexpr std::string_view kIdempotencyKeyReuse = "E_IDEMPOTENCY_KEY_REUSE";
inline constexpr std::string_view kInProgress = "E_IN_PROGRESS";
inline constexpr std::string_view kOrderNotFound = "E_ORDER_NOT_FOUND";
inline constexpr std::string_view kOrderState = "E_ORDER_STATE";
inline constexpr std::string_view kOrderEmpty = "E_ORDER_EMPTY";
inline constexpr std::string_view kSoldOut = "E_SOLD_OUT";
inline constexpr std::string_view kModifierRequired = "E_MODIFIER_REQUIRED";
inline constexpr std::string_view kModifierLimit = "E_MODIFIER_LIMIT";
inline constexpr std::string_view kTableNotFound = "E_TABLE_NOT_FOUND";
inline constexpr std::string_view kTableOccupied = "E_TABLE_OCCUPIED";
inline constexpr std::string_view kTableState = "E_TABLE_STATE";
inline constexpr std::string_view kPaymentNotFound = "E_PAYMENT_NOT_FOUND";
inline constexpr std::string_view kPaymentState = "E_PAYMENT_STATE";
inline constexpr std::string_view kPaymentUnknownPending = "E_PAYMENT_UNKNOWN_PENDING";
inline constexpr std::string_view kInsufficientPayment = "E_INSUFFICIENT_PAYMENT";
inline constexpr std::string_view kOverpayment = "E_OVERPAYMENT";
inline constexpr std::string_view kPrinterUnavailable = "E_PRINTER_UNAVAILABLE";
inline constexpr std::string_view kPrintJobNotFound = "E_PRINT_JOB_NOT_FOUND";
inline constexpr std::string_view kShiftNotOpen = "E_SHIFT_NOT_OPEN";
inline constexpr std::string_view kShiftAlreadyOpen = "E_SHIFT_ALREADY_OPEN";
inline constexpr std::string_view kConflict = "E_CONFLICT";
inline constexpr std::string_view kStaleVersion = "E_STALE_VERSION";
inline constexpr std::string_view kBusinessDayClosed = "E_BUSINESS_DAY_CLOSED";
inline constexpr std::string_view kBusinessDayNotReady = "E_BUSINESS_DAY_NOT_READY";
inline constexpr std::string_view kLicenseRequired = "E_LICENSE_REQUIRED";
inline constexpr std::string_view kLicenseExpired = "E_LICENSE_EXPIRED";
inline constexpr std::string_view kLicenseRevoked = "E_LICENSE_REVOKED";
inline constexpr std::string_view kFeatureDisabled = "E_FEATURE_DISABLED";
inline constexpr std::string_view kGiftReviewRequired = "E_GIFT_REVIEW_REQUIRED";
inline constexpr std::string_view kRefundLimit = "E_REFUND_LIMIT";
}  // namespace err

struct ErrorMeta { std::string_view code; bool retryable; bool fatal; std::string_view message; };
inline constexpr std::array<ErrorMeta, 58> kErrorTable{{
    {"E_INTERNAL", false, false, "Internal core error"},
    {"E_INVALID_REQUEST", false, false, "Malformed request envelope"},
    {"E_UNKNOWN_METHOD", false, false, "Unknown method"},
    {"E_PROTOCOL_VERSION", false, false, "Protocol version mismatch"},
    {"E_PAYLOAD_TOO_LARGE", false, false, "Payload exceeds maximum message size"},
    {"E_QUEUE_FULL", true, false, "Core request queue is full"},
    {"E_TIMEOUT", true, false, "Request timed out"},
    {"E_CANCELED", false, false, "Request was canceled"},
    {"E_CORE_DOWN", true, false, "POS core process is not running"},
    {"E_CORE_UNAVAILABLE", true, false, "POS core is starting up"},
    {"E_CORE_MISSING", false, false, "POS core executable was not found"},
    {"E_CORE_INCOMPATIBLE", false, false, "POS core version is incompatible"},
    {"E_CRASH_LOOP", false, false, "POS core is crash looping"},
    {"E_DB_BUSY", true, false, "Database is busy"},
    {"E_DB_OPEN", false, false, "Database could not be opened"},
    {"E_DB_CORRUPT", false, true, "Database file is corrupt"},
    {"E_DB_READONLY", false, false, "Database is read only"},
    {"E_DB_UNSUITABLE_LOCATION", false, true, "Database location does not support WAL journaling"},
    {"E_DISK_FULL", false, false, "Disk is full"},
    {"E_CONSTRAINT", false, false, "Database constraint violation"},
    {"E_MIGRATION_FAILED", false, true, "Database migration failed"},
    {"E_VALIDATION", false, false, "Request payload failed validation"},
    {"E_NOT_FOUND", false, false, "Resource was not found"},
    {"E_UNAUTHORIZED", false, false, "Authentication required"},
    {"E_FORBIDDEN", false, false, "Insufficient permissions"},
    {"E_INVALID_PIN", false, false, "Incorrect PIN"},
    {"E_PIN_LOCKED", false, false, "Account locked after too many failed attempts"},
    {"E_MANAGER_APPROVAL_REQUIRED", false, false, "This action requires manager approval"},
    {"E_IDEMPOTENCY_KEY_REUSE", false, false, "Idempotency key reused with a different payload"},
    {"E_IN_PROGRESS", true, false, "An identical request is still in progress"},
    {"E_ORDER_NOT_FOUND", false, false, "Order was not found"},
    {"E_ORDER_STATE", false, false, "Operation is not valid for the current order state"},
    {"E_ORDER_EMPTY", false, false, "Order has no items"},
    {"E_SOLD_OUT", false, false, "Product is sold out"},
    {"E_MODIFIER_REQUIRED", false, false, "A required modifier group has no selection"},
    {"E_MODIFIER_LIMIT", false, false, "Modifier selection count is outside the allowed range"},
    {"E_TABLE_NOT_FOUND", false, false, "Table was not found"},
    {"E_TABLE_OCCUPIED", false, false, "Table already has an open order"},
    {"E_TABLE_STATE", false, false, "Operation is not valid for the current table state"},
    {"E_PAYMENT_NOT_FOUND", false, false, "Payment was not found"},
    {"E_PAYMENT_STATE", false, false, "Illegal payment state transition"},
    {"E_PAYMENT_UNKNOWN_PENDING", false, false, "Order has an unresolved payment that must be reconciled first"},
    {"E_INSUFFICIENT_PAYMENT", false, false, "Payments do not cover the order total"},
    {"E_OVERPAYMENT", false, false, "Payment exceeds the outstanding balance"},
    {"E_PRINTER_UNAVAILABLE", true, false, "Printer is unavailable"},
    {"E_PRINT_JOB_NOT_FOUND", false, false, "Print job was not found"},
    {"E_SHIFT_NOT_OPEN", false, false, "No shift is currently open"},
    {"E_SHIFT_ALREADY_OPEN", false, false, "A shift is already open on this terminal"},
    {"E_CONFLICT", false, false, "The operation conflicts with the current state"},
    {"E_STALE_VERSION", true, false, "Resource was modified by another operator; refresh and retry"},
    {"E_BUSINESS_DAY_CLOSED", false, false, "Business day is closed"},
    {"E_BUSINESS_DAY_NOT_READY", false, false, "Business day is not ready for Z close"},
    {"E_LICENSE_REQUIRED", false, false, "A valid license is required"},
    {"E_LICENSE_EXPIRED", false, false, "License has expired"},
    {"E_LICENSE_REVOKED", false, false, "License has been revoked"},
    {"E_FEATURE_DISABLED", false, false, "This feature is disabled by license flags"},
    {"E_GIFT_REVIEW_REQUIRED", false, false, "Gift selection requires manager review"},
    {"E_REFUND_LIMIT", false, false, "Refund exceeds remaining refundable amount"},
}};

inline const ErrorMeta* findError(std::string_view code) {
    for (const auto& e : kErrorTable) { if (e.code == code) return &e; }
    return nullptr;
}

inline bool isRetryable(std::string_view code) {
    const auto* m = findError(code); return m && m->retryable;
}

namespace method {
inline constexpr std::string_view kCorePing = "core.ping";
inline constexpr std::string_view kCoreInfo = "core.info";
inline constexpr std::string_view kCoreStats = "core.stats";
inline constexpr std::string_view kAuthListUsers = "auth.listUsers";
inline constexpr std::string_view kAuthLogin = "auth.login";
inline constexpr std::string_view kAuthLogout = "auth.logout";
inline constexpr std::string_view kAuthVerifyManagerPin = "auth.verifyManagerPin";
inline constexpr std::string_view kUsersCreate = "users.create";
inline constexpr std::string_view kUsersUpdate = "users.update";
inline constexpr std::string_view kPermissionsList = "permissions.list";
inline constexpr std::string_view kRolesList = "roles.list";
inline constexpr std::string_view kRolesSave = "roles.save";
inline constexpr std::string_view kRolesDelete = "roles.delete";
inline constexpr std::string_view kRolesApplyPolicy = "roles.applyPolicy";
inline constexpr std::string_view kUsersSetPin = "users.setPin";
inline constexpr std::string_view kUsersDeactivate = "users.deactivate";
inline constexpr std::string_view kUsersList = "users.list";
inline constexpr std::string_view kWarehousesList = "warehouses.list";
inline constexpr std::string_view kWarehousesSave = "warehouses.save";
inline constexpr std::string_view kIngredientsList = "ingredients.list";
inline constexpr std::string_view kIngredientsSave = "ingredients.save";
inline constexpr std::string_view kIngredientsDeactivate = "ingredients.deactivate";
inline constexpr std::string_view kInventoryLevels = "inventory.levels";
inline constexpr std::string_view kInventoryLowStock = "inventory.lowStock";
inline constexpr std::string_view kInventoryValuation = "inventory.valuation";
inline constexpr std::string_view kInventoryMovements = "inventory.movements";
inline constexpr std::string_view kInventoryAdjust = "inventory.adjust";
inline constexpr std::string_view kInventoryTransfer = "inventory.transfer";
inline constexpr std::string_view kInventoryWaste = "inventory.waste";
inline constexpr std::string_view kRecipesGet = "recipes.get";
inline constexpr std::string_view kRecipesSave = "recipes.save";
inline constexpr std::string_view kStocktakeCreate = "stocktake.create";
inline constexpr std::string_view kStocktakeGet = "stocktake.get";
inline constexpr std::string_view kStocktakeList = "stocktake.list";
inline constexpr std::string_view kStocktakeCount = "stocktake.count";
inline constexpr std::string_view kStocktakePost = "stocktake.post";
inline constexpr std::string_view kSuppliersList = "suppliers.list";
inline constexpr std::string_view kSuppliersSave = "suppliers.save";
inline constexpr std::string_view kSuppliersLedger = "suppliers.ledger";
inline constexpr std::string_view kSuppliersPayments = "suppliers.payments";
inline constexpr std::string_view kSuppliersPay = "suppliers.pay";
inline constexpr std::string_view kPurchasesList = "purchases.list";
inline constexpr std::string_view kPurchasesGet = "purchases.get";
inline constexpr std::string_view kPurchasesSave = "purchases.save";
inline constexpr std::string_view kPurchasesReceive = "purchases.receive";
inline constexpr std::string_view kCustomersList = "customers.list";
inline constexpr std::string_view kCustomersGet = "customers.get";
inline constexpr std::string_view kCustomersSave = "customers.save";
inline constexpr std::string_view kCustomersDeactivate = "customers.deactivate";
inline constexpr std::string_view kCustomersLedger = "customers.ledger";
inline constexpr std::string_view kCustomersPayments = "customers.payments";
inline constexpr std::string_view kCustomersCharge = "customers.charge";
inline constexpr std::string_view kCustomersPayDebt = "customers.payDebt";
inline constexpr std::string_view kLoyaltyEarn = "loyalty.earn";
inline constexpr std::string_view kLoyaltyRedeem = "loyalty.redeem";
inline constexpr std::string_view kLoyaltyLedger = "loyalty.ledger";
inline constexpr std::string_view kReservationsList = "reservations.list";
inline constexpr std::string_view kReservationsSave = "reservations.save";
inline constexpr std::string_view kReservationsSetStatus = "reservations.setStatus";
inline constexpr std::string_view kReservationsSeat = "reservations.seat";
inline constexpr std::string_view kCouriersList = "couriers.list";
inline constexpr std::string_view kCouriersSave = "couriers.save";
inline constexpr std::string_view kDeliveryList = "delivery.list";
inline constexpr std::string_view kDeliveryCreate = "delivery.create";
inline constexpr std::string_view kDeliveryAssign = "delivery.assign";
inline constexpr std::string_view kDeliverySetStatus = "delivery.setStatus";
inline constexpr std::string_view kDeliveryCourierReport = "delivery.courierReport";
inline constexpr std::string_view kScheduleList = "schedule.list";
inline constexpr std::string_view kScheduleSave = "schedule.save";
inline constexpr std::string_view kScheduleRemove = "schedule.remove";
inline constexpr std::string_view kAttendanceClockIn = "attendance.clockIn";
inline constexpr std::string_view kAttendanceClockOut = "attendance.clockOut";
inline constexpr std::string_view kAttendanceList = "attendance.list";
inline constexpr std::string_view kReportsCosting = "reports.costing";
inline constexpr std::string_view kReportsExport = "reports.export";
inline constexpr std::string_view kCatalogCategories = "catalog.categories";
inline constexpr std::string_view kCatalogProducts = "catalog.products";
inline constexpr std::string_view kCatalogProduct = "catalog.product";
inline constexpr std::string_view kCatalogModifierGroups = "catalog.modifierGroups";
inline constexpr std::string_view kCatalogSetAvailability = "catalog.setAvailability";
inline constexpr std::string_view kTablesList = "tables.list";
inline constexpr std::string_view kTablesGet = "tables.get";
inline constexpr std::string_view kTablesSetStatus = "tables.setStatus";
inline constexpr std::string_view kTablesTransfer = "tables.transfer";
inline constexpr std::string_view kTablesMerge = "tables.merge";
inline constexpr std::string_view kTablesSplit = "tables.split";
inline constexpr std::string_view kOrdersCreate = "orders.create";
inline constexpr std::string_view kOrdersGet = "orders.get";
inline constexpr std::string_view kOrdersList = "orders.list";
inline constexpr std::string_view kOrdersAddItem = "orders.addItem";
inline constexpr std::string_view kOrdersUpdateItemQuantity = "orders.updateItemQuantity";
inline constexpr std::string_view kOrdersSetItemNote = "orders.setItemNote";
inline constexpr std::string_view kOrdersSetItemSeat = "orders.setItemSeat";
inline constexpr std::string_view kOrdersSetItemCourse = "orders.setItemCourse";
inline constexpr std::string_view kOrdersHoldItem = "orders.holdItem";
inline constexpr std::string_view kOrdersRemoveItem = "orders.removeItem";
inline constexpr std::string_view kOrdersVoidItem = "orders.voidItem";
inline constexpr std::string_view kOrdersApplyDiscount = "orders.applyDiscount";
inline constexpr std::string_view kOrdersSetDeposit = "orders.setDeposit";
inline constexpr std::string_view kOrdersSetGuestCount = "orders.setGuestCount";
inline constexpr std::string_view kOrdersSubmit = "orders.submit";
inline constexpr std::string_view kOrdersClose = "orders.close";
inline constexpr std::string_view kOrdersVoid = "orders.void";
inline constexpr std::string_view kKdsList = "kds.list";
inline constexpr std::string_view kKdsSetStatus = "kds.setStatus";
inline constexpr std::string_view kKdsBump = "kds.bump";
inline constexpr std::string_view kPaymentsList = "payments.list";
inline constexpr std::string_view kPaymentsGet = "payments.get";
inline constexpr std::string_view kPaymentsCreateCash = "payments.createCash";
inline constexpr std::string_view kPaymentsCreateCard = "payments.createCard";
inline constexpr std::string_view kPaymentsCancel = "payments.cancel";
inline constexpr std::string_view kPaymentsReconcile = "payments.reconcile";
inline constexpr std::string_view kPaymentsRefund = "payments.refund";
inline constexpr std::string_view kPaymentsUnresolved = "payments.unresolved";
inline constexpr std::string_view kPaymentsSimulate = "payments.simulate";
inline constexpr std::string_view kReceiptsPreview = "receipts.preview";
inline constexpr std::string_view kReceiptsGet = "receipts.get";
inline constexpr std::string_view kReceiptsLookupByCode = "receipts.lookupByCode";
inline constexpr std::string_view kPrintEnqueue = "print.enqueue";
inline constexpr std::string_view kPrintJobs = "print.jobs";
inline constexpr std::string_view kPrintRetry = "print.retry";
inline constexpr std::string_view kPrintCancel = "print.cancel";
inline constexpr std::string_view kPrintPrinters = "print.printers";
inline constexpr std::string_view kPrintDetect = "print.detect";
inline constexpr std::string_view kPrintSetPrinter = "print.setPrinter";
inline constexpr std::string_view kPrintPreviewTest = "print.previewTest";
inline constexpr std::string_view kReceiptLogoApply = "receiptLogo.apply";
inline constexpr std::string_view kReceiptLogoClear = "receiptLogo.clear";
inline constexpr std::string_view kShiftsCurrent = "shifts.current";
inline constexpr std::string_view kShiftsOpen = "shifts.open";
inline constexpr std::string_view kShiftsClose = "shifts.close";
inline constexpr std::string_view kSettingsGetAll = "settings.getAll";
inline constexpr std::string_view kSettingsSet = "settings.set";
inline constexpr std::string_view kSettingsApplyProvisionedIdentity = "settings.applyProvisionedIdentity";
inline constexpr std::string_view kAuditList = "audit.list";
inline constexpr std::string_view kAuditPending = "audit.pending";
inline constexpr std::string_view kAuditAck = "audit.ack";
inline constexpr std::string_view kReportsDashboard = "reports.dashboard";
inline constexpr std::string_view kReportsTopProducts = "reports.topProducts";
inline constexpr std::string_view kReportsSalesSummary = "reports.salesSummary";
inline constexpr std::string_view kReportsPeriod = "reports.period";
inline constexpr std::string_view kReportsRemotePeriod = "reports.remotePeriod";
inline constexpr std::string_view kReportsX = "reports.x";
inline constexpr std::string_view kReportsZ = "reports.z";
inline constexpr std::string_view kReportsList = "reports.list";
inline constexpr std::string_view kReportsGetSnapshot = "reports.getSnapshot";
inline constexpr std::string_view kBusinessDayCurrent = "businessDay.current";
inline constexpr std::string_view kBusinessDayOpen = "businessDay.open";
inline constexpr std::string_view kBusinessDayReadiness = "businessDay.readiness";
inline constexpr std::string_view kBusinessDayClose = "businessDay.close";
inline constexpr std::string_view kTablesPreviewTransfer = "tables.previewTransfer";
inline constexpr std::string_view kTablesSwap = "tables.swap";
inline constexpr std::string_view kTablesTransferItems = "tables.transferItems";
inline constexpr std::string_view kTablesUpdateLayout = "tables.updateLayout";
inline constexpr std::string_view kTablesUpsertArea = "tables.upsertArea";
inline constexpr std::string_view kTablesArchiveArea = "tables.archiveArea";
inline constexpr std::string_view kTablesUpsertTable = "tables.upsertTable";
inline constexpr std::string_view kTablesArchiveTable = "tables.archiveTable";
inline constexpr std::string_view kCatalogUpsertCategory = "catalog.upsertCategory";
inline constexpr std::string_view kCatalogArchiveCategory = "catalog.archiveCategory";
inline constexpr std::string_view kCatalogUpsertProduct = "catalog.upsertProduct";
inline constexpr std::string_view kCatalogArchiveProduct = "catalog.archiveProduct";
inline constexpr std::string_view kCatalogSetSoldOut = "catalog.setSoldOut";
inline constexpr std::string_view kCatalogSetImageHidden = "catalog.setImageHidden";
inline constexpr std::string_view kCatalogSetAllImagesHidden = "catalog.setAllImagesHidden";
inline constexpr std::string_view kCatalogPriceHistory = "catalog.priceHistory";
inline constexpr std::string_view kCatalogUpsertModifierGroup = "catalog.upsertModifierGroup";
inline constexpr std::string_view kCatalogUpsertModifier = "catalog.upsertModifier";
inline constexpr std::string_view kCatalogArchiveModifier = "catalog.archiveModifier";
inline constexpr std::string_view kCatalogSetProductModifierGroups = "catalog.setProductModifierGroups";
inline constexpr std::string_view kCatalogImportPreview = "catalog.importPreview";
inline constexpr std::string_view kCatalogImportCommit = "catalog.importCommit";
inline constexpr std::string_view kCatalogExport = "catalog.export";
inline constexpr std::string_view kGiftsListCampaigns = "gifts.listCampaigns";
inline constexpr std::string_view kGiftsUpsertCampaign = "gifts.upsertCampaign";
inline constexpr std::string_view kGiftsEvaluateOrder = "gifts.evaluateOrder";
inline constexpr std::string_view kGiftsApply = "gifts.apply";
inline constexpr std::string_view kGiftsApproveReview = "gifts.approveReview";
inline constexpr std::string_view kCashList = "cash.list";
inline constexpr std::string_view kCashMovement = "cash.movement";
inline constexpr std::string_view kPaymentsCreateMixed = "payments.createMixed";
inline constexpr std::string_view kPaymentsSplitBill = "payments.splitBill";
inline constexpr std::string_view kPaymentsListRefunds = "payments.listRefunds";
inline constexpr std::string_view kLicenseStatus = "license.status";
inline constexpr std::string_view kLicenseActivate = "license.activate";
inline constexpr std::string_view kLicenseImportOffline = "license.importOffline";
inline constexpr std::string_view kLicenseExportOfflineRequest = "license.exportOfflineRequest";
inline constexpr std::string_view kLicenseHeartbeat = "license.heartbeat";
inline constexpr std::string_view kLicenseLookup = "license.lookup";
inline constexpr std::string_view kTenantStatus = "tenant.status";
inline constexpr std::string_view kTenantLogin = "tenant.login";
inline constexpr std::string_view kTenantLogout = "tenant.logout";
inline constexpr std::string_view kTenantOpenPaymentUrl = "tenant.openPaymentUrl";
inline constexpr std::string_view kWhatsappGet = "whatsapp.get";
inline constexpr std::string_view kWhatsappSave = "whatsapp.save";
inline constexpr std::string_view kWhatsappConnect = "whatsapp.connect";
inline constexpr std::string_view kWhatsappStatus = "whatsapp.status";
inline constexpr std::string_view kWhatsappDisconnect = "whatsapp.disconnect";
inline constexpr std::string_view kWhatsappTest = "whatsapp.test";
inline constexpr std::string_view kBackupCreate = "backup.create";
inline constexpr std::string_view kBackupList = "backup.list";
inline constexpr std::string_view kBackupRestorePreview = "backup.restorePreview";
inline constexpr std::string_view kBackupRestore = "backup.restore";
inline constexpr std::string_view kSystemResetOperational = "system.resetOperational";
inline constexpr std::string_view kSyncStatus = "sync.status";
inline constexpr std::string_view kSyncOutbox = "sync.outbox";
}  // namespace method

namespace event {
inline constexpr std::string_view kCoreReady = "core.ready";
inline constexpr std::string_view kCoreStage = "core.stage";
inline constexpr std::string_view kCoreAlert = "core.alert";
inline constexpr std::string_view kCoreFatal = "core.fatal";
inline constexpr std::string_view kKdsUpdated = "kds.updated";
inline constexpr std::string_view kTablesUpdated = "tables.updated";
inline constexpr std::string_view kOrdersUpdated = "orders.updated";
inline constexpr std::string_view kPrintUpdated = "print.updated";
inline constexpr std::string_view kPaymentNeedsReconciliation = "payment.needsReconciliation";
inline constexpr std::string_view kReportsCreated = "reports.created";
}  // namespace event

enum class Role : std::uint8_t {
    Waiter,
    Cashier,
    Kitchen,
    Supervisor,
    Manager,
    Administrator,
};

inline constexpr std::array<std::string_view, 6> kRoleNames{{
    "waiter", "cashier", "kitchen", "supervisor", "manager", "administrator"
}};

inline std::string_view toString(Role v) {
    return kRoleNames[static_cast<std::size_t>(v)];
}

inline bool parseRole(std::string_view s, Role& out) {
    for (std::size_t i = 0; i < kRoleNames.size(); ++i) {
        if (kRoleNames[i] == s) { out = static_cast<Role>(i); return true; }
    }
    return false;
}

enum class TableStatus : std::uint8_t {
    Available,
    Occupied,
    Reserved,
    Waiting,
    Ordering,
    Preparing,
    Ready,
    PaymentRequested,
    Cleaning,
};

inline constexpr std::array<std::string_view, 9> kTableStatusNames{{
    "available", "occupied", "reserved", "waiting", "ordering", "preparing", "ready", "payment_requested", "cleaning"
}};

inline std::string_view toString(TableStatus v) {
    return kTableStatusNames[static_cast<std::size_t>(v)];
}

inline bool parseTableStatus(std::string_view s, TableStatus& out) {
    for (std::size_t i = 0; i < kTableStatusNames.size(); ++i) {
        if (kTableStatusNames[i] == s) { out = static_cast<TableStatus>(i); return true; }
    }
    return false;
}

enum class OrderStatus : std::uint8_t {
    Draft,
    Open,
    Sent,
    PartiallyPaid,
    Paid,
    Closed,
    Voided,
};

inline constexpr std::array<std::string_view, 7> kOrderStatusNames{{
    "draft", "open", "sent", "partially_paid", "paid", "closed", "voided"
}};

inline std::string_view toString(OrderStatus v) {
    return kOrderStatusNames[static_cast<std::size_t>(v)];
}

inline bool parseOrderStatus(std::string_view s, OrderStatus& out) {
    for (std::size_t i = 0; i < kOrderStatusNames.size(); ++i) {
        if (kOrderStatusNames[i] == s) { out = static_cast<OrderStatus>(i); return true; }
    }
    return false;
}

enum class OrderItemStatus : std::uint8_t {
    Draft,
    Sent,
    Preparing,
    Ready,
    Served,
    Voided,
    Held,
};

inline constexpr std::array<std::string_view, 7> kOrderItemStatusNames{{
    "draft", "sent", "preparing", "ready", "served", "voided", "held"
}};

inline std::string_view toString(OrderItemStatus v) {
    return kOrderItemStatusNames[static_cast<std::size_t>(v)];
}

inline bool parseOrderItemStatus(std::string_view s, OrderItemStatus& out) {
    for (std::size_t i = 0; i < kOrderItemStatusNames.size(); ++i) {
        if (kOrderItemStatusNames[i] == s) { out = static_cast<OrderItemStatus>(i); return true; }
    }
    return false;
}

enum class KitchenStatus : std::uint8_t {
    New,
    Accepted,
    Preparing,
    Ready,
    Completed,
};

inline constexpr std::array<std::string_view, 5> kKitchenStatusNames{{
    "new", "accepted", "preparing", "ready", "completed"
}};

inline std::string_view toString(KitchenStatus v) {
    return kKitchenStatusNames[static_cast<std::size_t>(v)];
}

inline bool parseKitchenStatus(std::string_view s, KitchenStatus& out) {
    for (std::size_t i = 0; i < kKitchenStatusNames.size(); ++i) {
        if (kKitchenStatusNames[i] == s) { out = static_cast<KitchenStatus>(i); return true; }
    }
    return false;
}

enum class PaymentStatus : std::uint8_t {
    Created,
    WaitingForTerminal,
    Processing,
    Approved,
    Declined,
    Canceled,
    Unknown,
    Refunded,
};

inline constexpr std::array<std::string_view, 8> kPaymentStatusNames{{
    "created", "waiting_for_terminal", "processing", "approved", "declined", "canceled", "unknown", "refunded"
}};

inline std::string_view toString(PaymentStatus v) {
    return kPaymentStatusNames[static_cast<std::size_t>(v)];
}

inline bool parsePaymentStatus(std::string_view s, PaymentStatus& out) {
    for (std::size_t i = 0; i < kPaymentStatusNames.size(); ++i) {
        if (kPaymentStatusNames[i] == s) { out = static_cast<PaymentStatus>(i); return true; }
    }
    return false;
}

enum class PaymentMethod : std::uint8_t {
    Cash,
    Card,
    Mixed,
    Complimentary,
};

inline constexpr std::array<std::string_view, 4> kPaymentMethodNames{{
    "cash", "card", "mixed", "complimentary"
}};

inline std::string_view toString(PaymentMethod v) {
    return kPaymentMethodNames[static_cast<std::size_t>(v)];
}

inline bool parsePaymentMethod(std::string_view s, PaymentMethod& out) {
    for (std::size_t i = 0; i < kPaymentMethodNames.size(); ++i) {
        if (kPaymentMethodNames[i] == s) { out = static_cast<PaymentMethod>(i); return true; }
    }
    return false;
}

enum class PrintJobStatus : std::uint8_t {
    Queued,
    Processing,
    Sent,
    Failed,
    Retrying,
    Completed,
};

inline constexpr std::array<std::string_view, 6> kPrintJobStatusNames{{
    "queued", "processing", "sent", "failed", "retrying", "completed"
}};

inline std::string_view toString(PrintJobStatus v) {
    return kPrintJobStatusNames[static_cast<std::size_t>(v)];
}

inline bool parsePrintJobStatus(std::string_view s, PrintJobStatus& out) {
    for (std::size_t i = 0; i < kPrintJobStatusNames.size(); ++i) {
        if (kPrintJobStatusNames[i] == s) { out = static_cast<PrintJobStatus>(i); return true; }
    }
    return false;
}

enum class PrintJobKind : std::uint8_t {
    KitchenTicket,
    CustomerBill,
    CustomerReceipt,
    ShiftReport,
    TestPage,
    XReport,
    ZReport,
    RefundReceipt,
    WarehouseSlip,
    PeriodReport,
};

inline constexpr std::array<std::string_view, 10> kPrintJobKindNames{{
    "kitchen_ticket", "customer_bill", "customer_receipt", "shift_report", "test_page", "x_report", "z_report", "refund_receipt", "warehouse_slip", "period_report"
}};

inline std::string_view toString(PrintJobKind v) {
    return kPrintJobKindNames[static_cast<std::size_t>(v)];
}

inline bool parsePrintJobKind(std::string_view s, PrintJobKind& out) {
    for (std::size_t i = 0; i < kPrintJobKindNames.size(); ++i) {
        if (kPrintJobKindNames[i] == s) { out = static_cast<PrintJobKind>(i); return true; }
    }
    return false;
}

enum class CoreState : std::uint8_t {
    Idle,
    Spawning,
    Handshaking,
    Ready,
    Restarting,
    CrashLoop,
    CoreMissing,
    Incompatible,
    Stopping,
    Stopped,
};

inline constexpr std::array<std::string_view, 10> kCoreStateNames{{
    "idle", "spawning", "handshaking", "ready", "restarting", "crash_loop", "core_missing", "incompatible", "stopping", "stopped"
}};

inline std::string_view toString(CoreState v) {
    return kCoreStateNames[static_cast<std::size_t>(v)];
}

inline bool parseCoreState(std::string_view s, CoreState& out) {
    for (std::size_t i = 0; i < kCoreStateNames.size(); ++i) {
        if (kCoreStateNames[i] == s) { out = static_cast<CoreState>(i); return true; }
    }
    return false;
}

enum class DiscountType : std::uint8_t {
    Percent,
    Amount,
    Complimentary,
};

inline constexpr std::array<std::string_view, 3> kDiscountTypeNames{{
    "percent", "amount", "complimentary"
}};

inline std::string_view toString(DiscountType v) {
    return kDiscountTypeNames[static_cast<std::size_t>(v)];
}

inline bool parseDiscountType(std::string_view s, DiscountType& out) {
    for (std::size_t i = 0; i < kDiscountTypeNames.size(); ++i) {
        if (kDiscountTypeNames[i] == s) { out = static_cast<DiscountType>(i); return true; }
    }
    return false;
}

enum class Course : std::uint8_t {
    Starter,
    Main,
    Dessert,
    Drinks,
};

inline constexpr std::array<std::string_view, 4> kCourseNames{{
    "starter", "main", "dessert", "drinks"
}};

inline std::string_view toString(Course v) {
    return kCourseNames[static_cast<std::size_t>(v)];
}

inline bool parseCourse(std::string_view s, Course& out) {
    for (std::size_t i = 0; i < kCourseNames.size(); ++i) {
        if (kCourseNames[i] == s) { out = static_cast<Course>(i); return true; }
    }
    return false;
}

}  // namespace pos::protocol
// clang-format on
