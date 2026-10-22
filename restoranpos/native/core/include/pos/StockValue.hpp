#pragma once

#include <limits>
#include "pos/Common.hpp"
#include "pos/Error.hpp"

namespace pos {

/** Value of signed thousandths at an integer qəpik price. Round half away
 * from zero once per product; splitting before multiplication avoids overflow. */
inline Money stockValueMinor(std::int64_t quantityMilli, Money unitPriceMinor) {
    if (unitPriceMinor < 0) throw PosError("VALIDATION", "Qiymət mənfi ola bilməz");
    const bool negative = quantityMilli < 0;
    const auto qty = negative ? static_cast<std::uint64_t>(-(quantityMilli + 1)) + 1
                              : static_cast<std::uint64_t>(quantityMilli);
    const auto price = static_cast<std::uint64_t>(unitPriceMinor);
    const auto limit = static_cast<std::uint64_t>(std::numeric_limits<Money>::max()) + (negative ? 1 : 0);
    std::uint64_t value = 0;
    const auto addProduct = [&](std::uint64_t a, std::uint64_t b) {
        if (b && a > (limit - value) / b) throw PosError("VALIDATION", "Qalıq dəyəri hesablama həddini aşır");
        value += a * b;
    };
    addProduct(qty / 1000, price);
    addProduct(qty % 1000, price / 1000);
    addProduct(1, ((qty % 1000) * (price % 1000) + 500) / 1000);
    if (negative && value == limit) return std::numeric_limits<Money>::min();
    return negative ? -static_cast<Money>(value) : static_cast<Money>(value);
}

inline Money stockValueSum(Money left, Money right) {
    if ((right > 0 && left > std::numeric_limits<Money>::max() - right) ||
        (right < 0 && left < std::numeric_limits<Money>::min() - right))
        throw PosError("VALIDATION", "Qalıq dəyəri hesablama həddini aşır");
    return left + right;
}
inline Money stockValueDifference(Money left, Money right) {
    if ((right > 0 && left < std::numeric_limits<Money>::min() + right) ||
        (right < 0 && left > std::numeric_limits<Money>::max() + right))
        throw PosError("VALIDATION", "Qalıq dəyəri hesablama həddini aşır");
    return left - right;
}

} // namespace pos
