#include "catch_amalgamated.hpp"

#include "pos/services/PaymentService.hpp"

using pos::services::isLegalPaymentTransition;
using PS = pos::services::PaymentStatus;

TEST_CASE("payment transition matrix — legal happy paths", "[payments]") {
    REQUIRE(isLegalPaymentTransition(PS::Created, PS::Approved));
    REQUIRE(isLegalPaymentTransition(PS::Created, PS::WaitingForTerminal));
    REQUIRE(isLegalPaymentTransition(PS::Created, PS::Canceled));
    REQUIRE(isLegalPaymentTransition(PS::Created, PS::Declined));

    REQUIRE(isLegalPaymentTransition(PS::WaitingForTerminal, PS::Processing));
    REQUIRE(isLegalPaymentTransition(PS::WaitingForTerminal, PS::Approved));
    REQUIRE(isLegalPaymentTransition(PS::WaitingForTerminal, PS::Declined));
    REQUIRE(isLegalPaymentTransition(PS::WaitingForTerminal, PS::Canceled));
    REQUIRE(isLegalPaymentTransition(PS::WaitingForTerminal, PS::Unknown));

    REQUIRE(isLegalPaymentTransition(PS::Processing, PS::Approved));
    REQUIRE(isLegalPaymentTransition(PS::Processing, PS::Declined));
    REQUIRE(isLegalPaymentTransition(PS::Processing, PS::Canceled));
    REQUIRE(isLegalPaymentTransition(PS::Processing, PS::Unknown));

    REQUIRE(isLegalPaymentTransition(PS::Unknown, PS::Approved));
    REQUIRE(isLegalPaymentTransition(PS::Unknown, PS::Declined));
    REQUIRE(isLegalPaymentTransition(PS::Unknown, PS::Canceled));
    REQUIRE(isLegalPaymentTransition(PS::Unknown, PS::Unknown));

    REQUIRE(isLegalPaymentTransition(PS::Approved, PS::Refunded));
    REQUIRE(isLegalPaymentTransition(PS::Approved, PS::Approved));
    REQUIRE(isLegalPaymentTransition(PS::Declined, PS::Declined));
}

TEST_CASE("payment transition matrix — illegal moves rejected", "[payments]") {
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Approved, PS::Declined));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Declined, PS::Approved));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Refunded, PS::Approved));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Canceled, PS::Approved));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Approved, PS::Created));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Unknown, PS::Created));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::WaitingForTerminal, PS::Refunded));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Processing, PS::Created));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Declined, PS::Refunded));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Created, PS::Unknown));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Created, PS::Processing));
    REQUIRE_FALSE(isLegalPaymentTransition(PS::Created, PS::Refunded));
}

TEST_CASE("exhaustive 8x8 matrix matches the legal set size", "[payments]") {
    constexpr PS all[] = {PS::Created,           PS::WaitingForTerminal, PS::Processing,
                          PS::Approved,          PS::Declined,           PS::Canceled,
                          PS::Unknown,           PS::Refunded};
    int legal = 0;
    for (auto from : all) {
        for (auto to : all) {
            if (isLegalPaymentTransition(from, to)) ++legal;
        }
    }
    // Keep in sync with kLegalTransitions in PaymentService.cpp (20 entries).
    REQUIRE(legal == 20);
}
