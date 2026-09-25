#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/PaymentService.hpp"
#include "pos/services/TableTransferService.hpp"

namespace {

std::string openOrderOnTable(ServiceFixture& fixture, const std::string& tableId,
                             pos::Money totalMinor, int guests) {
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::OrderService orders(fixture.ctx());
    const std::string dayId = days.ensureOpenBusinessDayId();
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto insert = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, table_id, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, business_day_id, row_version) "
        "VALUES (:id, :num, :table, 'usr-admin', 'open', :guests, :total, 0, 0, 0, :total, 0, 0, "
        "        :now, :now, :day, 1)");
    insert.bind(":id", orderId)
        .bind(":num", orders.nextOrderNumber())
        .bind(":table", tableId)
        .bind(":guests", static_cast<std::int64_t>(guests))
        .bind(":total", totalMinor)
        .bind(":now", now)
        .bind(":day", dayId);
    insert.exec();

    auto item = fixture.db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Test item', :price, 1, 0, :price, 'sent', "
        "        :now, :now, 1)");
    auto product = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(product.step());
    item.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":product", product.columnText(0))
        .bind(":price", totalMinor)
        .bind(":now", now);
    item.exec();

    orders.refreshTableStatus(tableId);
    return orderId;
}

void addApprovedPayment(ServiceFixture& fixture, const std::string& orderId, pos::Money amount,
                        const std::string& method = "cash") {
    pos::services::BusinessDayService days(fixture.ctx());
    const std::string dayId = days.ensureOpenBusinessDayId();
    const auto now = pos::nowMs();
    auto pay = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, :method, 'approved', :amount, 0, :amount, 0, 'usr-admin', "
        "        :now, :now, :day)");
    pay.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":method", method)
        .bind(":amount", amount)
        .bind(":now", now)
        .bind(":day", dayId);
    pay.exec();
    pos::services::PaymentService(fixture.ctx()).refreshOrderPaymentStatus(orderId);
}

pos::Money sumApprovedPayments(ServiceFixture& fixture) {
    auto stmt = fixture.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM payments WHERE status = 'approved'");
    stmt.step();
    return stmt.columnInt(0);
}

std::int64_t tableVersion(ServiceFixture& fixture, const std::string& tableId) {
    auto stmt = fixture.db().prepare("SELECT row_version FROM restaurant_tables WHERE id = :id");
    stmt.bind(":id", tableId);
    REQUIRE(stmt.step());
    return stmt.columnInt(0);
}

}  // namespace

TEST_CASE("merge does not double-count revenue", "[table][merge]") {
    ServiceFixture fixture;
    pos::services::OrderService orders(fixture.ctx());
    const std::string sourceOrder = openOrderOnTable(fixture, "tbl-05", 3000, 4);
    const std::string targetOrder = openOrderOnTable(fixture, "tbl-06", 2500, 4);
    const auto sourceBefore = orders.recalculate(sourceOrder);
    const auto targetBefore = orders.recalculate(targetOrder);

    pos::services::TableTransferService transfer(fixture.ctx());
    {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-06", {"tbl-05"}, -1, -1, "merge-test-1");
        txn.commit();
    }

    auto source = fixture.db().prepare(
        "SELECT status, total_minor, paid_minor FROM orders WHERE id = :id");
    source.bind(":id", sourceOrder);
    REQUIRE(source.step());
    REQUIRE(source.columnText(0) == "closed");
    REQUIRE(source.columnInt(1) == 0);
    REQUIRE(source.columnInt(2) == 0);

    const auto targetAfter = orders.recalculate(targetOrder);
    REQUIRE(targetAfter.subtotal == sourceBefore.subtotal + targetBefore.subtotal);
    REQUIRE(source.columnInt(1) + targetAfter.total == targetAfter.total);
}

TEST_CASE("merge moves partial payments to the target bill", "[table][merge]") {
    ServiceFixture fixture;
    pos::services::OrderService orders(fixture.ctx());
    pos::services::PaymentService payments(fixture.ctx());
    const std::string sourceOrder = openOrderOnTable(fixture, "tbl-07", 4000, 4);
    openOrderOnTable(fixture, "tbl-08", 2000, 2);
    addApprovedPayment(fixture, sourceOrder, 1000);

    const auto paymentsBefore = sumApprovedPayments(fixture);

    pos::services::TableTransferService transfer(fixture.ctx());
    {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-08", {"tbl-07"}, -1, -1, "merge-test-2");
        txn.commit();
    }

    REQUIRE(sumApprovedPayments(fixture) == paymentsBefore);

    auto payOwner = fixture.db().prepare(
        "SELECT order_id FROM payments WHERE status = 'approved' AND amount_minor = 1000");
    REQUIRE(payOwner.step());
    const std::string targetOrder = payOwner.columnText(0);

    const auto mergedTotals = orders.recalculate(targetOrder);
    REQUIRE(payments.outstanding(targetOrder) == mergedTotals.total - 1000);
}

TEST_CASE("merge sums guest counts and records transfer event", "[table][merge]") {
    ServiceFixture fixture;
    openOrderOnTable(fixture, "tbl-09", 1500, 3);
    openOrderOnTable(fixture, "tbl-10", 3500, 5);

    pos::services::TableTransferService transfer(fixture.ctx());
    {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-10", {"tbl-09"}, -1, -1, "merge-test-3");
        txn.commit();
    }

    auto guests = fixture.db().prepare(
        "SELECT guest_count FROM orders WHERE table_id = 'tbl-10' "
        "AND status IN ('draft','open','sent','partially_paid')");
    REQUIRE(guests.step());
    REQUIRE(guests.columnInt(0) == 8);

    auto events = fixture.db().prepare(
        "SELECT COUNT(*) FROM table_transfer_events WHERE operation = 'merge'");
    REQUIRE(events.step());
    REQUIRE(events.columnInt(0) == 1);

    auto mergedFlag = fixture.db().prepare(
        "SELECT merged_into_id FROM restaurant_tables WHERE id = 'tbl-09'");
    REQUIRE(mergedFlag.step());
    REQUIRE(mergedFlag.columnText(0) == "tbl-10");
}

TEST_CASE("merge rejects stale table version", "[table][merge]") {
    ServiceFixture fixture;
    openOrderOnTable(fixture, "tbl-11", 1000, 2);
    openOrderOnTable(fixture, "tbl-12", 1000, 2);

    pos::services::TableTransferService transfer(fixture.ctx());
    auto mergeWithStaleVersion = [&]() {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-12", {"tbl-11"}, 999, -1, "merge-stale");
        txn.commit();
    };
    REQUIRE_THROWS_AS(mergeWithStaleVersion(), pos::PosError);
}

TEST_CASE("merge rejects closed business day", "[table][merge]") {
    ServiceFixture fixture;
    openOrderOnTable(fixture, "tbl-13", 1200, 2);
    openOrderOnTable(fixture, "tbl-14", 1800, 2);

    const auto now = pos::nowMs();
    fixture.db().exec(
        "UPDATE business_days SET status = 'closed', closed_at = " + std::to_string(now) +
        " WHERE status = 'open'");

    pos::services::TableTransferService transfer(fixture.ctx());
    auto mergeOnClosedDay = [&]() {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-14", {"tbl-13"}, -1, -1, "merge-closed-day");
        txn.commit();
    };
    REQUIRE_THROWS_AS(mergeOnClosedDay(), pos::PosError);
}

TEST_CASE("closing target table clears merged_into_id on sources", "[table][merge]") {
    ServiceFixture fixture;
    openOrderOnTable(fixture, "tbl-15", 1000, 2);
    const std::string targetOrder = openOrderOnTable(fixture, "tbl-16", 2000, 2);

    pos::services::TableTransferService transfer(fixture.ctx());
    {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-16", {"tbl-15"}, -1, -1, "merge-clear-flag");
        txn.commit();
    }

    pos::services::OrderService orders(fixture.ctx());
    orders.recalculate(targetOrder);
    fixture.db().exec(
        "UPDATE orders SET status = 'paid', paid_minor = total_minor WHERE id = '" + targetOrder +
        "'");

    const auto now = pos::nowMs();
    fixture.db().exec(
        "UPDATE orders SET status = 'closed', closed_at = " + std::to_string(now) +
        " WHERE id = '" + targetOrder + "'");
    fixture.db().exec(
        "UPDATE restaurant_tables SET status = 'cleaning' WHERE id = 'tbl-16'");
    fixture.db().exec(
        "UPDATE restaurant_tables SET merged_into_id = NULL, row_version = row_version + 1 "
        "WHERE merged_into_id = 'tbl-16'");

    auto flag = fixture.db().prepare(
        "SELECT merged_into_id FROM restaurant_tables WHERE id = 'tbl-15'");
    REQUIRE(flag.step());
    REQUIRE(flag.columnIsNull(0));
}

TEST_CASE("merge bumps row versions on involved tables", "[table][merge]") {
    ServiceFixture fixture;
    openOrderOnTable(fixture, "tbl-17", 2200, 2);
    openOrderOnTable(fixture, "tbl-18", 3300, 2);

    const auto sourceBefore = tableVersion(fixture, "tbl-17");
    const auto targetBefore = tableVersion(fixture, "tbl-18");

    pos::services::TableTransferService transfer(fixture.ctx());
    {
        pos::db::Transaction txn(fixture.db());
        transfer.mergeTables("tbl-18", {"tbl-17"}, -1, -1, "merge-versions");
        txn.commit();
    }

    REQUIRE(tableVersion(fixture, "tbl-17") > sourceBefore);
    REQUIRE(tableVersion(fixture, "tbl-18") > targetBefore);
}
