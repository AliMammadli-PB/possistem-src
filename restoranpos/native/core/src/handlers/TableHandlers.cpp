#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/TableTransferService.hpp"

namespace pos::handlers {
namespace {

/**
 * Tables joined to their live order.
 *
 * The floor map needs cover count, waiter, running total and elapsed time in a
 * single round trip - fetching per table would make the map crawl.
 */
constexpr const char* kTableQuery =
    "SELECT t.id, t.area_id AS areaId, a.name_az AS areaName, t.label, t.seats, t.status, "
    "       t.pos_x AS posX, t.pos_y AS posY, t.width, t.height, t.shape, "
    "       t.merged_into_id AS mergedIntoId, t.sort_order AS sortOrder, "
    "       o.id AS orderId, o.order_number AS orderNumber, o.guest_count AS guestCount, "
    "       o.total_minor AS totalMinor, o.paid_minor AS paidMinor, o.status AS orderStatus, "
    "       o.opened_at AS openedAt, u.full_name AS waiterName, u.color AS waiterColor, "
    "       (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id "
    "        AND i.status != 'voided') AS itemCount, "
    // The floor plan colours a table green once the guest has been handed their
    // bill. Nothing recorded that before; the print queue already does, so the
    // answer is a lookup rather than another column to keep in step. Any job
    // counts, queued included - the waiter pressing the button is the event,
    // not the paper coming out.
    "       EXISTS (SELECT 1 FROM print_jobs pj WHERE pj.order_id = o.id "
    "               AND pj.kind = 'customer_bill') AS billPrinted "
    "FROM restaurant_tables t "
    "JOIN restaurant_areas a ON a.id = t.area_id "
    "LEFT JOIN orders o ON o.table_id = t.id "
    "     AND o.status IN ('draft','open','sent','partially_paid') "
    "LEFT JOIN users u ON u.id = o.user_id "
    "WHERE t.active = 1 ";

}  // namespace

void registerTables(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(std::string(protocol::method::kTablesList), [ctx](const ipc::Request&) {
        ctx->requireAuth();

        auto areas = ctx->db().prepare(
            "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, "
            "       sort_order AS sortOrder FROM restaurant_areas WHERE active = 1 "
            "ORDER BY sort_order");

        auto tables = ctx->db().prepare(std::string(kTableQuery) + "ORDER BY t.sort_order");

        return Json{{"areas", areas.rows()}, {"tables", tables.rows()}, {"serverTime", nowMs()}};
    });

    server.registerHandler(
        std::string(protocol::method::kTablesGet), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            require(!tableId.empty(), "tableId is required");

            auto stmt = ctx->db().prepare(std::string(kTableQuery) + "AND t.id = :tableId");
            stmt.bind(":tableId", tableId);
            if (!stmt.step()) throw PosError::of(protocol::err::kTableNotFound);

            return stmt.row();
        });

    server.registerHandler(
        std::string(protocol::method::kTablesSetStatus), [ctx](const ipc::Request& request) {
            ctx->requirePermission("tables.status");

            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            const auto status = getOr<std::string>(request.payload, "status", "");

            protocol::TableStatus parsed{};
            if (!protocol::parseTableStatus(status, parsed)) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Unknown table status: " + status);
            }

            db::Transaction txn(ctx->db());
            const auto now = nowMs();

            // Setting a table to "available" means the table is free — void any
            // unpaid order sitting on it so stale items don't linger.
            std::string voidedOrderId;
            if (parsed == protocol::TableStatus::Available) {
                services::OrderService orders(*ctx);
                const std::string orderId = orders.openOrderIdForTable(tableId);

                if (!orderId.empty()) {
                    auto paid = ctx->db().prepare(
                        "SELECT COUNT(*) FROM payments WHERE order_id = :oid AND status = 'approved'");
                    paid.bind(":oid", orderId);
                    if (paid.step() && paid.columnInt(0) > 0) {
                        throw PosError(std::string(protocol::err::kConflict),
                                       "Table has a paid order; close it from the payment screen");
                    }

                    auto upd = ctx->db().prepare(
                        "UPDATE orders SET status = 'voided', void_reason = 'table_cleared', "
                        "       closed_at = :now, updated_at = :now WHERE id = :oid");
                    upd.bind(":now", now).bind(":oid", orderId);
                    upd.exec();

                    auto items = ctx->db().prepare(
                        "UPDATE order_items SET status = 'voided', void_reason = 'table_cleared', "
                        "       updated_at = :now WHERE order_id = :oid");
                    items.bind(":now", now).bind(":oid", orderId);
                    items.exec();

                    auto jobs = ctx->db().prepare(
                        "UPDATE kitchen_jobs SET status = 'completed', completed_at = :now "
                        "WHERE order_id = :oid AND status != 'completed'");
                    jobs.bind(":now", now).bind(":oid", orderId);
                    jobs.exec();

                    orders.recalculate(orderId);
                    orders.logEvent(orderId, "order.voided", Json{{"reason", "table_cleared"}});
                    ctx->audit("order.void", "order", orderId, Json{{"reason", "table_cleared"}});
                    ctx->enqueueSync("order", orderId, "update", Json{{"status", "voided"}});
                    voidedOrderId = orderId;
                }
            }

            auto update = ctx->db().prepare(
                "UPDATE restaurant_tables SET status = :status, updated_at = :now "
                "WHERE id = :tableId AND active = 1");
            update.bind(":status", status).bind(":now", now).bind(":tableId", tableId);
            update.exec();

            if (ctx->db().changes() == 0) throw PosError::of(protocol::err::kTableNotFound);

            ctx->audit("table.status", "table", tableId, Json{{"status", status}});
            txn.commit();

            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"tableIds", {tableId}}});
            if (!voidedOrderId.empty()) {
                ctx->server().emitEvent(protocol::event::kKdsUpdated,
                                        Json{{"orderIds", {voidedOrderId}}});
            }
            return Json{{"tableId", tableId}, {"status", status}};
        });

    // ---------------------------------------------------------------- transfer
    server.registerHandler(
        std::string(protocol::method::kTablesTransfer), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.transfer");

            const auto fromTableId = getOr<std::string>(request.payload, "fromTableId", "");
            const auto toTableId = getOr<std::string>(request.payload, "toTableId", "");
            require(!fromTableId.empty() && !toTableId.empty(), "Both tables are required");
            require(fromTableId != toTableId, "Choose a different destination table");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);
            Json result;

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kTablesTransfer),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                // Checked inside the transaction so the read and the write share
                // one BEGIN IMMEDIATE - outside it this would be a TOCTOU and
                // the stale-version guard would be decorative.
                const auto expectedFrom =
                    getOr<std::int64_t>(request.payload, "expectedFromVersion", -1);
                const auto expectedTo =
                    getOr<std::int64_t>(request.payload, "expectedToVersion", -1);

                const auto versionOf = [&](const std::string& tableId) {
                    auto stmt = ctx->db().prepare(
                        "SELECT row_version FROM restaurant_tables WHERE id = :id");
                    stmt.bind(":id", tableId);
                    if (!stmt.step()) throw PosError::of(protocol::err::kTableNotFound);
                    return stmt.columnInt(0);
                };

                if (expectedFrom >= 0 && versionOf(fromTableId) != expectedFrom) {
                    throw PosError(std::string(protocol::err::kStaleVersion),
                                   "Source table was modified by another operator");
                }
                if (expectedTo >= 0 && versionOf(toTableId) != expectedTo) {
                    throw PosError(std::string(protocol::err::kStaleVersion),
                                   "Destination table was modified by another operator");
                }

                const std::string orderId = orders.openOrderIdForTable(fromTableId);
                if (orderId.empty()) {
                    throw PosError(std::string(protocol::err::kOrderNotFound),
                                   "There is no open order on that table");
                }
                if (!orders.openOrderIdForTable(toTableId).empty()) {
                    throw PosError::of(protocol::err::kTableOccupied);
                }

                auto move = ctx->db().prepare(
                    "UPDATE orders SET table_id = :toTable, updated_at = :now, "
                    "row_version = row_version + 1 WHERE id = :orderId");
                move.bind(":toTable", toTableId).bind(":now", nowMs()).bind(":orderId", orderId);
                move.exec();

                auto bumpTables = ctx->db().prepare(
                    "UPDATE restaurant_tables SET row_version = row_version + 1, updated_at = :now "
                    "WHERE id IN (:fromTable, :toTable)");
                bumpTables.bind(":now", nowMs())
                    .bind(":fromTable", fromTableId)
                    .bind(":toTable", toTableId);
                bumpTables.exec();

                orders.refreshTableStatus(fromTableId);
                orders.refreshTableStatus(toTableId);
                orders.logEvent(orderId, "order.transferred",
                                Json{{"from", fromTableId}, {"to", toTableId}});
                ctx->audit("table.transfer", "order", orderId,
                           Json{{"from", fromTableId}, {"to", toTableId}});

                auto event = ctx->db().prepare(
                    "INSERT INTO table_transfer_events ("
                    "  id, operation, source_table_id, target_table_id, source_order_id,"
                    "  actor_user_id, idempotency_key, request_json, result_json, created_at"
                    ") VALUES (:id, 'move', :from, :to, :order, :actor, :key, :req, '{}', :now)");
                event.bind(":id", crypto::uuid4())
                    .bind(":from", fromTableId)
                    .bind(":to", toTableId)
                    .bind(":order", orderId)
                    .bindOptional(":actor", ctx->session().userId)
                    .bindOptional(":key", request.idempotencyKey)
                    .bind(":req", serialize(request.payload))
                    .bind(":now", nowMs());
                event.exec();

                result = orders.load(orderId);
                idempotency.complete(request.idempotencyKey, result, "order", orderId);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                    Json{{"tableIds", {fromTableId, toTableId}}});
            return result;
        });

    // ------------------------------------------------------------------- merge
    server.registerHandler(
        std::string(protocol::method::kTablesMerge), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.transfer");

            const auto targetTableId = getOr<std::string>(request.payload, "targetTableId", "");
            require(!targetTableId.empty(), "targetTableId is required");

            std::vector<std::string> sources;
            if (request.payload.contains("sourceTableIds") &&
                request.payload["sourceTableIds"].is_array()) {
                for (const auto& id : request.payload["sourceTableIds"]) {
                    if (id.is_string()) sources.push_back(id.get<std::string>());
                }
            }
            require(!sources.empty(), "Select at least one table to merge");

            services::Idempotency idempotency(*ctx);
            Json result;
            std::vector<std::string> touched{targetTableId};

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kTablesMerge),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                result = services::TableTransferService(*ctx).mergeTables(
                    targetTableId, sources,
                    getOr<std::int64_t>(request.payload, "expectedFromVersion", -1),
                    getOr<std::int64_t>(request.payload, "expectedToVersion", -1),
                    request.idempotencyKey);

                if (result.contains("touchedTableIds") && result["touchedTableIds"].is_array()) {
                    touched = result["touchedTableIds"].get<std::vector<std::string>>();
                }

                idempotency.complete(request.idempotencyKey, result, "order", targetTableId);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"tableIds", touched}});
            return result;
        });

    // ------------------------------------------------------------------- split
    server.registerHandler(
        std::string(protocol::method::kTablesSplit), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.transfer");

            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            const auto toTableId = getOr<std::string>(request.payload, "toTableId", "");
            require(!tableId.empty() && !toTableId.empty(), "Both tables are required");
            require(tableId != toTableId, "Choose a different destination table");

            std::vector<std::string> itemIds;
            if (request.payload.contains("itemIds") && request.payload["itemIds"].is_array()) {
                for (const auto& id : request.payload["itemIds"]) {
                    if (id.is_string()) itemIds.push_back(id.get<std::string>());
                }
            }
            require(!itemIds.empty(), "Select at least one item to move");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);
            Json result;

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kTablesSplit),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                const std::string sourceOrderId = orders.openOrderIdForTable(tableId);
                if (sourceOrderId.empty()) throw PosError::of(protocol::err::kOrderNotFound);

                // The destination may already have a bill (splitting onto an
                // occupied table) or need a fresh one.
                std::string targetOrderId = orders.openOrderIdForTable(toTableId);
                const auto now = nowMs();

                if (targetOrderId.empty()) {
                    targetOrderId = crypto::uuid4();
                    auto insert = ctx->db().prepare(
                        "INSERT INTO orders (id, order_number, table_id, user_id, shift_id, status, "
                        "                    guest_count, business_day_id, opened_at, updated_at) "
                        "VALUES (:id, :number, :tableId, :userId, :shiftId, 'open', 1, :day, "
                        "        :now, :now)");
                    insert.bind(":id", targetOrderId)
                        .bind(":number", orders.nextOrderNumber())
                        .bind(":tableId", toTableId)
                        .bind(":userId", ctx->session().userId)
                        .bindOptional(":shiftId", ctx->session().shiftId)
                        .bind(":day", services::BusinessDayService(*ctx).ensureOpenBusinessDayId())
                        .bind(":now", now);
                    insert.exec();
                }

                auto seqStmt = ctx->db().prepare(
                    "SELECT COALESCE(MAX(line_seq), 0) FROM order_items WHERE order_id = :orderId");
                seqStmt.bind(":orderId", targetOrderId);
                std::int64_t nextSeq = seqStmt.step() ? seqStmt.columnInt(0) : 0;

                for (const auto& itemId : itemIds) {
                    auto verify = ctx->db().prepare(
                        "SELECT id FROM order_items WHERE id = :itemId AND order_id = :orderId");
                    verify.bind(":itemId", itemId).bind(":orderId", sourceOrderId);
                    if (!verify.step()) {
                        throw PosError(std::string(protocol::err::kNotFound),
                                       "Item does not belong to this table's order");
                    }

                    auto move = ctx->db().prepare(
                        "UPDATE order_items SET order_id = :target, line_seq = :seq, "
                        "       updated_at = :now WHERE id = :itemId");
                    move.bind(":target", targetOrderId)
                        .bind(":seq", ++nextSeq)
                        .bind(":now", now)
                        .bind(":itemId", itemId);
                    move.exec();

                    auto moveJob = ctx->db().prepare(
                        "UPDATE kitchen_jobs SET order_id = :target WHERE order_item_id = :itemId");
                    moveJob.bind(":target", targetOrderId).bind(":itemId", itemId);
                    moveJob.exec();
                }

                orders.recalculate(sourceOrderId);
                orders.recalculate(targetOrderId);
                orders.refreshTableStatus(tableId);
                orders.refreshTableStatus(toTableId);

                orders.logEvent(sourceOrderId, "order.split",
                                Json{{"toTable", toTableId},
                                     {"itemCount", static_cast<std::int64_t>(itemIds.size())}});
                ctx->audit("table.split", "order", sourceOrderId,
                           Json{{"toTable", toTableId}, {"itemIds", itemIds}});

                result = Json{{"sourceOrder", orders.load(sourceOrderId)},
                              {"targetOrder", orders.load(targetOrderId)}};
                idempotency.complete(request.idempotencyKey, result, "order", targetOrderId);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                    Json{{"tableIds", {tableId, toTableId}}});
            return result;
        });

    // ---------------------------------------------------------- preview / swap
    server.registerHandler(
        std::string(protocol::method::kTablesPreviewTransfer), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.transfer");
            services::OrderService orders(*ctx);
            const auto fromTableId = getOr<std::string>(request.payload, "fromTableId", "");
            const auto toTableId = getOr<std::string>(request.payload, "toTableId", "");
            require(!fromTableId.empty() && !toTableId.empty(), "Both tables are required");

            const std::string fromOrder = orders.openOrderIdForTable(fromTableId);
            const std::string toOrder = orders.openOrderIdForTable(toTableId);

            auto tableVersion = [&](const std::string& tableId) -> std::int64_t {
                auto stmt = ctx->db().prepare(
                    "SELECT row_version FROM restaurant_tables WHERE id = :id");
                stmt.bind(":id", tableId);
                return stmt.step() ? stmt.columnInt(0) : 0;
            };

            Json allowed = Json::array();
            if (!fromOrder.empty() && toOrder.empty()) allowed.push_back("move");
            if (!fromOrder.empty() && !toOrder.empty()) {
                allowed.push_back("swap");
                allowed.push_back("merge");
            }
            // Item transfer only needs a source order: `transferItems` opens an
            // order on the destination when it has none.
            if (!fromOrder.empty()) allowed.push_back("item_transfer");

            return Json{{"fromTableId", fromTableId},
                        {"toTableId", toTableId},
                        {"fromOrderId", fromOrder.empty() ? Json(nullptr) : Json(fromOrder)},
                        {"toOrderId", toOrder.empty() ? Json(nullptr) : Json(toOrder)},
                        {"fromRowVersion", tableVersion(fromTableId)},
                        {"toRowVersion", tableVersion(toTableId)},
                        {"allowedOperations", allowed}};
        });

    server.registerHandler(
        std::string(protocol::method::kTablesSwap), [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.transfer");
            const auto a = getOr<std::string>(request.payload, "tableIdA", "");
            const auto b = getOr<std::string>(request.payload, "tableIdB", "");
            // Same from/to spelling as transfer, merge and transferItems - the
            // codebase previously had three different names for one concept.
            const auto expectedA = getOr<std::int64_t>(request.payload, "expectedFromVersion", -1);
            const auto expectedB = getOr<std::int64_t>(request.payload, "expectedToVersion", -1);
            require(!a.empty() && !b.empty() && a != b, "Two different tables are required");

            services::OrderService orders(*ctx);
            services::Idempotency idempotency(*ctx);
            Json result;

            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kTablesSwap),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                auto versionOf = [&](const std::string& tableId) {
                    auto stmt = ctx->db().prepare(
                        "SELECT row_version FROM restaurant_tables WHERE id = :id");
                    stmt.bind(":id", tableId);
                    if (!stmt.step()) throw PosError::of(protocol::err::kTableNotFound);
                    return stmt.columnInt(0);
                };

                if (expectedA >= 0 && versionOf(a) != expectedA) {
                    throw PosError(std::string(protocol::err::kStaleVersion),
                                   "Table A was modified by another operator");
                }
                if (expectedB >= 0 && versionOf(b) != expectedB) {
                    throw PosError(std::string(protocol::err::kStaleVersion),
                                   "Table B was modified by another operator");
                }

                const std::string orderA = orders.openOrderIdForTable(a);
                const std::string orderB = orders.openOrderIdForTable(b);
                require(!orderA.empty() && !orderB.empty(), "Both tables must have open orders");

                const auto now = nowMs();
                // idx_orders_one_open_per_table forbids a direct A↔B CASE swap
                // (mid-statement unique collision). Park both to NULL first
                // (NULLs are excluded from that index), then assign in one CASE
                // UPDATE. Never reuse two live prepares of the same SQL text —
                // that used to leave orderB parked forever.
                auto parkBoth = ctx->db().prepare(
                    "UPDATE orders SET table_id = NULL, updated_at = :now, "
                    "row_version = row_version + 1 WHERE id IN (:orderA, :orderB)");
                parkBoth.bind(":now", now).bind(":orderA", orderA).bind(":orderB", orderB);
                parkBoth.exec();
                require(ctx->db().changes() == 2, "Table swap could not park both orders");

                auto placeBoth = ctx->db().prepare(
                    "UPDATE orders SET table_id = CASE id "
                    "  WHEN :orderA THEN :tableB "
                    "  WHEN :orderB THEN :tableA "
                    "  ELSE table_id END, "
                    "  updated_at = :now, "
                    "  row_version = row_version + 1 "
                    "WHERE id IN (:orderA, :orderB)");
                placeBoth.bind(":orderA", orderA)
                    .bind(":orderB", orderB)
                    .bind(":tableA", a)
                    .bind(":tableB", b)
                    .bind(":now", now);
                placeBoth.exec();
                require(ctx->db().changes() == 2, "Table swap could not place both orders");

                auto checkA = ctx->db().prepare("SELECT table_id FROM orders WHERE id = :id");
                checkA.bind(":id", orderA);
                require(checkA.step() && checkA.columnText(0) == b,
                        "Table swap left order A on the wrong table");
                auto checkB = ctx->db().prepare("SELECT table_id FROM orders WHERE id = :id");
                checkB.bind(":id", orderB);
                require(checkB.step() && checkB.columnText(0) == a,
                        "Table swap left order B on the wrong table");

                auto bump = ctx->db().prepare(
                    "UPDATE restaurant_tables SET row_version = row_version + 1, updated_at = :now "
                    "WHERE id IN (:a, :b)");
                bump.bind(":now", now).bind(":a", a).bind(":b", b);
                bump.exec();

                orders.refreshTableStatus(a);
                orders.refreshTableStatus(b);
                ctx->auditRequired("table.swap", "table", a, Json{{"with", b}});

                result = Json{{"orderA", orders.load(orderA)}, {"orderB", orders.load(orderB)}};
                idempotency.complete(request.idempotencyKey, result, "table", a);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"tableIds", {a, b}}});
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kTablesTransferItems),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("order.transfer");
            const auto fromTableId = getOr<std::string>(request.payload, "fromTableId", "");
            const auto toTableId = getOr<std::string>(request.payload, "toTableId", "");
            require(!fromTableId.empty() && !toTableId.empty(), "Both tables are required");

            std::vector<services::TransferItemSpec> items;
            if (request.payload.contains("items") && request.payload["items"].is_array()) {
                for (const auto& row : request.payload["items"]) {
                    services::TransferItemSpec spec;
                    spec.itemId = row.value("itemId", "");
                    spec.quantity = row.value("quantity", 0);
                    spec.expectedVersion = row.value("expectedVersion", -1);
                    if (!spec.itemId.empty()) items.push_back(spec);
                }
            } else if (request.payload.contains("itemIds") &&
                       request.payload["itemIds"].is_array()) {
                for (const auto& id : request.payload["itemIds"]) {
                    if (!id.is_string()) continue;
                    services::TransferItemSpec spec;
                    spec.itemId = id.get<std::string>();
                    items.push_back(spec);
                }
            }

            services::Idempotency idempotency(*ctx);
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay =
                        idempotency.begin(request.idempotencyKey,
                                          std::string(protocol::method::kTablesTransferItems),
                                          request.payload)) {
                    txn.commit();
                    return *replay;
                }
                result = services::TableTransferService(*ctx).transferItems(
                    fromTableId, toTableId, items,
                    getOr<std::int64_t>(request.payload, "expectedFromVersion", -1),
                    getOr<std::int64_t>(request.payload, "expectedToVersion", -1),
                    request.idempotencyKey);
                idempotency.complete(request.idempotencyKey, result, "table", fromTableId);
                txn.commit();
            }
            ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                    Json{{"tableIds", {fromTableId, toTableId}}});
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kTablesUpdateLayout), [ctx](const ipc::Request& request) {
            ctx->requirePermission("tables.layout");
            require(request.payload.contains("tables") && request.payload["tables"].is_array(),
                    "tables array is required");

            const auto now = nowMs();
            Json::array_t touched;
            {
                db::Transaction txn(ctx->db());
                for (const auto& row : request.payload["tables"]) {
                    const auto id = row.value("id", "");
                    if (id.empty()) continue;
                    auto upd = ctx->db().prepare(
                        "UPDATE restaurant_tables SET pos_x = :x, pos_y = :y, "
                        "width = COALESCE(:w, width), height = COALESCE(:h, height), "
                        "updated_at = :now WHERE id = :id AND active = 1");
                    upd.bind(":x", row.value("posX", 0))
                        .bind(":y", row.value("posY", 0))
                        .bind(":w", row.value("width", 1))
                        .bind(":h", row.value("height", 1))
                        .bind(":now", now)
                        .bind(":id", id);
                    upd.exec();
                    touched.push_back(id);
                }
                txn.commit();
            }
            if (!touched.empty()) {
                ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                        Json{{"tableIds", touched}});
            }
            return Json{{"updated", touched.size()}};
        });

    server.registerHandler(
        std::string(protocol::method::kTablesUpsertArea), [ctx](const ipc::Request& request) {
            ctx->requirePermission("tables.layout");
            const auto nameAz = getOr<std::string>(request.payload, "nameAz", "");
            require(!nameAz.empty(), "nameAz is required");

            std::string id = getOr<std::string>(request.payload, "id", "");
            if (id.empty()) id = crypto::uuid4();
            const auto sort = getOr<std::int64_t>(request.payload, "sortOrder", 0);

            db::Transaction txn(ctx->db());
            auto existing = ctx->db().prepare("SELECT id FROM restaurant_areas WHERE id = :id");
            existing.bind(":id", id);
            if (existing.step()) {
                auto upd = ctx->db().prepare(
                    "UPDATE restaurant_areas SET name_az = :nameAz, name_tr = :nameTr, "
                    "name_en = :nameEn, sort_order = :sort, active = 1 WHERE id = :id");
                upd.bind(":nameAz", nameAz)
                    .bind(":nameTr", getOr<std::string>(request.payload, "nameTr", nameAz))
                    .bind(":nameEn", getOr<std::string>(request.payload, "nameEn", nameAz))
                    .bind(":sort", sort)
                    .bind(":id", id);
                upd.exec();
            } else {
                auto ins = ctx->db().prepare(
                    "INSERT INTO restaurant_areas (id, name_az, name_tr, name_en, sort_order, active) "
                    "VALUES (:id, :nameAz, :nameTr, :nameEn, :sort, 1)");
                ins.bind(":id", id)
                    .bind(":nameAz", nameAz)
                    .bind(":nameTr", getOr<std::string>(request.payload, "nameTr", nameAz))
                    .bind(":nameEn", getOr<std::string>(request.payload, "nameEn", nameAz))
                    .bind(":sort", sort);
                ins.exec();
            }
            ctx->audit("tables.upsertArea", "restaurant_area", id, request.payload);
            txn.commit();

            auto load = ctx->db().prepare(
                "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, "
                "sort_order AS sortOrder, active FROM restaurant_areas WHERE id = :id");
            load.bind(":id", id);
            load.step();
            return load.row();
        });

    server.registerHandler(
        std::string(protocol::method::kTablesArchiveArea), [ctx](const ipc::Request& request) {
            ctx->requirePermission("tables.layout");
            const auto areaId = getOr<std::string>(request.payload, "areaId", "");
            require(!areaId.empty(), "areaId is required");

            db::Transaction txn(ctx->db());
            // Opening a table creates a draft before its first line is added. A cancelled
            // visit used to leave that zero-value draft behind while the floor showed the
            // table as available. Those invisible drafts must not make an empty area
            // impossible to archive. Real orders (any line, amount or payment) remain
            // protected by the conflict check below.
            auto abandon = ctx->db().prepare(
                "UPDATE orders SET status = 'voided', updated_at = :now, "
                "row_version = row_version + 1 "
                "WHERE status = 'draft' AND total_minor = 0 AND paid_minor = 0 "
                "AND table_id IN (SELECT id FROM restaurant_tables "
                "                 WHERE area_id = :area AND active = 1) "
                "AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = orders.id "
                "                AND i.status != 'voided') "
                "AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id)");
            abandon.bind(":now", nowMs()).bind(":area", areaId);
            abandon.exec();

            auto open = ctx->db().prepare(
                "SELECT COUNT(*) FROM restaurant_tables t "
                "LEFT JOIN orders o ON o.table_id = t.id "
                "  AND o.status IN ('draft','open','sent','partially_paid') "
                "WHERE t.area_id = :area AND t.active = 1 AND o.id IS NOT NULL");
            open.bind(":area", areaId);
            if (open.step() && open.columnInt(0) > 0) {
                throw PosError(std::string(protocol::err::kConflict),
                               "Area has open orders; close them first");
            }

            auto tables = ctx->db().prepare(
                "UPDATE restaurant_tables SET active = 0, updated_at = :now WHERE area_id = :area");
            tables.bind(":now", nowMs()).bind(":area", areaId);
            tables.exec();
            auto area = ctx->db().prepare(
                "UPDATE restaurant_areas SET active = 0 WHERE id = :id");
            area.bind(":id", areaId);
            area.exec();
            ctx->audit("tables.archiveArea", "restaurant_area", areaId);
            txn.commit();
            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"areaId", areaId}});
            return Json{{"areaId", areaId}, {"archived", true}};
        });

    server.registerHandler(
        std::string(protocol::method::kTablesUpsertTable), [ctx](const ipc::Request& request) {
            ctx->requirePermission("tables.layout");
            const auto label = getOr<std::string>(request.payload, "label", "");
            const auto areaId = getOr<std::string>(request.payload, "areaId", "");
            require(!label.empty(), "label is required");
            require(!areaId.empty(), "areaId is required");

            std::string id = getOr<std::string>(request.payload, "id", "");
            if (id.empty()) id = crypto::uuid4();
            const auto seats = std::max<std::int64_t>(1, getOr<std::int64_t>(request.payload, "seats", 2));
            const auto sort = getOr<std::int64_t>(request.payload, "sortOrder", 0);
            const auto shape = getOr<std::string>(request.payload, "shape", "square");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            auto areaOk = ctx->db().prepare(
                "SELECT id FROM restaurant_areas WHERE id = :id AND active = 1");
            areaOk.bind(":id", areaId);
            if (!areaOk.step()) {
                throw PosError(std::string(protocol::err::kValidation), "Area not found");
            }

            auto existing = ctx->db().prepare("SELECT id FROM restaurant_tables WHERE id = :id");
            existing.bind(":id", id);
            if (existing.step()) {
                auto upd = ctx->db().prepare(
                    "UPDATE restaurant_tables SET area_id = :area, label = :label, seats = :seats, "
                    "shape = :shape, sort_order = :sort, active = 1, updated_at = :now WHERE id = :id");
                upd.bind(":area", areaId)
                    .bind(":label", label)
                    .bind(":seats", seats)
                    .bind(":shape", shape)
                    .bind(":sort", sort)
                    .bind(":now", now)
                    .bind(":id", id);
                upd.exec();
            } else {
                auto maxPos = ctx->db().prepare(
                    "SELECT COALESCE(MAX(pos_y), 0) FROM restaurant_tables WHERE area_id = :area");
                maxPos.bind(":area", areaId);
                const int nextY = maxPos.step() ? static_cast<int>(maxPos.columnInt(0)) + 1 : 0;
                auto ins = ctx->db().prepare(
                    "INSERT INTO restaurant_tables "
                    "(id, area_id, label, seats, status, pos_x, pos_y, width, height, shape, "
                    "sort_order, active, updated_at) "
                    "VALUES (:id, :area, :label, :seats, 'available', 0, :y, 1, 1, :shape, "
                    ":sort, 1, :now)");
                ins.bind(":id", id)
                    .bind(":area", areaId)
                    .bind(":label", label)
                    .bind(":seats", seats)
                    .bind(":y", nextY)
                    .bind(":shape", shape)
                    .bind(":sort", sort)
                    .bind(":now", now);
                ins.exec();
            }
            ctx->audit("tables.upsertTable", "restaurant_table", id, request.payload);
            txn.commit();

            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"tableIds", {id}}});
            auto load = ctx->db().prepare(std::string(kTableQuery) + "AND t.id = :id");
            load.bind(":id", id);
            if (!load.step()) throw PosError::of(protocol::err::kTableNotFound);
            return load.row();
        });

    server.registerHandler(
        std::string(protocol::method::kTablesArchiveTable), [ctx](const ipc::Request& request) {
            ctx->requirePermission("tables.layout");
            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            require(!tableId.empty(), "tableId is required");

            db::Transaction txn(ctx->db());
            auto abandon = ctx->db().prepare(
                "UPDATE orders SET status = 'voided', updated_at = :now, "
                "row_version = row_version + 1 "
                "WHERE table_id = :id AND status = 'draft' "
                "AND total_minor = 0 AND paid_minor = 0 "
                "AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = orders.id "
                "                AND i.status != 'voided') "
                "AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id)");
            abandon.bind(":now", nowMs()).bind(":id", tableId);
            abandon.exec();

            auto open = ctx->db().prepare(
                "SELECT COUNT(*) FROM orders WHERE table_id = :id "
                "AND status IN ('draft','open','sent','partially_paid')");
            open.bind(":id", tableId);
            if (open.step() && open.columnInt(0) > 0) {
                throw PosError(std::string(protocol::err::kConflict),
                               "Table has an open order; close it first");
            }

            auto upd = ctx->db().prepare(
                "UPDATE restaurant_tables SET active = 0, updated_at = :now WHERE id = :id");
            upd.bind(":now", nowMs()).bind(":id", tableId);
            upd.exec();
            ctx->audit("tables.archiveTable", "restaurant_table", tableId);
            txn.commit();
            ctx->server().emitEvent(protocol::event::kTablesUpdated, Json{{"tableIds", {tableId}}});
            return Json{{"tableId", tableId}, {"archived", true}};
        });
}

}  // namespace pos::handlers
