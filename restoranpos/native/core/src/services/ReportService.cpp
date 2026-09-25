#include "pos/services/ReportService.hpp"

#include "pos/services/RefundService.hpp"

#include <utility>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {

int ReportService::nextSequence(const std::string& businessDayId, std::string_view kind) {
    if (kind == "z") return 1;
    auto stmt = ctx_.db().prepare(
        "SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM report_snapshots "
        "WHERE business_day_id = :day AND kind = :kind");
    stmt.bind(":day", businessDayId).bind(":kind", std::string(kind));
    stmt.step();
    return static_cast<int>(stmt.columnInt(0));
}

Json ReportService::buildCanonicalSnapshot(const std::string& businessDayId,
                                           std::string_view kind) {
    auto day = ctx_.db().prepare(
        "SELECT id, business_date, opening_float_minor, counted_cash_minor, status "
        "FROM business_days WHERE id = :id");
    day.bind(":id", businessDayId);
    if (!day.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Business day not found");
    }

    const Money openingFloat = day.columnInt(2);

    auto sales = ctx_.db().prepare(
        "SELECT method, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS totalMinor, "
        "       COALESCE(SUM(tip_minor), 0) AS tipsMinor "
        "FROM payments WHERE business_day_id = :day AND status = 'approved' "
        "GROUP BY method");
    sales.bind(":day", businessDayId);

    auto refunds = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) FROM refunds "
        "WHERE business_day_id = :day AND status = 'completed'");
    refunds.bind(":day", businessDayId);
    refunds.step();
    const Money refundTotal = refunds.columnInt(0);
    const auto refundCount = refunds.columnInt(1);

    auto cashSales = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM payments "
        "WHERE business_day_id = :day AND status = 'approved' AND method = 'cash'");
    cashSales.bind(":day", businessDayId);
    cashSales.step();
    const Money cashInSales = cashSales.columnInt(0);

    auto cashMoves = ctx_.db().prepare(
        "SELECT kind, reason, COALESCE(SUM(amount_minor), 0) AS totalMinor, COUNT(*) AS count "
        "FROM cash_movements WHERE business_day_id = :day GROUP BY kind, reason");
    cashMoves.bind(":day", businessDayId);

    Money cashInExtra = 0;
    Money cashOutExtra = 0;
    Json movements = Json::array();
    while (cashMoves.step()) {
        const auto moveKind = cashMoves.columnText(0);
        const auto moveReason = cashMoves.columnText(1);
        const Money amount = cashMoves.columnInt(2);
        movements.push_back(cashMoves.row());
        if (moveKind == "cash_in" || moveKind == "float_adjust") cashInExtra += amount;
        // A refund's drawer movement is listed for the audit trail but not added
        // up here: `cashRefunded` below already accounts for it.
        if (moveReason == kRefundMovementReason) continue;
        if (moveKind == "cash_out" || moveKind == "expense") cashOutExtra += amount;
    }

    auto cashRefunds = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM refunds "
        "WHERE business_day_id = :day AND status = 'completed' AND method = 'cash'");
    cashRefunds.bind(":day", businessDayId);
    cashRefunds.step();
    const Money cashRefunded = cashRefunds.columnInt(0);

    const Money expectedCash =
        openingFloat + cashInSales + cashInExtra - cashOutExtra - cashRefunded;

    auto orders = ctx_.db().prepare(
        "SELECT COUNT(*), COALESCE(SUM(total_minor), 0), COALESCE(SUM(discount_minor), 0), "
        "       COALESCE(SUM(tax_minor), 0), COALESCE(SUM(service_minor), 0) "
        "FROM orders WHERE business_day_id = :day AND status IN ('paid','closed')");
    orders.bind(":day", businessDayId);
    orders.step();

    auto byCategory = ctx_.db().prepare(
        "SELECT c.name_az AS category, SUM(i.quantity) AS quantity, "
        "       SUM(i.line_total_minor) AS revenueMinor "
        "FROM order_items i "
        "JOIN menu_items m ON m.id = i.product_id "
        "JOIN menu_categories c ON c.id = m.category_id "
        "JOIN orders o ON o.id = i.order_id "
        "WHERE o.business_day_id = :day AND i.status != 'voided' "
        "  AND o.status IN ('paid','closed') "
        "GROUP BY c.id ORDER BY revenueMinor DESC");
    byCategory.bind(":day", businessDayId);

    // Operational X report: show what is still sitting on open tables right
    // now, without mixing those unpaid amounts into completed sales.
    auto openTables = ctx_.db().prepare(
        "SELECT COUNT(DISTINCT table_id), COALESCE(SUM(total_minor), 0) "
        "FROM orders WHERE table_id IS NOT NULL "
        "  AND status IN ('draft','open','sent','partially_paid') "
        "  AND (total_minor > 0 OR EXISTS ("
        "      SELECT 1 FROM order_items i "
        "      WHERE i.order_id = orders.id AND i.status != 'voided'))");
    openTables.step();
    const auto openTableCount = openTables.columnInt(0);
    const Money openTablesTotal = openTables.columnInt(1);

    Json byMethod = Json::array();
    Money grossSales = 0;
    Money tips = 0;
    while (sales.step()) {
        byMethod.push_back(sales.row());
        grossSales += sales.columnInt(2);
        tips += sales.columnInt(3);
    }

    Json canonical{
        // v2: cash is no longer counted into the system, so countedCashMinor is
        // always null and no variance is reported.
        {"payloadVersion", 2},
        {"kind", std::string(kind)},
        {"businessDayId", businessDayId},
        {"businessDate", day.columnText(1)},
        {"generatedAt", nowMs()},
        {"openingFloatMinor", openingFloat},
        {"expectedCashMinor", expectedCash},
        {"countedCashMinor", nullptr},
        {"openTableCount", openTableCount},
        {"openTablesTotalMinor", openTablesTotal},
        {"sales",
         Json{{"grossMinor", grossSales},
              {"netMinor", grossSales - refundTotal},
              {"tipsMinor", tips},
              {"refundMinor", refundTotal},
              {"refundCount", refundCount},
              {"byMethod", byMethod}}},
        {"orders",
         Json{{"count", orders.columnInt(0)},
              {"revenueMinor", orders.columnInt(1)},
              {"discountMinor", orders.columnInt(2)},
              {"taxMinor", orders.columnInt(3)},
              {"serviceMinor", orders.columnInt(4)}}},
        {"byCategory", byCategory.rows()},
        {"cashMovements", movements},
        {"cashDrawer",
         Json{{"openingFloatMinor", openingFloat},
              {"cashSalesMinor", cashInSales},
              {"cashInMinor", cashInExtra},
              {"cashOutMinor", cashOutExtra},
              {"cashRefundsMinor", cashRefunded},
              {"expectedCashMinor", expectedCash}}},
    };
    return canonical;
}

Json ReportService::periodSummary(Timestamp from, Timestamp to) {
    if (to < from) std::swap(from, to);

    // Every figure below is keyed off when the money moved, so the receipt and
    // the screen can never disagree about which side of 09:00 a payment fell.
    auto sales = ctx_.db().prepare(
        "SELECT method, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS totalMinor, "
        "       COALESCE(SUM(tip_minor), 0) AS tipsMinor "
        "FROM payments WHERE status = 'approved' AND created_at BETWEEN :from AND :to "
        "GROUP BY method");
    sales.bind(":from", from).bind(":to", to);

    Json byMethod = Json::array();
    Money gross = 0;
    Money tips = 0;
    while (sales.step()) {
        byMethod.push_back(sales.row());
        gross += sales.columnInt(2);
        tips += sales.columnInt(3);
    }

    auto refunds = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) FROM refunds "
        "WHERE status = 'completed' AND created_at BETWEEN :from AND :to");
    refunds.bind(":from", from).bind(":to", to);
    refunds.step();
    const Money refundTotal = refunds.columnInt(0);
    const auto refundCount = refunds.columnInt(1);

    auto cash = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM payments "
        "WHERE status = 'approved' AND method = 'cash' AND created_at BETWEEN :from AND :to");
    cash.bind(":from", from).bind(":to", to);
    cash.step();
    const Money cashSales = cash.columnInt(0);

    auto cashBack = ctx_.db().prepare(
        "SELECT COALESCE(SUM(amount_minor), 0) FROM refunds "
        "WHERE status = 'completed' AND method = 'cash' AND created_at BETWEEN :from AND :to");
    cashBack.bind(":from", from).bind(":to", to);
    cashBack.step();
    const Money cashRefunded = cashBack.columnInt(0);

    auto orders = ctx_.db().prepare(
        "SELECT COUNT(DISTINCT order_id) FROM payments "
        "WHERE status = 'approved' AND created_at BETWEEN :from AND :to");
    orders.bind(":from", from).bind(":to", to);
    orders.step();
    const auto orderCount = orders.columnInt(0);

    // What was sold, taken from the orders those payments settled.
    //
    // A bill split across two windows contributes its items to both, because
    // there is no way to say which half of the food the first payment bought.
    // The money above is the exact figure; this breakdown is a guide to it.
    auto byCategory = ctx_.db().prepare(
        "SELECT c.name_az AS category, SUM(i.quantity) AS quantity, "
        "       SUM(i.line_total_minor) AS revenueMinor "
        "FROM order_items i "
        "JOIN menu_items m ON m.id = i.product_id "
        "JOIN menu_categories c ON c.id = m.category_id "
        "WHERE i.status != 'voided' AND i.order_id IN ("
        "    SELECT DISTINCT order_id FROM payments "
        "    WHERE status = 'approved' AND created_at BETWEEN :from AND :to) "
        "GROUP BY c.id ORDER BY revenueMinor DESC");
    byCategory.bind(":from", from).bind(":to", to);

    return Json{
        {"payloadVersion", 2},
        {"kind", "period"},
        {"from", from},
        {"to", to},
        {"generatedAt", nowMs()},
        {"sales",
         Json{{"grossMinor", gross},
              {"netMinor", gross - refundTotal},
              {"tipsMinor", tips},
              {"refundMinor", refundTotal},
              {"refundCount", refundCount},
              {"byMethod", byMethod}}},
        {"orders",
         Json{{"count", orderCount},
              {"revenueMinor", gross},
              {"averageMinor", orderCount > 0 ? gross / orderCount : 0}}},
        {"byCategory", byCategory.rows()},
        {"cashDrawer",
         Json{{"cashSalesMinor", cashSales},
              {"cashRefundsMinor", cashRefunded},
              {"expectedCashMinor", cashSales - cashRefunded}}},
    };
}

Json ReportService::periodBuckets(Timestamp from, Timestamp to, std::string_view bucket) {
    if (to < from) std::swap(from, to);
    // Only two shapes are offered, and the format string is chosen here rather
    // than taken from the caller - it lands in SQL.
    const std::string format = bucket == "day" ? "%Y-%m-%d" : "%Y-%m-%d %H";

    auto stmt = ctx_.db().prepare(
        "SELECT strftime('" + format +
        "', created_at / 1000, 'unixepoch', 'localtime') AS bucket, "
        "       COUNT(*) AS paymentCount, "
        "       COALESCE(SUM(amount_minor), 0) AS totalMinor, "
        "       COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_minor ELSE 0 END), 0) "
        "           AS cashMinor, "
        "       COALESCE(SUM(CASE WHEN method = 'card' THEN amount_minor ELSE 0 END), 0) "
        "           AS cardMinor, "
        "       COUNT(DISTINCT order_id) AS orderCount "
        "FROM payments WHERE status = 'approved' AND created_at BETWEEN :from AND :to "
        "GROUP BY bucket ORDER BY bucket");
    stmt.bind(":from", from).bind(":to", to);
    return stmt.rows();
}

Json ReportService::persistSnapshot(const std::string& businessDayId, std::string_view kind,
                                    const Json& canonical) {
    const int sequence = nextSequence(businessDayId, kind);
    const std::string snapshotId = crypto::uuid4();
    const std::string canonicalText = serialize(canonical);
    const std::string sha = crypto::sha256Hex(canonicalText);
    const auto now = nowMs();

    Json totals = Json{{"grossMinor", canonical["sales"].value("grossMinor", 0)},
                       {"netMinor", canonical["sales"].value("netMinor", 0)},
                       {"refundMinor", canonical["sales"].value("refundMinor", 0)},
                       {"openTableCount", canonical.value("openTableCount", 0)},
                       {"openTablesTotalMinor", canonical.value("openTablesTotalMinor", 0)}};
    if (kind != "x") {
        totals["expectedCashMinor"] = canonical.value("expectedCashMinor", 0);
    }

    auto insertSnapshot = ctx_.db().prepare(
        "INSERT INTO report_snapshots ("
        "  id, business_day_id, kind, sequence_no, canonical_json, content_sha256,"
        "  totals_json, created_by, created_at"
        ") VALUES ("
        "  :id, :day, :kind, :seq, :json, :sha, :totals, :user, :now)");
    insertSnapshot.bind(":id", snapshotId)
        .bind(":day", businessDayId)
        .bind(":kind", std::string(kind))
        .bind(":seq", static_cast<std::int64_t>(sequence))
        .bind(":json", canonicalText)
        .bind(":sha", sha)
        .bind(":totals", serialize(totals))
        .bindOptional(":user", ctx_.session().userId)
        .bind(":now", now);
    insertSnapshot.exec();

    if (kind == "x") {
        const std::string reportId = crypto::uuid4();
        auto insertX = ctx_.db().prepare(
            "INSERT INTO x_reports (id, business_day_id, snapshot_id, sequence_no, created_by, created_at) "
            "VALUES (:id, :day, :snap, :seq, :user, :now)");
        insertX.bind(":id", reportId)
            .bind(":day", businessDayId)
            .bind(":snap", snapshotId)
            .bind(":seq", static_cast<std::int64_t>(sequence))
            .bindOptional(":user", ctx_.session().userId)
            .bind(":now", now);
        insertX.exec();
        return Json{{"id", reportId},
                    {"snapshotId", snapshotId},
                    {"kind", "x"},
                    {"sequenceNo", sequence},
                    {"contentSha256", sha},
                    {"totals", totals},
                    {"canonical", canonical}};
    }

    if (kind == "z") {
        const std::string reportId = crypto::uuid4();
        auto insertZ = ctx_.db().prepare(
            "INSERT INTO z_reports (id, business_day_id, snapshot_id, created_by, created_at) "
            "VALUES (:id, :day, :snap, :user, :now)");
        insertZ.bind(":id", reportId)
            .bind(":day", businessDayId)
            .bind(":snap", snapshotId)
            .bindOptional(":user", ctx_.session().userId)
            .bind(":now", now);
        insertZ.exec();
        return Json{{"id", reportId},
                    {"snapshotId", snapshotId},
                    {"kind", "z"},
                    {"sequenceNo", sequence},
                    {"contentSha256", sha},
                    {"totals", totals},
                    {"canonical", canonical}};
    }

    return Json{{"snapshotId", snapshotId},
                {"kind", std::string(kind)},
                {"sequenceNo", sequence},
                {"contentSha256", sha},
                {"totals", totals},
                {"canonical", canonical}};
}

Json ReportService::createXReport(const std::string& businessDayId) {
    const Json canonical = buildCanonicalSnapshot(businessDayId, "x");
    const Json report = persistSnapshot(businessDayId, "x", canonical);
    ctx_.auditRequired("reports.x", "business_day", businessDayId,
                       Json{{"snapshotId", report.value("snapshotId", "")},
                            {"sequenceNo", report.value("sequenceNo", 0)}});
    return report;
}

Json ReportService::listReports(const std::string& businessDayId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id, kind, sequence_no AS sequenceNo, content_sha256 AS contentSha256, "
        "       totals_json AS totalsJson, created_by AS createdBy, created_at AS createdAt "
        "FROM report_snapshots WHERE business_day_id = :day ORDER BY created_at");
    stmt.bind(":day", businessDayId);
    return Json{{"snapshots", stmt.rows()}};
}

Json ReportService::getSnapshot(const std::string& snapshotId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id, business_day_id AS businessDayId, kind, sequence_no AS sequenceNo, "
        "       canonical_json AS canonicalJson, content_sha256 AS contentSha256, "
        "       totals_json AS totalsJson, created_at AS createdAt "
        "FROM report_snapshots WHERE id = :id");
    stmt.bind(":id", snapshotId);
    if (!stmt.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Report snapshot not found");
    }
    return stmt.row();
}

}  // namespace pos::services
