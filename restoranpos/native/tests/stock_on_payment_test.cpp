#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * A paid dish leaves the store.
 *
 * Depletion lived only in `orders.close`, but a bill that is paid in full is
 * closed by the payment itself, and `orders.close` then returns early on an
 * already-closed order. So the ordinary path - take the money, table frees -
 * never touched stock. These cases pin both roads and that neither doubles up.
 */
namespace {

class StockFixture {
public:
    StockFixture() {
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

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("paying a bill in full takes its dishes out of the store", "[stock]") {
    StockFixture f;
    const auto store = f.store();
    const auto [orderId, meat] = f.burgerOrder(2);

    f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                            {"amountMinor", 1400},
                                            {"tenderedMinor", 1400}});

    // Two burgers at 150 g each.
    REQUIRE(f.level(meat, store) == -300);
}

TEST_CASE("closing by hand after payment does not take the stock twice", "[stock]") {
    StockFixture f;
    const auto store = f.store();
    const auto [orderId, meat] = f.burgerOrder(1);

    f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                            {"amountMinor", 700},
                                            {"tenderedMinor", 700}});
    f.call("orders.close", pos::Json{{"orderId", orderId}});
    pos::services::InventoryService(f.fixture().ctx()).consumeOnClose(orderId);

    REQUIRE(f.level(meat, store) == -150);
}

TEST_CASE("a part payment leaves the store alone", "[stock]") {
    StockFixture f;
    const auto store = f.store();
    const auto [orderId, meat] = f.burgerOrder(1);

    f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                            {"amountMinor", 300},
                                            {"tenderedMinor", 300}});

    // The guest may still send the dish back; nothing has left yet.
    REQUIRE(f.level(meat, store) == 0);
}
