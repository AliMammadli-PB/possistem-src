#include "pos/services/BusinessDayService.hpp"

#include <ctime>
#include <iomanip>
#include <sstream>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/LicenseService.hpp"
#include "pos/services/ReportService.hpp"

namespace pos::services {
namespace {

[[noreturn]] void badRequest(std::string message) {
    throw PosError(std::string(protocol::err::kValidation), std::move(message));
}

}  // namespace

std::string BusinessDayService::todayDateLocal() const {
    const std::time_t now = std::time(nullptr);
    std::tm local{};
#ifdef _WIN32
    localtime_s(&local, &now);
#else
    localtime_r(&now, &local);
#endif
    std::ostringstream out;
    out << std::put_time(&local, "%Y-%m-%d");
    return out.str();
}

std::optional<std::string> BusinessDayService::openBusinessDayId() {
    auto stmt = ctx_.db().prepare(
        "SELECT id FROM business_days WHERE status = 'open' LIMIT 1");
    if (!stmt.step()) return std::nullopt;
    return stmt.columnText(0);
}

Json BusinessDayService::current() {
    auto stmt = ctx_.db().prepare(
        "SELECT id, business_date AS businessDate, status, opened_at AS openedAt, "
        "       opened_by AS openedBy, closed_at AS closedAt, closed_by AS closedBy, "
        "       opening_float_minor AS openingFloatMinor, "
        "       counted_cash_minor AS countedCashMinor, "
        "       expected_cash_minor AS expectedCashMinor, "
        "       cash_variance_minor AS cashVarianceMinor, note, legacy, "
        "       created_at AS createdAt, updated_at AS updatedAt "
        "FROM business_days WHERE status = 'open' LIMIT 1");
    if (stmt.step()) return stmt.row();

    auto latest = ctx_.db().prepare(
        "SELECT id, business_date AS businessDate, status, opened_at AS openedAt, "
        "       closed_at AS closedAt, opening_float_minor AS openingFloatMinor, "
        "       counted_cash_minor AS countedCashMinor, "
        "       expected_cash_minor AS expectedCashMinor, "
        "       cash_variance_minor AS cashVarianceMinor, note, legacy "
        "FROM business_days ORDER BY opened_at DESC LIMIT 1");
    if (latest.step()) return latest.row();
    return nullptr;
}

// Read-only, terminal-specific check. Never creates a till or opens a day.
Json BusinessDayService::saleReadiness() {
    ctx_.requireAuth();
    auto q = ctx_.db().prepare(
        "SELECT a.id,a.name FROM cash_accounts a LEFT JOIN cash_objects o ON o.id=a.object_id "
        "WHERE a.kind='till' AND a.active=1 AND a.terminal_id=:terminal "
        "AND (a.object_id IS NULL OR a.object_id='' OR o.active=1) LIMIT 1");
    q.bind(":terminal", ctx_.saleTerminalId());
    const bool assigned=q.step();
    const auto day=openBusinessDayId();
    const std::string reason=!assigned?"missing_register":!day?"closed":"ready";
    const std::string message=!assigned
        ? "Bu kompüterə kassa təyin edilməyib. İdarə → Anbar → Kassalar bölməsində kassa yaradıb bu kompüterə bağlayın."
        : !day ? "Kassa açıq deyil. Satışa başlamaq üçün kassanı açın." : "Kassa açıqdır";
    return Json{{"ready",assigned && day.has_value()},{"reason",reason},{"message",message},
                {"accountId",assigned?q.columnText(0):std::string{}},
                {"accountName",assigned?q.columnText(1):std::string{}},
                {"businessDayId",day.value_or("")}};
}
std::string BusinessDayService::requireOpenTill() {
    const auto state=saleReadiness();
    if (!state.at("ready").get<bool>())
        throw PosError(std::string(protocol::err::kShiftNotOpen),state.at("message").get<std::string>());
    return state.at("businessDayId").get<std::string>();
}

Json BusinessDayService::open(Money openingFloatMinor, std::string_view note) {
    if (openingFloatMinor < 0) badRequest("Opening float cannot be negative");
    LicenseService(ctx_).requireLicensedForNewBusinessDay();
    if (openBusinessDayId()) {
        throw PosError(std::string(protocol::err::kShiftAlreadyOpen),
                       "A business day is already open");
    }

    const std::string id = crypto::uuid4();
    const auto now = nowMs();
    const std::string date = todayDateLocal();

    auto insert = ctx_.db().prepare(
        "INSERT INTO business_days ("
        "  id, business_date, status, opened_at, opened_by, opening_float_minor,"
        "  note, legacy, created_at, updated_at"
        ") VALUES ("
        "  :id, :date, 'open', :now, :user, :float, :note, 0, :now, :now)");
    insert.bind(":id", id)
        .bind(":date", date)
        .bind(":now", now)
        .bindOptional(":user", ctx_.session().userId)
        .bind(":float", openingFloatMinor)
        .bind(":note", std::string(note));
    insert.exec();

    ctx_.auditRequired("business_day.open", "business_day", id,
                       Json{{"businessDate", date}, {"openingFloatMinor", openingFloatMinor}});

    auto load = ctx_.db().prepare(
        "SELECT id, business_date AS businessDate, status, opened_at AS openedAt, "
        "       opening_float_minor AS openingFloatMinor, note "
        "FROM business_days WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

BusinessDayReadiness BusinessDayService::readiness(const std::string& businessDayId) {
    BusinessDayReadiness result;

    auto openOrders = ctx_.db().prepare(
        "SELECT COUNT(*) FROM orders "
        "WHERE business_day_id = :day AND status IN ('draft','open','sent','partially_paid')");
    openOrders.bind(":day", businessDayId);
    openOrders.step();
    result.openOrders = static_cast<int>(openOrders.columnInt(0));
    if (result.openOrders > 0) {
        result.blockers.push_back(
            Json{{"code", "open_orders"},
                 {"message", "Open orders must be closed or voided before Z"},
                 {"count", result.openOrders}});
    }

    auto unresolved = ctx_.db().prepare(
        "SELECT COUNT(*) FROM payments "
        "WHERE business_day_id = :day AND status IN ('processing','waiting_for_terminal','unknown')");
    unresolved.bind(":day", businessDayId);
    unresolved.step();
    result.unresolvedPayments = static_cast<int>(unresolved.columnInt(0));
    if (result.unresolvedPayments > 0) {
        result.blockers.push_back(
            Json{{"code", "unresolved_payments"},
                 {"message", "Unresolved payments must be reconciled before Z"},
                 {"count", result.unresolvedPayments}});
    }

    auto kitchen = ctx_.db().prepare(
        "SELECT COUNT(*) FROM kitchen_jobs k "
        "JOIN orders o ON o.id = k.order_id "
        "WHERE o.business_day_id = :day AND k.status IN ('new','accepted','preparing')");
    kitchen.bind(":day", businessDayId);
    kitchen.step();
    result.pendingKitchen = static_cast<int>(kitchen.columnInt(0));
    if (result.pendingKitchen > 0) {
        result.blockers.push_back(
            Json{{"code", "pending_kitchen"},
                 {"message", "Kitchen tickets must be completed before Z"},
                 {"count", result.pendingKitchen}});
    }

    // No cash-counting blocker: the drawer is never counted into the system, so
    // there is nothing to wait for. The Z simply reports expected cash.

    result.ready = result.blockers.empty();
    return result;
}

Json BusinessDayService::closeZ(const std::string& businessDayId, std::string_view note) {
    auto day = ctx_.db().prepare(
        "SELECT id, status, opening_float_minor FROM business_days WHERE id = :id");
    day.bind(":id", businessDayId);
    if (!day.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Business day not found");
    }
    if (day.columnText(1) != "open") {
        throw PosError(std::string(protocol::err::kOrderState), "Business day is not open");
    }

    const auto ready = readiness(businessDayId);
    if (!ready.ready) {
        throw PosError(std::string(protocol::err::kOrderState), "Business day is not ready for Z",
                       Json{{"readiness",
                             Json{{"ready", false},
                                  {"openOrders", ready.openOrders},
                                  {"unresolvedPayments", ready.unresolvedPayments},
                                  {"pendingKitchen", ready.pendingKitchen},
                                  {"blockers", ready.blockers}}}});
    }

    ReportService reports(ctx_);
    const Json snapshot = reports.buildCanonicalSnapshot(businessDayId, "z");
    const Money expectedCash = getOr<Money>(snapshot, "expectedCashMinor", 0);
    const auto now = nowMs();

    // counted_cash_minor and cash_variance_minor stay NULL: nothing is counted,
    // so there is no variance to record. The columns remain for older rows.
    auto closing = ctx_.db().prepare(
        "UPDATE business_days SET status = 'closed', closed_at = :now, closed_by = :user, "
        "  expected_cash_minor = :expected, "
        "  note = CASE WHEN :note = '' THEN note ELSE :note END, "
        "  updated_at = :now WHERE id = :id AND status = 'open'");
    closing.bind(":now", now)
        .bindOptional(":user", ctx_.session().userId)
        .bind(":expected", expectedCash)
        .bind(":note", std::string(note))
        .bind(":id", businessDayId);
    closing.exec();
    if (ctx_.db().changes() != 1) {
        throw PosError(std::string(protocol::err::kOrderState), "Business day could not be closed");
    }

    const Json zReport = reports.persistSnapshot(businessDayId, "z", snapshot);

    ctx_.auditRequired("business_day.z_close", "business_day", businessDayId,
                       Json{{"expectedCashMinor", expectedCash},
                            {"snapshotId", zReport.value("snapshotId", "")}});

    return Json{{"businessDay", current()}, {"zReport", zReport}};
}

void BusinessDayService::assertMutableBusinessDay(const std::string& businessDayId) {
    if (businessDayId.empty()) return;
    auto stmt = ctx_.db().prepare("SELECT status FROM business_days WHERE id = :id");
    stmt.bind(":id", businessDayId);
    if (stmt.step() && stmt.columnText(0) == "closed") {
        throw PosError(std::string(protocol::err::kOrderState),
                       "Cannot modify orders on a closed business day");
    }
}

std::string BusinessDayService::ensureOpenBusinessDayId() {
    // Compatibility for internal callers: never reopen a closed till implicitly.
    return requireOpenTill();
}

void BusinessDayService::adoptOrderIntoDay(const std::string& orderId, const std::string& dayId) {
    // Only orphans and orders stranded on a closed day move. An order already
    // attached to a live day keeps it, so revenue stays on the day it opened.
    auto stmt = ctx_.db().prepare(
        "UPDATE orders SET business_day_id = :day, updated_at = :now "
        "WHERE id = :id AND (business_day_id IS NULL OR business_day_id IN "
        "  (SELECT id FROM business_days WHERE status = 'closed'))");
    stmt.bind(":day", dayId).bind(":now", nowMs()).bind(":id", orderId);
    stmt.exec();
}

}  // namespace pos::services
