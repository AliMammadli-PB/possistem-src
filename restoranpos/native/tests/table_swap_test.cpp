#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/OrderService.hpp"

namespace {

std::string openOrderOnTable(ServiceFixture& fixture, const std::string& tableId,
                             pos::Money totalMinor) {
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::OrderService orders(fixture.ctx());
    const std::string dayId = days.ensureOpenBusinessDayId();
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto insert = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, table_id, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, business_day_id, row_version) "
        "VALUES (:id, :num, :table, 'usr-admin', 'open', 2, :total, 0, 0, 0, :total, 0, 0, "
        "        :now, :now, :day, 1)");
    insert.bind(":id", orderId)
        .bind(":num", orders.nextOrderNumber())
        .bind(":table", tableId)
        .bind(":total", totalMinor)
        .bind(":now", now)
        .bind(":day", dayId);
    insert.exec();

    auto product = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(product.step());
    auto item = fixture.db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Test item', :price, 1, 0, :price, 'sent', "
        "        :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":product", product.columnText(0))
        .bind(":price", totalMinor)
        .bind(":now", now);
    item.exec();

    orders.refreshTableStatus(tableId);
    return orderId;
}

}  // namespace

TEST_CASE("tables.swap exchanges orders without orphans", "[table][swap]") {
    ServiceFixture fixture;
    pos::handlers::registerTables(fixture.contextPtr());

    const std::string orderA = openOrderOnTable(fixture, "tbl-01", 1500);
    const std::string orderB = openOrderOnTable(fixture, "tbl-02", 2500);

    pos::ipc::Request request;
    request.requestId = "swap-test-1";
    request.method = std::string(pos::protocol::method::kTablesSwap);
    request.idempotencyKey = "swap-idem-1";
    request.payload = pos::Json{{"tableIdA", "tbl-01"}, {"tableIdB", "tbl-02"}};

    const pos::Json result = fixture.server().callHandler(request);
    REQUIRE(result.contains("orderA"));
    REQUIRE(result.contains("orderB"));

    auto a = fixture.db().prepare("SELECT table_id, status FROM orders WHERE id = :id");
    a.bind(":id", orderA);
    REQUIRE(a.step());
    REQUIRE(a.columnText(0) == "tbl-02");
    REQUIRE(a.columnText(1) == "open");

    auto b = fixture.db().prepare("SELECT table_id, status FROM orders WHERE id = :id");
    b.bind(":id", orderB);
    REQUIRE(b.step());
    REQUIRE(b.columnText(0) == "tbl-01");
    REQUIRE(b.columnText(1) == "open");

    auto orphans = fixture.db().prepare(
        "SELECT COUNT(*) FROM orders "
        "WHERE table_id IS NULL AND status IN ('draft','open','sent','partially_paid')");
    REQUIRE(orphans.step());
    REQUIRE(orphans.columnInt(0) == 0);
}
