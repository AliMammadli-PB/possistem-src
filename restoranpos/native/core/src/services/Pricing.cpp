#include "pos/services/Pricing.hpp"

#include <algorithm>
#include <cstdlib>

namespace pos::services {

Money percentOf(Money amount, std::int64_t percent) {
    if (percent == 0 || amount == 0) return 0;

    // Half away from zero, computed entirely in integers:
    //   (|amount| * percent + 50) / 100, sign restored afterwards.
    const bool negative = (amount < 0) != (percent < 0);
    const std::int64_t magnitude = std::llabs(amount) * std::llabs(percent);
    const std::int64_t rounded = (magnitude + 50) / 100;
    return negative ? -rounded : rounded;
}

Money lineTotal(Money unitPrice, Money modifierDelta, std::int64_t quantity) {
    if (quantity <= 0) return 0;
    return (unitPrice + modifierDelta) * quantity;
}

Totals computeTotals(Money subtotal, const Discount& discount, const TaxConfig& config) {
    Totals totals;
    totals.subtotal = std::max<Money>(0, subtotal);

    if (discount.type == "complimentary") {
        totals.discount = totals.subtotal;
    } else if (discount.type == "percent") {
        const auto percent = std::clamp<std::int64_t>(discount.value, 0, 100);
        totals.discount = percentOf(totals.subtotal, percent);
    } else if (discount.type == "amount") {
        // A discount can never exceed the bill, or the till would owe the guest.
        totals.discount = std::clamp<Money>(discount.value, 0, totals.subtotal);
    }

    const Money net = totals.subtotal - totals.discount;

    totals.service = percentOf(net, config.servicePercent);

    if (config.taxIncluded) {
        // Menu prices already contain tax: extract rather than add, so the
        // guest-facing total stays exactly what the menu says.
        const Money gross = net + totals.service;
        totals.tax = gross - (gross * 100) / (100 + config.taxPercent);
        totals.total = gross;
    } else {
        totals.tax = percentOf(net + totals.service, config.taxPercent);
        totals.total = net + totals.service + totals.tax;
    }

    return totals;
}

Money amountDiscountForTarget(Money subtotal, Money targetTotal, const TaxConfig& config) {
    if (subtotal <= 0) return 0;
    const Money fullTotal = computeTotals(subtotal, Discount{"", 0}, config).total;
    if (targetTotal >= fullTotal) return 0;
    if (targetTotal <= 0) return subtotal;

    Money lo = 0;
    Money hi = subtotal;
    Money best = 0;
    while (lo <= hi) {
        const Money mid = lo + (hi - lo) / 2;
        const Money total = computeTotals(subtotal, Discount{"amount", mid}, config).total;
        if (total > targetTotal) {
            best = mid;
            lo = mid + 1;
        } else if (total < targetTotal) {
            hi = mid - 1;
        } else {
            return mid;
        }
    }

    // Prefer the discount that lands closest to the cashier's target.
    Money closest = best;
    Money closestDiff = std::llabs(computeTotals(subtotal, Discount{"amount", best}, config).total -
                                   targetTotal);
    for (Money candidate : {best - 1, best + 1}) {
        if (candidate < 0 || candidate > subtotal) continue;
        const Money diff =
            std::llabs(computeTotals(subtotal, Discount{"amount", candidate}, config).total -
                       targetTotal);
        if (diff < closestDiff) {
            closest = candidate;
            closestDiff = diff;
        }
    }
    return closest;
}

}  // namespace pos::services
