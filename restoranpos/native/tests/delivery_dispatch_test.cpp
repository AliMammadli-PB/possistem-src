#include "pos/services/InventoryService.hpp"
#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

/**
 * Delivery from the floor (1.8.1): "Çatdırılma" opens a bill on a delivery
 * table; the courier takes it either paid at the till or with the guest's
 * money to collect, which then sits on the courier's account until the
 * evening count hands it in.
 */
namespace {

class DeliveryFixture {
public:
    ServiceFixture& fixture() { return fixture_; }

    DeliveryFixture() { fixture_.openTill();
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerGuests(fixture_.contextPtr());
        pos::handlers::registerTables(fixture_.contextPtr());
        pos::handlers::registerDelivery(fixture_.contextPtr());
        pos::handlers::registerBusiness(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** One 7.00 dish on the bill, as the order screen would put it. */
    void addDish(const std::string& orderId) {
        const auto now = pos::nowMs();
        auto category = fixture_.db().prepare("SELECT id FROM menu_categories LIMIT 1");
        REQUIRE(category.step());
        const std::string dish = pos::crypto::uuid4();
        auto item = fixture_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, created_at, updated_at) "
            "VALUES (:id, :cat, :sku, 'Dönər', 700, 1, :now, :now)");
        item.bind(":id", dish).bind(":cat", category.columnText(0)).bind(":sku", "D-" + dish.substr(0, 8)).bind(":now", now);
        item.exec();
        auto line = fixture_.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, unit_price_minor, quantity, "
            "  modifier_total_minor, line_total_minor, status, created_at, updated_at, row_version) "
            "VALUES (:id, :order, :dish, 1, 'Dönər', 700, 1, 0, 700, 'sent', :now, :now, 1)");
        line.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":dish", dish).bind(":now", now);
        line.exec();
        auto open = fixture_.db().prepare("UPDATE orders SET status = 'sent' WHERE id = :id");
        open.bind(":id", orderId);
        open.exec();
    }

    pos::Json delivery(const std::string& id) {
        const auto list = call("delivery.list", pos::Json::object());
        for (const auto& row : list.at("deliveries"))
            if (row.at("id") == id) return row;
        FAIL("delivery missing");
        return {};
    }

    bool tableOnFloor(const std::string& tableId) {
        const auto floor = call("tables.list", pos::Json::object());
        for (const auto& table : floor.at("tables"))
            if (table.at("id") == tableId) return true;
        return false;
    }

    ServiceFixture& base() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("the guest pays the courier: the bill sits on the courier until handed in", "[delivery]") {
    DeliveryFixture f;
    const auto courier = f.call("couriers.save", pos::Json{{"name", "Rauf"}}).at("id").get<std::string>();
    const auto start = f.call("delivery.start", pos::Json{{"address", "Nizami 5"}, {"phone", "050"}, {"customerName", "Aysel"}});
    const auto deliveryId = start.at("id").get<std::string>();
    const auto orderId = start.at("orderId").get<std::string>();
    const auto tableId = start.at("tableId").get<std::string>();
    REQUIRE(f.tableOnFloor(tableId));
    f.addDish(orderId);

    const auto sent = f.call("delivery.dispatch", pos::Json{{"deliveryId", deliveryId}, {"courierId", courier}, {"mode", "courier"}});
    f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}});
    auto row = f.delivery(deliveryId);
    REQUIRE(row.at("money") == "unpaid");
    REQUIRE(row.at("dueMinor") == 700);
    REQUIRE(row.at("courierName") == "Rauf");
    REQUIRE(f.call("customers.get", pos::Json{{"customerId", sent.at("partnerId")}}).at("debtMinor") == 700);
    // The bill is closed, so its table leaves the floor.
    REQUIRE_FALSE(f.tableOnFloor(tableId));

    const auto carrying = f.call("couriers.list", pos::Json::object()).at("couriers")[0];
    REQUIRE(carrying.at("openCount") == 1);
    REQUIRE(carrying.at("dueMinor") == 700);
    f.call("delivery.settle", pos::Json{{"deliveryIds", pos::Json::array({deliveryId})}});
    REQUIRE(f.call("couriers.list", pos::Json::object()).at("couriers")[0].at("openCount") == 0);
    row = f.delivery(deliveryId);
    REQUIRE(row.at("money") == "paid");
    REQUIRE(row.at("status") == "picked_up");
    const auto documents=f.call("business.call",{{"action","documents"}}).at("documents");
    REQUIRE(documents.size()==1);
    REQUIRE(documents[0].at("type")=="courier");
    REQUIRE(documents[0].at("amountMinor")==700);
    const auto detail=f.call("business.call",{{"action","document.get"},{"type","courier"},{"id",deliveryId}}).at("document");
    REQUIRE(detail.at("courierName")=="Rauf");
    REQUIRE(detail.at("order_id")==orderId);
    REQUIRE(f.call("customers.list",{{"kind","customer"}}).at("customers").empty());
    f.call("delivery.setStatus",{{"deliveryId",deliveryId},{"status","delivered"}});
    REQUIRE(f.delivery(deliveryId).at("status")=="delivered");
    REQUIRE(f.call("customers.get", pos::Json{{"customerId", sent.at("partnerId")}}).at("debtMinor") == 0);
    REQUIRE_THROWS_AS(f.call("delivery.settle", pos::Json{{"deliveryIds", pos::Json::array({deliveryId})}}), pos::PosError);

    // The next delivery takes the same table back.
    REQUIRE(f.call("delivery.start", pos::Json{{"address", "Füzuli 3"}}).at("tableId") == tableId);
}

TEST_CASE("paid at the till: closed by the payment, nothing owed by the courier", "[delivery]") {
    DeliveryFixture f;
    const auto courier = f.call("couriers.save", pos::Json{{"name", "Murad"}}).at("id").get<std::string>();
    const auto start = f.call("delivery.start", pos::Json{{"address", "28 May 1"}});
    const auto orderId = start.at("orderId").get<std::string>();
    f.addDish(orderId);
    f.call("delivery.dispatch", pos::Json{{"orderId", orderId}, {"courierId", courier}, {"mode", "paid"}});
    REQUIRE(f.delivery(start.at("id")).at("money") == "open");
    f.call("payments.createCard", pos::Json{{"orderId", orderId}, {"amountMinor", 700}});
    const auto courierStatus=f.call("couriers.list",pos::Json::object()).at("couriers")[0];
    REQUIRE(courierStatus.at("openCount")==0);
    REQUIRE(courierStatus.at("dueMinor")==0);
    f.call("delivery.setStatus",{{"deliveryId",start.at("id")},{"status","delivered"}});
    REQUIRE(f.call("couriers.list",pos::Json::object()).at("couriers")[0].at("openCount")==0);
    const auto row = f.delivery(start.at("id"));
    REQUIRE(row.at("money") == "paid");
    REQUIRE(row.at("dueMinor") == 0);
    REQUIRE_THROWS_AS(f.call("delivery.settle", pos::Json{{"deliveryIds", pos::Json::array({start.at("id")})}}), pos::PosError);
}

TEST_CASE("an order the courier carries takes stock from the branch of the till closing it", "[delivery][warehouse][1106]") {
    DeliveryFixture f;
    f.fixture().db().exec("INSERT INTO warehouses(id,name,created_at,updated_at) VALUES('wh-filial','Filial',1,1)");
    f.fixture().db().exec("INSERT INTO cash_objects(id,name,warehouse_id,created_at) VALUES('filial','Filial','wh-filial',1)");
    auto till = f.fixture().db().prepare("UPDATE cash_accounts SET object_id='filial' WHERE kind='till' AND terminal_id=:terminal");
    till.bind(":terminal", f.fixture().ctx().saleTerminalId()).exec();
    REQUIRE(f.fixture().db().changes() == 1);
    pos::services::InventoryService inventory(f.fixture().ctx());
    f.fixture().db().exec("INSERT INTO ingredients(id,sku,name,unit,created_at,updated_at) VALUES('qa-raw','ING-qa-raw','qa','kg',1,1)");
    f.fixture().db().exec("INSERT OR IGNORE INTO menu_categories(id,name_az) VALUES('qa-c','qa')");
    f.fixture().db().exec("INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,created_at,updated_at) VALUES('qa-menu','qa-c','qa-menu','qa',1,1,1)");
    f.fixture().db().exec("INSERT INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) VALUES('qa-menu','qa-raw',200)");
    f.fixture().db().exec("INSERT INTO orders(id,order_number,user_id,status,opened_at,updated_at) VALUES('qa-order','QA-1','usr-admin','closed',1,1)");
    f.fixture().db().exec("INSERT INTO order_items(id,order_id,product_id,line_seq,name_snapshot,unit_price_minor,quantity,line_total_minor,status,created_at,updated_at) VALUES('qa-line','qa-order','qa-menu',1,'qa',1,1,1,'served',1,1)");
    inventory.consumeOnClose("qa-order");
    REQUIRE(inventory.levelOf("qa-raw", "wh-filial") == -200);
    REQUIRE(inventory.levelOf("qa-raw", "wh-main") == 0);
}
