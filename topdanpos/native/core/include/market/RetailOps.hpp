#pragma once
#include "market/db/Database.hpp"
#include "market/ipc/StdioServer.hpp"

namespace market {

/** Registers Phase 1–6 retail RPC handlers on the stdio server. */
void registerRetailHandlers(ipc::StdioServer& server, db::Database& db);

/** Stock policy: BLOCK_NEGATIVE_STOCK | ALLOW_NEGATIVE_STOCK | WARN_ONLY */
std::string stockPolicyOf(db::Database& db);

/**
 * The single stock mutation path: enforces the stocktake lock and the negative-stock
 * policy, writes the movement, and emits the replication event. Every stock change
 * must go through here — a second, non-emitting path silently desynchronises tills.
 */
void applySharedStockDelta(db::Database& db, const std::string& type, const std::string& productId,
                           const std::string& warehouseId, std::int64_t qtyDelta,
                           const std::string& refType, const std::string& refId,
                           const std::string& actorId, const std::string& note,
                           bool allowNegative = false, bool emitSync = true);

/**
 * Records the drawer effect of a refund as a `cash_out` movement.
 *
 * Session cash was previously derived from the `sales.refunded` flag, which
 * only covers a sale returned in full, and attributes it to the session the
 * ORIGINAL sale fell in. So a partial refund moved cash out of the drawer with
 * no effect on expected cash, and refunding a sale from an earlier session
 * never touched the current one — both showing up as an unexplained shortage
 * at Z. Refunds are now reconciled by when the refund happened, like every
 * other cash movement.
 *
 * Only the cash share of the refund is posted (a card refund goes back to the
 * card, not the drawer), prorated by the sale's cash portion.
 *
 * No-op when the cash share rounds to zero, or when the register has no open
 * session — cash sessions are optional here (a sale completes without one), so
 * a missing session must never fail a refund, and with no session there is
 * nothing to reconcile.
 */
void recordRefundCashOut(db::Database& db, const nlohmann::json& sale, std::int64_t refundTotalMinor,
                         const std::string& refundRef, const std::string& actorId);

bool roleHasPermission(db::Database& db, const std::string& role, const std::string& permission);

void requirePermission(db::Database& db, const nlohmann::json& payload, const std::string& permission);

/** Parse EAN-13 scale barcode using settings.scaleBarcodeRules. */
nlohmann::json resolveScaleBarcode(db::Database& db, const std::string& barcode);

}  // namespace market
