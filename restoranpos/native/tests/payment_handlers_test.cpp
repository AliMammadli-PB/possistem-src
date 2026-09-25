#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/printing/ReceiptFormatter.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/PaymentService.hpp"
#include "pos/services/RefundService.hpp"

namespace {

/**
 * Drives the real request handlers, not the services underneath them.
 *
 * The tip and refund arithmetic lives in the handler layer, so exercising
 * `PaymentService` alone would have kept missing it.
 */
class PaymentFixture {
public:
    PaymentFixture() {
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload,
                   const std::string& idempotencyKey = "") {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = idempotencyKey.empty() ? pos::crypto::uuid4() : idempotencyKey;
        return fixture_.server().callHandler(request);
    }

    /** An open order worth `totalMinor`, with one line so totals survive a recalc. */
    std::string makeOrder(pos::Money totalMinor, const char* number) {
        const auto now = pos::nowMs();
        const std::string orderId = pos::crypto::uuid4();

        auto order = fixture_.db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
            "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
            "  tip_minor, opened_at, updated_at, row_version) "
            "VALUES (:id, :number, 'usr-admin', 'open', 1, :total, 0, 0, 0, :total, 0, 0, "
            "        :now, :now, 1)");
        order.bind(":id", orderId)
            .bind(":number", std::string(number))
            .bind(":total", totalMinor)
            .bind(":now", now);
        order.exec();

        auto anyItem = fixture_.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
        REQUIRE(anyItem.step());
        auto item = fixture_.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "  created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, 1, 'Item', :price, 1, 0, :price, 'sent', :now, :now, 1)");
        item.bind(":id", pos::crypto::uuid4())
            .bind(":order", orderId)
            .bind(":product", anyItem.columnText(0))
            .bind(":price", totalMinor)
            .bind(":now", now);
        item.exec();

        return orderId;
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("cash change is the tender minus the bill AND the tip", "[payment][cash][tip]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(10000, "C-1");

    // 100.00 bill, 10.00 tip, 120.00 handed over: the guest gets 10.00 back,
    // not 20.00 - the tip is not the cashier's to give away.
    const auto result = f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                                                {"amountMinor", 10000},
                                                                {"tipMinor", 1000},
                                                                {"tenderedMinor", 12000}});
    REQUIRE(result.at("changeMinor") == 1000);
    REQUIRE(result.at("payment").at("status") == "approved");
    REQUIRE(pos::services::PaymentService(f.fixture().ctx()).outstanding(orderId) == 0);
}

TEST_CASE("cash that does not cover bill plus tip is rejected", "[payment][cash][tip]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(10000, "C-2");

    REQUIRE_THROWS_AS(f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                                              {"amountMinor", 10000},
                                                              {"tipMinor", 1000},
                                                              {"tenderedMinor", 10500}}),
                      pos::PosError);
}

TEST_CASE("cash tips are part of the expected drawer", "[payment][cash][tip]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(5000, "C-3");

    f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                            {"amountMinor", 5000},
                                            {"tipMinor", 700},
                                            {"tenderedMinor", 6000}});

    auto day = f.fixture().db().prepare(
        "SELECT id, opening_float_minor FROM business_days WHERE status = 'open' LIMIT 1");
    REQUIRE(day.step());
    const std::string dayId = day.columnText(0);
    const pos::Money openingFloat = day.columnInt(1);

    // Float + the 50.00 sale + the 7.00 tip that is physically in the drawer.
    REQUIRE(pos::services::CashService(f.fixture().ctx()).expectedCash(dayId) ==
            openingFloat + 5000 + 700);
}

TEST_CASE("overpaying an order is refused", "[payment][cash]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(5000, "C-4");

    REQUIRE_THROWS_AS(f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                                              {"amountMinor", 6000},
                                                              {"tenderedMinor", 6000}}),
                      pos::PosError);
}

TEST_CASE("deposit is additive and appears in the canonical receipt", "[payment][deposit]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(3400, "D-1");

    const auto changed = f.call("orders.setDeposit",
                                pos::Json{{"orderId", orderId}, {"depositMinor", 600}});
    REQUIRE(changed.at("depositMinor") == 600);
    REQUIRE(changed.at("subtotalMinor") == 3400);
    REQUIRE(changed.at("totalMinor") == 4000);
    REQUIRE(pos::services::PaymentService(f.fixture().ctx()).outstanding(orderId) == 4000);

    const auto doc = pos::printing::ReceiptBuilder(f.fixture().ctx())
                         .customerDocument(orderId,
                                           pos::printing::ReceiptBuilder(f.fixture().ctx()).settings());
    REQUIRE(doc.depositTotal == 600);
    REQUIRE(doc.grandTotal == 4000);
    REQUIRE(pos::printing::renderPlainText(doc).find("Depozit") != std::string::npos);
}

TEST_CASE("replaying an idempotency key does not take the money twice",
          "[payment][cash][idempotency]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(5000, "C-5");
    const std::string key = "idem-replay-1";

    const auto first = f.call("payments.createCash",
                              pos::Json{{"orderId", orderId},
                                        {"amountMinor", 2000},
                                        {"tenderedMinor", 2000}},
                              key);
    const auto second = f.call("payments.createCash",
                               pos::Json{{"orderId", orderId},
                                         {"amountMinor", 2000},
                                         {"tenderedMinor", 2000}},
                               key);

    REQUIRE(first.at("payment").at("id") == second.at("payment").at("id"));

    auto count = f.fixture().db().prepare(
        "SELECT COUNT(*) FROM payments WHERE order_id = :orderId");
    count.bind(":orderId", orderId);
    REQUIRE(count.step());
    REQUIRE(count.columnInt(0) == 1);
    REQUIRE(pos::services::PaymentService(f.fixture().ctx()).outstanding(orderId) == 3000);
}

TEST_CASE("paid and outstanding still add up after a refund", "[payment][refund]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(10000, "C-6");

    const auto first = f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                                               {"amountMinor", 6000},
                                                               {"tenderedMinor", 6000}});
    const auto second = f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                                                {"amountMinor", 4000},
                                                                {"tenderedMinor", 4000}});
    const std::string secondId = second.at("payment").at("id");

    pos::services::OrderService orders(f.fixture().ctx());
    pos::services::PaymentService payments(f.fixture().ctx());
    REQUIRE(payments.outstanding(orderId) == 0);
    REQUIRE(orders.load(orderId).at("paidMinor") == 10000);

    // Full refund of the second payment: 60.00 is still collected, 40.00 owing.
    {
        pos::db::Transaction txn(f.fixture().db());
        pos::services::RefundService(f.fixture().ctx())
            .createRefund(secondId, 4000, "guest left", "usr-admin");
        txn.commit();
    }
    orders.recalculate(orderId);

    const pos::Money paid = orders.load(orderId).at("paidMinor");
    const pos::Money owing = payments.outstanding(orderId);
    REQUIRE(paid == 6000);
    REQUIRE(owing == 4000);
    // The screen shows both figures side by side; they have to reconcile.
    REQUIRE(paid + owing == 10000);

    // A partial refund of the remaining payment behaves the same way.
    const std::string firstId = first.at("payment").at("id");
    {
        pos::db::Transaction txn(f.fixture().db());
        pos::services::RefundService(f.fixture().ctx())
            .createRefund(firstId, 2000, "one course returned", "usr-admin");
        txn.commit();
    }
    orders.recalculate(orderId);
    REQUIRE(orders.load(orderId).at("paidMinor").get<pos::Money>() +
                payments.outstanding(orderId) ==
            10000);
}

TEST_CASE("item note, seat, course and hold round-trip", "[orders][items]") {
    PaymentFixture f;
    const std::string orderId = f.makeOrder(5000, "C-7");

    auto itemStmt = f.fixture().db().prepare(
        "SELECT id FROM order_items WHERE order_id = :orderId LIMIT 1");
    itemStmt.bind(":orderId", orderId);
    REQUIRE(itemStmt.step());
    const std::string itemId = itemStmt.columnText(0);

    f.call("orders.setItemNote",
           pos::Json{{"orderId", orderId}, {"itemId", itemId}, {"note", "az duzlu"}});
    f.call("orders.setItemSeat", pos::Json{{"orderId", orderId}, {"itemId", itemId}, {"seat", 3}});
    f.call("orders.setItemCourse",
           pos::Json{{"orderId", orderId}, {"itemId", itemId}, {"course", "main"}});
    f.call("orders.holdItem",
           pos::Json{{"orderId", orderId}, {"itemId", itemId}, {"held", true}});

    auto row = f.fixture().db().prepare(
        "SELECT note, seat, course, held FROM order_items WHERE id = :id");
    row.bind(":id", itemId);
    REQUIRE(row.step());
    REQUIRE(row.columnText(0) == "az duzlu");
    REQUIRE(row.columnInt(1) == 3);
    REQUIRE(row.columnText(2) == "main");
    REQUIRE(row.columnInt(3) == 1);
}
