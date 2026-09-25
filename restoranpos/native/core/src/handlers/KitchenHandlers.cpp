#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/OrderService.hpp"

namespace pos::handlers {
namespace {

/** Legal forward moves on the kitchen board. */
bool isLegalKitchenTransition(const std::string& from, const std::string& to) {
    if (from == to) return true;
    if (from == "new") return to == "accepted" || to == "preparing" || to == "completed";
    if (from == "accepted") return to == "preparing" || to == "ready" || to == "completed";
    if (from == "preparing") return to == "ready" || to == "completed";
    if (from == "ready") return to == "completed" || to == "preparing";
    return false;  // completed is terminal
}

}  // namespace

void registerKitchen(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(
        std::string(protocol::method::kKdsList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("kds.view");

            const auto status = getOr<std::string>(request.payload, "status", "");
            const auto station = getOr<std::string>(request.payload, "station", "");

            std::string sql =
                "SELECT j.id, j.order_id AS orderId, j.order_item_id AS orderItemId, "
                "       j.station, j.status, j.priority, j.course, j.created_at AS createdAt, "
                "       j.accepted_at AS acceptedAt, j.ready_at AS readyAt, "
                "       j.completed_at AS completedAt, j.target_minutes AS targetMinutes, "
                "       o.order_number AS orderNumber, t.label AS tableLabel, "
                "       u.full_name AS waiterName, "
                "       i.name_snapshot AS itemName, i.quantity, i.note, i.seat, "
                "       i.status AS itemStatus "
                "FROM kitchen_jobs j "
                "JOIN orders o ON o.id = j.order_id "
                "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
                "LEFT JOIN users u ON u.id = o.user_id "
                "LEFT JOIN order_items i ON i.id = j.order_item_id "
                "WHERE 1=1";

            if (!status.empty()) sql += " AND j.status = :status";
            else sql += " AND j.status != 'completed'";
            if (!station.empty()) sql += " AND j.station = :station";

            sql += " ORDER BY j.priority DESC, j.created_at";

            auto stmt = ctx->db().prepare(sql);
            if (!status.empty()) stmt.bind(":status", status);
            if (!station.empty()) stmt.bind(":station", station);

            Json jobs = stmt.rows();
            const auto now = nowMs();

            for (auto& job : jobs) {
                // Modifiers and allergy notes matter more to the kitchen than
                // anything else on the ticket, so they always travel with it.
                auto modifiers = ctx->db().prepare(
                    "SELECT name_snapshot AS name, group_name_snapshot AS groupName "
                    "FROM order_item_modifiers WHERE order_item_id = :itemId");
                modifiers.bind(":itemId", job.value("orderItemId", ""));
                job["modifiers"] = modifiers.rows();

                const auto createdAt = job.value("createdAt", now);
                const auto elapsedMinutes = (now - createdAt) / 60000;
                const auto target = job.value("targetMinutes", 15);

                job["elapsedMinutes"] = elapsedMinutes;
                job["late"] = elapsedMinutes > target;
                // Amber before the ticket is actually late, so the pass has warning.
                job["warning"] = !job["late"].get<bool>() && elapsedMinutes > (target * 2) / 3;
            }

            return Json{{"jobs", jobs}, {"serverTime", now}};
        });

    server.registerHandler(
        std::string(protocol::method::kKdsSetStatus), [ctx](const ipc::Request& request) {
            ctx->requirePermission("kds.operate");

            const auto jobId = getOr<std::string>(request.payload, "jobId", "");
            const auto status = getOr<std::string>(request.payload, "status", "");

            protocol::KitchenStatus parsed{};
            if (!protocol::parseKitchenStatus(status, parsed)) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Unknown kitchen status: " + status);
            }

            services::OrderService orders(*ctx);
            std::string orderId;
            std::string tableId;

            {
                db::Transaction txn(ctx->db());

                auto current = ctx->db().prepare(
                    "SELECT j.status, j.order_id, j.order_item_id, o.table_id "
                    "FROM kitchen_jobs j JOIN orders o ON o.id = j.order_id WHERE j.id = :jobId");
                current.bind(":jobId", jobId);
                if (!current.step()) {
                    throw PosError(std::string(protocol::err::kNotFound),
                                   "Kitchen ticket was not found");
                }

                const std::string from = current.columnText(0);
                orderId = current.columnText(1);
                const std::string itemId = current.columnText(2);
                tableId = current.columnText(3);

                if (!isLegalKitchenTransition(from, status)) {
                    throw PosError(std::string(protocol::err::kValidation),
                                   "Cannot move a ticket from " + from + " to " + status);
                }

                const auto now = nowMs();

                auto update = ctx->db().prepare(
                    "UPDATE kitchen_jobs SET status = :status, "
                    "  accepted_at = CASE WHEN :status IN ('accepted','preparing') "
                    "                     AND accepted_at IS NULL THEN :now ELSE accepted_at END, "
                    "  ready_at = CASE WHEN :status = 'ready' THEN :now ELSE ready_at END, "
                    "  completed_at = CASE WHEN :status = 'completed' THEN :now ELSE completed_at END "
                    "WHERE id = :jobId");
                update.bind(":status", status).bind(":now", now).bind(":jobId", jobId);
                update.exec();

                // The line's own status follows the ticket so the waiter's view
                // and the pass never disagree.
                if (!itemId.empty()) {
                    std::string itemStatus;
                    if (status == "preparing" || status == "accepted") itemStatus = "sent";
                    else if (status == "ready") itemStatus = "ready";
                    else if (status == "completed") itemStatus = "served";

                    if (!itemStatus.empty()) {
                        auto item = ctx->db().prepare(
                            "UPDATE order_items SET status = :status, updated_at = :now "
                            "WHERE id = :itemId AND status != 'voided'");
                        item.bind(":status", itemStatus).bind(":now", now).bind(":itemId", itemId);
                        item.exec();
                    }
                }

                // "The kitchen said it was ready an hour ago" is a dispute the
                // ticket's own row cannot settle: it only holds the latest state.
                ctx->audit("kds.setStatus", "kitchen_job", jobId,
                           Json{{"from", from},
                                {"to", status},
                                {"orderId", orderId},
                                {"tableId", tableId}});

                orders.refreshTableStatus(tableId);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kKdsUpdated, Json{{"orderIds", {orderId}}});
            if (!tableId.empty()) {
                ctx->server().emitEvent(protocol::event::kTablesUpdated,
                                        Json{{"tableIds", {tableId}}});
            }

            return Json{{"jobId", jobId}, {"status", status}};
        });

    server.registerHandler(
        std::string(protocol::method::kKdsBump), [ctx](const ipc::Request& request) {
            ctx->requirePermission("kds.operate");
            const auto jobId = getOr<std::string>(request.payload, "jobId", "");

            services::OrderService orders(*ctx);
            std::string orderId;
            std::string tableId;

            {
                db::Transaction txn(ctx->db());

                auto current = ctx->db().prepare(
                    "SELECT j.order_id, j.order_item_id, o.table_id FROM kitchen_jobs j "
                    "JOIN orders o ON o.id = j.order_id WHERE j.id = :jobId");
                current.bind(":jobId", jobId);
                if (!current.step()) {
                    throw PosError(std::string(protocol::err::kNotFound),
                                   "Kitchen ticket was not found");
                }
                orderId = current.columnText(0);
                const std::string itemId = current.columnText(1);
                tableId = current.columnText(2);

                const auto now = nowMs();

                auto update = ctx->db().prepare(
                    "UPDATE kitchen_jobs SET status = 'completed', completed_at = :now, "
                    "       ready_at = COALESCE(ready_at, :now) WHERE id = :jobId");
                update.bind(":now", now).bind(":jobId", jobId);
                update.exec();

                if (!itemId.empty()) {
                    auto item = ctx->db().prepare(
                        "UPDATE order_items SET status = 'served', updated_at = :now "
                        "WHERE id = :itemId AND status != 'voided'");
                    item.bind(":now", now).bind(":itemId", itemId);
                    item.exec();
                }

                ctx->audit("kds.bump", "kitchen_job", jobId,
                           Json{{"orderId", orderId}, {"tableId", tableId}});

                orders.refreshTableStatus(tableId);
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kKdsUpdated, Json{{"orderIds", {orderId}}});
            return Json{{"jobId", jobId}, {"status", "completed"}};
        });
}

}  // namespace pos::handlers
