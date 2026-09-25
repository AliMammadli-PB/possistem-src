#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/Pricing.hpp"

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

std::vector<std::string> modifierIdsFrom(const Json& payload) {
    std::vector<std::string> ids;
    if (!payload.contains("modifiers") || !payload["modifiers"].is_array()) return ids;

    for (const auto& entry : payload["modifiers"]) {
        if (entry.is_string()) {
            ids.push_back(entry.get<std::string>());
        } else if (entry.is_object() && entry.contains("modifierId")) {
            ids.push_back(entry["modifierId"].get<std::string>());
        }
    }
    return ids;
}

/** Fetches the order item and verifies it belongs to the given order. */
Json requireItem(Context& ctx, const std::string& orderId, const std::string& itemId) {
    auto stmt = ctx.db().prepare(
        "SELECT id, status, quantity, unit_price_minor, modifier_total_minor, complimentary "
        "FROM order_items WHERE id = :itemId AND order_id = :orderId");
    stmt.bind(":itemId", itemId).bind(":orderId", orderId);

    if (!stmt.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Order item was not found");
    }
    return stmt.row();
}

}  // namespace

void registerOrders(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // ------------------------------------------------------------------ create
    server.registerHandler(
        std::string(protocol::method::kOrdersCreate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.create");

            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            const auto guestCount = getOr<std::int64_t>(request.payload, "guestCount", 1);
            require(!tableId.empty(), "tableId is required");
            require(guestCount > 0 && guestCount <= 50, "guestCount must be between 1 and 50");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);

            db::Transaction txn(ctx->db());

            if (auto replay = idempotency.begin(request.idempotencyKey,
                                                std::string(protocol::method::kOrdersCreate),
                                                request.payload)) {
                // A create key belongs to one sitting. Once that bill has moved
                // to another table, been merged away or closed, replaying it
                // hands the waiter somebody else's bill to add items to - which
                // is exactly what happened after a transfer: reopening the now
                // empty table replayed the moved order, and everything added
                // landed on the other table's bill.
                const auto replayedId = [&replay] {
                    const auto it = replay->find("id");
                    return it != replay->end() && it->is_string() ? it->get<std::string>()
                                                                  : std::string();
                }();

                std::string liveTable;
                std::string liveStatus;
                if (!replayedId.empty()) {
                    auto live = ctx->db().prepare(
                        "SELECT COALESCE(table_id, ''), status FROM orders WHERE id = :id");
                    live.bind(":id", replayedId);
                    if (live.step()) {
                        liveTable = live.columnText(0);
                        liveStatus = live.columnText(1);
                    }
                }
                const bool stillOpen = liveStatus == "draft" || liveStatus == "open" ||
                                       liveStatus == "sent" || liveStatus == "partially_paid";
                if (liveTable != tableId || !stillOpen) {
                    throw PosError(std::string(protocol::err::kIdempotencyKeyReuse),
                                   "Bu masanın əvvəlki hesabı köçürülüb və ya bağlanıb - "
                                   "masanı yenidən açın");
                }
                txn.commit();
                return *replay;
            }

            auto table = ctx->db().prepare(
                "SELECT id, label FROM restaurant_tables WHERE id = :tableId AND active = 1");
            table.bind(":tableId", tableId);
            if (!table.step()) throw PosError::of(protocol::err::kTableNotFound);

            // Taking an order is what opens the till: after a Z close the next
            // order silently starts the new business day, so staff never press
            // an "open cash register" button.
            services::BusinessDayService days(*ctx);
            const std::string businessDayId = days.ensureOpenBusinessDayId();

            // Reopening the table's existing order is friendlier than an error:
            // two waiters tapping the same table should land in the same bill.
            if (const auto existing = orders.openOrderIdForTable(tableId); !existing.empty()) {
                // Rescues a bill left open across a Z close - without this it
                // would stay attached to the closed day and never reach a report.
                days.adoptOrderIntoDay(existing, businessDayId);

                Json order = orders.load(existing);
                idempotency.complete(request.idempotencyKey, order, "order", existing);
                txn.commit();
                return order;
            }

            const std::string orderId = crypto::uuid4();
            const std::string number = orders.nextOrderNumber();
            const auto now = nowMs();

            auto insert = ctx->db().prepare(
                "INSERT INTO orders (id, order_number, table_id, user_id, shift_id, status, "
                "                    guest_count, idempotency_key, business_day_id, "
                "                    opened_at, updated_at) "
                "VALUES (:id, :number, :tableId, :userId, :shiftId, 'draft', :guests, :key, "
                "        :day, :now, :now)");
            insert.bind(":id", orderId)
                .bind(":number", number)
                .bind(":tableId", tableId)
                .bind(":userId", ctx->session().userId)
                .bindOptional(":shiftId", ctx->session().shiftId)
                .bind(":guests", guestCount)
                .bindOptional(":key", request.idempotencyKey)
                .bind(":day", businessDayId)
                .bind(":now", now);
            insert.exec();

            orders.logEvent(orderId, "order.created", Json{{"tableId", tableId}});
            orders.refreshTableStatus(tableId);
            ctx->audit("order.create", "order", orderId,
                       Json{{"tableId", tableId}, {"guestCount", guestCount}});

            Json order = orders.load(orderId);
            idempotency.complete(request.idempotencyKey, order, "order", orderId);
            txn.commit();

            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"tableIds", {tableId}}});
            return order;
        });

    // --------------------------------------------------------------- read side
    server.registerHandler(
        std::string(protocol::method::kOrdersGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.view");
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            require(!orderId.empty(), "orderId is required");
            return services::OrderService(*ctx).load(orderId);
        });

    server.registerHandler(
        std::string(protocol::method::kOrdersList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.view");

            const auto status = getOr<std::string>(request.payload, "status", "");
            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            const auto limit = std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 50), 200);

            std::string sql =
                "SELECT o.id, o.order_number AS orderNumber, o.table_id AS tableId, "
                "       t.label AS tableLabel, u.full_name AS waiterName, o.status, "
                "       o.guest_count AS guestCount, o.total_minor AS totalMinor, "
                "       o.paid_minor AS paidMinor, o.opened_at AS openedAt, "
                "       o.submitted_at AS submittedAt, "
                "       (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id "
                "        AND i.status != 'voided') AS itemCount "
                "FROM orders o "
                "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
                "LEFT JOIN users u ON u.id = o.user_id WHERE 1=1";

            if (!status.empty()) sql += " AND o.status = :status";
            if (!tableId.empty()) sql += " AND o.table_id = :tableId";
            sql += " ORDER BY o.opened_at DESC LIMIT :limit";

            auto stmt = ctx->db().prepare(sql);
            if (!status.empty()) stmt.bind(":status", status);
            if (!tableId.empty()) stmt.bind(":tableId", tableId);
            stmt.bind(":limit", limit);

            return Json{{"orders", stmt.rows()}};
        });

    // ---------------------------------------------------------------- add item
    server.registerHandler(
        std::string(protocol::method::kOrdersAddItem), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.create");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto productId = getOr<std::string>(request.payload, "productId", "");
            const auto quantity = getOr<std::int64_t>(request.payload, "quantity", 1);
            const auto note = getOr<std::string>(request.payload, "note", "");

            require(!orderId.empty(), "orderId is required");
            require(!productId.empty(), "productId is required");
            require(quantity > 0 && quantity <= 99, "quantity must be between 1 and 99");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);

            db::Transaction txn(ctx->db());

            if (auto replay = idempotency.begin(request.idempotencyKey,
                                                std::string(protocol::method::kOrdersAddItem),
                                                request.payload)) {
                txn.commit();
                return *replay;
            }

            orders.requireEditable(orderId);

            auto product = ctx->db().prepare(
                "SELECT id, name_az, price_minor, available, sold_out, course, station "
                "FROM menu_items WHERE id = :productId AND active = 1");
            product.bind(":productId", productId);
            if (!product.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "Product was not found");
            }

            const std::string name = product.columnText(1);
            const Money unitPrice = product.columnInt(2);
            const bool available = product.columnInt(3) != 0;
            const bool soldOut = product.columnInt(4) != 0;
            const std::string defaultCourse = product.columnText(5);

            if (!available || soldOut) {
                throw PosError(std::string(protocol::err::kSoldOut), name + " is sold out");
            }

            // Server-authoritative modifier validation: required groups, min/max
            // and single-select are enforced here, not in the UI.
            const auto modifiers = orders.resolveModifiers(productId, modifierIdsFrom(request.payload));

            Money modifierDelta = 0;
            for (const auto& modifier : modifiers) modifierDelta += modifier.priceDelta;

            const auto now = nowMs();

            // Merge into an existing draft line with the same product, note and
            // modifiers so "Burger x4" appears instead of four separate lines.
            std::string mergedItemId;
            {
                auto existing = ctx->db().prepare(
                    "SELECT i.id, i.quantity FROM order_items i "
                    "WHERE i.order_id = :orderId AND i.product_id = :productId "
                    "  AND i.status = 'draft' AND i.note = :note");
                existing.bind(":orderId", orderId)
                    .bind(":productId", productId)
                    .bind(":note", note);

                // Build a sorted key from the incoming modifier ids for comparison.
                std::vector<std::string> incomingModIds;
                for (const auto& m : modifiers) incomingModIds.push_back(m.id);
                std::sort(incomingModIds.begin(), incomingModIds.end());

                while (existing.step()) {
                    const std::string candidateId = existing.columnText(0);
                    const std::int64_t existingQty = existing.columnInt(1);

                    auto mods = ctx->db().prepare(
                        "SELECT modifier_id FROM order_item_modifiers "
                        "WHERE order_item_id = :itemId ORDER BY modifier_id");
                    mods.bind(":itemId", candidateId);
                    std::vector<std::string> candidateModIds;
                    while (mods.step()) candidateModIds.push_back(mods.columnText(0));

                    if (candidateModIds == incomingModIds) {
                        const std::int64_t newQty = existingQty + quantity;
                        require(newQty <= 99, "quantity must be between 1 and 99");
                        const Money lineTotal = services::lineTotal(unitPrice, modifierDelta, newQty);

                        auto upd = ctx->db().prepare(
                            "UPDATE order_items SET quantity = :qty, "
                            "       modifier_total_minor = :modTotal, "
                            "       line_total_minor = :lineTotal, "
                            "       updated_at = :now WHERE id = :id");
                        upd.bind(":qty", newQty)
                            .bind(":modTotal", modifierDelta * newQty)
                            .bind(":lineTotal", lineTotal)
                            .bind(":now", now)
                            .bind(":id", candidateId);
                        upd.exec();
                        mergedItemId = candidateId;
                        break;
                    }
                }
            }

            std::string itemId;
            if (!mergedItemId.empty()) {
                itemId = mergedItemId;
            } else {
                auto seqStmt = ctx->db().prepare(
                    "SELECT COALESCE(MAX(line_seq), 0) + 1 FROM order_items WHERE order_id = :orderId");
                seqStmt.bind(":orderId", orderId);
                const std::int64_t lineSeq = seqStmt.step() ? seqStmt.columnInt(0) : 1;

                itemId = crypto::uuid4();
                const Money lineTotal = services::lineTotal(unitPrice, modifierDelta, quantity);

                auto insert = ctx->db().prepare(
                    "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
                    "        unit_price_minor, quantity, modifier_total_minor, line_total_minor, "
                    "        status, seat, course, note, created_at, updated_at) "
                    "VALUES (:id, :orderId, :productId, :seq, :name, :unitPrice, :quantity, "
                    "        :modifierTotal, :lineTotal, 'draft', :seat, :course, :note, :now, :now)");
                insert.bind(":id", itemId)
                    .bind(":orderId", orderId)
                    .bind(":productId", productId)
                    .bind(":seq", lineSeq)
                    .bind(":name", name)
                    .bind(":unitPrice", unitPrice)
                    .bind(":quantity", quantity)
                    .bind(":modifierTotal", modifierDelta * quantity)
                    .bind(":lineTotal", lineTotal)
                    .bind(":note", note)
                    .bind(":now", now);

                if (hasField(request.payload, "seat")) {
                    insert.bind(":seat", request.payload["seat"].get<std::int64_t>());
                } else {
                    insert.bind(":seat", nullptr);
                }
                insert.bind(":course", getOr<std::string>(request.payload, "course", defaultCourse));
                insert.exec();

                for (const auto& modifier : modifiers) {
                    auto link = ctx->db().prepare(
                        "INSERT INTO order_item_modifiers (id, order_item_id, modifier_id, "
                        "        group_name_snapshot, name_snapshot, price_delta_minor) "
                        "VALUES (:id, :itemId, :modifierId, :groupName, :name, :delta)");
                    link.bind(":id", crypto::uuid4())
                        .bind(":itemId", itemId)
                        .bind(":modifierId", modifier.id)
                        .bind(":groupName", modifier.groupName)
                        .bind(":name", modifier.name)
                        .bind(":delta", modifier.priceDelta);
                    link.exec();
                }
            }

            orders.recalculate(orderId);
            orders.logEvent(orderId, "item.added",
                            Json{{"itemId", itemId}, {"productId", productId}, {"quantity", quantity}});
            ctx->audit("order.addItem", "order_item", itemId,
                       Json{{"orderId", orderId},
                            {"productId", productId},
                            {"name", name},
                            {"quantity", quantity},
                            {"unitPriceMinor", unitPrice}});

            Json order = orders.load(orderId);
            idempotency.complete(request.idempotencyKey, order, "order", orderId);
            txn.commit();

            return order;
        });

    // ------------------------------------------------------------- edit an item
    server.registerHandler(
        std::string(protocol::method::kOrdersUpdateItemQuantity),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.create");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto itemId = getOr<std::string>(request.payload, "itemId", "");
            const auto quantity = getOr<std::int64_t>(request.payload, "quantity", 1);
            require(quantity > 0 && quantity <= 99, "quantity must be between 1 and 99");

            services::OrderService orders(*ctx);
            db::Transaction txn(ctx->db());

            orders.requireEditable(orderId);
            Json item = requireItem(*ctx, orderId, itemId);

            if (item.value("status", "") == "voided") {
                throw PosError(std::string(protocol::err::kOrderState),
                               "A voided item cannot be changed");
            }

            const Money unitPrice = item.value("unit_price_minor", 0);
            const std::int64_t oldQuantity = std::max<std::int64_t>(1, item.value("quantity", 1));
            const Money perUnitModifier = item.value("modifier_total_minor", 0) / oldQuantity;

            auto update = ctx->db().prepare(
                "UPDATE order_items SET quantity = :quantity, "
                "       modifier_total_minor = :modifierTotal, line_total_minor = :lineTotal, "
                "       updated_at = :now WHERE id = :itemId");
            update.bind(":quantity", quantity)
                .bind(":modifierTotal", perUnitModifier * quantity)
                .bind(":lineTotal", services::lineTotal(unitPrice, perUnitModifier, quantity))
                .bind(":now", nowMs())
                .bind(":itemId", itemId);
            update.exec();

            orders.recalculate(orderId);
            orders.logEvent(orderId, "item.quantity",
                            Json{{"itemId", itemId}, {"quantity", quantity}});
            // Both quantities, because "it was two, now it is one" is the whole
            // question when a bill is disputed.
            ctx->audit("order.updateItemQuantity", "order_item", itemId,
                       Json{{"orderId", orderId},
                            {"name", item.value("name_snapshot", "")},
                            {"from", oldQuantity},
                            {"to", quantity}});

            Json order = orders.load(orderId);
            txn.commit();
            return order;
        });

    const auto simpleItemUpdate = [ctx](const char* method, const char* sql,
                                        const char* eventName,
                                        std::function<void(db::Statement&, const Json&)> bindValue) {
        ctx->server().registerHandler(
            method, [ctx, sql, eventName, bindValue](const ipc::Request& request) {
                ctx->requirePermission("order.create");

                const auto orderId = getOr<std::string>(request.payload, "orderId", "");
                const auto itemId = getOr<std::string>(request.payload, "itemId", "");

                services::OrderService orders(*ctx);
                db::Transaction txn(ctx->db());

                orders.requireEditable(orderId);
                requireItem(*ctx, orderId, itemId);

                auto stmt = ctx->db().prepare(sql);
                bindValue(stmt, request.payload);
                stmt.bind(":now", nowMs()).bind(":itemId", itemId);
                stmt.exec();

                orders.logEvent(orderId, eventName, Json{{"itemId", itemId}});
                Json order = orders.load(orderId);
                txn.commit();
                return order;
            });
    };

    simpleItemUpdate(
        "orders.setItemNote",
        "UPDATE order_items SET note = :note, updated_at = :now WHERE id = :itemId",
        "item.note",
        [](db::Statement& stmt, const Json& payload) {
            stmt.bind(":note", getOr<std::string>(payload, "note", ""));
        });

    simpleItemUpdate(
        "orders.setItemSeat",
        "UPDATE order_items SET seat = :seat, updated_at = :now WHERE id = :itemId",
        "item.seat",
        [](db::Statement& stmt, const Json& payload) {
            if (hasField(payload, "seat")) stmt.bind(":seat", payload["seat"].get<std::int64_t>());
            else stmt.bind(":seat", nullptr);
        });

    simpleItemUpdate(
        "orders.setItemCourse",
        "UPDATE order_items SET course = :course, updated_at = :now WHERE id = :itemId",
        "item.course",
        [](db::Statement& stmt, const Json& payload) {
            const auto course = getOr<std::string>(payload, "course", "");
            if (course.empty()) stmt.bind(":course", nullptr);
            else stmt.bind(":course", course);
        });

    simpleItemUpdate(
        "orders.holdItem",
        "UPDATE order_items SET held = :held, status = CASE WHEN :held = 1 THEN 'held' "
        "       ELSE 'draft' END, updated_at = :now WHERE id = :itemId",
        "item.hold",
        [](db::Statement& stmt, const Json& payload) {
            stmt.bind(":held", getOr<bool>(payload, "held", true));
        });

    // ------------------------------------------------------------- remove/void
    server.registerHandler(
        std::string(protocol::method::kOrdersRemoveItem), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.create");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto itemId = getOr<std::string>(request.payload, "itemId", "");

            services::OrderService orders(*ctx);
            db::Transaction txn(ctx->db());

            orders.requireEditable(orderId);
            Json item = requireItem(*ctx, orderId, itemId);

            // Once a line has gone to the kitchen the food exists; removing it
            // silently would lose the cost. That path requires a manager void.
            if (item.value("status", "") != "draft") {
                throw PosError(std::string(protocol::err::kOrderState),
                               "This item has already been sent to the kitchen. Use void instead.");
            }

            auto remove = ctx->db().prepare("DELETE FROM order_items WHERE id = :itemId");
            remove.bind(":itemId", itemId);
            remove.exec();

            orders.recalculate(orderId);
            orders.logEvent(orderId, "item.removed", Json{{"itemId", itemId}});
            // The row is gone, so the audit entry is the only surviving record of
            // what was on the order and for how much.
            ctx->audit("order.removeItem", "order_item", itemId,
                       Json{{"orderId", orderId},
                            {"name", item.value("name_snapshot", "")},
                            {"quantity", item.value("quantity", 0)},
                            {"lineTotalMinor", item.value("line_total_minor", 0)}});

            Json order = orders.load(orderId);
            txn.commit();
            return order;
        });

    server.registerHandler(
        std::string(protocol::method::kOrdersVoidItem), [ctx](const ipc::Request& request) {
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto itemId = getOr<std::string>(request.payload, "itemId", "");
            const auto reason = getOr<std::string>(request.payload, "reason", "");
            const auto managerPin = getOr<std::string>(request.payload, "managerPin", "");

            require(!reason.empty(), "A reason is required to void an item");

            const std::string approver =
                ctx->requireManagerApproval("order.void", managerPin, "order.voidItem");

            services::OrderService orders(*ctx);
            db::Transaction txn(ctx->db());

            orders.requireEditable(orderId);
            requireItem(*ctx, orderId, itemId);

            auto update = ctx->db().prepare(
                "UPDATE order_items SET status = 'voided', void_reason = :reason, "
                "       voided_by = :approver, updated_at = :now WHERE id = :itemId");
            update.bind(":reason", reason)
                .bind(":approver", approver)
                .bind(":now", nowMs())
                .bind(":itemId", itemId);
            update.exec();

            // Pull the matching kitchen ticket so the pass stops making it.
            auto cancelJob = ctx->db().prepare(
                "UPDATE kitchen_jobs SET status = 'completed', completed_at = :now "
                "WHERE order_item_id = :itemId AND status != 'completed'");
            cancelJob.bind(":now", nowMs()).bind(":itemId", itemId);
            cancelJob.exec();

            orders.recalculate(orderId);
            orders.logEvent(orderId, "item.voided",
                            Json{{"itemId", itemId}, {"reason", reason}, {"approvedBy", approver}});
            ctx->audit("order.void_item", "order_item", itemId,
                       Json{{"orderId", orderId}, {"reason", reason}}, approver);

            Json order = orders.load(orderId);
            txn.commit();

            ctx->server().emitEvent(protocol::event::kKdsUpdated, Json{{"orderIds", {orderId}}});
            return order;
        });

    // ----------------------------------------------------------- discount etc.
    server.registerHandler(
        std::string(protocol::method::kOrdersApplyDiscount), [ctx](const ipc::Request& request) {
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            auto type = getOr<std::string>(request.payload, "type", "");
            auto value = getOr<std::int64_t>(request.payload, "value", 0);
            const auto reason = getOr<std::string>(request.payload, "reason", "");
            const auto managerPin = getOr<std::string>(request.payload, "managerPin", "");
            const bool hasTarget = request.payload.contains("targetTotalMinor") &&
                                   !request.payload["targetTotalMinor"].is_null();
            const auto targetTotal =
                hasTarget ? getOr<std::int64_t>(request.payload, "targetTotalMinor", 0) : Money{0};

            require(type == "percent" || type == "amount" || type == "complimentary" ||
                        type == "target" || type.empty(),
                    "Unsupported discount type");
            if (type == "percent") require(value >= 0 && value <= 100, "Percent must be 0-100");

            const std::string approver =
                ctx->requireManagerApproval("order.discount", managerPin, "order.applyDiscount");

            services::OrderService orders(*ctx);
            db::Transaction txn(ctx->db());
            Json editable = orders.requireEditable(orderId);

            if (hasTarget || type == "target") {
                const Money subtotal = editable.value("subtotalMinor", Money{0});
                const Money paid = editable.value("paidMinor", Money{0});
                require(targetTotal >= paid, "Target cannot be below amount already paid");
                value = services::amountDiscountForTarget(subtotal, targetTotal, orders.taxConfig());
                type = value > 0 ? "amount" : "";
            }

            auto update = ctx->db().prepare(
                "UPDATE orders SET discount_type = :type, discount_value = :value, "
                "       discount_reason = :reason, discount_by = :approver, updated_at = :now "
                "WHERE id = :orderId");
            if (type.empty()) update.bind(":type", nullptr);
            else update.bind(":type", type);
            update.bind(":value", value)
                .bind(":reason", reason)
                .bind(":approver", approver)
                .bind(":now", nowMs())
                .bind(":orderId", orderId);
            update.exec();

            const auto totals = orders.recalculate(orderId);
            orders.logEvent(orderId, "order.discount",
                            Json{{"type", type}, {"value", value}, {"reason", reason}});
            ctx->audit("order.discount", "order", orderId,
                       Json{{"type", type},
                            {"value", value},
                            {"reason", reason},
                            {"discountMinor", totals.discount}},
                       approver);

            Json order = orders.load(orderId);
            txn.commit();
            ctx->server().emitEvent(protocol::event::kOrdersUpdated, Json{{"orderIds", {orderId}}});
            return order;
        });

    server.registerHandler(
        std::string(protocol::method::kOrdersSetDeposit), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.take");
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const Money deposit = getOr<Money>(request.payload, "depositMinor", 0);
            require(!orderId.empty(), "orderId is required");
            require(deposit >= 0, "depositMinor must be >= 0");
            require(deposit <= Money{100000000}, "depositMinor is too large");

            services::OrderService orders(*ctx);
            db::Transaction txn(ctx->db());
            const Json editable = orders.requireEditable(orderId);

            auto update = ctx->db().prepare(
                "UPDATE orders SET deposit_minor = :deposit, updated_at = :now "
                "WHERE id = :orderId");
            update.bind(":deposit", deposit)
                .bind(":now", nowMs())
                .bind(":orderId", orderId);
            update.exec();

            const auto totals = orders.recalculate(orderId);
            const Money paid = editable.value("paidMinor", Money{0});
            require(totals.total >= paid,
                    "Deposit change cannot reduce total below the paid amount");

            orders.logEvent(orderId, "order.deposit", Json{{"depositMinor", deposit}});
            ctx->audit("order.deposit", "order", orderId,
                       Json{{"depositMinor", deposit}, {"totalMinor", totals.total}});

            Json order = orders.load(orderId);
            txn.commit();
            ctx->server().emitEvent(protocol::event::kOrdersUpdated,
                                    Json{{"orderIds", {orderId}}});
            return order;
        });

    server.registerHandler(
        std::string(protocol::method::kOrdersSetGuestCount), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.create");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto guestCount = getOr<std::int64_t>(request.payload, "guestCount", 1);
            require(guestCount > 0 && guestCount <= 50, "guestCount must be between 1 and 50");

            services::OrderService orders(*ctx);
            db::Transaction txn(ctx->db());
            orders.requireEditable(orderId);

            auto before = ctx->db().prepare("SELECT guest_count FROM orders WHERE id = :orderId");
            before.bind(":orderId", orderId);
            const std::int64_t previous = before.step() ? before.columnInt(0) : 0;

            auto update = ctx->db().prepare(
                "UPDATE orders SET guest_count = :guests, updated_at = :now WHERE id = :orderId");
            update.bind(":guests", guestCount).bind(":now", nowMs()).bind(":orderId", orderId);
            update.exec();

            // Guest count drives the service charge and the per-head figures in
            // the Z report, so an edit to it moves money.
            ctx->audit("order.setGuestCount", "order", orderId,
                       Json{{"from", previous}, {"to", guestCount}});

            Json order = orders.load(orderId);
            txn.commit();
            return order;
        });

    // ------------------------------------------------------------------ submit
    //
    // The atomic heart of the system. Order changes, kitchen jobs, the print
    // job, the sync outbox entry and the audit record all land in ONE
    // transaction: either the kitchen has the ticket and the bill reflects it,
    // or nothing happened at all. The response is only produced after COMMIT
    // returns, so the UI can never show "sent" for work that was rolled back.
    server.registerHandler(
        std::string(protocol::method::kOrdersSubmit), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.create");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            require(!orderId.empty(), "orderId is required");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);

            std::string tableId;
            Json result;

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kOrdersSubmit),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                Json order = orders.requireEditable(orderId);
                tableId = (order["tableId"].is_string() ? order["tableId"].get<std::string>() : std::string{});

                auto pending = ctx->db().prepare(
                    "SELECT id, product_id, name_snapshot, quantity, course "
                    "FROM order_items WHERE order_id = :orderId AND status = 'draft' "
                    "ORDER BY line_seq");
                pending.bind(":orderId", orderId);

                struct PendingLine {
                    std::string id;
                    std::string productId;
                    std::string name;
                    std::string course;
                };
                std::vector<PendingLine> lines;
                while (pending.step()) {
                    lines.push_back({pending.columnText(0), pending.columnText(1),
                                     pending.columnText(2), pending.columnText(4)});
                }

                if (lines.empty()) {
                    throw PosError(std::string(protocol::err::kOrderEmpty),
                                   "There are no new items to send to the kitchen");
                }

                const auto now = nowMs();

                for (const auto& line : lines) {
                    auto markSent = ctx->db().prepare(
                        "UPDATE order_items SET status = 'sent', sent_at = :now, updated_at = :now "
                        "WHERE id = :itemId");
                    markSent.bind(":now", now).bind(":itemId", line.id);
                    markSent.exec();

                    auto station = ctx->db().prepare(
                        "SELECT station, prep_minutes FROM menu_items WHERE id = :productId");
                    station.bind(":productId", line.productId);
                    std::string stationName = "kitchen";
                    std::int64_t prepMinutes = 15;
                    if (station.step()) {
                        stationName = station.columnText(0);
                        prepMinutes = station.columnInt(1);
                    }

                    auto job = ctx->db().prepare(
                        "INSERT INTO kitchen_jobs (id, order_id, order_item_id, station, status, "
                        "        course, created_at, target_minutes) "
                        "VALUES (:id, :orderId, :itemId, :station, 'new', :course, :now, :target)");
                    job.bind(":id", crypto::uuid4())
                        .bind(":orderId", orderId)
                        .bind(":itemId", line.id)
                        .bind(":station", stationName)
                        .bindOptional(":course", line.course)
                        .bind(":now", now)
                        .bind(":target", prepMinutes);
                    job.exec();
                }

                auto updateOrder = ctx->db().prepare(
                    "UPDATE orders SET status = 'sent', "
                    "       submitted_at = COALESCE(submitted_at, :now), updated_at = :now "
                    "WHERE id = :orderId");
                updateOrder.bind(":now", now).bind(":orderId", orderId);
                updateOrder.exec();

                // The kitchen ticket is queued inside the same transaction, so a
                // printer outage can never lose an order that the guest was told
                // had been sent.
                auto printJob = ctx->db().prepare(
                    "INSERT INTO print_jobs (id, order_id, kind, target_printer, status, "
                    "        next_attempt_at, created_at, updated_at) "
                    "VALUES (:id, :orderId, 'kitchen_ticket', :printer, 'queued', :now, :now, :now)");
                printJob.bind(":id", crypto::uuid4())
                    .bind(":orderId", orderId)
                    // `auto` rather than `virtual`: an unconfigured kitchen used
                    // to spool the ticket to a text file and report success, so
                    // the kitchen simply never got the order.
                    .bind(":printer", ctx->setting("printer.kitchen", "auto"))
                    .bind(":now", now);
                printJob.exec();

                orders.recalculate(orderId);
                orders.refreshTableStatus(tableId);
                orders.logEvent(orderId, "order.submitted",
                                Json{{"itemCount", static_cast<std::int64_t>(lines.size())}});
                ctx->enqueueSync("order", orderId, "update", Json{{"status", "sent"}});
                ctx->audit("order.submit", "order", orderId,
                           Json{{"itemCount", static_cast<std::int64_t>(lines.size())}});

                result = orders.load(orderId);
                idempotency.complete(request.idempotencyKey, result, "order", orderId);

                txn.commit();
            }

            // Only after the commit is durable do the other screens hear about it.
            ctx->server().emitEvent(protocol::event::kKdsUpdated, Json{{"orderIds", {orderId}}});
            ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"orderId", orderId}});
            if (!tableId.empty()) {
                ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                        Json{{"tableIds", {tableId}}});
            }

            logger()->info("order {} submitted", orderId);
            return result;
        });

    // ------------------------------------------------------------- close/void
    server.registerHandler(
        std::string(protocol::method::kOrdersClose), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);

            std::string tableId;
            Json result;

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kOrdersClose),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                Json order = orders.load(orderId, false);
                tableId = (order["tableId"].is_string() ? order["tableId"].get<std::string>() : std::string{});

                if (order.value("status", "") == "closed") {
                    txn.commit();
                    return order;
                }

                // An unresolved card result means the money may or may not have
                // moved. Closing here would strand it, so it is blocked until a
                // human reconciles.
                auto unknown = ctx->db().prepare(
                    "SELECT COUNT(*) FROM payments WHERE order_id = :orderId AND status = 'unknown'");
                unknown.bind(":orderId", orderId);
                if (unknown.step() && unknown.columnInt(0) > 0) {
                    throw PosError::of(protocol::err::kPaymentUnknownPending);
                }

                const auto totals = orders.recalculate(orderId);
                Json refreshed = orders.load(orderId, false);
                const Money paid = refreshed.value("paidMinor", 0);

                if (paid < totals.total) {
                    throw PosError(std::string(protocol::err::kInsufficientPayment),
                                   "Outstanding balance remains on this order");
                }

                // A different waiter's order needs manager rights to close.
                if ((order["userId"].is_string() ? order["userId"].get<std::string>() : std::string{}) != ctx->session().userId) {
                    ctx->requirePermission("order.closeOther");
                }

                const auto now = nowMs();
                auto update = ctx->db().prepare(
                    "UPDATE orders SET status = 'closed', closed_at = :now, updated_at = :now "
                    "WHERE id = :orderId");
                update.bind(":now", now).bind(":orderId", orderId);
                update.exec();

                // Settling the bill is when its dishes actually leave the store.
                // Deliberately not at send time: a sent item can still be voided,
                // and stock that moved on a voided line would need putting back,
                // which is bookkeeping nobody would trust. Dishes with no recipe
                // consume nothing, so a venue that never set one up is unaffected.
                services::InventoryService(*ctx).consumeOnClose(orderId);

                if (!tableId.empty()) {
                    // Free the table immediately — no intermediate "cleaning" state.
                    auto table = ctx->db().prepare(
                        "UPDATE restaurant_tables SET status = 'available', updated_at = :now "
                        "WHERE id = :tableId");
                    table.bind(":now", now).bind(":tableId", tableId);
                    table.exec();

                    // Settling the bill releases the merge: any table folded into
                    // this one stops being visually attached to it. This is the
                    // single point where merged_into_id is cleared.
                    auto unmerge = ctx->db().prepare(
                        "UPDATE restaurant_tables SET merged_into_id = NULL, updated_at = :now, "
                        "       row_version = row_version + 1 WHERE merged_into_id = :tableId");
                    unmerge.bind(":now", now).bind(":tableId", tableId);
                    unmerge.exec();
                }

                orders.logEvent(orderId, "order.closed", Json{{"totalMinor", totals.total}});
                ctx->enqueueSync("order", orderId, "update", Json{{"status", "closed"}});
                ctx->audit("order.close", "order", orderId, Json{{"totalMinor", totals.total}});

                result = orders.load(orderId);
                idempotency.complete(request.idempotencyKey, result, "order", orderId);
                txn.commit();
            }

            if (!tableId.empty()) {
                ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                        Json{{"tableIds", {tableId}}});
            }
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kOrdersVoid), [ctx](const ipc::Request& request) {
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto reason = getOr<std::string>(request.payload, "reason", "");
            const auto managerPin = getOr<std::string>(request.payload, "managerPin", "");
            require(!reason.empty(), "A reason is required to void an order");

            const std::string approver =
                ctx->requireManagerApproval("order.void", managerPin, "orders.void");

            services::OrderService orders(*ctx);
            std::string tableId;
            Json result;

            {
                db::Transaction txn(ctx->db());

                Json order = orders.requireEditable(orderId);
                tableId = (order["tableId"].is_string() ? order["tableId"].get<std::string>() : std::string{});

                auto paid = ctx->db().prepare(
                    "SELECT COUNT(*) FROM payments WHERE order_id = :orderId AND status = 'approved'");
                paid.bind(":orderId", orderId);
                if (paid.step() && paid.columnInt(0) > 0) {
                    throw PosError(std::string(protocol::err::kOrderState),
                                   "This order has approved payments and must be refunded, not voided");
                }

                const auto now = nowMs();

                auto update = ctx->db().prepare(
                    "UPDATE orders SET status = 'voided', void_reason = :reason, closed_at = :now, "
                    "       updated_at = :now WHERE id = :orderId");
                update.bind(":reason", reason).bind(":now", now).bind(":orderId", orderId);
                update.exec();

                auto items = ctx->db().prepare(
                    "UPDATE order_items SET status = 'voided', void_reason = :reason, "
                    "       voided_by = :approver, updated_at = :now WHERE order_id = :orderId");
                items.bind(":reason", reason)
                    .bind(":approver", approver)
                    .bind(":now", now)
                    .bind(":orderId", orderId);
                items.exec();

                auto jobs = ctx->db().prepare(
                    "UPDATE kitchen_jobs SET status = 'completed', completed_at = :now "
                    "WHERE order_id = :orderId AND status != 'completed'");
                jobs.bind(":now", now).bind(":orderId", orderId);
                jobs.exec();

                orders.recalculate(orderId);
                orders.refreshTableStatus(tableId);
                orders.logEvent(orderId, "order.voided", Json{{"reason", reason}});
                ctx->audit("order.void", "order", orderId, Json{{"reason", reason}}, approver);

                result = orders.load(orderId);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kKdsUpdated, Json{{"orderIds", {orderId}}});
            if (!tableId.empty()) {
                ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                        Json{{"tableIds", {tableId}}});
            }
            return result;
        });
}

}  // namespace pos::handlers
