#include <algorithm>
#include <map>
#include <string>

#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/DataRepair.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * The state a real till reached: a dish archived and made again, the live card switched off by the
 * old recipe screen, the archived card the only one to pick, and a main warehouse nobody looks at.
 */
namespace {
struct Repair {
    ServiceFixture f;
    Repair() {
        auto c = f.contextPtr();
        pos::handlers::registerCatalog(c);
        pos::handlers::registerInventory(c);
    }
    void exec(const std::string& sql) { f.db().exec(sql); }
    std::int64_t scalar(const std::string& sql) { auto q = f.db().prepare(sql); q.step(); return q.columnInt(0); }
    std::map<std::string, std::string> ids;
    std::string menuId(const std::string& alias) { const auto it = ids.find(alias); return it == ids.end() ? alias : it->second; }
    std::string card(const std::string& alias) {
        auto q = f.db().prepare("SELECT ingredient_id FROM catalog_goods_links WHERE menu_id=:id");
        q.bind(":id", menuId(alias));
        q.step();
        return q.columnText(0);
    }
    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request r;
        r.requestId = pos::crypto::uuid4();
        r.idempotencyKey = pos::crypto::uuid4();
        r.method = method;
        r.payload = std::move(payload);
        return f.server().callHandler(r);
    }
    void dish(const std::string& alias, const std::string& name, bool archived, bool cardOn = true) {
        if (category.empty()) category = call("catalog.upsertCategory", {{"nameAz", "Test"}}).at("id").get<std::string>();
        ids[alias] = call("catalog.upsertProduct", {{"categoryId", category}, {"nameAz", name}, {"priceMinor", 100}, {"active", true}}).at("id").get<std::string>();
        // How a real till got here: not through today's screens.
        if (archived) exec("UPDATE menu_items SET archived=1,active=0 WHERE id='" + ids[alias] + "'");
        if (!cardOn) exec("UPDATE ingredients SET active=0 WHERE id='" + card(alias) + "'");
    }
    std::string category;
    void raw(const std::string& id) { exec("INSERT INTO ingredients(id,sku,name,unit,created_at,updated_at) VALUES('" + id + "','ING-" + id + "','" + id + "','kg',1,1)"); }
    void line(const std::string& menu, const std::string& ingredient, int qty) {
        exec("INSERT OR REPLACE INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) VALUES('" + menuId(menu) + "','" + ingredient + "'," + std::to_string(qty) + ")");
    }
    std::int64_t expanded(const std::string& menu, const std::string& ingredient) {
        return scalar("SELECT COALESCE(SUM(qty_milli),0) FROM menu_item_recipe_expanded WHERE menu_item_id='" + menuId(menu) + "' AND ingredient_id='" + ingredient + "'");
    }
    void branch(const std::string& id) {
        exec("INSERT INTO warehouses(id,name,created_at,updated_at) VALUES('wh-" + id + "','" + id + "',1,1)");
        exec("INSERT INTO cash_objects(id,name,warehouse_id,created_at) VALUES('" + id + "','" + id + "','wh-" + id + "',1)");
    }
};
}  // namespace

TEST_CASE("a recipe on an archived namesake's card gets the live dish's ingredients", "[repair][1106]") {
    Repair x;
    x.raw("flour");
    x.dish("old", "Lahmacun", true);
    x.dish("live", "Lahmacun", false, false);
    x.dish("drink", "Ayran", false);
    x.line("live", "flour", 100);
    x.line("drink", x.card("old"), 1000);
    REQUIRE(x.expanded("drink", "flour") == 0);
    REQUIRE(x.expanded("drink", x.card("old")) == 1000);

    const auto done = pos::services::repairStockData(x.f.ctx());
    REQUIRE(done.at("linesMovedToLiveDish") == 1);
    REQUIRE(done.at("cardsSwitchedBackOn") == 1);
    REQUIRE(done.at("linesMadeRecipeParts") == 1);
    REQUIRE(done.at("archivedCardsRetired") == 1);
    REQUIRE(x.expanded("drink", "flour") == 100);
    REQUIRE(x.expanded("drink", x.card("old")) == 0);
    REQUIRE(x.expanded("drink", x.card("live")) == 0);
    REQUIRE(x.scalar("SELECT active FROM ingredients WHERE id='" + x.card("live") + "'") == 1);
    REQUIRE(x.scalar("SELECT active FROM ingredients WHERE id='" + x.card("old") + "'") == 0);
    REQUIRE(x.scalar("SELECT COUNT(*) FROM data_repairs") == 1);

    // Nothing left to do, nothing written.
    REQUIRE(pos::services::repairStockData(x.f.ctx()).empty());
    REQUIRE(x.scalar("SELECT COUNT(*) FROM data_repairs") == 1);
}

TEST_CASE("the repair leaves alone what it cannot be sure of", "[repair][1106]") {
    Repair x;
    x.raw("flour");
    // Two live dishes of the name: which one was meant is not known.
    x.dish("old", "Calzone", true);
    x.dish("a", "Calzone", false);
    x.dish("b", "Calzone", false);
    x.dish("drink", "Ayran", false);
    x.line("a", "flour", 100);
    x.line("drink", x.card("old"), 1000);
    // An archived dish whose card still holds goods stays on the lists.
    x.dish("stocked", "Sous", true);
    x.exec("INSERT INTO stock_levels(ingredient_id,warehouse_id,qty_milli,updated_at) VALUES('" + x.card("stocked") + "','wh-main',5000,1)");
    // A plain good with no recipe stays a stock line.
    x.dish("cola", "Kola", false);
    x.line("drink", x.card("cola"), 1000);
    // Two dishes holding each other's cards: only one direction can become a part.
    x.dish("r1", "Halqa 1", false);
    x.dish("r2", "Halqa 2", false);
    x.line("r1", "flour", 1);
    x.line("r2", "flour", 1);
    x.line("r1", x.card("r2"), 1000);
    x.line("r2", x.card("r1"), 1000);

    pos::services::repairStockData(x.f.ctx());
    REQUIRE(x.expanded("drink", x.card("old")) == 1000);
    REQUIRE(x.scalar("SELECT active FROM ingredients WHERE id='" + x.card("old") + "'") == 1);
    REQUIRE(x.scalar("SELECT active FROM ingredients WHERE id='" + x.card("stocked") + "'") == 1);
    REQUIRE(x.expanded("drink", x.card("cola")) == 1000);
    REQUIRE(x.scalar("SELECT COUNT(*) FROM menu_item_components WHERE menu_item_id='" + x.menuId("r1") + "' AND component_menu_item_id='" + x.menuId("r2") + "'") +
            x.scalar("SELECT COUNT(*) FROM menu_item_components WHERE menu_item_id='" + x.menuId("r2") + "' AND component_menu_item_id='" + x.menuId("r1") + "'") <= 1);
    REQUIRE(pos::services::repairStockData(x.f.ctx()).empty());
}

TEST_CASE("one branch means one warehouse, with stock and history in it", "[repair][warehouse][1106]") {
    Repair x;
    x.raw("flour");
    x.raw("salt");
    x.branch("filial");
    pos::services::InventoryService inventory(x.f.ctx());
    inventory.move("flour", "wh-main", 3000, "adjustment", "", "test");
    inventory.move("flour", "wh-filial", 2000, "adjustment", "", "test");
    inventory.move("salt", "wh-main", -500, "sale", "old-order", "test");
    const auto total = x.scalar("SELECT SUM(qty_milli) FROM stock_levels");

    const auto done = pos::services::repairStockData(x.f.ctx());
    REQUIRE(done.at("mainWarehouseMergedInto") == "wh-filial");
    REQUIRE(inventory.levelOf("flour", "wh-filial") == 5000);
    REQUIRE(inventory.levelOf("salt", "wh-filial") == -500);
    REQUIRE(x.scalar("SELECT SUM(qty_milli) FROM stock_levels") == total);
    REQUIRE(x.scalar("SELECT COUNT(*) FROM stock_levels WHERE warehouse_id='wh-main'") == 0);
    REQUIRE(x.scalar("SELECT COUNT(*) FROM stock_movements WHERE warehouse_id='wh-main'") == 0);
    REQUIRE(x.scalar("SELECT active FROM warehouses WHERE id='wh-main'") == 0);
    pos::ipc::Request list;
    list.requestId = "list";
    list.method = "warehouses.list";
    const auto listed = x.f.server().callHandler(list);
    REQUIRE(listed.at("warehouses").size() == 1);
    REQUIRE(pos::services::repairStockData(x.f.ctx()).empty());
}

TEST_CASE("several branches keep their own warehouses", "[repair][warehouse][1106]") {
    Repair x;
    x.branch("bir");
    x.branch("iki");
    pos::services::repairStockData(x.f.ctx());
    REQUIRE(x.scalar("SELECT active FROM warehouses WHERE id='wh-main'") == 1);
    REQUIRE(x.scalar("SELECT active FROM warehouses WHERE id='wh-bir'") == 1);
    REQUIRE(x.scalar("SELECT active FROM warehouses WHERE id='wh-iki'") == 1);
}
