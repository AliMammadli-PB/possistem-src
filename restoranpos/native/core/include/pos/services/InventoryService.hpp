#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

/**
 * Stock, in a building that sells dishes but buys ingredients.
 *
 * Every change goes through `move()`, which writes one `stock_movements` row and
 * updates the `stock_levels` projection in the same transaction. Nothing else
 * touches `stock_levels`, so the ledger always explains the balance - which is
 * the only way a stocktake discrepancy can ever be investigated.
 *
 * Quantities are thousandths of the base unit, for the same reason money is
 * stored in minor units: 0.333 kg three times must be exactly 0.999 kg.
 */
/**
 * What a movement knows about the lot it creates or draws from.
 *
 * Goods coming in open a lot carrying these; goods going out are taken from
 * lots first-expiring-first-out unless `lotId` names the one to use.
 */
struct LotSpec {
    std::string lotNo;
    std::string producedOn;      // YYYY-MM-DD or ""
    std::string expiresOn;       // YYYY-MM-DD or ""
    std::string locationId;
    std::string purchaseId;
    std::string purchaseItemId;
    std::string lotId;           // in: adopt this (pending) lot; out: draw from it first
    std::string preferPurchaseId;  // out: this invoice's lots first (returns)
    Money unitCost = -1;         // in: landed cost; -1 = the ingredient's cost
    std::int64_t receivedAt = 0;  // in: keep the source lot's date on a transfer
};

class InventoryService {
public:
    explicit InventoryService(handlers::Context& ctx) : ctx_(ctx) {}

    /**
     * Applies a delta and records why. Negative takes stock out.
     *
     * Also keeps the lot breakdown (stock_lots) beneath the balance and, after
     * stock goes out, lets replenishment check whether to draft a purchase.
     * The result carries "lots": [{lotId, qtyMilli}] for what went out.
     */
    Json move(const std::string& ingredientId, const std::string& warehouseId,
              std::int64_t qtyDeltaMilli, std::string_view kind,
              const std::string& referenceId = "", std::string_view reason = "",
              const LotSpec& lot = LotSpec{}, bool allowArchived = false);

    /** Between stores, keeping each lot's dates, number and cost. */
    Json transfer(const std::string& ingredientId, const std::string& fromWarehouse,
                  const std::string& toWarehouse, std::int64_t qtyMilli, const std::string& referenceId);

    /**
     * Takes lots past their expiry date out of usable stock: each one's
     * quantity is written off the balance ("Vaxtı keçib") and the lot is
     * marked blocked, so nothing - a sale included - can draw from it again.
     * Empty ids widen the sweep to every ingredient / store. Returns how many
     * lots were blocked.
     */
    std::int64_t blockExpired(const std::string& ingredientId = "", const std::string& warehouseId = "");

    /** Moves (part of) a lot to another place in the same store; splits it if partial. */
    Json relocate(const std::string& lotId, const std::string& locationId, std::int64_t qtyMilli);

    /** average | fifo | last, from app_settings (default average). */
    std::string costingMethod();

    /**
     * SQL for one unit's cost of ingredient alias `i` under `method`. With a
     * non-empty warehouse placeholder the FIFO lot is looked up in that store.
     */
    static std::string unitCostSql(const std::string& method, const std::string& warehouseParam = "");

    /** Perpetual weighted average and last landed price after goods came in. */
    void recordReceiptCost(const std::string& ingredientId, std::int64_t qtyMilli, Money unitCost);

    /** Current balance of one ingredient in one place. */
    std::int64_t levelOf(const std::string& ingredientId, const std::string& warehouseId);

    /**
     * Depletes what an order's dishes consume, from the given store.
     *
     * Called when a bill is closed rather than when items are sent: a sent item
     * can still be voided, and stock that moved on a voided line has to be put
     * back, which is bookkeeping nobody would trust. Dishes with no recipe
     * simply consume nothing.
     *
     * Returns the movements written, so the caller can report what was used.
     */
    Json consumeForOrder(const std::string& orderId, const std::string& warehouseId);

    /**
     * The same, from the default store, and at most once per order.
     *
     * A bill closes by two roads - the last payment settling it, or the manual
     * Close button - and both must deplete stock. Each road calls this; the
     * second finds the order's sale movements already written and does nothing.
     */
    Json consumeOnClose(const std::string& orderId);

    /** Ingredients at or below their minimum, worst first. */
    Json lowStock();

    /** Balances for one warehouse, with the ingredient's own details. */
    Json levels(const std::string& warehouseId);

    /** Stock valued at each ingredient's cost. */
    Json valuation(const std::string& warehouseId, const std::string& method = "");

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
