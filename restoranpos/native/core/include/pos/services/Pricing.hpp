#pragma once

#include <string>

#include "pos/Common.hpp"

namespace pos::services {

/** Discount as configured on an order. */
struct Discount {
    std::string type;      // percent | amount | complimentary | (empty)
    std::int64_t value{};  // percent -> basis 0-100; amount -> minor units
};

struct TaxConfig {
    std::int64_t taxPercent = 18;
    std::int64_t servicePercent = 10;
    /** When true the menu price already contains tax and it is extracted, not added. */
    bool taxIncluded = false;
};

struct Totals {
    Money subtotal = 0;
    Money discount = 0;
    Money service = 0;
    Money tax = 0;
    /** Manual positive amount added after service and tax. */
    Money deposit = 0;
    Money total = 0;
};

/**
 * Rounds a percentage of a minor-unit amount to the nearest minor unit.
 *
 * Integer-only, half away from zero. Using a double here would reintroduce
 * exactly the representation error the minor-unit convention exists to avoid.
 */
Money percentOf(Money amount, std::int64_t percent);

/**
 * Computes a bill.
 *
 * Order of operations follows standard restaurant practice: the discount comes
 * off the subtotal first, service is charged on the discounted amount, and tax
 * applies to the discounted total including service.
 */
Totals computeTotals(Money subtotal, const Discount& discount, const TaxConfig& config);

/**
 * Amount (minor) discount on the subtotal that brings the final total as close
 * as possible to targetTotal. Returns 0 when the target is at/above the
 * undiscounted total.
 */
Money amountDiscountForTarget(Money subtotal, Money targetTotal, const TaxConfig& config);

/** Line total for a quantity of an item plus its per-unit modifier deltas. */
Money lineTotal(Money unitPrice, Money modifierDelta, std::int64_t quantity);

}  // namespace pos::services
