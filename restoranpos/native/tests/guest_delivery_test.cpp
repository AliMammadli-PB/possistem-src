#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

/**
 * Guests, bookings, deliveries and the rota.
 *
 * Debt and points are ledgers with a projection on the customer row: every
 * change writes a row explaining itself, and the balance is derived from those
 * rows rather than edited directly.
 */
namespace {

class GuestFixture {
public:
    GuestFixture() {
        pos::handlers::registerGuests(fixture_.contextPtr());
        pos::handlers::registerDelivery(fixture_.contextPtr());
    }

    pos::Json call(std::string_view method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(method);
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string makeCustomer(const char* name = "Araz Məmmədov") {
        return call(pos::protocol::method::kCustomersSave,
                    pos::Json{{"name", name}, {"phone", "+994501112233"}})
            .at("id")
            .get<std::string>();
    }

    /** A bare open order, which is all a delivery needs to hang off. */
    std::string makeOrder(const char* number) {
        const auto now = pos::nowMs();
        const std::string orderId = pos::crypto::uuid4();
        auto order = fixture_.db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
            "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
            "  opened_at, updated_at, row_version) "
            "VALUES (:id, :num, 'usr-admin', 'open', 1, 4000,0,0,0, 4000, 0,0, :now, :now, 1)");
        order.bind(":id", orderId).bind(":num", std::string(number)).bind(":now", now);
        order.exec();
        return orderId;
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("a house account charge becomes debt, and paying clears it",
          "[guests][debt][money]") {
    GuestFixture f;
    const auto customer = f.makeCustomer();

    f.call(pos::protocol::method::kCustomersCharge,
           pos::Json{{"customerId", customer}, {"amountMinor", 12000}});
    f.call(pos::protocol::method::kCustomersCharge,
           pos::Json{{"customerId", customer}, {"amountMinor", 3000}});

    auto ledger = f.call(pos::protocol::method::kCustomersLedger,
                         pos::Json{{"customerId", customer}});
    REQUIRE(ledger.at("debtMinor") == 15000);

    const pos::Json payment{{"customerId", customer}, {"amountMinor", 15000},
                            {"idempotencyKey", "portal-customer-payment-test"}};
    f.call(pos::protocol::method::kCustomersPayDebt, payment);
    f.call(pos::protocol::method::kCustomersPayDebt, payment);

    ledger = f.call(pos::protocol::method::kCustomersLedger, pos::Json{{"customerId", customer}});
    REQUIRE(ledger.at("debtMinor") == 0);
    // Three ledger rows, not an edited balance: the history has to survive.
    REQUIRE(ledger.at("entries").size() == 3);
    const auto payments = f.call(pos::protocol::method::kCustomersPayments, pos::Json::object());
    REQUIRE(payments.at("payments").size() == 1);
}

TEST_CASE("a guest who still owes money cannot be filed away", "[guests][debt]") {
    GuestFixture f;
    const auto customer = f.makeCustomer();
    f.call(pos::protocol::method::kCustomersCharge,
           pos::Json{{"customerId", customer}, {"amountMinor", 5000}});

    // Archiving would hide the debt from every list that reads active guests.
    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kCustomersDeactivate,
                             pos::Json{{"customerId", customer}}),
                      pos::PosError);

    f.call(pos::protocol::method::kCustomersPayDebt,
           pos::Json{{"customerId", customer}, {"amountMinor", 5000}});
    f.call(pos::protocol::method::kCustomersDeactivate, pos::Json{{"customerId", customer}});
}

TEST_CASE("points are earned from a bill and cannot be overspent", "[guests][loyalty]") {
    GuestFixture f;
    const auto customer = f.makeCustomer();

    // 100.00 spent at the default one point per major unit.
    const auto earned = f.call(pos::protocol::method::kLoyaltyEarn,
                               pos::Json{{"customerId", customer}, {"spentMinor", 10000}});
    REQUIRE(earned.at("points") == 100);
    REQUIRE(earned.at("balance") == 100);

    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kLoyaltyRedeem,
                             pos::Json{{"customerId", customer}, {"points", 150}}),
                      pos::PosError);

    const auto redeemed = f.call(pos::protocol::method::kLoyaltyRedeem,
                                 pos::Json{{"customerId", customer}, {"points", 40}});
    REQUIRE(redeemed.at("balance") == 60);
}

TEST_CASE("a table cannot be promised to two parties at once", "[guests][reservations]") {
    GuestFixture f;
    const auto at = pos::nowMs() + 3600000;

    f.call(pos::protocol::method::kReservationsSave,
           pos::Json{{"tableId", "tbl-01"}, {"guestName", "Birinci"},
                     {"startsAt", at}, {"durationMin", 90}, {"partySize", 4}});

    // Overlapping window on the same table.
    REQUIRE_THROWS_AS(
        f.call(pos::protocol::method::kReservationsSave,
               pos::Json{{"tableId", "tbl-01"}, {"guestName", "İkinci"},
                         {"startsAt", at + 1800000}, {"durationMin", 90}, {"partySize", 2}}),
        pos::PosError);

    // A different table at the same time is fine.
    f.call(pos::protocol::method::kReservationsSave,
           pos::Json{{"tableId", "tbl-02"}, {"guestName", "İkinci"},
                     {"startsAt", at}, {"durationMin", 90}, {"partySize", 2}});

    // ...and so is the same table once the first booking has ended.
    f.call(pos::protocol::method::kReservationsSave,
           pos::Json{{"tableId", "tbl-01"}, {"guestName", "Üçüncü"},
                     {"startsAt", at + 90 * 60000}, {"durationMin", 60}, {"partySize", 2}});
}

TEST_CASE("seating a booking records the bill it became", "[guests][reservations]") {
    GuestFixture f;
    const auto orderId = f.makeOrder("RES-1");
    const auto id = f.call(pos::protocol::method::kReservationsSave,
                           pos::Json{{"tableId", "tbl-03"}, {"guestName", "Qonaq"},
                                     {"startsAt", pos::nowMs() + 600000}})
                        .at("id")
                        .get<std::string>();

    const auto seated = f.call(pos::protocol::method::kReservationsSeat,
                               pos::Json{{"reservationId", id}, {"orderId", orderId}});
    REQUIRE(seated.at("status") == "seated");

    // Seating twice is a mistake: it is already somebody's bill.
    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kReservationsSeat,
                             pos::Json{{"reservationId", id}, {"orderId", orderId}}),
                      pos::PosError);
}

TEST_CASE("a delivery is assigned, picked up and delivered", "[delivery]") {
    GuestFixture f;
    const auto orderId = f.makeOrder("DEL-1");
    const auto courier = f.call(pos::protocol::method::kCouriersSave,
                                pos::Json{{"name", "Elvin"}, {"vehicle", "moto"}})
                             .at("id")
                             .get<std::string>();

    const auto delivery = f.call(pos::protocol::method::kDeliveryCreate,
                                 pos::Json{{"orderId", orderId},
                                           {"address", "Nizami küç. 12"},
                                           {"feeMinor", 300}});
    const auto id = delivery.at("id").get<std::string>();
    REQUIRE(delivery.at("status") == "pending");

    // Food cannot be picked up by nobody.
    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kDeliverySetStatus,
                             pos::Json{{"deliveryId", id}, {"status", "picked_up"}}),
                      pos::PosError);

    f.call(pos::protocol::method::kDeliveryAssign,
           pos::Json{{"deliveryId", id}, {"courierId", courier}});
    f.call(pos::protocol::method::kDeliverySetStatus,
           pos::Json{{"deliveryId", id}, {"status", "picked_up"}});
    f.call(pos::protocol::method::kDeliverySetStatus,
           pos::Json{{"deliveryId", id}, {"status", "delivered"}});

    // Every step is on the record, so "who had it and when" survives a shift.
    auto events = f.fixture().db().prepare(
        "SELECT COUNT(*) FROM delivery_events WHERE delivery_id = :id");
    events.bind(":id", id);
    events.step();
    REQUIRE(events.columnInt(0) == 4);  // pending, assigned, picked_up, delivered
}

TEST_CASE("a delivered order is history, not a work item", "[delivery]") {
    GuestFixture f;
    const auto orderId = f.makeOrder("DEL-2");
    const auto courier = f.call(pos::protocol::method::kCouriersSave,
                                pos::Json{{"name", "Kuryer"}})
                             .at("id")
                             .get<std::string>();
    const auto id = f.call(pos::protocol::method::kDeliveryCreate,
                           pos::Json{{"orderId", orderId}, {"address", "Ünvan"}})
                        .at("id")
                        .get<std::string>();

    f.call(pos::protocol::method::kDeliveryAssign,
           pos::Json{{"deliveryId", id}, {"courierId", courier}});
    f.call(pos::protocol::method::kDeliverySetStatus,
           pos::Json{{"deliveryId", id}, {"status", "delivered"}});

    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kDeliverySetStatus,
                             pos::Json{{"deliveryId", id}, {"status", "failed"}}),
                      pos::PosError);
}

TEST_CASE("one order is one delivery", "[delivery]") {
    GuestFixture f;
    const auto orderId = f.makeOrder("DEL-3");
    f.call(pos::protocol::method::kDeliveryCreate,
           pos::Json{{"orderId", orderId}, {"address", "Ünvan"}});

    // A double tap must not put the same food on two couriers' lists.
    REQUIRE_THROWS(f.call(pos::protocol::method::kDeliveryCreate,
                          pos::Json{{"orderId", orderId}, {"address", "Ünvan"}}));
}

TEST_CASE("the courier report counts what each one carried", "[delivery][reports]") {
    GuestFixture f;
    const auto courier = f.call(pos::protocol::method::kCouriersSave,
                                pos::Json{{"name", "Elvin"}})
                             .at("id")
                             .get<std::string>();

    for (const char* number : {"R-1", "R-2"}) {
        const auto id = f.call(pos::protocol::method::kDeliveryCreate,
                               pos::Json{{"orderId", f.makeOrder(number)},
                                         {"address", "Ünvan"}, {"feeMinor", 250}})
                            .at("id")
                            .get<std::string>();
        f.call(pos::protocol::method::kDeliveryAssign,
               pos::Json{{"deliveryId", id}, {"courierId", courier}});
        f.call(pos::protocol::method::kDeliverySetStatus,
               pos::Json{{"deliveryId", id}, {"status", "delivered"}});
    }

    const auto report = f.call(pos::protocol::method::kDeliveryCourierReport, pos::Json::object());
    const auto& row = report.at("couriers")[0];
    REQUIRE(row.at("deliveries") == 2);
    REQUIRE(row.at("completed") == 2);
    REQUIRE(row.at("feeMinor") == 500);
    REQUIRE(row.at("collectedMinor") == 8000);
}

TEST_CASE("nobody works two shifts at once", "[roster]") {
    GuestFixture f;
    const auto start = pos::nowMs() + 3600000;

    f.call(pos::protocol::method::kScheduleSave,
           pos::Json{{"userId", "usr-admin"}, {"startsAt", start},
                     {"endsAt", start + 8 * 3600000}});

    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kScheduleSave,
                             pos::Json{{"userId", "usr-admin"},
                                       {"startsAt", start + 3600000},
                                       {"endsAt", start + 5 * 3600000}}),
                      pos::PosError);
}

TEST_CASE("clocking in twice is a mistake, not a second shift", "[roster][attendance]") {
    GuestFixture f;

    const auto punch = f.call(pos::protocol::method::kAttendanceClockIn, pos::Json::object());
    REQUIRE(punch.at("userId") == "usr-admin");

    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kAttendanceClockIn, pos::Json::object()),
                      pos::PosError);

    f.call(pos::protocol::method::kAttendanceClockOut, pos::Json::object());
    // Clocking out with nothing open is equally a mistake.
    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kAttendanceClockOut, pos::Json::object()),
                      pos::PosError);
}

TEST_CASE("attendance reports what was worked against what was planned",
          "[roster][attendance]") {
    GuestFixture f;
    const auto start = pos::nowMs() - 600000;  // started ten minutes ago

    f.call(pos::protocol::method::kScheduleSave,
           pos::Json{{"userId", "usr-admin"}, {"startsAt", start},
                     {"endsAt", start + 8 * 3600000}});
    f.call(pos::protocol::method::kAttendanceClockIn, pos::Json::object());
    f.call(pos::protocol::method::kAttendanceClockOut, pos::Json::object());

    const auto list = f.call(pos::protocol::method::kAttendanceList, pos::Json::object());
    const auto& entry = list.at("entries")[0];
    // Matched to the rota, so planned and actual can be compared without
    // anybody having to guess which shift a punch belonged to.
    REQUIRE_FALSE(entry.at("scheduleId").is_null());
    REQUIRE(entry.at("workedMinutes").get<int>() >= 0);
}
