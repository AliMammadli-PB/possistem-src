#include "pos/services/PaymentService.hpp"

#include <algorithm>
#include <array>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/OrderService.hpp"

namespace pos::services {
namespace {

using PS = PaymentStatus;

struct Transition {
    PS from;
    PS to;
};

/**
 * The complete set of legal moves. Anything absent is rejected.
 */
constexpr std::array<Transition, 20> kLegalTransitions{{
    // Cash settles immediately; card goes out to the terminal.
    {PS::Created, PS::Approved},
    {PS::Created, PS::WaitingForTerminal},
    {PS::Created, PS::Canceled},
    {PS::Created, PS::Declined},

    {PS::WaitingForTerminal, PS::Processing},
    {PS::WaitingForTerminal, PS::Approved},
    {PS::WaitingForTerminal, PS::Declined},
    {PS::WaitingForTerminal, PS::Canceled},
    // Dispatch timed out: we genuinely do not know whether the card was charged.
    {PS::WaitingForTerminal, PS::Unknown},

    {PS::Processing, PS::Approved},
    {PS::Processing, PS::Declined},
    {PS::Processing, PS::Canceled},
    {PS::Processing, PS::Unknown},

    // Reconciliation resolves an unknown, or fails and leaves it unknown.
    {PS::Unknown, PS::Approved},
    {PS::Unknown, PS::Declined},
    {PS::Unknown, PS::Canceled},
    {PS::Unknown, PS::Unknown},

    {PS::Approved, PS::Refunded},

    // Idempotent no-ops, so a replayed transition is not an error.
    {PS::Approved, PS::Approved},
    {PS::Declined, PS::Declined},
}};

}  // namespace

bool isLegalPaymentTransition(PaymentStatus from, PaymentStatus to) {
    for (const auto& transition : kLegalTransitions) {
        if (transition.from == from && transition.to == to) return true;
    }
    return false;
}

PaymentStatus PaymentService::statusOf(const std::string& paymentId) {
    auto stmt = ctx_.db().prepare("SELECT status FROM payments WHERE id = :paymentId");
    stmt.bind(":paymentId", paymentId);
    if (!stmt.step()) throw PosError::of(protocol::err::kPaymentNotFound);

    PaymentStatus status{};
    if (!protocol::parsePaymentStatus(stmt.columnText(0), status)) {
        throw PosError(std::string(protocol::err::kInternal),
                       "Payment row holds an unrecognised status");
    }
    return status;
}

void PaymentService::applyTransition(const std::string& paymentId, PaymentStatus to,
                                     std::string_view reason, std::string_view terminalRef,
                                     std::string_view rawResponse) {
    const PaymentStatus from = statusOf(paymentId);

    if (!isLegalPaymentTransition(from, to)) {
        throw PosError(std::string(protocol::err::kPaymentState),
                       "Cannot move a payment from " + std::string(protocol::toString(from)) +
                           " to " + std::string(protocol::toString(to)));
    }

    const auto now = nowMs();

    auto update = ctx_.db().prepare(
        "UPDATE payments SET status = :status, updated_at = :now, "
        "       terminal_ref = CASE WHEN :ref != '' THEN :ref ELSE terminal_ref END "
        "WHERE id = :paymentId");
    update.bind(":status", std::string(protocol::toString(to)))
        .bind(":now", now)
        .bind(":ref", std::string(terminalRef))
        .bind(":paymentId", paymentId);
    update.exec();

    // The event is written in the same transaction as the state change: an
    // audit trail that can lag behind the truth is worse than none.
    auto event = ctx_.db().prepare(
        "INSERT INTO payment_events (id, payment_id, from_state, to_state, reason, "
        "        actor_user_id, terminal_ref, raw_response, created_at) "
        "VALUES (:id, :paymentId, :from, :to, :reason, :actor, :ref, :raw, :now)");
    event.bind(":id", crypto::uuid4())
        .bind(":paymentId", paymentId)
        .bind(":from", std::string(protocol::toString(from)))
        .bind(":to", std::string(protocol::toString(to)))
        .bind(":reason", std::string(reason))
        .bindOptional(":actor", ctx_.session().userId)
        .bind(":ref", std::string(terminalRef))
        .bind(":raw", std::string(rawResponse))
        .bind(":now", now);
    event.exec();
}

Json PaymentService::load(const std::string& paymentId) {
    auto stmt = ctx_.db().prepare(
        "SELECT p.id, p.order_id AS orderId, p.method, p.status, "
        "       p.amount_minor AS amountMinor, p.tip_minor AS tipMinor, "
        "       p.tendered_minor AS tenderedMinor, p.change_minor AS changeMinor, "
        "       p.seat, p.terminal_ref AS terminalRef, p.card_last4 AS cardLast4, "
        "       p.parent_payment_id AS parentPaymentId, p.attempt, "
        "       p.resolution_note AS resolutionNote, p.created_at AS createdAt, "
        "       p.updated_at AS updatedAt, u.full_name AS cashierName "
        "FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = :paymentId");
    stmt.bind(":paymentId", paymentId);

    if (!stmt.step()) throw PosError::of(protocol::err::kPaymentNotFound);

    Json payment = stmt.row();

    auto events = ctx_.db().prepare(
        "SELECT from_state AS fromState, to_state AS toState, reason, created_at AS createdAt "
        "FROM payment_events WHERE payment_id = :paymentId ORDER BY created_at");
    events.bind(":paymentId", paymentId);
    payment["events"] = events.rows();

    return payment;
}

Money PaymentService::netCollected(const std::string& orderId) {
    auto stmt = ctx_.db().prepare(
        "SELECT COALESCE((SELECT SUM(amount_minor) FROM payments "
        "                 WHERE order_id = :orderId AND status IN ('approved','refunded')), 0), "
        "       COALESCE((SELECT SUM(amount_minor) FROM refunds "
        "                 WHERE order_id = :orderId AND status = 'completed'), 0)");
    stmt.bind(":orderId", orderId);
    if (!stmt.step()) return 0;

    const Money approved = stmt.columnInt(0);
    const Money refunded = stmt.columnInt(1);

    // The refund ledger is authoritative, including for partial refunds.
    // Payments marked `refunded` stay in the approved pot so a full refund is
    // subtracted once rather than twice. Unknown payments never count as paid.
    return std::max<Money>(0, approved - refunded);
}

Money PaymentService::outstanding(const std::string& orderId) {
    auto stmt = ctx_.db().prepare("SELECT total_minor FROM orders WHERE id = :orderId");
    stmt.bind(":orderId", orderId);
    if (!stmt.step()) throw PosError::of(protocol::err::kOrderNotFound);

    return std::max<Money>(0, stmt.columnInt(0) - netCollected(orderId));
}

int PaymentService::unresolvedCount(const std::string& orderId) {
    auto stmt = ctx_.db().prepare(
        "SELECT COUNT(*) FROM payments WHERE order_id = :orderId AND status = 'unknown'");
    stmt.bind(":orderId", orderId);
    return stmt.step() ? static_cast<int>(stmt.columnInt(0)) : 0;
}

void PaymentService::refreshOrderPaymentStatus(const std::string& orderId) {
    OrderService orders(ctx_);
    orders.recalculate(orderId);

    const Money remaining = outstanding(orderId);

    auto current = ctx_.db().prepare(
        "SELECT status, table_id FROM orders WHERE id = :orderId");
    current.bind(":orderId", orderId);
    if (!current.step()) return;
    const std::string status = current.columnText(0);
    const std::string tableId = current.columnText(1);

    // Closed and voided orders are final; never reopen them from here.
    if (status == "closed" || status == "voided") return;

    auto paidCount = ctx_.db().prepare(
        "SELECT COUNT(*) FROM payments WHERE order_id = :orderId AND status = 'approved'");
    paidCount.bind(":orderId", orderId);
    const bool anyPaid = paidCount.step() && paidCount.columnInt(0) > 0;

    const auto now = nowMs();

    // Fully settled with no unresolved card rows → close immediately and free the table.
    if (remaining == 0 && anyPaid && unresolvedCount(orderId) == 0) {
        auto update = ctx_.db().prepare(
            "UPDATE orders SET status = 'closed', closed_at = :now, updated_at = :now "
            "WHERE id = :orderId");
        update.bind(":now", now).bind(":orderId", orderId);
        update.exec();

        // The normal way a bill ends is its last payment, not the Close button;
        // without this, a paid dish never left the store.
        InventoryService(ctx_).consumeOnClose(orderId);

        if (!tableId.empty()) {
            auto table = ctx_.db().prepare(
                "UPDATE restaurant_tables SET status = 'available', updated_at = :now "
                "WHERE id = :tableId");
            table.bind(":now", now).bind(":tableId", tableId);
            table.exec();

            auto unmerge = ctx_.db().prepare(
                "UPDATE restaurant_tables SET merged_into_id = NULL, updated_at = :now, "
                "       row_version = row_version + 1 WHERE merged_into_id = :tableId");
            unmerge.bind(":now", now).bind(":tableId", tableId);
            unmerge.exec();
        }

        orders.logEvent(orderId, "order.closed", Json{{"auto", true}});
        ctx_.enqueueSync("order", orderId, "update", Json{{"status", "closed"}});
        ctx_.audit("order.close", "order", orderId, Json{{"auto", true}});
        if (!tableId.empty()) {
            ctx_.server().emitEvent(protocol::event::kTablesUpdated,
                                    Json{{"tableIds", Json::array({tableId})}});
        }
        return;
    }

    std::string next = status;
    if (remaining == 0 && anyPaid) next = "paid";
    else if (anyPaid) next = "partially_paid";

    if (next != status) {
        auto update = ctx_.db().prepare(
            "UPDATE orders SET status = :status, updated_at = :now WHERE id = :orderId");
        update.bind(":status", next).bind(":now", now).bind(":orderId", orderId);
        update.exec();
    }
}

}  // namespace pos::services
