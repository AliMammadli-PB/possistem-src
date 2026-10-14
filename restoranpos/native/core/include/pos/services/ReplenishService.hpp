#pragma once

#include <string>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

/**
 * Automatic replenishment and what suppliers charge.
 *
 * When stock goes out and an ingredient falls to its minimum in a store
 * (counting what is already on order), a draft purchase is added for the
 * supplier that fits best - cheapest once lead time is weighed in, unless one
 * is marked preferred. Drafts are suggestions: nothing is ordered until a
 * person confirms them, and one shortage never produces a second draft.
 */
class ReplenishService {
public:
    explicit ReplenishService(handlers::Context& ctx) : ctx_(ctx) {}

    struct Rule {
        std::int64_t min = 0;
        std::int64_t target = 0;
        std::int64_t reorder = 0;
    };

    /** The store's own rule, else the ingredient's minimum in the main store. */
    Rule ruleFor(const std::string& ingredientId, const std::string& warehouseId);

    /** Still to arrive on drafts and open orders for this store. */
    std::int64_t onOrder(const std::string& ingredientId, const std::string& warehouseId);

    /** {supplierId, supplierName, priceMinor, leadDays, minOrderMilli, packMilli} or null. */
    Json suggestSupplier(const std::string& ingredientId);

    /** How much to order so the store reaches its target, rounded to the supplier's terms. */
    std::int64_t orderQty(const Rule& rule, std::int64_t level, std::int64_t open, const Json& supplier);

    /** Drafts a purchase line when the ingredient is short here. Never throws. */
    void check(const std::string& ingredientId, const std::string& warehouseId);

    /** Everything short right now (for one store, or all), with the suggestion. */
    Json suggestions(const std::string& warehouseId);

    /** Adds `qty` of an ingredient to the open automatic draft of that supplier and store. */
    std::string addToDraft(const std::string& supplierId, const std::string& warehouseId,
                           const std::string& ingredientId, std::int64_t qtyMilli, Money priceMinor);

    /** Remembers a price paid (supplier_items + history). */
    void notePrice(const std::string& supplierId, const std::string& ingredientId, Money priceMinor,
                   const std::string& purchaseId);

    /** After an invoice arrived in full, learns the supplier's real lead time. */
    void noteLeadTime(const std::string& purchaseId);

    /** The next A-00001 style number. */
    std::string nextPurchaseNumber();

    std::string defaultWarehouse();

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
