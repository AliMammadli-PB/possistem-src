#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

/**
 * Kalkulyasiya — what a dish costs against what it sells for.
 *
 * The arithmetic existed for one dish at a time in `recipes.get`, so nobody
 * could ask the question an owner actually has: which dishes lose money, and
 * what is the menu's food cost. These cases pin the answers that are easy to
 * get subtly wrong and impossible to notice afterwards:
 *
 *  - a dish with no recipe must not read as costing nothing,
 *  - an ingredient with no price must not make a dish look profitable,
 *  - and neither may be quietly folded into the menu-wide average.
 */
namespace {

class CostingFixture {
public:
    CostingFixture() { pos::handlers::registerInventory(fixture_.contextPtr()); }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** An ingredient with a price per whole unit, in minor units. */
    std::string ingredient(const char* name, pos::Money costMinor) {
        const std::string id = pos::crypto::uuid4();
        auto stmt = fixture_.db().prepare(
            "INSERT INTO ingredients (id, sku, name, unit, cost_minor, created_at, updated_at) "
            "VALUES (:id, :sku, :name, 'kg', :cost, :now, :now)");
        stmt.bind(":id", id).bind(":sku", "ING-" + id.substr(0, 8))
            .bind(":name", std::string(name)).bind(":cost", costMinor).bind(":now", pos::nowMs());
        stmt.exec();
        return id;
    }

    /** A dish at a price, with no recipe yet. */
    std::string dish(const char* name, pos::Money priceMinor) {
        auto category = fixture_.db().prepare("SELECT id FROM menu_categories LIMIT 1");
        REQUIRE(category.step());
        const std::string id = pos::crypto::uuid4();
        auto stmt = fixture_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, "
            "  created_at, updated_at) "
            "VALUES (:id, :cat, :sku, :name, :price, 1, :now, :now)");
        stmt.bind(":id", id).bind(":cat", category.columnText(0))
            .bind(":sku", "M-" + id.substr(0, 8)).bind(":name", std::string(name))
            .bind(":price", priceMinor).bind(":now", pos::nowMs());
        stmt.exec();
        return id;
    }

    void recipeLine(const std::string& dishId, const std::string& ingredientId,
                    std::int64_t qtyMilli) {
        auto stmt = fixture_.db().prepare(
            "INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, qty_milli) "
            "VALUES (:dish, :ing, :qty)");
        stmt.bind(":dish", dishId).bind(":ing", ingredientId).bind(":qty", qtyMilli);
        stmt.exec();
    }

    /** The costing row for one dish, or null when it is not in the answer. */
    pos::Json rowFor(const pos::Json& report, const std::string& dishId) {
        for (const auto& row : report.at("items")) {
            if (row.value("id", std::string{}) == dishId) return row;
        }
        return nullptr;
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("a dish is costed from its recipe at today's prices", "[costing]") {
    CostingFixture f;
    // 18.00/kg meat, 250 g of it; 2.00/kg onion, 100 g. Cost 4.50 + 0.20.
    const auto meat = f.ingredient("Ət", 1800);
    const auto onion = f.ingredient("Soğan", 200);
    const auto kebab = f.dish("Kabab", 1200);
    f.recipeLine(kebab, meat, 250);
    f.recipeLine(kebab, onion, 100);

    const auto row = f.rowFor(f.call("reports.costing", pos::Json::object()), kebab);
    REQUIRE(row.at("hasRecipe") == true);
    REQUIRE(row.at("costMinor") == 470);
    REQUIRE(row.at("marginMinor") == 730);
    // 470 of 1200 is 39.17%, carried as basis points so no float crosses IPC.
    REQUIRE(row.at("foodCostBp") == 3916);
}

TEST_CASE("a dish with no recipe is flagged, not costed at zero", "[costing]") {
    CostingFixture f;
    const auto unknown = f.dish("Çay", 300);

    const auto report = f.call("reports.costing", pos::Json::object());
    const auto row = f.rowFor(report, unknown);
    REQUIRE(row.at("hasRecipe") == false);

    // Zero cost would read as pure profit and drag the menu average down with
    // it - the dish is not cheap, it is an unanswered question.
    REQUIRE(report.at("summary").at("missingRecipes").get<std::int64_t>() >= 1);
    const auto counted = report.at("summary").at("withRecipe").get<std::int64_t>();
    const auto total = report.at("summary").at("dishes").get<std::int64_t>();
    REQUIRE(counted < total);
}

TEST_CASE("an ingredient with no price is called out", "[costing]") {
    CostingFixture f;
    const auto priced = f.ingredient("Düyü", 400);
    const auto free = f.ingredient("Duz", 0);
    const auto plov = f.dish("Plov", 900);
    f.recipeLine(plov, priced, 200);
    f.recipeLine(plov, free, 10);

    const auto report = f.call("reports.costing", pos::Json::object());
    const auto row = f.rowFor(report, plov);
    // The dish still costs what the priced half costs - it is not excluded -
    // but the screen has to be able to say the figure is incomplete.
    REQUIRE(row.at("costMinor") == 80);
    REQUIRE(row.at("unpriced") == true);
    REQUIRE(report.at("summary").at("unpricedIngredients").get<std::int64_t>() >= 1);
}

TEST_CASE("a dish priced below its cost is counted as losing money", "[costing]") {
    CostingFixture f;
    const auto meat = f.ingredient("Ət", 2000);
    const auto burger = f.dish("Burger", 1000);
    f.recipeLine(burger, meat, 600);  // 12.00 of meat in a 10.00 burger

    const auto report = f.call("reports.costing", pos::Json::object());
    const auto row = f.rowFor(report, burger);
    REQUIRE(row.at("costMinor") == 1200);
    REQUIRE(row.at("marginMinor") == -200);
    REQUIRE(row.at("foodCostBp") == 12000);  // 120%
    REQUIRE(report.at("summary").at("losingMoney").get<std::int64_t>() >= 1);
}

TEST_CASE("the menu-wide food cost leaves the unknowns out", "[costing]") {
    CostingFixture f;
    const auto meat = f.ingredient("Ət", 1000);
    const auto costed = f.dish("Şiş", 1000);
    f.recipeLine(costed, meat, 300);   // cost 3.00 against 10.00
    f.dish("Limonad", 500);            // no recipe at all

    const auto summary = f.call("reports.costing", pos::Json::object()).at("summary");
    // Folding the un-costed dish in at zero would report a cheaper menu than
    // the restaurant actually runs, which is the wrong direction to be wrong in.
    const auto bp = summary.at("foodCostBp").get<std::int64_t>();
    REQUIRE(bp > 0);
    REQUIRE(bp <= 10000);
}

TEST_CASE("lifetime profit is sold portions times today's recipe margin", "[costing]") {
    CostingFixture f;
    // 0.12 maya, 7.00 satış → 6.88 qazanc / porsiya. Üç satış = 20.64.
    const auto bun = f.ingredient("Çörək", 1200);  // 12.00/kg
    const auto burger = f.dish("Burger Toyuq", 700);
    f.recipeLine(burger, bun, 10);  // 10 g → cost 0.12

    const auto now = pos::nowMs();
    const auto orderId = pos::crypto::uuid4();
    auto order = f.fixture().db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
        "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
        "  opened_at, updated_at, row_version) "
        "VALUES (:id, 'INV-COST-1', 'usr-admin', 'paid', 1, 2100, 0, 0, 0, 2100, 2100, 0, "
        "  :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();

    auto item = f.fixture().db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  complimentary, created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Burger Toyuq', 700, 3, 0, 2100, 'served', 0, "
        "  :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":product", burger)
        .bind(":now", now);
    item.exec();

    const auto row = f.rowFor(f.call("reports.costing", pos::Json::object()), burger);
    REQUIRE(row.at("costMinor") == 12);
    REQUIRE(row.at("marginMinor") == 688);
    REQUIRE(row.at("soldQty") == 3);
    REQUIRE(row.at("revenueMinor") == 2100);
    // 21.00 revenue − 3 × 0.12 maya = 20.64
    REQUIRE(row.at("totalProfitMinor") == 2064);
}
