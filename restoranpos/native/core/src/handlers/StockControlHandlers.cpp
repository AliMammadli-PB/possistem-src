/**
 * Stock control beyond the balance: automatic replenishment and supplier
 * prices, lots / expiry / places in the store, and the reports a restaurant
 * owner reads - what each supplier is really like and what the store lost.
 *
 * Every report takes a warehouseId (an obyekt's own store) so each branch is
 * counted on its own; "" means all stores together.
 */
#include <algorithm>
#include <map>
#include <set>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/ReplenishService.hpp"

namespace pos::handlers {
namespace {

std::string methodFrom(Context& ctx, const Json& payload) {
    const auto asked = getOr<std::string>(payload, "method", "");
    if (asked == "average" || asked == "fifo" || asked == "last") return asked;
    return services::InventoryService(ctx).costingMethod();
}

}  // namespace

void registerStockControl(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // ---------------------------------------------------------- replenishment
    server.registerHandler(std::string(protocol::method::kReplenishSuggestions), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        return Json{{"suggestions",
                     services::ReplenishService(*ctx).suggestions(getOr<std::string>(request.payload, "warehouseId", ""))}};
    });

    // Checks every short ingredient now (as each sale does for what it used).
    server.registerHandler(std::string(protocol::method::kReplenishRun), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        db::Transaction txn(ctx->db());
        services::ReplenishService replenish(*ctx);
        const auto before = replenish.suggestions(getOr<std::string>(request.payload, "warehouseId", ""));
        for (const auto& row : before)
            replenish.check(row.value("ingredientId", std::string{}), row.value("warehouseId", std::string{}));
        const auto left = replenish.suggestions(getOr<std::string>(request.payload, "warehouseId", ""));
        txn.commit();
        return Json{{"suggestions", left}, {"checked", before.size()}};
    });

    // A shortage with no known supplier: a person picks one.
    server.registerHandler(std::string(protocol::method::kReplenishCreateDraft), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        const auto qty = getOr<std::int64_t>(request.payload, "qtyMilli", 0);
        require(!ingredientId.empty() && !supplierId.empty(), "Mal və təchizatçı seçin");
        require(qty > 0, "Miqdar sıfırdan böyük olmalıdır");
        db::Transaction txn(ctx->db());
        services::ReplenishService replenish(*ctx);
        auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        if (warehouseId.empty()) warehouseId = replenish.defaultWarehouse();
        Money price = getOr<Money>(request.payload, "priceMinor", -1);
        if (price < 0) {
            auto known = ctx->db().prepare(
                "SELECT COALESCE((SELECT last_price_minor FROM supplier_items WHERE supplier_id = :s AND ingredient_id = :i), "
                "                (SELECT cost_minor FROM ingredients WHERE id = :i))");
            known.bind(":s", supplierId).bind(":i", ingredientId);
            price = known.step() ? known.columnInt(0) : 0;
        }
        const auto id = replenish.addToDraft(supplierId, warehouseId, ingredientId, qty, price);
        txn.commit();
        return Json{{"purchaseId", id}};
    });

    server.registerHandler(std::string(protocol::method::kStockRulesList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        services::ReplenishService replenish(*ctx);
        auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        if (warehouseId.empty()) warehouseId = replenish.defaultWarehouse();
        auto stmt = ctx->db().prepare(
            "SELECT i.id AS ingredientId, i.name, i.unit, COALESCE(s.qty_milli, 0) AS qtyMilli, "
            "       COALESCE(r.min_qty_milli, CASE WHEN :w = :main THEN i.min_qty_milli ELSE 0 END) AS minQtyMilli, "
            "       COALESCE(r.target_qty_milli, 0) AS targetQtyMilli, COALESCE(r.reorder_qty_milli, 0) AS reorderQtyMilli "
            "FROM ingredients i LEFT JOIN stock_rules r ON r.ingredient_id = i.id AND r.warehouse_id = :w "
            "LEFT JOIN stock_levels s ON s.ingredient_id = i.id AND s.warehouse_id = :w "
            "WHERE i.active = 1 ORDER BY i.name");
        stmt.bind(":w", warehouseId).bind(":main", replenish.defaultWarehouse());
        return Json{{"warehouseId", warehouseId}, {"rules", stmt.rows()}};
    });

    server.registerHandler(std::string(protocol::method::kStockRulesSave), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.manage");
        const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
        const auto min = getOr<std::int64_t>(request.payload, "minQtyMilli", 0);
        const auto target = getOr<std::int64_t>(request.payload, "targetQtyMilli", 0);
        const auto reorder = getOr<std::int64_t>(request.payload, "reorderQtyMilli", 0);
        require(!ingredientId.empty(), "Mal seçin");
        require(min >= 0 && target >= 0 && reorder >= 0, "Miqdarlar mənfi ola bilməz");
        require(target == 0 || target >= min, "Hədəf stok minimumdan az ola bilməz");
        db::Transaction txn(ctx->db());
        services::ReplenishService replenish(*ctx);
        auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        if (warehouseId.empty()) warehouseId = replenish.defaultWarehouse();
        auto upsert = ctx->db().prepare(
            "INSERT INTO stock_rules (ingredient_id, warehouse_id, min_qty_milli, target_qty_milli, reorder_qty_milli, updated_at) "
            "VALUES (:i, :w, :min, :target, :reorder, :now) ON CONFLICT(ingredient_id, warehouse_id) DO UPDATE SET "
            "min_qty_milli = :min, target_qty_milli = :target, reorder_qty_milli = :reorder, updated_at = :now");
        upsert.bind(":i", ingredientId).bind(":w", warehouseId).bind(":min", min).bind(":target", target)
            .bind(":reorder", reorder).bind(":now", nowMs());
        upsert.exec();
        // The main store's minimum is also the low-stock threshold everyone already reads.
        if (warehouseId == replenish.defaultWarehouse()) {
            auto legacy = ctx->db().prepare("UPDATE ingredients SET min_qty_milli = :min WHERE id = :i");
            legacy.bind(":min", min).bind(":i", ingredientId);
            legacy.exec();
        }
        replenish.check(ingredientId, warehouseId);
        ctx->audit("stock.rule", "ingredient", ingredientId, Json{{"warehouseId", warehouseId}, {"minQtyMilli", min}});
        txn.commit();
        return Json{{"ingredientId", ingredientId}, {"warehouseId", warehouseId}};
    });

    // ---------------------------------------------------------- supplier prices
    server.registerHandler(std::string(protocol::method::kSupplierItemsList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.view");
        const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        auto stmt = ctx->db().prepare(
            "SELECT si.supplier_id AS supplierId, s.name AS supplierName, si.ingredient_id AS ingredientId, "
            "       i.name AS ingredientName, i.unit, si.last_price_minor AS lastPriceMinor, si.lead_days AS leadDays, "
            "       si.min_order_milli AS minOrderMilli, si.pack_milli AS packMilli, si.supplier_sku AS supplierSku, "
            "       si.preferred, si.updated_at AS updatedAt, "
            "       (SELECT COUNT(*) FROM supplier_price_history h WHERE h.supplier_id = si.supplier_id "
            "          AND h.ingredient_id = si.ingredient_id) AS purchases, "
            "       (SELECT MIN(h.price_minor) FROM supplier_price_history h WHERE h.supplier_id = si.supplier_id "
            "          AND h.ingredient_id = si.ingredient_id) AS minPriceMinor, "
            "       (SELECT MAX(h.price_minor) FROM supplier_price_history h WHERE h.supplier_id = si.supplier_id "
            "          AND h.ingredient_id = si.ingredient_id) AS maxPriceMinor "
            "FROM supplier_items si JOIN suppliers s ON s.id = si.supplier_id AND s.active = 1 "
            "JOIN ingredients i ON i.id = si.ingredient_id AND i.active = 1 "
            "WHERE (:i = '' OR si.ingredient_id = :i) AND (:s = '' OR si.supplier_id = :s) "
            "ORDER BY i.name, si.last_price_minor");
        stmt.bind(":i", ingredientId).bind(":s", supplierId);
        Json rows = stmt.rows();
        services::ReplenishService replenish(*ctx);
        std::map<std::string, std::string> best;
        for (auto& row : rows) {
            const auto ingredient = row.value("ingredientId", std::string{});
            if (!best.count(ingredient)) {
                const auto pick = replenish.suggestSupplier(ingredient);
                best[ingredient] = pick.is_object() ? pick.value("supplierId", std::string{}) : std::string{};
            }
            row["suggested"] = best[ingredient] == row.value("supplierId", std::string{});
            auto history = ctx->db().prepare(
                "SELECT h.price_minor AS priceMinor, h.created_at AS createdAt, COALESCE(p.number, '') AS purchaseNumber "
                "FROM supplier_price_history h LEFT JOIN purchase_orders p ON p.id = h.purchase_id "
                "WHERE h.supplier_id = :s AND h.ingredient_id = :i ORDER BY h.created_at DESC LIMIT 6");
            history.bind(":s", row.value("supplierId", std::string{})).bind(":i", ingredient);
            row["history"] = history.rows();
        }
        return Json{{"items", rows}};
    });

    server.registerHandler(std::string(protocol::method::kSupplierItemsSave), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
        require(!supplierId.empty() && !ingredientId.empty(), "Təchizatçı və mal seçin");
        const auto lead = getOr<std::int64_t>(request.payload, "leadDays", 0);
        const auto minOrder = getOr<std::int64_t>(request.payload, "minOrderMilli", 0);
        const auto pack = getOr<std::int64_t>(request.payload, "packMilli", 0);
        const auto price = getOr<Money>(request.payload, "lastPriceMinor", -1);
        const bool preferred = getOr<bool>(request.payload, "preferred", false);
        require(lead >= 0 && minOrder >= 0 && pack >= 0, "Şərtlər mənfi ola bilməz");
        db::Transaction txn(ctx->db());
        const auto now = nowMs();
        auto upsert = ctx->db().prepare(
            "INSERT INTO supplier_items (supplier_id, ingredient_id, last_price_minor, lead_days, min_order_milli, pack_milli, "
            "  supplier_sku, preferred, updated_at) VALUES (:s, :i, :first, :lead, :min, :pack, :sku, :pref, :now) "
            "ON CONFLICT(supplier_id, ingredient_id) DO UPDATE SET lead_days = :lead, min_order_milli = :min, "
            "  pack_milli = :pack, supplier_sku = :sku, preferred = :pref, updated_at = :now, "
            "  last_price_minor = CASE WHEN :price >= 0 THEN :price ELSE last_price_minor END");
        upsert.bind(":s", supplierId).bind(":i", ingredientId).bind(":first", price < 0 ? Money{0} : price).bind(":price", price)
            .bind(":lead", lead).bind(":min", minOrder).bind(":pack", pack)
            .bind(":sku", getOr<std::string>(request.payload, "supplierSku", "")).bind(":pref", preferred ? 1 : 0)
            .bind(":now", now);
        upsert.exec();
        if (preferred) {
            // One preferred supplier per ingredient.
            auto others = ctx->db().prepare(
                "UPDATE supplier_items SET preferred = 0 WHERE ingredient_id = :i AND supplier_id != :s");
            others.bind(":i", ingredientId).bind(":s", supplierId);
            others.exec();
        }
        txn.commit();
        return Json{{"supplierId", supplierId}, {"ingredientId", ingredientId}};
    });

    // ---------------------------------------------------------------- places
    server.registerHandler(std::string(protocol::method::kLocationsList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        auto stmt = ctx->db().prepare(
            "SELECT l.id, l.warehouse_id AS warehouseId, w.name AS warehouseName, l.name, l.kind, l.active, "
            "       (SELECT COUNT(*) FROM stock_lots s WHERE s.location_id = l.id AND s.qty_milli > 0 "
            "          AND s.quality = 'accepted') AS lotCount "
            "FROM stock_locations l JOIN warehouses w ON w.id = l.warehouse_id "
            "WHERE (:w = '' OR l.warehouse_id = :w) ORDER BY w.sort_order, l.sort_order, l.name");
        stmt.bind(":w", getOr<std::string>(request.payload, "warehouseId", ""));
        return Json{{"locations", stmt.rows()}};
    });

    server.registerHandler(std::string(protocol::method::kLocationsSave), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.manage");
        const auto name = getOr<std::string>(request.payload, "name", "");
        const auto kind = getOr<std::string>(request.payload, "kind", "shelf");
        const bool active = getOr<bool>(request.payload, "active", true);
        auto id = getOr<std::string>(request.payload, "id", "");
        require(!name.empty(), "Yerləşmənin adını yazın");
        require(kind == "fridge" || kind == "freezer" || kind == "shelf" || kind == "zone" || kind == "dry",
                "Yerləşmə növü tanınmadı");
        db::Transaction txn(ctx->db());
        if (id.empty()) {
            auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
            if (warehouseId.empty()) warehouseId = services::ReplenishService(*ctx).defaultWarehouse();
            id = "loc-" + crypto::uuid4().substr(0, 8);
            auto insert = ctx->db().prepare(
                "INSERT INTO stock_locations (id, warehouse_id, name, kind, active, sort_order, created_at) "
                "VALUES (:id, :w, :name, :kind, 1, (SELECT COUNT(*) FROM stock_locations WHERE warehouse_id = :w), :now)");
            insert.bind(":id", id).bind(":w", warehouseId).bind(":name", name).bind(":kind", kind).bind(":now", nowMs());
            insert.exec();
        } else {
            if (!active) {
                auto used = ctx->db().prepare(
                    "SELECT COUNT(*) FROM stock_lots WHERE location_id = :id AND qty_milli > 0 AND quality != 'rejected'");
                used.bind(":id", id);
                used.step();
                require(used.columnInt(0) == 0, "Əvvəlcə bu yerdəki malları başqa yerə köçürün");
            }
            auto upd = ctx->db().prepare("UPDATE stock_locations SET name = :name, kind = :kind, active = :a WHERE id = :id");
            upd.bind(":name", name).bind(":kind", kind).bind(":a", active ? 1 : 0).bind(":id", id);
            upd.exec();
            require(ctx->db().changes() == 1, "Yerləşmə tapılmadı");
        }
        txn.commit();
        return Json{{"id", id}};
    });

    // ------------------------------------------------------------------ lots
    server.registerHandler(std::string(protocol::method::kLotsList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        const auto status = getOr<std::string>(request.payload, "status", "active");
        const auto days = getOr<std::int64_t>(request.payload, "days", 3);
        auto stmt = ctx->db().prepare(
            "SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, l.warehouse_id AS warehouseId, "
            "       w.name AS warehouseName, l.location_id AS locationId, COALESCE(sl.name, '') AS locationName, "
            "       COALESCE(sl.kind, '') AS locationKind, l.lot_no AS lotNo, l.purchase_id AS purchaseId, "
            "       COALESCE(p.number, '') AS purchaseNumber, COALESCE(s.name, '') AS supplierName, "
            "       l.produced_on AS producedOn, l.received_at AS receivedAt, l.expires_on AS expiresOn, "
            "       l.qty_received_milli AS qtyReceivedMilli, l.qty_milli AS qtyMilli, l.unit_cost_minor AS unitCostMinor, "
            "       l.qty_milli * l.unit_cost_minor / 1000 AS valueMinor, l.quality, "
            "       CASE WHEN l.expires_on = '' THEN NULL "
            "            ELSE CAST(julianday(l.expires_on) - julianday(date('now', 'localtime')) AS INTEGER) END AS daysLeft "
            "FROM stock_lots l JOIN ingredients i ON i.id = l.ingredient_id JOIN warehouses w ON w.id = l.warehouse_id "
            "LEFT JOIN stock_locations sl ON sl.id = l.location_id "
            "LEFT JOIN purchase_orders p ON p.id = l.purchase_id LEFT JOIN suppliers s ON s.id = p.supplier_id "
            "WHERE (:w = '' OR l.warehouse_id = :w) AND (:i = '' OR l.ingredient_id = :i) AND ("
            "  (:status = 'all') "
            "  OR (:status = 'active' AND l.quality = 'accepted' AND l.qty_milli > 0) "
            "  OR (:status = 'pending' AND l.quality = 'pending') "
            "  OR (:status = 'rejected' AND l.quality = 'rejected') "
            "  OR (:status = 'expired' AND l.quality = 'accepted' AND l.qty_milli > 0 AND l.expires_on != '' "
            "      AND l.expires_on < date('now', 'localtime')) "
            "  OR (:status = 'expiring' AND l.quality = 'accepted' AND l.qty_milli > 0 AND l.expires_on != '' "
            "      AND l.expires_on >= date('now', 'localtime') "
            "      AND l.expires_on <= date('now', 'localtime', '+' || :days || ' days'))) "
            "ORDER BY (l.expires_on = '') ASC, l.expires_on ASC, i.name, l.received_at LIMIT 3000");
        stmt.bind(":w", getOr<std::string>(request.payload, "warehouseId", ""))
            .bind(":i", getOr<std::string>(request.payload, "ingredientId", "")).bind(":status", status).bind(":days", days);
        return Json{{"lots", stmt.rows()}};
    });

    server.registerHandler(std::string(protocol::method::kLotsRelocate), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.transfer");
        db::Transaction txn(ctx->db());
        auto result = services::InventoryService(*ctx).relocate(getOr<std::string>(request.payload, "lotId", ""),
                                                                getOr<std::string>(request.payload, "locationId", ""),
                                                                getOr<std::int64_t>(request.payload, "qtyMilli", 0));
        ctx->audit("lot.relocate", "stock_lot", result.value("lotId", std::string{}), result);
        txn.commit();
        return result;
    });

    // Expired, spoiled or lost: out of the store from this very lot.
    server.registerHandler(std::string(protocol::method::kLotsWriteOff), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.adjust");
        const auto lotId = getOr<std::string>(request.payload, "lotId", "");
        const auto reason = getOr<std::string>(request.payload, "reason", "waste");
        const auto note = getOr<std::string>(request.payload, "note", "");
        require(reason == "expired" || reason == "waste" || reason == "lost", "Səbəb: expired, waste və ya lost");
        db::Transaction txn(ctx->db());
        auto lot = ctx->db().prepare(
            "SELECT ingredient_id, warehouse_id, qty_milli FROM stock_lots WHERE id = :id AND quality = 'accepted'");
        lot.bind(":id", lotId);
        require(lot.step(), "Partiya tapılmadı");
        auto qty = getOr<std::int64_t>(request.payload, "qtyMilli", 0);
        if (qty <= 0 || qty > lot.columnInt(2)) qty = lot.columnInt(2);
        require(qty > 0, "Partiyada mal yoxdur");
        services::LotSpec spec;
        spec.lotId = lotId;
        const std::string label = reason == "expired" ? "Vaxtı keçib" : reason == "lost" ? "İtki" : "İsraf";
        auto moved = services::InventoryService(*ctx).move(lot.columnText(0), lot.columnText(1), -qty,
                                                           reason == "lost" ? "adjustment" : "waste", "",
                                                           label + (note.empty() ? "" : ": " + note), spec);
        ctx->auditRequired("lot.writeOff", "stock_lot", lotId, Json{{"reason", reason}, {"qtyMilli", qty}});
        txn.commit();
        return moved;
    });

    server.registerHandler(std::string(protocol::method::kReportsExpiry), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        const auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        const auto days = std::max<std::int64_t>(1, getOr<std::int64_t>(request.payload, "days", 3));
        auto stmt = ctx->db().prepare(
            "SELECT COUNT(CASE WHEN expires_on < date('now', 'localtime') THEN 1 END), "
            "       COALESCE(SUM(CASE WHEN expires_on < date('now', 'localtime') THEN qty_milli * unit_cost_minor / 1000 END), 0), "
            "       COUNT(CASE WHEN expires_on >= date('now', 'localtime') "
            "                   AND expires_on <= date('now', 'localtime', '+' || :days || ' days') THEN 1 END), "
            "       COALESCE(SUM(CASE WHEN expires_on >= date('now', 'localtime') "
            "                   AND expires_on <= date('now', 'localtime', '+' || :days || ' days') "
            "                   THEN qty_milli * unit_cost_minor / 1000 END), 0), "
            "       (SELECT COUNT(*) FROM stock_lots WHERE quality = 'pending' AND (:w = '' OR warehouse_id = :w)), "
            "       (SELECT COUNT(DISTINCT lm.lot_id) FROM stock_lot_moves lm JOIN stock_lots x ON x.id = lm.lot_id "
            "          WHERE lm.kind = 'expired_use' AND (:w = '' OR x.warehouse_id = :w) "
            "          AND lm.created_at >= :since) "
            "FROM stock_lots WHERE quality = 'accepted' AND qty_milli > 0 AND expires_on != '' "
            "  AND (:w = '' OR warehouse_id = :w)");
        stmt.bind(":w", warehouseId).bind(":days", days).bind(":since", nowMs() - 30LL * 86400000);
        stmt.step();
        return Json{{"expiredLots", stmt.columnInt(0)}, {"expiredValueMinor", stmt.columnInt(1)},
                    {"expiringLots", stmt.columnInt(2)}, {"expiringValueMinor", stmt.columnInt(3)},
                    {"pendingLots", stmt.columnInt(4)}, {"expiredUsedLots30d", stmt.columnInt(5)}, {"days", days}};
    });

    // --------------------------------------------------------------- costing
    server.registerHandler(std::string(protocol::method::kInventoryCostingMethod), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        const auto method = getOr<std::string>(request.payload, "method", "");
        if (!method.empty()) {
            ctx->requirePermission("inventory.manage");
            require(method == "average" || method == "fifo" || method == "last", "Üsul: average, fifo və ya last");
            auto upsert = ctx->db().prepare(
                "INSERT INTO app_settings (key, value, value_type, updated_at) VALUES ('inventory.costingMethod', :m, "
                "'string', :now) ON CONFLICT(key) DO UPDATE SET value = :m, updated_at = :now");
            upsert.bind(":m", method).bind(":now", nowMs());
            upsert.exec();
        }
        return Json{{"method", services::InventoryService(*ctx).costingMethod()}};
    });

    // ------------------------------------------------------ supplier report
    server.registerHandler(std::string(protocol::method::kReportsSuppliers), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.view");
        const auto from = getOr<std::int64_t>(request.payload, "from", 0);
        const auto to = getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000);
        const auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        auto stmt = ctx->db().prepare(
            "SELECT s.id AS supplierId, s.name AS supplierName, COUNT(p.id) AS purchases, "
            "  COALESCE(SUM(p.total_minor), 0) AS orderedValueMinor, COALESCE(SUM(p.charged_minor), 0) AS receivedValueMinor, "
            "  COALESCE(SUM((SELECT SUM(qty_milli) FROM purchase_order_items WHERE purchase_id = p.id)), 0) AS orderedMilli, "
            "  COALESCE(SUM((SELECT SUM(received_milli) FROM purchase_order_items WHERE purchase_id = p.id)), 0) AS receivedMilli, "
            "  COALESCE(SUM((SELECT SUM(rejected_milli) FROM purchase_order_items WHERE purchase_id = p.id)), 0) AS rejectedMilli, "
            "  COUNT(CASE WHEN p.received_at IS NOT NULL AND p.expected_at IS NOT NULL THEN 1 END) AS timed, "
            "  COUNT(CASE WHEN p.received_at IS NOT NULL AND p.expected_at IS NOT NULL "
            "             AND p.received_at > p.expected_at + 86400000 THEN 1 END) AS late, "
            "  COALESCE(AVG(CASE WHEN p.received_at IS NOT NULL AND p.expected_at IS NOT NULL "
            "             THEN MAX(0, p.received_at - p.expected_at) END) / 86400000.0, 0) AS avgDelayDays, "
            "  COALESCE(AVG(CASE WHEN p.received_at IS NOT NULL THEN (p.received_at - COALESCE(p.ordered_at, p.created_at)) END) "
            "           / 86400000.0, 0) AS avgLeadDays, "
            "  COALESCE((SELECT SUM(r.total_minor) FROM purchase_returns r WHERE r.supplier_id = s.id "
            "            AND r.created_at >= :from AND r.created_at < :to AND (:w = '' OR r.warehouse_id = :w)), 0) AS returnsMinor, "
            "  COALESCE((SELECT SUM(CASE WHEN l.kind = 'charge' THEN l.amount_minor ELSE -l.amount_minor END) "
            "            FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) AS dueMinor "
            "FROM suppliers s LEFT JOIN purchase_orders p ON p.supplier_id = s.id AND p.stage NOT IN ('draft','cancelled') "
            "  AND COALESCE(p.ordered_at, p.created_at) >= :from AND COALESCE(p.ordered_at, p.created_at) < :to "
            "  AND (:w = '' OR p.warehouse_id = :w) "
            "WHERE s.active = 1 GROUP BY s.id ORDER BY receivedValueMinor DESC, s.name");
        stmt.bind(":from", from).bind(":to", to).bind(":w", warehouseId);
        Json rows = stmt.rows();
        for (auto& row : rows) {
            // Price change: first against last price paid in the period, averaged over the goods.
            auto prices = ctx->db().prepare(
                "SELECT ingredient_id, price_minor FROM supplier_price_history WHERE supplier_id = :s "
                "AND created_at >= :from AND created_at < :to ORDER BY created_at");
            prices.bind(":s", row.value("supplierId", std::string{})).bind(":from", from).bind(":to", to);
            std::map<std::string, std::pair<Money, Money>> span;
            while (prices.step()) {
                auto [it, fresh] = span.try_emplace(prices.columnText(0), prices.columnInt(1), prices.columnInt(1));
                if (!fresh) it->second.second = prices.columnInt(1);
            }
            std::int64_t sumBp = 0;
            std::int64_t counted = 0;
            for (const auto& [ingredient, firstLast] : span) {
                if (firstLast.first <= 0) continue;
                sumBp += (firstLast.second - firstLast.first) * 10000 / firstLast.first;
                counted += 1;
            }
            row["priceChangeBp"] = counted ? sumBp / counted : 0;
            const auto ordered = row.value("orderedMilli", std::int64_t{0});
            const auto received = row.value("receivedMilli", std::int64_t{0});
            const auto value = row.value("receivedValueMinor", Money{0});
            const auto timed = row.value("timed", std::int64_t{0});
            row["fillRateBp"] = ordered > 0 ? received * 10000 / ordered : 0;
            row["onTimeBp"] = timed > 0 ? (timed - row.value("late", std::int64_t{0})) * 10000 / timed : 0;
            row["returnRateBp"] = value > 0 ? row.value("returnsMinor", Money{0}) * 10000 / value : 0;
        }
        return Json{{"suppliers", rows}, {"from", from}, {"to", to}};
    });

    // --------------------------------------------------------- loss report
    server.registerHandler(std::string(protocol::method::kReportsStockLoss), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        const auto from = getOr<std::int64_t>(request.payload, "from", 0);
        const auto to = getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000);
        const auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        const auto method = methodFrom(*ctx, request.payload);
        const auto unit = services::InventoryService::unitCostSql(method, ":w");
        // What left the store without being sold: priced at the lots it came
        // from, and at the current cost where no lot was behind it.
        auto stmt = ctx->db().prepare(
            "SELECT m.id, m.kind, m.reason, -m.qty_delta_milli AS qtyMilli, m.created_at AS createdAt, "
            "       i.id AS ingredientId, i.name, i.unit, w.name AS warehouseName, "
            "       COALESCE((SELECT SUM(-lm.qty_delta_milli * l.unit_cost_minor) FROM stock_lot_moves lm "
            "                 JOIN stock_lots l ON l.id = lm.lot_id WHERE lm.movement_id = m.id), 0) AS lotValueMilli, "
            "       COALESCE((SELECT SUM(-lm.qty_delta_milli) FROM stock_lot_moves lm WHERE lm.movement_id = m.id), 0) AS lotQty, "
            "       " + unit + " AS unitCostMinor "
            "FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id JOIN warehouses w ON w.id = m.warehouse_id "
            "WHERE m.created_at >= :from AND m.created_at < :to AND m.qty_delta_milli < 0 AND (:w = '' OR m.warehouse_id = :w) "
            "  AND (m.kind IN ('waste','stocktake') OR (m.kind = 'adjustment' AND m.reference_id = '')) "
            "ORDER BY m.created_at DESC LIMIT 3000");
        stmt.bind(":from", from).bind(":to", to).bind(":w", warehouseId);
        Json rows = Json::array();
        Money expired = 0, waste = 0, lost = 0;
        while (stmt.step()) {
            Json row = stmt.row();
            const auto qty = row.value("qtyMilli", std::int64_t{0});
            const auto lotQty = std::min<std::int64_t>(qty, row.value("lotQty", std::int64_t{0}));
            const Money value = row.value("lotValueMilli", std::int64_t{0}) / 1000 +
                                (qty - lotQty) * row.value("unitCostMinor", Money{0}) / 1000;
            const auto kind = row.value("kind", std::string{});
            const auto reason = row.value("reason", std::string{});
            const std::string category = kind == "waste" ? (reason.rfind("Vaxtı keçib", 0) == 0 ? "expired" : "waste") : "lost";
            (category == "expired" ? expired : category == "waste" ? waste : lost) += value;
            row["valueMinor"] = value;
            row["category"] = category;
            rows.push_back(row);
        }

        services::ReplenishService replenish(*ctx);
        Json below = Json::array();
        Money belowValue = 0;
        for (const auto& s : replenish.suggestions(warehouseId)) {
            const auto shortBy = std::max<std::int64_t>(0, s.value("minQtyMilli", std::int64_t{0}) - s.value("qtyMilli", std::int64_t{0}));
            auto cost = ctx->db().prepare("SELECT " + unit + " FROM ingredients i WHERE i.id = :i");
            cost.bind(":i", s.value("ingredientId", std::string{})).bind(":w", s.value("warehouseId", std::string{}));
            cost.step();
            Json item = s;
            item["shortMilli"] = shortBy;
            item["valueMinor"] = shortBy * cost.columnInt(0) / 1000;
            belowValue += item.value("valueMinor", Money{0});
            below.push_back(item);
        }
        auto stale = ctx->db().prepare(
            "SELECT COALESCE(SUM(qty_milli * unit_cost_minor / 1000), 0), COUNT(*) FROM stock_lots "
            "WHERE quality = 'accepted' AND qty_milli > 0 AND expires_on != '' AND expires_on < date('now', 'localtime') "
            "AND (:w = '' OR warehouse_id = :w)");
        stale.bind(":w", warehouseId);
        stale.step();
        return Json{{"method", method}, {"expiredMinor", expired}, {"wasteMinor", waste}, {"lostMinor", lost},
                    {"totalMinor", expired + waste + lost}, {"rows", rows}, {"belowMin", below},
                    {"belowMinValueMinor", belowValue}, {"expiredOnHandMinor", stale.columnInt(0)},
                    {"expiredOnHandLots", stale.columnInt(1)}};
    });
}

}  // namespace pos::handlers
