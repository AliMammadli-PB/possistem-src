#pragma once

#include <string>
#include <vector>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"
#include "pos/services/Pricing.hpp"

namespace pos::services {

/** A modifier chosen for a line, resolved against the catalogue. */
struct ResolvedModifier {
    std::string id;
    std::string groupId;
    std::string groupName;
    std::string name;
    Money priceDelta = 0;
};

/**
 * Order domain logic.
 *
 * Every rule that affects money or state lives here rather than in the UI:
 * the renderer's checks are for responsiveness only, and the core is the sole
 * authority on what an order is allowed to contain.
 */
class OrderService {
public:
    explicit OrderService(handlers::Context& ctx) : ctx_(ctx) {}

    /** Full order document including items and modifiers. */
    Json load(const std::string& orderId, bool withItems = true);

    /** Throws unless the order exists and may still be edited. */
    Json requireEditable(const std::string& orderId);

    /** Recomputes line totals and the bill; writes them back to the order row. */
    Totals recalculate(const std::string& orderId);

    /**
     * Resolves and validates a modifier selection for a product.
     *
     * Enforces required groups, min/max selection counts, and single-select
     * groups. Rejecting here rather than in the UI means a stale or tampered
     * client cannot create an unmakeable dish.
     */
    std::vector<ResolvedModifier> resolveModifiers(const std::string& productId,
                                                   const std::vector<std::string>& modifierIds);

    /** Human-facing order number, e.g. "A-0042". */
    std::string nextOrderNumber();

    void logEvent(const std::string& orderId, std::string_view event, Json data = Json::object());

    /** Derives a table's status from the state of its live order. */
    void refreshTableStatus(const std::string& tableId);

    TaxConfig taxConfig();

    /** The order currently open on a table, or empty. */
    std::string openOrderIdForTable(const std::string& tableId);

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
