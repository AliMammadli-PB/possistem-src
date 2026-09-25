#include <algorithm>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/payments/TerminalAdapter.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/PaymentService.hpp"
#include "pos/services/RefundService.hpp"
#include "pos/services/SplitBillService.hpp"

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("payment");
    return log;
}

using services::PaymentStatus;

/** Queues the customer receipt once an order is fully settled. */
void queueReceiptIfSettled(Context& ctx, const std::string& orderId) {
    services::PaymentService payments(ctx);
    if (payments.outstanding(orderId) > 0 || payments.unresolvedCount(orderId) > 0) return;

    auto existing = ctx.db().prepare(
        "SELECT COUNT(*) FROM print_jobs WHERE order_id = :orderId AND kind = 'customer_receipt'");
    existing.bind(":orderId", orderId);
    if (existing.step() && existing.columnInt(0) > 0) return;

    const auto now = nowMs();
    auto job = ctx.db().prepare(
        "INSERT INTO print_jobs (id, order_id, kind, target_printer, status, next_attempt_at, "
        "        created_at, updated_at) "
        "VALUES (:id, :orderId, 'customer_receipt', :printer, 'queued', :now, :now, :now)");
    job.bind(":id", crypto::uuid4())
        .bind(":orderId", orderId)
        .bind(":printer", ctx.setting("printer.receipt", "auto"))
        .bind(":now", now);
    job.exec();
}

Money validateAmount(Context& ctx, const std::string& orderId, Money amountMinor) {
    require(amountMinor > 0, "The payment amount must be greater than zero");

    services::OrderService(ctx).recalculate(orderId);
    services::PaymentService payments(ctx);
    const Money remaining = payments.outstanding(orderId);

    if (remaining == 0) {
        throw PosError(std::string(protocol::err::kOrderState),
                       "This order is already fully paid");
    }
    if (amountMinor > remaining) {
        throw PosError(std::string(protocol::err::kOverpayment),
                       "That is more than the outstanding balance");
    }
    return remaining;
}

/**
 * Opens the till if needed and attaches the order to it.
 *
 * Returns the business day every payment on this order must be stamped with.
 * Called inside the caller's transaction, before the money is written.
 */
std::string resolveBusinessDay(Context& ctx, const std::string& orderId) {
    services::BusinessDayService days(ctx);
    const std::string dayId = days.ensureOpenBusinessDayId();
    days.adoptOrderIntoDay(orderId, dayId);
    return dayId;
}

std::string insertPayment(Context& ctx, const std::string& orderId, const std::string& method,
                          Money amountMinor, Money tipMinor, Money tenderedMinor,
                          Money changeMinor, const std::string& idempotencyKey,
                          const Json& payload, const std::string& businessDayId) {
    const std::string paymentId = crypto::uuid4();
    const auto now = nowMs();

    auto insert = ctx.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "        tendered_minor, change_minor, seat, idempotency_key, user_id, shift_id, "
        "        business_day_id, created_at, updated_at, expires_at) "
        "VALUES (:id, :orderId, :method, 'created', :amount, :tip, :tendered, :change, :seat, "
        "        :key, :userId, :shiftId, :day, :now, :now, :expires)");
    insert.bind(":id", paymentId)
        .bind(":orderId", orderId)
        .bind(":method", method)
        .bind(":amount", amountMinor)
        .bind(":tip", tipMinor)
        .bind(":tendered", tenderedMinor)
        .bind(":change", changeMinor)
        .bindOptional(":key", idempotencyKey)
        .bind(":userId", ctx.session().userId)
        .bindOptional(":shiftId", ctx.session().shiftId)
        .bind(":day", businessDayId)
        .bind(":now", now)
        .bind(":expires", now + protocol::limits::kTerminalTimeoutMs);

    if (hasField(payload, "seat")) insert.bind(":seat", payload["seat"].get<std::int64_t>());
    else insert.bind(":seat", nullptr);

    insert.exec();
    return paymentId;
}

}  // namespace

void registerPayments(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(
        std::string(protocol::method::kPaymentsList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.view");
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");

            auto stmt = ctx->db().prepare(
                "SELECT p.id, p.method, p.status, p.amount_minor AS amountMinor, "
                "       p.tip_minor AS tipMinor, p.tendered_minor AS tenderedMinor, "
                "       p.change_minor AS changeMinor, p.seat, p.card_last4 AS cardLast4, "
                "       p.created_at AS createdAt, u.full_name AS cashierName "
                "FROM payments p LEFT JOIN users u ON u.id = p.user_id "
                "WHERE p.order_id = :orderId ORDER BY p.created_at");
            stmt.bind(":orderId", orderId);

            services::PaymentService payments(*ctx);
            return Json{{"payments", stmt.rows()},
                        {"outstandingMinor", payments.outstanding(orderId)},
                        {"unresolvedCount", payments.unresolvedCount(orderId)},
                        // Carried here so the payment screen sees which parts of
                        // a split are still owing without a second round trip.
                        {"split", services::SplitBillService(*ctx).openSplitForOrder(orderId)}};
        });

    server.registerHandler(
        std::string(protocol::method::kPaymentsGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.view");
            return services::PaymentService(*ctx).load(
                getOr<std::string>(request.payload, "paymentId", ""));
        });

    // -------------------------------------------------------------------- cash
    server.registerHandler(
        std::string(protocol::method::kPaymentsCreateCash), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.take");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto amountMinor = getOr<Money>(request.payload, "amountMinor", 0);
            const auto tipMinor = std::max<Money>(0, getOr<Money>(request.payload, "tipMinor", 0));
            const auto tenderedMinor =
                getOr<Money>(request.payload, "tenderedMinor", amountMinor + tipMinor);

            require(!orderId.empty(), "orderId is required");
            // The tip is cash the guest is leaving behind, so it is part of what
            // has to be covered. Ignoring it here told the cashier to hand the
            // tip back as change.
            require(tenderedMinor >= amountMinor + tipMinor,
                    "Tendered amount is less than the payment plus tip");

            services::Idempotency idempotency(*ctx);
            services::PaymentService payments(*ctx);
            Json result;

            {
                db::Transaction txn(ctx->db());

                if (auto replay =
                        idempotency.begin(request.idempotencyKey,
                                          std::string(protocol::method::kPaymentsCreateCash),
                                          request.payload)) {
                    txn.commit();
                    return *replay;
                }

                validateAmount(*ctx, orderId, amountMinor);

                const std::string businessDayId = resolveBusinessDay(*ctx, orderId);

                const Money change = tenderedMinor - amountMinor - tipMinor;
                const std::string paymentId =
                    insertPayment(*ctx, orderId, "cash", amountMinor, tipMinor, tenderedMinor,
                                  change, request.idempotencyKey, request.payload, businessDayId);

                // Cash needs no terminal, so it settles inside the same transaction.
                payments.applyTransition(paymentId, PaymentStatus::Approved, "Cash tendered");
                services::SplitBillService(*ctx).markPartPaid(
                    getOr<std::string>(request.payload, "splitPartId", ""), paymentId, amountMinor);
                payments.refreshOrderPaymentStatus(orderId);
                queueReceiptIfSettled(*ctx, orderId);

                ctx->auditRequired("payment.cash", "payment", paymentId,
                           Json{{"orderId", orderId}, {"amountMinor", amountMinor}});
                ctx->enqueueSync("payment", paymentId, "create", Json{{"method", "cash"}});

                result = Json{{"payment", payments.load(paymentId)},
                              {"order", services::OrderService(*ctx).load(orderId)},
                              {"changeMinor", change}};
                idempotency.complete(request.idempotencyKey, result, "payment", paymentId);
                txn.commit();
            }

            // Print after the payment commit so a printer failure cannot roll back cash.
            drainPrintQueue(*ctx);
            ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"orderId", orderId}});
            ctx->server().emitEvent(protocol::event::kOrdersUpdated, Json{{"orderIds", {orderId}}});
            return result;
        });

    // -------------------------------------------------------------------- card
    //
    // Genuinely two-phase, because a terminal round trip cannot happen inside a
    // transaction. Phase A commits the payment as waiting_for_terminal, so if
    // the process dies mid-authorisation the startup sweep finds the row and
    // promotes it to `unknown` rather than losing it.
    server.registerHandler(
        std::string(protocol::method::kPaymentsCreateCard), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.take");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto amountMinor = getOr<Money>(request.payload, "amountMinor", 0);
            const auto tipMinor = std::max<Money>(0, getOr<Money>(request.payload, "tipMinor", 0));
            require(!orderId.empty(), "orderId is required");

            services::Idempotency idempotency(*ctx);
            services::PaymentService payments(*ctx);

            std::string paymentId;
            std::string reference;

            // ---- Phase A: durable intent -----------------------------------
            {
                db::Transaction txn(ctx->db());

                if (auto replay =
                        idempotency.begin(request.idempotencyKey,
                                          std::string(protocol::method::kPaymentsCreateCard),
                                          request.payload)) {
                    txn.commit();
                    return *replay;
                }

                validateAmount(*ctx, orderId, amountMinor);

                // Stamped in phase A only. Phase C runs after the terminal round
                // trip and could land the other side of a Z close; re-resolving
                // there would move the money onto a day that was already closed.
                const std::string businessDayId = resolveBusinessDay(*ctx, orderId);

                paymentId = insertPayment(*ctx, orderId, "card", amountMinor, tipMinor, 0, 0,
                                          request.idempotencyKey, request.payload, businessDayId);
                reference = "TX-" + crypto::shortCode(10);

                payments.applyTransition(paymentId, PaymentStatus::WaitingForTerminal,
                                         "Sent to card terminal", reference);
                txn.commit();
            }

            // ---- Phase B: the terminal, with no lock held -------------------
            const int terminalTimeout = static_cast<int>(protocol::limits::kTerminalAckTimeoutMs);
            const auto outcome = payments::MockTerminal::instance().authorize(
                amountMinor, tipMinor, reference, terminalTimeout);

            // ---- Phase C: record what happened ------------------------------
            Json result;
            {
                db::Transaction txn(ctx->db());

                switch (outcome.outcome) {
                    case payments::TerminalOutcome::Approved: {
                        auto card = ctx->db().prepare(
                            "UPDATE payments SET card_last4 = :last4 WHERE id = :paymentId");
                        card.bind(":last4", outcome.cardLast4).bind(":paymentId", paymentId);
                        card.exec();

                        payments.applyTransition(paymentId, PaymentStatus::Approved,
                                                 outcome.message, outcome.reference, outcome.raw);
                        services::SplitBillService(*ctx).markPartPaid(
                            getOr<std::string>(request.payload, "splitPartId", ""), paymentId,
                            amountMinor);
                        payments.refreshOrderPaymentStatus(orderId);
                        queueReceiptIfSettled(*ctx, orderId);
                        ctx->auditRequired("payment.card_approved", "payment", paymentId,
                                   Json{{"orderId", orderId}, {"amountMinor", amountMinor}});
                        break;
                    }
                    case payments::TerminalOutcome::Declined:
                        payments.applyTransition(paymentId, PaymentStatus::Declined,
                                                 outcome.message, outcome.reference, outcome.raw);
                        ctx->auditRequired("payment.card_declined", "payment", paymentId,
                                   Json{{"orderId", orderId}});
                        break;

                    case payments::TerminalOutcome::Canceled:
                        payments.applyTransition(paymentId, PaymentStatus::Canceled,
                                                 outcome.message, outcome.reference);
                        break;

                    case payments::TerminalOutcome::Timeout:
                    case payments::TerminalOutcome::Unreachable:
                        // NOT declined. We do not know whether the card was
                        // charged, and guessing "failed" is how a restaurant
                        // ends up serving a meal it was actually paid for -
                        // or charging twice.
                        payments.applyTransition(paymentId, PaymentStatus::Unknown,
                                                 outcome.message, outcome.reference);
                        ctx->auditRequired("payment.card_unknown", "payment", paymentId,
                                   Json{{"orderId", orderId}, {"reason", outcome.message}});
                        logger()->warn("payment {} is unresolved: {}", paymentId, outcome.message);
                        break;
                }

                result = Json{{"payment", payments.load(paymentId)},
                              {"order", services::OrderService(*ctx).load(orderId)}};
                idempotency.complete(request.idempotencyKey, result, "payment", paymentId);
                txn.commit();
            }

            if (outcome.outcome == payments::TerminalOutcome::Timeout ||
                outcome.outcome == payments::TerminalOutcome::Unreachable) {
                ctx->server().emitEvent(protocol::event::kPaymentNeedsReconciliation,
                                        Json{{"paymentId", paymentId}, {"orderId", orderId}});
            }
            if (outcome.outcome == payments::TerminalOutcome::Approved) {
                drainPrintQueue(*ctx);
                ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"orderId", orderId}});
            }
            ctx->server().emitEvent(protocol::event::kOrdersUpdated, Json{{"orderIds", {orderId}}});

            return result;
        });

    // ------------------------------------------------------------------ cancel
    server.registerHandler(
        std::string(protocol::method::kPaymentsCancel), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.take");
            const auto paymentId = getOr<std::string>(request.payload, "paymentId", "");

            services::PaymentService payments(*ctx);
            db::Transaction txn(ctx->db());

            payments.applyTransition(paymentId, PaymentStatus::Canceled, "Canceled by cashier");
            Json result = payments.load(paymentId);
            ctx->auditRequired("payment.cancel", "payment", paymentId);
            txn.commit();

            return result;
        });

    // ------------------------------------------------------------- reconcile
    server.registerHandler(
        std::string(protocol::method::kPaymentsReconcile), [ctx](const ipc::Request& request) {
            const auto paymentId = getOr<std::string>(request.payload, "paymentId", "");
            const auto resolution = getOr<std::string>(request.payload, "resolution", "");
            const auto managerPin = getOr<std::string>(request.payload, "managerPin", "");
            const auto note = getOr<std::string>(request.payload, "note", "");

            const std::string approver = ctx->requireManagerApproval(
                "payment.reconcile", managerPin, "payments.reconcile");

            services::PaymentService payments(*ctx);
            Json result;
            std::string orderId;
            bool shouldPrint = false;

            {
                db::Transaction txn(ctx->db());

                auto lookup = ctx->db().prepare(
                    "SELECT order_id, terminal_ref FROM payments WHERE id = :paymentId");
                lookup.bind(":paymentId", paymentId);
                if (!lookup.step()) throw PosError::of(protocol::err::kPaymentNotFound);
                orderId = lookup.columnText(0);
                const std::string reference = lookup.columnText(1);

                PaymentStatus target{};
                std::string reason;

                if (resolution == "query") {
                    // Ask the terminal again rather than making a human guess.
                    const auto queried = payments::MockTerminal::instance().queryStatus(reference);
                    switch (queried.outcome) {
                        case payments::TerminalOutcome::Approved:
                            target = PaymentStatus::Approved;
                            reason = "Terminal confirmed the transaction was approved";
                            break;
                        case payments::TerminalOutcome::Declined:
                            target = PaymentStatus::Declined;
                            reason = "Terminal confirmed the transaction was declined";
                            break;
                        case payments::TerminalOutcome::Canceled:
                            target = PaymentStatus::Canceled;
                            reason = "Terminal confirmed the transaction was canceled";
                            break;
                        default:
                            // Still no answer: leave it unresolved rather than
                            // inventing an outcome for real money.
                            target = PaymentStatus::Unknown;
                            reason = "Terminal still cannot confirm the result";
                            break;
                    }
                } else if (resolution == "approved") {
                    target = PaymentStatus::Approved;
                    reason = "Manually confirmed as approved. " + note;
                } else if (resolution == "declined") {
                    target = PaymentStatus::Declined;
                    reason = "Manually confirmed as declined. " + note;
                } else if (resolution == "canceled") {
                    target = PaymentStatus::Canceled;
                    reason = "Manually canceled. " + note;
                } else {
                    throw PosError(std::string(protocol::err::kValidation),
                                   "resolution must be query, approved, declined or canceled");
                }

                payments.applyTransition(paymentId, target, reason);

                auto record = ctx->db().prepare(
                    "UPDATE payments SET resolved_by = :approver, resolution_note = :note, "
                    "       attempt = attempt + 1, updated_at = :now WHERE id = :paymentId");
                record.bind(":approver", approver)
                    .bind(":note", reason)
                    .bind(":now", nowMs())
                    .bind(":paymentId", paymentId);
                record.exec();

                payments.refreshOrderPaymentStatus(orderId);
                if (target == PaymentStatus::Approved) {
                    queueReceiptIfSettled(*ctx, orderId);
                    shouldPrint = true;
                }

                ctx->auditRequired("payment.reconcile", "payment", paymentId,
                           Json{{"resolution", resolution}, {"note", note}}, approver);

                result = Json{{"payment", payments.load(paymentId)},
                              {"order", services::OrderService(*ctx).load(orderId)}};
                txn.commit();
            }

            if (shouldPrint) {
                drainPrintQueue(*ctx);
                ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"orderId", orderId}});
            }
            ctx->server().emitEvent(protocol::event::kOrdersUpdated, Json{{"orderIds", {orderId}}});
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kPaymentsUnresolved), [ctx](const ipc::Request&) {
            ctx->requirePermission("payment.reconcile");
            auto stmt = ctx->db().prepare(
                "SELECT p.id, p.order_id AS orderId, o.order_number AS orderNumber, "
                "       t.label AS tableLabel, p.amount_minor AS amountMinor, p.status, "
                "       p.terminal_ref AS terminalRef, p.created_at AS createdAt "
                "FROM payments p JOIN orders o ON o.id = p.order_id "
                "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
                "WHERE p.status = 'unknown' ORDER BY p.created_at");
            return Json{{"payments", stmt.rows()}};
        });

    // ------------------------------------------------------------ mixed / split
    server.registerHandler(
        std::string(protocol::method::kPaymentsCreateMixed),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.take");
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            require(!orderId.empty(), "orderId is required");
            require(request.payload.contains("tenders") && request.payload["tenders"].is_array(),
                    "tenders array is required");

            std::vector<services::MixedTender> tenders;
            for (const auto& row : request.payload["tenders"]) {
                services::MixedTender tender;
                tender.method = row.value("method", "");
                tender.amountMinor = row.value("amountMinor", 0);
                tender.tipMinor = row.value("tipMinor", 0);
                tender.tenderedMinor = row.value("tenderedMinor", tender.amountMinor);
                tenders.push_back(tender);
            }

            services::Idempotency idempotency(*ctx);
            services::PaymentService payments(*ctx);
            services::SplitBillService splits(*ctx);

            // Same three phases as a plain card payment: the terminal must not
            // be driven with a write transaction held open, and a lost reply
            // has to leave a durable row behind rather than vanish.
            services::MixedPreparation prepared;
            std::string reference;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kPaymentsCreateMixed),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }
                prepared = splits.prepareMixedPayment(orderId, tenders, request.idempotencyKey);
                if (prepared.cardAmountMinor > 0) {
                    reference = "TX-" + crypto::shortCode(10);
                    payments.applyTransition(prepared.paymentId, PaymentStatus::WaitingForTerminal,
                                             "Mixed card leg sent to terminal", reference);
                }
                txn.commit();
            }

            payments::TerminalResult outcome;
            if (prepared.cardAmountMinor > 0) {
                outcome = payments::MockTerminal::instance().authorize(
                    prepared.cardAmountMinor, prepared.cardTipMinor, reference,
                    static_cast<int>(protocol::limits::kTerminalAckTimeoutMs));
            }

            Json result;
            bool approved = true;
            {
                db::Transaction txn(ctx->db());

                if (prepared.cardAmountMinor == 0) {
                    result = splits.settleMixedPayment(orderId, prepared.paymentId,
                                                       PaymentStatus::Approved,
                                                       "Mixed tender settled");
                } else {
                    switch (outcome.outcome) {
                        case payments::TerminalOutcome::Approved: {
                            auto card = ctx->db().prepare(
                                "UPDATE payments SET card_last4 = :last4 WHERE id = :paymentId");
                            card.bind(":last4", outcome.cardLast4)
                                .bind(":paymentId", prepared.paymentId);
                            card.exec();
                            result = splits.settleMixedPayment(orderId, prepared.paymentId,
                                                               PaymentStatus::Approved,
                                                               outcome.message, outcome.reference,
                                                               outcome.raw);
                            break;
                        }
                        case payments::TerminalOutcome::Declined:
                            approved = false;
                            result = splits.settleMixedPayment(orderId, prepared.paymentId,
                                                               PaymentStatus::Declined,
                                                               outcome.message, outcome.reference,
                                                               outcome.raw);
                            break;
                        case payments::TerminalOutcome::Canceled:
                            approved = false;
                            result = splits.settleMixedPayment(orderId, prepared.paymentId,
                                                               PaymentStatus::Canceled,
                                                               outcome.message, outcome.reference);
                            break;
                        case payments::TerminalOutcome::Timeout:
                        case payments::TerminalOutcome::Unreachable:
                            // Same rule as a card-only sale: an unanswered
                            // terminal is unresolved, never declined.
                            approved = false;
                            result = splits.settleMixedPayment(orderId, prepared.paymentId,
                                                               PaymentStatus::Unknown,
                                                               outcome.message, outcome.reference);
                            break;
                    }
                }

                ctx->auditRequired(approved ? "payment.mixed_approved" : "payment.mixed_unsettled",
                                   "payment", prepared.paymentId,
                                   Json{{"orderId", orderId},
                                        {"cardAmountMinor", prepared.cardAmountMinor}});
                idempotency.complete(request.idempotencyKey, result, "payment",
                                     prepared.paymentId);
                if (approved) queueReceiptIfSettled(*ctx, orderId);
                txn.commit();
            }

            if (!approved && (outcome.outcome == payments::TerminalOutcome::Timeout ||
                              outcome.outcome == payments::TerminalOutcome::Unreachable)) {
                ctx->server().emitEvent(
                    protocol::event::kPaymentNeedsReconciliation,
                    Json{{"paymentId", prepared.paymentId}, {"orderId", orderId}});
            }
            if (approved) {
                drainPrintQueue(*ctx);
                ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"orderId", orderId}});
            }
            ctx->server().emitEvent(protocol::event::kOrdersUpdated, Json{{"orderIds", {orderId}}});
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kPaymentsSplitBill),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.split");
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            require(!orderId.empty(), "orderId is required");

            services::Idempotency idempotency(*ctx);
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kPaymentsSplitBill),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                services::SplitBillService splits(*ctx);
                const auto kind = getOr<std::string>(request.payload, "kind", "");
                if (request.payload.contains("parts") && request.payload["parts"].is_array()) {
                    result = splits.createCustomSplit(orderId, request.payload["parts"], kind);
                } else {
                    result = splits.createEqualSplit(
                        orderId, static_cast<int>(getOr<std::int64_t>(request.payload, "parts", 2)));
                }
                idempotency.complete(request.idempotencyKey, result, "bill_split",
                                     result.value("id", ""));
                txn.commit();
            }
            return result;
        });

    // ------------------------------------------------------------------ refund
    server.registerHandler(
        std::string(protocol::method::kPaymentsRefund), [ctx](const ipc::Request& request) {
            const auto paymentId = getOr<std::string>(request.payload, "paymentId", "");
            const auto amountMinor = getOr<Money>(request.payload, "amountMinor", 0);
            const auto reason = getOr<std::string>(request.payload, "reason", "");
            const auto managerPin = getOr<std::string>(request.payload, "managerPin", "");

            require(!reason.empty(), "A reason is required for a refund");

            const std::string approver =
                ctx->requireManagerApproval("payment.refund", managerPin, "payments.refund");

            services::Idempotency idempotency(*ctx);
            services::PaymentService payments(*ctx);
            services::RefundService refunds(*ctx);
            Json result;
            std::string orderId;

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kPaymentsRefund),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                auto original = ctx->db().prepare(
                    "SELECT order_id, method, status, terminal_ref "
                    "FROM payments WHERE id = :paymentId");
                original.bind(":paymentId", paymentId);
                if (!original.step()) throw PosError::of(protocol::err::kPaymentNotFound);

                orderId = original.columnText(0);
                const std::string method = original.columnText(1);
                const std::string reference = original.columnText(3);

                if (method == "card" && amountMinor > 0) {
                    payments::MockTerminal::instance().refund(amountMinor, reference);
                }

                // Naming lines is how a "I did not order this" dispute is
                // settled: the amount comes from the order's own snapshot, so
                // a caller cannot decide what a dish was worth.
                std::vector<services::RefundService::RefundLine> lines;
                if (request.payload.contains("items") && request.payload["items"].is_array()) {
                    for (const auto& entry : request.payload["items"]) {
                        if (!entry.is_object()) continue;
                        services::RefundService::RefundLine line;
                        line.orderItemId = getOr<std::string>(entry, "orderItemId", "");
                        line.quantity = getOr<std::int64_t>(entry, "quantity", 1);
                        require(!line.orderItemId.empty(), "orderItemId is required");
                        lines.push_back(line);
                    }
                }

                result = refunds.createRefund(paymentId, amountMinor, reason, approver,
                                              request.idempotencyKey, lines);
                payments.refreshOrderPaymentStatus(orderId);
                result["order"] = services::OrderService(*ctx).load(orderId);
                idempotency.complete(request.idempotencyKey, result, "refund",
                                     getOr<std::string>(result, "refundId", paymentId));
                txn.commit();
            }

            ctx->server().emitEvent(protocol::event::kOrdersUpdated, Json{{"orderIds", {orderId}}});
            return result;
        });

    // Developer control over the mock terminal so the decline, timeout and
    // reconciliation paths can be demonstrated without real hardware.
    server.registerHandler(
        std::string(protocol::method::kPaymentsSimulate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("settings.manage");
            const auto mode = getOr<std::string>(request.payload, "mode", "auto");

            static const std::array<std::string, 6> kModes{"auto",    "approve",     "decline",
                                                           "timeout", "unreachable", "cancel"};
            if (std::find(kModes.begin(), kModes.end(), mode) == kModes.end()) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Unknown terminal simulation mode: " + mode);
            }

            payments::MockTerminal::instance().setForcedMode(mode);
            ctx->audit("payment.simulate", "terminal", "mock", Json{{"mode", mode}});
            return Json{{"mode", mode}};
        });
}

}  // namespace pos::handlers
