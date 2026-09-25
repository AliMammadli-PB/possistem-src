#include "pos/services/SplitBillService.hpp"

#include <algorithm>
#include <numeric>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/PaymentService.hpp"

namespace pos::services {

Json SplitBillService::createEqualSplit(const std::string& orderId, int parts) {
    if (parts < 2 || parts > 50) {
        throw PosError(std::string(protocol::err::kValidation), "parts must be between 2 and 50");
    }

    OrderService orders(ctx_);
    orders.recalculate(orderId);
    auto order = orders.load(orderId);
    const Money total = order.value("totalMinor", 0);
    if (total <= 0) {
        throw PosError(std::string(protocol::err::kValidation), "Order total must be positive");
    }

    const Money base = total / parts;
    Money remainder = total - (base * parts);

    Json partsJson = Json::array();
    std::vector<Money> amounts;
    amounts.reserve(static_cast<std::size_t>(parts));
    for (int i = 0; i < parts; ++i) {
        Money amount = base;
        if (remainder > 0) {
            ++amount;
            --remainder;
        }
        amounts.push_back(amount);
        partsJson.push_back(Json{{"label", "Part " + std::to_string(i + 1)},
                                 {"amountMinor", amount},
                                 {"sortOrder", i}});
    }

    // Sanity: sum equals total (deterministic remainder to first parts).
    const Money sum = std::accumulate(amounts.begin(), amounts.end(), Money{0});
    if (sum != total) {
        throw PosError(std::string(protocol::err::kInternal), "Split rounding failed");
    }

    return createCustomSplit(orderId, partsJson, "equal");
}

Json SplitBillService::createCustomSplit(const std::string& orderId, const Json& parts,
                                         const std::string& kindIn) {
    if (!parts.is_array() || parts.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "parts array is required");
    }

    OrderService orders(ctx_);
    orders.recalculate(orderId);
    const Money total = orders.load(orderId).value("totalMinor", 0);

    Money sum = 0;
    for (const auto& part : parts) {
        sum += part.value("amountMinor", 0);
    }
    if (sum != total) {
        throw PosError(std::string(protocol::err::kValidation),
                       "Split parts must sum to the order total");
    }

    const std::string splitId = crypto::uuid4();
    const auto now = nowMs();
    auto ins = ctx_.db().prepare(
        "INSERT INTO bill_splits (id, order_id, kind, status, parts_json, created_by, "
        "created_at, updated_at) VALUES (:id, :orderId, :kind, 'open', :parts, :by, :now, :now)");
    // The caller knows how it split the bill; only fall back to guessing from
    // the shape of the parts when it did not say. `equal` and `by_item` are
    // otherwise unreachable even though the schema allows them.
    static const std::vector<std::string> kKinds{"equal", "by_seat", "by_item", "custom"};
    std::string kind = kindIn;
    if (std::find(kKinds.begin(), kKinds.end(), kind) == kKinds.end()) {
        kind = !parts.empty() && parts[0].contains("seat") ? "by_seat" : "custom";
    }
    ins.bind(":id", splitId)
        .bind(":orderId", orderId)
        .bind(":kind", kind)
        .bind(":parts", parts.dump())
        .bindOptional(":by", ctx_.session().userId)
        .bind(":now", now);
    ins.exec();

    int idx = 0;
    for (const auto& part : parts) {
        auto p = ctx_.db().prepare(
            "INSERT INTO bill_split_parts "
            "(id, split_id, label, seat, amount_minor, paid_minor, sort_order) "
            "VALUES (:id, :split, :label, :seat, :amount, 0, :sort)");
        p.bind(":id", crypto::uuid4())
            .bind(":split", splitId)
            .bind(":label", part.value("label", "Part " + std::to_string(idx + 1)))
            .bind(":amount", part.value("amountMinor", 0))
            .bind(":sort", part.value("sortOrder", idx));
        if (part.contains("seat") && !part["seat"].is_null()) {
            p.bind(":seat", part["seat"].get<std::int64_t>());
        } else {
            p.bind(":seat", nullptr);
        }
        p.exec();
        ++idx;
    }

    ctx_.auditRequired("payments.splitBill", "bill_split", splitId,
                       Json{{"orderId", orderId}, {"parts", static_cast<int>(parts.size())}});
    return loadSplit(splitId);
}

Json SplitBillService::loadSplit(const std::string& splitId) {
    auto head = ctx_.db().prepare(
        "SELECT id, order_id AS orderId, kind, status, parts_json AS partsJson, "
        "created_at AS createdAt FROM bill_splits WHERE id = :id");
    head.bind(":id", splitId);
    if (!head.step()) throw PosError::of(protocol::err::kNotFound);
    Json out = head.row();
    auto parts = ctx_.db().prepare(
        "SELECT id, label, seat, amount_minor AS amountMinor, paid_minor AS paidMinor, "
        "payment_id AS paymentId, sort_order AS sortOrder "
        "FROM bill_split_parts WHERE split_id = :id ORDER BY sort_order");
    parts.bind(":id", splitId);
    out["parts"] = parts.rows();
    return out;
}

Json SplitBillService::openSplitForOrder(const std::string& orderId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id FROM bill_splits WHERE order_id = :orderId AND status IN ('open','partial') "
        "ORDER BY created_at DESC LIMIT 1");
    stmt.bind(":orderId", orderId);
    if (!stmt.step()) return Json(nullptr);
    return loadSplit(stmt.columnText(0));
}

void SplitBillService::markPartPaid(const std::string& splitPartId, const std::string& paymentId,
                                    Money amountMinor) {
    if (splitPartId.empty()) return;

    auto part = ctx_.db().prepare(
        "SELECT split_id, amount_minor, paid_minor FROM bill_split_parts WHERE id = :id");
    part.bind(":id", splitPartId);
    if (!part.step()) throw PosError::of(protocol::err::kNotFound);

    const std::string splitId = part.columnText(0);
    const Money partAmount = part.columnInt(1);
    // Never credit a part with more than it is worth: the surplus belongs to the
    // order as a whole, not to this seat.
    const Money paid = std::min(partAmount, part.columnInt(2) + amountMinor);

    auto update = ctx_.db().prepare(
        "UPDATE bill_split_parts SET paid_minor = :paid, payment_id = :paymentId WHERE id = :id");
    update.bind(":paid", paid).bind(":paymentId", paymentId).bind(":id", splitPartId);
    update.exec();

    auto remaining = ctx_.db().prepare(
        "SELECT COUNT(*) FROM bill_split_parts WHERE split_id = :split AND paid_minor < amount_minor");
    remaining.bind(":split", splitId);
    const std::int64_t unpaid = remaining.step() ? remaining.columnInt(0) : 0;

    auto status = ctx_.db().prepare(
        "UPDATE bill_splits SET status = :status, updated_at = :now WHERE id = :split");
    status.bind(":status", unpaid == 0 ? "settled" : "partial")
        .bind(":now", nowMs())
        .bind(":split", splitId);
    status.exec();
}

MixedPreparation SplitBillService::prepareMixedPayment(const std::string& orderId,
                                                       const std::vector<MixedTender>& tenders,
                                                       const std::string& idempotencyKey) {
    if (tenders.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "At least one tender is required");
    }

    OrderService orders(ctx_);
    PaymentService payments(ctx_);
    orders.recalculate(orderId);

    Money totalAmount = 0;
    Money totalTip = 0;
    Money totalTendered = 0;
    Money totalChange = 0;
    Money cardAmount = 0;
    Money cardTip = 0;
    for (const auto& t : tenders) {
        if (t.method != "cash" && t.method != "card" && t.method != "complimentary") {
            throw PosError(std::string(protocol::err::kValidation), "Unknown tender method");
        }
        if (t.amountMinor <= 0) {
            throw PosError(std::string(protocol::err::kValidation), "Tender amount must be positive");
        }
        const Money tip = std::max<Money>(0, t.tipMinor);
        totalAmount += t.amountMinor;
        totalTip += tip;
        // Cash has to cover its own tip, exactly as it does for a plain cash sale.
        const Money tendered = t.method == "cash"
                                   ? std::max(t.tenderedMinor, t.amountMinor + tip)
                                   : t.amountMinor;
        totalTendered += tendered;
        if (t.method == "cash") {
            totalChange += std::max<Money>(0, tendered - t.amountMinor - tip);
        }
        if (t.method == "card") {
            cardAmount += t.amountMinor;
            cardTip += tip;
        }
    }

    const Money remaining = payments.outstanding(orderId);
    if (remaining == 0) {
        throw PosError(std::string(protocol::err::kOrderState), "This order is already fully paid");
    }
    if (totalAmount > remaining) {
        throw PosError(std::string(protocol::err::kOverpayment),
                       "That is more than the outstanding balance");
    }

    // Opens the till if this is the first activity after a Z close, and pulls
    // the order onto that day so the bill and its money report together.
    BusinessDayService days(ctx_);
    const std::string businessDayId = days.ensureOpenBusinessDayId();
    days.adoptOrderIntoDay(orderId, businessDayId);

    const std::string paymentId = crypto::uuid4();
    const auto now = nowMs();
    auto insert = ctx_.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "tendered_minor, change_minor, idempotency_key, user_id, shift_id, business_day_id, "
        "created_at, updated_at, expires_at) VALUES ("
        ":id, :orderId, 'mixed', 'created', :amount, :tip, :tendered, :change, :key, :userId, "
        ":shiftId, :day, :now, :now, :expires)");
    insert.bind(":id", paymentId)
        .bind(":orderId", orderId)
        .bind(":amount", totalAmount)
        .bind(":tip", totalTip)
        .bind(":tendered", totalTendered)
        .bind(":change", totalChange)
        .bindOptional(":key", idempotencyKey)
        .bind(":userId", ctx_.session().userId)
        .bindOptional(":shiftId", ctx_.session().shiftId)
        .bind(":day", businessDayId)
        .bind(":now", now)
        .bind(":expires", now + protocol::limits::kTerminalTimeoutMs);
    insert.exec();

    int sort = 0;
    for (const auto& t : tenders) {
        const Money tip = std::max<Money>(0, t.tipMinor);
        const Money tendered =
            t.method == "cash" ? std::max(t.tenderedMinor, t.amountMinor + tip) : t.amountMinor;
        const Money change =
            t.method == "cash" ? std::max<Money>(0, tendered - t.amountMinor - tip) : 0;
        auto tender = ctx_.db().prepare(
            "INSERT INTO payment_tenders "
            "(id, payment_id, method, amount_minor, tip_minor, tendered_minor, change_minor, "
            "sort_order) VALUES (:id, :payment, :method, :amount, :tip, :tendered, :change, :sort)");
        tender.bind(":id", crypto::uuid4())
            .bind(":payment", paymentId)
            .bind(":method", t.method)
            .bind(":amount", t.amountMinor)
            .bind(":tip", tip)
            .bind(":tendered", tendered)
            .bind(":change", change)
            .bind(":sort", sort++);
        tender.exec();
    }

    ctx_.auditRequired("payment.mixed", "payment", paymentId,
                       Json{{"orderId", orderId},
                            {"amountMinor", totalAmount},
                            {"cardAmountMinor", cardAmount},
                            {"tenderCount", static_cast<int>(tenders.size())}});

    return MixedPreparation{paymentId, cardAmount, cardTip, totalChange};
}

Json SplitBillService::settleMixedPayment(const std::string& orderId,
                                          const std::string& paymentId, PaymentStatus status,
                                          std::string_view reason, std::string_view terminalRef,
                                          std::string_view raw) {
    OrderService orders(ctx_);
    PaymentService payments(ctx_);

    payments.applyTransition(paymentId, status, reason, terminalRef, raw);
    if (status == PaymentStatus::Approved) payments.refreshOrderPaymentStatus(orderId);

    auto tenderRows = ctx_.db().prepare(
        "SELECT id, method, amount_minor AS amountMinor, tip_minor AS tipMinor, "
        "tendered_minor AS tenderedMinor, change_minor AS changeMinor, sort_order AS sortOrder "
        "FROM payment_tenders WHERE payment_id = :id ORDER BY sort_order");
    tenderRows.bind(":id", paymentId);

    auto change = ctx_.db().prepare("SELECT change_minor FROM payments WHERE id = :id");
    change.bind(":id", paymentId);
    const Money changeMinor = change.step() ? change.columnInt(0) : 0;

    return Json{{"payment", payments.load(paymentId)},
                {"tenders", tenderRows.rows()},
                {"order", orders.load(orderId)},
                {"changeMinor", status == PaymentStatus::Approved ? changeMinor : Money{0}}};
}

Json SplitBillService::createMixedPayment(const std::string& orderId,
                                          const std::vector<MixedTender>& tenders,
                                          const std::string& idempotencyKey) {
    const MixedPreparation prepared = prepareMixedPayment(orderId, tenders, idempotencyKey);
    if (prepared.cardAmountMinor > 0) {
        // A card leg needs the terminal, which cannot be driven from inside a
        // transaction; the handler runs prepare/settle around it instead.
        throw PosError(std::string(protocol::err::kValidation),
                       "A mixed payment with a card tender must be settled through the terminal");
    }
    return settleMixedPayment(orderId, prepared.paymentId, PaymentStatus::Approved,
                              "Mixed tender settled");
}

}  // namespace pos::services
