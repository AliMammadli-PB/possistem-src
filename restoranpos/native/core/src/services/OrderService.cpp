#include "pos/services/OrderService.hpp"

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <map>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/PaymentService.hpp"

namespace pos::services {
namespace {

/** Statuses in which an order still accepts edits. */
bool isEditable(const std::string& status) {
    return status == "draft" || status == "open" || status == "sent" || status == "partially_paid";
}

}  // namespace

TaxConfig OrderService::taxConfig() {
    TaxConfig config;
    config.taxPercent = ctx_.settingInt("finance.taxPercent", 18);
    config.servicePercent = ctx_.settingInt("finance.servicePercent", 10);
    config.taxIncluded = ctx_.settingInt("finance.taxIncluded", 0) != 0;
    return config;
}

std::string OrderService::nextOrderNumber() {
    // Globally unique daily ticket numbers. The previous COUNT(*)+1 scheme
    // reused A-0001 on the next UTC day and hit UNIQUE(order_number).
    std::string dateKey;
    auto day = ctx_.db().prepare(
        "SELECT REPLACE(business_date, '-', '') FROM business_days "
        "WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1");
    if (day.step()) {
        dateKey = day.columnText(0);
    }
    if (dateKey.size() != 8) {
        const auto now = nowMs();
        const std::time_t seconds = static_cast<std::time_t>(now / 1000);
        std::tm tm{};
#ifdef _WIN32
        gmtime_s(&tm, &seconds);
#else
        gmtime_r(&seconds, &tm);
#endif
        char buf[16];
        std::snprintf(buf, sizeof(buf), "%04d%02d%02d", tm.tm_year + 1900, tm.tm_mon + 1,
                      tm.tm_mday);
        dateKey = buf;
    }

    const std::string prefix = "A-" + dateKey + "-";
    const std::string like = prefix + "%";
    auto stmt = ctx_.db().prepare(
        "SELECT COALESCE(MAX(CAST(substr(order_number, :prefixLen) AS INTEGER)), 0) + 1 "
        "FROM orders WHERE order_number LIKE :like");
    stmt.bind(":prefixLen", static_cast<std::int64_t>(prefix.size() + 1))
        .bind(":like", like);
    const std::int64_t next = stmt.step() ? stmt.columnInt(0) : 1;

    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%s%04lld", prefix.c_str(),
                  static_cast<long long>(next > 0 ? next : 1));
    return buffer;
}

std::string OrderService::openOrderIdForTable(const std::string& tableId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id FROM orders WHERE table_id = :tableId "
        "  AND status IN ('draft','open','sent','partially_paid') LIMIT 1");
    stmt.bind(":tableId", tableId);
    return stmt.step() ? stmt.columnText(0) : std::string();
}

Json OrderService::load(const std::string& orderId, bool withItems) {
    auto stmt = ctx_.db().prepare(
        "SELECT o.id, o.order_number AS orderNumber, o.table_id AS tableId, "
        "       t.label AS tableLabel, o.user_id AS userId, u.full_name AS waiterName, "
        "       o.shift_id AS shiftId, o.status, o.guest_count AS guestCount, "
        "       o.subtotal_minor AS subtotalMinor, o.discount_minor AS discountMinor, "
        "       o.tax_minor AS taxMinor, o.service_minor AS serviceMinor, "
        "       o.deposit_minor AS depositMinor, "
        "       o.total_minor AS totalMinor, o.paid_minor AS paidMinor, o.tip_minor AS tipMinor, "
        "       o.discount_type AS discountType, o.discount_value AS discountValue, "
        "       o.discount_reason AS discountReason, o.note, o.opened_at AS openedAt, "
        "       o.submitted_at AS submittedAt, o.closed_at AS closedAt "
        "FROM orders o "
        "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
        "LEFT JOIN users u ON u.id = o.user_id "
        "WHERE o.id = :orderId");
    stmt.bind(":orderId", orderId);

    if (!stmt.step()) {
        throw PosError::of(protocol::err::kOrderNotFound);
    }

    Json order = stmt.row();
    if (!withItems) return order;

    auto items = ctx_.db().prepare(
        "SELECT id, product_id AS productId, line_seq AS lineSeq, "
        "       name_snapshot AS name, unit_price_minor AS unitPriceMinor, quantity, "
        "       modifier_total_minor AS modifierTotalMinor, line_total_minor AS lineTotalMinor, "
        "       status, seat, course, note, held, complimentary, void_reason AS voidReason, "
        "       sent_at AS sentAt "
        "FROM order_items WHERE order_id = :orderId ORDER BY line_seq");
    items.bind(":orderId", orderId);

    Json lines = items.rows();

    for (auto& line : lines) {
        auto modifiers = ctx_.db().prepare(
            "SELECT id, modifier_id AS modifierId, name_snapshot AS name, "
            "       group_name_snapshot AS groupName, price_delta_minor AS priceDeltaMinor "
            "FROM order_item_modifiers WHERE order_item_id = :itemId");
        modifiers.bind(":itemId", line["id"].get<std::string>());
        line["modifiers"] = modifiers.rows();
    }

    order["items"] = lines;

    auto payments = ctx_.db().prepare(
        "SELECT id, method, status, amount_minor AS amountMinor, tip_minor AS tipMinor, "
        "       tendered_minor AS tenderedMinor, change_minor AS changeMinor, "
        "       card_last4 AS cardLast4, created_at AS createdAt "
        "FROM payments WHERE order_id = :orderId ORDER BY created_at");
    payments.bind(":orderId", orderId);
    order["payments"] = payments.rows();

    return order;
}

Json OrderService::requireEditable(const std::string& orderId) {
    Json order = load(orderId, false);
    const auto status = order.value("status", "");

    if (!isEditable(status)) {
        throw PosError(std::string(protocol::err::kOrderState),
                       "This order is " + status + " and can no longer be changed");
    }
    return order;
}

std::vector<ResolvedModifier> OrderService::resolveModifiers(
    const std::string& productId, const std::vector<std::string>& modifierIds) {
    // Load every group attached to the product along with its rules.
    struct GroupRule {
        std::string id;
        std::string name;
        std::int64_t minSelect = 0;
        std::int64_t maxSelect = 1;
        bool required = false;
        bool multiSelect = false;
        int chosen = 0;
    };

    std::map<std::string, GroupRule> groups;

    auto groupStmt = ctx_.db().prepare(
        "SELECT g.id, g.name_az, g.min_select, g.max_select, g.required, g.multi_select "
        "FROM modifier_groups g "
        "JOIN menu_item_modifier_groups l ON l.group_id = g.id "
        "WHERE l.item_id = :productId");
    groupStmt.bind(":productId", productId);

    while (groupStmt.step()) {
        GroupRule rule;
        rule.id = groupStmt.columnText(0);
        rule.name = groupStmt.columnText(1);
        rule.minSelect = groupStmt.columnInt(2);
        rule.maxSelect = groupStmt.columnInt(3);
        rule.required = groupStmt.columnInt(4) != 0;
        rule.multiSelect = groupStmt.columnInt(5) != 0;
        groups.emplace(rule.id, rule);
    }

    std::vector<ResolvedModifier> resolved;

    for (const auto& modifierId : modifierIds) {
        auto stmt = ctx_.db().prepare(
            "SELECT m.id, m.group_id, m.name_az, m.price_delta_minor, m.available, g.name_az "
            "FROM modifiers m JOIN modifier_groups g ON g.id = m.group_id "
            "WHERE m.id = :modifierId");
        stmt.bind(":modifierId", modifierId);

        if (!stmt.step()) {
            throw PosError(std::string(protocol::err::kNotFound),
                           "Modifier not found: " + modifierId);
        }

        ResolvedModifier modifier;
        modifier.id = stmt.columnText(0);
        modifier.groupId = stmt.columnText(1);
        modifier.name = stmt.columnText(2);
        modifier.priceDelta = stmt.columnInt(3);
        const bool available = stmt.columnInt(4) != 0;
        modifier.groupName = stmt.columnText(5);

        if (!available) {
            throw PosError(std::string(protocol::err::kSoldOut),
                           modifier.name + " is not available");
        }

        auto group = groups.find(modifier.groupId);
        if (group == groups.end()) {
            throw PosError(std::string(protocol::err::kValidation),
                           modifier.name + " does not belong to this product");
        }

        group->second.chosen++;
        resolved.push_back(std::move(modifier));
    }

    // Enforce the group rules after counting, so the message names the group.
    for (const auto& [id, rule] : groups) {
        if (rule.required && rule.chosen < std::max<std::int64_t>(1, rule.minSelect)) {
            throw PosError(std::string(protocol::err::kModifierRequired),
                           "Please choose an option for: " + rule.name);
        }
        if (rule.chosen > 0 && rule.chosen < rule.minSelect) {
            throw PosError(std::string(protocol::err::kModifierLimit),
                           rule.name + " needs at least " + std::to_string(rule.minSelect) +
                               " selections");
        }
        if (rule.chosen > rule.maxSelect) {
            throw PosError(std::string(protocol::err::kModifierLimit),
                           rule.name + " allows at most " + std::to_string(rule.maxSelect) +
                               " selections");
        }
        if (!rule.multiSelect && rule.chosen > 1) {
            throw PosError(std::string(protocol::err::kModifierLimit),
                           rule.name + " allows only one selection");
        }
    }

    return resolved;
}

Totals OrderService::recalculate(const std::string& orderId) {
    // Voided and complimentary lines contribute nothing to the subtotal.
    auto sumStmt = ctx_.db().prepare(
        "SELECT COALESCE(SUM(line_total_minor), 0) FROM order_items "
        "WHERE order_id = :orderId AND status != 'voided' AND complimentary = 0");
    sumStmt.bind(":orderId", orderId);
    const Money subtotal = sumStmt.step() ? sumStmt.columnInt(0) : 0;

    auto discountStmt = ctx_.db().prepare(
        "SELECT COALESCE(discount_type, ''), discount_value FROM orders WHERE id = :orderId");
    discountStmt.bind(":orderId", orderId);

    Discount discount;
    if (discountStmt.step()) {
        discount.type = discountStmt.columnText(0);
        discount.value = discountStmt.columnInt(1);
    }

    auto depositStmt = ctx_.db().prepare(
        "SELECT COALESCE(deposit_minor, 0) FROM orders WHERE id = :orderId");
    depositStmt.bind(":orderId", orderId);
    const Money deposit = depositStmt.step() ? std::max<Money>(0, depositStmt.columnInt(0)) : 0;

    Totals totals = computeTotals(subtotal, discount, taxConfig());
    totals.deposit = deposit;
    totals.total += deposit;

    // One definition of "collected", shared with PaymentService::outstanding,
    // so the Paid and Remaining figures on the payment screen always add up to
    // the order total - including after a partial refund.
    const Money paid = PaymentService(ctx_).netCollected(orderId);

    auto tipStmt = ctx_.db().prepare(
        "SELECT COALESCE(SUM(tip_minor), 0) FROM payments "
        "WHERE order_id = :orderId AND status = 'approved'");
    tipStmt.bind(":orderId", orderId);
    const Money tips = tipStmt.step() ? tipStmt.columnInt(0) : 0;

    auto update = ctx_.db().prepare(
        "UPDATE orders SET subtotal_minor = :subtotal, discount_minor = :discount, "
        "                  service_minor = :service, tax_minor = :tax, deposit_minor = :deposit, "
        "                  total_minor = :total, "
        "                  paid_minor = :paid, tip_minor = :tip, updated_at = :now "
        "WHERE id = :orderId");
    update.bind(":subtotal", totals.subtotal)
        .bind(":discount", totals.discount)
        .bind(":service", totals.service)
        .bind(":tax", totals.tax)
        .bind(":deposit", totals.deposit)
        .bind(":total", totals.total)
        .bind(":paid", paid)
        .bind(":tip", tips)
        .bind(":now", nowMs())
        .bind(":orderId", orderId);
    update.exec();

    return totals;
}

void OrderService::logEvent(const std::string& orderId, std::string_view event, Json data) {
    auto stmt = ctx_.db().prepare(
        "INSERT INTO order_events (id, order_id, event, actor_user_id, data, created_at) "
        "VALUES (:id, :orderId, :event, :actor, :data, :now)");
    stmt.bind(":id", crypto::uuid4())
        .bind(":orderId", orderId)
        .bind(":event", std::string(event))
        .bindOptional(":actor", ctx_.session().userId)
        .bind(":data", serialize(data))
        .bind(":now", nowMs());
    stmt.exec();
}

void OrderService::refreshTableStatus(const std::string& tableId) {
    if (tableId.empty()) return;

    const std::string orderId = openOrderIdForTable(tableId);

    std::string status = "available";

    if (!orderId.empty()) {
        auto stmt = ctx_.db().prepare("SELECT status FROM orders WHERE id = :orderId");
        stmt.bind(":orderId", orderId);
        const std::string orderStatus = stmt.step() ? stmt.columnText(0) : "";

        if (orderStatus == "draft") {
            status = "ordering";
        } else if (orderStatus == "partially_paid") {
            status = "payment_requested";
        } else if (orderStatus == "sent" || orderStatus == "open") {
            // Derive from the kitchen: ready beats preparing, preparing beats seated.
            auto jobs = ctx_.db().prepare(
                "SELECT status, COUNT(*) FROM kitchen_jobs WHERE order_id = :orderId "
                "GROUP BY status");
            jobs.bind(":orderId", orderId);

            bool anyPreparing = false;
            bool anyReady = false;
            bool anyOutstanding = false;
            while (jobs.step()) {
                const std::string jobStatus = jobs.columnText(0);
                if (jobStatus == "ready") anyReady = true;
                if (jobStatus == "preparing" || jobStatus == "accepted") anyPreparing = true;
                if (jobStatus != "completed") anyOutstanding = true;
            }

            if (anyReady) status = "ready";
            else if (anyPreparing) status = "preparing";
            else if (anyOutstanding) status = "preparing";
            else status = "occupied";
        } else {
            status = "occupied";
        }
    }

    auto update = ctx_.db().prepare(
        "UPDATE restaurant_tables SET status = :status, updated_at = :now WHERE id = :tableId");
    update.bind(":status", status).bind(":now", nowMs()).bind(":tableId", tableId);
    update.exec();
}

}  // namespace pos::services
