#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * 1.7.28 — purchasing the way a restaurant actually receives goods:
 *  1. orders arrive in parts, refused goods never enter, quarantined goods wait
 *     for a check, the supplier is owed for what was accepted at the confirmed
 *     invoice price plus the delivery they bill;
 *  2. a store falling to its minimum drafts a purchase with the best supplier,
 *     once, and nothing is ordered until a person confirms it;
 *  3. lots with expiry dates are used first-expiring-first-out, can be moved
 *     between places and stores without losing their dates;
 *  4. recipes cost by weighted average, FIFO or last price; delivery costs land
 *     on the goods; the loss and supplier reports add up.
 */
namespace {

class ProcFixture {
public:
    ProcFixture() { pos::handlers::registerInventory(fixture_.contextPtr()); }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string ingredient(const char* name, const char* unit = "kg") {
        return call("ingredients.save", pos::Json{{"name", name}, {"unit", unit}, {"costMinor", 0}}).at("id").get<std::string>();
    }
    std::string supplier(const char* name) {
        return call("suppliers.save", pos::Json{{"name", name}}).at("id").get<std::string>();
    }
    std::string store() {
        auto row = fixture_.db().prepare("SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
        REQUIRE(row.step());
        return row.columnText(0);
    }
    std::string secondStore() {
        auto insert = fixture_.db().prepare(
            "INSERT INTO warehouses (id, name, kind, active, sort_order, created_at, updated_at) "
            "VALUES ('wh-two', 'Filial 2', 'store', 1, 100, 0, 0)");
        insert.exec();
        return "wh-two";
    }
    std::int64_t stock(const std::string& ingredientId, const std::string& warehouse = "") {
        return pos::services::InventoryService(fixture_.ctx()).levelOf(ingredientId, warehouse.empty() ? store() : warehouse);
    }
    std::int64_t lotSum(const std::string& ingredientId, const std::string& warehouse) {
        auto row = fixture_.db().prepare(
            "SELECT COALESCE(SUM(qty_milli), 0) FROM stock_lots WHERE ingredient_id = :i AND warehouse_id = :w "
            "AND quality = 'accepted' AND blocked_at IS NULL");
        row.bind(":i", ingredientId).bind(":w", warehouse);
        row.step();
        return row.columnInt(0);
    }
    pos::Money due(const std::string& supplierId) {
        return call("suppliers.ledger", pos::Json{{"supplierId", supplierId}}).at("dueMinor").get<pos::Money>();
    }
    /** An order (not received) of the given lines: {ingredientId, qtyMilli, unitCostMinor}. */
    std::string order(const std::string& supplierId, pos::Json lines, const std::string& warehouse = "") {
        pos::Json payload{{"supplierId", supplierId}, {"lines", std::move(lines)}};
        if (!warehouse.empty()) payload["warehouseId"] = warehouse;
        return call("purchases.save", payload).at("id").get<std::string>();
    }
    pos::Json get(const std::string& purchaseId) { return call("purchases.get", pos::Json{{"purchaseId", purchaseId}}); }
    std::string itemOf(const std::string& purchaseId, const std::string& ingredientId) {
        const auto doc = get(purchaseId);
        for (const auto& line : doc.at("lines"))
            if (line.at("ingredientId") == ingredientId) return line.at("id").get<std::string>();
        FAIL("no line for " << ingredientId << " in " << doc.dump().substr(0, 600));
        return {};
    }
    pos::Json lots(const std::string& ingredientId, const char* status = "active") {
        return call("lots.list", pos::Json{{"ingredientId", ingredientId}, {"status", status}}).at("lots");
    }
    /** A dish using `qtyMilli` of the ingredient. */
    std::string dish(const std::string& ingredientId, std::int64_t qtyMilli, pos::Money price) {
        auto category = fixture_.db().prepare("SELECT id FROM menu_categories LIMIT 1");
        REQUIRE(category.step());
        const std::string id = pos::crypto::uuid4();
        auto item = fixture_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, created_at, updated_at) "
            "VALUES (:id, :cat, :sku, 'Test yemək', :price, 1, 0, 0)");
        item.bind(":id", id).bind(":cat", category.columnText(0)).bind(":sku", "T-" + id.substr(0, 8)).bind(":price", price);
        item.exec();
        call("recipes.save", pos::Json{{"menuItemId", id}, {"lines", pos::Json::array({pos::Json{{"ingredientId", ingredientId}, {"qtyMilli", qtyMilli}}})}});
        return id;
    }
    pos::Money dishCost(const std::string& dishId, const char* method) {
        const auto report = call("reports.costing", pos::Json{{"method", method}});
        for (const auto& row : report.at("items"))
            if (row.at("id") == dishId) return row.at("costMinor").get<pos::Money>();
        FAIL("dish missing");
        return 0;
    }
    ServiceFixture& base() { return fixture_; }

private:
    ServiceFixture fixture_;
};

pos::Json line(const std::string& ingredientId, std::int64_t qty, pos::Money price) {
    return pos::Json{{"ingredientId", ingredientId}, {"qtyMilli", qty}, {"unitCostMinor", price}};
}

}  // namespace

// ------------------------------------------------------------------ stage 1
TEST_CASE("an order arrives in parts and the debt follows what came", "[procurement]") {
    ProcFixture f;
    const auto sup = f.supplier("Kartof MMC");
    const auto potato = f.ingredient("Kartof");
    const auto po = f.order(sup, pos::Json::array({line(potato, 100000, 200)}));
    const auto item = f.itemOf(po, potato);
    REQUIRE(f.get(po).at("status") == "ordered");
    REQUIRE(f.due(sup) == 0);  // nothing delivered, nothing owed

    f.call("purchases.receive", pos::Json{{"purchaseId", po}, {"lines", pos::Json::array({pos::Json{{"itemId", item}, {"qtyMilli", 40000}}})}});
    auto doc = f.get(po);
    REQUIRE(doc.at("status") == "partially_received");
    REQUIRE(doc.at("lines")[0].at("receivedMilli") == 40000);
    REQUIRE(doc.at("lines")[0].at("remainingMilli") == 60000);
    REQUIRE(f.stock(potato) == 40000);
    REQUIRE(f.due(sup) == 8000);

    REQUIRE_THROWS_AS(f.call("purchases.receive", pos::Json{{"purchaseId", po},
        {"lines", pos::Json::array({pos::Json{{"itemId", item}, {"qtyMilli", 70000}}})}}), pos::PosError);
    f.call("purchases.receive", pos::Json{{"purchaseId", po}, {"lines", pos::Json::array({pos::Json{{"itemId", item}, {"qtyMilli", 60000}}})}});
    doc = f.get(po);
    REQUIRE(doc.at("status") == "received");
    REQUIRE(doc.at("receipts").size() == 2);
    REQUIRE(f.due(sup) == 20000);
    REQUIRE_THROWS_AS(f.call("purchases.receive", pos::Json{{"purchaseId", po}}), pos::PosError);
}

TEST_CASE("refused goods stay out, quarantined goods wait for the check", "[procurement]") {
    ProcFixture f;
    const auto sup = f.supplier("Ət evi");
    const auto meat = f.ingredient("Mal əti");
    const auto po = f.order(sup, pos::Json::array({line(meat, 10000, 1000)}));
    const auto item = f.itemOf(po, meat);
    f.call("purchases.receive", pos::Json{{"purchaseId", po}, {"lines", pos::Json::array({
        pos::Json{{"itemId", item}, {"qtyMilli", 6000}, {"rejectedMilli", 1000}, {"lotNo", "L-77"}, {"expiresOn", "2099-01-01"}},
        pos::Json{{"itemId", item}, {"qtyMilli", 3000}, {"quality", "pending"}}})}});
    REQUIRE(f.stock(meat) == 6000);
    REQUIRE(f.due(sup) == 6000);
    auto doc = f.get(po);
    REQUIRE(doc.at("lines")[0].at("rejectedMilli") == 1000);
    REQUIRE(doc.at("lines")[0].at("pendingMilli") == 3000);
    REQUIRE(doc.at("lines")[0].at("remainingMilli") == 1000);

    const auto pending = f.lots(meat, "pending");
    REQUIRE(pending.size() == 1);
    f.call("purchases.inspect", pos::Json{{"lotId", pending[0].at("id")}, {"decision", "accept"}});
    REQUIRE(f.stock(meat) == 9000);
    REQUIRE(f.due(sup) == 9000);
    REQUIRE(f.lotSum(meat, f.store()) == 9000);
    REQUIRE(f.get(po).at("status") == "partially_received");
}

TEST_CASE("the confirmed supplier invoice sets the price owed", "[procurement]") {
    ProcFixture f;
    const auto sup = f.supplier("Yağ MMC");
    const auto oil = f.ingredient("Yağ", "l");
    const auto po = f.order(sup, pos::Json::array({line(oil, 10000, 300)}));
    f.call("purchases.receive", pos::Json{{"purchaseId", po}});
    REQUIRE(f.due(sup) == 3000);
    const auto item = f.itemOf(po, oil);
    // Entered but not confirmed: the order price still stands.
    f.call("purchases.invoice", pos::Json{{"purchaseId", po}, {"invoiceNo", "F-12"},
        {"lines", pos::Json::array({pos::Json{{"itemId", item}, {"invoiceQtyMilli", 10000}, {"invoiceUnitCostMinor", 320}}})}});
    REQUIRE(f.due(sup) == 3000);
    f.call("purchases.invoice", pos::Json{{"purchaseId", po}, {"invoiceNo", "F-12"}, {"confirm", true},
        {"lines", pos::Json::array({pos::Json{{"itemId", item}, {"invoiceQtyMilli", 10000}, {"invoiceUnitCostMinor", 320}}})}});
    REQUIRE(f.due(sup) == 3200);
    REQUIRE(f.get(po).at("invoiceNo") == "F-12");
}

// ------------------------------------------------------------------ stage 2
TEST_CASE("a store at its minimum drafts one purchase with the best supplier", "[replenish]") {
    ProcFixture f;
    const auto cheapSlow = f.supplier("Uzaq MMC");
    const auto fair = f.supplier("Yaxın MMC");
    const auto potato = f.ingredient("Kartof");
    f.call("supplierItems.save", pos::Json{{"supplierId", cheapSlow}, {"ingredientId", potato}, {"lastPriceMinor", 190}, {"leadDays", 10}});
    f.call("supplierItems.save", pos::Json{{"supplierId", fair}, {"ingredientId", potato}, {"lastPriceMinor", 200}, {"leadDays", 0},
                                           {"packMilli", 5000}});
    f.call("stockRules.save", pos::Json{{"ingredientId", potato}, {"minQtyMilli", 5000}, {"targetQtyMilli", 20000}});
    f.call("inventory.adjust", pos::Json{{"ingredientId", potato}, {"qtyDeltaMilli", 6000}, {"reason", "ilkin"}});
    f.call("inventory.waste", pos::Json{{"ingredientId", potato}, {"qtyMilli", 2000}, {"reason", "xarab"}});

    const auto drafts = [&] {
        std::vector<pos::Json> out;
        const auto list = f.call("purchases.list", pos::Json::object());
        for (const auto& p : list.at("purchases"))
            if (p.at("status") == "draft") out.push_back(p);
        return out;
    };
    REQUIRE(drafts().size() == 1);
    const auto draft = drafts()[0];
    REQUIRE(draft.at("supplierId") == fair);  // 2.00 now beats 1.90 in ten days
    REQUIRE(draft.at("autoDraft") == 1);
    // Up to 20 kg from 4 kg = 16 kg, in 5 kg packs = 20 kg.
    REQUIRE(f.get(draft.at("id")).at("lines")[0].at("qtyMilli") == 20000);

    // Using more of it does not draft the same shortage again.
    f.call("inventory.waste", pos::Json{{"ingredientId", potato}, {"qtyMilli", 1000}, {"reason", "xarab"}});
    REQUIRE(drafts().size() == 1);
    REQUIRE(f.call("replenish.suggestions", pos::Json::object()).at("suggestions").empty());

    // Nothing arrives on a draft until a person confirms it.
    REQUIRE_THROWS_AS(f.call("purchases.receive", pos::Json{{"purchaseId", draft.at("id")}}), pos::PosError);
    f.call("purchases.confirm", pos::Json{{"purchaseId", draft.at("id")}});
    f.call("purchases.receive", pos::Json{{"purchaseId", draft.at("id")}});
    REQUIRE(f.stock(potato) == 23000);

    const auto compare = f.call("supplierItems.list", pos::Json{{"ingredientId", potato}}).at("items");
    REQUIRE(compare.size() == 2);
    for (const auto& row : compare) REQUIRE(row.at("suggested") == (row.at("supplierId") == fair));
}

TEST_CASE("a shortage without a known supplier is suggested, not drafted", "[replenish]") {
    ProcFixture f;
    const auto salt = f.ingredient("Duz");
    const auto sup = f.supplier("Duz MMC");
    f.call("stockRules.save", pos::Json{{"ingredientId", salt}, {"minQtyMilli", 1000}, {"targetQtyMilli", 3000}});
    const auto suggestions = f.call("replenish.suggestions", pos::Json::object()).at("suggestions");
    REQUIRE(suggestions.size() == 1);
    REQUIRE(suggestions[0].at("supplier").is_null());
    REQUIRE(suggestions[0].at("suggestedQtyMilli") == 3000);
    const auto draft = f.call("replenish.createDraft", pos::Json{{"ingredientId", salt}, {"supplierId", sup}, {"qtyMilli", 3000}});
    REQUIRE(f.get(draft.at("purchaseId")).at("status") == "draft");
    REQUIRE(f.call("replenish.suggestions", pos::Json::object()).at("suggestions").empty());
}

// ------------------------------------------------------------------ stage 3
TEST_CASE("lots go first-expiring-first-out and keep their dates when moved", "[lots]") {
    ProcFixture f;
    const auto sup = f.supplier("Süd MMC");
    const auto milk = f.ingredient("Süd", "l");
    const auto po = f.order(sup, pos::Json::array({line(milk, 12000, 100)}));
    const auto item = f.itemOf(po, milk);
    f.call("purchases.receive", pos::Json{{"purchaseId", po}, {"lines", pos::Json::array({
        pos::Json{{"itemId", item}, {"qtyMilli", 5000}, {"lotNo", "LATE"}, {"expiresOn", "2099-01-10"}},
        pos::Json{{"itemId", item}, {"qtyMilli", 5000}, {"lotNo", "SOON"}, {"expiresOn", "2099-01-05"}},
        pos::Json{{"itemId", item}, {"qtyMilli", 2000}, {"lotNo", "OLD"}, {"expiresOn", "2000-01-01"}}})}});
    const auto store = f.store();
    // Arrived already past its date: owed to the supplier, never usable.
    REQUIRE(f.stock(milk) == 10000);
    REQUIRE(f.lotSum(milk, store) == 10000);

    // The nearest good date first.
    f.call("inventory.waste", pos::Json{{"ingredientId", milk}, {"qtyMilli", 3000}, {"reason", "töküldü"}});
    std::map<std::string, std::int64_t> left;
    for (const auto& lot : f.lots(milk)) left[lot.at("lotNo").get<std::string>()] = lot.at("qtyMilli").get<std::int64_t>();
    REQUIRE(left["SOON"] == 2000);
    REQUIRE(left["LATE"] == 5000);
    REQUIRE(left.count("OLD") == 0);
    const auto expired = f.lots(milk, "expired");
    REQUIRE(expired.size() == 1);
    REQUIRE(expired[0].at("qtyMilli") == 2000);  // still on the shelf, to be thrown away
    REQUIRE(f.lotSum(milk, store) == f.stock(milk));

    const auto expiry = f.call("reports.expiry", pos::Json{{"days", 3}});
    REQUIRE(expiry.at("expiredLots") == 1);
    REQUIRE(expiry.at("expiredValueMinor") == 200);

    // A place in the store: half of LATE into the fridge.
    const auto fridge = f.call("locations.save", pos::Json{{"name", "Soyuducu 1"}, {"kind", "fridge"}}).at("id");
    std::string lateId;
    for (const auto& lot : f.lots(milk)) if (lot.at("lotNo") == "LATE") lateId = lot.at("id").get<std::string>();
    f.call("lots.relocate", pos::Json{{"lotId", lateId}, {"locationId", fridge}, {"qtyMilli", 2500}});
    int inFridge = 0;
    for (const auto& lot : f.lots(milk)) if (lot.at("locationName") == "Soyuducu 1") inFridge += 1;
    REQUIRE(inFridge == 1);
    REQUIRE(f.stock(milk) == 7000);

    // To another branch: the dates go with the goods.
    const auto two = f.secondStore();
    f.call("inventory.transfer", pos::Json{{"ingredientId", milk}, {"fromWarehouseId", store}, {"toWarehouseId", two}, {"qtyMilli", 2000}});
    bool soonArrived = false;
    const auto arrived = f.call("lots.list", pos::Json{{"ingredientId", milk}, {"warehouseId", two}});
    for (const auto& lot : arrived.at("lots"))
        if (lot.at("lotNo") == "SOON" && lot.at("expiresOn") == "2099-01-05") soonArrived = true;
    REQUIRE(soonArrived);
    REQUIRE(f.lotSum(milk, two) == 2000);

    // Throwing the expired lot away does not touch the balance again.
    f.call("lots.writeOff", pos::Json{{"lotId", expired[0].at("id")}, {"reason", "expired"}});
    REQUIRE(f.stock(milk) == 5000);
    const auto loss = f.call("reports.stockLoss", pos::Json::object());
    REQUIRE(loss.at("expiredMinor") == 200);
    REQUIRE(loss.at("wasteMinor") == 300);
    REQUIRE(f.call("reports.expiry", pos::Json::object()).at("expiredLots") == 0);
}

TEST_CASE("expired stock is never used, even when good stock runs out", "[lots]") {
    ProcFixture f;
    const auto sup = f.supplier("Ət MMC");
    const auto meat = f.ingredient("Qiymə");
    const auto po = f.order(sup, pos::Json::array({line(meat, 3000, 1000)}));
    const auto item = f.itemOf(po, meat);
    f.call("purchases.receive", pos::Json{{"purchaseId", po}, {"lines", pos::Json::array({
        pos::Json{{"itemId", item}, {"qtyMilli", 1000}, {"lotNo", "GOOD"}, {"expiresOn", "2099-01-01"}},
        pos::Json{{"itemId", item}, {"qtyMilli", 2000}, {"lotNo", "BAD"}, {"expiresOn", "2000-01-01"}}})}});
    REQUIRE(f.stock(meat) == 1000);

    // 1.5 kg needed, 1 kg good: the balance goes below zero, the expired lot stays untouched.
    f.call("inventory.waste", pos::Json{{"ingredientId", meat}, {"qtyMilli", 1500}, {"reason", "istifadə"}});
    REQUIRE(f.stock(meat) == -500);
    const auto bad = f.lots(meat, "expired");
    REQUIRE(bad.size() == 1);
    REQUIRE(bad[0].at("qtyMilli") == 2000);
    REQUIRE(f.lots(meat).size() == 0);

    // The date was typed wrong: corrected, the lot is usable again (covering the shortfall first).
    f.call("lots.extend", pos::Json{{"lotId", bad[0].at("id")}, {"expiresOn", "2099-02-01"}});
    REQUIRE(f.stock(meat) == 1500);
    REQUIRE(f.lots(meat, "expired").empty());
    REQUIRE(f.lots(meat).at(0).at("qtyMilli") == 1500);
    REQUIRE_THROWS_AS(f.call("lots.extend", pos::Json{{"lotId", bad[0].at("id")}, {"expiresOn", "2001-01-01"}}), pos::PosError);
}

TEST_CASE("goods arriving into a shortfall cover it before opening a lot", "[lots]") {
    ProcFixture f;
    const auto flour = f.ingredient("Un");
    f.call("inventory.adjust", pos::Json{{"ingredientId", flour}, {"qtyDeltaMilli", -2000}, {"reason", "sayım"}});
    // Below zero there is no lot; goods that come in first cover the gap.
    f.call("inventory.adjust", pos::Json{{"ingredientId", flour}, {"qtyDeltaMilli", 5000}, {"reason", "gəldi"}});
    REQUIRE(f.stock(flour) == 3000);
    REQUIRE(f.lotSum(flour, f.store()) == 3000);
}

// ------------------------------------------------------------------ stage 4
TEST_CASE("recipes cost by weighted average, FIFO or last price", "[costing]") {
    ProcFixture f;
    const auto sup = f.supplier("Ət MMC");
    const auto meat = f.ingredient("Ət");
    const auto first = f.order(sup, pos::Json::array({line(meat, 10000, 100)}));
    f.call("purchases.receive", pos::Json{{"purchaseId", first}});
    const auto second = f.order(sup, pos::Json::array({line(meat, 10000, 300)}));
    f.call("purchases.receive", pos::Json{{"purchaseId", second}});
    const auto dishId = f.dish(meat, 1000, 900);

    REQUIRE(f.dishCost(dishId, "average") == 200);
    REQUIRE(f.dishCost(dishId, "fifo") == 100);
    REQUIRE(f.dishCost(dishId, "last") == 300);
    REQUIRE(f.call("inventory.costingMethod", pos::Json::object()).at("method") == "average");
    f.call("inventory.costingMethod", pos::Json{{"method", "fifo"}});
    REQUIRE(f.call("reports.costing", pos::Json::object()).at("method") == "fifo");
    REQUIRE(f.call("inventory.valuation", pos::Json{{"method", "fifo"}}).at("totalMinor") == 4000);
    REQUIRE(f.call("inventory.valuation", pos::Json{{"method", "average"}}).at("totalMinor") == 4000);
}

TEST_CASE("delivery costs land on the goods and on the supplier's bill", "[costing]") {
    ProcFixture f;
    const auto sup = f.supplier("Bazar MMC");
    const auto onion = f.ingredient("Soğan");
    const auto carrot = f.ingredient("Kök");
    const auto po = f.order(sup, pos::Json::array({line(onion, 10000, 100), line(carrot, 10000, 300)}));
    // 4.00 delivery by value: onion carries 1.00, carrot 3.00.
    f.call("purchases.addCost", pos::Json{{"purchaseId", po}, {"kind", "delivery"}, {"amountMinor", 400}});
    f.call("purchases.receive", pos::Json{{"purchaseId", po}});
    for (const auto& l : f.get(po).at("lines")) {
        if (l.at("ingredientId") == onion) REQUIRE(l.at("landedUnitCostMinor") == 110);
        if (l.at("ingredientId") == carrot) REQUIRE(l.at("landedUnitCostMinor") == 330);
    }
    REQUIRE(f.due(sup) == 4400);
    REQUIRE(f.lots(onion)[0].at("unitCostMinor") == 110);

    // Transport paid to someone else, spread by weight: owed to nobody here, still on the cost.
    f.call("purchases.addCost", pos::Json{{"purchaseId", po}, {"kind", "transport"}, {"amountMinor", 200},
                                          {"toSupplier", false}, {"allocation", "qty"}});
    REQUIRE(f.due(sup) == 4400);
    REQUIRE(f.lots(onion)[0].at("unitCostMinor") == 120);

    const auto report = f.call("reports.suppliers", pos::Json::object());
    for (const auto& row : report.at("suppliers")) {
        if (row.at("supplierId") != sup) continue;
        REQUIRE(row.at("purchases") == 1);
        REQUIRE(row.at("fillRateBp") == 10000);
        REQUIRE(row.at("receivedValueMinor") == 4400);
    }
}
