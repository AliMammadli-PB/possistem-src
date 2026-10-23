#include "pos/services/SunmiOutbox.hpp"
/**
 * Satışlar: every closed bill as a sales invoice.
 *
 * A row says where it was sold (the paying PC's till and its obyekt), who
 * served it, who settled it, the discount, and what went on a partner's tab.
 * With the right permission a closed sale can be corrected (quantities,
 * prices, discount, waiter, partner) or deleted; money, partner debt and
 * stock follow, so the kassa, the partner's account and the store stay true.
 */
#include <algorithm>
#include <map>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/PaymentService.hpp"
#include "pos/services/Pricing.hpp"

namespace pos::handlers {
namespace {

constexpr const char* kSaleSelect =
    "SELECT o.id, o.order_number AS number, o.status, o.opened_at AS openedAt, o.closed_at AS closedAt, "
    "       o.deleted_at AS deletedAt, o.void_reason AS deleteReason, "
    "       COALESCE(t.label, '') AS tableName, o.user_id AS waiterId, COALESCE(w.full_name, '') AS waiterName, "
    "       COALESCE(o.closed_by, (SELECT p.user_id FROM payments p WHERE p.order_id = o.id "
    "                 AND p.status IN ('approved','refunded','canceled') ORDER BY p.created_at DESC LIMIT 1), "
    "                o.user_id) AS closedById, "
    "       COALESCE((SELECT u.full_name FROM users u WHERE u.id = COALESCE(o.closed_by, (SELECT p.user_id "
    "                 FROM payments p WHERE p.order_id = o.id AND p.status IN ('approved','refunded','canceled') "
    "                 ORDER BY p.created_at DESC LIMIT 1), o.user_id)), '') AS closedByName, "
    "       o.subtotal_minor AS subtotalMinor, o.discount_minor AS discountMinor, "
    "       COALESCE(d.full_name, '') AS discountByName, o.discount_reason AS discountReason, "
    "       o.total_minor AS totalMinor, o.account_minor AS accountMinor, o.guest_count AS guestCount, "
    "       COALESCE(o.customer_id, '') AS customerId, COALESCE(c.name, '') AS customerName, o.note, "
    "       COALESCE((SELECT SUM(CASE WHEN p.method = 'cash' THEN p.amount_minor WHEN p.method = 'mixed' THEN "
    "                 (SELECT COALESCE(SUM(x.amount_minor), 0) FROM payment_tenders x WHERE x.payment_id = p.id "
    "                  AND x.method = 'cash') ELSE 0 END) FROM payments p WHERE p.order_id = o.id "
    "                 AND p.status IN ('approved','refunded')), 0) AS cashMinor, "
    "       COALESCE((SELECT SUM(CASE WHEN p.method = 'card' THEN p.amount_minor WHEN p.method = 'mixed' THEN "
    "                 (SELECT COALESCE(SUM(x.amount_minor), 0) FROM payment_tenders x WHERE x.payment_id = p.id "
    "                  AND x.method = 'card') ELSE 0 END) FROM payments p WHERE p.order_id = o.id "
    "                 AND p.status IN ('approved','refunded')), 0) AS cardMinor, "
    "       COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.order_id = o.id "
    "                 AND r.status = 'completed'), 0) AS refundedMinor, "
    "       COALESCE(a.id, '') AS accountId, COALESCE(a.name, '') AS accountName, "
    "       COALESCE(ob.id, '') AS objectId, COALESCE(ob.name, '') AS objectName, "
    "       (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i WHERE i.order_id = o.id "
    "                 AND i.status != 'voided') AS itemCount "
    "FROM orders o "
    "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
    "LEFT JOIN users w ON w.id = o.user_id "
    "LEFT JOIN users d ON d.id = o.discount_by "
    "LEFT JOIN customers c ON c.id = o.customer_id "
    "LEFT JOIN cash_accounts a ON a.kind = 'till' AND a.terminal_id != '' AND a.terminal_id = "
    "     (SELECT p.terminal_id FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) "
    "LEFT JOIN cash_objects ob ON ob.id = a.object_id ";

/** Brings the store in line with what the (corrected) bill now says was sold. */
void syncSaleStock(Context& ctx, const std::string& orderId, bool deleted) {
    auto where = ctx.db().prepare(
        "SELECT warehouse_id FROM stock_movements WHERE kind = 'sale' AND reference_id = :order LIMIT 1");
    where.bind(":order", orderId);
    if (!where.step()) return;  // never left the store (no recipe, or not consumed)
    const std::string warehouseId = where.columnText(0);

    std::map<std::string, std::int64_t> taken;
    auto moved = ctx.db().prepare(
        "SELECT ingredient_id, -SUM(qty_delta_milli) FROM stock_movements WHERE reference_id = :order "
        "AND (kind = 'sale' OR (kind = 'adjustment' AND reason = 'satış düzəlişi')) GROUP BY ingredient_id");
    moved.bind(":order", orderId);
    while (moved.step()) taken[moved.columnText(0)] = moved.columnInt(1);

    std::map<std::string, std::int64_t> needed;
    if (!deleted) {
        auto rows = ctx.db().prepare(
            "SELECT r.ingredient_id, SUM(r.qty_milli * i.quantity) FROM order_items i "
            "JOIN menu_item_ingredients r ON r.menu_item_id = i.product_id "
            "WHERE i.order_id = :order AND i.status != 'voided' GROUP BY r.ingredient_id");
        rows.bind(":order", orderId);
        while (rows.step()) needed[rows.columnText(0)] = rows.columnInt(1);
    }
    for (const auto& [ingredient, qty] : needed) taken.try_emplace(ingredient, 0);

    services::InventoryService inventory(ctx);
    for (const auto& [ingredient, already] : taken) {
        const auto want = needed.count(ingredient) ? needed[ingredient] : 0;
        if (want != already) inventory.move(ingredient, warehouseId, already - want, "adjustment", orderId, "satış düzəlişi");
    }
}

void refreshDebt(Context& ctx, const std::string& customerId) {
    auto debt = ctx.db().prepare(
        "UPDATE customers SET debt_minor = (SELECT COALESCE(SUM(CASE WHEN kind = 'payment' "
        "  THEN -amount_minor ELSE amount_minor END), 0) FROM customer_ledger "
        "  WHERE customer_id = :id), updated_at = :now WHERE id = :id");
    debt.bind(":id", customerId).bind(":now", nowMs());
    debt.exec();
}

void chargeTab(Context& ctx, const std::string& customerId, const std::string& orderId, Money amount,
               const std::string& note) {
    if (customerId.empty() || amount == 0) return;
    auto charge = ctx.db().prepare(
        "INSERT INTO customer_ledger (id, customer_id, order_id, amount_minor, kind, note, actor_user_id, created_at) "
        "VALUES (:id, :customer, :order, :amount, 'charge', :note, :actor, :now)");
    charge.bind(":id", crypto::uuid4()).bind(":customer", customerId).bind(":order", orderId)
        .bind(":amount", amount).bind(":note", note).bindOptional(":actor", ctx.session().userId)
        .bind(":now", nowMs());
    charge.exec();
    refreshDebt(ctx, customerId);
}

/** Moves `delta` onto the bill's payments, latest first (the till takings follow). */
Money adjustPayments(Context& ctx, const std::string& orderId, Money delta) {
    auto list = ctx.db().prepare(
        "SELECT id, amount_minor, method FROM payments WHERE order_id = :order AND status = 'approved' "
        "ORDER BY created_at DESC");
    list.bind(":order", orderId);
    struct Row {
        std::string id;
        Money amount;
        std::string method;
    };
    std::vector<Row> rows;
    while (list.step()) rows.push_back({list.columnText(0), list.columnInt(1), list.columnText(2)});
    for (const auto& row : rows) {
        if (delta == 0) break;
        const Money next = std::max<Money>(0, row.amount + delta);
        const Money applied = next - row.amount;
        auto upd = ctx.db().prepare("UPDATE payments SET amount_minor = :amount, updated_at = :now WHERE id = :id");
        upd.bind(":amount", next).bind(":now", nowMs()).bind(":id", row.id);
        upd.exec();
        if (row.method == "mixed") {
            auto tender = ctx.db().prepare(
                "UPDATE payment_tenders SET amount_minor = MAX(0, amount_minor + :delta) WHERE id = "
                "(SELECT id FROM payment_tenders WHERE payment_id = :payment ORDER BY sort_order DESC LIMIT 1)");
            tender.bind(":delta", applied).bind(":payment", row.id);
            tender.exec();
        }
        delta -= applied;
    }
    return delta;  // what could not be placed
}

}  // namespace

void registerSales(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(std::string(protocol::method::kSalesList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("sales.view");
        const auto from = getOr<std::int64_t>(request.payload, "from", 0);
        const auto to = getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000);
        auto stmt = ctx->db().prepare(std::string(kSaleSelect) +
            "WHERE o.closed_at >= :from AND o.closed_at < :to "
            "  AND (o.status IN ('paid','closed') OR o.deleted_at IS NOT NULL) "
            // A bill merged into another table closes empty: not a sale.
            "  AND (o.total_minor > 0 OR o.deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM order_items i "
            "       WHERE i.order_id = o.id AND i.status != 'voided')) "
            "ORDER BY o.closed_at DESC LIMIT 5000");
        stmt.bind(":from", from).bind(":to", to);
        Json out{{"sales", stmt.rows()}};
        // Returns of the period, whenever the sale itself was.
        auto refunds = ctx->db().prepare(
            "SELECT r.id, r.order_id AS orderId, o.order_number AS number, r.amount_minor AS amountMinor, "
            "       r.method, r.reason, r.created_at AS createdAt, COALESCE(u.full_name, '') AS userName, "
            "       COALESCE((SELECT GROUP_CONCAT(ri.name_snapshot || ' × ' || ri.quantity, ', ') "
            "                 FROM refund_items ri WHERE ri.refund_id = r.id), '') AS items, "
            "       COALESCE(ob.id, '') AS objectId, COALESCE(ob.name, '') AS objectName "
            "FROM refunds r JOIN orders o ON o.id = r.order_id "
            "LEFT JOIN users u ON u.id = r.actor_user_id "
            "LEFT JOIN cash_accounts a ON a.kind = 'till' AND a.terminal_id != '' AND a.terminal_id = r.terminal_id "
            "LEFT JOIN cash_objects ob ON ob.id = a.object_id "
            "WHERE r.status = 'completed' AND r.created_at >= :from AND r.created_at < :to "
            "ORDER BY r.created_at DESC LIMIT 2000");
        refunds.bind(":from", from).bind(":to", to);
        out["refunds"] = refunds.rows();
        // What sold most, by money.
        auto top = ctx->db().prepare(
            "SELECT i.name_snapshot AS name, SUM(i.quantity) AS quantity, SUM(i.line_total_minor) AS totalMinor "
            "FROM order_items i JOIN orders o ON o.id = i.order_id "
            "WHERE i.status != 'voided' AND o.status IN ('paid','closed') "
            "  AND o.closed_at >= :from AND o.closed_at < :to "
            "GROUP BY i.name_snapshot ORDER BY totalMinor DESC LIMIT 15");
        top.bind(":from", from).bind(":to", to);
        out["top"] = top.rows();
        return out;
    });

    server.registerHandler(std::string(protocol::method::kSalesGet), [ctx](const ipc::Request& request) {
        ctx->requirePermission("sales.view");
        const auto id = getOr<std::string>(request.payload, "orderId", "");
        auto head = ctx->db().prepare(std::string(kSaleSelect) + "WHERE o.id = :id");
        head.bind(":id", id);
        auto rows = head.rows();
        require(!rows.empty(), "Satış tapılmadı");
        Json sale = rows[0];
        auto items = ctx->db().prepare(
            "SELECT i.id, i.name_snapshot AS name, i.quantity, i.unit_price_minor AS unitPriceMinor, "
            "       i.modifier_total_minor AS modifierTotalMinor, i.line_total_minor AS lineTotalMinor, "
            "       i.status, i.complimentary, i.note, "
            "       COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri JOIN refunds r ON r.id = ri.refund_id "
            "                 WHERE ri.order_item_id = i.id AND r.status = 'completed'), 0) AS refundedQty "
            "FROM order_items i WHERE i.order_id = :id ORDER BY i.line_seq, i.created_at");
        items.bind(":id", id);
        sale["items"] = items.rows();
        auto payments = ctx->db().prepare(
            "SELECT p.id, p.method, p.status, p.amount_minor AS amountMinor, p.created_at AS createdAt, "
            "       COALESCE(u.full_name, '') AS userName FROM payments p LEFT JOIN users u ON u.id = p.user_id "
            "WHERE p.order_id = :id AND p.status IN ('approved','refunded','canceled') ORDER BY p.created_at");
        payments.bind(":id", id);
        sale["payments"] = payments.rows();
        auto refunds = ctx->db().prepare(
            "SELECT r.id, r.amount_minor AS amountMinor, r.method, r.reason, r.status, r.created_at AS createdAt, "
            "       COALESCE(u.full_name, '') AS userName FROM refunds r LEFT JOIN users u ON u.id = r.actor_user_id "
            "WHERE r.order_id = :id ORDER BY r.created_at");
        refunds.bind(":id", id);
        sale["refunds"] = refunds.rows();
        auto waiters = ctx->db().prepare("SELECT id, full_name AS name FROM users WHERE active = 1 ORDER BY full_name");
        sale["waiters"] = waiters.rows();
        return sale;
    });

    // ------------------------------------------------------------ correction
    server.registerHandler(std::string(protocol::method::kSalesUpdate), [ctx](const ipc::Request& request) {
        ctx->requirePermission("sales.edit");
        const auto orderId = getOr<std::string>(request.payload, "orderId", "");
        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        const auto key = request.idempotencyKey;
        if (auto replay = idem.begin(key, "sales.update", request.payload)) return *replay;

        services::guardSunmiEdit(*ctx, orderId);
        auto head = ctx->db().prepare(
            "SELECT status, COALESCE(customer_id, ''), account_minor, order_number, deleted_at IS NOT NULL "
            "FROM orders WHERE id = :id");
        head.bind(":id", orderId);
        require(head.step(), "Satış tapılmadı");
        require(head.columnText(0) == "closed" || head.columnText(0) == "paid", "Yalnız bağlanmış satışa düzəliş olunur");
        require(head.columnInt(4) == 0, "Silinmiş satışa düzəliş olunmur");
        const std::string oldCustomer = head.columnText(1);
        Money account = head.columnInt(2);
        const std::string number = head.columnText(3);
        const auto now = nowMs();

        if (request.payload.contains("waiterId")) {
            const auto waiter = getOr<std::string>(request.payload, "waiterId", "");
            auto user = ctx->db().prepare("SELECT 1 FROM users WHERE id = :id");
            user.bind(":id", waiter);
            require(user.step(), "Ofisiant tapılmadı");
            auto upd = ctx->db().prepare("UPDATE orders SET user_id = :u WHERE id = :id");
            upd.bind(":u", waiter).bind(":id", orderId);
            upd.exec();
        }
        if (request.payload.contains("note")) {
            auto upd = ctx->db().prepare("UPDATE orders SET note = :n WHERE id = :id");
            upd.bind(":n", getOr<std::string>(request.payload, "note", "")).bind(":id", orderId);
            upd.exec();
        }

        // Partner: what is on the tab moves with them.
        std::string customer = oldCustomer;
        if (request.payload.contains("customerId")) {
            customer = getOr<std::string>(request.payload, "customerId", "");
            if (customer != oldCustomer) {
                if (!customer.empty()) {
                    auto exists = ctx->db().prepare("SELECT 1 FROM customers WHERE id = :id");
                    exists.bind(":id", customer);
                    require(exists.step(), "Partnyor tapılmadı");
                }
                require(account == 0 || !customer.empty(), "Borca yazılmış satışdan partnyoru silmək olmaz");
                chargeTab(*ctx, oldCustomer, orderId, -account, "Satış #" + number + " başqa partnyora keçdi");
                chargeTab(*ctx, customer, orderId, account, "Satış #" + number);
                auto upd = ctx->db().prepare("UPDATE orders SET customer_id = :c WHERE id = :id");
                upd.bindOptional(":c", customer).bind(":id", orderId);
                upd.exec();
            }
        }

        if (request.payload.contains("lines") && request.payload["lines"].is_array()) {
            for (const auto& raw : request.payload["lines"]) {
                if (!raw.is_object()) continue;
                const auto itemId = getOr<std::string>(raw, "id", "");
                auto item = ctx->db().prepare(
                    "SELECT quantity, modifier_total_minor, unit_price_minor FROM order_items "
                    "WHERE id = :id AND order_id = :order AND status != 'voided'");
                item.bind(":id", itemId).bind(":order", orderId);
                if (!item.step()) continue;
                const auto oldQty = std::max<std::int64_t>(1, item.columnInt(0));
                const Money perUnitModifier = item.columnInt(1) / oldQty;
                const auto qty = getOr<std::int64_t>(raw, "quantity", oldQty);
                const Money price = getOr<Money>(raw, "unitPriceMinor", item.columnInt(2));
                require(price >= 0, "Qiymət mənfi ola bilməz");
                if (qty <= 0) {
                    auto voidIt = ctx->db().prepare(
                        "UPDATE order_items SET status = 'voided', void_reason = 'Satış düzəlişi', "
                        "voided_by = :by, updated_at = :now WHERE id = :id");
                    voidIt.bindOptional(":by", ctx->session().userId).bind(":now", now).bind(":id", itemId);
                    voidIt.exec();
                    continue;
                }
                auto upd = ctx->db().prepare(
                    "UPDATE order_items SET quantity = :q, unit_price_minor = :p, modifier_total_minor = :m, "
                    "line_total_minor = :t, updated_at = :now WHERE id = :id");
                upd.bind(":q", qty).bind(":p", price).bind(":m", perUnitModifier * qty)
                    .bind(":t", services::lineTotal(price, perUnitModifier, qty)).bind(":now", now).bind(":id", itemId);
                upd.exec();
            }
            auto left = ctx->db().prepare("SELECT COUNT(*) FROM order_items WHERE order_id = :id AND status != 'voided'");
            left.bind(":id", orderId);
            left.step();
            require(left.columnInt(0) > 0, "Bütün məhsulları silmək üçün satışı silin");
        }
        if (request.payload.contains("discountMinor")) {
            const Money discount = std::max<Money>(0, getOr<Money>(request.payload, "discountMinor", 0));
            auto upd = ctx->db().prepare(
                "UPDATE orders SET discount_type = :type, discount_value = :value, discount_by = :by WHERE id = :id");
            if (discount > 0) upd.bind(":type", std::string("amount")); else upd.bind(":type", nullptr);
            upd.bind(":value", discount).bindOptional(":by", ctx->session().userId).bind(":id", orderId);
            upd.exec();
        }

        // The money: the difference goes on the partner's tab if the bill was
        // (partly) on it, otherwise onto what was paid.
        services::OrderService orders(*ctx);
        const auto totals = orders.recalculate(orderId);
        Money delta = totals.total - (services::PaymentService(*ctx).netCollected(orderId) + account);
        if (delta != 0 && account > 0) {
            const Money onTab = std::max<Money>(-account, delta);
            account += onTab;
            chargeTab(*ctx, customer, orderId, onTab, "Satış #" + number + " düzəliş");
            delta -= onTab;
        }
        if (delta != 0) delta = adjustPayments(*ctx, orderId, delta);
        if (delta > 0 && !customer.empty()) {
            account += delta;
            chargeTab(*ctx, customer, orderId, delta, "Satış #" + number + " düzəliş");
            delta = 0;
        }
        require(delta == 0, "Fərqi yazmağa ödəniş yoxdur — əvvəlcə partnyor seçin");
        auto acc = ctx->db().prepare("UPDATE orders SET account_minor = :a, updated_at = :now WHERE id = :id");
        acc.bind(":a", account).bind(":now", now).bind(":id", orderId);
        acc.exec();
        orders.recalculate(orderId);
        syncSaleStock(*ctx, orderId, false);

        ctx->auditRequired("sale.update", "order", orderId, Json{{"totalMinor", totals.total}});
        Json response{{"orderId", orderId}, {"totalMinor", totals.total}};
        idem.complete(key, response, "order", orderId);
        txn.commit();
        return response;
    });

    // ---------------------------------------------------------------- delete
    server.registerHandler(std::string(protocol::method::kSalesDelete), [ctx](const ipc::Request& request) {
        ctx->requirePermission("sales.delete");
        const auto orderId = getOr<std::string>(request.payload, "orderId", "");
        const auto reason = getOr<std::string>(request.payload, "reason", "");
        require(!reason.empty(), "Silinmə səbəbini yazın");
        db::Transaction txn(ctx->db());
        services::guardSunmiEdit(*ctx, orderId);
        auto head = ctx->db().prepare(
            "SELECT status, COALESCE(customer_id, ''), account_minor, order_number, deleted_at IS NOT NULL "
            "FROM orders WHERE id = :id");
        head.bind(":id", orderId);
        require(head.step(), "Satış tapılmadı");
        require(head.columnInt(4) == 0, "Satış artıq silinib");
        require(head.columnText(0) == "closed" || head.columnText(0) == "paid", "Yalnız bağlanmış satış silinir");
        const std::string customer = head.columnText(1);
        const Money account = head.columnInt(2);
        const std::string number = head.columnText(3);
        const auto now = nowMs();

        // Stock back first, while the lines still count as sold.
        syncSaleStock(*ctx, orderId, true);
        chargeTab(*ctx, customer, orderId, -account, "Satış #" + number + " silindi");
        auto pays = ctx->db().prepare(
            "UPDATE payments SET status = 'canceled', resolution_note = 'Satış silindi', updated_at = :now "
            "WHERE order_id = :id AND status IN ('approved','refunded')");
        pays.bind(":now", now).bind(":id", orderId);
        pays.exec();
        auto refunds = ctx->db().prepare(
            "UPDATE refunds SET status = 'canceled', updated_at = :now WHERE order_id = :id AND status = 'completed'");
        refunds.bind(":now", now).bind(":id", orderId);
        refunds.exec();
        auto upd = ctx->db().prepare(
            "UPDATE orders SET status = 'voided', void_reason = :reason, deleted_at = :now, deleted_by = :by, "
            "account_minor = 0, paid_minor = 0, updated_at = :now WHERE id = :id");
        upd.bind(":reason", reason).bind(":now", now).bindOptional(":by", ctx->session().userId).bind(":id", orderId);
        upd.exec();
        ctx->auditRequired("sale.delete", "order", orderId, Json{{"reason", reason}});
        txn.commit();
        return Json{{"orderId", orderId}};
    });

    // ---------------------------------------------------------- Market sales
    // A sale rung up on the Market till, written here as a closed bill: the
    // goods leave this branch's store, cash/card land on the till of the
    // Market PC (terminal) and nisyə goes on the partner. Same externalId twice
    // is the same sale.
    server.registerHandler(std::string(protocol::method::kSalesRecordExternal), [ctx](const ipc::Request& request) {
        ctx->requirePermission("sales.edit");
        const auto externalId = getOr<std::string>(request.payload, "externalId", "");
        require(!externalId.empty(), "externalId tələb olunur");
        require(request.payload.contains("lines") && request.payload["lines"].is_array() &&
                    !request.payload["lines"].empty(), "Satışda mal yoxdur");
        db::Transaction txn(ctx->db());
        {
            auto seen = ctx->db().prepare("SELECT order_id FROM external_sales WHERE external_id = :id");
            seen.bind(":id", externalId);
            if (seen.step()) return Json{{"orderId", seen.columnText(0)}, {"duplicate", true}};
        }
        const auto at = getOr<std::int64_t>(request.payload, "at", nowMs());
        const auto cash = getOr<Money>(request.payload, "cashMinor", 0);
        const auto card = getOr<Money>(request.payload, "cardMinor", 0);
        const auto credit = getOr<Money>(request.payload, "creditMinor", 0);
        const auto discount = getOr<Money>(request.payload, "discountMinor", 0);
        const auto customerId = getOr<std::string>(request.payload, "customerId", "");
        require(cash >= 0 && card >= 0 && credit >= 0 && discount >= 0, "Məbləğ mənfi ola bilməz");
        // Nisyə without a partner here is a Market customer's debt, kept in Market.
        const std::string terminal = ctx->saleTerminalId();
        const std::string userId = ctx->session().userId;

        // This PC's branch store, or the one asked for, or the main one.
        std::string warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        if (warehouseId.empty()) {
            auto branch = ctx->db().prepare(
                "SELECT o.warehouse_id FROM cash_accounts a JOIN cash_objects o ON o.id = a.object_id "
                "JOIN warehouses w ON w.id = o.warehouse_id AND w.active = 1 "
                "WHERE a.terminal_id = :t AND a.terminal_id != '' AND a.kind = 'till' AND a.active = 1 LIMIT 1");
            branch.bind(":t", terminal);
            if (branch.step()) warehouseId = branch.columnText(0);
        }
        if (warehouseId.empty()) {
            auto store = ctx->db().prepare("SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
            require(store.step(), "Anbar yoxdur");
            warehouseId = store.columnText(0);
        }

        const std::string orderId = "ord-" + crypto::uuid4().substr(0, 12);
        const std::string number = services::OrderService(*ctx).nextOrderNumber();
        auto order = ctx->db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, opened_at, closed_at, updated_at, note, customer_id, closed_by) "
            "VALUES (:id, :no, :user, 'closed', :at, :at, :at, :note, :customer, :user)");
        order.bind(":id", orderId).bind(":no", number).bind(":user", userId).bind(":at", at)
            .bind(":note", "Market " + getOr<std::string>(request.payload, "number", externalId))
            .bindOptional(":customer", customerId);
        order.exec();

        // Each good sold gets a hidden menu row (EXT-<good>) under a hidden category,
        // so the sale reads like any other bill. Made here, not in a migration:
        // an empty menu is how a fresh install knows to seed itself.
        {
            auto hidden = ctx->db().prepare(
                "INSERT OR IGNORE INTO menu_categories (id, name_az, sort_order, active) VALUES ('cat-external', 'Market', 999, 0)");
            hidden.exec();
        }
        services::InventoryService inventory(*ctx);
        Money subtotal = 0;
        std::int64_t seq = 0;
        for (const auto& line : request.payload["lines"]) {
            const auto ingredientId = getOr<std::string>(line, "ingredientId", "");
            const auto qty = getOr<std::int64_t>(line, "qtyMilli", 0);
            const auto unitPrice = getOr<Money>(line, "unitPriceMinor", 0);
            const auto total = getOr<Money>(line, "totalMinor", qty * unitPrice / 1000);
            require(qty > 0, "Miqdar sıfırdan böyük olmalıdır");
            auto good = ctx->db().prepare("SELECT name, unit FROM ingredients WHERE id = :id");
            good.bind(":id", ingredientId);
            require(good.step(), "Mal tapılmadı: " + ingredientId);
            std::string name = getOr<std::string>(line, "name", good.columnText(0));
            const std::string productId = "ext-" + ingredientId;
            auto product = ctx->db().prepare(
                "INSERT OR IGNORE INTO menu_items (id, category_id, sku, name_az, price_minor, active, archived, created_at, updated_at) "
                "VALUES (:id, 'cat-external', :sku, :name, 0, 0, 1, :now, :now)");
            product.bind(":id", productId).bind(":sku", "EXT-" + ingredientId).bind(":name", name).bind(":now", at);
            product.exec();
            // Whole pieces keep their count; a weighed amount is one line priced in full.
            std::int64_t quantity = 1;
            Money linePrice = total;
            if (qty % 1000 == 0) {
                quantity = qty / 1000;
                linePrice = total / quantity;
            } else {
                char buf[48];
                std::snprintf(buf, sizeof(buf), " × %.3f %s", static_cast<double>(qty) / 1000.0, good.columnText(1).c_str());
                name += buf;
            }
            auto item = ctx->db().prepare(
                "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, unit_price_minor, quantity, "
                "  line_total_minor, status, created_at, updated_at) "
                "VALUES (:id, :order, :product, :seq, :name, :price, :qty, :total, 'served', :at, :at)");
            item.bind(":id", crypto::uuid4()).bind(":order", orderId).bind(":product", productId).bind(":seq", ++seq)
                .bind(":name", name).bind(":price", linePrice).bind(":qty", quantity).bind(":total", total).bind(":at", at);
            item.exec();
            // This sale is already paid in Market. Archiving its goods before
            // the asynchronous feed must not block the stock/finance ledger.
            // noStock: the good came into Mallar after this sale, with the till's
            // quantity that already had it taken off - book the bill, not the stock.
            if (!getOr<bool>(line, "noStock", false))
                inventory.move(ingredientId, warehouseId, -qty, "sale", orderId, "Market satışı", {}, true);
            subtotal += total;
        }
        const Money totalMinor = std::max<Money>(0, subtotal - discount);
        auto totals = ctx->db().prepare(
            "UPDATE orders SET subtotal_minor = :sub, discount_minor = :disc, total_minor = :total, paid_minor = :paid, "
            "  account_minor = :credit WHERE id = :id");
        totals.bind(":sub", subtotal).bind(":disc", subtotal - totalMinor).bind(":total", totalMinor)
            .bind(":paid", cash + card).bind(":credit", credit).bind(":id", orderId);
        totals.exec();
        for (const auto& [method, amount] : {std::pair<const char*, Money>{"cash", cash}, {"card", card}}) {
            if (amount <= 0) continue;
            auto pay = ctx->db().prepare(
                "INSERT INTO payments (id, order_id, method, status, amount_minor, tendered_minor, user_id, terminal_id, created_at, updated_at) "
                "VALUES (:id, :order, :method, 'approved', :amount, :amount, :user, :t, :at, :at)");
            pay.bind(":id", crypto::uuid4()).bind(":order", orderId).bind(":method", std::string(method))
                .bind(":amount", amount).bind(":user", userId).bind(":t", terminal).bind(":at", at);
            pay.exec();
        }
        if(!request.payload.value("creditInMarketLedger",false))chargeTab(*ctx, customerId, orderId, credit, "Market " + number);
        auto mark = ctx->db().prepare(
            "INSERT INTO external_sales (external_id, order_id, kind, created_at) VALUES (:e, :o, 'sale', :now)");
        mark.bind(":e", externalId).bind(":o", orderId).bind(":now", nowMs());
        mark.exec();
        txn.commit();
        return Json{{"orderId", orderId}, {"number", number}, {"warehouseId", warehouseId}};
    });

    // A Market return: goods back into the store, money back out of the till
    // (or off the partner's tab), against the sale it came from.
    server.registerHandler(std::string(protocol::method::kSalesRecordExternalRefund), [ctx](const ipc::Request& request) {
        ctx->requirePermission("sales.edit");
        const auto externalId = getOr<std::string>(request.payload, "externalId", "");
        const auto saleId = getOr<std::string>(request.payload, "saleExternalId", "");
        require(!externalId.empty() && !saleId.empty(), "externalId və saleExternalId tələb olunur");
        db::Transaction txn(ctx->db());
        {
            auto seen = ctx->db().prepare("SELECT order_id FROM external_sales WHERE external_id = :id");
            seen.bind(":id", externalId);
            if (seen.step()) return Json{{"orderId", seen.columnText(0)}, {"duplicate", true}};
        }
        auto sale = ctx->db().prepare(
            "SELECT e.order_id, COALESCE(o.customer_id, '') FROM external_sales e JOIN orders o ON o.id = e.order_id "
            "WHERE e.external_id = :id AND e.kind = 'sale'");
        sale.bind(":id", saleId);
        if (!sale.step()) throw PosError(std::string(protocol::err::kNotFound), "Qaytarılan satış hələ yazılmayıb");
        const std::string orderId = sale.columnText(0);
        const std::string customerId = sale.columnText(1);
        auto moved = ctx->db().prepare(
            "SELECT warehouse_id FROM stock_movements WHERE reference_id = :o AND kind = 'sale' LIMIT 1");
        moved.bind(":o", orderId);
        std::string warehouseId;
        if (moved.step()) warehouseId = moved.columnText(0);
        if (warehouseId.empty()) {
            // A sale booked without stock (noStock: before its goods were in Mallar)
            // still returns its goods to this PC's branch store.
            auto branch = ctx->db().prepare(
                "SELECT o.warehouse_id FROM cash_accounts a JOIN cash_objects o ON o.id = a.object_id "
                "JOIN warehouses w ON w.id = o.warehouse_id AND w.active = 1 "
                "WHERE a.terminal_id = :t AND a.terminal_id != '' AND a.kind = 'till' AND a.active = 1 LIMIT 1");
            branch.bind(":t", ctx->saleTerminalId());
            if (branch.step()) warehouseId = branch.columnText(0);
            else {
                auto store = ctx->db().prepare("SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
                if (store.step()) warehouseId = store.columnText(0);
            }
        }
        const auto reason = getOr<std::string>(request.payload, "reason", "Market qaytarma");
        services::InventoryService inventory(*ctx);
        if (request.payload.contains("lines") && request.payload["lines"].is_array() && !warehouseId.empty()) {
            for (const auto& line : request.payload["lines"]) {
                const auto ingredientId = getOr<std::string>(line, "ingredientId", "");
                const auto qty = getOr<std::int64_t>(line, "qtyMilli", 0);
                if (ingredientId.empty() || qty <= 0 || getOr<bool>(line, "noStock", false)) continue;
                inventory.move(ingredientId, warehouseId, qty, "sale", orderId, reason, {}, true);
            }
        }
        const auto now = getOr<std::int64_t>(request.payload, "at", nowMs());
        for (const auto& [method, amount] : {std::pair<const char*, Money>{"cash", getOr<Money>(request.payload, "cashMinor", 0)},
                                             {"card", getOr<Money>(request.payload, "cardMinor", 0)}}) {
            if (amount <= 0) continue;
            auto pay = ctx->db().prepare(
                "SELECT id FROM payments WHERE order_id = :o AND status = 'approved' "
                "ORDER BY CASE WHEN method = :m THEN 0 ELSE 1 END LIMIT 1");
            pay.bind(":o", orderId).bind(":m", std::string(method));
            if (!pay.step()) continue;
            auto refund = ctx->db().prepare(
                "INSERT INTO refunds (id, order_id, payment_id, amount_minor, reason, status, method, actor_user_id, "
                "  terminal_id, created_at, updated_at) "
                "VALUES (:id, :o, :p, :amount, :reason, 'completed', :method, :actor, :t, :at, :at)");
            refund.bind(":id", crypto::uuid4()).bind(":o", orderId).bind(":p", pay.columnText(0)).bind(":amount", amount)
                .bind(":reason", reason).bind(":method", std::string(method)).bindOptional(":actor", ctx->session().userId)
                .bind(":t", ctx->saleTerminalId()).bind(":at", now);
            refund.exec();
        }
        if(!request.payload.value("creditInMarketLedger",false))chargeTab(*ctx, customerId, orderId, -getOr<Money>(request.payload, "creditMinor", 0), "Market qaytarma");
        auto mark = ctx->db().prepare(
            "INSERT INTO external_sales (external_id, order_id, kind, created_at) VALUES (:e, :o, 'refund', :now)");
        mark.bind(":e", externalId).bind(":o", orderId).bind(":now", nowMs());
        mark.exec();
        txn.commit();
        return Json{{"orderId", orderId}};
    });
}

}  // namespace pos::handlers
