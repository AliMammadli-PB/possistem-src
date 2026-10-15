#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"

/**
 * 1.9.0: Mallar (categories, unique barcodes, branch prices, totals, import),
 * İnventarizasiya (count by barcode, terminal file, posting to the counted
 * amount), Qazanc (income into a kassa) and Market sales recorded in the store.
 */
namespace {

class ErpFixture {
public:
    ErpFixture() {
        pos::handlers::registerCatalog(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerGuests(fixture_.contextPtr());
        pos::handlers::registerInventory(fixture_.contextPtr());
        pos::handlers::registerCashAccounts(fixture_.contextPtr());
        pos::handlers::registerSales(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload, const std::string& terminal = "") {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        request.terminalId = terminal;
        return fixture_.server().callHandler(request);
    }

    std::string good(const std::string& name, const std::string& barcode, pos::Money cost, pos::Money sale,
                     const std::string& category = "") {
        pos::Json payload{{"name", name}, {"unit", "ədəd"}, {"costMinor", cost}, {"salePriceMinor", sale},
                          {"barcode", barcode}};
        if (!category.empty()) payload["categoryId"] = category;
        return call("ingredients.save", payload).at("id").get<std::string>();
    }

    pos::Json goods(pos::Json filter = pos::Json::object()) { return call("goods.list", std::move(filter)); }

    pos::Money balance(const std::string& accountId) {
        return call("cashAccounts.moves", pos::Json{{"accountId", accountId}}).at("balanceMinor").get<pos::Money>();
    }

    std::int64_t level(const std::string& id, const std::string& wh = "wh-main") {
        return pos::services::InventoryService(fixture_.ctx()).levelOf(id, wh);
    }

    ServiceFixture& base() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("categories form a tree and a parent shows its sub-categories' goods", "[erp][goods]") {
    ErpFixture f;
    const auto drinks = f.call("categories.save", pos::Json{{"name", "İçkilər"}}).at("id").get<std::string>();
    const auto water = f.call("categories.save", pos::Json{{"name", "Sular"}, {"parentId", drinks}}).at("id").get<std::string>();
    f.good("Sirab 0.5", "4760001", 40, 80, water);
    f.good("Çörək", "4760002", 50, 70);

    const auto cats = f.call("categories.list", pos::Json::object());
    bool sawPath = false;
    for (const auto& c : cats.at("categories"))
        if (c.at("id") == water) sawPath = c.at("path") == "İçkilər / Sular";
    REQUIRE(sawPath);
    REQUIRE(f.goods(pos::Json{{"categoryId", drinks}}).at("goods").size() == 1);
    REQUIRE(f.goods(pos::Json{{"categoryId", "none"}}).at("goods").size() == 1);

    // A category cannot sit inside its own child.
    REQUIRE_THROWS_AS(f.call("categories.save", pos::Json{{"id", drinks}, {"name", "İçkilər"}, {"parentId", water}}),
                      pos::PosError);
    // Deleting "Sular" moves its goods up to "İçkilər".
    f.call("categories.delete", pos::Json{{"categoryId", water}});
    const auto left = f.goods(pos::Json{{"categoryId", drinks}});
    REQUIRE(left.at("goods").size() == 1);
    REQUIRE(left.at("goods")[0].at("categoryId") == drinks);
}

TEST_CASE("a barcode belongs to one good; copies need their own", "[erp][goods]") {
    ErpFixture f;
    const auto cola = f.good("Cola 1L", "5449000000996", 150, 250);
    REQUIRE_THROWS_AS(f.good("Cola 1L (kopya)", "5449000000996", 150, 250), pos::PosError);
    const auto copy = f.good("Cola Zero 1L", "5449000131805", 150, 260);
    REQUIRE(copy != cola);
    // Saving the same good again with its own barcode is fine.
    REQUIRE_NOTHROW(f.call("ingredients.save", pos::Json{{"id", cola}, {"name", "Cola 1L"}, {"unit", "ədəd"},
                                                        {"costMinor", 150}, {"barcode", "5449000000996"}}));
}

TEST_CASE("goods totals: quantity times cost, sale price and the profit", "[erp][goods][money]") {
    ErpFixture f;
    const auto a = f.good("Süd", "111", 120, 200);
    const auto b = f.good("Kefir", "222", 100, 150);
    pos::services::InventoryService inventory(f.base().ctx());
    inventory.move(a, "wh-main", 10000, "receipt");  // 10 pieces
    inventory.move(b, "wh-main", 4000, "receipt");   // 4 pieces

    const auto list = f.goods();
    const auto& totals = list.at("totals");
    REQUIRE(totals.at("saleMinor") == 10 * 200 + 4 * 150);
    REQUIRE(totals.at("profitMinor") == totals.at("saleMinor").get<pos::Money>() - totals.at("costMinor").get<pos::Money>());
    // Search: by barcode, by name, by price.
    REQUIRE(f.goods(pos::Json{{"search", "222"}}).at("goods").size() == 1);
    REQUIRE(f.goods(pos::Json{{"search", "süd"}}).at("goods").size() == 1);
    REQUIRE(f.goods(pos::Json{{"search", "1.50"}}).at("goods").size() == 1);
}

TEST_CASE("a branch sells at its own price", "[erp][goods][money]") {
    ErpFixture f;
    const auto object = f.call("cashObjects.save", pos::Json{{"name", "Nizami"}}).at("id").get<std::string>();
    f.call("cashAccounts.save", pos::Json{{"name", "Nizami kassa"}, {"kind", "till"}, {"terminalId", "pc-nizami"},
                                          {"objectId", object}});
    // A catalog product with its stock card (MENU-<id>), 6.00 everywhere.
    auto category = f.base().db().prepare("SELECT id FROM menu_categories WHERE active = 1 LIMIT 1");
    REQUIRE(category.step());
    const auto now = pos::nowMs();
    auto item = f.base().db().prepare(
        "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, created_at, updated_at) "
        "VALUES ('p-kebab', :cat, 'KB-1', 'Kabab', 600, 1, :now, :now)");
    item.bind(":cat", category.columnText(0)).bind(":now", now);
    item.exec();
    const auto card = f.call("ingredients.save", pos::Json{{"name", "Kabab"}, {"unit", "ədəd"}, {"sku", "MENU-p-kebab"}})
                          .at("id").get<std::string>();
    f.call("goods.prices", pos::Json{{"ingredientId", card}, {"prices", pos::Json::array({{{"objectId", object}, {"salePriceMinor", 700}}})}});

    auto priceAt = [&](const std::string& terminal) {
        const auto list = f.call("catalog.products", pos::Json::object(), terminal);
        for (const auto& p : list.at("products"))
            if (p.at("id") == "p-kebab") return p.at("priceMinor").get<pos::Money>();
        return pos::Money{-1};
    };
    REQUIRE(priceAt("pc-nizami") == 700);
    REQUIRE(priceAt("pc-other") == 600);
    REQUIRE(f.goods(pos::Json{{"objectId", object}, {"search", "Kabab"}}).at("goods")[0].at("salePriceMinor") == 700);
}

TEST_CASE("Excel import updates known barcodes and adds the rest", "[erp][goods]") {
    ErpFixture f;
    f.good("Köhnə ad", "999", 10, 20);
    const auto result = f.call("goods.import", pos::Json{{"rows", pos::Json::array({
        {{"name", "Yeni ad"}, {"barcode", "999"}, {"salePriceMinor", 30}},
        {{"name", "Pomidor"}, {"barcode", "2000001"}, {"unit", "kg"}, {"costMinor", 150}, {"salePriceMinor", 250},
         {"category", "Tərəvəz / Qırmızı"}},
        {{"name", "Təkrar"}, {"barcode", "2000001"}},
    })}});
    REQUIRE(result.at("created") == 1);
    REQUIRE(result.at("updated") == 1);
    REQUIRE(result.at("problems").size() == 1);
    const auto tomato = f.goods(pos::Json{{"search", "2000001"}}).at("goods")[0];
    REQUIRE(tomato.at("categoryPath") == "Tərəvəz / Qırmızı");
    REQUIRE(tomato.at("weighted") == 1);
    REQUIRE(f.goods(pos::Json{{"search", "999"}}).at("goods")[0].at("name") == "Yeni ad");
}

TEST_CASE("stocktake: count by barcode and file, compare, then the store holds the count", "[erp][stocktake]") {
    ErpFixture f;
    const auto milk = f.good("Süd", "111", 100, 200);
    const auto bread = f.good("Çörək", "222", 40, 60);
    const auto salt = f.good("Duz", "333", 30, 50);
    pos::services::InventoryService inventory(f.base().ctx());
    inventory.move(milk, "wh-main", 10000, "receipt");
    inventory.move(bread, "wh-main", 5000, "receipt");
    inventory.move(salt, "wh-main", 2000, "receipt");

    const auto take = f.call("stocktake.create", pos::Json::object());
    const auto id = take.at("id").get<std::string>();
    REQUIRE(take.at("number").get<std::string>().rfind("S-", 0) == 0);
    // Scanner: two scans of milk add up; a terminal file sets bread.
    f.call("stocktake.count", pos::Json{{"stocktakeId", id}, {"barcode", "111"}, {"countedMilli", 4000}, {"mode", "add"}});
    f.call("stocktake.count", pos::Json{{"stocktakeId", id}, {"barcode", "111"}, {"countedMilli", 4000}, {"mode", "add"}});
    const auto imported = f.call("stocktake.import", pos::Json{{"stocktakeId", id}, {"lines", pos::Json::array({
        {{"barcode", "222"}, {"qtyMilli", 6000}}, {{"barcode", "nope"}, {"qtyMilli", 1000}}})}});
    REQUIRE(imported.at("matched") == 1);
    REQUIRE(imported.at("unmatched").size() == 1);

    const auto detail = f.call("stocktake.get", pos::Json{{"stocktakeId", id}});
    REQUIRE(detail.at("totals").at("counted") == 2);
    // Salt was not counted: with zeroUncounted (the default) it is taken as gone.
    REQUIRE(detail.at("totals").at("short") == 2);
    REQUIRE(detail.at("totals").at("over") == 1);

    // A sale while counting does not distort the result.
    inventory.move(milk, "wh-main", -1000, "sale");
    f.call("stocktake.post", pos::Json{{"stocktakeId", id}});
    REQUIRE(f.level(milk) == 8000);
    REQUIRE(f.level(bread) == 6000);
    REQUIRE(f.level(salt) == 0);
}

TEST_CASE("Qazanc puts money into a kassa and a correction moves it", "[erp][income][money]") {
    ErpFixture f;
    const auto safe = f.call("cashAccounts.save", pos::Json{{"name", "Xəzinə"}, {"kind", "treasury"}}).at("id").get<std::string>();
    const auto doc = f.call("income.save", pos::Json{{"accountId", safe}, {"amountMinor", 5000}, {"kind", "İcarə"},
                                                     {"reason", "Anbar icarəsi"}});
    REQUIRE(doc.at("number").get<std::string>().rfind("GL-", 0) == 0);
    REQUIRE(f.balance(safe) == 5000);
    f.call("income.save", pos::Json{{"id", doc.at("id")}, {"accountId", safe}, {"amountMinor", 3000}, {"kind", "İcarə"},
                                {"reason", "Anbar icarəsi"}});
    REQUIRE(f.balance(safe) == 3000);
    const auto list = f.call("income.list", pos::Json{{"search", "icar"}});
    REQUIRE(list.at("docs").size() == 1);
    REQUIRE(list.at("totalMinor") == 3000);
    f.call("income.delete", pos::Json{{"id", doc.at("id")}});
    REQUIRE(f.balance(safe) == 0);
}

TEST_CASE("a Market sale lands in the store, the till and the partner's tab once", "[erp][market][money]") {
    ErpFixture f;
    const auto till = f.call("cashAccounts.save", pos::Json{{"name", "Market kassa"}, {"kind", "till"},
                                                           {"terminalId", "market-1"}}).at("id").get<std::string>();
    const auto water = f.good("Su", "111", 30, 80);
    pos::services::InventoryService inventory(f.base().ctx());
    inventory.move(water, "wh-main", 10000, "receipt");
    const auto partner = f.call("customers.save", pos::Json{{"name", "Əli"}}).at("id").get<std::string>();

    const pos::Json sale{{"externalId", "m-sale-1"}, {"customerId", partner},
                         {"lines", pos::Json::array({{{"ingredientId", water}, {"qtyMilli", 3000}, {"unitPriceMinor", 80}}})},
                         {"cashMinor", 140}, {"creditMinor", 100}};
    const auto first = f.call("sales.recordExternal", sale, "market-1");
    const auto again = f.call("sales.recordExternal", sale, "market-1");
    REQUIRE(again.at("orderId") == first.at("orderId"));
    REQUIRE(again.at("duplicate") == true);
    REQUIRE(f.level(water) == 7000);
    REQUIRE(f.balance(till) == 140);
    auto debt = f.base().db().prepare("SELECT debt_minor FROM customers WHERE id = :id");
    debt.bind(":id", partner);
    REQUIRE(debt.step());
    REQUIRE(debt.columnInt(0) == 100);

    f.call("sales.recordExternalRefund", pos::Json{{"externalId", "m-ref-1"}, {"saleExternalId", "m-sale-1"},
                                                  {"lines", pos::Json::array({{{"ingredientId", water}, {"qtyMilli", 1000}}})},
                                                  {"cashMinor", 80}}, "market-1");
    REQUIRE(f.level(water) == 8000);
    REQUIRE(f.balance(till) == 60);
}
