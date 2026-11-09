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

namespace {
pos::Json assistantSnapshot(ServiceFixture& f,const std::string& id){auto q=f.db().prepare("SELECT id,label,area_id AS areaId,seats,shape,sort_order AS sortOrder,updated_at AS updatedAt FROM restaurant_tables WHERE id=:id");q.bind(":id",id);REQUIRE(q.step());return q.row();}
pos::Json guardedCall(ServiceFixture& f,std::string_view method,const pos::Json& payload,const std::string& key){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method=std::string(method);r.payload=payload;r.idempotencyKey=key;return f.server().callHandler(r);}
int activeTable(ServiceFixture& f,const std::string& id){auto q=f.db().prepare("SELECT active FROM restaurant_tables WHERE id=:id");q.bind(":id",id);REQUIRE(q.step());return static_cast<int>(q.columnInt(0));}
}
TEST_CASE("assistant archive atomically rejects a newly busy table", "[table][assistant]"){
 ServiceFixture f;pos::handlers::registerTables(f.contextPtr());const pos::Json p{{"assistantGuard",true},{"assistantExpectedTables",pos::Json::array({assistantSnapshot(f,"tbl-01"),assistantSnapshot(f,"tbl-02")})}};const auto order=insertDraft(f,"tbl-02",false);
 REQUIRE_THROWS_AS(guardedCall(f,pos::protocol::method::kTablesArchiveTable,p,"busy-batch"),pos::PosError);REQUIRE(activeTable(f,"tbl-01")==1);REQUIRE(activeTable(f,"tbl-02")==1);auto q=f.db().prepare("SELECT status FROM orders WHERE id=:id");q.bind(":id",order);REQUIRE(q.step());REQUIRE(q.columnText(0)=="draft");
}
TEST_CASE("assistant archive keeps historical orders and replays once", "[table][assistant]"){
 ServiceFixture f;pos::handlers::registerTables(f.contextPtr());const auto history=insertDraft(f,"tbl-01",false);f.db().exec("UPDATE orders SET status='closed' WHERE table_id='tbl-01'");const pos::Json p{{"assistantGuard",true},{"assistantExpectedTables",pos::Json::array({assistantSnapshot(f,"tbl-01"),assistantSnapshot(f,"tbl-02")})}};
 REQUIRE(guardedCall(f,pos::protocol::method::kTablesArchiveTable,p,"one-batch")["archivedCount"]==2);const auto replay=guardedCall(f,pos::protocol::method::kTablesArchiveTable,p,"one-batch");REQUIRE(replay["archivedCount"]==2);REQUIRE(replay["idempotentReplay"]==true);REQUIRE(activeTable(f,"tbl-01")==0);auto q=f.db().prepare("SELECT COUNT(*) FROM orders WHERE id=:id");q.bind(":id",history);REQUIRE(q.step());REQUIRE(q.columnInt(0)==1);
}
TEST_CASE("assistant archive checks stale state and native authentication", "[table][assistant]"){
 ServiceFixture f;pos::handlers::registerTables(f.contextPtr());const pos::Json p{{"assistantGuard",true},{"assistantExpectedTables",pos::Json::array({assistantSnapshot(f,"tbl-01"),assistantSnapshot(f,"tbl-02")})}};f.db().exec("UPDATE restaurant_tables SET label='Changed' WHERE id='tbl-02'");REQUIRE_THROWS_AS(guardedCall(f,pos::protocol::method::kTablesArchiveTable,p,"stale-batch"),pos::PosError);REQUIRE(activeTable(f,"tbl-01")==1);f.ctx().session().authenticated=false;REQUIRE_THROWS_AS(guardedCall(f,pos::protocol::method::kTablesArchiveTable,p,"no-auth"),pos::PosError);REQUIRE(activeTable(f,"tbl-01")==1);
}
TEST_CASE("assistant table edits compare snapshots and protect open accounts", "[table][assistant]"){
 ServiceFixture f;pos::handlers::registerTables(f.contextPtr());const auto old=assistantSnapshot(f,"tbl-01");pos::Json p{{"id","tbl-01"},{"label","VIP"},{"areaId","area-vip"},{"seats",6},{"shape",old["shape"]},{"sortOrder",old["sortOrder"]},{"assistantGuard",true},{"assistantExpected",old}};const auto saved=guardedCall(f,pos::protocol::method::kTablesUpsertTable,p,"edit-once");REQUIRE(saved["label"]=="VIP");REQUIRE(saved["seats"]==6);REQUIRE(saved["areaId"]=="area-vip");REQUIRE(guardedCall(f,pos::protocol::method::kTablesUpsertTable,p,"edit-once")["idempotentReplay"]==true);REQUIRE_THROWS_AS(guardedCall(f,pos::protocol::method::kTablesUpsertTable,p,"stale-edit"),pos::PosError);p["assistantExpected"]=assistantSnapshot(f,"tbl-01");p["label"]="Busy";insertDraft(f,"tbl-01",false);REQUIRE_THROWS_AS(guardedCall(f,pos::protocol::method::kTablesUpsertTable,p,"busy-edit"),pos::PosError);REQUIRE(assistantSnapshot(f,"tbl-01")["label"]=="VIP");
}
