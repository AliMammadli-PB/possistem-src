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
class InventoryService {
public:
    explicit InventoryService(handlers::Context& ctx) : ctx_(ctx) {}

    /** Applies a delta and records why. Negative takes stock out. */
    Json move(const std::string& ingredientId, const std::string& warehouseId,
              std::int64_t qtyDeltaMilli, std::string_view kind,
              const std::string& referenceId = "", std::string_view reason = "");

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
    Json valuation(const std::string& warehouseId);

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
