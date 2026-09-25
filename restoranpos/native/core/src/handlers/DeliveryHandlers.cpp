/**
 * Orders that leave the building, and the roster of who is meant to be here.
 *
 * A delivery is an order with a destination and a courier, not a separate kind
 * of sale: it reuses orders, payments and the kitchen exactly as a table bill
 * does, so revenue and stock stay in one place.
 */
#include <algorithm>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::handlers {
namespace {

/** Records the change so "who had it and when" survives a shift change. */
void logDeliveryEvent(Context& ctx, const std::string& deliveryId, const std::string& status,
                      const std::string& courierId, const std::string& note) {
    auto stmt = ctx.db().prepare(
        "INSERT INTO delivery_events (id, delivery_id, status, courier_id, note, "
        "                             actor_user_id, created_at) "
        "VALUES (:id, :delivery, :status, :courier, :note, :actor, :now)");
    stmt.bind(":id", crypto::uuid4())
        .bind(":delivery", deliveryId)
        .bind(":status", status)
        .bindOptional(":courier", courierId)
        .bind(":note", note)
        .bindOptional(":actor", ctx.session().userId)
        .bind(":now", nowMs());
    stmt.exec();
}

}  // namespace

void registerDelivery(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // --------------------------------------------------------------- couriers
    server.registerHandler(
        std::string(protocol::method::kCouriersList), [ctx](const ipc::Request&) {
            ctx->requirePermission("delivery.view");
            auto stmt = ctx->db().prepare(
                "SELECT c.id, c.name, c.phone, c.vehicle, c.active, "
                "       c.user_id AS userId, u.full_name AS staffName, "
                "       (SELECT COUNT(*) FROM delivery_orders d "
                "         WHERE d.courier_id = c.id "
                "           AND d.status IN ('assigned','picked_up')) AS openCount "
                "FROM couriers c LEFT JOIN users u ON u.id = c.user_id "
                "WHERE c.active = 1 ORDER BY c.name");
            return Json{{"couriers", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kCouriersSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("delivery.manage");

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Kuryer adı tələb olunur");
            const auto vehicle = getOr<std::string>(request.payload, "vehicle", "");
            require(vehicle.empty() || vehicle == "walk" || vehicle == "bike" ||
                        vehicle == "moto" || vehicle == "car",
                    "Nəqliyyat növü tanınmadı");

            auto id = getOr<std::string>(request.payload, "id", "");
            const auto phone = getOr<std::string>(request.payload, "phone", "");
            const auto userId = getOr<std::string>(request.payload, "userId", "");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            if (id.empty()) {
                id = "cur-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO couriers (id, name, phone, user_id, vehicle, "
                    "                      created_at, updated_at) "
                    "VALUES (:id, :name, :phone, :user, :vehicle, :now, :now)");
                insert.bind(":id", id).bind(":name", name).bind(":phone", phone)
                    .bindOptional(":user", userId).bind(":vehicle", vehicle).bind(":now", now);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE couriers SET name = :name, phone = :phone, user_id = :user, "
                    "  vehicle = :vehicle, updated_at = :now WHERE id = :id");
                update.bind(":name", name).bind(":phone", phone).bindOptional(":user", userId)
                    .bind(":vehicle", vehicle).bind(":now", now).bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Kuryer tapılmadı");
            }
            ctx->audit("courier.save", "courier", id, Json{{"name", name}});
            txn.commit();
            return Json{{"id", id}, {"name", name}};
        });

    // ------------------------------------------------------------- deliveries
    server.registerHandler(
        std::string(protocol::method::kDeliveryList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("delivery.view");
            const auto status = getOr<std::string>(request.payload, "status", "");

            auto stmt = ctx->db().prepare(
                "SELECT d.id, d.order_id AS orderId, o.order_number AS orderNumber, "
                "       o.total_minor AS totalMinor, o.status AS orderStatus, "
                "       d.customer_id AS customerId, c.name AS customerName, "
                "       d.courier_id AS courierId, cu.name AS courierName, "
                "       d.address, d.phone, d.note, d.fee_minor AS feeMinor, d.status, "
                "       d.assigned_at AS assignedAt, d.picked_up_at AS pickedUpAt, "
                "       d.delivered_at AS deliveredAt, d.created_at AS createdAt "
                "FROM delivery_orders d "
                "JOIN orders o ON o.id = d.order_id "
                "LEFT JOIN customers c ON c.id = d.customer_id "
                "LEFT JOIN couriers cu ON cu.id = d.courier_id "
                // Parenthesised: an empty filter must mean "all", not "every
                // row joined to the last branch".
                "WHERE (:status = '' OR d.status = :status) "
                "ORDER BY d.created_at DESC LIMIT 200");
            stmt.bind(":status", status);
            return Json{{"deliveries", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kDeliveryCreate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("delivery.manage");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto address = getOr<std::string>(request.payload, "address", "");
            require(!orderId.empty(), "orderId is required");
            require(!address.empty(), "Ünvan tələb olunur");
            const auto fee = getOr<Money>(request.payload, "feeMinor", 0);
            require(fee >= 0, "Çatdırılma haqqı mənfi ola bilməz");

            auto order = ctx->db().prepare("SELECT status FROM orders WHERE id = :id");
            order.bind(":id", orderId);
            require(order.step(), "Sifariş tapılmadı");

            const auto customerId = getOr<std::string>(request.payload, "customerId", "");
            const std::string id = "del-" + crypto::uuid4().substr(0, 8);
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            // UNIQUE on order_id: one order is one delivery, so a double tap
            // cannot put the same food on two couriers' lists.
            auto insert = ctx->db().prepare(
                "INSERT INTO delivery_orders (id, order_id, customer_id, address, phone, note, "
                "                             fee_minor, created_at, updated_at) "
                "VALUES (:id, :order, :customer, :address, :phone, :note, :fee, :now, :now)");
            insert.bind(":id", id).bind(":order", orderId)
                .bindOptional(":customer", customerId)
                .bind(":address", address)
                .bind(":phone", getOr<std::string>(request.payload, "phone", ""))
                .bind(":note", getOr<std::string>(request.payload, "note", ""))
                .bind(":fee", fee).bind(":now", now);
            insert.exec();

            if (!customerId.empty()) {
                auto link = ctx->db().prepare(
                    "UPDATE orders SET customer_id = :customer, updated_at = :now WHERE id = :id");
                link.bind(":customer", customerId).bind(":now", now).bind(":id", orderId);
                link.exec();
            }

            logDeliveryEvent(*ctx, id, "pending", "", "yaradıldı");
            ctx->audit("delivery.create", "delivery", id, Json{{"orderId", orderId}});
            txn.commit();

            return Json{{"id", id}, {"orderId", orderId}, {"status", "pending"},
                        {"feeMinor", fee}};
        });

    server.registerHandler(
        std::string(protocol::method::kDeliveryAssign), [ctx](const ipc::Request& request) {
            ctx->requirePermission("delivery.assign");

            const auto id = getOr<std::string>(request.payload, "deliveryId", "");
            const auto courierId = getOr<std::string>(request.payload, "courierId", "");
            require(!id.empty(), "deliveryId is required");
            require(!courierId.empty(), "courierId is required");

            auto courier = ctx->db().prepare(
                "SELECT name FROM couriers WHERE id = :id AND active = 1");
            courier.bind(":id", courierId);
            require(courier.step(), "Kuryer tapılmadı");

            db::Transaction txn(ctx->db());
            // Reassigning a delivery that is already out is allowed - handing it
            // to someone else mid-route is a real thing - but one already
            // delivered is history, not a work item.
            auto stmt = ctx->db().prepare(
                "UPDATE delivery_orders SET courier_id = :courier, status = 'assigned', "
                "  assigned_at = :now, updated_at = :now "
                "WHERE id = :id AND status IN ('pending','assigned','picked_up')");
            stmt.bind(":courier", courierId).bind(":now", nowMs()).bind(":id", id);
            stmt.exec();
            require(ctx->db().changes() == 1, "Çatdırılma tapılmadı və ya artıq bağlanıb");

            logDeliveryEvent(*ctx, id, "assigned", courierId, courier.columnText(0));
            ctx->audit("delivery.assign", "delivery", id, Json{{"courierId", courierId}});
            txn.commit();

            return Json{{"id", id}, {"status", "assigned"}, {"courierId", courierId}};
        });

    server.registerHandler(
        std::string(protocol::method::kDeliverySetStatus), [ctx](const ipc::Request& request) {
            ctx->requirePermission("delivery.assign");

            const auto id = getOr<std::string>(request.payload, "deliveryId", "");
            const auto status = getOr<std::string>(request.payload, "status", "");
            require(!id.empty(), "deliveryId is required");
            require(status == "picked_up" || status == "delivered" || status == "failed" ||
                        status == "cancelled",
                    "Status tanınmadı");

            auto current = ctx->db().prepare(
                "SELECT status, courier_id FROM delivery_orders WHERE id = :id");
            current.bind(":id", id);
            require(current.step(), "Çatdırılma tapılmadı");
            const std::string was = current.columnText(0);
            const std::string courierId =
                current.columnIsNull(1) ? "" : current.columnText(1);
            require(was != "delivered" && was != "cancelled",
                    "Bu çatdırılma artıq bağlanıb");
            // Food cannot be picked up by nobody.
            if (status == "picked_up") {
                require(!courierId.empty(), "Əvvəlcə kuryer təyin edin");
            }

            const auto now = nowMs();
            db::Transaction txn(ctx->db());
            auto stmt = ctx->db().prepare(
                "UPDATE delivery_orders SET status = :status, updated_at = :now, "
                "  picked_up_at = CASE WHEN :status = 'picked_up' THEN :now ELSE picked_up_at END, "
                "  delivered_at = CASE WHEN :status = 'delivered' THEN :now ELSE delivered_at END "
                "WHERE id = :id");
            stmt.bind(":status", status).bind(":now", now).bind(":id", id);
            stmt.exec();

            logDeliveryEvent(*ctx, id, status, courierId,
                             getOr<std::string>(request.payload, "note", ""));
            ctx->audit("delivery.status", "delivery", id, Json{{"status", status}});
            txn.commit();

            return Json{{"id", id}, {"status", status}};
        });

    server.registerHandler(
        std::string(protocol::method::kDeliveryCourierReport),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("delivery.view");

            const auto from = getOr<Timestamp>(request.payload, "from", nowMs() - 86400000LL);
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs());

            // What each courier carried and what they are holding: the fee is
            // the shop's, the bill total is what they collected on cash orders.
            auto stmt = ctx->db().prepare(
                "SELECT c.id AS courierId, c.name AS courierName, "
                "       COUNT(d.id) AS deliveries, "
                "       COALESCE(SUM(CASE WHEN d.status = 'delivered' THEN 1 ELSE 0 END), 0) "
                "         AS completed, "
                "       COALESCE(SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END), 0) "
                "         AS failed, "
                "       COALESCE(SUM(d.fee_minor), 0) AS feeMinor, "
                "       COALESCE(SUM(o.total_minor), 0) AS collectedMinor "
                "FROM couriers c "
                "LEFT JOIN delivery_orders d ON d.courier_id = c.id "
                "     AND d.created_at BETWEEN :from AND :to "
                "LEFT JOIN orders o ON o.id = d.order_id "
                "WHERE c.active = 1 GROUP BY c.id ORDER BY c.name");
            stmt.bind(":from", from).bind(":to", to);
            return Json{{"from", from}, {"to", to}, {"couriers", stmt.rows()}};
        });

    // ----------------------------------------------------------------- roster
    server.registerHandler(
        std::string(protocol::method::kScheduleList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("schedule.view");
            const auto from = getOr<Timestamp>(request.payload, "from", nowMs() - 86400000LL);
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs() + 7 * 86400000LL);

            auto stmt = ctx->db().prepare(
                "SELECT s.id, s.user_id AS userId, u.full_name AS fullName, r.name AS role, "
                "       s.starts_at AS startsAt, s.ends_at AS endsAt, s.role_note AS roleNote, "
                "       s.status "
                "FROM staff_schedules s "
                "JOIN users u ON u.id = s.user_id "
                "LEFT JOIN roles r ON r.id = u.primary_role_id "
                "WHERE s.starts_at BETWEEN :from AND :to ORDER BY s.starts_at, u.full_name");
            stmt.bind(":from", from).bind(":to", to);
            return Json{{"from", from}, {"to", to}, {"shifts", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kScheduleSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("schedule.manage");

            const auto userId = getOr<std::string>(request.payload, "userId", "");
            const auto startsAt = getOr<Timestamp>(request.payload, "startsAt", 0);
            const auto endsAt = getOr<Timestamp>(request.payload, "endsAt", 0);
            require(!userId.empty(), "userId is required");
            require(startsAt > 0 && endsAt > startsAt, "Növbənin başlanğıc və bitiş vaxtı yanlışdır");

            auto user = ctx->db().prepare("SELECT 1 FROM users WHERE id = :id AND active = 1");
            user.bind(":id", userId);
            require(user.step(), "İşçi tapılmadı");

            auto id = getOr<std::string>(request.payload, "id", "");
            // Nobody works two shifts at once; a clash is a rota mistake worth
            // catching while it is still on screen.
            auto clash = ctx->db().prepare(
                "SELECT COUNT(*) FROM staff_schedules "
                "WHERE user_id = :user AND status != 'cancelled' AND id != :id "
                "  AND starts_at < :endsAt AND ends_at > :startsAt");
            clash.bind(":user", userId).bind(":id", id).bind(":startsAt", startsAt)
                .bind(":endsAt", endsAt);
            clash.step();
            require(clash.columnInt(0) == 0, "Bu işçinin həmin vaxtda başqa növbəsi var");

            const auto note = getOr<std::string>(request.payload, "roleNote", "");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            if (id.empty()) {
                id = "shf-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO staff_schedules (id, user_id, starts_at, ends_at, role_note, "
                    "                             actor_user_id, created_at, updated_at) "
                    "VALUES (:id, :user, :starts, :ends, :note, :actor, :now, :now)");
                insert.bind(":id", id).bind(":user", userId).bind(":starts", startsAt)
                    .bind(":ends", endsAt).bind(":note", note)
                    .bindOptional(":actor", ctx->session().userId).bind(":now", now);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE staff_schedules SET user_id = :user, starts_at = :starts, "
                    "  ends_at = :ends, role_note = :note, updated_at = :now WHERE id = :id");
                update.bind(":user", userId).bind(":starts", startsAt).bind(":ends", endsAt)
                    .bind(":note", note).bind(":now", now).bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Növbə tapılmadı");
            }
            ctx->audit("schedule.save", "schedule", id, Json{{"userId", userId}});
            txn.commit();
            return Json{{"id", id}, {"userId", userId}, {"startsAt", startsAt},
                        {"endsAt", endsAt}};
        });

    server.registerHandler(
        std::string(protocol::method::kScheduleRemove), [ctx](const ipc::Request& request) {
            ctx->requirePermission("schedule.manage");
            const auto id = getOr<std::string>(request.payload, "shiftId", "");
            require(!id.empty(), "shiftId is required");

            // Cancelled rather than deleted: attendance rows point at it, and a
            // rota that silently loses shifts cannot be argued about later.
            auto stmt = ctx->db().prepare(
                "UPDATE staff_schedules SET status = 'cancelled', updated_at = :now "
                "WHERE id = :id AND status != 'cancelled'");
            stmt.bind(":now", nowMs()).bind(":id", id);
            stmt.exec();
            require(ctx->db().changes() == 1, "Növbə tapılmadı");
            ctx->audit("schedule.remove", "schedule", id, Json::object());
            return Json{{"ok", true}, {"shiftId", id}};
        });

    // ------------------------------------------------------------- attendance
    server.registerHandler(
        std::string(protocol::method::kAttendanceClockIn), [ctx](const ipc::Request& request) {
            ctx->requirePermission("schedule.clock");

            // Defaults to the person asking: a cashier clocks themselves in, a
            // manager may clock in someone who forgot.
            auto userId = getOr<std::string>(request.payload, "userId", "");
            if (userId.empty()) userId = ctx->session().userId;
            require(!userId.empty(), "userId is required");

            auto open = ctx->db().prepare(
                "SELECT id FROM attendance WHERE user_id = :user AND clock_out_at IS NULL");
            open.bind(":user", userId);
            // Clocking in twice is a mistake, not a second shift.
            require(!open.step(), "Bu işçi artıq işə başlayıb");

            const std::string id = "att-" + crypto::uuid4().substr(0, 8);
            const auto now = nowMs();

            // Matched to the rota when one exists, so planned and actual can be
            // compared later without guessing.
            auto planned = ctx->db().prepare(
                "SELECT id FROM staff_schedules WHERE user_id = :user AND status != 'cancelled' "
                "  AND :now BETWEEN starts_at - 3600000 AND ends_at ORDER BY starts_at LIMIT 1");
            planned.bind(":user", userId).bind(":now", now);
            const std::string scheduleId = planned.step() ? planned.columnText(0) : "";

            auto insert = ctx->db().prepare(
                "INSERT INTO attendance (id, user_id, schedule_id, clock_in_at, created_at) "
                "VALUES (:id, :user, :schedule, :now, :now)");
            insert.bind(":id", id).bind(":user", userId)
                .bindOptional(":schedule", scheduleId).bind(":now", now);
            insert.exec();

            ctx->audit("attendance.clockIn", "user", userId, Json{{"attendanceId", id}});
            return Json{{"id", id}, {"userId", userId}, {"clockInAt", now},
                        {"scheduleId", scheduleId}};
        });

    server.registerHandler(
        std::string(protocol::method::kAttendanceClockOut), [ctx](const ipc::Request& request) {
            ctx->requirePermission("schedule.clock");

            auto userId = getOr<std::string>(request.payload, "userId", "");
            if (userId.empty()) userId = ctx->session().userId;
            require(!userId.empty(), "userId is required");

            const auto now = nowMs();
            auto stmt = ctx->db().prepare(
                "UPDATE attendance SET clock_out_at = :now, note = :note "
                "WHERE user_id = :user AND clock_out_at IS NULL");
            stmt.bind(":now", now)
                .bind(":note", getOr<std::string>(request.payload, "note", ""))
                .bind(":user", userId);
            stmt.exec();
            require(ctx->db().changes() == 1, "Açıq iş vaxtı tapılmadı");

            ctx->audit("attendance.clockOut", "user", userId, Json{{"clockOutAt", now}});
            return Json{{"userId", userId}, {"clockOutAt", now}};
        });

    server.registerHandler(
        std::string(protocol::method::kAttendanceList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("schedule.view");
            const auto from = getOr<Timestamp>(request.payload, "from", nowMs() - 7 * 86400000LL);
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs());

            auto stmt = ctx->db().prepare(
                "SELECT a.id, a.user_id AS userId, u.full_name AS fullName, "
                "       a.schedule_id AS scheduleId, a.clock_in_at AS clockInAt, "
                "       a.clock_out_at AS clockOutAt, a.note, "
                "       s.starts_at AS plannedStartsAt, s.ends_at AS plannedEndsAt, "
                "       CASE WHEN a.clock_out_at IS NULL THEN NULL "
                "            ELSE (a.clock_out_at - a.clock_in_at) / 60000 END AS workedMinutes "
                "FROM attendance a "
                "JOIN users u ON u.id = a.user_id "
                "LEFT JOIN staff_schedules s ON s.id = a.schedule_id "
                "WHERE a.clock_in_at BETWEEN :from AND :to "
                "ORDER BY a.clock_in_at DESC LIMIT 300");
            stmt.bind(":from", from).bind(":to", to);
            return Json{{"from", from}, {"to", to}, {"entries", stmt.rows()}};
        });
}

}  // namespace pos::handlers
