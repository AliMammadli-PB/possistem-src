#include "pos/services/InventoryService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {

Json InventoryService::move(const std::string& ingredientId, const std::string& warehouseId,
                            std::int64_t qtyDeltaMilli, std::string_view kind,
                            const std::string& referenceId, std::string_view reason) {
    if (qtyDeltaMilli == 0) {
        throw PosError(std::string(protocol::err::kValidation), "Miqdar sıfır ola bilməz");
    }

    auto ingredient = ctx_.db().prepare(
        "SELECT name, unit FROM ingredients WHERE id = :id AND active = 1");
    ingredient.bind(":id", ingredientId);
    if (!ingredient.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "İnqrediyent tapılmadı");
    }

    auto warehouse = ctx_.db().prepare(
        "SELECT name FROM warehouses WHERE id = :id AND active = 1");
    warehouse.bind(":id", warehouseId);
    if (!warehouse.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Anbar tapılmadı");
    }

    const auto now = nowMs();
    const std::string movementId = crypto::uuid4();

    auto insert = ctx_.db().prepare(
        "INSERT INTO stock_movements (id, ingredient_id, warehouse_id, kind, qty_delta_milli, "
        "                             reference_id, reason, actor_user_id, created_at) "
        "VALUES (:id, :ingredient, :warehouse, :kind, :delta, :reference, :reason, :actor, :now)");
    insert.bind(":id", movementId)
        .bind(":ingredient", ingredientId)
        .bind(":warehouse", warehouseId)
        .bind(":kind", std::string(kind))
        .bind(":delta", qtyDeltaMilli)
        .bind(":reference", referenceId)
        .bind(":reason", std::string(reason))
        .bindOptional(":actor", ctx_.session().userId)
        .bind(":now", now);
    insert.exec();

    // The projection follows the ledger, never the other way round.
    auto upsert = ctx_.db().prepare(
        "INSERT INTO stock_levels (ingredient_id, warehouse_id, qty_milli, updated_at) "
        "VALUES (:ingredient, :warehouse, :delta, :now) "
        "ON CONFLICT(ingredient_id, warehouse_id) DO UPDATE SET "
        "  qty_milli = qty_milli + :delta, updated_at = :now");
    upsert.bind(":ingredient", ingredientId)
        .bind(":warehouse", warehouseId)
        .bind(":delta", qtyDeltaMilli)
        .bind(":now", now);
    upsert.exec();

    return Json{{"id", movementId},
                {"ingredientId", ingredientId},
                {"warehouseId", warehouseId},
                {"kind", std::string(kind)},
                {"qtyDeltaMilli", qtyDeltaMilli},
                {"qtyMilli", levelOf(ingredientId, warehouseId)}};
}

std::int64_t InventoryService::levelOf(const std::string& ingredientId,
                                       const std::string& warehouseId) {
    auto stmt = ctx_.db().prepare(
        "SELECT qty_milli FROM stock_levels "
        "WHERE ingredient_id = :ingredient AND warehouse_id = :warehouse");
    stmt.bind(":ingredient", ingredientId).bind(":warehouse", warehouseId);
    return stmt.step() ? stmt.columnInt(0) : 0;
}

Json InventoryService::consumeForOrder(const std::string& orderId,
                                       const std::string& warehouseId) {
    // One row per ingredient, already multiplied by how many of each dish sold.
    // Grouping here rather than per line means a bill with the same dish on two
    // lines writes one movement, which is what a stock report should show.
    auto rows = ctx_.db().prepare(
        "SELECT r.ingredient_id, SUM(r.qty_milli * i.quantity) AS needed "
        "FROM order_items i "
        "JOIN menu_item_ingredients r ON r.menu_item_id = i.product_id "
        "WHERE i.order_id = :order AND i.status != 'voided' "
        "GROUP BY r.ingredient_id");
    rows.bind(":order", orderId);

    struct Need {
        std::string ingredientId;
        std::int64_t milli;
    };
    std::vector<Need> needs;
    while (rows.step()) needs.push_back({rows.columnText(0), rows.columnInt(1)});

    Json written = Json::array();
    for (const auto& need : needs) {
        if (need.milli <= 0) continue;
        // Stock is allowed to go negative: refusing to close a paid bill because
        // the store says there is no flour left would be worse than a negative
        // balance the low-stock report then shouts about.
        written.push_back(move(need.ingredientId, warehouseId, -need.milli, "sale", orderId,
                               "order consumption"));
    }
    return Json{{"movements", written}, {"orderId", orderId}};
}

Json InventoryService::consumeOnClose(const std::string& orderId) {
    auto done = ctx_.db().prepare(
        "SELECT 1 FROM stock_movements WHERE kind = 'sale' AND reference_id = :order LIMIT 1");
    done.bind(":order", orderId);
    if (done.step()) return Json{{"movements", Json::array()}, {"orderId", orderId}};

    auto store = ctx_.db().prepare(
        "SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
    if (!store.step()) return Json{{"movements", Json::array()}, {"orderId", orderId}};
    return consumeForOrder(orderId, store.columnText(0));
}

Json InventoryService::lowStock() {
    auto stmt = ctx_.db().prepare(
        "SELECT i.id, i.name, i.unit, i.min_qty_milli AS minQtyMilli, "
        "       COALESCE(SUM(s.qty_milli), 0) AS qtyMilli "
        "FROM ingredients i "
        "LEFT JOIN stock_levels s ON s.ingredient_id = i.id "
        "WHERE i.active = 1 "
        "GROUP BY i.id "
        "HAVING COALESCE(SUM(s.qty_milli), 0) <= i.min_qty_milli "
        "ORDER BY (COALESCE(SUM(s.qty_milli), 0) - i.min_qty_milli)");
    return Json{{"ingredients", stmt.rows()}};
}

Json InventoryService::levels(const std::string& warehouseId) {
    auto stmt = ctx_.db().prepare(
        "SELECT i.id, i.sku, i.name, i.unit, i.cost_minor AS costMinor, "
        "       i.min_qty_milli AS minQtyMilli, "
        "       COALESCE(s.qty_milli, 0) AS qtyMilli "
        "FROM ingredients i "
        "LEFT JOIN stock_levels s ON s.ingredient_id = i.id AND s.warehouse_id = :warehouse "
        "WHERE i.active = 1 ORDER BY i.name");
    stmt.bind(":warehouse", warehouseId);
    return Json{{"warehouseId", warehouseId}, {"levels", stmt.rows()}};
}

Json InventoryService::valuation(const std::string& warehouseId) {
    // Cost is per whole unit and quantities are thousandths, so the division is
    // explicit rather than hidden in a multiplication that silently inflates.
    auto stmt = ctx_.db().prepare(
        "SELECT COALESCE(SUM(s.qty_milli * i.cost_minor / 1000), 0) AS totalMinor, "
        "       COUNT(*) AS lines "
        "FROM stock_levels s JOIN ingredients i ON i.id = s.ingredient_id "
        "WHERE i.active = 1 AND (:warehouse = '' OR s.warehouse_id = :warehouse)");
    stmt.bind(":warehouse", warehouseId);
    stmt.step();
    return Json{{"warehouseId", warehouseId},
                {"totalMinor", stmt.columnInt(0)},
                {"lines", stmt.columnInt(1)}};
}

}  // namespace pos::services
