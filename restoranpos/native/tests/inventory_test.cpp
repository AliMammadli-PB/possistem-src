#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * Stock for a restaurant: ingredients are bought, dishes are sold, and a recipe
 * joins the two. Quantities are thousandths of the base unit.
 */
namespace {

class InventoryFixture {
public:
    InventoryFixture() {
        pos::handlers::registerInventory(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
    }

    pos::Json call(std::string_view method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(method);
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string makeIngredient(const char* name, std::int64_t costMinor = 1000,
                               std::int64_t minQty = 0) {
        return call(pos::protocol::method::kIngredientsSave,
                    pos::Json{{"name", name}, {"unit", "kg"}, {"costMinor", costMinor},
                              {"minQtyMilli", minQty}})
            .at("id")
            .get<std::string>();
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("a fresh till has one store and no stock", "[inventory]") {
    InventoryFixture f;
    const auto warehouses = f.call(pos::protocol::method::kWarehousesList, pos::Json::object());

    REQUIRE(warehouses.at("warehouses").size() == 1);
    REQUIRE(warehouses.at("warehouses")[0].at("id") == "wh-main");
}

TEST_CASE("receiving and issuing stock leaves a ledger that explains the balance",
          "[inventory][money]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");

    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(beef, "wh-main", 10000, "receipt", "", "ilk alış");   // 10 kg
    inventory.move(beef, "wh-main", -2500, "issue", "", "mətbəxə");      // 2.5 kg

    REQUIRE(inventory.levelOf(beef, "wh-main") == 7500);

    // The projection must equal the ledger, or a discrepancy can never be
    // investigated.
    auto sum = f.fixture().db().prepare(
        "SELECT COALESCE(SUM(qty_delta_milli), 0) FROM stock_movements WHERE ingredient_id = :id");
    sum.bind(":id", beef);
    sum.step();
    REQUIRE(sum.columnInt(0) == 7500);
}

TEST_CASE("portal stock command is applied once after a retry", "[inventory][idempotency]") {
    InventoryFixture f;
    const auto ingredient = f.makeIngredient("Təkrar sınağı");
    const pos::Json payload{{"ingredientId", ingredient}, {"warehouseId", "wh-main"},
                            {"qtyDeltaMilli", 1000}, {"reason", "portal"},
                            {"idempotencyKey", "portal-11111111-1111-4111-8111-111111111111"}};
    const auto first = f.call(pos::protocol::method::kInventoryAdjust, payload);
    const auto again = f.call(pos::protocol::method::kInventoryAdjust, payload);
    REQUIRE(first.at("qtyMilli") == 1000);
    REQUIRE(again.at("idempotentReplay") == true);
    REQUIRE(pos::services::InventoryService(f.fixture().ctx()).levelOf(ingredient, "wh-main") == 1000);
}

TEST_CASE("selling a dish consumes what its recipe says", "[inventory][recipe]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");
    const auto salt = f.makeIngredient("Duz");

    auto dish = f.fixture().db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(dish.step());
    const std::string dishId = dish.columnText(0);

    f.call(pos::protocol::method::kRecipesSave,
           pos::Json{{"menuItemId", dishId},
                     {"lines", pos::Json::array({pos::Json{{"ingredientId", beef}, {"qtyMilli", 250}},
                                                 pos::Json{{"ingredientId", salt}, {"qtyMilli", 5}}})}});

    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(beef, "wh-main", 10000, "receipt");
    inventory.move(salt, "wh-main", 1000, "receipt");

    // Two of the dish on one bill.
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = f.fixture().db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
        "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
        "  opened_at, updated_at, row_version) "
        "VALUES (:id, 'INV-1', 'usr-admin', 'open', 2, 0,0,0,0,0,0,0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();

    auto item = f.fixture().db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Yemək', 1000, 2, 0, 2000, 'sent', :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":product", dishId)
        .bind(":now", now);
    item.exec();

    inventory.consumeForOrder(orderId, "wh-main");

    REQUIRE(inventory.levelOf(beef, "wh-main") == 10000 - 500);  // 2 x 250
    REQUIRE(inventory.levelOf(salt, "wh-main") == 1000 - 10);    // 2 x 5
}

TEST_CASE("a voided line consumes nothing", "[inventory][recipe]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");

    auto dish = f.fixture().db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(dish.step());
    const std::string dishId = dish.columnText(0);

    f.call(pos::protocol::method::kRecipesSave,
           pos::Json{{"menuItemId", dishId},
                     {"lines", pos::Json::array({pos::Json{{"ingredientId", beef},
                                                           {"qtyMilli", 250}}})}});

    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(beef, "wh-main", 10000, "receipt");

    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = f.fixture().db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
        "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
        "  opened_at, updated_at, row_version) "
        "VALUES (:id, 'INV-2', 'usr-admin', 'open', 2, 0,0,0,0,0,0,0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();
    auto item = f.fixture().db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Yemək', 1000, 1, 0, 1000, 'voided', :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":product", dishId)
        .bind(":now", now);
    item.exec();

    inventory.consumeForOrder(orderId, "wh-main");
    REQUIRE(inventory.levelOf(beef, "wh-main") == 10000);
}

TEST_CASE("a transfer moves stock and never loses it", "[inventory]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");
    const auto bar = f.call(pos::protocol::method::kWarehousesSave,
                            pos::Json{{"name", "Bar anbarı"}, {"kind", "bar"}})
                         .at("id")
                         .get<std::string>();

    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(beef, "wh-main", 5000, "receipt");

    f.call(pos::protocol::method::kInventoryTransfer,
           pos::Json{{"ingredientId", beef}, {"fromWarehouseId", "wh-main"},
                     {"toWarehouseId", bar}, {"qtyMilli", 2000}});

    REQUIRE(inventory.levelOf(beef, "wh-main") == 3000);
    REQUIRE(inventory.levelOf(beef, bar) == 2000);
    // Both legs share one reference, so the pair can be read back as one move.
    auto pair = f.fixture().db().prepare(
        "SELECT COUNT(DISTINCT reference_id) FROM stock_movements "
        "WHERE kind IN ('transfer_in','transfer_out')");
    pair.step();
    REQUIRE(pair.columnInt(0) == 1);
}

TEST_CASE("a transfer to the same store is refused", "[inventory]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");

    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kInventoryTransfer,
                             pos::Json{{"ingredientId", beef},
                                       {"fromWarehouseId", "wh-main"},
                                       {"toWarehouseId", "wh-main"},
                                       {"qtyMilli", 100}}),
                      pos::PosError);
}

TEST_CASE("waste is its own kind, and needs a reason", "[inventory]") {
    InventoryFixture f;
    const auto milk = f.makeIngredient("Süd");

    pos::services::InventoryService(f.fixture().ctx()).move(milk, "wh-main", 5000, "receipt");

    // "What did we throw away this month" is a question an owner asks, so waste
    // must not hide inside generic adjustments.
    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kInventoryWaste,
                             pos::Json{{"ingredientId", milk}, {"qtyMilli", 1000}}),
                      pos::PosError);

    f.call(pos::protocol::method::kInventoryWaste,
           pos::Json{{"ingredientId", milk}, {"qtyMilli", 1000}, {"reason", "Vaxtı keçib"}});

    auto waste = f.fixture().db().prepare(
        "SELECT COALESCE(SUM(-qty_delta_milli), 0) FROM stock_movements WHERE kind = 'waste'");
    waste.step();
    REQUIRE(waste.columnInt(0) == 1000);
}

TEST_CASE("low stock reports what is at or below its minimum", "[inventory]") {
    InventoryFixture f;
    const auto flour = f.makeIngredient("Un", 500, 2000);
    const auto sugar = f.makeIngredient("Şəkər", 400, 1000);

    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(flour, "wh-main", 1500, "receipt");  // below its 2000 minimum
    inventory.move(sugar, "wh-main", 5000, "receipt");  // comfortably above

    const auto low = f.call(pos::protocol::method::kInventoryLowStock, pos::Json::object());
    REQUIRE(low.at("ingredients").size() == 1);
    REQUIRE(low.at("ingredients")[0].at("id") == flour);
}

TEST_CASE("stock is valued at what it cost", "[inventory][money]") {
    InventoryFixture f;
    // 12.00 per kg.
    const auto beef = f.makeIngredient("Mal əti", 1200);
    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(beef, "wh-main", 2500, "receipt");  // 2.5 kg

    const auto valuation =
        f.call(pos::protocol::method::kInventoryValuation, pos::Json{{"warehouseId", "wh-main"}});
    REQUIRE(valuation.at("totalMinor") == 3000);  // 2.5 * 12.00
}

TEST_CASE("a recipe reports what the dish costs to make", "[inventory][recipe]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti", 1200);
    const auto salt = f.makeIngredient("Duz", 100);

    auto dish = f.fixture().db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(dish.step());
    const std::string dishId = dish.columnText(0);

    f.call(pos::protocol::method::kRecipesSave,
           pos::Json{{"menuItemId", dishId},
                     {"lines", pos::Json::array({pos::Json{{"ingredientId", beef}, {"qtyMilli", 250}},
                                                 pos::Json{{"ingredientId", salt}, {"qtyMilli", 10}}})}});

    const auto recipe = f.call(pos::protocol::method::kRecipesGet,
                               pos::Json{{"menuItemId", dishId}});
    // 0.25 kg * 12.00 = 3.00, plus 0.01 kg * 1.00 = 0.01
    REQUIRE(recipe.at("costMinor") == 301);
    REQUIRE(recipe.at("lines").size() == 2);
}

TEST_CASE("saving a recipe replaces it rather than adding to it", "[inventory][recipe]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");
    const auto salt = f.makeIngredient("Duz");

    auto dish = f.fixture().db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(dish.step());
    const std::string dishId = dish.columnText(0);

    f.call(pos::protocol::method::kRecipesSave,
           pos::Json{{"menuItemId", dishId},
                     {"lines", pos::Json::array({pos::Json{{"ingredientId", beef}, {"qtyMilli", 250}},
                                                 pos::Json{{"ingredientId", salt}, {"qtyMilli", 10}}})}});

    // A removed line has to actually stop consuming stock.
    f.call(pos::protocol::method::kRecipesSave,
           pos::Json{{"menuItemId", dishId},
                     {"lines", pos::Json::array({pos::Json{{"ingredientId", beef},
                                                           {"qtyMilli", 300}}})}});

    const auto recipe = f.call(pos::protocol::method::kRecipesGet,
                               pos::Json{{"menuItemId", dishId}});
    REQUIRE(recipe.at("lines").size() == 1);
    REQUIRE(recipe.at("lines")[0].at("qtyMilli") == 300);
}

TEST_CASE("receiving a purchase puts stock in and money on the account",
          "[inventory][purchase][money]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti", 1000);

    const auto supplier = f.call(pos::protocol::method::kSuppliersSave,
                                 pos::Json{{"name", "Ət Market MMC"}})
                              .at("id")
                              .get<std::string>();

    // 10 kg at 12.00 per kg = 120.00
    const auto purchase =
        f.call(pos::protocol::method::kPurchasesSave,
               pos::Json{{"supplierId", supplier},
                         {"lines", pos::Json::array({pos::Json{{"ingredientId", beef},
                                                               {"qtyMilli", 10000},
                                                               {"unitCostMinor", 1200}}})}});
    REQUIRE(purchase.at("totalMinor") == 12000);

    const auto id = purchase.at("id").get<std::string>();
    f.call(pos::protocol::method::kPurchasesReceive, pos::Json{{"purchaseId", id}});

    pos::services::InventoryService inventory(f.fixture().ctx());
    REQUIRE(inventory.levelOf(beef, "wh-main") == 10000);

    // The last price paid becomes the ingredient's cost, which valuation and
    // recipe costing both read.
    auto cost = f.fixture().db().prepare("SELECT cost_minor FROM ingredients WHERE id = :id");
    cost.bind(":id", beef);
    cost.step();
    REQUIRE(cost.columnInt(0) == 1200);

    const auto ledger = f.call(pos::protocol::method::kSuppliersLedger,
                               pos::Json{{"supplierId", supplier}});
    REQUIRE(ledger.at("dueMinor") == 12000);
}

TEST_CASE("a purchase cannot be received twice", "[inventory][purchase]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");
    const auto supplier = f.call(pos::protocol::method::kSuppliersSave,
                                 pos::Json{{"name", "Təchizatçı"}})
                              .at("id")
                              .get<std::string>();
    const auto id = f.call(pos::protocol::method::kPurchasesSave,
                           pos::Json{{"supplierId", supplier},
                                     {"lines", pos::Json::array({pos::Json{
                                          {"ingredientId", beef}, {"qtyMilli", 1000},
                                          {"unitCostMinor", 100}}})}})
                        .at("id")
                        .get<std::string>();

    f.call(pos::protocol::method::kPurchasesReceive, pos::Json{{"purchaseId", id}});
    // Twice would double both the stock and the invoice.
    REQUIRE_THROWS_AS(
        f.call(pos::protocol::method::kPurchasesReceive, pos::Json{{"purchaseId", id}}),
        pos::PosError);
}

TEST_CASE("a portal purchase retry changes stock and debt once", "[inventory][purchase][idempotency]") {
    InventoryFixture f;
    const auto ingredient = f.makeIngredient("Düyü");
    const auto supplier = f.call(pos::protocol::method::kSuppliersSave,
                                 pos::Json{{"name", "Sınaq təchizatçı"}})
                              .at("id").get<std::string>();
    const pos::Json order{{"supplierId", supplier}, {"warehouseId", "wh-main"},
                          {"idempotencyKey", "portal-order-test"},
                          {"lines", pos::Json::array({pos::Json{{"ingredientId", ingredient},
                            {"qtyMilli", 2000}, {"unitCostMinor", 500}}})}};
    const auto first = f.call(pos::protocol::method::kPurchasesSave, order);
    const auto second = f.call(pos::protocol::method::kPurchasesSave, order);
    REQUIRE(first.at("id") == second.at("id"));
    const pos::Json receipt{{"purchaseId", first.at("id")},
                            {"idempotencyKey", "portal-receipt-test"}};
    f.call(pos::protocol::method::kPurchasesReceive, receipt);
    f.call(pos::protocol::method::kPurchasesReceive, receipt);
    const auto due = f.call(pos::protocol::method::kSuppliersLedger,
                            pos::Json{{"supplierId", supplier}});
    REQUIRE(due.at("dueMinor") == 1000);
}

TEST_CASE("paying a supplier reduces what is owed", "[inventory][purchase][money]") {
    InventoryFixture f;
    const auto beef = f.makeIngredient("Mal əti");
    const auto supplier = f.call(pos::protocol::method::kSuppliersSave,
                                 pos::Json{{"name", "Təchizatçı"}})
                              .at("id")
                              .get<std::string>();
    const auto id = f.call(pos::protocol::method::kPurchasesSave,
                           pos::Json{{"supplierId", supplier},
                                     {"lines", pos::Json::array({pos::Json{
                                          {"ingredientId", beef}, {"qtyMilli", 10000},
                                          {"unitCostMinor", 1000}}})}})
                        .at("id")
                        .get<std::string>();
    f.call(pos::protocol::method::kPurchasesReceive, pos::Json{{"purchaseId", id}});

    const pos::Json payment{{"supplierId", supplier}, {"amountMinor", 4000},
                            {"idempotencyKey", "portal-supplier-payment-test"}};
    f.call(pos::protocol::method::kSuppliersPay, payment);
    f.call(pos::protocol::method::kSuppliersPay, payment);

    const auto ledger = f.call(pos::protocol::method::kSuppliersLedger,
                               pos::Json{{"supplierId", supplier}});
    REQUIRE(ledger.at("dueMinor") == 6000);
    const auto payments = f.call(pos::protocol::method::kSuppliersPayments, pos::Json::object());
    REQUIRE(payments.at("payments").size() == 1);
}

TEST_CASE("a stocktake posts only what was counted", "[inventory][stocktake]") {
    InventoryFixture f;
    const auto flour = f.makeIngredient("Un");
    const auto sugar = f.makeIngredient("Şəkər");

    pos::services::InventoryService inventory(f.fixture().ctx());
    inventory.move(flour, "wh-main", 5000, "receipt");
    inventory.move(sugar, "wh-main", 3000, "receipt");

    const auto takeId = f.call(pos::protocol::method::kStocktakeCreate, pos::Json::object())
                            .at("id")
                            .get<std::string>();
    const auto detail = f.call(pos::protocol::method::kStocktakeGet,
                               pos::Json{{"stocktakeId", takeId}});

    // Count the flour short; leave the sugar untouched.
    for (const auto& line : detail.at("lines")) {
        if (line.at("ingredientId") == flour) {
            f.call(pos::protocol::method::kStocktakeCount,
                   pos::Json{{"lineId", line.at("id")}, {"countedMilli", 4200}});
        }
    }

    const auto posted = f.call(pos::protocol::method::kStocktakePost,
                               pos::Json{{"stocktakeId", takeId}});
    REQUIRE(posted.at("adjusted") == 1);
    REQUIRE(inventory.levelOf(flour, "wh-main") == 4200);
    // An uncounted line means "we did not reach that shelf", not "there is none".
    REQUIRE(inventory.levelOf(sugar, "wh-main") == 3000);
}

TEST_CASE("a stocktake cannot be posted twice", "[inventory][stocktake]") {
    InventoryFixture f;
    f.makeIngredient("Un");
    const auto takeId = f.call(pos::protocol::method::kStocktakeCreate, pos::Json::object())
                            .at("id")
                            .get<std::string>();
    f.call(pos::protocol::method::kStocktakePost, pos::Json{{"stocktakeId", takeId}});
    REQUIRE_THROWS_AS(
        f.call(pos::protocol::method::kStocktakePost, pos::Json{{"stocktakeId", takeId}}),
        pos::PosError);
}
