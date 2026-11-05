#include "catch_amalgamated.hpp"

#include <filesystem>
#include <fstream>

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/db/Migrator.hpp"
#include "pos/db/migrations_generated.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/DataWipe.hpp"

namespace fs = std::filesystem;

namespace {
std::int64_t count(pos::db::Database& db, const std::string& sql) {
    auto q = db.prepare(sql);
    REQUIRE(q.step());
    return q.columnInt(0);
}
std::string text(pos::db::Database& db, const std::string& sql) {
    auto q = db.prepare(sql);
    return q.step() ? q.columnText(0) : std::string("<none>");
}
void touch(const fs::path& file) {
    fs::create_directories(file.parent_path());
    std::ofstream(file) << "x";
}
void wipeFixtureData(pos::db::Database& db) {
    db.exec("INSERT INTO menu_categories (id, name_az) VALUES ('wipe-cat', 'Pizza')");
    db.exec("UPDATE license_state SET status = 'active', customer_id = 'cust-1', device_id = 'dev-1' WHERE id = 'local'");
    db.exec("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES "
            "('terminal.id', 'TERM-07', 1), ('license.controlUrl', 'https://control', 1), "
            "('restaurant.name', 'Köhnə ad', 1)");
    db.exec("INSERT INTO users (id, code, full_name, pin_hash, primary_role_id, created_at, updated_at) "
            "VALUES ('wipe-user', 'W9', 'Aysel', 'h', 'role-waiter', 1, 1)");
}
}  // namespace

TEST_CASE("wiping leaves a new install that is still licensed, with a copy of the old data", "[datawipe]") {
    ServiceFixture f;
    auto& db = f.db();
    if (count(db, "SELECT COUNT(*) FROM license_state") == 0)
        db.exec("INSERT INTO license_state (id, updated_at) VALUES ('local', 1)");
    wipeFixtureData(db);
    const auto dir = fs::path(db.path()).parent_path();
    touch(dir / "backups" / "pos-pre-migration-v1-to-v2-1-x.db");
    touch(dir / "audit-archive" / "2026-01.ndjson");

    const auto kept = pos::services::DataWipe::run(db);

    // Everything the customer made is gone.
    REQUIRE(count(db, "SELECT COUNT(*) FROM menu_categories WHERE id = 'wipe-cat'") == 0);
    REQUIRE(count(db, "SELECT COUNT(*) FROM users WHERE id = 'wipe-user'") == 0);
    REQUIRE(text(db, "SELECT value FROM app_settings WHERE key = 'restaurant.name'") != "Köhnə ad");

    // The till stays activated and keeps its identity, on the current schema.
    REQUIRE(text(db, "SELECT status FROM license_state WHERE id = 'local'") == "active");
    REQUIRE(text(db, "SELECT device_id FROM license_state WHERE id = 'local'") == "dev-1");
    REQUIRE(text(db, "SELECT value FROM app_settings WHERE key = 'terminal.id'") == "TERM-07");
    REQUIRE(text(db, "SELECT value FROM app_settings WHERE key = 'license.controlUrl'") == "https://control");
    REQUIRE(count(db, "PRAGMA user_version") == static_cast<std::int64_t>(pos::db::kMigrations.back().version));

    // A new install can sign in; reports and the audit log still refuse to be rewritten.
    REQUIRE(count(db, "SELECT COUNT(*) FROM users WHERE id = 'usr-admin'") == 1);

    // Only the fresh copy remains, and it really holds the old data.
    REQUIRE_FALSE(fs::exists(dir / "backups" / "pos-pre-migration-v1-to-v2-1-x.db"));
    REQUIRE_FALSE(fs::exists(dir / "audit-archive"));
    REQUIRE(fs::exists(dir / "backups" / kept));
    pos::db::Database old;
    old.open((dir / "backups" / kept).string());
    REQUIRE(count(old, "SELECT COUNT(*) FROM menu_categories WHERE id = 'wipe-cat'") == 1);
    old.close();

    // No working files are left next to the database.
    for (const auto& entry : fs::directory_iterator(dir))
        REQUIRE(entry.path().filename().string().find("wipe-fresh") == std::string::npos);

    // The till keeps working, and a second wipe is harmless.
    db.exec("INSERT INTO menu_categories (id, name_az) VALUES ('after', 'Yeni')");
    pos::services::DataWipe::run(db);
    REQUIRE(count(db, "SELECT COUNT(*) FROM menu_categories WHERE id = 'after'") == 0);
}

TEST_CASE("the wipe is a core method the till can call, and it leaves a trail in the new database", "[datawipe]") {
    ServiceFixture f;
    pos::handlers::registerSystem(f.contextPtr());
    pos::ipc::Request r;
    r.requestId = pos::crypto::uuid4();
    r.method = "system.wipeAllData";
    r.payload = pos::Json{{"commandId", "cmd-1"}};
    const auto out = f.server().callHandler(r);
    REQUIRE(out.at("wiped") == true);
    REQUIRE(out.at("keptCopy").get<std::string>().find("-before-wipe-") != std::string::npos);
    REQUIRE(count(f.db(), "SELECT COUNT(*) FROM audit_logs WHERE action = 'data.wipeAll' AND entity_id = 'cmd-1'") == 1);
}

TEST_CASE("kept copies go after 30 days and nothing else in backups is touched", "[datawipe]") {
    ServiceFixture f;
    const auto dir = fs::path(f.db().path()).parent_path() / "backups";
    const std::int64_t now = 1'800'000'000'000LL, day = 86'400'000LL;
    const auto old = dir / ("pos-before-wipe-" + std::to_string(now - 31 * day) + ".db");
    const auto recent = dir / ("pos-before-wipe-" + std::to_string(now - 29 * day) + ".db");
    const auto other = dir / "pos-manual-1.db";
    const auto odd = dir / "pos-before-wipe-notanumber.db";
    for (const auto& file : {old, recent, other, odd}) touch(file);

    pos::services::DataWipe::purgeExpiredCopies(f.db().path(), now);

    REQUIRE_FALSE(fs::exists(old));
    REQUIRE(fs::exists(recent));
    REQUIRE(fs::exists(other));
    REQUIRE(fs::exists(odd));

    // A till without a backups folder starts normally.
    pos::services::DataWipe::purgeExpiredCopies((dir / "missing" / "pos.db").string(), now);
}
