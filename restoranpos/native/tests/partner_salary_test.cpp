#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/ReportService.hpp"

/**
 * Partners, tabs and salaries (1.7.22).
 *
 * A bill can close onto a partner's tab ("nisyə"): whatever was not paid goes
 * on their account and the bill counts as settled. An employee's tab comes out
 * of their salary. These cases pin the money: what lands on the tab, what the
 * salary month shows as due, and that the store still loses the dishes.
 */
namespace {

class PartnerFixture {
public:
    PartnerFixture() {
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerGuests(fixture_.contextPtr());
        pos::handlers::registerInventory(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string store() {
        auto row = fixture_.db().prepare(
            "SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
        REQUIRE(row.step());
        return row.columnText(0);
    }

    std::string employee(pos::Money salary) {
        return call("customers.save", pos::Json{{"name", "Elvin"}, {"kind", "employee"},
                                                {"salaryMinor", salary}})
            .at("id").get<std::string>();
    }

    /** `qty` burgers at 7.00 with 150 g of meat each, on one open bill. */
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
        order.bind(":id", orderId).bind(":no", "PRT-" + orderId.substr(0, 8))
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

    pos::Money debtOf(const std::string& customerId) {
        return call("customers.get", pos::Json{{"customerId", customerId}}).at("debtMinor").get<pos::Money>();
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

/** A month around now, and the one after it, as the screen passes them. */
constexpr std::int64_t kDay = 24LL * 60 * 60 * 1000;

}  // namespace

TEST_CASE("a part-paid bill closes onto the partner's tab", "[partners]") {
    PartnerFixture f;
    const auto store = f.store();
    const auto elvin = f.employee(80000);
    const auto [orderId, meat] = f.burgerOrder(2);  // 14.00

    const auto withPartner = f.call("orders.setPartner", pos::Json{{"orderId", orderId}, {"customerId", elvin}});
    REQUIRE(withPartner.at("partnerName") == "Elvin");

    f.call("payments.createCash", pos::Json{{"orderId", orderId}, {"amountMinor", 400}, {"tenderedMinor", 400}});
    const auto closed = f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}});

    REQUIRE(closed.at("status") == "closed");
    REQUIRE(closed.at("accountMinor") == 1000);  // 14.00 - 4.00 paid
    REQUIRE(f.debtOf(elvin) == 1000);
    // The dishes left the store like any settled bill.
    REQUIRE(pos::services::InventoryService(f.fixture().ctx()).levelOf(meat, store) == -300);
}

TEST_CASE("a bill with nothing paid goes on the tab in full", "[partners]") {
    PartnerFixture f;
    const auto guest = f.call("customers.save", pos::Json{{"name", "Nigar"}}).at("id").get<std::string>();
    const auto [orderId, meat] = f.burgerOrder(1);
    (void)meat;
    f.call("orders.setPartner", pos::Json{{"orderId", orderId}, {"customerId", guest}});
    f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}});
    REQUIRE(f.debtOf(guest) == 700);
}

TEST_CASE("a bill cannot go on a tab without a partner", "[partners]") {
    PartnerFixture f;
    const auto [orderId, meat] = f.burgerOrder(1);
    (void)meat;
    REQUIRE_THROWS_AS(f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}}),
                      pos::PosError);
    // And an ordinary close still wants the money.
    REQUIRE_THROWS_AS(f.call("orders.close", pos::Json{{"orderId", orderId}}), pos::PosError);
}

TEST_CASE("the salary month takes the tab and advances off the salary", "[salary]") {
    PartnerFixture f;
    const auto elvin = f.employee(80000);  // 800.00 a month
    const auto [orderId, meat] = f.burgerOrder(2);
    (void)meat;
    f.call("orders.setPartner", pos::Json{{"orderId", orderId}, {"customerId", elvin}});
    f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}});  // 14.00 of meals

    const auto now = pos::nowMs();
    const pos::Json month{{"month", "2026-10"}, {"from", now - kDay}, {"to", now + kDay}};
    const auto rowOf = [&](const pos::Json& list) {
        for (const auto& row : list.at("employees")) if (row.at("id") == elvin) return row;
        FAIL("employee missing");
        return pos::Json();
    };

    auto row = rowOf(f.call("salary.list", month));
    REQUIRE(row.at("mealsMinor") == 1400);
    REQUIRE(row.at("remainingMinor") == 78600);

    f.call("salary.pay", pos::Json{{"customerId", elvin}, {"month", "2026-10"}, {"kind", "advance"},
                                   {"amountMinor", 20000}, {"note", "avans"}});
    row = rowOf(f.call("salary.list", month));
    REQUIRE(row.at("paidMinor") == 20000);
    REQUIRE(row.at("remainingMinor") == 58600);

    f.call("salary.pay", pos::Json{{"customerId", elvin}, {"month", "2026-10"}, {"kind", "full"},
                                   {"amountMinor", 58600}});
    row = rowOf(f.call("salary.list", month));
    REQUIRE(row.at("settled") == true);
    REQUIRE(row.at("remainingMinor") == 0);
    // The meals came out of the salary, so the tab is closed.
    REQUIRE(f.debtOf(elvin) == 0);

    // A new month starts at the full salary again.
    const auto next = rowOf(f.call("salary.list", pos::Json{{"month", "2026-11"},
                                                            {"from", now + 2 * kDay},
                                                            {"to", now + 32 * kDay}}));
    REQUIRE(next.at("paidMinor") == 0);
    REQUIRE(next.at("remainingMinor") == 80000);
}

TEST_CASE("the period report shows the tab as its own way of paying", "[partners][reports]") {
    PartnerFixture f;
    const auto guest = f.call("customers.save", pos::Json{{"name", "Nigar"}}).at("id").get<std::string>();
    const auto [orderId, meat] = f.burgerOrder(1);
    (void)meat;
    f.call("orders.setPartner", pos::Json{{"orderId", orderId}, {"customerId", guest}});
    f.call("orders.close", pos::Json{{"orderId", orderId}, {"toAccount", true}});

    const auto now = pos::nowMs();
    const auto report = pos::services::ReportService(f.fixture().ctx()).periodSummary(now - kDay, now + kDay);
    bool found = false;
    for (const auto& line : report.at("sales").at("byMethod")) {
        if (line.at("method") == "account") {
            found = true;
            REQUIRE(line.at("totalMinor") == 700);
        }
    }
    REQUIRE(found);
}

TEST_CASE("a catalog product's stock item sells at the menu price", "[inventory][partners]") {
    PartnerFixture f;
    auto category = f.fixture().db().prepare("SELECT id FROM menu_categories LIMIT 1");
    REQUIRE(category.step());
    const std::string dish = pos::crypto::uuid4();
    auto item = f.fixture().db().prepare(
        "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, created_at, updated_at) "
        "VALUES (:id, :cat, :sku, 'Kola', 200, 1, :now, :now)");
    item.bind(":id", dish).bind(":cat", category.columnText(0)).bind(":sku", "M-" + dish.substr(0, 8))
        .bind(":now", pos::nowMs());
    item.exec();

    const auto saved = f.call("ingredients.save", pos::Json{{"name", "Kola"}, {"unit", "ədəd"},
                                                            {"costMinor", 90}, {"sku", "MENU-" + dish}});
    const auto id = saved.at("id").get<std::string>();
    const auto listed = [&]() {
        const auto all = f.call("ingredients.list", pos::Json::object());
        for (const auto& row : all.at("ingredients"))
            if (row.at("id") == id) return row;
        FAIL("ingredient missing: " << id << " in " << all.dump().substr(0, 600) << " saved " << saved.dump());
        return pos::Json();
    };
    REQUIRE(listed().at("salePriceMinor") == 200);  // read from the menu

    f.call("ingredients.save", pos::Json{{"id", id}, {"name", "Kola 0.5"}, {"unit", "ədəd"},
                                         {"costMinor", 90}, {"salePriceMinor", 250}});
    auto price = f.fixture().db().prepare("SELECT price_minor FROM menu_items WHERE id = :id");
    price.bind(":id", dish);
    REQUIRE(price.step());
    REQUIRE(price.columnInt(0) == 250);  // and changing it here changes the menu
    REQUIRE(listed().at("name") == "Kola 0.5");
}
