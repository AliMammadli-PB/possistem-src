#include "pos/services/InventoryService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/ReplenishService.hpp"

#include <algorithm>
#include <vector>

namespace pos::services {

Json InventoryService::move(const std::string& ingredientId, const std::string& warehouseId,
                            std::int64_t qtyDeltaMilli, std::string_view kind,
                            const std::string& referenceId, std::string_view reason,
                            const LotSpec& lot, bool allowArchived) {
    if (qtyDeltaMilli == 0) {
        throw PosError(std::string(protocol::err::kValidation), "Miqdar sıfır ola bilməz");
    }

    auto ingredient = ctx_.db().prepare(
        "SELECT name, unit, cost_minor FROM ingredients WHERE id = :id AND (active = 1 OR :archived = 1)");
    ingredient.bind(":id", ingredientId).bind(":archived", allowArchived ? 1 : 0);
    if (!ingredient.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "İnqrediyent tapılmadı");
    }
    const Money ingredientCost = ingredient.columnInt(2);

    auto warehouse = ctx_.db().prepare(
        "SELECT name FROM warehouses WHERE id = :id AND active = 1");
    warehouse.bind(":id", warehouseId);
    if (!warehouse.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Anbar tapılmadı");
    }

    const auto now = nowMs();
    const std::string movementId = crypto::uuid4();
    const std::int64_t before = levelOf(ingredientId, warehouseId);

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

    const auto lotMove = [&](const std::string& lotId, std::int64_t delta, const std::string& moveKind,
                             const std::string& location) {
        auto row = ctx_.db().prepare(
            "INSERT INTO stock_lot_moves (id, lot_id, movement_id, kind, qty_delta_milli, from_location, "
            "                             to_location, actor_user_id, created_at) "
            "VALUES (:id, :lot, :movement, :kind, :delta, :from, :to, :actor, :now)");
        row.bind(":id", crypto::uuid4()).bind(":lot", lotId).bind(":movement", movementId)
            .bind(":kind", moveKind).bind(":delta", delta)
            .bind(":from", delta < 0 ? location : std::string{}).bind(":to", delta > 0 ? location : std::string{})
            .bindOptional(":actor", ctx_.session().userId).bind(":now", now);
        row.exec();
    };

    Json lots = Json::array();
    if (qtyDeltaMilli > 0) {
        // Stock that was below zero (sold before it was booked in) is covered
        // first; only what is left over sits in a lot.
        const std::int64_t intoLot = qtyDeltaMilli - std::min<std::int64_t>(qtyDeltaMilli, std::max<std::int64_t>(0, -before));
        if (intoLot > 0) {
            std::string lotId = lot.lotId;
            if (!lotId.empty()) {
                auto adopt = ctx_.db().prepare(
                    "UPDATE stock_lots SET quality = 'accepted', qty_milli = :qty, warehouse_id = :warehouse, "
                    "  blocked_at = NULL WHERE id = :id");
                adopt.bind(":qty", intoLot).bind(":warehouse", warehouseId).bind(":id", lotId);
                adopt.exec();
            } else {
                lotId = "lot-" + crypto::uuid4().substr(0, 12);
                auto open = ctx_.db().prepare(
                    "INSERT INTO stock_lots (id, ingredient_id, warehouse_id, location_id, lot_no, purchase_id, "
                    "  purchase_item_id, produced_on, received_at, expires_on, qty_received_milli, qty_milli, "
                    "  unit_cost_minor, quality, created_at) "
                    "VALUES (:id, :ingredient, :warehouse, :location, :lotNo, :purchase, :item, :produced, :received, "
                    "  :expires, :qty, :qty, :cost, 'accepted', :now)");
                open.bind(":id", lotId).bind(":ingredient", ingredientId).bind(":warehouse", warehouseId)
                    .bind(":location", lot.locationId).bind(":lotNo", lot.lotNo).bind(":purchase", lot.purchaseId)
                    .bind(":item", lot.purchaseItemId).bind(":produced", lot.producedOn)
                    .bind(":received", lot.receivedAt > 0 ? lot.receivedAt : now).bind(":expires", lot.expiresOn)
                    .bind(":qty", intoLot).bind(":cost", lot.unitCost >= 0 ? lot.unitCost : ingredientCost)
                    .bind(":now", now);
                open.exec();
            }
            lotMove(lotId, intoLot, std::string(kind), lot.locationId);
            lots.push_back(Json{{"lotId", lotId}, {"qtyMilli", intoLot}});
            // Goods that arrive already past their date never become usable.
            blockExpired(ingredientId, warehouseId);
        }
    } else {
        // First expiring first out: lots still good before expired ones, the
        // nearest date first, undated last; a return to the supplier takes its
        // own invoice's lots first, a write-off the lot it names.
        // Expired lots are blocked first, so they are never drawn from: when
        // good stock runs short the balance goes below zero instead.
        blockExpired(ingredientId, warehouseId);
        std::int64_t need = -qtyDeltaMilli;
        auto pick = ctx_.db().prepare(
            "SELECT id, qty_milli, location_id FROM stock_lots "
            "WHERE ingredient_id = :ingredient AND warehouse_id = :warehouse "
            "  AND quality = 'accepted' AND qty_milli > 0 AND blocked_at IS NULL "
            "  AND (expires_on = '' OR expires_on >= date('now', 'localtime')) "
            "ORDER BY (id = :lot) DESC, (:prefer != '' AND purchase_id = :prefer) DESC, "
            "  (expires_on = '') ASC, expires_on ASC, received_at ASC, created_at ASC");
        pick.bind(":ingredient", ingredientId).bind(":warehouse", warehouseId)
            .bind(":lot", lot.lotId).bind(":prefer", lot.preferPurchaseId);
        struct Take {
            std::string id;
            std::int64_t qty;
            std::string location;
        };
        std::vector<Take> takes;
        while (need > 0 && pick.step()) {
            const std::int64_t take = std::min<std::int64_t>(need, pick.columnInt(1));
            takes.push_back({pick.columnText(0), take, pick.columnText(2)});
            need -= take;
        }
        for (const auto& t : takes) {
            auto use = ctx_.db().prepare("UPDATE stock_lots SET qty_milli = qty_milli - :qty WHERE id = :id");
            use.bind(":qty", t.qty).bind(":id", t.id);
            use.exec();
            lotMove(t.id, -t.qty, std::string(kind), t.location);
            lots.push_back(Json{{"lotId", t.id}, {"qtyMilli", t.qty}});
        }
    }

    if (qtyDeltaMilli < 0) ReplenishService(ctx_).check(ingredientId, warehouseId);

    return Json{{"id", movementId},
                {"ingredientId", ingredientId},
                {"warehouseId", warehouseId},
                {"kind", std::string(kind)},
                {"qtyDeltaMilli", qtyDeltaMilli},
                {"qtyMilli", levelOf(ingredientId, warehouseId)},
                {"lots", lots}};
}

Json InventoryService::transfer(const std::string& ingredientId, const std::string& fromWarehouse,
                                const std::string& toWarehouse, std::int64_t qtyMilli,
                                const std::string& referenceId) {
    auto out = move(ingredientId, fromWarehouse, -qtyMilli, "transfer_out", referenceId, "transfer");
    Json in = Json::array();
    std::int64_t moved = 0;
    for (const auto& piece : out["lots"]) {
        auto src = ctx_.db().prepare(
            "SELECT lot_no, produced_on, expires_on, unit_cost_minor, purchase_id, purchase_item_id, received_at "
            "FROM stock_lots WHERE id = :id");
        src.bind(":id", piece.value("lotId", std::string{}));
        if (!src.step()) continue;
        LotSpec spec;
        spec.lotNo = src.columnText(0);
        spec.producedOn = src.columnText(1);
        spec.expiresOn = src.columnText(2);
        spec.unitCost = src.columnInt(3);
        spec.purchaseId = src.columnText(4);
        spec.purchaseItemId = src.columnText(5);
        spec.receivedAt = src.columnInt(6);
        const auto qty = piece.value("qtyMilli", std::int64_t{0});
        in.push_back(move(ingredientId, toWarehouse, qty, "transfer_in", referenceId, "transfer", spec));
        moved += qty;
    }
    // Whatever was not in a lot (the store was short) arrives untracked.
    if (moved < qtyMilli) in.push_back(move(ingredientId, toWarehouse, qtyMilli - moved, "transfer_in", referenceId, "transfer"));
    return Json{{"out", out}, {"in", in}};
}

std::int64_t InventoryService::blockExpired(const std::string& ingredientId, const std::string& warehouseId) {
    auto due = ctx_.db().prepare(
        "SELECT id, ingredient_id, warehouse_id, qty_milli, location_id FROM stock_lots "
        "WHERE quality = 'accepted' AND qty_milli > 0 AND blocked_at IS NULL "
        "  AND expires_on != '' AND expires_on < date('now', 'localtime') "
        "  AND (:ingredient = '' OR ingredient_id = :ingredient) AND (:warehouse = '' OR warehouse_id = :warehouse)");
    due.bind(":ingredient", ingredientId).bind(":warehouse", warehouseId);
    struct Lot {
        std::string id;
        std::string ingredient;
        std::string warehouse;
        std::int64_t qty;
        std::string location;
    };
    std::vector<Lot> lots;
    while (due.step()) lots.push_back({due.columnText(0), due.columnText(1), due.columnText(2), due.columnInt(3), due.columnText(4)});
    const auto now = nowMs();
    for (const auto& lot : lots) {
        // Written here rather than through move(): the lot is named, and the
        // write-off must not go looking for other lots to draw from.
        const std::string movementId = crypto::uuid4();
        auto movement = ctx_.db().prepare(
            "INSERT INTO stock_movements (id, ingredient_id, warehouse_id, kind, qty_delta_milli, reference_id, reason, "
            "  actor_user_id, created_at) VALUES (:id, :i, :w, 'waste', :delta, :lot, :reason, :actor, :now)");
        movement.bind(":id", movementId).bind(":i", lot.ingredient).bind(":w", lot.warehouse).bind(":delta", -lot.qty)
            .bind(":lot", lot.id).bind(":reason", std::string("Vaxtı keçib — istifadədən çıxarıldı"))
            .bindOptional(":actor", ctx_.session().userId).bind(":now", now);
        movement.exec();
        auto level = ctx_.db().prepare(
            "INSERT INTO stock_levels (ingredient_id, warehouse_id, qty_milli, updated_at) VALUES (:i, :w, :delta, :now) "
            "ON CONFLICT(ingredient_id, warehouse_id) DO UPDATE SET qty_milli = qty_milli + :delta, updated_at = :now");
        level.bind(":i", lot.ingredient).bind(":w", lot.warehouse).bind(":delta", -lot.qty).bind(":now", now);
        level.exec();
        auto trace = ctx_.db().prepare(
            "INSERT INTO stock_lot_moves (id, lot_id, movement_id, kind, qty_delta_milli, from_location, actor_user_id, "
            "  created_at) VALUES (:id, :lot, :movement, 'expired_block', :delta, :from, :actor, :now)");
        trace.bind(":id", crypto::uuid4()).bind(":lot", lot.id).bind(":movement", movementId).bind(":delta", -lot.qty)
            .bind(":from", lot.location).bindOptional(":actor", ctx_.session().userId).bind(":now", now);
        trace.exec();
        auto block = ctx_.db().prepare("UPDATE stock_lots SET blocked_at = :now WHERE id = :id");
        block.bind(":now", now).bind(":id", lot.id);
        block.exec();
    }
    return static_cast<std::int64_t>(lots.size());
}

Json InventoryService::relocate(const std::string& lotId, const std::string& locationId, std::int64_t qtyMilli) {
    auto lot = ctx_.db().prepare(
        "SELECT warehouse_id, location_id, qty_milli FROM stock_lots WHERE id = :id AND quality != 'rejected'");
    lot.bind(":id", lotId);
    if (!lot.step()) throw PosError(std::string(protocol::err::kNotFound), "Partiya tapılmadı");
    const std::string warehouseId = lot.columnText(0);
    const std::string from = lot.columnText(1);
    const std::int64_t have = lot.columnInt(2);
    if (!locationId.empty()) {
        auto place = ctx_.db().prepare("SELECT 1 FROM stock_locations WHERE id = :id AND warehouse_id = :warehouse");
        place.bind(":id", locationId).bind(":warehouse", warehouseId);
        if (!place.step()) throw PosError(std::string(protocol::err::kValidation), "Yerləşmə bu anbara aid deyil");
    }
    const std::int64_t qty = qtyMilli <= 0 || qtyMilli > have ? have : qtyMilli;
    if (qty <= 0) throw PosError(std::string(protocol::err::kValidation), "Partiyada mal yoxdur");
    std::string target = lotId;
    const auto now = nowMs();
    if (qty == have) {
        auto upd = ctx_.db().prepare("UPDATE stock_lots SET location_id = :to WHERE id = :id");
        upd.bind(":to", locationId).bind(":id", lotId);
        upd.exec();
    } else {
        target = "lot-" + crypto::uuid4().substr(0, 12);
        auto split = ctx_.db().prepare(
            "INSERT INTO stock_lots (id, ingredient_id, warehouse_id, location_id, lot_no, purchase_id, purchase_item_id, "
            "  produced_on, received_at, expires_on, qty_received_milli, qty_milli, unit_cost_minor, quality, created_at, "
            "  blocked_at) "
            "SELECT :new, ingredient_id, warehouse_id, :to, lot_no, purchase_id, purchase_item_id, produced_on, "
            "  received_at, expires_on, :qty, :qty, unit_cost_minor, quality, :now, blocked_at FROM stock_lots WHERE id = :id");
        split.bind(":new", target).bind(":to", locationId).bind(":qty", qty).bind(":now", now).bind(":id", lotId);
        split.exec();
        auto less = ctx_.db().prepare("UPDATE stock_lots SET qty_milli = qty_milli - :qty WHERE id = :id");
        less.bind(":qty", qty).bind(":id", lotId);
        less.exec();
    }
    for (const auto& [id, delta] : {std::pair<std::string, std::int64_t>{lotId, -qty}, {target, qty}}) {
        if (qty == have && delta < 0) continue;  // a whole lot moved: one row says it
        auto row = ctx_.db().prepare(
            "INSERT INTO stock_lot_moves (id, lot_id, kind, qty_delta_milli, from_location, to_location, "
            "                             actor_user_id, created_at) "
            "VALUES (:id, :lot, 'relocate', :delta, :from, :to, :actor, :now)");
        row.bind(":id", crypto::uuid4()).bind(":lot", id).bind(":delta", qty == have ? std::int64_t{0} : delta)
            .bind(":from", from).bind(":to", locationId).bindOptional(":actor", ctx_.session().userId).bind(":now", now);
        row.exec();
    }
    return Json{{"lotId", target}, {"qtyMilli", qty}, {"locationId", locationId}};
}

std::string InventoryService::costingMethod() {
    auto row = ctx_.db().prepare("SELECT value FROM app_settings WHERE key = 'inventory.costingMethod'");
    const std::string method = row.step() ? row.columnText(0) : std::string{"average"};
    return method == "fifo" || method == "last" ? method : std::string{"average"};
}

std::string InventoryService::unitCostSql(const std::string& method, const std::string& warehouseParam) {
    if (method == "last") return "i.cost_minor";
    if (method == "fifo") {
        return "COALESCE((SELECT fl.unit_cost_minor FROM stock_lots fl WHERE fl.ingredient_id = i.id "
               "AND fl.quality = 'accepted' AND fl.qty_milli > 0 AND fl.blocked_at IS NULL" +
               (warehouseParam.empty() ? std::string{} : " AND (" + warehouseParam + " = '' OR fl.warehouse_id = " + warehouseParam + ")") +
               " ORDER BY fl.received_at, fl.created_at LIMIT 1), i.cost_minor)";
    }
    return "(CASE WHEN i.avg_cost_minor > 0 THEN i.avg_cost_minor ELSE i.cost_minor END)";
}

void InventoryService::recordReceiptCost(const std::string& ingredientId, std::int64_t qtyMilli, Money unitCost) {
    if (qtyMilli <= 0 || unitCost < 0) return;
    // Stock on hand before these goods: everything except what just came in.
    auto held = ctx_.db().prepare(
        "SELECT COALESCE(SUM(qty_milli), 0), (SELECT avg_cost_minor FROM ingredients WHERE id = :id) "
        "FROM stock_levels WHERE ingredient_id = :id");
    held.bind(":id", ingredientId);
    held.step();
    const std::int64_t before = std::max<std::int64_t>(0, held.columnInt(0) - qtyMilli);
    const Money avg = held.columnInt(1);
    const Money next = before + qtyMilli > 0
        ? (before * avg + qtyMilli * unitCost + (before + qtyMilli) / 2) / (before + qtyMilli)
        : unitCost;
    auto upd = ctx_.db().prepare(
        "UPDATE ingredients SET avg_cost_minor = :avg, cost_minor = CASE WHEN :cost > 0 THEN :cost ELSE cost_minor END, "
        "updated_at = :now WHERE id = :id");
    upd.bind(":avg", before > 0 && avg > 0 ? next : unitCost).bind(":cost", unitCost).bind(":now", nowMs()).bind(":id", ingredientId);
    upd.exec();
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

    // The branch whose till took the money sells out of its own store room;
    // anything else out of the main one, as before.
    auto branch = ctx_.db().prepare(
        "SELECT o.warehouse_id FROM payments p "
        "JOIN cash_accounts a ON a.terminal_id = p.terminal_id AND a.kind = 'till' AND a.active = 1 "
        "JOIN cash_objects o ON o.id = a.object_id "
        "JOIN warehouses w ON w.id = o.warehouse_id AND w.active = 1 "
        "WHERE p.order_id = :order AND p.terminal_id != '' "
        "ORDER BY p.created_at DESC LIMIT 1");
    branch.bind(":order", orderId);
    if (branch.step() && !branch.columnText(0).empty()) return consumeForOrder(orderId, branch.columnText(0));

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
        "       i.min_qty_milli AS minQtyMilli, i.barcode, "
        "       CASE WHEN i.sku LIKE 'MENU-%' THEN COALESCE((SELECT m.price_minor FROM menu_items m "
        "         WHERE m.id = substr(i.sku, 6)), i.sale_price_minor) "
        "         ELSE i.sale_price_minor END AS salePriceMinor, "
        "       COALESCE(s.qty_milli, 0) AS qtyMilli, i.avg_cost_minor AS avgCostMinor, "
        "       (SELECT COUNT(*) FROM stock_lots l WHERE l.ingredient_id = i.id AND l.warehouse_id = :warehouse "
        "          AND l.quality = 'accepted' AND l.qty_milli > 0 AND l.blocked_at IS NULL) AS lotCount, "
        "       COALESCE((SELECT MIN(l.expires_on) FROM stock_lots l WHERE l.ingredient_id = i.id "
        "          AND l.warehouse_id = :warehouse AND l.quality = 'accepted' AND l.qty_milli > 0 "
        "          AND l.blocked_at IS NULL AND l.expires_on != ''), '') AS nextExpiry, "
        "       COALESCE(r.min_qty_milli, i.min_qty_milli) AS ruleMinQtyMilli, "
        "       COALESCE(r.target_qty_milli, 0) AS targetQtyMilli, COALESCE(r.reorder_qty_milli, 0) AS reorderQtyMilli "
        "FROM ingredients i "
        "LEFT JOIN stock_levels s ON s.ingredient_id = i.id AND s.warehouse_id = :warehouse "
        "LEFT JOIN stock_rules r ON r.ingredient_id = i.id AND r.warehouse_id = :warehouse "
        "WHERE i.active = 1 ORDER BY i.name");
    stmt.bind(":warehouse", warehouseId);
    return Json{{"warehouseId", warehouseId}, {"levels", stmt.rows()}};
}

Json InventoryService::valuation(const std::string& warehouseId, const std::string& methodAsked) {
    const std::string method = methodAsked == "average" || methodAsked == "fifo" || methodAsked == "last"
                                   ? methodAsked : costingMethod();
    // FIFO values what is on the shelves lot by lot; the other two price the
    // balance at one unit cost.
    auto stmt = ctx_.db().prepare(method == "fifo"
        ? "SELECT COALESCE(SUM(l.qty_milli * l.unit_cost_minor / 1000), 0), COUNT(DISTINCT l.ingredient_id) "
          "FROM stock_lots l JOIN ingredients i ON i.id = l.ingredient_id "
          "WHERE i.active = 1 AND l.quality = 'accepted' AND l.qty_milli > 0 AND l.blocked_at IS NULL "
          "  AND (:warehouse = '' OR l.warehouse_id = :warehouse)"
        : "SELECT COALESCE(SUM(s.qty_milli * " + unitCostSql(method) + " / 1000), 0) AS totalMinor, COUNT(*) AS lines "
          "FROM stock_levels s JOIN ingredients i ON i.id = s.ingredient_id "
          "WHERE i.active = 1 AND (:warehouse = '' OR s.warehouse_id = :warehouse)");
    stmt.bind(":warehouse", warehouseId);
    stmt.step();
    return Json{{"warehouseId", warehouseId},
                {"method", method},
                {"totalMinor", stmt.columnInt(0)},
                {"lines", stmt.columnInt(1)}};
}

}  // namespace pos::services
