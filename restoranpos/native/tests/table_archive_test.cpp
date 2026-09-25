#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

namespace {

pos::Json call(ServiceFixture& fixture, std::string_view method, pos::Json payload) {
    pos::ipc::Request request;
    request.requestId = pos::crypto::uuid4();
    request.method = std::string(method);
    request.payload = std::move(payload);
    request.idempotencyKey = pos::crypto::uuid4();
    return fixture.server().callHandler(request);
}

std::string insertDraft(ServiceFixture& fixture, const std::string& tableId, bool withItem) {
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, table_id, user_id, status, guest_count, "
        "subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, :num, :table, 'usr-admin', 'draft', 1, :total, 0, 0, 0, :total, 0, 0, "
        ":now, :now, 1)");
    order.bind(":id", orderId)
        .bind(":num", static_cast<std::int64_t>(900000 + now % 10000))
        .bind(":table", tableId)
        .bind(":total", withItem ? 500 : 0)
        .bind(":now", now);
    order.exec();

    if (withItem) {
        auto product = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
        REQUIRE(product.step());
        auto item = fixture.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, 1, 'Test item', 500, 1, 0, 500, 'draft', "
            ":now, :now, 1)");
        item.bind(":id", pos::crypto::uuid4())
            .bind(":order", orderId)
            .bind(":product", product.columnText(0))
            .bind(":now", now);
        item.exec();
    }
    return orderId;
}

}  // namespace

TEST_CASE("archiving a visually empty table abandons its zero-value draft", "[table][archive]") {
    ServiceFixture fixture;
    pos::handlers::registerTables(fixture.contextPtr());
    const std::string orderId = insertDraft(fixture, "tbl-01", false);

    const auto result = call(fixture, pos::protocol::method::kTablesArchiveTable,
                             pos::Json{{"tableId", "tbl-01"}});
    REQUIRE(result.at("archived") == true);

    auto table = fixture.db().prepare("SELECT active FROM restaurant_tables WHERE id = 'tbl-01'");
    REQUIRE(table.step());
    REQUIRE(table.columnInt(0) == 0);
    auto order = fixture.db().prepare("SELECT status FROM orders WHERE id = :id");
    order.bind(":id", orderId);
    REQUIRE(order.step());
    REQUIRE(order.columnText(0) == "voided");
}

TEST_CASE("archiving still refuses a table that has a real draft order", "[table][archive]") {
    ServiceFixture fixture;
    pos::handlers::registerTables(fixture.contextPtr());
    const std::string orderId = insertDraft(fixture, "tbl-02", true);

    REQUIRE_THROWS_AS(call(fixture, pos::protocol::method::kTablesArchiveTable,
                           pos::Json{{"tableId", "tbl-02"}}),
                      pos::PosError);

    auto table = fixture.db().prepare("SELECT active FROM restaurant_tables WHERE id = 'tbl-02'");
    REQUIRE(table.step());
    REQUIRE(table.columnInt(0) == 1);
    auto order = fixture.db().prepare("SELECT status FROM orders WHERE id = :id");
    order.bind(":id", orderId);
    REQUIRE(order.step());
    REQUIRE(order.columnText(0) == "draft");
}

TEST_CASE("archiving an empty area clears invisible drafts on all of its tables", "[table][archive]") {
    ServiceFixture fixture;
    pos::handlers::registerTables(fixture.contextPtr());
    const std::string orderId = insertDraft(fixture, "tbl-17", false);

    const auto result = call(fixture, pos::protocol::method::kTablesArchiveArea,
                             pos::Json{{"areaId", "area-vip"}});
    REQUIRE(result.at("archived") == true);

    auto count = fixture.db().prepare(
        "SELECT COUNT(*) FROM restaurant_tables WHERE area_id = 'area-vip' AND active = 1");
    REQUIRE(count.step());
    REQUIRE(count.columnInt(0) == 0);
    auto order = fixture.db().prepare("SELECT status FROM orders WHERE id = :id");
    order.bind(":id", orderId);
    REQUIRE(order.step());
    REQUIRE(order.columnText(0) == "voided");
}
