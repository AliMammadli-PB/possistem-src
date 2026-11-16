#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/InventoryService.hpp"

// 1.10.32: a dish sold as a half portion has its own price and gives up half its recipe.
namespace {
pos::Json call(ServiceFixture& f, std::string_view method, pos::Json payload) {
    pos::ipc::Request request;
    request.requestId = pos::crypto::uuid4();
    request.method = std::string(method);
    request.payload = std::move(payload);
    request.idempotencyKey = pos::crypto::uuid4();
    return f.server().callHandler(request);
}
}  // namespace

TEST_CASE("a half portion has its own price and takes half the recipe", "[catalog][portion][inventory]") {
    ServiceFixture f;
    pos::handlers::registerCatalog(f.contextPtr());
    pos::handlers::registerInventory(f.contextPtr());
    namespace m = pos::protocol::method;

    auto dish = f.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(dish.step());
    const std::string dishId = dish.columnText(0);
    f.db().exec("UPDATE menu_items SET price_minor = 1000 WHERE id = '" + dishId + "'");

    call(f, m::kCatalogSetPortions, {{"productId", dishId}, {"halfPriceMinor", 600}});
    auto groups = call(f, m::kCatalogModifierGroups, {{"productId", dishId}}).at("groups");
    REQUIRE(groups.size() >= 1);
    REQUIRE(groups[0].at("id") == "portion:" + dishId);
    const auto half = groups[0].at("modifiers").at(0);
    REQUIRE(half.at("nameAz") == "Yarım porsiya");
    REQUIRE(half.at("priceDeltaMinor") == -400);

    // Not in the shared modifier list, and saving the product's other groups keeps it.
    for (const auto& g : call(f, m::kCatalogModifierGroups, pos::Json::object()).at("groups"))
        REQUIRE(g.at("id").get<std::string>().rfind("portion:", 0) != 0);
    call(f, m::kCatalogSetProductModifierGroups, {{"productId", dishId}, {"groupIds", pos::Json::array()}});
    REQUIRE(call(f, m::kCatalogModifierGroups, {{"productId", dishId}}).at("groups").size() == 1);

    // The full price goes up; the half portion stays at 6.00.
    f.db().exec("UPDATE menu_items SET price_minor = 1200 WHERE id = '" + dishId + "'");
    auto delta = f.db().prepare("SELECT price_delta_minor FROM modifiers WHERE id = :id");
    delta.bind(":id", "portion:" + dishId + ":half");
    REQUIRE(delta.step());
    REQUIRE(delta.columnInt(0) == -600);

    // Stock: 2 half portions + 1 full = 2 recipes of 250.
    const auto beef = call(f, m::kIngredientsSave, {{"name", "Mal əti"}, {"unit", "kg"}, {"costMinor", 1000}})
                          .at("id").get<std::string>();
    call(f, m::kRecipesSave, {{"menuItemId", dishId},
                              {"lines", pos::Json::array({{{"ingredientId", beef}, {"qtyMilli", 250}}})}});
    pos::services::InventoryService inventory(f.ctx());
    inventory.move(beef, "wh-main", 10000, "receipt");
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = f.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, discount_minor, tax_minor, "
        "service_minor, total_minor, paid_minor, tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'HALF-1', 'usr-admin', 'open', 2, 0,0,0,0,0,0,0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now).exec();
    auto line = [&](int seq, int qty, bool halfPortion) {
        const auto id = pos::crypto::uuid4();
        auto item = f.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, unit_price_minor, quantity, "
            "modifier_total_minor, line_total_minor, status, created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, :seq, 'Yemək', 1200, :qty, 0, 0, 'sent', :now, :now, 1)");
        item.bind(":id", id).bind(":order", orderId).bind(":product", dishId).bind(":seq", seq)
            .bind(":qty", qty).bind(":now", now).exec();
        if (!halfPortion) return;
        auto mod = f.db().prepare(
            "INSERT INTO order_item_modifiers (id, order_item_id, modifier_id, group_name_snapshot, name_snapshot, "
            "price_delta_minor) VALUES (:id, :item, :mod, 'Porsiya', 'Yarım porsiya', -600)");
        mod.bind(":id", pos::crypto::uuid4()).bind(":item", id).bind(":mod", "portion:" + dishId + ":half").exec();
    };
    line(1, 2, true);
    line(2, 1, false);
    inventory.consumeForOrder(orderId, "wh-main");
    REQUIRE(inventory.levelOf(beef, "wh-main") == 10000 - 250 - 250);

    // Switched off: no longer offered.
    call(f, m::kCatalogSetPortions, {{"productId", dishId}, {"halfPriceMinor", 0}});
    REQUIRE(call(f, m::kCatalogModifierGroups, {{"productId", dishId}}).at("groups").empty());
}
