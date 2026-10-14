#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * Alışlar (1.7.25): an invoice puts goods in the store and its total on the
 * supplier's debt; a return takes goods out and the same money off; a payment
 * takes money off. Debt may stay partly open.
 */
namespace {

class PurchaseFixture {
public:
    PurchaseFixture() {
        pos::handlers::registerInventory(fixture_.contextPtr());
        pos::handlers::registerCashAccounts(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string ingredient(const char* name) {
        return call("ingredients.save", pos::Json{{"name", name}, {"unit", "kg"}, {"costMinor", 0}})
            .at("id").get<std::string>();
    }

    pos::Money due(const std::string& supplierId) {
        return call("suppliers.ledger", pos::Json{{"supplierId", supplierId}}).at("dueMinor").get<pos::Money>();
    }

    std::int64_t stockIn(const std::string& ingredientId, const std::string& warehouseId) {
        return pos::services::InventoryService(fixture_.ctx()).levelOf(ingredientId, warehouseId);
    }

    std::int64_t stock(const std::string& ingredientId) {
        auto store = fixture_.db().prepare(
            "SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
        REQUIRE(store.step());
        return pos::services::InventoryService(fixture_.ctx()).levelOf(ingredientId, store.columnText(0));
    }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("an invoice is debt, a return and a payment take it off", "[purchases]") {
    PurchaseFixture f;
    const auto supplier = f.call("suppliers.save", pos::Json{{"name", "Bazar MMC"}}).at("id").get<std::string>();
    const auto tomato = f.ingredient("Pomidor");
    const auto egg = f.ingredient("Yumurta");

    // 10 kg tomatoes at 2.00 and 30 kg eggs-by-weight at 1.50: 20.00 + 45.00 = 65.00 owed.
    const auto invoice = f.call("purchases.save", pos::Json{{"supplierId", supplier},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", tomato}, {"qtyMilli", 10000}, {"unitCostMinor", 200}},
                                    pos::Json{{"ingredientId", egg}, {"qtyMilli", 30000}, {"unitCostMinor", 150}}})}})
                             .at("id").get<std::string>();
    f.call("purchases.receive", pos::Json{{"purchaseId", invoice}});
    REQUIRE(f.due(supplier) == 6500);
    REQUIRE(f.stock(tomato) == 10000);

    // 4 kg of tomatoes go back at the invoice price: 8.00 off the debt.
    const auto back = f.call("purchases.return", pos::Json{{"supplierId", supplier}, {"purchaseId", invoice},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", tomato}, {"qtyMilli", 4000}}})}});
    REQUIRE(back.at("totalMinor") == 800);
    REQUIRE(f.due(supplier) == 5700);
    REQUIRE(f.stock(tomato) == 6000);

    // The invoice remembers what went back, and no more than was bought can go.
    const auto lines = f.call("purchases.get", pos::Json{{"purchaseId", invoice}}).at("lines");
    for (const auto& line : lines)
        if (line.at("ingredientId") == tomato) REQUIRE(line.at("returnedMilli") == 4000);
    REQUIRE_THROWS_AS(f.call("purchases.return", pos::Json{{"supplierId", supplier}, {"purchaseId", invoice},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", tomato}, {"qtyMilli", 7000}}})}}), pos::PosError);

    // Part of it paid; the rest stays owed.
    f.call("suppliers.pay", pos::Json{{"supplierId", supplier}, {"amountMinor", 2000}});
    REQUIRE(f.due(supplier) == 3700);

    // A return without an invoice, at a price typed in.
    f.call("purchases.return", pos::Json{{"supplierId", supplier},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", egg}, {"qtyMilli", 2000}, {"unitCostMinor", 150}}})}});
    REQUIRE(f.due(supplier) == 3400);
    REQUIRE(f.call("purchases.returns", pos::Json{{"supplierId", supplier}}).at("returns").size() == 2);
}

TEST_CASE("goods that are not in the store cannot go back", "[purchases]") {
    PurchaseFixture f;
    const auto supplier = f.call("suppliers.save", pos::Json{{"name", "Ət evi"}}).at("id").get<std::string>();
    const auto meat = f.ingredient("Mal əti");
    REQUIRE_THROWS_AS(f.call("purchases.return", pos::Json{{"supplierId", supplier},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", meat}, {"qtyMilli", 1000}, {"unitCostMinor", 1200}}})}}),
        pos::PosError);
}

TEST_CASE("a received invoice can be corrected: stock, debt and supplier follow", "[purchases]") {
    PurchaseFixture f;
    const auto first = f.call("suppliers.save", pos::Json{{"name", "Səhv MMC"}}).at("id").get<std::string>();
    const auto right = f.call("suppliers.save", pos::Json{{"name", "Düz MMC"}}).at("id").get<std::string>();
    const auto onion = f.ingredient("Soğan");
    const auto invoice = f.call("purchases.save", pos::Json{{"supplierId", first},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", onion}, {"qtyMilli", 10000}, {"unitCostMinor", 100}}})}})
                             .at("id").get<std::string>();
    f.call("purchases.receive", pos::Json{{"purchaseId", invoice}});
    REQUIRE(f.due(first) == 1000);

    // It was 12 kg at 1.50 from the other supplier.
    f.call("purchases.update", pos::Json{{"purchaseId", invoice}, {"supplierId", right},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", onion}, {"qtyMilli", 12000}, {"unitCostMinor", 150}}})}});
    REQUIRE(f.due(first) == 0);
    REQUIRE(f.due(right) == 1800);
    REQUIRE(f.stock(onion) == 12000);

    // After 2 kg went back, the invoice cannot drop below 2 kg.
    f.call("purchases.return", pos::Json{{"supplierId", right}, {"purchaseId", invoice},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", onion}, {"qtyMilli", 2000}}})}});
    REQUIRE(f.due(right) == 1500);
    REQUIRE_THROWS_AS(f.call("purchases.update", pos::Json{{"purchaseId", invoice}, {"supplierId", right},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", onion}, {"qtyMilli", 1000}, {"unitCostMinor", 150}}})}}),
        pos::PosError);
    // Price fix only: 12 kg at 1.40 = 16.80, minus the 3.00 return.
    f.call("purchases.update", pos::Json{{"purchaseId", invoice}, {"supplierId", right},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", onion}, {"qtyMilli", 12000}, {"unitCostMinor", 140}}})}});
    REQUIRE(f.due(right) == 1380);
    REQUIRE(f.stock(onion) == 10000);
}

TEST_CASE("each branch buys into its own store", "[purchases]") {
    PurchaseFixture f;
    const auto supplier = f.call("suppliers.save", pos::Json{{"name", "Un MMC"}}).at("id").get<std::string>();
    const auto flour = f.ingredient("Un");
    const auto may = f.call("cashObjects.save", pos::Json{{"name", "28 May"}}).at("warehouseId").get<std::string>();
    const auto hazi = f.call("cashObjects.save", pos::Json{{"name", "Həzi Aslanov"}}).at("warehouseId").get<std::string>();
    REQUIRE(may != hazi);
    const auto buy = [&](const std::string& store, std::int64_t qty) {
        const auto id = f.call("purchases.save", pos::Json{{"supplierId", supplier}, {"warehouseId", store},
            {"lines", pos::Json::array({pos::Json{{"ingredientId", flour}, {"qtyMilli", qty}, {"unitCostMinor", 100}}})}})
                            .at("id").get<std::string>();
        f.call("purchases.receive", pos::Json{{"purchaseId", id}});
    };
    buy(may, 100000);
    buy(hazi, 200000);
    REQUIRE(f.stockIn(flour, may) == 100000);
    REQUIRE(f.stockIn(flour, hazi) == 200000);

    f.call("purchases.return", pos::Json{{"supplierId", supplier}, {"warehouseId", hazi},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", flour}, {"qtyMilli", 5000}, {"unitCostMinor", 100}}})}});
    REQUIRE(f.stockIn(flour, hazi) == 195000);
    REQUIRE(f.stockIn(flour, may) == 100000);
}

TEST_CASE("a return can be corrected or deleted, an invoice deleted", "[purchases]") {
    PurchaseFixture f;
    const auto supplier = f.call("suppliers.save", pos::Json{{"name", "Süd MMC"}}).at("id").get<std::string>();
    const auto milk = f.ingredient("Süd");
    const auto invoice = f.call("purchases.save", pos::Json{{"supplierId", supplier},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", milk}, {"qtyMilli", 10000}, {"unitCostMinor", 100}}})}})
                             .at("id").get<std::string>();
    f.call("purchases.receive", pos::Json{{"purchaseId", invoice}});
    const auto back = f.call("purchases.return", pos::Json{{"supplierId", supplier}, {"purchaseId", invoice},
        {"lines", pos::Json::array({pos::Json{{"ingredientId", milk}, {"qtyMilli", 2000}}})}});
    REQUIRE(f.due(supplier) == 800);

    // It was 3 kg, same number.
    const auto fixed = f.call("purchases.return", pos::Json{{"supplierId", supplier}, {"purchaseId", invoice},
        {"replaceReturnId", back.at("id")}, {"lines", pos::Json::array({pos::Json{{"ingredientId", milk}, {"qtyMilli", 3000}}})}});
    REQUIRE(fixed.at("number") == back.at("number"));
    REQUIRE(f.due(supplier) == 700);
    REQUIRE(f.stock(milk) == 7000);

    REQUIRE_THROWS_AS(f.call("purchases.delete", pos::Json{{"purchaseId", invoice}}), pos::PosError);
    f.call("purchases.deleteReturn", pos::Json{{"returnId", fixed.at("id")}});
    REQUIRE(f.due(supplier) == 1000);
    f.call("purchases.delete", pos::Json{{"purchaseId", invoice}});
    REQUIRE(f.due(supplier) == 0);
    REQUIRE(f.stock(milk) == 0);
}
