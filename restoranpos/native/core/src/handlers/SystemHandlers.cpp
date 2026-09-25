#include <algorithm>
#include <array>
#include <cctype>
#include <filesystem>
#include <utility>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/payments/TerminalAdapter.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/GiftCampaignService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/LicenseService.hpp"
#include "pos/services/RefundService.hpp"
#include "pos/services/ReportService.hpp"
#include "pos/db/Database.hpp"

namespace pos::handlers {
namespace {

/** Settings the UI must never be able to change through the generic setter. */
/** Roughly 400 KB of base64: far more than a receipt logo ever needs. */
constexpr std::size_t kMaxLogoDataUrlBytes = 400 * 1024;

/** The same upsert `settings.set` performs, for handlers that write several. */
void writeSetting(Context& ctx, const char* key, const std::string& value) {
    auto stmt = ctx.db().prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'string', :now) "
        "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
    stmt.bind(":key", std::string(key)).bind(":value", value).bind(":now", nowMs());
    stmt.exec();
}

bool isProtectedSetting(const std::string& key) {
    return key.rfind("security.", 0) == 0 && key != "security.autoLogoutSeconds";
}

/**
 * Local midnight of the day containing `at`.
 *
 * This used to be `now - now % 86400000`, which is midnight *UTC*. Everything
 * else in the core - business days, receipt timestamps - works in local time,
 * so on a UTC+4 till "today" silently began at 04:00 and the dashboard's takings
 * counted the wrong window. Hourly figures make that impossible to ignore.
 */
Timestamp startOfLocalDay(Timestamp at) {
    const std::time_t seconds = static_cast<std::time_t>(at / 1000);
    std::tm local{};
#ifdef _WIN32
    localtime_s(&local, &seconds);
#else
    localtime_r(&seconds, &local);
#endif
    local.tm_hour = 0;
    local.tm_min = 0;
    local.tm_sec = 0;
    // Let mktime work out whether DST applies on that date.
    local.tm_isdst = -1;
    return static_cast<Timestamp>(std::mktime(&local)) * 1000LL;
}

Timestamp startOfToday() { return startOfLocalDay(nowMs()); }

/**
 * Where "today" starts for a report that was given no range.
 *
 * The open till, not the wall clock. A venue that serves past midnight is still
 * inside the same business day, and local midnight would cut its takings in
 * half - the evening on one report, the small hours on another. Falls back to
 * midnight when no day is open, which is what a closed till should show.
 */
Timestamp defaultReportStart(Context& ctx) {
    services::BusinessDayService days(ctx);
    if (const auto dayId = days.openBusinessDayId()) {
        auto stmt = ctx.db().prepare("SELECT opened_at FROM business_days WHERE id = :id");
        stmt.bind(":id", *dayId);
        if (stmt.step()) return stmt.columnInt(0);
    }
    return startOfToday();
}

/**
 * Announces a snapshot that is already durable, before anything is printed.
 *
 * The owner's WhatsApp alert used to hang off the IPC reply to `reports.x` /
 * `businessDay.close`. Those replies come back only after the print queue has
 * been drained inline, so a slow or absent printer timed the call out - and the
 * alert was lost even though the report itself had been committed. Emitting
 * here separates "the report exists" from "the paper came out".
 */
void emitReportCreated(Context& ctx, const Json& report, std::string_view kind) {
    Json payload = Json::object();
    payload["kind"] = std::string(kind);
    payload["sequenceNo"] = report.value("sequenceNo", 0);
    if (report.contains("totals")) payload["totals"] = report["totals"];
    if (report.contains("canonical")) payload["canonical"] = report["canonical"];
    ctx.server().emitEvent(protocol::event::kReportsCreated, payload);
}

/** Queues and drains an X/Z thermal receipt from a persisted report snapshot. */
void enqueueReportPrint(Context& ctx, const Json& report, const std::string& printKind) {
    Json canonical = report.contains("canonical") && report["canonical"].is_object()
                         ? report["canonical"]
                         : Json::object();
    if (report.contains("sequenceNo")) {
        canonical["sequenceNo"] = report["sequenceNo"];
    }

    Json options = Json::object();
    options["canonical"] = canonical;
    options["sequenceNo"] = report.value("sequenceNo", 0);
    options["reprint"] = false;

    const auto now = nowMs();
    const std::string jobId = crypto::uuid4();
    auto insert = ctx.db().prepare(
        "INSERT INTO print_jobs (id, order_id, kind, target_printer, status, "
        "        payload, next_attempt_at, created_at, updated_at) "
        "VALUES (:id, NULL, :kind, :printer, 'queued', :options, :now, :now, :now)");
    insert.bind(":id", jobId)
        .bind(":kind", printKind)
        .bind(":printer", ctx.setting("printer.receipt", "auto"))
        .bind(":options", serialize(options))
        .bind(":now", now);
    insert.exec();

    drainPrintQueue(ctx);
}

/**
 * Closes the business day and prints the Z.
 *
 * Shared by `businessDay.close` and `reports.z` - they are the same operation
 * under two names, and the protocol declared both long before either had a
 * handler.
 */
Json runZClose(Context& ctx, const ipc::Request& request) {
    services::BusinessDayService days(ctx);

    std::string id = getOr<std::string>(request.payload, "businessDayId", "");
    if (id.empty()) {
        const auto open = days.openBusinessDayId();
        if (!open) {
            throw PosError(std::string(protocol::err::kNotFound),
                           "Bagliyacaq acig kassa gunu yoxdur");
        }
        id = *open;
    }

    Json result;
    {
        db::Transaction txn(ctx.db());
        result = days.closeZ(id, getOr<std::string>(request.payload, "note", ""));
        txn.commit();
    }

    // Printing happens after the commit: a printer fault must never roll back a
    // closed day, and the snapshot is already durable.
    if (result.contains("zReport") && result["zReport"].is_object()) {
        emitReportCreated(ctx, result["zReport"], "z");
        enqueueReportPrint(ctx, result["zReport"], "z_report");
    }
    return result;
}

}  // namespace

void registerSystem(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // ------------------------------------------------------------------ shifts
    server.registerHandler(std::string(protocol::method::kShiftsCurrent),
                           [ctx](const ipc::Request&) {
                               ctx->requireAuth();

                               auto stmt = ctx->db().prepare(
                                   "SELECT s.id, s.user_id AS userId, u.full_name AS userName, "
                                   "       s.terminal_id AS terminalId, s.status, "
                                   "       s.opening_float_minor AS openingFloatMinor, "
                                   "       s.opened_at AS openedAt "
                                   "FROM shifts s JOIN users u ON u.id = s.user_id "
                                   "WHERE s.status = 'open' AND s.terminal_id = :terminal "
                                   "ORDER BY s.opened_at DESC LIMIT 1");
                               stmt.bind(":terminal", ctx->terminalId());

                               if (!stmt.step()) return Json{{"shift", nullptr}};

                               Json shift = stmt.row();

                               auto totals = ctx->db().prepare(
                                   "SELECT COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_minor "
                                   "                    ELSE 0 END), 0), "
                                   "       COALESCE(SUM(CASE WHEN method = 'card' THEN amount_minor "
                                   "                    ELSE 0 END), 0), "
                                   "       COUNT(*) "
                                   "FROM payments WHERE shift_id = :shiftId AND status = 'approved'");
                               totals.bind(":shiftId", shift.value("id", ""));
                               if (totals.step()) {
                                   shift["cashMinor"] = totals.columnInt(0);
                                   shift["cardMinor"] = totals.columnInt(1);
                                   shift["transactionCount"] = totals.columnInt(2);
                               }

                               return Json{{"shift", shift}};
                           });

    server.registerHandler(
        std::string(protocol::method::kShiftsOpen), [ctx](const ipc::Request& request) {
            ctx->requirePermission("shift.manage");
            const auto openingFloat = getOr<Money>(request.payload, "openingFloatMinor", 0);

            services::Idempotency idempotency(*ctx);
            db::Transaction txn(ctx->db());

            if (auto replay = idempotency.begin(request.idempotencyKey,
                                                std::string(protocol::method::kShiftsOpen),
                                                request.payload)) {
                txn.commit();
                return *replay;
            }

            auto existing = ctx->db().prepare(
                "SELECT id FROM shifts WHERE status = 'open' AND terminal_id = :terminal");
            existing.bind(":terminal", ctx->terminalId());
            if (existing.step()) throw PosError::of(protocol::err::kShiftAlreadyOpen);

            const std::string shiftId = crypto::uuid4();
            auto insert = ctx->db().prepare(
                "INSERT INTO shifts (id, user_id, terminal_id, status, opening_float_minor, opened_at) "
                "VALUES (:id, :userId, :terminal, 'open', :float, :now)");
            insert.bind(":id", shiftId)
                .bind(":userId", ctx->session().userId)
                .bind(":terminal", ctx->terminalId())
                .bind(":float", openingFloat)
                .bind(":now", nowMs());
            insert.exec();

            ctx->session().shiftId = shiftId;
            ctx->audit("shift.open", "shift", shiftId, Json{{"openingFloatMinor", openingFloat}});

            Json result{{"shiftId", shiftId}, {"openingFloatMinor", openingFloat}};
            idempotency.complete(request.idempotencyKey, result, "shift", shiftId);
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kShiftsClose), [ctx](const ipc::Request& request) {
            ctx->requirePermission("shift.manage");
            const auto closingCash = getOr<Money>(request.payload, "closingCashMinor", 0);

            services::Idempotency idempotency(*ctx);
            db::Transaction txn(ctx->db());

            if (auto replay = idempotency.begin(request.idempotencyKey,
                                                std::string(protocol::method::kShiftsClose),
                                                request.payload)) {
                txn.commit();
                return *replay;
            }

            auto lookup = ctx->db().prepare(
                "SELECT id, opening_float_minor FROM shifts "
                "WHERE status = 'open' AND terminal_id = :terminal ORDER BY opened_at DESC LIMIT 1");
            lookup.bind(":terminal", ctx->terminalId());
            if (!lookup.step()) throw PosError::of(protocol::err::kShiftNotOpen);

            const std::string shiftId = lookup.columnText(0);
            const Money openingFloat = lookup.columnInt(1);

            // A shift cannot be closed while a card result is still unknown -
            // the takings would not be reconcilable afterwards.
            auto unresolved = ctx->db().prepare(
                "SELECT COUNT(*) FROM payments WHERE shift_id = :shiftId AND status = 'unknown'");
            unresolved.bind(":shiftId", shiftId);
            if (unresolved.step() && unresolved.columnInt(0) > 0) {
                throw PosError(std::string(protocol::err::kPaymentUnknownPending),
                               "Resolve the unknown card payments before closing the shift");
            }

            auto cash = ctx->db().prepare(
                "SELECT COALESCE(SUM(amount_minor), 0) FROM payments "
                "WHERE shift_id = :shiftId AND status = 'approved' AND method = 'cash'");
            cash.bind(":shiftId", shiftId);
            const Money cashTaken = cash.step() ? cash.columnInt(0) : 0;
            const Money expected = openingFloat + cashTaken;

            auto update = ctx->db().prepare(
                "UPDATE shifts SET status = 'closed', closing_cash_minor = :closing, "
                "       expected_cash_minor = :expected, variance_minor = :variance, "
                "       closed_at = :now WHERE id = :shiftId");
            update.bind(":closing", closingCash)
                .bind(":expected", expected)
                .bind(":variance", closingCash - expected)
                .bind(":now", nowMs())
                .bind(":shiftId", shiftId);
            update.exec();

            printing::ReceiptBuilder builder(*ctx);
            auto report = builder.shiftReport(shiftId);

            ctx->session().shiftId.clear();
            ctx->audit("shift.close", "shift", shiftId,
                       Json{{"closingCashMinor", closingCash},
                            {"expectedCashMinor", expected},
                            {"varianceMinor", closingCash - expected}});

            Json result{{"shiftId", shiftId},
                        {"expectedCashMinor", expected},
                        {"closingCashMinor", closingCash},
                        {"varianceMinor", closingCash - expected},
                        {"report", Json{{"number", report.number}, {"text", report.text}}}};
            idempotency.complete(request.idempotencyKey, result, "shift", shiftId);
            txn.commit();
            return result;
        });

    // ---------------------------------------------------------------- settings
    server.registerHandler(std::string(protocol::method::kSettingsGetAll),
                           [ctx](const ipc::Request&) {
                               ctx->requireAuth();

                               auto stmt = ctx->db().prepare(
                                   "SELECT key, value, value_type AS valueType FROM app_settings "
                                   "ORDER BY key");

                               Json settings = Json::object();
                               Json rows = stmt.rows();
                               for (const auto& row : rows) {
                                   settings[row.value("key", "")] = row.value("value", "");
                               }

                               return Json{{"settings", settings},
                                           {"entries", rows},
                                           {"terminalMode",
                                            payments::MockTerminal::instance().forcedMode()}};
                           });

    server.registerHandler(
        std::string(protocol::method::kSettingsSet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("settings.manage");

            const auto key = getOr<std::string>(request.payload, "key", "");
            require(!key.empty(), "key is required");

            if (isProtectedSetting(key)) {
                throw PosError(std::string(protocol::err::kForbidden),
                               "This setting cannot be changed from the application");
            }

            std::string value;
            if (request.payload.contains("value")) {
                const auto& raw = request.payload["value"];
                value = raw.is_string() ? raw.get<std::string>() : serialize(raw);
            }

            db::Transaction txn(ctx->db());

            auto previous = ctx->db().prepare("SELECT value FROM app_settings WHERE key = :key");
            previous.bind(":key", key);
            const std::string oldValue = previous.step() ? previous.columnText(0) : "";

            auto update = ctx->db().prepare(
                "INSERT INTO app_settings (key, value, value_type, updated_at) "
                "VALUES (:key, :value, 'string', :now) "
                "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
            update.bind(":key", key).bind(":value", value).bind(":now", nowMs());
            update.exec();

            ctx->audit("settings.change", "settings", key,
                       Json{{"from", oldValue}, {"to", value}});
            txn.commit();

            return Json{{"key", key}, {"value", value}};
        });

    // ------------------------------------------------------------ brand mark
    //
    // The receipt logo used to be a constant compiled into the core binary, so
    // every customer printed the first venue's mark and changing it meant a
    // rebuild. Now it is two settings rows, written here.
    //
    // The settings screen does the decoding: it hands over a small PNG for the
    // screen preview and a 1 bpp raster already scaled to the print head, so
    // the core needs no image decoder.
    server.registerHandler(
        std::string(protocol::method::kReceiptLogoApply), [ctx](const ipc::Request& request) {
            ctx->requirePermission("settings.manage");

            const auto dataUrl = getOr<std::string>(request.payload, "dataUrl", "");
            require(dataUrl.rfind("data:image/png;base64,", 0) == 0,
                    "dataUrl must be a base64 PNG");
            // A receipt logo is a few kilobytes. The cap is what stops a settings
            // row from growing until it slows every startup that reads it.
            require(dataUrl.size() <= kMaxLogoDataUrlBytes,
                    "Loqo çox böyükdür - daha kiçik şəkil seçin");

            const auto& raster = request.payload.contains("raster") ? request.payload["raster"]
                                                                    : Json::object();
            require(raster.is_object(), "raster is required");
            const int width = getOr<int>(raster, "w", 0);
            const int height = getOr<int>(raster, "h", 0);
            const auto hex = getOr<std::string>(raster, "hex", "");
            require(width > 0 && width <= 1024, "raster width must be 1-1024 dots");
            require(height > 0 && height <= 1024, "raster height must be 1-1024 dots");

            const std::size_t stride = static_cast<std::size_t>((width + 7) / 8);
            require(hex.size() == stride * static_cast<std::size_t>(height) * 2,
                    "raster hex length does not match its dimensions");
            require(std::all_of(hex.begin(), hex.end(),
                                [](unsigned char c) { return std::isxdigit(c) != 0; }),
                    "raster must be hex");

            const Json spec{{"w", width}, {"h", height}, {"hex", hex}};

            db::Transaction txn(ctx->db());
            writeSetting(*ctx, "printer.logoDataUrl", dataUrl);
            writeSetting(*ctx, "printer.logoRaster", serialize(spec));
            ctx->audit("settings.change", "settings", "printer.logoDataUrl",
                       Json{{"bytes", dataUrl.size()}, {"rasterWidth", width},
                            {"rasterHeight", height}});
            txn.commit();

            return Json{{"ok", true}, {"rasterWidth", width}, {"rasterHeight", height}};
        });

    server.registerHandler(
        std::string(protocol::method::kReceiptLogoClear), [ctx](const ipc::Request&) {
            ctx->requirePermission("settings.manage");

            db::Transaction txn(ctx->db());
            writeSetting(*ctx, "printer.logoDataUrl", "");
            writeSetting(*ctx, "printer.logoRaster", "");
            ctx->audit("settings.change", "settings", "printer.logoDataUrl",
                       Json{{"cleared", true}});
            txn.commit();

            return Json{{"ok", true}};
        });

    // Stamps the restaurant's own name onto a freshly activated till.
    //
    // Every install seeds the Milioner branding, so without this each customer
    // we sell to prints somebody else's name on every receipt until an operator
    // notices and retypes it. The name lives on the control server already —
    // this is how it gets down here.
    //
    // Unauthenticated on purpose: activation happens on the licence screen,
    // before any cashier has signed in, so there is no session to check. That is
    // only safe because of the rule below.
    server.registerHandler(
        std::string(protocol::method::kSettingsApplyProvisionedIdentity),
        [ctx](const ipc::Request& request) {
            // Only ever replaces a value that is still exactly what the seed
            // wrote. A name an operator has typed, or one already provisioned,
            // is left alone - so a replayed call cannot rename a live
            // restaurant, and re-activating a till is harmless.
            static const std::array<std::pair<const char*, std::vector<const char*>>, 4> kFields{{
                {"restaurant.name",
                 {"", "Milioner", "Milioner Pub", "Milioner Pub & Lounge", "Maison Aurelia",
                  "Maison Aurelia POS"}},
                {"restaurant.address", {"", "Lütfizadə 98"}},
                {"restaurant.phone", {"", "+994505013540"}},
                {"restaurant.taxId", {""}},
            }};

            db::Transaction txn(ctx->db());
            Json applied = Json::object();
            Json skipped = Json::array();

            for (const auto& [key, defaults] : kFields) {
                if (!request.payload.contains(key)) continue;
                const auto& raw = request.payload[key];
                if (!raw.is_string()) continue;
                const std::string next = raw.get<std::string>();
                if (next.empty()) continue;

                auto read = ctx->db().prepare("SELECT value FROM app_settings WHERE key = :key");
                read.bind(":key", std::string(key));
                const std::string current = read.step() ? read.columnText(0) : "";

                if (current == next) continue;
                const bool replaceable =
                    std::any_of(defaults.begin(), defaults.end(),
                                [&](const char* d) { return current == d; });
                if (!replaceable) {
                    skipped.push_back(key);
                    continue;
                }

                auto write = ctx->db().prepare(
                    "INSERT INTO app_settings (key, value, value_type, updated_at) "
                    "VALUES (:key, :value, 'string', :now) "
                    "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
                write.bind(":key", std::string(key)).bind(":value", next).bind(":now", nowMs());
                write.exec();

                ctx->audit("settings.provisionIdentity", "settings", key,
                           Json{{"from", current}, {"to", next}});
                applied[key] = next;
            }

            txn.commit();
            return Json{{"applied", applied}, {"skipped", skipped}};
        });

    // ------------------------------------------------------------------- audit
    server.registerHandler(
        std::string(protocol::method::kAuditList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("audit.view");

            const auto action = getOr<std::string>(request.payload, "action", "");
            const auto terminalId = getOr<std::string>(request.payload, "terminalId", "");
            const auto actor = getOr<std::string>(request.payload, "actor", "");
            const auto from = getOr<std::int64_t>(request.payload, "from", 0);
            const auto to = getOr<std::int64_t>(request.payload, "to", 0);
            const auto limit =
                std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 100), 500);
            const auto offset = std::max<std::int64_t>(0, getOr<std::int64_t>(request.payload, "offset", 0));

            // Built once and shared by the page and the count, so the two can
            // never disagree - a total that ignored the filters made the pager
            // offer pages that came back empty.
            std::string where = " WHERE 1=1";
            if (!action.empty()) where += " AND a.action LIKE :action";
            if (!terminalId.empty()) where += " AND a.terminal_id = :terminal";
            if (!actor.empty()) where += " AND u.full_name = :actor";
            if (from > 0) where += " AND a.created_at >= :from";
            if (to > 0) where += " AND a.created_at <= :to";

            const auto bindFilters = [&](db::Statement& stmt) {
                if (!action.empty()) stmt.bind(":action", action + "%");
                if (!terminalId.empty()) stmt.bind(":terminal", terminalId);
                if (!actor.empty()) stmt.bind(":actor", actor);
                if (from > 0) stmt.bind(":from", from);
                if (to > 0) stmt.bind(":to", to);
            };

            auto stmt = ctx->db().prepare(
                "SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, "
                "       a.data, a.terminal_id AS terminalId, a.created_at AS createdAt, "
                "       u.full_name AS actorName "
                "FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id" +
                where + " ORDER BY a.created_at DESC, a.id DESC LIMIT :limit OFFSET :offset");
            bindFilters(stmt);
            stmt.bind(":limit", limit).bind(":offset", offset);

            auto total = ctx->db().prepare(
                "SELECT COUNT(*) FROM audit_logs a "
                "LEFT JOIN users u ON u.id = a.actor_user_id" + where);
            bindFilters(total);

            // The distinct action names actually present, so the filter offers
            // real choices instead of a hardcoded list that drifts.
            auto actions = ctx->db().prepare(
                "SELECT DISTINCT action FROM audit_logs ORDER BY action");
            Json actionNames = Json::array();
            while (actions.step()) actionNames.push_back(actions.columnText(0));

            auto terminals = ctx->db().prepare(
                "SELECT DISTINCT terminal_id FROM audit_logs "
                "WHERE terminal_id IS NOT NULL AND terminal_id != '' ORDER BY terminal_id");
            Json terminalIds = Json::array();
            while (terminals.step()) terminalIds.push_back(terminals.columnText(0));

            return Json{{"entries", stmt.rows()},
                        {"total", total.step() ? total.columnInt(0) : 0},
                        {"actions", actionNames},
                        {"terminals", terminalIds}};
        });

    // The forwarding queue: everything the control server has not acknowledged,
    // oldest first. `(created_at, id)` is the order because two entries can land
    // in the same millisecond, and a watermark on the timestamp alone would
    // either skip the second one or send it again forever.
    server.registerHandler(
        std::string(protocol::method::kAuditPending), [ctx](const ipc::Request& request) {
            const auto limit =
                std::clamp<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 200), 1, 500);

            const std::int64_t watermarkAt = ctx->settingInt("audit.sync.watermarkAt", 0);
            const std::string watermarkId = ctx->setting("audit.sync.watermarkId", "");

            auto stmt = ctx->db().prepare(
                "SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, "
                "       a.data, a.terminal_id AS terminalId, a.created_at AS createdAt, "
                "       u.full_name AS actorName, a.actor_user_id AS actorUserId "
                "FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id "
                "WHERE a.created_at > :at OR (a.created_at = :at AND a.id > :id) "
                "ORDER BY a.created_at ASC, a.id ASC LIMIT :limit");
            stmt.bind(":at", watermarkAt).bind(":id", watermarkId).bind(":limit", limit);

            Json entries = stmt.rows();
            // `data` is JSON text in the column. Handing the caller a string would
            // make the control server parse it a second time and store it as an
            // escaped blob, which is what makes a history page unsearchable.
            for (auto& entry : entries) {
                const std::string raw = entry.value("data", "");
                Json parsed = Json::parse(raw, nullptr, false);
                entry["data"] = parsed.is_discarded() || !parsed.is_object() ? Json::object()
                                                                            : parsed;
            }

            auto backlog = ctx->db().prepare(
                "SELECT COUNT(*) FROM audit_logs "
                "WHERE created_at > :at OR (created_at = :at AND id > :id)");
            backlog.bind(":at", watermarkAt).bind(":id", watermarkId);

            return Json{{"entries", entries},
                        {"watermarkAt", watermarkAt},
                        {"watermarkId", watermarkId},
                        {"backlog", backlog.step() ? backlog.columnInt(0) : 0}};
        });

    // Advances the watermark, and only forwards. A stale ACK arriving after a
    // newer one - two syncs overlapping, a retried request - must not rewind the
    // queue and resend everything in between.
    server.registerHandler(
        std::string(protocol::method::kAuditAck), [ctx](const ipc::Request& request) {
            const auto at = getOr<std::int64_t>(request.payload, "createdAt", 0);
            const auto id = getOr<std::string>(request.payload, "id", "");
            require(at > 0 && !id.empty(), "createdAt and id are required");

            db::Transaction txn(ctx->db());

            const std::int64_t currentAt = ctx->settingInt("audit.sync.watermarkAt", 0);
            const std::string currentId = ctx->setting("audit.sync.watermarkId", "");
            const bool moved = at > currentAt || (at == currentAt && id > currentId);

            if (moved) {
                auto upsert = ctx->db().prepare(
                    "INSERT INTO app_settings (key, value, value_type, updated_at) "
                    "VALUES (:key, :value, 'string', :now) "
                    "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
                const auto write = [&](const char* key, const std::string& value) {
                    upsert.bind(":key", key).bind(":value", value).bind(":now", nowMs());
                    upsert.exec();
                };
                write("audit.sync.watermarkAt", std::to_string(at));
                write("audit.sync.watermarkId", id);
            }

            txn.commit();
            return Json{{"watermarkAt", moved ? at : currentAt},
                        {"watermarkId", moved ? id : currentId},
                        {"moved", moved}};
        });

    // ----------------------------------------------------------------- reports
    server.registerHandler(std::string(protocol::method::kReportsDashboard),
                           [ctx](const ipc::Request&) {
                               ctx->requirePermission("reports.view");
                               // The card follows the till, not the wall clock:
                               // a venue that Z-closes at 02:00 would otherwise
                               // read yesterday's takings as "today" until
                               // midnight, and read nothing at all for the two
                               // hours it traded after it.
                               const auto openDay =
                                   services::BusinessDayService(*ctx).openBusinessDayId();
                               const std::string dayId = openDay.value_or(std::string());

                               auto tables = ctx->db().prepare(
                                   "SELECT "
                                   "  COUNT(*), "
                                   "  SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), "
                                   "  SUM(CASE WHEN status NOT IN ('available','cleaning') "
                                   "      THEN 1 ELSE 0 END) "
                                   "FROM restaurant_tables WHERE active = 1");
                               tables.step();

                               auto kitchen = ctx->db().prepare(
                                   "SELECT "
                                   "  SUM(CASE WHEN status IN ('new','accepted','preparing') "
                                   "      THEN 1 ELSE 0 END), "
                                   "  SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) "
                                   "FROM kitchen_jobs WHERE status != 'completed'");
                               kitchen.step();

                               auto sales = ctx->db().prepare(
                                   "SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) "
                                   "FROM payments WHERE status = 'approved' "
                                   "  AND business_day_id = :day");
                               sales.bind(":day", dayId);
                               sales.step();

                               const Money todaySales = sales.columnInt(0);
                               const auto paymentCount = sales.columnInt(1);

                               auto orders = ctx->db().prepare(
                                   "SELECT COUNT(*), COALESCE(AVG(total_minor), 0) FROM orders "
                                   "WHERE business_day_id = :day "
                                   "  AND status NOT IN ('voided','draft')");
                               orders.bind(":day", dayId);
                               orders.step();

                               auto recent = ctx->db().prepare(
                                   "SELECT o.id, o.order_number AS orderNumber, t.label AS tableLabel, "
                                   "       o.status, o.total_minor AS totalMinor, "
                                   "       o.opened_at AS openedAt, u.full_name AS waiterName "
                                   "FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.table_id "
                                   "LEFT JOIN users u ON u.id = o.user_id "
                                   "ORDER BY o.opened_at DESC LIMIT 8");

                               auto printers = ctx->db().prepare(
                                   "SELECT "
                                   "  SUM(CASE WHEN status IN ('queued','retrying') THEN 1 ELSE 0 END), "
                                   "  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) "
                                   "FROM print_jobs");
                               printers.step();

                               auto unresolved = ctx->db().prepare(
                                   "SELECT COUNT(*) FROM payments WHERE status = 'unknown'");
                               unresolved.step();

                               auto outbox = ctx->db().prepare(
                                   "SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL");
                               outbox.step();

                               return Json{
                                   {"tables",
                                    Json{{"total", tables.columnInt(0)},
                                         {"available", tables.columnInt(1)},
                                         {"occupied", tables.columnInt(2)}}},
                                   {"kitchen",
                                    Json{{"preparing", kitchen.columnInt(0)},
                                         {"ready", kitchen.columnInt(1)}}},
                                   {"sales",
                                    Json{{"todayMinor", todaySales},
                                         {"paymentCount", paymentCount},
                                         {"orderCount", orders.columnInt(0)},
                                         {"averageOrderMinor",
                                          static_cast<Money>(orders.columnDouble(1))}}},
                                   {"recentOrders", recent.rows()},
                                   {"printer",
                                    Json{{"pending", printers.columnInt(0)},
                                         {"failed", printers.columnInt(1)}}},
                                   {"payments", Json{{"unresolved", unresolved.columnInt(0)}}},
                                   {"sync", Json{{"pending", outbox.columnInt(0)}}},
                                   {"serverTime", nowMs()},
                               };
                           });

    server.registerHandler(
        std::string(protocol::method::kReportsTopProducts), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.view");
            const auto limit =
                std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 8), 50);

            auto stmt = ctx->db().prepare(
                "SELECT i.product_id AS productId, i.name_snapshot AS name, "
                "       SUM(i.quantity) AS quantity, SUM(i.line_total_minor) AS revenueMinor "
                "FROM order_items i JOIN orders o ON o.id = i.order_id "
                "WHERE i.status != 'voided' AND o.status NOT IN ('voided','draft') "
                "  AND o.opened_at >= :day "
                "GROUP BY i.product_id, i.name_snapshot "
                "ORDER BY quantity DESC LIMIT :limit");
            stmt.bind(
                    ":day",
                    static_cast<std::int64_t>(startOfToday() - 7 * 86400000LL))
                .bind(":limit", limit);

            return Json{{"products", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kReportsSalesSummary), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.view");

            const auto from = getOr<Timestamp>(request.payload, "from", defaultReportStart(*ctx));
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs());

            auto byMethod = ctx->db().prepare(
                "SELECT method, COUNT(*) AS count, COALESCE(SUM(amount_minor), 0) AS totalMinor, "
                "       COALESCE(SUM(tip_minor), 0) AS tipsMinor "
                "FROM payments WHERE status = 'approved' AND created_at BETWEEN :from AND :to "
                "GROUP BY method");
            byMethod.bind(":from", from).bind(":to", to);

            auto byCategory = ctx->db().prepare(
                "SELECT c.name_az AS category, SUM(i.quantity) AS quantity, "
                "       SUM(i.line_total_minor) AS revenueMinor "
                "FROM order_items i "
                "JOIN menu_items m ON m.id = i.product_id "
                "JOIN menu_categories c ON c.id = m.category_id "
                "JOIN orders o ON o.id = i.order_id "
                "WHERE i.status != 'voided' AND o.opened_at BETWEEN :from AND :to "
                "GROUP BY c.id ORDER BY revenueMinor DESC");
            byCategory.bind(":from", from).bind(":to", to);

            auto totals = ctx->db().prepare(
                "SELECT COUNT(*), COALESCE(SUM(total_minor), 0), COALESCE(SUM(discount_minor), 0), "
                "       COALESCE(SUM(tax_minor), 0), COALESCE(SUM(service_minor), 0) "
                "FROM orders WHERE status IN ('paid','closed') AND opened_at BETWEEN :from AND :to");
            totals.bind(":from", from).bind(":to", to);
            totals.step();

            return Json{{"from", from},
                        {"to", to},
                        {"byMethod", byMethod.rows()},
                        {"byCategory", byCategory.rows()},
                        {"totals",
                         Json{{"orderCount", totals.columnInt(0)},
                              {"revenueMinor", totals.columnInt(1)},
                              {"discountMinor", totals.columnInt(2)},
                              {"taxMinor", totals.columnInt(3)},
                              {"serviceMinor", totals.columnInt(4)}}}};
        });

    // -------------------------------------------------------------------- sync
    server.registerHandler(std::string(protocol::method::kSyncStatus), [ctx](const ipc::Request&) {
        ctx->requireAuth();

        auto pending = ctx->db().prepare(
            "SELECT COUNT(*) FROM sync_outbox WHERE synced_at IS NULL");
        auto oldest = ctx->db().prepare(
            "SELECT MIN(created_at) FROM sync_outbox WHERE synced_at IS NULL");

        const auto pendingCount = pending.step() ? pending.columnInt(0) : 0;
        Timestamp oldestAt = 0;
        if (oldest.step() && !oldest.columnIsNull(0)) oldestAt = oldest.columnInt(0);

        // There is no remote server in this build; the outbox accumulates
        // locally so a future sync service can replay it in order.
        return Json{{"enabled", ctx->settingInt("sync.enabled", 0) != 0},
                    {"serverUrl", ctx->setting("sync.serverUrl", "")},
                    {"pendingCount", pendingCount},
                    {"oldestPendingAt", oldestAt},
                    {"lastSyncAt", nullptr},
                    {"mode", "offline"}};
    });

    server.registerHandler(
        std::string(protocol::method::kSyncOutbox), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto limit =
                std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 50), 200);

            auto stmt = ctx->db().prepare(
                "SELECT id, entity_type AS entityType, entity_id AS entityId, operation, "
                "       attempts, created_at AS createdAt, synced_at AS syncedAt "
                "FROM sync_outbox ORDER BY created_at DESC LIMIT :limit");
            stmt.bind(":limit", limit);
            return Json{{"entries", stmt.rows()}};
        });

    // ----------------------------------------------------------- business day
    server.registerHandler(std::string(protocol::method::kBusinessDayCurrent),
                           [ctx](const ipc::Request&) {
                               ctx->requireAuth();
                               return Json{{"businessDay", services::BusinessDayService(*ctx).current()}};
                           });

    server.registerHandler(
        std::string(protocol::method::kBusinessDayOpen), [ctx](const ipc::Request& request) {
            ctx->requirePermission("businessDay.manage");
            db::Transaction txn(ctx->db());
            const auto day = services::BusinessDayService(*ctx).open(
                getOr<Money>(request.payload, "openingFloatMinor", 0),
                getOr<std::string>(request.payload, "note", ""));
            txn.commit();
            return Json{{"businessDay", day}};
        });

    server.registerHandler(
        std::string(protocol::method::kBusinessDayReadiness), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.z");
            const auto dayId = getOr<std::string>(request.payload, "businessDayId", "");
            services::BusinessDayService days(*ctx);
            std::string id = dayId;
            if (id.empty()) {
                const auto open = days.openBusinessDayId();
                if (!open) throw PosError(std::string(protocol::err::kNotFound), "No open business day");
                id = *open;
            }
            const auto ready = days.readiness(id);
            return Json{{"businessDayId", id},
                        {"ready", ready.ready},
                        {"openOrders", ready.openOrders},
                        {"unresolvedPayments", ready.unresolvedPayments},
                        {"pendingKitchen", ready.pendingKitchen},
                        {"blockers", ready.blockers}};
        });

    server.registerHandler(std::string(protocol::method::kBusinessDayClose),
                           [ctx](const ipc::Request& request) {
                               ctx->requirePermission("businessDay.manage");
                               return runZClose(*ctx, request);
                           });

    // Same operation as businessDay.close. The protocol has always declared it;
    // until now it had no handler and the preload quietly aliased it away.
    server.registerHandler(std::string(protocol::method::kReportsZ),
                           [ctx](const ipc::Request& request) {
                               ctx->requirePermission("reports.z");
                               return runZClose(*ctx, request);
                           });

    server.registerHandler(
        std::string(protocol::method::kReportsX), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.x");
            services::BusinessDayService days(*ctx);

            db::Transaction txn(ctx->db());

            std::string id = getOr<std::string>(request.payload, "businessDayId", "");
            // Opening the till here is what makes "Z, then X" show an empty
            // report instead of an error: the new day exists and has no takings.
            if (id.empty()) id = days.ensureOpenBusinessDayId();

            const auto report = services::ReportService(*ctx).createXReport(id);
            txn.commit();

            emitReportCreated(*ctx, report, "x");
            enqueueReportPrint(*ctx, report, "x_report");
            return report;
        });

    server.registerHandler(
        std::string(protocol::method::kReportsPeriod), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.view");

            const auto from = getOr<Timestamp>(request.payload, "from", defaultReportStart(*ctx));
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs());
            const auto bucket = getOr<std::string>(request.payload, "bucket", "");

            services::ReportService reports(*ctx);
            Json result = reports.periodSummary(from, to);
            if (bucket == "hour" || bucket == "day") {
                result["bucket"] = bucket;
                result["buckets"] = reports.periodBuckets(from, to, bucket);
            }
            return result;
        });

    // The relay's door to the same figures. See protocol.json for why it is not
    // gated on a session: the owner asking over WhatsApp is not the cashier
    // signed in at the till, and reports.view is not a cashier's permission.
    server.registerHandler(
        std::string(protocol::method::kReportsRemotePeriod), [ctx](const ipc::Request& request) {
            const auto from = getOr<Timestamp>(request.payload, "from", 0);
            const auto to = getOr<Timestamp>(request.payload, "to", 0);
            if (from <= 0 || to <= from) {
                throw PosError(std::string(protocol::err::kValidation),
                               "from and to must be milliseconds with to after from");
            }
            // A mistyped range should come back as an error rather than as a
            // full-table scan: payments.created_at carries no index of its own.
            constexpr Timestamp kMaxSpanMs = 31LL * 24 * 60 * 60 * 1000;
            if (to - from > kMaxSpanMs) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Range is longer than 31 days");
            }
            // No buckets: the reply travels back through the control server into
            // a chat message, and an hour-by-hour table is not readable there.
            return services::ReportService(*ctx).periodSummary(from, to);
        });

    server.registerHandler(
        std::string(protocol::method::kReportsList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.view");
            const auto id = getOr<std::string>(request.payload, "businessDayId", "");
            return services::ReportService(*ctx).listReports(id);
        });

    server.registerHandler(
        std::string(protocol::method::kReportsGetSnapshot), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.view");
            return services::ReportService(*ctx).getSnapshot(
                getOr<std::string>(request.payload, "snapshotId", ""));
        });

    server.registerHandler(std::string(protocol::method::kCashList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("cash.manage");
        return services::CashService(*ctx).listMovements(
            getOr<std::string>(request.payload, "businessDayId", ""));
    });

    server.registerHandler(
        std::string(protocol::method::kCashMovement), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.manage");
            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = request.idempotencyKey.empty()
                                 ? getOr<std::string>(request.payload, "idempotencyKey", "")
                                 : request.idempotencyKey;
            if (auto replay = idem.begin(key, "cash.movement", request.payload)) return *replay;
            const auto row = services::CashService(*ctx).recordMovement(
                getOr<std::string>(request.payload, "kind", ""),
                getOr<Money>(request.payload, "amountMinor", 0),
                getOr<std::string>(request.payload, "reason", ""),
                getOr<std::string>(request.payload, "note", ""),
                getOr<std::string>(request.payload, "businessDayId", ""),
                getOr<std::string>(request.payload, "shiftId", ""));
            Json response{{"movement", row}};
            idem.complete(key, response, "cash_movement", row.value("id", ""));
            txn.commit();
            return response;
        });

    server.registerHandler(std::string(protocol::method::kGiftsListCampaigns),
                           [ctx](const ipc::Request& request) {
                               ctx->requireAuth();
                               return services::GiftCampaignService(*ctx).listCampaigns(
                                   getOr<bool>(request.payload, "activeOnly", true));
                           });

    server.registerHandler(
        std::string(protocol::method::kGiftsUpsertCampaign), [ctx](const ipc::Request& request) {
            ctx->requirePermission("gifts.manage");
            db::Transaction txn(ctx->db());
            const auto result = services::GiftCampaignService(*ctx).upsertCampaign(request.payload);
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kGiftsEvaluateOrder), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            return services::GiftCampaignService(*ctx).evaluateOrder(
                getOr<std::string>(request.payload, "orderId", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kGiftsApply), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            db::Transaction txn(ctx->db());
            const auto result = services::GiftCampaignService(*ctx).applyGift(
                getOr<std::string>(request.payload, "orderId", ""),
                getOr<std::string>(request.payload, "campaignId", ""),
                getOr<std::string>(request.payload, "tierId", ""));
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kGiftsApproveReview), [ctx](const ipc::Request& request) {
            const auto managerPin = getOr<std::string>(request.payload, "managerPin", "");
            const std::string approver =
                ctx->requireManagerApproval("gifts.override", managerPin, "gifts.approveReview");
            db::Transaction txn(ctx->db());
            const auto result = services::GiftCampaignService(*ctx).approveReview(
                getOr<std::string>(request.payload, "orderId", ""), approver);
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kPaymentsListRefunds), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.refund");
            return services::RefundService(*ctx).listForPayment(
                getOr<std::string>(request.payload, "paymentId", ""));
        });

    // ----------------------------------------------------------------- license
    server.registerHandler(std::string(protocol::method::kLicenseStatus),
                           [ctx](const ipc::Request&) {
                               return services::LicenseService(*ctx).status();
                           });

    server.registerHandler(
        std::string(protocol::method::kLicenseActivate), [ctx](const ipc::Request& request) {
            // Electron main verifies the signed payload with the control API,
            // then forwards the verified payload here for durable local cache.
            const auto payload = request.payload.contains("payload") &&
                                         request.payload.at("payload").is_object()
                                     ? request.payload.at("payload")
                                     : request.payload;
            db::Transaction txn(ctx->db());
            const auto status = services::LicenseService(*ctx).storeSignedPayload(
                payload, getOr<std::string>(request.payload, "signature", ""),
                getOr<std::string>(request.payload, "keyId", ""));
            txn.commit();
            return status;
        });

    server.registerHandler(
        std::string(protocol::method::kLicenseImportOffline), [ctx](const ipc::Request& request) {
            Json payload = request.payload;
            if (payload.contains("licenseFileContents") &&
                payload.at("licenseFileContents").is_string()) {
                payload = Json::parse(payload.at("licenseFileContents").get<std::string>());
            }
            db::Transaction txn(ctx->db());
            const auto status = services::LicenseService(*ctx).storeSignedPayload(
                payload.value("payload", payload), getOr<std::string>(payload, "signature", ""),
                getOr<std::string>(payload, "keyId", ""));
            txn.commit();
            return status;
        });

    server.registerHandler(std::string(protocol::method::kLicenseExportOfflineRequest),
                           [ctx](const ipc::Request& request) {
                               const auto status = services::LicenseService(*ctx).status();
                               Json out{
                                   {"requestVersion", 1},
                                   {"installationId",
                                    ctx->setting("device.installationId", "")},
                                   {"terminalId", ctx->terminalId()},
                                   {"platform",
#ifdef _WIN32
                                    "win32"
#else
                                    "linux"
#endif
                                   },
                                   {"requestedAt", nowMs()},
                                   {"currentStatus", status.value("status", "unlicensed")},
                                   {"controlUrl", status.value("controlUrl",
                                                               "http://127.0.0.1:3210/pos/api")},
                               };
                               // Electron main may attach fingerprint / public key before writing
                               // the .cposreq file; accept passthrough enrichment fields.
                               if (request.payload.is_object()) {
                                   for (auto it = request.payload.begin();
                                        it != request.payload.end(); ++it) {
                                       if (!out.contains(it.key())) out[it.key()] = it.value();
                                   }
                               }
                               return out;
                           });

    server.registerHandler(std::string(protocol::method::kLicenseHeartbeat),
                           [ctx](const ipc::Request&) {
                               const auto now = nowMs();
                               auto touch = ctx->db().prepare(
                                   "UPDATE license_state SET last_heartbeat_at = :now, "
                                   "updated_at = :now WHERE id = 'local'");
                               touch.bind(":now", now);
                               touch.exec();
                               return services::LicenseService(*ctx).status();
                           });

    // ----------------------------------------------------------------- backup
    server.registerHandler(
        std::string(protocol::method::kBackupCreate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("backup.manage");
            const auto note = getOr<std::string>(request.payload, "note", "");
            const auto source = std::filesystem::path(ctx->db().path());
            const auto dir = source.parent_path() / "backups";
            const auto dest =
                dir / (source.stem().string() + "-manual-" + std::to_string(nowMs()) + ".db");
            ctx->db().backupTo(dest.string());
            const std::string id = crypto::uuid4();
            auto insert = ctx->db().prepare(
                "INSERT INTO backup_manifests (id, path, kind, size_bytes, content_sha256, "
                "  includes_json, created_by, created_at, note) "
                "VALUES (:id, :path, 'manual', :size, '', '[\"db\"]', :user, :now, :note)");
            std::error_code ec;
            const auto size = static_cast<std::int64_t>(std::filesystem::file_size(dest, ec));
            insert.bind(":id", id)
                .bind(":path", dest.string())
                .bind(":size", size)
                .bindOptional(":user", ctx->session().userId)
                .bind(":now", nowMs())
                .bind(":note", note);
            insert.exec();
            ctx->auditRequired("backup.create", "backup", id, Json{{"path", dest.string()}});
            return Json{{"id", id}, {"path", dest.string()}, {"sizeBytes", size}};
        });

    server.registerHandler(std::string(protocol::method::kBackupList), [ctx](const ipc::Request&) {
        ctx->requirePermission("backup.manage");
        auto stmt = ctx->db().prepare(
            "SELECT id, path, kind, size_bytes AS sizeBytes, created_at AS createdAt, note "
            "FROM backup_manifests ORDER BY created_at DESC");
        return Json{{"backups", stmt.rows()}};
    });

    server.registerHandler(
        std::string(protocol::method::kBackupRestorePreview), [ctx](const ipc::Request& request) {
            ctx->requirePermission("backup.manage");
            const auto backupId = getOr<std::string>(request.payload, "backupId", "");

            auto stmt = ctx->db().prepare(
                "SELECT id, path, kind, size_bytes AS sizeBytes, created_at AS createdAt, note "
                "FROM backup_manifests WHERE id = :id");
            stmt.bind(":id", backupId);
            if (!stmt.step()) throw PosError::of(protocol::err::kNotFound);
            Json manifest = stmt.row();

            const std::string path = manifest.value("path", "");
            const bool exists = !path.empty() && std::filesystem::exists(path);

            // What the operator is about to lose. Everything recorded after the
            // backup was taken disappears, so it is spelled out rather than
            // summarised as "data will be replaced".
            const std::int64_t takenAt = manifest.value("createdAt", std::int64_t{0});
            auto since = ctx->db().prepare(
                "SELECT (SELECT COUNT(*) FROM orders WHERE opened_at > :at), "
                "       (SELECT COUNT(*) FROM payments WHERE created_at > :at), "
                "       (SELECT COALESCE(SUM(amount_minor), 0) FROM payments "
                "        WHERE created_at > :at AND status = 'approved'), "
                "       (SELECT COUNT(*) FROM business_days WHERE opened_at > :at)");
            since.bind(":at", takenAt);
            since.step();

            return Json{{"backup", manifest},
                        {"fileExists", exists},
                        {"ordersSince", since.columnInt(0)},
                        {"paymentsSince", since.columnInt(1)},
                        {"paymentsTotalMinorSince", since.columnInt(2)},
                        {"businessDaysSince", since.columnInt(3)},
                        {"requiresPin", true}};
        });

    server.registerHandler(
        std::string(protocol::method::kBackupRestore), [ctx](const ipc::Request& request) {
            ctx->requirePermission("backup.manage");
            const auto backupId = getOr<std::string>(request.payload, "backupId", "");
            const auto adminPin = getOr<std::string>(request.payload, "adminPin", "");

            // A restore discards live trading data, so it always needs a PIN -
            // even when the caller already holds the permission.
            const std::string approver =
                ctx->requireManagerApproval("backup.manage", adminPin, "backup.restore");

            std::string path;
            {
                auto stmt = ctx->db().prepare(
                    "SELECT path FROM backup_manifests WHERE id = :id");
                stmt.bind(":id", backupId);
                if (!stmt.step()) throw PosError::of(protocol::err::kNotFound);
                path = stmt.columnText(0);
            }
            if (path.empty() || !std::filesystem::exists(path)) {
                throw PosError(std::string(protocol::err::kNotFound),
                               "The backup file is missing: " + path);
            }

            // Safety copy first: if the chosen backup turns out to be the wrong
            // one, the pre-restore state is still on disk.
            const auto source = std::filesystem::path(ctx->db().path());
            const auto safety = source.parent_path() / "backups" /
                                (source.stem().string() + "-prerestore-" +
                                 std::to_string(nowMs()) + ".db");
            ctx->db().backupTo(safety.string());

            ctx->auditRequired("backup.restore.begin", "backup", backupId,
                               Json{{"path", path}, {"safetyCopy", safety.string()}}, approver);

            ctx->db().restoreFrom(path);

            // The restored file carries its own audit log, so this entry lands
            // in the restored history - which is where it has to be findable.
            ctx->auditRequired("backup.restore", "backup", backupId,
                               Json{{"path", path}, {"safetyCopy", safety.string()}}, approver);

            return Json{{"backupId", backupId},
                        {"restored", true},
                        {"safetyCopy", safety.string()},
                        {"restartRequired", true}};
        });
}

}  // namespace pos::handlers
