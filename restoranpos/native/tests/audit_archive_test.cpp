#include "catch_amalgamated.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

#include "pos/Crypto.hpp"
#include "pos/db/Database.hpp"
#include "pos/db/Migrator.hpp"
#include "pos/services/AuditArchive.hpp"

namespace {

constexpr std::int64_t kDayMs = 86'400'000LL;

class TempDatabase {
public:
    TempDatabase() {
        static std::atomic<unsigned long long> sequence{0};
        const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
        directory_ = std::filesystem::temp_directory_path() /
                     ("pos-audit-archive-" + std::to_string(tick) + "-" +
                      std::to_string(sequence.fetch_add(1)));
        std::filesystem::create_directories(directory_);
        path_ = directory_ / "pos.db";
        db_.open(path_.string());
        pos::db::Migrator migrator(db_);
        migrator.migrate({});
    }

    ~TempDatabase() {
        db_.close();
        std::error_code ec;
        std::filesystem::remove_all(directory_, ec);
    }

    pos::db::Database& db() { return db_; }
    std::string path() const { return path_.string(); }

private:
    std::filesystem::path directory_;
    std::filesystem::path path_;
    pos::db::Database db_;
};

void insertEntry(pos::db::Database& db, const std::string& action, std::int64_t createdAt) {
    auto stmt = db.prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, data,"
        "                        terminal_id, created_at) "
        "VALUES (:id, NULL, :action, 'order', 'ord-1', '{\"note\":\"kept\"}', 'TERM-01', :now)");
    stmt.bind(":id", pos::crypto::uuid4()).bind(":action", action).bind(":now", createdAt);
    stmt.exec();
}

std::int64_t countEntries(pos::db::Database& db) {
    auto stmt = db.prepare("SELECT COUNT(*) FROM audit_logs");
    REQUIRE(stmt.step());
    return stmt.columnInt(0);
}

void setSetting(pos::db::Database& db, const std::string& key, const std::string& value) {
    auto stmt = db.prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) VALUES (:k, :v, 'string', 0) "
        "ON CONFLICT(key) DO UPDATE SET value = :v");
    stmt.bind(":k", key).bind(":v", value);
    stmt.exec();
}

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

}  // namespace

TEST_CASE("the audit trail still refuses to be edited or deleted", "[audit][retention]") {
    TempDatabase fixture;
    insertEntry(fixture.db(), "order.create", pos::nowMs());

    SECTION("an update is rejected outright") {
        auto stmt = fixture.db().prepare("UPDATE audit_logs SET action = 'tampered'");
        REQUIRE_THROWS(stmt.exec());
    }

    SECTION("a delete is rejected while the prune flag is down") {
        auto stmt = fixture.db().prepare("DELETE FROM audit_logs");
        REQUIRE_THROWS(stmt.exec());
        REQUIRE(countEntries(fixture.db()) == 1);
    }

    SECTION("raising the prune flag is what lets a row go") {
        setSetting(fixture.db(), "audit.pruneAllowed", "1");
        auto stmt = fixture.db().prepare("DELETE FROM audit_logs");
        stmt.exec();
        REQUIRE(countEntries(fixture.db()) == 0);
    }
}

TEST_CASE("old entries are written out before they are removed", "[audit][retention]") {
    TempDatabase fixture;
    const std::int64_t now = pos::nowMs();

    insertEntry(fixture.db(), "order.create", now - 500 * kDayMs);  // past the hard limit
    insertEntry(fixture.db(), "order.void", now - 200 * kDayMs);    // old, but unforwarded
    insertEntry(fixture.db(), "payment.take", now);                 // today

    const auto result = pos::services::AuditArchive::run(fixture.db(), fixture.path());

    REQUIRE(result.error.empty());
    // Only the entry past the hard limit goes: the 200-day-old one has not been
    // acknowledged by control, and today's is inside the retention window.
    REQUIRE(result.archived == 1);
    REQUIRE(result.files.size() == 1);

    const std::string body = readFile(result.files.front());
    REQUIRE(body.find("order.create") != std::string::npos);
    REQUIRE(body.find("kept") != std::string::npos);
    REQUIRE(body.find("order.void") == std::string::npos);

    // Two originals left, plus the entry recording the prune itself.
    REQUIRE(countEntries(fixture.db()) == 3);
    auto pruned = fixture.db().prepare("SELECT COUNT(*) FROM audit_logs WHERE action='audit.pruned'");
    REQUIRE(pruned.step());
    REQUIRE(pruned.columnInt(0) == 1);

    // The escape hatch must be closed again, or the next stray DELETE succeeds.
    auto flag = fixture.db().prepare("SELECT value FROM app_settings WHERE key='audit.pruneAllowed'");
    REQUIRE(flag.step());
    REQUIRE(flag.columnText(0) == "0");
}

TEST_CASE("a forwarded entry can be archived as soon as it is old enough", "[audit][retention]") {
    TempDatabase fixture;
    const std::int64_t now = pos::nowMs();
    const std::int64_t old = now - 200 * kDayMs;

    insertEntry(fixture.db(), "order.void", old);
    // Control has acknowledged everything up to this point.
    setSetting(fixture.db(), "audit.sync.watermarkAt", std::to_string(old));

    const auto result = pos::services::AuditArchive::run(fixture.db(), fixture.path());
    REQUIRE(result.error.empty());
    REQUIRE(result.archived == 1);
}

TEST_CASE("nothing inside the retention window is ever archived", "[audit][retention]") {
    TempDatabase fixture;
    const std::int64_t now = pos::nowMs();
    insertEntry(fixture.db(), "order.create", now - 10 * kDayMs);
    // Even with the watermark past it, a recent entry stays in the database:
    // the till's own history page is what the manager reads first.
    setSetting(fixture.db(), "audit.sync.watermarkAt", std::to_string(now));

    const auto result = pos::services::AuditArchive::run(fixture.db(), fixture.path());
    REQUIRE(result.error.empty());
    REQUIRE(result.archived == 0);
    REQUIRE(countEntries(fixture.db()) == 1);
}
