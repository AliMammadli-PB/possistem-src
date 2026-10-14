#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * Satışlar (1.7.27): a closed bill is a sales invoice. Correcting it moves the
 * money and the stock with it; deleting it takes both back.
 */
namespace {

class SalesFixture {
public:
    SalesFixture() {
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerGuests(fixture_.contextPtr());
        pos::handlers::registerSales(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** The store depletion draws from: the first active one. */
    std::string store() {
        auto row = fixture_.db().prepare(
            "SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
        if (row.step()) return row.columnText(0);
        const std::string id = pos::crypto::uuid4();
        auto insert = fixture_.db().prepare(
            "INSERT INTO warehouses (id, name, kind, active, sort_order, created_at, updated_at) "
            "VALUES (:id, :name, 'store', 1, 0, :now, :now)");
        insert.bind(":id", id).bind(":name", "Anbar " + id.substr(0, 6)).bind(":now", pos::nowMs());
        insert.exec();
        return id;
    }

    /** A burger with 150 g of meat in its recipe, sold `qty` times on one open bill. */
    std::pair<std::string, std::string> burgerOrder(std::int64_t qty) {
        const auto now = pos::nowMs();
        const std::string meat = pos::crypto::uuid4();
        auto ing = fixture_.db().prepare(
            "INSERT INTO ingredients (id, sku, name, unit, cost_minor, created_at, updated_at) "
            "VALUES (:id, :sku, 'Ət', 'kg', 1800, :now, :now)");
        ing.bind(":id", meat).bind(":sku", "ING-" + meat.substr(0, 8)).bind(":now", now);
        ing.exec();

        auto category = fixture_.db().prepare("SELECT id FROM menu_categories LIMIT 1");
        REQUIRE(category.step());
        const std::string dish = pos::crypto::uuid4();
        auto item = fixture_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, "
            "  created_at, updated_at) VALUES (:id, :cat, :sku, 'Burger', 700, 1, :now, :now)");
        item.bind(":id", dish).bind(":cat", category.columnText(0))
            .bind(":sku", "M-" + dish.substr(0, 8)).bind(":now", now);
        item.exec();

        auto recipe = fixture_.db().prepare(
            "INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, qty_milli) "
            "VALUES (:dish, :ing, 150)");
        recipe.bind(":dish", dish).bind(":ing", meat);
        recipe.exec();

        const std::string orderId = pos::crypto::uuid4();
        const pos::Money total = 700 * qty;
        auto order = fixture_.db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
            "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
            "  opened_at, updated_at, row_version) "
            "VALUES (:id, :no, 'usr-admin', 'open', 1, :total, 0, 0, 0, :total, 0, 0, :now, :now, 1)");
        order.bind(":id", orderId).bind(":no", "STK-" + orderId.substr(0, 8))
            .bind(":total", total).bind(":now", now);
        order.exec();

        auto line = fixture_.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "  created_at, updated_at, row_version) "
            "VALUES (:id, :order, :dish, 1, 'Burger', 700, :qty, 0, :total, 'served', :now, :now, 1)");
        line.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":dish", dish)
            .bind(":qty", qty).bind(":total", total).bind(":now", now);
        line.exec();
        return {orderId, meat};
    }

    std::int64_t level(const std::string& ingredient, const std::string& warehouse) {
        return pos::services::InventoryService(fixture_.ctx()).levelOf(ingredient, warehouse);
    }

    pos::Json sale(const std::string& orderId) { return call("sales.get", pos::Json{{"orderId", orderId}}); }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("a corrected sale moves its money and stock", "[sales]") {
    SalesFixture f;
    const auto store = f.store();
    const auto [orderId, meat] = f.burgerOrder(2);
    f.call("payments.createCash", pos::Json{{"orderId", orderId}, {"amountMinor", 1400}, {"tenderedMinor", 1400}});
    REQUIRE(f.level(meat, store) == -300);

    const auto now = pos::nowMs();
    const auto list = f.call("sales.list", pos::Json{{"from", now - 3600000}, {"to", now + 3600000}}).at("sales");
    REQUIRE(list.size() == 1);
    REQUIRE(list[0].at("cashMinor") == 1400);

    // It was one burger, at 6.50.
    const auto line = f.sale(orderId).at("items")[0].at("id").get<std::string>();
    f.call("sales.update", pos::Json{{"orderId", orderId},
        {"lines", pos::Json::array({pos::Json{{"id", line}, {"quantity", 1}, {"unitPriceMinor", 650}}})}});
    const auto fixed = f.sale(orderId);
    REQUIRE(fixed.at("totalMinor") == 650);
    REQUIRE(fixed.at("cashMinor") == 650);
    REQUIRE(f.level(meat, store) == -150);

    // A 1.00 discount comes off what was taken.
    f.call("sales.update", pos::Json{{"orderId", orderId}, {"discountMinor", 100}});
    REQUIRE(f.sale(orderId).at("cashMinor") == 550);
}

TEST_CASE("a deleted sale gives back money and stock", "[sales]") {
    SalesFixture f;
    const auto store = f.store();
    const auto [orderId, meat] = f.burgerOrder(1);
    f.call("payments.createCash", pos::Json{{"orderId", orderId}, {"amountMinor", 700}, {"tenderedMinor", 700}});
    REQUIRE_THROWS_AS(f.call("sales.delete", pos::Json{{"orderId", orderId}}), pos::PosError);
    f.call("sales.delete", pos::Json{{"orderId", orderId}, {"reason", "səhv vurulub"}});
    REQUIRE(f.level(meat, store) == 0);
    const auto gone = f.sale(orderId);
    REQUIRE(gone.at("status") == "voided");
    REQUIRE(gone.at("cashMinor") == 0);
    REQUIRE_THROWS_AS(f.call("sales.update", pos::Json{{"orderId", orderId}, {"note", "x"}}), pos::PosError);
}

TEST_CASE("a sale on a partner's tab: the correction lands on the tab", "[sales]") {
    SalesFixture f;
    f.store();
    const auto [orderId, meat] = f.burgerOrder(2);
    const auto guest = f.call("customers.save", pos::Json{{"name", "Elvin"}}).at("id").get<std::string>();
    const auto other = f.call("customers.save", pos::Json{{"name", "Orxan"}}).at("id").get<std::string>();
    f.call("orders.setPartner", pos::Json{{"orderId", orderId}, {"customerId", guest}});
    f.call("payments.createCash", pos::Json{{"orderId", orderId}, {"amountMinor", 400}, {"tenderedMinor", 400}});
    f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}});
    REQUIRE(f.sale(orderId).at("accountMinor") == 1000);

    const auto line = f.sale(orderId).at("items")[0].at("id").get<std::string>();
    f.call("sales.update", pos::Json{{"orderId", orderId}, {"customerId", other},
        {"lines", pos::Json::array({pos::Json{{"id", line}, {"quantity", 1}}})}});
    const auto fixed = f.sale(orderId);
    REQUIRE(fixed.at("accountMinor") == 300);
    REQUIRE(fixed.at("cashMinor") == 400);
    REQUIRE(f.call("customers.get", pos::Json{{"customerId", guest}}).at("debtMinor") == 0);
    REQUIRE(f.call("customers.get", pos::Json{{"customerId", other}}).at("debtMinor") == 300);
}
