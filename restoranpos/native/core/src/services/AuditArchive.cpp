#include "pos/services/AuditArchive.hpp"

#include <algorithm>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <map>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Logging.hpp"

namespace pos::services {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

constexpr std::int64_t kDayMs = 86'400'000LL;
/** Entries younger than this are never touched, whatever the settings say. */
constexpr std::int64_t kMinRetentionDays = 30;
constexpr std::int64_t kDefaultRetentionDays = 120;
/**
 * An unsynced till is still swept eventually.
 *
 * Waiting for control to acknowledge every entry is the right rule for a till
 * that is paired. A till that never was — an unlicensed install, a venue with no
 * internet — would otherwise keep growing forever, which is the failure this
 * whole service exists to prevent.
 */
constexpr std::int64_t kHardRetentionDays = 400;
/** Rows read and deleted per pass, so a long sweep never holds one big lock. */
constexpr int kBatchSize = 2'000;
constexpr int kMaxBatches = 50;

/** `YYYY-MM` in local time, which is how an operator will look for a month. */
std::string monthKey(std::int64_t createdAtMs) {
    const std::time_t seconds = static_cast<std::time_t>(createdAtMs / 1000);
    std::tm parts{};
#ifdef _WIN32
    localtime_s(&parts, &seconds);
#else
    localtime_r(&seconds, &parts);
#endif
    char buf[16];
    std::snprintf(buf, sizeof(buf), "%04d-%02d", parts.tm_year + 1900, parts.tm_mon + 1);
    return buf;
}

}  // namespace

std::string AuditArchive::archiveDir(const std::string& dbPath) {
    std::filesystem::path db(dbPath);
    std::filesystem::path parent = db.parent_path();
    if (parent.empty()) parent = std::filesystem::current_path();
    return (parent / "audit-archive").string();
}

std::int64_t AuditArchive::settingInt(db::Database& db, const std::string& key,
                                      std::int64_t fallback) {
    auto stmt = db.prepare("SELECT value FROM app_settings WHERE key = :key");
    stmt.bind(":key", key);
    if (!stmt.step()) return fallback;
    const std::string raw = stmt.columnText(0);
    if (raw.empty()) return fallback;
    try {
        return std::stoll(raw);
    } catch (...) {
        return fallback;
    }
}

void AuditArchive::setSetting(db::Database& db, const std::string& key, const std::string& value) {
    auto stmt = db.prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'string', :now) "
        "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
    stmt.bind(":key", key).bind(":value", value).bind(":now", nowMs());
    stmt.exec();
}

AuditArchive::Result AuditArchive::run(db::Database& db, const std::string& dbPath) {
    Result result;
    try {
        const std::int64_t now = nowMs();
        const std::int64_t retentionDays = std::max(
            kMinRetentionDays, settingInt(db, "audit.retentionDays", kDefaultRetentionDays));
        const std::int64_t ageCutoff = now - retentionDays * kDayMs;
        const std::int64_t hardCutoff = now - kHardRetentionDays * kDayMs;
        const std::int64_t watermark = settingInt(db, "audit.sync.watermarkAt", 0);

        // Nothing forwarded and nothing old enough to force: leave it alone.
        auto selectBatch = db.prepare(
            "SELECT id, actor_user_id, action, entity_type, entity_id, data, terminal_id, "
            "       created_at "
            "FROM audit_logs "
            "WHERE created_at < :ageCutoff "
            "  AND (created_at <= :watermark OR created_at < :hardCutoff) "
            "ORDER BY created_at ASC, id ASC "
            "LIMIT :limit");

        const std::string dir = archiveDir(dbPath);

        for (int pass = 0; pass < kMaxBatches; ++pass) {
            selectBatch.bind(":ageCutoff", ageCutoff)
                .bind(":watermark", watermark)
                .bind(":hardCutoff", hardCutoff)
                .bind(":limit", kBatchSize);

            std::map<std::string, std::string> byMonth;
            std::vector<std::string> ids;
            while (selectBatch.step()) {
                const std::int64_t createdAt = selectBatch.columnInt(7);
                Json entry{
                    {"id", selectBatch.columnText(0)},
                    {"actorUserId", selectBatch.columnIsNull(1) ? Json(nullptr)
                                                               : Json(selectBatch.columnText(1))},
                    {"action", selectBatch.columnText(2)},
                    {"entityType", selectBatch.columnText(3)},
                    {"entityId", selectBatch.columnText(4)},
                    {"terminalId", selectBatch.columnText(6)},
                    {"createdAt", createdAt},
                };
                // `data` is stored as JSON text; kept as a nested object where it
                // parses so the archive is queryable with jq, and verbatim where
                // it does not, so nothing is ever silently dropped.
                const std::string raw = selectBatch.columnText(5);
                Json parsed = Json::parse(raw, nullptr, false);
                entry["data"] = parsed.is_discarded() ? Json(raw) : parsed;

                byMonth[monthKey(createdAt)] += serialize(entry) + "\n";
                ids.push_back(selectBatch.columnText(0));
            }
            if (ids.empty()) break;

            // Written before anything is deleted, and flushed, so a crash between
            // the two loses nothing: the worst case is a duplicated archive line.
            std::filesystem::create_directories(dir);
            for (const auto& [month, body] : byMonth) {
                const std::string file = (std::filesystem::path(dir) / (month + ".jsonl")).string();
                std::ofstream out(file, std::ios::app | std::ios::binary);
                if (!out) {
                    result.error = "cannot write " + file;
                    logger()->warn("audit archive: {}", result.error);
                    return result;
                }
                out << body;
                out.flush();
                if (!out) {
                    result.error = "write failed for " + file;
                    logger()->warn("audit archive: {}", result.error);
                    return result;
                }
                if (std::find(result.files.begin(), result.files.end(), file) ==
                    result.files.end()) {
                    result.files.push_back(file);
                }
            }

            // The append-only trigger stands aside only for the statement below,
            // and the flag is cleared whether or not the delete succeeds.
            setSetting(db, "audit.pruneAllowed", "1");
            try {
                db.withTransaction([&] {
                    auto del = db.prepare("DELETE FROM audit_logs WHERE id = :id");
                    for (const auto& id : ids) {
                        del.bind(":id", id);
                        del.exec();
                    }
                });
            } catch (...) {
                setSetting(db, "audit.pruneAllowed", "0");
                throw;
            }
            setSetting(db, "audit.pruneAllowed", "0");
            result.archived += static_cast<int>(ids.size());

            if (static_cast<int>(ids.size()) < kBatchSize) break;
        }

        setSetting(db, "audit.archive.lastRunAt", std::to_string(now));

        if (result.archived > 0) {
            // The prune is itself part of the history: an operator who finds a
            // gap must be able to see it was this, and not somebody erasing it.
            auto note = db.prepare(
                "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, data,"
                "                        terminal_id, created_at) "
                "VALUES (:id, NULL, 'audit.pruned', 'audit_logs', '', :data, :terminal, :now)");
            auto terminal = db.prepare("SELECT value FROM app_settings WHERE key = 'terminal.id'");
            const std::string terminalId = terminal.step() ? terminal.columnText(0) : "TERM-01";
            Json data{
                {"archived", result.archived},
                {"retentionDays", retentionDays},
                {"files", result.files},
            };
            note.bind(":id", crypto::uuid4())
                .bind(":data", serialize(data))
                .bind(":terminal", terminalId)
                .bind(":now", nowMs());
            note.exec();

            logger()->info("archived {} audit entr(ies) into {}", result.archived, dir);
        }
    } catch (const std::exception& err) {
        result.error = err.what();
        logger()->warn("audit archive failed: {}", result.error);
    }
    return result;
}

}  // namespace pos::services
