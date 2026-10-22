#pragma once
#include <cstdint>
#include <limits>
#include "market/Error.hpp"

namespace market {
// Integer minor units, rounded once per line. Splitting the product keeps
// valid monetary amounts from overflowing before the division.
inline std::int64_t roundedMoneyValue(std::int64_t priceMinor, std::int64_t quantity, std::int64_t scale = 1000) {
  if (priceMinor < 0 || quantity < 0 || scale < 1 || scale > 1000000000)
    throw PosError("E_VALIDATION", "Qiymət və miqdar düzgün deyil");
  const auto limit = std::numeric_limits<std::int64_t>::max();
  std::int64_t value = 0;
  const auto addProduct = [&](std::int64_t a, std::int64_t b) {
    if (b && a > (limit - value) / b)
      throw PosError("E_VALIDATION", "Məbləğ hesablama həddini aşır");
    value += a * b;
  };
  addProduct(quantity / scale, priceMinor);
  addProduct(quantity % scale, priceMinor / scale);
  addProduct(1, ((quantity % scale) * (priceMinor % scale) + scale / 2) / scale);
  return value;
}
} // namespace market
