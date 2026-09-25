#include "pos/services/CashService.hpp"

#include "pos/services/RefundService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"

namespace pos::services {

Json CashService::recordMovement(std::string_view kind, Money amountMinor, std::string_view reason,
                                 std::string_view note, const std::string& businessDayId,
                                 const std::string& shiftId) {
    const std::string kindStr(kind);
    if (kindStr != "cash_in" && kindStr != "cash_out" && kindStr != "expense" &&
        kindStr != "float_adjust" && kindStr != "drawer_open") {
        throw PosError(std::string(protocol::err::kValidation), "Unknown cash movement kind");
    }
    if (kindStr != "drawer_open" && amountMinor <= 0) {
        throw PosError(std::string(protocol::err::kValidation), "Amount must be positive");
    }
    if (reason.empty() && kindStr != "drawer_open") {
        throw PosError(std::string(protocol::err::kValidation), "A reason is required");
    }

    BusinessDayService days(ctx_);
    std::string dayId = businessDayId;
    if (dayId.empty()) {
        const auto open = days.openBusinessDayId();
        if (open) dayId = *open;
    }

    const std::string id = crypto::uuid4();
    const auto now = nowMs();
    auto insert = ctx_.db().prepare(
        "INSERT INTO cash_movements ("
        "  id, business_day_id, shift_id, kind, amount_minor, reason, note,"
        "  actor_user_id, created_at"
        ") VALUES ("
        "  :id, :day, :shift, :kind, :amount, :reason, :note, :actor, :now)");
    insert.bind(":id", id)
        .bindOptional(":day", dayId)
        .bindOptional(":shift", shiftId.empty() ? ctx_.session().shiftId : shiftId)
        .bind(":kind", kindStr)
        .bind(":amount", amountMinor)
        .bind(":reason", std::string(reason))
        .bind(":note", std::string(note))
        .bindOptional(":actor", ctx_.session().userId)
        .bind(":now", now);
    insert.exec();

    ctx_.auditRequired("cash.movement", "cash_movement", id,
                       Json{{"kind", kindStr},
                            {"amountMinor", amountMinor},
                            {"reason", std::string(reason)}});

    auto load = ctx_.db().prepare(
        "SELECT id, business_day_id AS businessDayId, shift_id AS shiftId, kind, "
        "       amount_minor AS amountMinor, reason, note, actor_user_id AS actorUserId, "
        "       created_at AS createdAt FROM cash_movements WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

Json CashService::listMovements(const std::string& businessDayId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id, business_day_id AS businessDayId, shift_id AS shiftId, kind, "
        "       amount_minor AS amountMinor, reason, note, actor_user_id AS actorUserId, "
        "       created_at AS createdAt "
        "FROM cash_movements WHERE (:day = '' OR business_day_id = :day) "
        "ORDER BY created_at DESC LIMIT 5000");
    stmt.bind(":day", businessDayId);
    return Json{{"movements", stmt.rows()}};
}

Money CashService::expectedCash(const std::string& businessDayId) {
    auto day = ctx_.db().prepare(
        "SELECT opening_float_minor FROM business_days WHERE id = :id");
    day.bind(":id", businessDayId);
    if (!day.step()) return 0;
    Money total = day.columnInt(0);

    // Tips paid in cash are physically in the drawer, so they belong in the
    // expected figure - leaving them out made every count look short.
    auto cashSales = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) + COALESCE(SUM(tip_minor), 0) FROM payments "
        "WHERE business_day_id = :day AND status = 'approved' AND method = 'cash'");
    cashSales.bind(":day", businessDayId);
    cashSales.step();
    total += cashSales.columnInt(0);

    // Refund movements are excluded here and subtracted from the refunds
    // ledger below: counting both would take the money out of the drawer twice.
    auto moves = ctx_.db().prepare(
        "SELECT kind, COALESCE(SUM(amount_minor), 0) FROM cash_movements "
        "WHERE business_day_id = :day AND reason != :refundReason GROUP BY kind");
    moves.bind(":day", businessDayId).bind(":refundReason", std::string(kRefundMovementReason));
    while (moves.step()) {
        const auto kind = moves.columnText(0);
        const Money amount = moves.columnInt(1);
        if (kind == "cash_in" || kind == "float_adjust") total += amount;
        if (kind == "cash_out" || kind == "expense") total -= amount;
    }

    auto cashRefunds = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM refunds "
        "WHERE business_day_id = :day AND status = 'completed' AND method = 'cash'");
    cashRefunds.bind(":day", businessDayId);
    cashRefunds.step();
    total -= cashRefunds.columnInt(0);
    return total;
}

}  // namespace pos::services
