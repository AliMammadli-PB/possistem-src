#include "catch_amalgamated.hpp"

#include "pos/services/Pricing.hpp"

using pos::services::Discount;
using pos::services::TaxConfig;
using pos::services::computeTotals;
using pos::services::lineTotal;
using pos::services::percentOf;

TEST_CASE("percentOf is integer-only and half-away-from-zero", "[pricing]") {
    REQUIRE(percentOf(10000, 18) == 1800);
    REQUIRE(percentOf(10000, 10) == 1000);
    REQUIRE(percentOf(1, 50) == 1);       // 0.5 → 1
    REQUIRE(percentOf(1, 49) == 0);       // 0.49 → 0
    REQUIRE(percentOf(0, 18) == 0);
    REQUIRE(percentOf(14500, 18) == 2610);
}

TEST_CASE("lineTotal multiplies unit + modifiers by quantity", "[pricing]") {
    REQUIRE(lineTotal(1000, 200, 2) == 2400);
    REQUIRE(lineTotal(1000, 0, 0) == 0);
    REQUIRE(lineTotal(500, -100, 3) == 1200);
}

TEST_CASE("computeTotals applies tax 18% and service 10% on net", "[pricing]") {
    TaxConfig cfg{18, 10, false};
    Discount none{"", 0};

    auto totals = computeTotals(10000, none, cfg);
    // service = 1000, tax on 11000 = 1980, total = 12980
    REQUIRE(totals.subtotal == 10000);
    REQUIRE(totals.discount == 0);
    REQUIRE(totals.service == 1000);
    REQUIRE(totals.tax == 1980);
    REQUIRE(totals.total == 12980);
}

TEST_CASE("percent discount reduces base before service and tax", "[pricing]") {
    TaxConfig cfg{18, 10, false};
    Discount ten{"percent", 10};

    auto totals = computeTotals(10000, ten, cfg);
    REQUIRE(totals.discount == 1000);
    REQUIRE(totals.service == 900);   // 10% of 9000
    REQUIRE(totals.tax == 1782);      // 18% of 9900
    REQUIRE(totals.total == 11682);   // 9000 + 900 + 1782
}

TEST_CASE("amount discount never exceeds subtotal", "[pricing]") {
    TaxConfig cfg{18, 10, false};
    Discount huge{"amount", 999999};
    auto totals = computeTotals(5000, huge, cfg);
    REQUIRE(totals.discount == 5000);
    REQUIRE(totals.total == 0);
}

TEST_CASE("tax-included extracts VAT instead of adding", "[pricing]") {
    TaxConfig cfg{18, 0, true};
    Discount none{"", 0};
    auto totals = computeTotals(11800, none, cfg);
    REQUIRE(totals.total == 11800);
    REQUIRE(totals.tax == 1800);
}

TEST_CASE("amountDiscountForTarget lands near the cashier target total", "[pricing]") {
    using pos::services::amountDiscountForTarget;
    TaxConfig cfg{18, 10, false};
    const auto full = computeTotals(10000, Discount{"", 0}, cfg).total;
    REQUIRE(full == 12980);

    const auto d = amountDiscountForTarget(10000, 12000, cfg);
    const auto landed = computeTotals(10000, Discount{"amount", d}, cfg).total;
    REQUIRE(std::llabs(landed - 12000) <= 2);
    REQUIRE(amountDiscountForTarget(10000, full, cfg) == 0);
    REQUIRE(amountDiscountForTarget(10000, 0, cfg) == 10000);
}
