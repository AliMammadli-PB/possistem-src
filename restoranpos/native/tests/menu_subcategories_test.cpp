#include <algorithm>

#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/KitchenStations.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CatalogAdminService.hpp"
#include "pos/services/InventoryService.hpp"

// 1.9.33: one level of menu sub-categories (İçkilər → Spirtli), set menus that give up the
// ingredients of their parts, sizes in other units, and who may change whose PIN.
namespace {
struct MenuFixture {
    ServiceFixture f;
    MenuFixture() {
        pos::handlers::registerCatalog(f.contextPtr());
        pos::handlers::registerAuth(f.contextPtr());
        pos::handlers::registerInventory(f.contextPtr());
    }
    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request r;
        r.requestId = pos::crypto::uuid4();
        r.idempotencyKey = pos::crypto::uuid4();
        r.method = method;
        r.payload = std::move(payload);
        return f.server().callHandler(r);
    }
    std::string category(const std::string& name, const std::string& parent = "") {
        pos::Json p{{"nameAz", name}};
        if (!parent.empty()) p["parentId"] = parent;
        return call("catalog.upsertCategory", p).at("id").get<std::string>();
    }
    std::string product(const std::string& category, const std::string& name, pos::Money price, pos::Json extra = pos::Json::object()) {
        pos::Json p{{"categoryId", category}, {"nameAz", name}, {"priceMinor", price}, {"active", true}};
        p.update(extra);
        return call("catalog.upsertProduct", p).at("id").get<std::string>();
    }
    std::string text(const std::string& sql) {
        auto q = f.db().prepare(sql);
        return q.step() ? q.columnText(0) : std::string("<none>");
    }
    std::int64_t number(const std::string& sql) {
        auto q = f.db().prepare(sql);
        REQUIRE(q.step());
        return q.columnInt(0);
    }
    std::int64_t expanded(const std::string& dish, const std::string& ingredient) {
        auto q = f.db().prepare("SELECT qty_milli FROM menu_item_recipe_expanded WHERE menu_item_id=:d AND ingredient_id=:i");
        q.bind(":d", dish).bind(":i", ingredient);
        return q.step() ? q.columnInt(0) : 0;
    }
    std::string cardOf(const std::string& product) {
        auto q = f.db().prepare("SELECT ingredient_id FROM catalog_goods_links WHERE menu_id=:id");
        q.bind(":id", product);
        return q.step() ? q.columnText(0) : std::string();
    }
};
}  // namespace

TEST_CASE("a sub-category sits under its parent, one level only", "[catalog][subcategories]") {
    MenuFixture x;
    const auto drinks = x.category("İçkilər"), strong = x.category("Spirtli", drinks), soft = x.category("Spirtsiz", drinks);

    // One level only; never inside itself; a parent with children cannot become a child.
    const auto beer = x.category("Pivə");
    REQUIRE_THROWS_AS(x.call("catalog.upsertCategory", {{"id", beer}, {"nameAz", "Pivə"}, {"parentId", strong}}), pos::PosError);
    REQUIRE_THROWS_AS(x.call("catalog.upsertCategory", {{"id", drinks}, {"nameAz", "İçkilər"}, {"parentId", drinks}}), pos::PosError);
    REQUIRE_THROWS_AS(x.call("catalog.upsertCategory", {{"id", drinks}, {"nameAz", "İçkilər"}, {"parentId", beer}}), pos::PosError);

    // A rename that leaves parentId out keeps the parent.
    x.call("catalog.upsertCategory", {{"id", soft}, {"nameAz", "Alkoqolsuz"}});
    REQUIRE(x.text("SELECT parent_id FROM menu_categories WHERE id='" + soft + "'") == drinks);

    x.product(soft, "Ayran", 150);
    bool listed = false;
    const auto list = x.call("catalog.categories", pos::Json::object());
    for (const auto& c : list.at("categories")) {
        if (c.at("id") == drinks) {
            listed = true;
            REQUIRE(c.at("itemCount") == 1);
            REQUIRE(c.at("parentId").is_null());
        } else if (c.at("id") == soft) {
            REQUIRE(c.at("parentId") == drinks);
        }
    }
    REQUIRE(listed);

    // A parent with sub-categories is not archived from under them; "" moves one back to the top.
    REQUIRE_THROWS_AS(x.call("catalog.archiveCategory", {{"categoryId", drinks}}), pos::PosError);
    x.call("catalog.upsertCategory", {{"id", strong}, {"nameAz", "Spirtli"}, {"parentId", ""}});
    REQUIRE(x.number("SELECT parent_id IS NULL FROM menu_categories WHERE id='" + strong + "'") == 1);
}

TEST_CASE("a printer chosen for a parent category takes its sub-categories", "[printing][subcategories]") {
    const std::vector<pos::printing::KitchenStation> stations{{"st-bar", "BAR", "tcp:1", {"cat-drinks"}, {}}};
    REQUIRE(pos::printing::stationFor(stations, "p", "cat-soft", "cat-drinks") == &stations[0]);
    REQUIRE(pos::printing::stationFor(stations, "p", "cat-soft", "cat-food") == nullptr);
    REQUIRE(pos::printing::stationFor(stations, "p", "cat-drinks") == &stations[0]);
}

TEST_CASE("moving one size of a dish moves the other sizes, and nothing else", "[catalog][subcategories][sizes]") {
    MenuFixture x;
    const auto pizza = x.category("Pizza"), special = x.category("Xüsusi");
    x.call("catalog.upsertProduct", {{"categoryId", pizza}, {"nameAz", "Marqarit"}, {"priceMinor", 0}, {"active", true},
                                     {"sizeVariants", pos::Json::array({{{"sizeCm", 28}, {"priceMinor", 1000}},
                                                                        {{"sizeCm", 32}, {"priceMinor", 1400}}})}});
    const auto other = x.product(pizza, "Marqarita sous", 100);
    const auto small = x.text("SELECT id FROM menu_items WHERE name_az='Marqarit · 28 sm'");
    x.call("catalog.upsertProduct", {{"id", small}, {"categoryId", special}, {"nameAz", "Marqarit · 28 sm"}});
    REQUIRE(x.text("SELECT category_id FROM menu_items WHERE name_az='Marqarit · 28 sm'") == special);
    REQUIRE(x.text("SELECT category_id FROM menu_items WHERE name_az='Marqarit · 32 sm'") == special);
    REQUIRE(x.text("SELECT category_id FROM menu_items WHERE id='" + other + "'") == pizza);
}

TEST_CASE("sizes can be in grams, millilitres and the like", "[catalog][sizes]") {
    MenuFixture x;
    const auto meat = x.category("Ət");
    const auto sized = [&](const std::string& name, const std::string& unit, double size) {
        return x.call("catalog.upsertProduct", {{"categoryId", meat}, {"nameAz", name}, {"priceMinor", 0}, {"active", true}, {"sizeUnit", unit},
                                                {"sizeVariants", pos::Json::array({{{"sizeCm", size}, {"priceMinor", 1000}}})}});
    };
    sized("Kabab", "qr", 500);
    REQUIRE(x.number("SELECT COUNT(*) FROM menu_items WHERE name_az='Kabab · 500 qr'") == 1);
    sized("Ayran", "ml", 330);
    REQUIRE(x.number("SELECT COUNT(*) FROM menu_items WHERE name_az='Ayran · 330 ml'") == 1);
    REQUIRE_THROWS_AS(sized("Çörək", "ton", 1), pos::PosError);
    REQUIRE_THROWS_AS(sized("Pizza", "sm", 500), pos::PosError);  // 300 stays the limit for centimetres

    // Without a unit it stays centimetres, as before.
    x.call("catalog.upsertProduct", {{"categoryId", meat}, {"nameAz", "Lavaş"}, {"priceMinor", 0}, {"active", true},
                                     {"sizeVariants", pos::Json::array({{{"sizeCm", 30}, {"priceMinor", 100}}})}});
    REQUIRE(x.number("SELECT COUNT(*) FROM menu_items WHERE name_az='Lavaş · 30 sm'") == 1);
}

TEST_CASE("a set menu gives up its parts' ingredients and costs what they cost", "[catalog][menu]") {
    MenuFixture x;
    const auto food = x.category("Yemək");
    auto& db = x.f.db();
    const auto ingredient = [&](const std::string& name, pos::Money cost) {
        const auto id = pos::crypto::uuid4();
        auto q = db.prepare("INSERT INTO ingredients (id, sku, name, unit, cost_minor, avg_cost_minor, created_at, updated_at) "
                            "VALUES (:id, :sku, :name, 'kg', :cost, :cost, :now, :now)");
        q.bind(":id", id).bind(":sku", "ING-" + id.substr(0, 8)).bind(":name", name).bind(":cost", cost).bind(":now", pos::nowMs()).exec();
        return id;
    };
    const auto meat = ingredient("Ət", 2000);
    const auto doner = x.product(food, "Dönər", 600), cola = x.product(food, "Kola", 200);
    x.call("recipes.save", {{"menuItemId", doner}, {"lines", pos::Json::array({{{"ingredientId", meat}, {"qtyMilli", 150}}})}});
    const auto colaCard = x.cardOf(cola);
    REQUIRE_FALSE(colaCard.empty());

    const auto lunch = x.product(food, "Biznes lanç", 700, {{"components", pos::Json::array({{{"menuItemId", doner}, {"qtyMilli", 1000}},
                                                                                              {{"menuItemId", cola}, {"qtyMilli", 2000}}})}});
    // No stock card of its own: the menu is not a thing on a shelf.
    REQUIRE(x.cardOf(lunch).empty());
    REQUIRE(x.number("SELECT COUNT(*) FROM ingredients WHERE sku='MENU-" + lunch + "'") == 0);

    REQUIRE(x.expanded(lunch, meat) == 150);
    REQUIRE(x.expanded(lunch, colaCard) == 2000);

    const auto recipe = x.call("recipes.get", {{"menuItemId", lunch}});
    REQUIRE(recipe.at("components").size() == 2);
    REQUIRE(recipe.at("costMinor").get<pos::Money>() >= 300);

    // The list tells the screen which products are menus.
    const auto products = x.call("catalog.products", {{"categoryId", food}});
    bool seen = false;
    for (const auto& p : products.at("products")) {
        if (p.at("id") == lunch) {
            seen = true;
            REQUIRE(p.at("componentCount") == 2);
        }
    }
    REQUIRE(seen);

    // Selling takes the parts' stock, not a card of the menu.
    x.f.openTill();
    pos::handlers::registerOrders(x.f.contextPtr());
    const auto order = x.call(std::string(pos::protocol::method::kOrdersCreate), {{"tableId", "tbl-01"}, {"guestCount", 1}});
    const std::string orderId = order["id"];
    x.call(std::string(pos::protocol::method::kOrdersAddItem), {{"orderId", orderId}, {"productId", lunch}, {"quantity", 2}});
    const auto warehouse = x.text("SELECT id FROM warehouses WHERE active=1 LIMIT 1");
    pos::services::InventoryService(x.f.ctx()).consumeForOrder(orderId, warehouse);
    const auto taken = [&](const std::string& item) {
        auto q = db.prepare("SELECT COALESCE(-SUM(qty_delta_milli), 0) FROM stock_movements WHERE ingredient_id=:id AND reference_id=:order");
        q.bind(":id", item).bind(":order", orderId);
        REQUIRE(q.step());
        return q.columnInt(0);
    };
    REQUIRE(taken(meat) == 300);
    REQUIRE(taken(colaCard) == 4000);
}

TEST_CASE("a set menu cannot contain itself or be empty", "[catalog][menu]") {
    MenuFixture x;
    const auto food = x.category("Yemək");
    const auto soup = x.product(food, "Şorba", 300);
    const auto lunch = x.product(food, "Lanç", 700, {{"components", pos::Json::array({{{"menuItemId", soup}, {"qtyMilli", 1000}}})}});
    const auto dinner = x.product(food, "Şam", 900, {{"components", pos::Json::array({{{"menuItemId", lunch}, {"qtyMilli", 1000}}})}});
    const auto save = [&](const std::string& id, pos::Json parts) {
        x.call("catalog.upsertProduct", {{"id", id}, {"categoryId", food}, {"nameAz", "x"}, {"priceMinor", 100}, {"components", std::move(parts)}});
    };
    REQUIRE_THROWS_AS(save(lunch, pos::Json::array({{{"menuItemId", lunch}, {"qtyMilli", 1000}}})), pos::PosError);
    REQUIRE_THROWS_AS(save(lunch, pos::Json::array({{{"menuItemId", dinner}, {"qtyMilli", 1000}}})), pos::PosError);
    REQUIRE_THROWS_AS(save(lunch, pos::Json::array()), pos::PosError);
    REQUIRE_THROWS_AS(save(lunch, pos::Json::array({{{"menuItemId", "yoxdur"}, {"qtyMilli", 1000}}})), pos::PosError);
    REQUIRE_THROWS_AS(save(lunch, pos::Json::array({{{"menuItemId", soup}, {"qtyMilli", 0}}})), pos::PosError);
}

TEST_CASE("staff can be renamed; a manager cannot make an administrator or change one's PIN", "[users]") {
    MenuFixture x;
    const auto user = x.call("users.create", {{"fullName", "Aysel"}, {"pin", "4821"}, {"role", "waiter"}}).at("id").get<std::string>();
    x.call("users.update", {{"userId", user}, {"fullName", "Aysel M."}, {"role", "supervisor"}});
    REQUIRE(x.text("SELECT full_name FROM users WHERE id='" + user + "'") == "Aysel M.");
    REQUIRE(x.text("SELECT primary_role_id FROM users WHERE id='" + user + "'") == "role-supervisor");
    REQUIRE_THROWS_AS(x.call("users.update", {{"userId", user}, {"role", "administrator"}}), pos::PosError);

    x.call("users.setPin", {{"userId", user}, {"pin", "5930"}});  // administrator may
    x.call("users.setPin", {{"userId", "usr-admin"}, {"pin", "7314"}});  // administrator may

    auto& session = x.f.contextPtr()->session();
    session.role = "manager";
    x.call("users.setPin", {{"userId", user}, {"pin", "6041"}});  // manager manages staff
    REQUIRE_THROWS_AS(x.call("users.setPin", {{"userId", "usr-admin"}, {"pin", "8425"}}), pos::PosError);
}

TEST_CASE("recipe saves expand nested portions and rollback conflicting changes","[catalog][recipe][1103]") {
    MenuFixture x;
    const auto category=x.category("Test recipes");
    const auto flour=x.call("ingredients.save",{{"name","Un"},{"unit","kg"}}).at("id").get<std::string>();
    const auto base=x.product(category,"Xəmir",500);
    const auto sized=x.product(category,"Pizza · 28 sm",800);
    const auto large=x.product(category,"Pizza · 30 sm",1000);
    const auto set=x.product(category,"Menyu",1200);
    const auto parts=[](const std::string& child,int qty){
        return pos::Json::array({{{"menuItemId",child},{"qtyMilli",qty}}});
    };
    x.call("recipes.save",{{"menuItemId",base},{"lines",pos::Json::array({{{"ingredientId",flour},{"qtyMilli",200}}})}});
    const auto none=pos::Json::array();
    x.call("recipes.save",{{"menuItemId",sized},{"lines",none},{"components",parts(base,1000)}});
    x.call("recipes.save",{{"menuItemId",large},{"lines",none},{"components",parts(base,1500)}});
    x.call("recipes.save",{{"menuItemId",set},{"lines",none},{"components",parts(large,2000)}});
    REQUIRE(x.expanded(sized,flour)==200);
    REQUIRE(x.expanded(large,flour)==300);
    REQUIRE(x.expanded(set,flour)==600);
    REQUIRE(x.expanded(set,x.cardOf(base))==0);
    const auto costing=x.call("reports.costing",pos::Json::object()).at("items");
    const auto row=std::find_if(costing.begin(),costing.end(),[&](const pos::Json& item){return item.at("id")==base;});
    REQUIRE(row!=costing.end());
    REQUIRE(row->at("hasPreparedRecipe")==1);
    REQUIRE(row->at("linkedIngredientId")==x.cardOf(base));
    REQUIRE(x.call("recipes.get",{{"menuItemId",set}}).at("components")[0].at("menuItemId")==large);

    x.call("recipes.save",{{"menuItemId",large},{"lines",none}});
    REQUIRE(x.expanded(set,flour)==600);
    REQUIRE_THROWS_AS(x.call("recipes.save",{{"menuItemId",base},{"lines",none},{"components",parts(set,1000)}}),pos::PosError);
    REQUIRE(x.expanded(set,flour)==600);
    REQUIRE_THROWS_AS(x.call("recipes.save",{{"menuItemId",large},{"lines",pos::Json::array({{{"ingredientId",x.cardOf(base)},{"qtyMilli",1000}}})},{"components",parts(base,1500)}}),pos::PosError);
    REQUIRE(x.expanded(large,flour)==300);

    x.f.openTill();
    pos::handlers::registerOrders(x.f.contextPtr());
    pos::handlers::registerPayments(x.f.contextPtr());
    pos::handlers::registerSales(x.f.contextPtr());
    auto order=x.f.db().prepare(
        "INSERT INTO orders(id,order_number,user_id,status,opened_at,updated_at) "
        "VALUES('nested-sale','NESTED-1103','usr-admin','open',:at,:at)");
    order.bind(":at",pos::nowMs()).exec();
    auto line=x.f.db().prepare(
        "INSERT INTO order_items(id,order_id,product_id,line_seq,name_snapshot,unit_price_minor,quantity,"
        "line_total_minor,status,created_at,updated_at) VALUES('nested-line','nested-sale',:dish,1,'Menyu',1200,1,1200,'served',:at,:at)");
    line.bind(":dish",set).bind(":at",pos::nowMs()).exec();
    pos::services::InventoryService inventory(x.f.ctx());
    inventory.move(flour,"wh-main",3000,"adjustment","","Test flour");
    x.call("payments.createCash",{{"orderId","nested-sale"},{"amountMinor",1200}});
    REQUIRE(inventory.levelOf(flour,"wh-main")==2400);
    REQUIRE(inventory.levelOf(x.cardOf(base),"wh-main")==0);
    x.call("sales.delete",{{"orderId","nested-sale"},{"reason","Sınaq satışı ləğv edildi"}});
    REQUIRE(inventory.levelOf(flour,"wh-main")==3000);
}

TEST_CASE("a prepared dish saved through its stock card becomes a recipe part","[catalog][recipe][1104]") {
    MenuFixture x;
    const auto category=x.category("Card recipes");
    const auto flour=x.call("ingredients.save",{{"name","Un"},{"unit","kg"}}).at("id").get<std::string>();
    const auto salt=x.call("ingredients.save",{{"name","Duz"},{"unit","kg"}}).at("id").get<std::string>();
    const auto dough=x.product(category,"Xəmir",500);
    const auto pizza=x.product(category,"Pizza",900);
    const auto plain=x.product(category,"Kola",200);
    x.call("recipes.save",{{"menuItemId",dough},{"lines",pos::Json::array({{{"ingredientId",flour},{"qtyMilli",200}}})}});

    x.call("recipes.save",{{"menuItemId",pizza},{"lines",pos::Json::array({
        {{"ingredientId",x.cardOf(dough)},{"qtyMilli",2000}},{{"ingredientId",salt},{"qtyMilli",10}},
        {{"ingredientId",x.cardOf(plain)},{"qtyMilli",1000}}})}});
    const auto saved=x.call("recipes.get",{{"menuItemId",pizza}});
    REQUIRE(saved.at("components").size()==1);
    REQUIRE(saved.at("components")[0].at("menuItemId")==dough);
    REQUIRE(saved.at("components")[0].at("qtyMilli")==2000);
    REQUIRE(x.expanded(pizza,flour)==400);
    REQUIRE(x.expanded(pizza,salt)==10);
    REQUIRE(x.expanded(pizza,x.cardOf(dough))==0);
    REQUIRE(x.expanded(pizza,x.cardOf(plain))==1000);  // a good with no recipe stays a stock line

    // Saving the lines alone keeps the parts already there.
    x.call("recipes.save",{{"menuItemId",pizza},{"lines",pos::Json::array({{{"ingredientId",salt},{"qtyMilli",20}}})}});
    REQUIRE(x.expanded(pizza,flour)==400);
    REQUIRE(x.expanded(pizza,salt)==20);

    // A dish cannot end up inside itself through a card.
    REQUIRE_THROWS_AS(x.call("recipes.save",{{"menuItemId",dough},{"lines",pos::Json::array({{{"ingredientId",x.cardOf(pizza)},{"qtyMilli",1000}}})}}),pos::PosError);
    REQUIRE(x.expanded(pizza,flour)==400);
}

TEST_CASE("selling a doner takes the meat and what is inside its sauce","[catalog][recipe][1105]") {
    MenuFixture x;
    const auto category=x.category("Doner");
    const auto meat=x.call("ingredients.save",{{"name","Ət"},{"unit","kg"}}).at("id").get<std::string>();
    const auto garlic=x.call("ingredients.save",{{"name","Sarımsaq"},{"unit","kg"}}).at("id").get<std::string>();
    const auto oil=x.call("ingredients.save",{{"name","Yağ"},{"unit","l"}}).at("id").get<std::string>();
    const auto line=[](const std::string& id,int qty){return pos::Json{{"ingredientId",id},{"qtyMilli",qty}};};

    // The sauce is off the sale screen, and the doner got it before it had a recipe.
    const auto sauce=x.product(category,"Sous",100);
    const auto doner=x.product(category,"Dönər",800);
    auto hide=x.f.db().prepare("UPDATE menu_items SET active=0 WHERE id=:id");hide.bind(":id",sauce).exec();
    x.call("recipes.save",{{"menuItemId",doner},{"lines",pos::Json::array({line(meat,150),line(x.cardOf(sauce),2000)})}});
    REQUIRE(x.expanded(doner,x.cardOf(sauce))==2000);
    x.call("recipes.save",{{"menuItemId",sauce},{"lines",pos::Json::array({line(garlic,10),line(oil,20)})}});
    REQUIRE(x.expanded(doner,x.cardOf(sauce))==0);
    REQUIRE(x.expanded(doner,meat)==150);
    REQUIRE(x.expanded(doner,garlic)==20);
    REQUIRE(x.expanded(doner,oil)==40);

    // Picked again later, by card, while still hidden.
    x.call("recipes.save",{{"menuItemId",doner},{"lines",pos::Json::array({line(meat,150),line(x.cardOf(sauce),1000)})},{"components",pos::Json::array()}});
    REQUIRE(x.expanded(doner,garlic)==10);

    x.f.openTill();
    pos::handlers::registerOrders(x.f.contextPtr());
    pos::handlers::registerPayments(x.f.contextPtr());
    pos::handlers::registerSales(x.f.contextPtr());
    auto order=x.f.db().prepare("INSERT INTO orders(id,order_number,user_id,status,opened_at,updated_at) VALUES('doner-sale','DONER-1','usr-admin','open',:at,:at)");
    order.bind(":at",pos::nowMs()).exec();
    auto item=x.f.db().prepare("INSERT INTO order_items(id,order_id,product_id,line_seq,name_snapshot,unit_price_minor,quantity,line_total_minor,status,created_at,updated_at) "
        "VALUES('doner-line','doner-sale',:dish,1,'Dönər',800,1,800,'served',:at,:at)");
    item.bind(":dish",doner).bind(":at",pos::nowMs()).exec();
    pos::services::InventoryService inventory(x.f.ctx());
    for(const auto& id:{meat,garlic,oil})inventory.move(id,"wh-main",1000,"adjustment","","Test");
    x.call("payments.createCash",{{"orderId","doner-sale"},{"amountMinor",800}});
    REQUIRE(inventory.levelOf(meat,"wh-main")==850);
    REQUIRE(inventory.levelOf(garlic,"wh-main")==990);
    REQUIRE(inventory.levelOf(oil,"wh-main")==980);
    REQUIRE(inventory.levelOf(x.cardOf(sauce),"wh-main")==0);
}
