#include "pos/services/RefundService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"

namespace pos::services {

Money RefundService::totalRefunded(const std::string& paymentId) {
    auto stmt = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM refunds "
        "WHERE payment_id = :id AND status = 'completed'");
    stmt.bind(":id", paymentId);
    stmt.step();
    return stmt.columnInt(0);
}

Money RefundService::remainingRefundable(const std::string& paymentId) {
    auto payment = ctx_.db().prepare(
        "SELECT amount_minor, status FROM payments WHERE id = :id");
    payment.bind(":id", paymentId);
    if (!payment.step()) {
        throw PosError(std::string(protocol::err::kPaymentNotFound), "Payment was not found");
    }
    const auto status = payment.columnText(1);
    if (status != "approved" && status != "refunded") {
        throw PosError(std::string(protocol::err::kPaymentState),
                       "Only approved payments can be refunded");
    }
    const Money original = payment.columnInt(0);
    const Money refunded = totalRefunded(paymentId);
    return original > refunded ? original - refunded : 0;
}

/**
 * What one line of a bill is still worth refunding.
 *
 * Priced from the stored snapshot, so a menu price change since the guest paid
 * cannot alter what goes back, and capped by whatever of that line has already
 * been returned.
 */
namespace {

struct LinePrice {
    Money amountMinor = 0;
    std::int64_t quantity = 0;
    std::string name;
};

}  // namespace

Json RefundService::createRefund(const std::string& paymentId, Money amountMinor,
                                 std::string_view reason, const std::string& approvedBy,
                                 const std::string& idempotencyKey,
                                 const std::vector<RefundLine>& lines) {
    if (reason.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "A refund reason is required");
    }

    auto payment = ctx_.db().prepare(
        "SELECT id, order_id, method, amount_minor, tip_minor, business_day_id, status "
        "FROM payments WHERE id = :id");
    payment.bind(":id", paymentId);
    if (!payment.step()) {
        throw PosError(std::string(protocol::err::kPaymentNotFound), "Payment was not found");
    }
    if (payment.columnText(6) != "approved") {
        throw PosError(std::string(protocol::err::kPaymentState),
                       "Only approved payments can be refunded");
    }

    const std::string orderId = payment.columnText(1);
    const std::string method = payment.columnText(2);
    const Money original = payment.columnInt(3);
    const std::string paidOnDay = payment.columnIsNull(5) ? "" : payment.columnText(5);
    const auto remaining = remainingRefundable(paymentId);

    // Price the disputed lines from the order's own snapshot. Doing this before
    // the cap check means an item refund is bounded by the payment too.
    std::vector<LinePrice> priced;
    Money lineTotal = 0;
    for (const auto& line : lines) {
        if (line.quantity <= 0) {
            throw PosError(std::string(protocol::err::kValidation),
                           "Qaytarılan miqdar sıfırdan böyük olmalıdır");
        }
        auto item = ctx_.db().prepare(
            "SELECT quantity, line_total_minor, name_snapshot, status "
            "FROM order_items WHERE id = :id AND order_id = :order");
        item.bind(":id", line.orderItemId).bind(":order", orderId);
        if (!item.step()) {
            throw PosError(std::string(protocol::err::kNotFound), "Sifarişdə bu məhsul yoxdur");
        }
        if (item.columnText(3) == "voided") {
            throw PosError(std::string(protocol::err::kValidation),
                           "Ləğv edilmiş sətir qaytarıla bilməz");
        }
        const auto soldQuantity = item.columnInt(0);
        const Money soldTotal = item.columnInt(1);
        if (soldQuantity <= 0) {
            throw PosError(std::string(protocol::err::kValidation), "Sətir miqdarı yoxdur");
        }

        auto already = ctx_.db().prepare(
            "SELECT COALESCE(SUM(ri.quantity), 0) FROM refund_items ri "
            "JOIN refunds r ON r.id = ri.refund_id "
            "WHERE ri.order_item_id = :id AND r.status = 'completed'");
        already.bind(":id", line.orderItemId);
        already.step();
        const auto refundedQuantity = already.columnInt(0);

        if (line.quantity > soldQuantity - refundedQuantity) {
            throw PosError(std::string(protocol::err::kRefundLimit),
                           "Bu məhsuldan artıq qaytarıla bilməz",
                           Json{{"orderItemId", line.orderItemId},
                                {"soldQuantity", soldQuantity},
                                {"refundedQuantity", refundedQuantity}});
        }

        // Half-up on the unit price, then the last unit of a line takes the
        // residual, so refunding every unit returns exactly what was charged.
        const Money unit = (soldTotal + soldQuantity / 2) / soldQuantity;
        const bool clearsLine = line.quantity == soldQuantity - refundedQuantity;
        const Money amount =
            clearsLine ? soldTotal - unit * refundedQuantity : unit * line.quantity;

        priced.push_back({amount, line.quantity, item.columnText(2)});
        lineTotal += amount;
    }

    const Money refundAmount =
        !lines.empty() ? lineTotal : (amountMinor > 0 ? amountMinor : remaining);

    if (refundAmount <= 0 || refundAmount > remaining) {
        throw PosError(std::string(protocol::err::kRefundLimit),
                       "Refund exceeds remaining refundable amount",
                       Json{{"remainingMinor", remaining}, {"requestedMinor", refundAmount}});
    }

    const std::string refundId = crypto::uuid4();
    const auto now = nowMs();

    // Stamped with the till that is open now, not the one the guest paid on.
    // A dispute days later used to be booked into a business day already
    // Z-closed, where no report would ever pick it up again.
    BusinessDayService days(ctx_);
    const std::string refundDay = days.ensureOpenBusinessDayId();

    auto insert = ctx_.db().prepare(
        "INSERT INTO refunds ("
        "  id, order_id, payment_id, business_day_id, amount_minor, tip_refund_minor,"
        "  reason, status, method, actor_user_id, approved_by, idempotency_key,"
        "  created_at, updated_at"
        ") VALUES ("
        "  :id, :order, :payment, :day, :amount, 0, :reason, 'completed', :method,"
        "  :actor, :approved, :idem, :now, :now)");
    insert.bind(":id", refundId)
        .bind(":order", orderId)
        .bind(":payment", paymentId)
        .bindOptional(":day", refundDay)
        .bind(":amount", refundAmount)
        .bind(":reason", std::string(reason))
        .bind(":method", method)
        .bindOptional(":actor", ctx_.session().userId)
        .bindOptional(":approved", approvedBy)
        .bindOptional(":idem", idempotencyKey)
        .bind(":now", now);
    insert.exec();

    // Which dish went back. The table has existed since the refund schema
    // landed and nothing ever wrote to it, so a refund could not say what it
    // was for - exactly the question a disputed receipt raises.
    for (std::size_t i = 0; i < priced.size(); ++i) {
        auto row = ctx_.db().prepare(
            "INSERT INTO refund_items (id, refund_id, order_item_id, quantity, amount_minor, "
            "                          name_snapshot) "
            "VALUES (:id, :refund, :item, :qty, :amount, :name)");
        row.bind(":id", crypto::uuid4())
            .bind(":refund", refundId)
            .bind(":item", lines[i].orderItemId)
            .bind(":qty", priced[i].quantity)
            .bind(":amount", priced[i].amountMinor)
            .bind(":name", priced[i].name);
        row.exec();
    }

    // Cash actually leaves the drawer, so the drawer's log has to say so. Booked
    // as cash_out with a refund reason: the movement `kind` check constraint has
    // no 'refund' value, and the reason is what lets the cash report keep
    // subtracting refunds once (via the refunds ledger) instead of twice.
    if (method == "cash") {
        auto movement = ctx_.db().prepare(
            "INSERT INTO cash_movements (id, business_day_id, shift_id, kind, amount_minor, "
            "                            reason, note, actor_user_id, approved_by, created_at) "
            "VALUES (:id, :day, :shift, 'cash_out', :amount, :reason, :note, :actor, :approved, "
            "        :now)");
        movement.bind(":id", crypto::uuid4())
            .bindOptional(":day", refundDay)
            .bindOptional(":shift", ctx_.session().shiftId)
            .bind(":amount", refundAmount)
            .bind(":reason", std::string(kRefundMovementReason))
            .bind(":note", std::string(reason))
            .bindOptional(":actor", ctx_.session().userId)
            .bindOptional(":approved", approvedBy)
            .bind(":now", now);
        movement.exec();
    }

    // Original payment row stays approved; ledger is authoritative for partials.
    // Only when fully refunded do we mark the payment for legacy report filters.
    if (totalRefunded(paymentId) >= original) {
        auto mark = ctx_.db().prepare(
            "UPDATE payments SET status = 'refunded', updated_at = :now WHERE id = :id");
        mark.bind(":now", now).bind(":id", paymentId);
        mark.exec();
    }

    ctx_.auditRequired("payment.refund", "refund", refundId,
                       Json{{"paymentId", paymentId},
                            {"orderId", orderId},
                            {"amountMinor", refundAmount},
                            {"reason", std::string(reason)},
                            {"remainingMinor", remainingRefundable(paymentId)}});

    return Json{{"refundId", refundId},
                {"refund", listForPayment(paymentId)["refunds"].back()},
                {"paymentId", paymentId},
                {"orderId", orderId},
                {"amountMinor", refundAmount},
                {"businessDayId", refundDay},
                {"paidOnBusinessDayId", paidOnDay},
                {"remainingMinor", remainingRefundable(paymentId)}};
}

Json RefundService::listForPayment(const std::string& paymentId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id, order_id AS orderId, payment_id AS paymentId, amount_minor AS amountMinor, "
        "       reason, status, method, actor_user_id AS actorUserId, "
        "       approved_by AS approvedBy, created_at AS createdAt "
        "FROM refunds WHERE payment_id = :id ORDER BY created_at");
    stmt.bind(":id", paymentId);
    return Json{{"refunds", stmt.rows()},
                {"totalRefundedMinor", totalRefunded(paymentId)},
                {"remainingMinor", remainingRefundable(paymentId)}};
}

}  // namespace pos::services
