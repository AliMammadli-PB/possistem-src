#include "catch_amalgamated.hpp"

#include <string>

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/ReportService.hpp"

namespace {

/**
 * An order that was opened at one moment and settled at another.
 *
 * The gap is the whole point: a period report answers "how much did we take
 * between 08:00 and 09:00", so it has to key off when the money arrived, not
 * when the table was opened.
 */
void seedSale(pos::db::Database& db, const std::string& id, pos::Timestamp openedAt,
              pos::Timestamp paidAt, pos::Money amount, const std::string& method) {
    auto order = db.prepare(
        "INSERT INTO orders (id, order_number, table_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  user_id, opened_at, updated_at) "
        "VALUES (:id, :num, NULL, 'paid', 2, :amount, 0, 0, 0, :amount, :amount, "
        "        'usr-admin', :opened, :opened)");
    order.bind(":id", id)
        .bind(":num", id)
        .bind(":amount", amount)
        .bind(":opened", openedAt);
    order.exec();

    auto payment = db.prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  user_id, created_at, updated_at) "
        "VALUES (:id, :order, :method, 'approved', :amount, 0, 'usr-admin', :paid, :paid)");
    payment.bind(":id", "pay-" + id)
        .bind(":order", id)
        .bind(":method", method)
        .bind(":amount", amount)
        .bind(":paid", paidAt);
    payment.exec();
}

/** 07.08.2026 at a given local hour, as epoch milliseconds. */
pos::Timestamp localHour(int hour, int minute = 0) {
    std::tm parts{};
    parts.tm_year = 2026 - 1900;
    parts.tm_mon = 7;  // August
    parts.tm_mday = 7;
    parts.tm_hour = hour;
    parts.tm_min = minute;
    parts.tm_isdst = -1;
    return static_cast<pos::Timestamp>(std::mktime(&parts)) * 1000LL;
}

}  // namespace

TEST_CASE("period report counts money by when it was paid", "[report][period]") {
    ServiceFixture fixture;
    pos::services::ReportService reports(fixture.ctx());

    // Opened before the window, settled inside it. This is the case that decides
    // which clock the report runs on, and it must be counted.
    seedSale(fixture.db(), "ord-early-open", localHour(7, 50), localHour(8, 10), 5000, "cash");
    // Squarely inside.
    seedSale(fixture.db(), "ord-inside", localHour(8, 30), localHour(8, 40), 3000, "card");
    // Opened inside the window but settled after it — belongs to the next hour.
    seedSale(fixture.db(), "ord-late-pay", localHour(8, 55), localHour(9, 20), 9900, "cash");
    // Nowhere near.
    seedSale(fixture.db(), "ord-outside", localHour(14, 0), localHour(14, 5), 7700, "cash");

    const auto summary = reports.periodSummary(localHour(8), localHour(9) - 1);

    // 5000 + 3000. The 9900 settled at 09:20 and the 7700 in the afternoon are
    // both outside.
    CHECK(summary["sales"]["grossMinor"].get<pos::Money>() == 8000);
    CHECK(summary["orders"]["count"].get<std::int64_t>() == 2);
    CHECK(summary["orders"]["averageMinor"].get<pos::Money>() == 4000);

    pos::Money cash = 0;
    pos::Money card = 0;
    for (const auto& row : summary["sales"]["byMethod"]) {
        const auto method = row.value("method", std::string{});
        if (method == "cash") cash = row.value("totalMinor", pos::Money{0});
        if (method == "card") card = row.value("totalMinor", pos::Money{0});
    }
    CHECK(cash == 5000);
    CHECK(card == 3000);
    CHECK(summary["cashDrawer"]["cashSalesMinor"].get<pos::Money>() == 5000);
}

TEST_CASE("period report subtracts refunds settled in the window", "[report][period]") {
    ServiceFixture fixture;
    pos::services::ReportService reports(fixture.ctx());

    seedSale(fixture.db(), "ord-refunded", localHour(8, 5), localHour(8, 10), 6000, "cash");

    auto refund = fixture.db().prepare(
        "INSERT INTO refunds (id, order_id, payment_id, amount_minor, reason, status, method, "
        "  created_at, updated_at) "
        "VALUES (:id, 'ord-refunded', 'pay-ord-refunded', 1500, 'test', 'completed', 'cash', "
        "        :at, :at)");
    refund.bind(":id", "ref-1").bind(":at", localHour(8, 45));
    refund.exec();

    const auto summary = reports.periodSummary(localHour(8), localHour(9) - 1);

    // Gross is what came in; net is what was kept.
    CHECK(summary["sales"]["grossMinor"].get<pos::Money>() == 6000);
    CHECK(summary["sales"]["refundMinor"].get<pos::Money>() == 1500);
    CHECK(summary["sales"]["netMinor"].get<pos::Money>() == 4500);
    CHECK(summary["cashDrawer"]["expectedCashMinor"].get<pos::Money>() == 4500);
}

TEST_CASE("period buckets group on the local clock", "[report][period]") {
    ServiceFixture fixture;
    pos::services::ReportService reports(fixture.ctx());

    seedSale(fixture.db(), "ord-a", localHour(8, 5), localHour(8, 5), 1000, "cash");
    seedSale(fixture.db(), "ord-b", localHour(8, 50), localHour(8, 50), 2000, "card");
    seedSale(fixture.db(), "ord-c", localHour(21, 30), localHour(21, 30), 4000, "cash");

    const auto buckets = reports.periodBuckets(localHour(0), localHour(23, 59), "hour");
    REQUIRE(buckets.size() == 2);

    // Grouped by the hour on the wall, not the UTC hour — otherwise every venue
    // outside Greenwich reads its own evening off by the timezone offset.
    CHECK(buckets[0].value("bucket", std::string{}) == "2026-08-07 08");
    CHECK(buckets[0].value("totalMinor", pos::Money{0}) == 3000);
    CHECK(buckets[0].value("cashMinor", pos::Money{0}) == 1000);
    CHECK(buckets[0].value("cardMinor", pos::Money{0}) == 2000);

    CHECK(buckets[1].value("bucket", std::string{}) == "2026-08-07 21");
    CHECK(buckets[1].value("totalMinor", pos::Money{0}) == 4000);

    const auto daily = reports.periodBuckets(localHour(0), localHour(23, 59), "day");
    REQUIRE(daily.size() == 1);
    CHECK(daily[0].value("bucket", std::string{}) == "2026-08-07");
    CHECK(daily[0].value("totalMinor", pos::Money{0}) == 7000);
}

namespace {

/**
 * `reports.remotePeriod` is the door the WhatsApp relay knocks on.
 *
 * It is reachable without a session on purpose — the owner asking from a chat is
 * not whoever is signed in at the till — so what keeps it defensible is that it
 * only ever answers with aggregates for a bounded window. These tests hold that
 * boundary: no session needed, and a range that is backwards or absurdly long is
 * refused rather than turned into a full-table scan.
 */
class RemotePeriodFixture {
public:
    RemotePeriodFixture() {
        pos::handlers::registerSystem(fixture_.contextPtr());
        // Nobody signed in — the state a till sits in overnight.
        fixture_.ctx().session().authenticated = false;
        fixture_.ctx().session().permissions.clear();
    }

    pos::Json call(pos::Timestamp from, pos::Timestamp to) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = "reports.remotePeriod";
        request.payload = pos::Json{{"from", from}, {"to", to}};
        return fixture_.server().callHandler(request);
    }

    /** The error code a rejected range comes back with, or "" if it succeeded. */
    std::string refusal(pos::Timestamp from, pos::Timestamp to) {
        try {
            call(from, to);
            return "";
        } catch (const pos::PosError& err) {
            return err.code();
        }
    }

    pos::db::Database& db() { return fixture_.db(); }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("remote period answers with no operator signed in", "[report][period][remote]") {
    RemotePeriodFixture fixture;
    seedSale(fixture.db(), "ord-remote", localHour(12, 30), localHour(12, 40), 3400, "cash");

    const auto summary = fixture.call(localHour(12), localHour(13) - 1);

    CHECK(summary["sales"]["grossMinor"].get<pos::Money>() == 3400);
    CHECK(summary["orders"]["count"].get<std::int64_t>() == 1);
    // Deliberately bucket-free: this reply becomes a chat message.
    CHECK_FALSE(summary.contains("buckets"));
}

TEST_CASE("remote period spans midnight for a venue open past it", "[report][period][remote]") {
    RemotePeriodFixture fixture;
    // "5 avqust 12:00-04:00" is one night over two dates. Both halves count.
    seedSale(fixture.db(), "ord-evening", localHour(20, 0), localHour(20, 10), 5000, "cash");
    seedSale(fixture.db(), "ord-after-midnight", localHour(23, 50), localHour(25, 30), 2500, "card");
    // 05:00 the next morning — past the end of the window.
    seedSale(fixture.db(), "ord-breakfast", localHour(29, 0), localHour(29, 5), 9999, "cash");

    const auto summary = fixture.call(localHour(12), localHour(28) - 1);

    CHECK(summary["sales"]["grossMinor"].get<pos::Money>() == 7500);
    CHECK(summary["orders"]["count"].get<std::int64_t>() == 2);
}

TEST_CASE("remote period refuses a range it cannot answer", "[report][period][remote]") {
    RemotePeriodFixture fixture;

    SECTION("end before start") {
        CHECK(fixture.refusal(localHour(12), localHour(8)) == "E_VALIDATION");
    }

    SECTION("missing bounds") {
        // No sensible default exists: guessing "today" for a question about a
        // specific night would answer confidently with the wrong numbers.
        CHECK(fixture.refusal(0, 0) == "E_VALIDATION");
    }

    SECTION("longer than a month") {
        const pos::Timestamp from = localHour(0);
        CHECK(fixture.refusal(from, from + 40LL * 24 * 60 * 60 * 1000) == "E_VALIDATION");
    }
}
