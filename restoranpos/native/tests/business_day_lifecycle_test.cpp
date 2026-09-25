#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/ReportService.hpp"

namespace {

pos::Money sumPaidSalesOnDay(pos::db::Database& db, const std::string& dayId) {
    auto stmt = db.prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM payments "
        "WHERE business_day_id = :day AND status = 'approved'");
    stmt.bind(":day", dayId);
    stmt.step();
    return stmt.columnInt(0);
}

}  // namespace

TEST_CASE("ensureOpenBusinessDayId opens once and is idempotent", "[business_day][auto_open]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());

    const std::string first = days.ensureOpenBusinessDayId();
    REQUIRE(!first.empty());
    REQUIRE(days.ensureOpenBusinessDayId() == first);

    auto count = fixture.db().prepare("SELECT COUNT(*) FROM business_days WHERE status = 'open'");
    REQUIRE(count.step());
    REQUIRE(count.columnInt(0) == 1);
}

TEST_CASE("two business days may share the same calendar date after 009", "[business_day][auto_open]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());

    std::string day1;
    {
        pos::db::Transaction txn(fixture.db());
        day1 = days.open(0).at("id").get<std::string>();
        txn.commit();
    }

    {
        pos::db::Transaction txn(fixture.db());
        days.closeZ(day1);
        txn.commit();
    }

    auto closed = fixture.db().prepare("SELECT status FROM business_days WHERE id = :id");
    closed.bind(":id", day1);
    REQUIRE(closed.step());
    REQUIRE(closed.columnText(0) == "closed");

    days.ensureOpenBusinessDayId();

    auto dayCount = fixture.db().prepare("SELECT COUNT(*) FROM business_days");
    REQUIRE(dayCount.step());
    REQUIRE(dayCount.columnInt(0) == 2);

    auto openCount = fixture.db().prepare(
        "SELECT COUNT(*) FROM business_days WHERE status = 'open'");
    REQUIRE(openCount.step());
    REQUIRE(openCount.columnInt(0) == 1);

    auto dateCount = fixture.db().prepare(
        "SELECT COUNT(DISTINCT business_date) FROM business_days");
    REQUIRE(dateCount.step());
    REQUIRE(dateCount.columnInt(0) == 1);
}

TEST_CASE("only one open business day is allowed at a time", "[business_day][auto_open]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());

    {
        pos::db::Transaction txn(fixture.db());
        days.open(0);
        txn.commit();
    }

    auto openSecondDay = [&]() {
        pos::db::Transaction txn(fixture.db());
        days.open(0);
        txn.commit();
    };
    REQUIRE_THROWS_AS(openSecondDay(), pos::PosError);
}

TEST_CASE("Z close does not require counted cash", "[business_day][z_close]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());

    std::string dayId;
    {
        pos::db::Transaction txn(fixture.db());
        dayId = days.open(5000).at("id").get<std::string>();
        txn.commit();
    }

    REQUIRE(days.readiness(dayId).ready);

    {
        pos::db::Transaction txn(fixture.db());
        days.closeZ(dayId);
        txn.commit();
    }

    auto stmt = fixture.db().prepare(
        "SELECT counted_cash_minor, cash_variance_minor FROM business_days WHERE id = :id");
    stmt.bind(":id", dayId);
    REQUIRE(stmt.step());
    REQUIRE(stmt.columnIsNull(0));
    REQUIRE(stmt.columnIsNull(1));
}

TEST_CASE("after Z reopen X report starts empty then shows new sales only",
          "[business_day][x_report]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::ReportService reports(fixture.ctx());
    pos::services::OrderService orders(fixture.ctx());

    std::string day1;
    {
        pos::db::Transaction txn(fixture.db());
        day1 = days.open(0).at("id").get<std::string>();
        txn.commit();
    }

    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, table_id, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, closed_at, business_day_id, row_version) "
        "VALUES (:id, 'BD-1', 'tbl-01', 'usr-admin', 'paid', 1, 8000, 0, 0, 0, 8000, 8000, 0, "
        "        :now, :now, :now, :day, 1)");
    order.bind(":id", orderId).bind(":now", now).bind(":day", day1);
    order.exec();

    auto pay = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, 'cash', 'approved', 8000, 0, 8000, 0, 'usr-admin', :now, :now, :day)");
    pay.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":now", now)
        .bind(":day", day1);
    pay.exec();

    pos::Json xBefore;
    {
        pos::db::Transaction txn(fixture.db());
        xBefore = reports.createXReport(day1);
        txn.commit();
    }
    REQUIRE(xBefore.at("canonical").at("sales").at("grossMinor").get<pos::Money>() == 8000);

    {
        pos::db::Transaction txn(fixture.db());
        days.closeZ(day1);
        txn.commit();
    }

    const std::string day2 = days.ensureOpenBusinessDayId();
    REQUIRE(day2 != day1);

    pos::Json xFresh;
    {
        pos::db::Transaction txn(fixture.db());
        xFresh = reports.createXReport(day2);
        txn.commit();
    }
    REQUIRE(xFresh.at("canonical").at("sales").at("grossMinor").get<pos::Money>() == 0);

    const std::string order2 = pos::crypto::uuid4();
    auto orderInsert = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, table_id, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, business_day_id, row_version) "
        "VALUES (:id, 'BD-2', 'tbl-02', 'usr-admin', 'open', 1, 3000, 0, 0, 0, 3000, 0, 0, "
        "        :now, :now, :day, 1)");
    orderInsert.bind(":id", order2).bind(":now", now).bind(":day", day2);
    orderInsert.exec();

    auto pay2 = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, 'card', 'approved', 3000, 0, 0, 0, 'usr-admin', :now, :now, :day)");
    pay2.bind(":id", pos::crypto::uuid4())
        .bind(":order", order2)
        .bind(":now", now)
        .bind(":day", day2);
    pay2.exec();

    pos::Json xAfter;
    {
        pos::db::Transaction txn(fixture.db());
        xAfter = reports.createXReport(day2);
        txn.commit();
    }
    REQUIRE(xAfter.at("canonical").at("sales").at("grossMinor").get<pos::Money>() == 3000);
    REQUIRE(sumPaidSalesOnDay(fixture.db(), day2) == 3000);
}

TEST_CASE("payments are stamped with the open business day", "[business_day][stamping]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());

    const std::string dayId = days.ensureOpenBusinessDayId();
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, table_id, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, business_day_id, row_version) "
        "VALUES (:id, 'ST-1', 'tbl-03', 'usr-admin', 'open', 1, 2000, 0, 0, 0, 2000, 0, 0, "
        "        :now, :now, :day, 1)");
    order.bind(":id", orderId).bind(":now", now).bind(":day", dayId);
    order.exec();

    auto pay = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, 'cash', 'approved', 2000, 0, 2000, 0, 'usr-admin', :now, :now, :day)");
    pay.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":now", now)
        .bind(":day", dayId);
    pay.exec();

    auto check = fixture.db().prepare("SELECT business_day_id FROM payments WHERE order_id = :o");
    check.bind(":o", orderId);
    REQUIRE(check.step());
    REQUIRE(check.columnText(0) == dayId);
}

TEST_CASE("expectedCashMinor includes opening float and cash sales", "[business_day][report]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::ReportService reports(fixture.ctx());

    std::string dayId;
    {
        pos::db::Transaction txn(fixture.db());
        dayId = days.open(1000).at("id").get<std::string>();
        txn.commit();
    }

    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, closed_at, business_day_id, row_version) "
        "VALUES (:id, 'EC-1', 'usr-admin', 'paid', 1, 5000, 0, 0, 0, 5000, 5000, 0, "
        "        :now, :now, :now, :day, 1)");
    order.bind(":id", orderId).bind(":now", now).bind(":day", dayId);
    order.exec();

    auto pay = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, 'cash', 'approved', 5000, 0, 5000, 0, 'usr-admin', :now, :now, :day)");
    pay.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":now", now)
        .bind(":day", dayId);
    pay.exec();

    const auto snap = reports.buildCanonicalSnapshot(dayId, "x");
    REQUIRE(snap.at("expectedCashMinor").get<pos::Money>() == 6000);
    REQUIRE(snap.at("payloadVersion").get<int>() == 2);
    REQUIRE(snap.at("countedCashMinor").is_null());
}
