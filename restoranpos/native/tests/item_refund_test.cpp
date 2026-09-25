#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/ReportService.hpp"

/**
 * Refunding one dish off a bill the guest has already paid and taken a receipt
 * for — the "I did not order this" case.
 */
namespace {

class RefundFixture {
public:
    RefundFixture() {
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** Two lines: 3 x 1000 and 1 x 2500, so partial and full returns differ. */
    std::string makeOrder() {
        const auto now = pos::nowMs();
        orderId_ = pos::crypto::uuid4();

        auto order = fixture_.db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
            "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
            "  tip_minor, opened_at, updated_at, row_version) "
            "VALUES (:id, 'R-1', 'usr-admin', 'open', 2, 5500, 0, 0, 0, 5500, 0, 0, "
            "        :now, :now, 1)");
        order.bind(":id", orderId_).bind(":now", now);
        order.exec();

        auto anyItem = fixture_.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
        REQUIRE(anyItem.step());
        const std::string productId = anyItem.columnText(0);

        drinks_ = addLine(productId, "Çay", 3, 3000, 1);
        steak_ = addLine(productId, "Bifşteks", 1, 2500, 2);
        return orderId_;
    }

    const std::string& drinks() const { return drinks_; }
    const std::string& steak() const { return steak_; }
    ServiceFixture& fixture() { return fixture_; }

private:
    std::string addLine(const std::string& productId, const char* name, std::int64_t quantity,
                        pos::Money lineTotal, int seq) {
        const auto now = pos::nowMs();
        const std::string id = pos::crypto::uuid4();
        auto item = fixture_.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "  created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, :seq, :name, :unit, :qty, 0, :total, 'sent', "
            "        :now, :now, 1)");
        item.bind(":id", id)
            .bind(":order", orderId_)
            .bind(":product", productId)
            .bind(":seq", static_cast<std::int64_t>(seq))
            .bind(":name", std::string(name))
            .bind(":unit", lineTotal / quantity)
            .bind(":qty", quantity)
            .bind(":total", lineTotal)
            .bind(":now", now);
        item.exec();
        return id;
    }

    ServiceFixture fixture_;
    std::string orderId_;
    std::string drinks_;
    std::string steak_;
};

std::string payCash(RefundFixture& f, const std::string& orderId) {
    const auto payment = f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                                                 {"amountMinor", 5500},
                                                                 {"tenderedMinor", 5500}});
    return payment.at("payment").at("id").get<std::string>();
}

}  // namespace

TEST_CASE("one disputed dish is refunded, not the whole bill", "[refund][items]") {
    RefundFixture f;
    const auto paymentId = payCash(f, f.makeOrder());

    const auto refund = f.call(
        "payments.refund",
        pos::Json{{"paymentId", paymentId},
                  {"reason", "Qonaq sifariş etməmişdi"},
                  {"items", pos::Json::array({pos::Json{{"orderItemId", f.steak()},
                                                        {"quantity", 1}}})}});

    REQUIRE(refund.at("amountMinor") == 2500);
    REQUIRE(refund.at("remainingMinor") == 3000);

    // The line that went back is on the record, which is the point of an
    // itemised refund.
    auto rows = f.fixture().db().prepare(
        "SELECT name_snapshot, quantity, amount_minor FROM refund_items");
    REQUIRE(rows.step());
    REQUIRE(rows.columnText(0) == "Bifşteks");
    REQUIRE(rows.columnInt(1) == 1);
    REQUIRE(rows.columnInt(2) == 2500);
}

TEST_CASE("returning every unit of a line gives back exactly what was charged",
          "[refund][items][money]") {
    RefundFixture f;
    const auto paymentId = payCash(f, f.makeOrder());

    // 3000 over three units does not divide evenly in every case; taking them
    // one at a time must still total the line, never 2999 or 3001.
    pos::Money returned = 0;
    for (int i = 0; i < 3; ++i) {
        const auto refund = f.call(
            "payments.refund",
            pos::Json{{"paymentId", paymentId},
                      {"reason", "Səhv sifariş"},
                      {"items", pos::Json::array({pos::Json{{"orderItemId", f.drinks()},
                                                            {"quantity", 1}}})}});
        returned += refund.at("amountMinor").get<pos::Money>();
    }
    REQUIRE(returned == 3000);
}

TEST_CASE("a line cannot be refunded more times than it was sold", "[refund][items]") {
    RefundFixture f;
    const auto paymentId = payCash(f, f.makeOrder());

    f.call("payments.refund",
           pos::Json{{"paymentId", paymentId},
                     {"reason", "Qaytarıldı"},
                     {"items", pos::Json::array({pos::Json{{"orderItemId", f.steak()},
                                                           {"quantity", 1}}})}});

    REQUIRE_THROWS_AS(
        f.call("payments.refund",
               pos::Json{{"paymentId", paymentId},
                         {"reason", "Yenə"},
                         {"items", pos::Json::array({pos::Json{{"orderItemId", f.steak()},
                                                               {"quantity", 1}}})}}),
        pos::PosError);
}

TEST_CASE("a cash refund shows in the drawer log and is counted once",
          "[refund][cash][money]") {
    RefundFixture f;
    const auto paymentId = payCash(f, f.makeOrder());

    pos::services::BusinessDayService days(f.fixture().ctx());
    const auto dayId = *days.openBusinessDayId();
    const auto before = pos::services::CashService(f.fixture().ctx()).expectedCash(dayId);

    f.call("payments.refund",
           pos::Json{{"paymentId", paymentId},
                     {"reason", "Qonaq sifariş etməmişdi"},
                     {"items", pos::Json::array({pos::Json{{"orderItemId", f.steak()},
                                                           {"quantity", 1}}})}});

    // The money physically left the drawer, so the log has to show it.
    auto movement = f.fixture().db().prepare(
        "SELECT kind, amount_minor, reason FROM cash_movements WHERE business_day_id = :day");
    movement.bind(":day", dayId);
    REQUIRE(movement.step());
    REQUIRE(movement.columnText(0) == "cash_out");
    REQUIRE(movement.columnInt(1) == 2500);
    REQUIRE(movement.columnText(2) == "refund");

    // ...but exactly once: the refunds ledger and the drawer movement describe
    // the same 25.00, and subtracting both would make every count look short.
    const auto after = pos::services::CashService(f.fixture().ctx()).expectedCash(dayId);
    REQUIRE(before - after == 2500);

    const auto report =
        pos::services::ReportService(f.fixture().ctx()).buildCanonicalSnapshot(dayId, "x");
    REQUIRE(report.at("sales").at("refundMinor") == 2500);
    REQUIRE(report.at("cashDrawer").at("expectedCashMinor") == after);
}

TEST_CASE("a refund is booked into the till that is open now", "[refund][businessday]") {
    RefundFixture f;
    const auto paymentId = payCash(f, f.makeOrder());

    pos::services::BusinessDayService days(f.fixture().ctx());
    const auto paidOn = *days.openBusinessDayId();

    const auto refund = f.call("payments.refund",
                               pos::Json{{"paymentId", paymentId}, {"reason", "Qaytarıldı"}});

    // Same day here, but the refund must name the day it was booked into rather
    // than inheriting the payment's - a dispute after a Z close would otherwise
    // land in a day whose report is already printed and never counted again.
    REQUIRE(refund.at("businessDayId") == paidOn);
    REQUIRE(refund.at("paidOnBusinessDayId") == paidOn);
}
