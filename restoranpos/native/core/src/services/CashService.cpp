#include <limits>
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
        "SELECT m.id, m.business_day_id AS businessDayId, m.shift_id AS shiftId, m.kind, "
        "       m.amount_minor AS amountMinor, m.reason, m.note, m.actor_user_id AS actorUserId, "
        "       m.created_at AS createdAt, COALESCE(a.id, '') AS accountId, COALESCE(a.name, '') AS accountName, "
        "       COALESCE(o.id, '') AS objectId, COALESCE(o.name, '') AS objectName "
        "FROM cash_movements m "
        "LEFT JOIN cash_account_moves am ON am.rowid = (SELECT x.rowid FROM cash_account_moves x WHERE x.ref_type = 'cash_movement' AND x.ref_id = m.id ORDER BY x.created_at DESC,x.rowid DESC LIMIT 1) "
        "LEFT JOIN cash_accounts a ON a.id = COALESCE((SELECT l.account_id FROM document_cash_links l WHERE l.doc_type='salary' AND l.cash_movement_id=m.id LIMIT 1),am.account_id) "
        "LEFT JOIN cash_objects o ON o.id = a.object_id "
        "WHERE m.deleted_at IS NULL AND (:day = '' OR m.business_day_id = :day) "
        "ORDER BY m.created_at DESC LIMIT 5000");
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


namespace {

/** The same PC scope, over refunds `r` instead of payments `p`. */
std::string refundScope(std::string sql) {
    const std::string from = "p.terminal_id";
    for (auto at = sql.find(from); at != std::string::npos; at = sql.find(from, at + 1)) {
        sql.replace(at, from.size(), "r.terminal_id");
    }
    return sql;
}

/** Cash (or card) taken on the given PCs since `since`, net of refunds made there. */
Money takings(handlers::Context& ctx, const std::string& method, const std::string& terminalsSql,
              const std::string& terminal, std::int64_t since, std::int64_t until) {
    auto paid = ctx.db().prepare(
        "SELECT COALESCE(SUM(CASE WHEN p.method = :method THEN p.amount_minor + p.tip_minor "
        "  WHEN p.method = 'mixed' THEN COALESCE((SELECT SUM(t.amount_minor + t.tip_minor) "
        "    FROM payment_tenders t WHERE t.payment_id = p.id AND t.method = :method), 0) "
        "  ELSE 0 END), 0) FROM payments p "
        "WHERE p.status = 'approved' AND p.created_at >= :since AND p.created_at < :until AND " + terminalsSql);
    paid.bind(":method", method).bind(":since", since).bind(":until", until);
    if (terminalsSql.find(":terminal") != std::string::npos) paid.bind(":terminal", terminal);
    paid.step();
    auto back = ctx.db().prepare(
        "SELECT COALESCE(SUM(r.amount_minor), 0) FROM refunds r "
        "WHERE r.status = 'completed' AND r.method = :method AND r.created_at >= :since "
        "  AND r.created_at < :until AND " + refundScope(terminalsSql));
    back.bind(":method", method).bind(":since", since).bind(":until", until);
    if (terminalsSql.find(":terminal") != std::string::npos) back.bind(":terminal", terminal);
    back.step();
    return paid.columnInt(0) - back.columnInt(0);
}

}  // namespace

std::string CashService::resolveAccount(const std::string& accountId) {
    if(!accountId.empty()) return accountId;
    auto q=ctx_.db().prepare("SELECT id FROM cash_accounts WHERE kind='till' AND active=1 AND terminal_id=:t LIMIT 1");
    q.bind(":t",ctx_.saleTerminalId());return q.step()?q.columnText(0):std::string{};
}

void CashService::accountMove(const std::string& accountId, Money amountMinor, std::string_view kind,
                              std::string_view refType, std::string_view refId,
                              std::string_view note) {
    const auto resolved = resolveAccount(accountId);
    if (resolved.empty() || amountMinor == 0) return;
    auto account = ctx_.db().prepare("SELECT 1 FROM cash_accounts WHERE id = :id AND active = 1");
    account.bind(":id", resolved);
    if (!account.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Kassa tapılmadı");
    }
    auto insert = ctx_.db().prepare(
        "INSERT INTO cash_account_moves (id, account_id, amount_minor, kind, ref_type, ref_id, note, "
        "                                actor_user_id, created_at) "
        "VALUES (:id, :account, :amount, :kind, :refType, :refId, :note, :actor, :now)");
    insert.bind(":id", crypto::uuid4()).bind(":account", resolved).bind(":amount", amountMinor)
        .bind(":kind", std::string(kind)).bind(":refType", std::string(refType))
        .bind(":refId", std::string(refId)).bind(":note", std::string(note))
        .bindOptional(":actor", ctx_.session().userId).bind(":now", nowMs());
    insert.exec();
}

Money CashService::accountBalance(const std::string& accountId) {
    auto row = ctx_.db().prepare(
        "SELECT kind, terminal_id, COALESCE(object_id, ''), created_at FROM cash_accounts WHERE id = :id");
    row.bind(":id", accountId);
    if (!row.step()) return 0;
    const auto kind = row.columnText(0);
    const auto terminal = row.columnText(1);
    const auto object = row.columnText(2);
    const auto since = row.columnInt(3);

    auto moves = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM cash_account_moves WHERE account_id = :id");
    moves.bind(":id", accountId);
    moves.step();
    Money balance = moves.columnInt(0);
    const std::int64_t forever = std::numeric_limits<std::int64_t>::max();
    if (kind == "till" && !terminal.empty()) {
        balance += takings(ctx_, "cash", "p.terminal_id = :terminal", terminal, since, forever);
    } else if (kind == "bank") {
        balance += takings(ctx_, "card", bankScope(object), object, since, forever);
    }
    return balance;
}

std::string CashService::bankScope(const std::string& objectId) {
    // A bank tied to a branch takes the card money of that branch's tills;
    // one with no branch takes it all.
    if (objectId.empty()) return "1 = 1";
    return "p.terminal_id IN (SELECT a.terminal_id FROM cash_accounts a WHERE a.object_id = :terminal "
           "AND a.kind = 'till' AND a.active = 1 AND a.terminal_id != '')";
}

Money CashService::takingsFor(const std::string& method, const std::string& terminalsSql,
                              const std::string& bindValue, std::int64_t from, std::int64_t to) {
    return takings(ctx_, method, terminalsSql, bindValue, from, to);
}

}  // namespace pos::services
