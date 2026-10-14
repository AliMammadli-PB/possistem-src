#include "pos/services/ReplenishService.hpp"

#include <algorithm>
#include <cstdio>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/services/InventoryService.hpp"

namespace pos::services {

std::string ReplenishService::defaultWarehouse() {
    auto row = ctx_.db().prepare("SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
    return row.step() ? row.columnText(0) : std::string{};
}

ReplenishService::Rule ReplenishService::ruleFor(const std::string& ingredientId, const std::string& warehouseId) {
    Rule rule;
    auto own = ctx_.db().prepare(
        "SELECT min_qty_milli, target_qty_milli, reorder_qty_milli FROM stock_rules "
        "WHERE ingredient_id = :ingredient AND warehouse_id = :warehouse");
    own.bind(":ingredient", ingredientId).bind(":warehouse", warehouseId);
    if (own.step()) {
        rule = {own.columnInt(0), own.columnInt(1), own.columnInt(2)};
    } else if (warehouseId == defaultWarehouse()) {
        auto legacy = ctx_.db().prepare("SELECT min_qty_milli FROM ingredients WHERE id = :id");
        legacy.bind(":id", ingredientId);
        if (legacy.step()) rule.min = legacy.columnInt(0);
    }
    // Without a target, order up to twice the minimum.
    if (rule.target <= rule.min) rule.target = rule.min * 2;
    return rule;
}

std::int64_t ReplenishService::onOrder(const std::string& ingredientId, const std::string& warehouseId) {
    auto row = ctx_.db().prepare(
        "SELECT COALESCE(SUM(MAX(0, l.qty_milli - l.received_milli - l.pending_milli)), 0) "
        "FROM purchase_order_items l JOIN purchase_orders p ON p.id = l.purchase_id "
        "WHERE l.ingredient_id = :ingredient AND p.warehouse_id = :warehouse "
        "  AND p.stage IN ('draft','ordered','partially_received')");
    row.bind(":ingredient", ingredientId).bind(":warehouse", warehouseId);
    row.step();
    return row.columnInt(0);
}

Json ReplenishService::suggestSupplier(const std::string& ingredientId) {
    auto rows = ctx_.db().prepare(
        "SELECT si.supplier_id, s.name, si.last_price_minor, si.lead_days, si.min_order_milli, si.pack_milli, "
        "       si.preferred FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.active = 1 "
        "WHERE si.ingredient_id = :id AND si.last_price_minor > 0");
    rows.bind(":id", ingredientId);
    Json best;
    std::int64_t bestScore = 0;
    bool bestPreferred = false;
    while (rows.step()) {
        const bool preferred = rows.columnInt(6) != 0;
        // Price weighed by lead time: every day of waiting counts as 2% dearer.
        const std::int64_t score = rows.columnInt(2) * (100 + 2 * std::max<std::int64_t>(0, rows.columnInt(3)));
        if (best.is_null() || (preferred && !bestPreferred) || (preferred == bestPreferred && score < bestScore)) {
            best = Json{{"supplierId", rows.columnText(0)}, {"supplierName", rows.columnText(1)},
                        {"priceMinor", rows.columnInt(2)}, {"leadDays", rows.columnInt(3)},
                        {"minOrderMilli", rows.columnInt(4)}, {"packMilli", rows.columnInt(5)},
                        {"preferred", preferred}};
            bestScore = score;
            bestPreferred = preferred;
        }
    }
    return best;
}

std::int64_t ReplenishService::orderQty(const Rule& rule, std::int64_t level, std::int64_t open, const Json& supplier) {
    std::int64_t qty = std::max<std::int64_t>(rule.reorder, rule.target - (level + open));
    if (supplier.is_object()) {
        qty = std::max<std::int64_t>(qty, supplier.value("minOrderMilli", std::int64_t{0}));
        const auto pack = supplier.value("packMilli", std::int64_t{0});
        if (pack > 0) qty = (qty + pack - 1) / pack * pack;
    }
    return std::max<std::int64_t>(qty, 0);
}

std::string ReplenishService::nextPurchaseNumber() {
    auto seq = ctx_.db().prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(number, 3) AS INTEGER)), 0) + 1 FROM purchase_orders WHERE number LIKE 'A-%'");
    seq.step();
    char number[32];
    std::snprintf(number, sizeof(number), "A-%05lld", static_cast<long long>(seq.columnInt(0)));
    return number;
}

std::string ReplenishService::addToDraft(const std::string& supplierId, const std::string& warehouseId,
                                         const std::string& ingredientId, std::int64_t qtyMilli, Money priceMinor) {
    const auto now = nowMs();
    auto open = ctx_.db().prepare(
        "SELECT id FROM purchase_orders WHERE stage = 'draft' AND auto_draft = 1 AND supplier_id = :supplier "
        "AND warehouse_id = :warehouse ORDER BY created_at LIMIT 1");
    open.bind(":supplier", supplierId).bind(":warehouse", warehouseId);
    std::string id;
    if (open.step()) {
        id = open.columnText(0);
    } else {
        id = "po-" + crypto::uuid4().substr(0, 8);
        auto insert = ctx_.db().prepare(
            "INSERT INTO purchase_orders (id, number, supplier_id, warehouse_id, status, stage, auto_draft, note, "
            "  created_at) VALUES (:id, :number, :supplier, :warehouse, 'draft', 'draft', 1, "
            "  'Avtomatik təklif: stok minimumdan aşağıdır', :now)");
        insert.bind(":id", id).bind(":number", nextPurchaseNumber()).bind(":supplier", supplierId)
            .bind(":warehouse", warehouseId).bind(":now", now);
        insert.exec();
    }
    auto line = ctx_.db().prepare(
        "INSERT INTO purchase_order_items (id, purchase_id, ingredient_id, qty_milli, unit_cost_minor, "
        "  line_total_minor, landed_unit_cost_minor) VALUES (:id, :purchase, :ingredient, :qty, :price, :total, :price)");
    line.bind(":id", crypto::uuid4()).bind(":purchase", id).bind(":ingredient", ingredientId)
        .bind(":qty", qtyMilli).bind(":price", priceMinor).bind(":total", qtyMilli * priceMinor / 1000);
    line.exec();
    auto total = ctx_.db().prepare(
        "UPDATE purchase_orders SET total_minor = (SELECT COALESCE(SUM(line_total_minor), 0) FROM purchase_order_items "
        "WHERE purchase_id = :id) WHERE id = :id");
    total.bind(":id", id);
    total.exec();
    return id;
}

void ReplenishService::check(const std::string& ingredientId, const std::string& warehouseId) {
    // A sale must never fail because a suggestion could not be written.
    try {
        const Rule rule = ruleFor(ingredientId, warehouseId);
        if (rule.min <= 0) return;
        const auto level = InventoryService(ctx_).levelOf(ingredientId, warehouseId);
        const auto open = onOrder(ingredientId, warehouseId);
        if (level + open > rule.min) return;
        // Already on a draft or an open order: the same shortage is not drafted twice.
        auto pending = ctx_.db().prepare(
            "SELECT 1 FROM purchase_order_items l JOIN purchase_orders p ON p.id = l.purchase_id "
            "WHERE l.ingredient_id = :ingredient AND p.warehouse_id = :warehouse "
            "  AND p.stage IN ('draft','ordered','partially_received') "
            "  AND l.qty_milli > l.received_milli + l.pending_milli LIMIT 1");
        pending.bind(":ingredient", ingredientId).bind(":warehouse", warehouseId);
        if (pending.step()) return;
        const Json supplier = suggestSupplier(ingredientId);
        if (!supplier.is_object()) return;  // shown under suggestions, a person picks the supplier
        const auto qty = orderQty(rule, level, open, supplier);
        if (qty <= 0) return;
        addToDraft(supplier.value("supplierId", std::string{}), warehouseId, ingredientId, qty,
                   supplier.value("priceMinor", Money{0}));
    } catch (const std::exception& e) {
        logging::get("core")->warn("replenish check skipped for {}: {}", ingredientId, e.what());
    }
}

Json ReplenishService::suggestions(const std::string& warehouseId) {
    const std::string main = defaultWarehouse();
    auto candidates = ctx_.db().prepare(
        "SELECT r.ingredient_id, r.warehouse_id FROM stock_rules r JOIN ingredients i ON i.id = r.ingredient_id "
        "WHERE i.active = 1 AND r.min_qty_milli > 0 AND (:warehouse = '' OR r.warehouse_id = :warehouse) "
        "UNION SELECT i.id, :main FROM ingredients i WHERE i.active = 1 AND i.min_qty_milli > 0 "
        "  AND (:warehouse = '' OR :warehouse = :main) "
        "  AND NOT EXISTS (SELECT 1 FROM stock_rules r WHERE r.ingredient_id = i.id AND r.warehouse_id = :main)");
    candidates.bind(":warehouse", warehouseId).bind(":main", main);
    std::vector<std::pair<std::string, std::string>> pairs;
    while (candidates.step()) pairs.emplace_back(candidates.columnText(0), candidates.columnText(1));

    InventoryService inventory(ctx_);
    Json out = Json::array();
    for (const auto& [ingredient, warehouse] : pairs) {
        const Rule rule = ruleFor(ingredient, warehouse);
        const auto level = inventory.levelOf(ingredient, warehouse);
        const auto open = onOrder(ingredient, warehouse);
        if (rule.min <= 0 || level + open > rule.min) continue;
        auto info = ctx_.db().prepare(
            "SELECT i.name, i.unit, w.name FROM ingredients i, warehouses w WHERE i.id = :i AND w.id = :w");
        info.bind(":i", ingredient).bind(":w", warehouse);
        info.step();
        const Json supplier = suggestSupplier(ingredient);
        out.push_back(Json{{"ingredientId", ingredient}, {"name", info.columnText(0)}, {"unit", info.columnText(1)},
                           {"warehouseId", warehouse}, {"warehouseName", info.columnText(2)},
                           {"qtyMilli", level}, {"onOrderMilli", open}, {"minQtyMilli", rule.min},
                           {"targetQtyMilli", rule.target}, {"suggestedQtyMilli", orderQty(rule, level, open, supplier)},
                           {"supplier", supplier}});
    }
    return out;
}

void ReplenishService::notePrice(const std::string& supplierId, const std::string& ingredientId, Money priceMinor,
                                 const std::string& purchaseId) {
    if (priceMinor <= 0) return;
    const auto now = nowMs();
    auto last = ctx_.db().prepare(
        "SELECT price_minor FROM supplier_price_history WHERE supplier_id = :s AND ingredient_id = :i "
        "AND purchase_id = :p ORDER BY created_at DESC LIMIT 1");
    last.bind(":s", supplierId).bind(":i", ingredientId).bind(":p", purchaseId);
    if (!last.step() || last.columnInt(0) != priceMinor) {
        auto hist = ctx_.db().prepare(
            "INSERT INTO supplier_price_history (id, supplier_id, ingredient_id, price_minor, purchase_id, created_at) "
            "VALUES (:id, :s, :i, :price, :p, :now)");
        hist.bind(":id", crypto::uuid4()).bind(":s", supplierId).bind(":i", ingredientId).bind(":price", priceMinor)
            .bind(":p", purchaseId).bind(":now", now);
        hist.exec();
    }
    auto item = ctx_.db().prepare(
        "INSERT INTO supplier_items (supplier_id, ingredient_id, last_price_minor, updated_at) "
        "VALUES (:s, :i, :price, :now) ON CONFLICT(supplier_id, ingredient_id) DO UPDATE SET "
        "last_price_minor = :price, updated_at = :now");
    item.bind(":s", supplierId).bind(":i", ingredientId).bind(":price", priceMinor).bind(":now", now);
    item.exec();
}

void ReplenishService::noteLeadTime(const std::string& purchaseId) {
    auto head = ctx_.db().prepare(
        "SELECT supplier_id, COALESCE(ordered_at, created_at), COALESCE(received_at, 0) FROM purchase_orders WHERE id = :id");
    head.bind(":id", purchaseId);
    if (!head.step() || head.columnInt(2) <= 0) return;
    const std::int64_t days = std::max<std::int64_t>(0, (head.columnInt(2) - head.columnInt(1)) / 86400000);
    auto upd = ctx_.db().prepare(
        "UPDATE supplier_items SET lead_days = CASE WHEN lead_days > 0 THEN (lead_days * 2 + :d + 1) / 3 ELSE :d END "
        "WHERE supplier_id = :s AND ingredient_id IN (SELECT ingredient_id FROM purchase_order_items WHERE purchase_id = :p)");
    upd.bind(":d", days).bind(":s", head.columnText(0)).bind(":p", purchaseId);
    upd.exec();
}

}  // namespace pos::services
