/**
 * Alışlar: purchase orders from draft to fully received.
 *
 * An order can arrive in parts. Each delivery is a receipt: what came in good
 * goes into the store as a lot (with its number, dates and place), what waits
 * for a quality check is held as a pending lot outside the balance, what was
 * refused never enters. The supplier is owed for what was actually accepted,
 * at the price on their confirmed invoice once there is one, plus whatever
 * delivery costs they bill; every change to that figure is one ledger row for
 * the difference (purchase_orders.charged_minor keeps the running sum).
 *
 * Extra costs (delivery, transport) are spread over the lines by value or by
 * quantity into a landed unit cost, which is what lots, the weighted average
 * and recipe costing then use.
 */
#include <algorithm>
#include <cstdio>
#include <map>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/ReplenishService.hpp"

namespace pos::handlers {
namespace {

struct Item {
    std::string id;
    std::string ingredientId;
    std::int64_t qty = 0;
    std::int64_t received = 0;
    std::int64_t pending = 0;
    std::int64_t rejected = 0;
    Money price = 0;
    Money invoicePrice = -1;
    std::int64_t invoiceQty = -1;
    Money landed = 0;
};

std::vector<Item> loadItems(Context& ctx, const std::string& purchaseId) {
    auto rows = ctx.db().prepare(
        "SELECT id, ingredient_id, qty_milli, received_milli, pending_milli, rejected_milli, unit_cost_minor, "
        "       COALESCE(invoice_unit_cost_minor, -1), COALESCE(invoice_qty_milli, -1), landed_unit_cost_minor "
        "FROM purchase_order_items WHERE purchase_id = :id ORDER BY rowid");
    rows.bind(":id", purchaseId);
    std::vector<Item> items;
    while (rows.step()) {
        items.push_back({rows.columnText(0), rows.columnText(1), rows.columnInt(2), rows.columnInt(3), rows.columnInt(4),
                         rows.columnInt(5), rows.columnInt(6), rows.columnInt(7), rows.columnInt(8), rows.columnInt(9)});
    }
    return items;
}

bool invoiceConfirmed(Context& ctx, const std::string& purchaseId) {
    auto row = ctx.db().prepare("SELECT invoice_confirmed_at IS NOT NULL FROM purchase_orders WHERE id = :id");
    row.bind(":id", purchaseId);
    return row.step() && row.columnInt(0) != 0;
}

/** The price the supplier is owed per unit: their confirmed invoice, else the order. */
Money effectivePrice(const Item& item, bool confirmed) {
    return confirmed && item.invoicePrice >= 0 ? item.invoicePrice : item.price;
}

std::string warehouseFrom(Context& ctx, const Json& payload) {
    const auto given = getOr<std::string>(payload, "warehouseId", "");
    if (!given.empty()) return given;
    const auto main = services::ReplenishService(ctx).defaultWarehouse();
    require(!main.empty(), "Anbar yoxdur");
    return main;
}

bool validDate(const std::string& date) {
    return date.empty() || (date.size() == 10 && date[4] == '-' && date[7] == '-');
}

/**
 * Spreads the extra costs over the lines and stores each line's landed unit
 * cost. Returns, per line, the landed cost before and after.
 */
std::map<std::string, std::pair<Money, Money>> computeLanded(Context& ctx, const std::string& purchaseId) {
    const auto items = loadItems(ctx, purchaseId);
    const bool confirmed = invoiceConfirmed(ctx, purchaseId);
    std::int64_t qtySum = 0;
    Money valueSum = 0;
    for (const auto& item : items) {
        qtySum += item.qty;
        valueSum += item.qty * effectivePrice(item, confirmed) / 1000;
    }
    std::map<std::string, Money> extra;
    auto costs = ctx.db().prepare("SELECT amount_minor, allocation FROM purchase_costs WHERE purchase_id = :id");
    costs.bind(":id", purchaseId);
    while (costs.step()) {
        const Money amount = costs.columnInt(0);
        const bool byQty = costs.columnText(1) == "qty" || valueSum <= 0;
        for (const auto& item : items) {
            const auto share = byQty ? (qtySum > 0 ? static_cast<double>(item.qty) / static_cast<double>(qtySum) : 0.0)
                                     : static_cast<double>(item.qty) * static_cast<double>(effectivePrice(item, confirmed)) /
                                           1000.0 / static_cast<double>(valueSum);
            extra[item.id] += static_cast<Money>(static_cast<double>(amount) * share + 0.5);
        }
    }
    std::map<std::string, std::pair<Money, Money>> changes;
    for (const auto& item : items) {
        const Money landed = effectivePrice(item, confirmed) +
            (item.qty > 0 ? (extra[item.id] * 1000 + item.qty / 2) / item.qty : 0);
        changes[item.id] = {item.landed, landed};
        if (landed != item.landed) {
            auto upd = ctx.db().prepare("UPDATE purchase_order_items SET landed_unit_cost_minor = :c WHERE id = :id");
            upd.bind(":c", landed).bind(":id", item.id);
            upd.exec();
        }
    }
    return changes;
}

/** A line's landed cost changed after goods were in: its lots and the average follow. */
void revalue(Context& ctx, const std::map<std::string, std::pair<Money, Money>>& changes) {
    for (const auto& [itemId, costs] : changes) {
        const auto& [before, after] = costs;
        if (before == after) continue;
        auto item = ctx.db().prepare("SELECT ingredient_id, received_milli FROM purchase_order_items WHERE id = :id");
        item.bind(":id", itemId);
        if (!item.step() || item.columnInt(1) <= 0) continue;
        const std::string ingredient = item.columnText(0);
        auto lots = ctx.db().prepare(
            "UPDATE stock_lots SET unit_cost_minor = :c WHERE purchase_item_id = :id AND quality != 'rejected'");
        lots.bind(":c", after).bind(":id", itemId);
        lots.exec();
        auto held = ctx.db().prepare("SELECT COALESCE(SUM(qty_milli), 0) FROM stock_levels WHERE ingredient_id = :i");
        held.bind(":i", ingredient);
        held.step();
        const std::int64_t total = held.columnInt(0);
        const std::int64_t mine = std::min<std::int64_t>(item.columnInt(1), std::max<std::int64_t>(0, total));
        auto upd = ctx.db().prepare(
            "UPDATE ingredients SET cost_minor = :c, avg_cost_minor = MAX(0, avg_cost_minor + :delta), updated_at = :now "
            "WHERE id = :i");
        upd.bind(":c", after).bind(":delta", total > 0 ? (after - before) * mine / total : Money{0})
            .bind(":now", nowMs()).bind(":i", ingredient);
        upd.exec();
    }
}

void ledger(Context& ctx, const std::string& supplierId, const std::string& purchaseId, Money amount,
            const std::string& note) {
    if (amount == 0) return;
    auto row = ctx.db().prepare(
        "INSERT INTO supplier_ledger (id, supplier_id, purchase_id, amount_minor, kind, note, actor_user_id, created_at) "
        "VALUES (:id, :supplier, :purchase, :amount, 'charge', :note, :actor, :now)");
    row.bind(":id", crypto::uuid4()).bind(":supplier", supplierId).bindOptional(":purchase", purchaseId)
        .bind(":amount", amount).bind(":note", note).bindOptional(":actor", ctx.session().userId).bind(":now", nowMs());
    row.exec();
}

/** Takes a supplier return back: goods into the store, the money back on the debt. Returns its number. */
std::string undoReturn(Context& ctx, const std::string& returnId) {
    auto head = ctx.db().prepare(
        "SELECT supplier_id, COALESCE(purchase_id, ''), warehouse_id, total_minor, number "
        "FROM purchase_returns WHERE id = :id");
    head.bind(":id", returnId);
    require(head.step(), "Qaytarma tapılmadı");
    const std::string supplierId = head.columnText(0);
    const std::string purchaseId = head.columnText(1);
    const std::string warehouseId = head.columnText(2);
    const Money total = head.columnInt(3);
    const std::string number = head.columnText(4);
    services::InventoryService inventory(ctx);
    auto items = ctx.db().prepare(
        "SELECT ingredient_id, qty_milli, unit_cost_minor FROM purchase_return_items WHERE return_id = :id");
    items.bind(":id", returnId);
    struct Line {
        std::string ingredient;
        std::int64_t qty;
        Money cost;
    };
    std::vector<Line> lines;
    while (items.step()) lines.push_back({items.columnText(0), items.columnInt(1), items.columnInt(2)});
    for (const auto& line : lines) {
        services::LotSpec spec;
        spec.purchaseId = purchaseId;
        spec.unitCost = line.cost;
        spec.lotNo = number;
        inventory.move(line.ingredient, warehouseId, line.qty, "adjustment", returnId, "qaytarma ləğv edildi", spec);
    }
    ledger(ctx, supplierId, purchaseId, total, "Qaytarma ləğv " + number);
    auto drop = ctx.db().prepare("DELETE FROM purchase_return_items WHERE return_id = :id");
    drop.bind(":id", returnId);
    drop.exec();
    auto dropHead = ctx.db().prepare("DELETE FROM purchase_returns WHERE id = :id");
    dropHead.bind(":id", returnId);
    dropHead.exec();
    if (!purchaseId.empty()) refreshPurchase(ctx, purchaseId);
    return number;
}

}  // namespace

void refreshPurchase(Context& ctx, const std::string& purchaseId) {
    auto head = ctx.db().prepare(
        "SELECT supplier_id, stage, charged_minor, number, received_at FROM purchase_orders WHERE id = :id");
    head.bind(":id", purchaseId);
    if (!head.step()) return;
    const std::string supplierId = head.columnText(0);
    std::string stage = head.columnText(1);
    const Money charged = head.columnInt(2);
    const std::string number = head.columnText(3);
    const bool hadReceivedAt = !head.columnIsNull(4);

    const auto items = loadItems(ctx, purchaseId);
    const bool confirmed = invoiceConfirmed(ctx, purchaseId);
    std::int64_t receivedAny = 0;
    bool complete = !items.empty();
    Money ordered = 0;
    Money target = 0;
    for (const auto& item : items) {
        receivedAny += item.received + item.pending;
        if (item.received < item.qty) complete = false;
        ordered += item.qty * item.price / 1000;
        target += item.received * effectivePrice(item, confirmed) / 1000;
    }
    if (stage != "cancelled" && stage != "draft") {
        stage = complete ? "received" : receivedAny > 0 ? "partially_received" : "ordered";
    }
    if (stage != "cancelled" && receivedAny > 0) {
        auto costs = ctx.db().prepare(
            "SELECT COALESCE(SUM(amount_minor), 0) FROM purchase_costs WHERE purchase_id = :id AND to_supplier = 1");
        costs.bind(":id", purchaseId);
        costs.step();
        target += costs.columnInt(0);
    }
    if (stage == "cancelled") target = 0;
    if (target != charged) {
        ledger(ctx, supplierId, purchaseId, target - charged,
               (charged == 0 ? "Mal qəbulu " : "Düzəliş ") + number);
    }
    auto paid = ctx.db().prepare(
        "SELECT COALESCE((SELECT SUM(amount_minor) FROM supplier_ledger WHERE purchase_id = :id AND kind = 'payment'), 0), "
        "       COALESCE((SELECT SUM(total_minor) FROM purchase_returns WHERE purchase_id = :id), 0)");
    paid.bind(":id", purchaseId);
    paid.step();
    const Money due = std::max<Money>(0, target - paid.columnInt(0) - paid.columnInt(1));
    const std::string legacy = stage == "received" ? "received" : stage == "draft" ? "draft"
                             : stage == "cancelled" ? "cancelled" : "ordered";
    auto upd = ctx.db().prepare(
        "UPDATE purchase_orders SET stage = :stage, status = :status, charged_minor = :charged, due_minor = :due, "
        "  total_minor = :total, received_at = CASE WHEN :stage = 'received' AND received_at IS NULL THEN :now "
        "                                          ELSE received_at END WHERE id = :id");
    upd.bind(":stage", stage).bind(":status", legacy).bind(":charged", target).bind(":due", due)
        .bind(":total", ordered).bind(":now", nowMs()).bind(":id", purchaseId);
    upd.exec();
    if (stage == "received" && !hadReceivedAt) services::ReplenishService(ctx).noteLeadTime(purchaseId);
}

void registerPurchases(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // -------------------------------------------------------------- list, get
    server.registerHandler(std::string(protocol::method::kPurchasesList), [ctx](const ipc::Request&) {
        ctx->requirePermission("suppliers.view");
        auto stmt = ctx->db().prepare(
            "SELECT p.id, p.number, p.supplier_id AS supplierId, s.name AS supplierName, "
            "       p.warehouse_id AS warehouseId, w.name AS warehouseName, "
            "       COALESCE(o.id, '') AS objectId, COALESCE(o.name, '') AS objectName, "
            "       p.stage AS status, p.total_minor AS totalMinor, p.charged_minor AS chargedMinor, "
            "       p.due_minor AS dueMinor, p.note, p.created_at AS createdAt, p.received_at AS receivedAt, "
            "       p.ordered_at AS orderedAt, p.expected_at AS expectedAt, p.auto_draft AS autoDraft, "
            "       p.supplier_invoice_no AS invoiceNo, p.invoice_confirmed_at AS invoiceConfirmedAt, "
            "       COALESCE((SELECT SUM(qty_milli) FROM purchase_order_items WHERE purchase_id = p.id), 0) AS orderedMilli, "
            "       COALESCE((SELECT SUM(received_milli) FROM purchase_order_items WHERE purchase_id = p.id), 0) AS receivedMilli, "
            "       COALESCE((SELECT SUM(pending_milli) FROM purchase_order_items WHERE purchase_id = p.id), 0) AS pendingMilli "
            "FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id "
            "LEFT JOIN warehouses w ON w.id = p.warehouse_id "
            "LEFT JOIN cash_objects o ON o.warehouse_id = p.warehouse_id AND o.active = 1 "
            "ORDER BY p.created_at DESC LIMIT 5000");
        return Json{{"purchases", stmt.rows()}};
    });

    server.registerHandler(std::string(protocol::method::kPurchasesGet), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.view");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        require(!id.empty(), "purchaseId is required");
        auto head = ctx->db().prepare(
            "SELECT p.id, p.number, p.supplier_id AS supplierId, s.name AS supplierName, "
            "       p.warehouse_id AS warehouseId, w.name AS warehouseName, p.stage AS status, "
            "       p.total_minor AS totalMinor, p.charged_minor AS chargedMinor, p.due_minor AS dueMinor, p.note, "
            "       p.created_at AS createdAt, p.received_at AS receivedAt, p.ordered_at AS orderedAt, "
            "       p.expected_at AS expectedAt, p.auto_draft AS autoDraft, p.supplier_invoice_no AS invoiceNo, "
            "       p.supplier_invoice_date AS invoiceDate, p.invoice_confirmed_at AS invoiceConfirmedAt "
            "FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id "
            "LEFT JOIN warehouses w ON w.id = p.warehouse_id WHERE p.id = :id");
        head.bind(":id", id);
        if (!head.step()) throw PosError(std::string(protocol::err::kNotFound), "Alış tapılmadı");
        Json result = head.row();

        auto lines = ctx->db().prepare(
            "SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, "
            "       l.qty_milli AS qtyMilli, l.unit_cost_minor AS unitCostMinor, l.line_total_minor AS lineTotalMinor, "
            "       l.received_milli AS receivedMilli, l.pending_milli AS pendingMilli, l.rejected_milli AS rejectedMilli, "
            "       MAX(0, l.qty_milli - l.received_milli - l.pending_milli) AS remainingMilli, "
            "       l.invoice_qty_milli AS invoiceQtyMilli, l.invoice_unit_cost_minor AS invoiceUnitCostMinor, "
            "       l.landed_unit_cost_minor AS landedUnitCostMinor, "
            "       COALESCE((SELECT SUM(ri.qty_milli) FROM purchase_return_items ri "
            "                 JOIN purchase_returns r ON r.id = ri.return_id "
            "                 WHERE r.purchase_id = l.purchase_id AND ri.ingredient_id = l.ingredient_id), 0) AS returnedMilli "
            "FROM purchase_order_items l JOIN ingredients i ON i.id = l.ingredient_id "
            "WHERE l.purchase_id = :id ORDER BY l.rowid");
        lines.bind(":id", id);
        result["lines"] = lines.rows();
        auto costs = ctx->db().prepare(
            "SELECT id, kind, amount_minor AS amountMinor, to_supplier AS toSupplier, account_id AS accountId, "
            "       allocation, note, created_at AS createdAt FROM purchase_costs WHERE purchase_id = :id ORDER BY created_at");
        costs.bind(":id", id);
        result["costs"] = costs.rows();
        auto receipts = ctx->db().prepare(
            "SELECT r.id, r.number, r.note, r.created_at AS createdAt, COALESCE(u.full_name, '') AS userName "
            "FROM purchase_receipts r LEFT JOIN users u ON u.id = r.actor_user_id "
            "WHERE r.purchase_id = :id ORDER BY r.created_at");
        receipts.bind(":id", id);
        Json receiptRows = receipts.rows();
        for (auto& receipt : receiptRows) {
            auto rl = ctx->db().prepare(
                "SELECT rl.ingredient_id AS ingredientId, i.name, i.unit, rl.qty_milli AS qtyMilli, "
                "       rl.rejected_milli AS rejectedMilli, rl.quality, rl.lot_id AS lotId "
                "FROM purchase_receipt_lines rl JOIN ingredients i ON i.id = rl.ingredient_id WHERE rl.receipt_id = :id");
            rl.bind(":id", receipt.value("id", std::string{}));
            receipt["lines"] = rl.rows();
        }
        result["receipts"] = receiptRows;
        auto lots = ctx->db().prepare(
            "SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, l.lot_no AS lotNo, l.quality, "
            "       l.qty_received_milli AS qtyReceivedMilli, l.qty_milli AS qtyMilli, l.expires_on AS expiresOn, "
            "       l.produced_on AS producedOn, COALESCE(sl.name, '') AS locationName "
            "FROM stock_lots l JOIN ingredients i ON i.id = l.ingredient_id "
            "LEFT JOIN stock_locations sl ON sl.id = l.location_id WHERE l.purchase_id = :id ORDER BY l.created_at");
        lots.bind(":id", id);
        result["lots"] = lots.rows();
        return result;
    });

    // ------------------------------------------------------------ save, confirm
    server.registerHandler(std::string(protocol::method::kPurchasesSave), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        require(!supplierId.empty(), "supplierId is required");
        require(request.payload.contains("lines") && request.payload["lines"].is_array(), "lines is required");
        auto id = getOr<std::string>(request.payload, "id", "");
        const auto warehouseId = warehouseFrom(*ctx, request.payload);
        const auto note = getOr<std::string>(request.payload, "note", "");
        const bool draft = getOr<bool>(request.payload, "draft", false);
        const auto now = nowMs();

        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        const auto key = getOr<std::string>(request.payload, "idempotencyKey", request.idempotencyKey);
        if (auto replay = idem.begin(key, "purchases.save", request.payload)) return *replay;
        services::ReplenishService replenish(*ctx);
        if (!id.empty()) {
            auto state = ctx->db().prepare(
                "SELECT stage, COALESCE((SELECT SUM(received_milli + pending_milli + rejected_milli) "
                "  FROM purchase_order_items WHERE purchase_id = :id), 0) FROM purchase_orders WHERE id = :id");
            state.bind(":id", id);
            require(state.step(), "Alış tapılmadı");
            require(state.columnText(0) != "cancelled", "Silinmiş qaimə dəyişdirilə bilməz");
            // Once goods came in, corrections go through purchases.update so stock follows.
            require(state.columnInt(1) == 0, "Mal qəbulu başlayıb — qaiməyə \"Düzəliş et\" ilə dəyişiklik edin");
            auto clear = ctx->db().prepare("DELETE FROM purchase_order_items WHERE purchase_id = :id");
            clear.bind(":id", id);
            clear.exec();
        } else {
            id = "po-" + crypto::uuid4().substr(0, 8);
            auto insert = ctx->db().prepare(
                "INSERT INTO purchase_orders (id, number, supplier_id, warehouse_id, note, actor_user_id, created_at) "
                "VALUES (:id, :number, :supplier, :warehouse, :note, :actor, :now)");
            insert.bind(":id", id).bind(":number", replenish.nextPurchaseNumber()).bind(":supplier", supplierId)
                .bind(":warehouse", warehouseId).bind(":note", note).bindOptional(":actor", ctx->session().userId)
                .bind(":now", now);
            insert.exec();
        }

        std::int64_t lead = 0;
        for (const auto& line : request.payload["lines"]) {
            if (!line.is_object()) continue;
            const auto ingredientId = getOr<std::string>(line, "ingredientId", "");
            const auto qty = getOr<std::int64_t>(line, "qtyMilli", 0);
            const auto unitCost = getOr<Money>(line, "unitCostMinor", 0);
            if (ingredientId.empty() || qty <= 0) continue;
            require(unitCost >= 0, "Qiymət mənfi ola bilməz");
            auto insert = ctx->db().prepare(
                "INSERT INTO purchase_order_items (id, purchase_id, ingredient_id, qty_milli, unit_cost_minor, "
                "  line_total_minor, landed_unit_cost_minor) VALUES (:id, :purchase, :ingredient, :qty, :cost, :total, :cost)");
            insert.bind(":id", crypto::uuid4()).bind(":purchase", id).bind(":ingredient", ingredientId)
                .bind(":qty", qty).bind(":cost", unitCost).bind(":total", qty * unitCost / 1000);
            insert.exec();
            auto terms = ctx->db().prepare("SELECT lead_days FROM supplier_items WHERE supplier_id = :s AND ingredient_id = :i");
            terms.bind(":s", supplierId).bind(":i", ingredientId);
            if (terms.step()) lead = std::max<std::int64_t>(lead, terms.columnInt(0));
        }
        const auto expected = getOr<std::int64_t>(request.payload, "expectedAt", 0);
        auto head = ctx->db().prepare(
            "UPDATE purchase_orders SET supplier_id = :supplier, warehouse_id = :warehouse, note = :note, "
            "  stage = :stage, status = :stage, auto_draft = CASE WHEN :stage = 'draft' THEN auto_draft ELSE 0 END, "
            "  ordered_at = CASE WHEN :stage = 'ordered' THEN :now ELSE ordered_at END, "
            "  expected_at = CASE WHEN :stage = 'ordered' THEN :expected ELSE expected_at END WHERE id = :id");
        head.bind(":supplier", supplierId).bind(":warehouse", warehouseId).bind(":note", note)
            .bind(":stage", std::string(draft ? "draft" : "ordered")).bind(":now", now)
            .bind(":expected", expected > 0 ? expected : now + lead * 86400000).bind(":id", id);
        head.exec();
        computeLanded(*ctx, id);
        refreshPurchase(*ctx, id);

        auto total = ctx->db().prepare("SELECT total_minor, stage FROM purchase_orders WHERE id = :id");
        total.bind(":id", id);
        total.step();
        ctx->audit("purchase.save", "purchase", id, Json{{"totalMinor", total.columnInt(0)}});
        Json response{{"id", id}, {"totalMinor", total.columnInt(0)}, {"status", total.columnText(1)}};
        idem.complete(key, response, "purchase", id);
        txn.commit();
        return response;
    });

    // A draft (often one the system suggested) becomes a real order only here.
    server.registerHandler(std::string(protocol::method::kPurchasesConfirm), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        db::Transaction txn(ctx->db());
        auto head = ctx->db().prepare("SELECT stage, supplier_id FROM purchase_orders WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "Alış tapılmadı");
        require(head.columnText(0) == "draft", "Yalnız qaralama təsdiqlənir");
        auto lines = ctx->db().prepare("SELECT COUNT(*) FROM purchase_order_items WHERE purchase_id = :id");
        lines.bind(":id", id);
        lines.step();
        require(lines.columnInt(0) > 0, "Qaralamada mal yoxdur");
        auto lead = ctx->db().prepare(
            "SELECT COALESCE(MAX(si.lead_days), 0) FROM purchase_order_items l JOIN supplier_items si "
            "ON si.ingredient_id = l.ingredient_id AND si.supplier_id = :s WHERE l.purchase_id = :id");
        lead.bind(":s", head.columnText(1)).bind(":id", id);
        lead.step();
        const auto now = nowMs();
        auto upd = ctx->db().prepare(
            "UPDATE purchase_orders SET stage = 'ordered', status = 'ordered', ordered_at = :now, "
            "  expected_at = :expected WHERE id = :id");
        upd.bind(":now", now).bind(":expected", now + lead.columnInt(0) * 86400000).bind(":id", id);
        upd.exec();
        ctx->audit("purchase.confirm", "purchase", id, Json::object());
        txn.commit();
        return Json{{"id", id}, {"status", "ordered"}};
    });

    // ----------------------------------------------------------------- receive
    server.registerHandler(std::string(protocol::method::kPurchasesReceive), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.receive");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        require(!id.empty(), "purchaseId is required");
        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        const auto key = getOr<std::string>(request.payload, "idempotencyKey", request.idempotencyKey);
        if (auto replay = idem.begin(key, "purchases.receive", request.payload)) return *replay;

        auto head = ctx->db().prepare(
            "SELECT supplier_id, warehouse_id, stage, number FROM purchase_orders WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "Alış tapılmadı");
        const std::string supplierId = head.columnText(0);
        const std::string warehouseId = head.columnText(1);
        const std::string stage = head.columnText(2);
        const std::string number = head.columnText(3);
        require(stage != "draft", "Qaralama əvvəlcə təsdiqlənməlidir");
        require(stage != "cancelled", "Silinmiş qaimə qəbul edilmir");
        require(stage != "received", "Bu alış artıq tam qəbul edilib");

        auto items = loadItems(*ctx, id);
        require(!items.empty(), "Alışda sətir yoxdur");
        std::map<std::string, Item*> byId;
        for (auto& item : items) byId[item.id] = &item;

        struct Take {
            Item* item;
            std::int64_t qty;
            std::int64_t rejected;
            std::string quality;
            services::LotSpec lot;
        };
        std::vector<Take> takes;
        if (request.payload.contains("lines") && request.payload["lines"].is_array()) {
            for (const auto& raw : request.payload["lines"]) {
                if (!raw.is_object()) continue;
                auto found = byId.find(getOr<std::string>(raw, "itemId", ""));
                require(found != byId.end(), "Qaimədə belə sətir yoxdur");
                Take take{found->second, getOr<std::int64_t>(raw, "qtyMilli", 0),
                          getOr<std::int64_t>(raw, "rejectedMilli", 0), getOr<std::string>(raw, "quality", "accepted"), {}};
                require(take.quality == "accepted" || take.quality == "pending" || take.quality == "rejected",
                        "Keyfiyyət vəziyyəti tanınmadı");
                require(take.qty >= 0 && take.rejected >= 0, "Miqdar mənfi ola bilməz");
                if (take.quality == "rejected") {
                    take.rejected += take.qty;
                    take.qty = 0;
                }
                take.lot.lotNo = getOr<std::string>(raw, "lotNo", "");
                take.lot.producedOn = getOr<std::string>(raw, "producedOn", "");
                take.lot.expiresOn = getOr<std::string>(raw, "expiresOn", "");
                take.lot.locationId = getOr<std::string>(raw, "locationId", "");
                require(validDate(take.lot.producedOn) && validDate(take.lot.expiresOn), "Tarix İİİİ-AA-GG olmalıdır");
                if (!take.lot.locationId.empty()) {
                    auto place = ctx->db().prepare("SELECT 1 FROM stock_locations WHERE id = :id AND warehouse_id = :w");
                    place.bind(":id", take.lot.locationId).bind(":w", warehouseId);
                    require(place.step(), "Yerləşmə bu anbara aid deyil");
                }
                if (take.qty > 0 || take.rejected > 0) takes.push_back(take);
            }
        } else {
            // One button: everything still outstanding arrives as ordered.
            for (auto& item : items) {
                const auto left = item.qty - item.received - item.pending;
                if (left > 0) takes.push_back({&item, left, 0, "accepted", {}});
            }
        }
        require(!takes.empty(), "Qəbul ediləcək miqdar yazın");
        std::map<std::string, std::int64_t> taking;
        for (const auto& take : takes) taking[take.item->id] += take.qty;
        for (const auto& [itemId, qty] : taking) {
            const Item& item = *byId[itemId];
            require(qty <= item.qty - item.received - item.pending,
                    "Sifariş ediləndən çox qəbul etmək olmaz (qalan " + std::to_string(item.qty - item.received - item.pending) + ")");
        }

        const auto now = nowMs();
        auto seq = ctx->db().prepare("SELECT COUNT(*) + 1 FROM purchase_receipts WHERE purchase_id = :id");
        seq.bind(":id", id);
        seq.step();
        const std::string receiptId = "rc-" + crypto::uuid4().substr(0, 10);
        const std::string receiptNo = number + "/" + std::to_string(seq.columnInt(0));
        auto receipt = ctx->db().prepare(
            "INSERT INTO purchase_receipts (id, purchase_id, number, warehouse_id, note, actor_user_id, created_at) "
            "VALUES (:id, :purchase, :number, :warehouse, :note, :actor, :now)");
        receipt.bind(":id", receiptId).bind(":purchase", id).bind(":number", receiptNo).bind(":warehouse", warehouseId)
            .bind(":note", getOr<std::string>(request.payload, "note", "")).bindOptional(":actor", ctx->session().userId)
            .bind(":now", now);
        receipt.exec();

        services::InventoryService inventory(*ctx);
        services::ReplenishService replenish(*ctx);
        const bool confirmed = invoiceConfirmed(*ctx, id);
        for (auto& take : takes) {
            Item& item = *take.item;
            std::string lotId;
            if (take.qty > 0) {
                services::LotSpec spec = take.lot;
                if (spec.lotNo.empty()) spec.lotNo = number;
                spec.purchaseId = id;
                spec.purchaseItemId = item.id;
                spec.unitCost = item.landed;
                if (take.quality == "pending") {
                    // Quarantine: held aside, not in the balance, not owed yet.
                    lotId = "lot-" + crypto::uuid4().substr(0, 12);
                    auto hold = ctx->db().prepare(
                        "INSERT INTO stock_lots (id, ingredient_id, warehouse_id, location_id, lot_no, purchase_id, "
                        "  purchase_item_id, produced_on, received_at, expires_on, qty_received_milli, qty_milli, "
                        "  unit_cost_minor, quality, created_at) VALUES (:id, :i, :w, :loc, :no, :p, :item, :prod, :now, "
                        "  :exp, :qty, :qty, :cost, 'pending', :now)");
                    hold.bind(":id", lotId).bind(":i", item.ingredientId).bind(":w", warehouseId).bind(":loc", spec.locationId)
                        .bind(":no", spec.lotNo).bind(":p", id).bind(":item", item.id).bind(":prod", spec.producedOn)
                        .bind(":now", now).bind(":exp", spec.expiresOn).bind(":qty", take.qty).bind(":cost", item.landed);
                    hold.exec();
                    item.pending += take.qty;
                } else {
                    auto moved = inventory.move(item.ingredientId, warehouseId, take.qty, "receipt", id, "mal qəbulu " + receiptNo, spec);
                    if (!moved["lots"].empty()) lotId = moved["lots"][0].value("lotId", std::string{});
                    inventory.recordReceiptCost(item.ingredientId, take.qty, item.landed);
                    replenish.notePrice(supplierId, item.ingredientId, effectivePrice(item, confirmed), id);
                    item.received += take.qty;
                }
            }
            item.rejected += take.rejected;
            auto upd = ctx->db().prepare(
                "UPDATE purchase_order_items SET received_milli = :r, pending_milli = :p, rejected_milli = :x WHERE id = :id");
            upd.bind(":r", item.received).bind(":p", item.pending).bind(":x", item.rejected).bind(":id", item.id);
            upd.exec();
            auto line = ctx->db().prepare(
                "INSERT INTO purchase_receipt_lines (id, receipt_id, item_id, ingredient_id, qty_milli, rejected_milli, "
                "  quality, lot_id) VALUES (:id, :receipt, :item, :ingredient, :qty, :rejected, :quality, :lot)");
            line.bind(":id", crypto::uuid4()).bind(":receipt", receiptId).bind(":item", item.id)
                .bind(":ingredient", item.ingredientId).bind(":qty", take.qty).bind(":rejected", take.rejected)
                .bind(":quality", take.qty > 0 ? take.quality : std::string("rejected")).bind(":lot", lotId);
            line.exec();
        }
        refreshPurchase(*ctx, id);

        auto after = ctx->db().prepare("SELECT stage, charged_minor FROM purchase_orders WHERE id = :id");
        after.bind(":id", id);
        after.step();
        ctx->auditRequired("purchase.receive", "purchase", id,
                           Json{{"receipt", receiptNo}, {"lines", static_cast<std::int64_t>(takes.size())}});
        Json response{{"purchaseId", id}, {"receiptId", receiptId}, {"receiptNumber", receiptNo},
                      {"status", after.columnText(0)}, {"chargedMinor", after.columnInt(1)}};
        idem.complete(key, response, "purchase", id);
        txn.commit();
        return response;
    });

    // Quality check of goods held in quarantine.
    server.registerHandler(std::string(protocol::method::kPurchasesInspect), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.receive");
        const auto lotId = getOr<std::string>(request.payload, "lotId", "");
        const auto decision = getOr<std::string>(request.payload, "decision", "");
        require(decision == "accept" || decision == "reject", "Qərar: accept və ya reject");
        db::Transaction txn(ctx->db());
        auto lot = ctx->db().prepare(
            "SELECT ingredient_id, warehouse_id, qty_milli, purchase_id, purchase_item_id, unit_cost_minor "
            "FROM stock_lots WHERE id = :id AND quality = 'pending'");
        lot.bind(":id", lotId);
        require(lot.step(), "Yoxlama gözləyən partiya tapılmadı");
        const std::string ingredient = lot.columnText(0);
        const std::string warehouse = lot.columnText(1);
        const std::int64_t qty = lot.columnInt(2);
        const std::string purchaseId = lot.columnText(3);
        const std::string itemId = lot.columnText(4);
        const Money cost = lot.columnInt(5);
        if (decision == "accept") {
            services::LotSpec spec;
            spec.lotId = lotId;
            services::InventoryService inventory(*ctx);
            inventory.move(ingredient, warehouse, qty, "receipt", purchaseId, "keyfiyyət yoxlaması: qəbul", spec);
            inventory.recordReceiptCost(ingredient, qty, cost);
            auto upd = ctx->db().prepare(
                "UPDATE purchase_order_items SET pending_milli = MAX(0, pending_milli - :q), received_milli = received_milli + :q "
                "WHERE id = :id");
            upd.bind(":q", qty).bind(":id", itemId);
            upd.exec();
            auto supplier = ctx->db().prepare("SELECT supplier_id FROM purchase_orders WHERE id = :id");
            supplier.bind(":id", purchaseId);
            if (supplier.step()) {
                auto items = loadItems(*ctx, purchaseId);
                for (const auto& item : items)
                    if (item.id == itemId)
                        services::ReplenishService(*ctx).notePrice(supplier.columnText(0), ingredient,
                                                                   effectivePrice(item, invoiceConfirmed(*ctx, purchaseId)), purchaseId);
            }
        } else {
            auto rej = ctx->db().prepare("UPDATE stock_lots SET quality = 'rejected' WHERE id = :id");
            rej.bind(":id", lotId);
            rej.exec();
            auto upd = ctx->db().prepare(
                "UPDATE purchase_order_items SET pending_milli = MAX(0, pending_milli - :q), rejected_milli = rejected_milli + :q "
                "WHERE id = :id");
            upd.bind(":q", qty).bind(":id", itemId);
            upd.exec();
        }
        refreshPurchase(*ctx, purchaseId);
        ctx->auditRequired("purchase.inspect", "stock_lot", lotId, Json{{"decision", decision}, {"qtyMilli", qty}});
        txn.commit();
        return Json{{"lotId", lotId}, {"decision", decision}};
    });

    // Matching the supplier's invoice against what was ordered and received.
    server.registerHandler(std::string(protocol::method::kPurchasesInvoice), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        db::Transaction txn(ctx->db());
        auto head = ctx->db().prepare("SELECT stage, supplier_id FROM purchase_orders WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "Alış tapılmadı");
        require(head.columnText(0) != "cancelled", "Silinmiş qaimə");
        const std::string supplierId = head.columnText(1);
        const auto invoiceDate = getOr<std::string>(request.payload, "invoiceDate", "");
        require(validDate(invoiceDate), "Tarix İİİİ-AA-GG olmalıdır");
        const bool confirm = getOr<bool>(request.payload, "confirm", false);
        auto upd = ctx->db().prepare(
            "UPDATE purchase_orders SET supplier_invoice_no = :no, supplier_invoice_date = :date, "
            "  invoice_confirmed_at = CASE WHEN :confirm = 1 THEN :now ELSE NULL END WHERE id = :id");
        upd.bind(":no", getOr<std::string>(request.payload, "invoiceNo", "")).bind(":date", invoiceDate)
            .bind(":confirm", confirm ? 1 : 0).bind(":now", nowMs()).bind(":id", id);
        upd.exec();
        if (request.payload.contains("lines") && request.payload["lines"].is_array()) {
            for (const auto& raw : request.payload["lines"]) {
                if (!raw.is_object()) continue;
                const auto qty = getOr<std::int64_t>(raw, "invoiceQtyMilli", -1);
                const auto price = getOr<Money>(raw, "invoiceUnitCostMinor", -1);
                auto line = ctx->db().prepare(
                    "UPDATE purchase_order_items SET invoice_qty_milli = :q, invoice_unit_cost_minor = :p "
                    "WHERE id = :id AND purchase_id = :purchase");
                if (qty >= 0) line.bind(":q", qty); else line.bind(":q", nullptr);
                if (price >= 0) line.bind(":p", price); else line.bind(":p", nullptr);
                line.bind(":id", getOr<std::string>(raw, "itemId", "")).bind(":purchase", id);
                line.exec();
            }
        }
        revalue(*ctx, computeLanded(*ctx, id));
        if (confirm) {
            for (const auto& item : loadItems(*ctx, id))
                if (item.received > 0)
                    services::ReplenishService(*ctx).notePrice(supplierId, item.ingredientId, effectivePrice(item, true), id);
        }
        refreshPurchase(*ctx, id);
        ctx->auditRequired("purchase.invoice", "purchase", id, Json{{"confirm", confirm}});
        txn.commit();
        return Json{{"id", id}};
    });

    // ------------------------------------------------------------- extra costs
    server.registerHandler(std::string(protocol::method::kPurchasesAddCost), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
        const auto kind = getOr<std::string>(request.payload, "kind", "delivery");
        const auto allocation = getOr<std::string>(request.payload, "allocation", "value");
        const bool toSupplier = getOr<bool>(request.payload, "toSupplier", true);
        const auto accountId = toSupplier ? std::string{} : getOr<std::string>(request.payload, "accountId", "");
        const auto note = getOr<std::string>(request.payload, "note", "");
        require(amount > 0, "Məbləğ sıfırdan böyük olmalıdır");
        require(kind == "delivery" || kind == "transport" || kind == "customs" || kind == "other", "Xərc növü tanınmadı");
        require(allocation == "value" || allocation == "qty", "Bölüşdürmə: value və ya qty");
        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        if (auto replay = idem.begin(request.idempotencyKey, "purchases.addCost", request.payload)) return *replay;
        auto head = ctx->db().prepare("SELECT stage, number FROM purchase_orders WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "Alış tapılmadı");
        require(head.columnText(0) != "cancelled", "Silinmiş qaimə");
        const std::string costId = "pc-" + crypto::uuid4().substr(0, 10);
        auto insert = ctx->db().prepare(
            "INSERT INTO purchase_costs (id, purchase_id, kind, amount_minor, to_supplier, account_id, allocation, note, created_at) "
            "VALUES (:id, :p, :kind, :amount, :to, :account, :alloc, :note, :now)");
        insert.bind(":id", costId).bind(":p", id).bind(":kind", kind).bind(":amount", amount).bind(":to", toSupplier ? 1 : 0)
            .bind(":account", accountId).bind(":alloc", allocation).bind(":note", note).bind(":now", nowMs());
        insert.exec();
        // Paid to someone else from a kassa: the money leaves it now.
        services::CashService(*ctx).accountMove(accountId, -amount, "purchase_cost", "purchase_cost", costId,
                                                "Alış xərci " + head.columnText(1) + (note.empty() ? "" : " · " + note));
        revalue(*ctx, computeLanded(*ctx, id));
        refreshPurchase(*ctx, id);
        ctx->auditRequired("purchase.cost", "purchase", id, Json{{"amountMinor", amount}, {"kind", kind}});
        Json response{{"id", costId}};
        idem.complete(request.idempotencyKey, response, "purchase", id);
        txn.commit();
        return response;
    });

    server.registerHandler(std::string(protocol::method::kPurchasesRemoveCost), [ctx](const ipc::Request& request) {
        ctx->requirePermission("purchases.edit");
        const auto costId = getOr<std::string>(request.payload, "costId", "");
        db::Transaction txn(ctx->db());
        auto cost = ctx->db().prepare("SELECT purchase_id, amount_minor, account_id FROM purchase_costs WHERE id = :id");
        cost.bind(":id", costId);
        require(cost.step(), "Xərc tapılmadı");
        const std::string purchaseId = cost.columnText(0);
        services::CashService(*ctx).accountMove(cost.columnText(2), cost.columnInt(1), "purchase_cost", "purchase_cost",
                                                costId, "Alış xərci ləğv edildi");
        auto drop = ctx->db().prepare("DELETE FROM purchase_costs WHERE id = :id");
        drop.bind(":id", costId);
        drop.exec();
        revalue(*ctx, computeLanded(*ctx, purchaseId));
        refreshPurchase(*ctx, purchaseId);
        ctx->auditRequired("purchase.cost.remove", "purchase", purchaseId, Json{{"costId", costId}});
        txn.commit();
        return Json{{"id", costId}};
    });

    // ------------------------------------------------------ invoice correction
    // Quantity, price, goods, supplier or branch wrong after the fact. A line
    // that had arrived in full keeps arriving in full at its new quantity;
    // one still partly outstanding keeps what came. Stock, lots, the average
    // and the supplier's debt all follow.
    server.registerHandler(std::string(protocol::method::kPurchasesUpdate), [ctx](const ipc::Request& request) {
        ctx->requirePermission("purchases.edit");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        const auto note = getOr<std::string>(request.payload, "note", "");
        require(!id.empty() && !supplierId.empty(), "Qaimə və təchizatçı tələb olunur");
        require(request.payload.contains("lines") && request.payload["lines"].is_array(), "lines is required");

        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        const auto key = getOr<std::string>(request.payload, "idempotencyKey", request.idempotencyKey);
        if (auto replay = idem.begin(key, "purchases.update", request.payload)) return *replay;

        auto head = ctx->db().prepare(
            "SELECT supplier_id, warehouse_id, stage, charged_minor, number FROM purchase_orders WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "Alış qaiməsi tapılmadı");
        const std::string oldSupplier = head.columnText(0);
        const std::string oldWarehouse = head.columnText(1);
        const std::string stage = head.columnText(2);
        const Money charged = head.columnInt(3);
        const std::string number = head.columnText(4);
        require(stage != "cancelled", "Silinmiş qaiməyə düzəliş olunmur");
        const std::string warehouseId = warehouseFrom(*ctx, request.payload);
        auto supplier = ctx->db().prepare("SELECT 1 FROM suppliers WHERE id = :id");
        supplier.bind(":id", supplierId);
        require(supplier.step(), "Təchizatçı tapılmadı");

        struct Want {
            std::int64_t qty = 0;
            Money price = 0;
        };
        std::map<std::string, Want> want;
        for (const auto& raw : request.payload["lines"]) {
            if (!raw.is_object()) continue;
            const auto ingredient = getOr<std::string>(raw, "ingredientId", "");
            const auto qty = getOr<std::int64_t>(raw, "qtyMilli", 0);
            const auto price = getOr<Money>(raw, "unitCostMinor", 0);
            if (ingredient.empty() || qty <= 0) continue;
            require(price >= 0, "Qiymət mənfi ola bilməz");
            want[ingredient].qty += qty;
            want[ingredient].price = price;
        }
        require(!want.empty(), "Qaimədə ən azı bir mal olmalıdır");

        auto items = loadItems(*ctx, id);
        for (const auto& item : items) require(item.pending == 0, "Əvvəlcə keyfiyyət yoxlamasını bitirin");
        std::map<std::string, std::int64_t> returned;
        {
            auto back = ctx->db().prepare(
                "SELECT ri.ingredient_id, SUM(ri.qty_milli) FROM purchase_return_items ri "
                "JOIN purchase_returns r ON r.id = ri.return_id WHERE r.purchase_id = :id GROUP BY ri.ingredient_id");
            back.bind(":id", id);
            while (back.step()) returned[back.columnText(0)] = back.columnInt(1);
            require(returned.empty() || warehouseId == oldWarehouse, "Qaytarması olan qaimənin obyektini dəyişmək olmaz");
        }
        const bool wasComplete = stage == "received";

        // Old lines, one per ingredient (duplicates folded into the first).
        std::map<std::string, Item> old;
        for (const auto& item : items) {
            auto found = old.find(item.ingredientId);
            if (found == old.end()) {
                old[item.ingredientId] = item;
                continue;
            }
            found->second.qty += item.qty;
            found->second.received += item.received;
            found->second.rejected += item.rejected;
            auto move = ctx->db().prepare("UPDATE stock_lots SET purchase_item_id = :keep WHERE purchase_item_id = :gone");
            move.bind(":keep", found->second.id).bind(":gone", item.id);
            move.exec();
            auto drop = ctx->db().prepare("DELETE FROM purchase_order_items WHERE id = :id");
            drop.bind(":id", item.id);
            drop.exec();
        }

        struct Shift {
            std::string ingredient;
            std::string itemId;
            std::int64_t before;
            std::int64_t after;
        };
        std::vector<Shift> shifts;
        for (const auto& [ingredient, o] : old) {
            if (want.count(ingredient)) continue;
            require(returned[ingredient] == 0, "Qaytarılmış malı qaimədən silmək olmaz");
            shifts.push_back({ingredient, o.id, o.received, 0});
            auto drop = ctx->db().prepare("DELETE FROM purchase_order_items WHERE id = :id");
            drop.bind(":id", o.id);
            drop.exec();
        }
        for (const auto& [ingredient, w] : want) {
            auto found = old.find(ingredient);
            const bool fully = found != old.end() && found->second.qty > 0 && found->second.received >= found->second.qty;
            const std::int64_t received = found == old.end() ? (wasComplete ? w.qty : 0)
                                        : fully ? w.qty : std::min(found->second.received, w.qty);
            require(received >= returned[ingredient], "Qaytarılmış miqdardan az yazmaq olmaz");
            std::string itemId;
            if (found != old.end()) {
                itemId = found->second.id;
                auto upd = ctx->db().prepare(
                    "UPDATE purchase_order_items SET qty_milli = :q, unit_cost_minor = :p, line_total_minor = :t, "
                    "  received_milli = :r WHERE id = :id");
                upd.bind(":q", w.qty).bind(":p", w.price).bind(":t", w.qty * w.price / 1000).bind(":r", received).bind(":id", itemId);
                upd.exec();
            } else {
                itemId = crypto::uuid4();
                auto insert = ctx->db().prepare(
                    "INSERT INTO purchase_order_items (id, purchase_id, ingredient_id, qty_milli, unit_cost_minor, "
                    "  line_total_minor, landed_unit_cost_minor, received_milli) "
                    "VALUES (:id, :p, :i, :q, :c, :t, :c, :r)");
                insert.bind(":id", itemId).bind(":p", id).bind(":i", ingredient).bind(":q", w.qty).bind(":c", w.price)
                    .bind(":t", w.qty * w.price / 1000).bind(":r", received);
                insert.exec();
            }
            shifts.push_back({ingredient, itemId, found == old.end() ? 0 : found->second.received, received});
        }

        auto headUpd = ctx->db().prepare("UPDATE purchase_orders SET warehouse_id = :w, note = :n WHERE id = :id");
        headUpd.bind(":w", warehouseId).bind(":n", note).bind(":id", id);
        headUpd.exec();
        auto landed = computeLanded(*ctx, id);

        services::InventoryService inventory(*ctx);
        services::ReplenishService replenish(*ctx);
        const bool confirmed = invoiceConfirmed(*ctx, id);
        for (const auto& shift : shifts) {
            const Money cost = landed.count(shift.itemId) ? landed[shift.itemId].second : 0;
            services::LotSpec in;
            in.purchaseId = id;
            in.purchaseItemId = shift.itemId;
            in.unitCost = cost;
            in.lotNo = number;
            services::LotSpec out;
            out.preferPurchaseId = id;
            if (warehouseId != oldWarehouse) {
                if (shift.before > 0) inventory.move(shift.ingredient, oldWarehouse, -shift.before, "adjustment", id, "qaimə düzəlişi", out);
                if (shift.after > 0) inventory.move(shift.ingredient, warehouseId, shift.after, "receipt", id, "qaimə düzəlişi", in);
            } else if (shift.after > shift.before) {
                inventory.move(shift.ingredient, warehouseId, shift.after - shift.before, "receipt", id, "qaimə düzəlişi", in);
            } else if (shift.after < shift.before) {
                inventory.move(shift.ingredient, warehouseId, shift.after - shift.before, "adjustment", id, "qaimə düzəlişi", out);
            }
            if (shift.after > shift.before) inventory.recordReceiptCost(shift.ingredient, shift.after - shift.before, cost);
            for (const auto& item : loadItems(*ctx, id))
                if (item.id == shift.itemId && item.received > 0)
                    replenish.notePrice(supplierId, shift.ingredient, effectivePrice(item, confirmed), id);
        }
        revalue(*ctx, landed);

        // The debt moves with the invoice: off the old supplier, onto the new one.
        if (supplierId != oldSupplier) {
            ledger(*ctx, oldSupplier, id, -charged, "Düzəliş " + number + " (başqa təchizatçıya keçdi)");
            auto move = ctx->db().prepare("UPDATE purchase_orders SET supplier_id = :s, charged_minor = 0 WHERE id = :id");
            move.bind(":s", supplierId).bind(":id", id);
            move.exec();
        }
        refreshPurchase(*ctx, id);

        auto after = ctx->db().prepare("SELECT total_minor, charged_minor FROM purchase_orders WHERE id = :id");
        after.bind(":id", id);
        after.step();
        ctx->auditRequired("purchase.update", "purchase", id,
                           Json{{"oldChargedMinor", charged}, {"chargedMinor", after.columnInt(1)}, {"supplierId", supplierId}});
        Json response{{"id", id}, {"totalMinor", after.columnInt(0)}, {"chargedMinor", after.columnInt(1)}};
        idem.complete(key, response, "purchase", id);
        txn.commit();
        return response;
    });

    // ---------------------------------------------------------- delete invoice
    server.registerHandler(std::string(protocol::method::kPurchasesDelete), [ctx](const ipc::Request& request) {
        ctx->requirePermission("purchases.delete");
        const auto id = getOr<std::string>(request.payload, "purchaseId", "");
        db::Transaction txn(ctx->db());
        auto head = ctx->db().prepare("SELECT warehouse_id, stage, number FROM purchase_orders WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "Alış qaiməsi tapılmadı");
        require(head.columnText(1) != "cancelled", "Qaimə artıq silinib");
        const std::string warehouseId = head.columnText(0);
        const std::string number = head.columnText(2);
        auto returns = ctx->db().prepare("SELECT COUNT(*) FROM purchase_returns WHERE purchase_id = :id");
        returns.bind(":id", id);
        returns.step();
        require(returns.columnInt(0) == 0, "Əvvəlcə bu qaimənin qaytarmalarını silin");
        services::InventoryService inventory(*ctx);
        for (const auto& item : loadItems(*ctx, id)) {
            if (item.received > 0) {
                services::LotSpec out;
                out.preferPurchaseId = id;
                inventory.move(item.ingredientId, warehouseId, -item.received, "adjustment", id, "qaimə silindi", out);
            }
        }
        auto hold = ctx->db().prepare("UPDATE stock_lots SET quality = 'rejected' WHERE purchase_id = :id AND quality = 'pending'");
        hold.bind(":id", id);
        hold.exec();
        // What was paid on it stays paid: it becomes credit with the supplier.
        auto mark = ctx->db().prepare("UPDATE purchase_orders SET stage = 'cancelled', status = 'cancelled' WHERE id = :id");
        mark.bind(":id", id);
        mark.exec();
        refreshPurchase(*ctx, id);
        ctx->auditRequired("purchase.delete", "purchase", id, Json{{"number", number}});
        txn.commit();
        return Json{{"id", id}};
    });

    server.registerHandler(std::string(protocol::method::kPurchasesDeleteReturn), [ctx](const ipc::Request& request) {
        ctx->requirePermission("purchases.delete");
        const auto id = getOr<std::string>(request.payload, "returnId", "");
        db::Transaction txn(ctx->db());
        const auto number = undoReturn(*ctx, id);
        ctx->auditRequired("purchase.return.delete", "purchase_return", id, Json{{"number", number}});
        txn.commit();
        return Json{{"id", id}};
    });

    // -------------------------------------------------------- purchase returns
    server.registerHandler(std::string(protocol::method::kPurchasesReturn), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.manage");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        const auto purchaseId = getOr<std::string>(request.payload, "purchaseId", "");
        const auto note = getOr<std::string>(request.payload, "note", "");
        require(!supplierId.empty(), "Təchizatçını seçin");
        require(request.payload.contains("lines") && request.payload["lines"].is_array(), "lines is required");

        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        const auto key = getOr<std::string>(request.payload, "idempotencyKey", request.idempotencyKey);
        if (auto replay = idem.begin(key, "purchases.return", request.payload)) return *replay;

        // Correcting a return = taking the old one back and writing it again under its own number.
        const auto replaceId = getOr<std::string>(request.payload, "replaceReturnId", "");
        std::string replacedNumber;
        if (!replaceId.empty()) {
            ctx->requirePermission("purchases.edit");
            replacedNumber = undoReturn(*ctx, replaceId);
        }

        auto supplier = ctx->db().prepare("SELECT 1 FROM suppliers WHERE id = :id");
        supplier.bind(":id", supplierId);
        require(supplier.step(), "Təchizatçı tapılmadı");

        std::string warehouseId = warehouseFrom(*ctx, request.payload);
        if (!purchaseId.empty()) {
            auto head = ctx->db().prepare("SELECT supplier_id, warehouse_id, stage FROM purchase_orders WHERE id = :id");
            head.bind(":id", purchaseId);
            require(head.step(), "Alış qaiməsi tapılmadı");
            require(head.columnText(0) == supplierId, "Qaimə bu təchizatçıya aid deyil");
            require(head.columnText(2) == "received" || head.columnText(2) == "partially_received",
                    "Qəbul edilməmiş qaimədən qaytarmaq olmaz");
            warehouseId = head.columnText(1);
        }

        struct Line {
            std::string ingredientId;
            std::int64_t qty;
            Money unitCost;
        };
        std::vector<Line> lines;
        services::InventoryService inventory(*ctx);
        for (const auto& raw : request.payload["lines"]) {
            if (!raw.is_object()) continue;
            Line line{getOr<std::string>(raw, "ingredientId", ""), getOr<std::int64_t>(raw, "qtyMilli", 0),
                      getOr<Money>(raw, "unitCostMinor", -1)};
            if (line.ingredientId.empty() || line.qty <= 0) continue;
            if (!purchaseId.empty()) {
                // No more back than actually came in on this invoice, at its price by default.
                auto bought = ctx->db().prepare(
                    "SELECT COALESCE(SUM(received_milli), 0), MAX(landed_unit_cost_minor) FROM purchase_order_items "
                    "WHERE purchase_id = :purchase AND ingredient_id = :ingredient");
                bought.bind(":purchase", purchaseId).bind(":ingredient", line.ingredientId);
                bought.step();
                auto back = ctx->db().prepare(
                    "SELECT COALESCE(SUM(ri.qty_milli), 0) FROM purchase_return_items ri "
                    "JOIN purchase_returns r ON r.id = ri.return_id "
                    "WHERE r.purchase_id = :purchase AND ri.ingredient_id = :ingredient");
                back.bind(":purchase", purchaseId).bind(":ingredient", line.ingredientId);
                back.step();
                require(line.qty <= bought.columnInt(0) - back.columnInt(0), "Qaimədə qəbul ediləndən çox qaytarmaq olmaz");
                if (line.unitCost < 0) {
                    auto price = ctx->db().prepare(
                        "SELECT MAX(CASE WHEN p.invoice_confirmed_at IS NOT NULL AND l.invoice_unit_cost_minor IS NOT NULL "
                        "  THEN l.invoice_unit_cost_minor ELSE l.unit_cost_minor END) FROM purchase_order_items l "
                        "JOIN purchase_orders p ON p.id = l.purchase_id WHERE l.purchase_id = :purchase AND l.ingredient_id = :ingredient");
                    price.bind(":purchase", purchaseId).bind(":ingredient", line.ingredientId);
                    price.step();
                    line.unitCost = price.columnInt(0);
                }
            }
            if (line.unitCost < 0) {
                auto cost = ctx->db().prepare("SELECT cost_minor FROM ingredients WHERE id = :id");
                cost.bind(":id", line.ingredientId);
                line.unitCost = cost.step() ? cost.columnInt(0) : 0;
            }
            require(inventory.levelOf(line.ingredientId, warehouseId) >= line.qty, "Anbarda qaytarmaq üçün bu qədər mal yoxdur");
            lines.push_back(line);
        }
        require(!lines.empty(), "Qaytarılan mal yoxdur");

        const std::string id = replaceId.empty() ? "pr-" + crypto::uuid4().substr(0, 8) : replaceId;
        auto seq = ctx->db().prepare("SELECT COALESCE(MAX(CAST(SUBSTR(number, 3) AS INTEGER)), 0) + 1 FROM purchase_returns");
        seq.step();
        char number[32];
        if (replacedNumber.empty())
            std::snprintf(number, sizeof(number), "Q-%05lld", static_cast<long long>(seq.columnInt(0)));
        else
            std::snprintf(number, sizeof(number), "%s", replacedNumber.c_str());
        const auto now = nowMs();
        Money total = 0;
        for (const auto& line : lines) total += line.qty * line.unitCost / 1000;

        auto insert = ctx->db().prepare(
            "INSERT INTO purchase_returns (id, number, supplier_id, purchase_id, warehouse_id, total_minor, note, "
            "  actor_user_id, created_at) VALUES (:id, :number, :supplier, :purchase, :warehouse, :total, :note, :actor, :now)");
        insert.bind(":id", id).bind(":number", std::string(number)).bind(":supplier", supplierId)
            .bindOptional(":purchase", purchaseId).bind(":warehouse", warehouseId).bind(":total", total)
            .bind(":note", note).bindOptional(":actor", ctx->session().userId).bind(":now", now);
        insert.exec();
        for (const auto& line : lines) {
            auto item = ctx->db().prepare(
                "INSERT INTO purchase_return_items (id, return_id, ingredient_id, qty_milli, unit_cost_minor, line_total_minor) "
                "VALUES (:id, :ret, :ingredient, :qty, :cost, :total)");
            item.bind(":id", crypto::uuid4()).bind(":ret", id).bind(":ingredient", line.ingredientId)
                .bind(":qty", line.qty).bind(":cost", line.unitCost).bind(":total", line.qty * line.unitCost / 1000);
            item.exec();
            services::LotSpec out;
            out.preferPurchaseId = purchaseId;
            inventory.move(line.ingredientId, warehouseId, -line.qty, "issue", id, "təchizatçıya qaytarma", out);
        }
        ledger(*ctx, supplierId, purchaseId, -total, "Qaytarma " + std::string(number));
        if (!purchaseId.empty()) refreshPurchase(*ctx, purchaseId);

        ctx->auditRequired("purchase.return", "purchase_return", id,
                           Json{{"supplierId", supplierId}, {"purchaseId", purchaseId}, {"totalMinor", total}});
        Json response{{"id", id}, {"number", std::string(number)}, {"totalMinor", total}};
        idem.complete(key, response, "purchase_return", id);
        txn.commit();
        return response;
    });

    server.registerHandler(std::string(protocol::method::kPurchasesReturns), [ctx](const ipc::Request& request) {
        ctx->requirePermission("suppliers.view");
        const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
        auto stmt = ctx->db().prepare(
            "SELECT r.id, r.number, r.supplier_id AS supplierId, s.name AS supplierName, "
            "       r.purchase_id AS purchaseId, p.number AS purchaseNumber, r.total_minor AS totalMinor, "
            "       r.note, r.created_at AS createdAt, r.warehouse_id AS warehouseId, "
            "       COALESCE(o.name, '') AS objectName "
            "FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id "
            "LEFT JOIN purchase_orders p ON p.id = r.purchase_id "
            "LEFT JOIN cash_objects o ON o.warehouse_id = r.warehouse_id AND o.active = 1 "
            "WHERE (:supplier = '' OR r.supplier_id = :supplier) "
            "ORDER BY r.created_at DESC LIMIT 2000");
        stmt.bind(":supplier", supplierId);
        Json rows = stmt.rows();
        for (auto& row : rows) {
            auto lines = ctx->db().prepare(
                "SELECT ri.ingredient_id AS ingredientId, i.name, i.unit, ri.qty_milli AS qtyMilli, "
                "       ri.unit_cost_minor AS unitCostMinor, ri.line_total_minor AS lineTotalMinor "
                "FROM purchase_return_items ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.return_id = :id");
            lines.bind(":id", row.value("id", std::string{}));
            row["lines"] = lines.rows();
        }
        return Json{{"returns", rows}};
    });
}

}  // namespace pos::handlers
