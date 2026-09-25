#include "catch_amalgamated.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

#include <sqlite3.h>

#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/db/Migrator.hpp"
#include "pos/db/migrations_generated.hpp"
#include "pos/protocol_generated.hpp"

namespace {

class MigrationTestDatabase {
public:
    MigrationTestDatabase() {
        static std::atomic<unsigned long long> sequence{0};
        const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
        directory_ = std::filesystem::temp_directory_path() /
                     ("maison-pos-migration-test-" + std::to_string(tick) + "-" +
                      std::to_string(sequence.fetch_add(1)));
        std::filesystem::create_directories(directory_);
        databasePath_ = directory_ / "pos.db";
        database_.open(databasePath_.string());
    }

    ~MigrationTestDatabase() {
        database_.close();
        std::error_code ec;
        std::filesystem::remove_all(directory_, ec);
    }

    pos::db::Database& database() { return database_; }
    const std::filesystem::path& directory() const { return directory_; }
    const std::filesystem::path& databasePath() const { return databasePath_; }

private:
    std::filesystem::path directory_;
    std::filesystem::path databasePath_;
    pos::db::Database database_;
};

void requireMigrationFailure(pos::db::Migrator& migrator) {
    try {
        static_cast<void>(migrator.migrate({}));
        FAIL("migration metadata drift was accepted");
    } catch (const pos::PosError& error) {
        REQUIRE(error.code() == pos::protocol::err::kMigrationFailed);
    }
}

std::int64_t scalarInt(pos::db::Database& database, const std::string& sql) {
    auto statement = database.prepare(sql);
    REQUIRE(statement.step());
    return statement.columnInt(0);
}

std::string scalarText(pos::db::Database& database, const std::string& sql) {
    auto statement = database.prepare(sql);
    REQUIRE(statement.step());
    return statement.columnText(0);
}

std::vector<std::filesystem::path> backupFiles(const MigrationTestDatabase& fixture) {
    const auto backupDirectory = fixture.databasePath().parent_path() / "backups";
    if (!std::filesystem::exists(backupDirectory)) return {};

    std::vector<std::filesystem::path> files;
    for (const auto& entry : std::filesystem::directory_iterator(backupDirectory)) {
        if (entry.is_regular_file()) files.push_back(entry.path());
    }
    return files;
}

class ReadOnlySqlite {
public:
    explicit ReadOnlySqlite(const std::filesystem::path& path) {
        REQUIRE(sqlite3_open_v2(path.string().c_str(), &handle_,
                                SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nullptr) ==
                SQLITE_OK);
        REQUIRE(sqlite3_db_readonly(handle_, "main") == 1);
    }

    ~ReadOnlySqlite() {
        if (handle_) sqlite3_close(handle_);
    }

    std::int64_t scalarInt(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        REQUIRE(sqlite3_prepare_v2(handle_, sql, -1, &statement, nullptr) == SQLITE_OK);
        REQUIRE(sqlite3_step(statement) == SQLITE_ROW);
        const auto value = sqlite3_column_int64(statement, 0);
        REQUIRE(sqlite3_finalize(statement) == SQLITE_OK);
        return value;
    }

    std::string scalarText(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        REQUIRE(sqlite3_prepare_v2(handle_, sql, -1, &statement, nullptr) == SQLITE_OK);
        REQUIRE(sqlite3_step(statement) == SQLITE_ROW);
        const auto* text = reinterpret_cast<const char*>(sqlite3_column_text(statement, 0));
        const std::string value = text ? text : "";
        REQUIRE(sqlite3_finalize(statement) == SQLITE_OK);
        return value;
    }

private:
    sqlite3* handle_ = nullptr;
};

std::vector<pos::db::MigrationDefinition> successfulTestMigrations() {
    return {
        {1, "001_test.sql", "test-v1",
         "CREATE TABLE migration_probe ("
         "  id INTEGER PRIMARY KEY,"
         "  value TEXT NOT NULL)"},
        {2, "002_test.sql", "test-v2",
         "ALTER TABLE migration_probe "
         "ADD COLUMN amount_minor INTEGER NOT NULL DEFAULT 0"},
    };
}

std::vector<pos::db::MigrationDefinition> failingTestMigrations() {
    auto migrations = successfulTestMigrations();
    migrations[1].sql =
        "CREATE TABLE should_rollback (id INTEGER PRIMARY KEY);"
        "INSERT INTO table_that_does_not_exist VALUES (1)";
    return migrations;
}

}  // namespace

TEST_CASE("valid applied migration metadata is accepted", "[database][migration]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    pos::db::Migrator migrator(database);

    const int applied = migrator.migrate({});
    REQUIRE(applied == static_cast<int>(pos::db::kMigrations.size()));
    REQUIRE(migrator.migrate({}) == 0);
    REQUIRE(migrator.currentVersion() == pos::db::kMigrations.back().version);

    auto record = database.prepare(
        "SELECT name, checksum FROM database_migrations WHERE version = 1");
    REQUIRE(record.step());
    REQUIRE(record.columnText(0) == pos::db::kMigrations[0].name);
    REQUIRE(record.columnText(1) == pos::db::kMigrations[0].checksum);
}

TEST_CASE("applied migration checksum drift heals on startup", "[database][migration]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    pos::db::Migrator migrator(database);

    REQUIRE(migrator.migrate({}) == static_cast<int>(pos::db::kMigrations.size()));
    database.exec("UPDATE database_migrations SET checksum = 'deadbeef' WHERE version = 1");

    REQUIRE(migrator.migrate({}) == 0);  // already at target; heal only
    REQUIRE(scalarText(database, "SELECT checksum FROM database_migrations WHERE version = 1") ==
            std::string(pos::db::kMigrations[0].checksum));
}

TEST_CASE("applied migration name drift fails startup", "[database][migration]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    pos::db::Migrator migrator(database);

    REQUIRE(migrator.migrate({}) == static_cast<int>(pos::db::kMigrations.size()));
    database.exec(
        "UPDATE database_migrations SET name = '001_renamed.sql' WHERE version = 1");

    requireMigrationFailure(migrator);
}

TEST_CASE("compatible legacy v1 schema backfills migration metadata",
          "[database][migration][legacy]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();

    database.exec(pos::db::kMigrations[0].sql());
    database.exec("PRAGMA user_version=1");

    pos::db::Migrator migrator(database);
    REQUIRE(migrator.migrate({}) == static_cast<int>(pos::db::kMigrations.size()) - 1);

    auto record = database.prepare(
        "SELECT name, checksum FROM database_migrations WHERE version = 1");
    REQUIRE(record.step());
    REQUIRE(record.columnText(0) == pos::db::kMigrations[0].name);
    REQUIRE(record.columnText(1) == pos::db::kMigrations[0].checksum);
    REQUIRE(migrator.currentVersion() == pos::db::kMigrations.back().version);
}

TEST_CASE("incompatible legacy v1 schema is not backfilled",
          "[database][migration][legacy]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();

    database.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    database.exec("PRAGMA user_version=1");

    pos::db::Migrator migrator(database);
    requireMigrationFailure(migrator);

    REQUIRE(scalarInt(
                database,
                "SELECT COUNT(*) FROM sqlite_schema "
                "WHERE type = 'table' AND name = 'database_migrations'") == 0);
}

TEST_CASE("legacy v1 schema with unexpected objects is rejected without mutation",
          "[database][migration][legacy]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();

    database.exec(pos::db::kMigrations[0].sql());
    database.exec("CREATE TABLE unexpected_runtime_table (id INTEGER PRIMARY KEY)");
    database.exec(
        "CREATE TRIGGER unexpected_runtime_trigger "
        "AFTER INSERT ON unexpected_runtime_table BEGIN SELECT 1; END");
    database.exec("PRAGMA user_version=1");

    pos::db::Migrator migrator(database);
    requireMigrationFailure(migrator);

    REQUIRE(scalarInt(
                database,
                "SELECT COUNT(*) FROM sqlite_schema "
                "WHERE type = 'table' AND name = 'database_migrations'") == 0);
}

TEST_CASE("pre-migration backup is only required for a real version upgrade",
          "[database][migration][backup-decision]") {
    REQUIRE_FALSE(pos::db::shouldBackupBeforeMigration(0, 1));
    REQUIRE_FALSE(pos::db::shouldBackupBeforeMigration(1, 1));
    REQUIRE_FALSE(pos::db::shouldBackupBeforeMigration(2, 1));
    REQUIRE(pos::db::shouldBackupBeforeMigration(1, 2));
}

TEST_CASE("existing database upgrade creates a read-only safety backup",
          "[database][migration][migration-backup]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    const auto migrations = successfulTestMigrations();

    pos::db::Migrator initial(database, {migrations[0]});
    REQUIRE(initial.migrate({}) == 1);
    database.exec("INSERT INTO migration_probe (id, value) VALUES (1, 'before-upgrade')");

    pos::db::Migrator upgrade(database, migrations);
    REQUIRE(upgrade.migrate({}) == 1);
    REQUIRE(upgrade.currentVersion() == 2);

    const auto backups = backupFiles(fixture);
    REQUIRE(backups.size() == 1);
    ReadOnlySqlite backup(backups[0]);
    REQUIRE(backup.scalarText("PRAGMA quick_check") == "ok");
    REQUIRE(backup.scalarInt("PRAGMA user_version") == 1);
    REQUIRE(backup.scalarText("SELECT value FROM migration_probe WHERE id = 1") ==
            "before-upgrade");
    REQUIRE(backup.scalarInt(
                "SELECT COUNT(*) FROM pragma_table_info('migration_probe') "
                "WHERE name = 'amount_minor'") == 0);
    REQUIRE_FALSE(std::filesystem::exists(backups[0].string() + "-wal"));
    REQUIRE_FALSE(std::filesystem::exists(backups[0].string() + "-shm"));
}

TEST_CASE("fresh database migration does not create a safety backup",
          "[database][migration][migration-backup]") {
    MigrationTestDatabase fixture;
    pos::db::Migrator migrator(fixture.database(), successfulTestMigrations());

    REQUIRE(migrator.migrate({}) == 2);
    REQUIRE(backupFiles(fixture).empty());
}

TEST_CASE("failed migration preserves original database and safety backup",
          "[database][migration][migration-backup]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    const auto migrations = failingTestMigrations();

    pos::db::Migrator initial(database, {migrations[0]});
    REQUIRE(initial.migrate({}) == 1);
    database.exec("INSERT INTO migration_probe (id, value) VALUES (1, 'preserve-me')");

    pos::db::Migrator upgrade(database, migrations);
    requireMigrationFailure(upgrade);

    REQUIRE(upgrade.currentVersion() == 1);
    REQUIRE(scalarInt(database, "SELECT COUNT(*) FROM migration_probe WHERE value = 'preserve-me'") ==
            1);
    REQUIRE(scalarInt(
                database,
                "SELECT COUNT(*) FROM sqlite_schema "
                "WHERE type = 'table' AND name = 'should_rollback'") == 0);
    REQUIRE(scalarInt(database,
                      "SELECT COUNT(*) FROM database_migrations WHERE version = 2") == 0);

    const auto backups = backupFiles(fixture);
    REQUIRE(backups.size() == 1);
    ReadOnlySqlite backup(backups[0]);
    REQUIRE(backup.scalarInt("PRAGMA user_version") == 1);
    REQUIRE(backup.scalarText("SELECT value FROM migration_probe WHERE id = 1") ==
            "preserve-me");
}

TEST_CASE("upgrade backup precedes legacy metadata backfill",
          "[database][migration][migration-backup][legacy]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    const auto migrations = successfulTestMigrations();

    database.exec(migrations[0].sql);
    database.exec("INSERT INTO migration_probe (id, value) VALUES (1, 'legacy')");
    database.exec("PRAGMA user_version=1");

    pos::db::Migrator upgrade(database, migrations);
    REQUIRE(upgrade.migrate({}) == 1);
    REQUIRE(scalarInt(database, "SELECT COUNT(*) FROM database_migrations") == 2);

    const auto backups = backupFiles(fixture);
    REQUIRE(backups.size() == 1);
    ReadOnlySqlite backup(backups[0]);
    REQUIRE(backup.scalarInt(
                "SELECT COUNT(*) FROM sqlite_schema "
                "WHERE type = 'table' AND name = 'database_migrations'") == 0);
    REQUIRE(backup.scalarText("SELECT value FROM migration_probe WHERE id = 1") == "legacy");
}

TEST_CASE("upgrade name drift failure still leaves a pre-operation safety backup",
          "[database][migration][migration-backup]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    const auto migrations = successfulTestMigrations();

    pos::db::Migrator initial(database, {migrations[0]});
    REQUIRE(initial.migrate({}) == 1);
    database.exec("UPDATE database_migrations SET name = '001_renamed.sql' WHERE version = 1");

    pos::db::Migrator upgrade(database, migrations);
    requireMigrationFailure(upgrade);

    const auto backups = backupFiles(fixture);
    REQUIRE(backups.size() == 1);
    ReadOnlySqlite backup(backups[0]);
    REQUIRE(backup.scalarText(
                "SELECT name FROM database_migrations WHERE version = 1") == "001_renamed.sql");
    REQUIRE(scalarText(database,
                       "SELECT name FROM database_migrations WHERE version = 1") ==
            "001_renamed.sql");
}

TEST_CASE("no-upgrade validation does not create a safety backup",
          "[database][migration][migration-backup]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    const auto migrations = successfulTestMigrations();

    pos::db::Migrator initial(database, {migrations[0]});
    REQUIRE(initial.migrate({}) == 1);

    pos::db::Migrator validate(database, {migrations[0]});
    REQUIRE(validate.migrate({}) == 0);
    REQUIRE(backupFiles(fixture).empty());
}

TEST_CASE("seeding is not repeated once the marker is written", "[database][seed]") {
    // The emptiness test used to be "does menu_categories have rows", which was
    // only ever true because the seed always installed a menu. With the demo
    // catalogue optional, a till without one must still be recognised as seeded
    // or every launch re-runs the seed and its plain INSERTs collide.
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    pos::db::Migrator migrator(database);
    REQUIRE(migrator.migrate({}) == static_cast<int>(pos::db::kMigrations.size()));

    REQUIRE(migrator.seedIfEmpty({}));
    REQUIRE(scalarInt(database,
                      "SELECT COUNT(*) FROM app_settings WHERE key = 'seed.referenceAt'") == 1);

    // Wipe every table the emptiness fallback looks at; only the marker is left
    // to say the seed already ran.
    database.exec("DELETE FROM menu_items");
    database.exec("DELETE FROM menu_categories");
    database.exec("DELETE FROM restaurant_tables");
    database.exec("DELETE FROM restaurant_areas");

    REQUIRE_FALSE(migrator.seedIfEmpty({}));
    REQUIRE(scalarInt(database, "SELECT COUNT(*) FROM menu_categories") == 0);
}

TEST_CASE("a database seeded before the marker existed is not re-seeded",
          "[database][seed]") {
    MigrationTestDatabase fixture;
    auto& database = fixture.database();
    pos::db::Migrator migrator(database);
    REQUIRE(migrator.migrate({}) == static_cast<int>(pos::db::kMigrations.size()));
    REQUIRE(migrator.seedIfEmpty({}));

    const auto categories = scalarInt(database, "SELECT COUNT(*) FROM menu_categories");
    REQUIRE(categories > 0);
    database.exec("DELETE FROM app_settings WHERE key = 'seed.referenceAt'");

    REQUIRE_FALSE(migrator.seedIfEmpty({}));
    REQUIRE(scalarInt(database, "SELECT COUNT(*) FROM menu_categories") == categories);
}

TEST_CASE("reference data and demo catalogue live in separate seeds",
          "[database][seed]") {
    // The split is what makes POS_SEED_DEMO_MENU=0 possible: the floor plan,
    // roles and settings have to arrive whether or not the menu does.
    bool sawReference = false;
    bool sawDemo = false;
    for (const auto& seed : pos::db::kSeeds) {
        const bool demo = seed.name.find("_demo_") != std::string_view::npos;
        sawDemo = sawDemo || demo;
        sawReference = sawReference || !demo;
        if (demo) continue;
        // Anything in a non-demo seed applies to every customer, so it must not
        // be carrying menu rows.
        REQUIRE(seed.sql().find("INSERT INTO menu_items") == std::string::npos);
        REQUIRE(seed.sql().find("INSERT INTO menu_categories") == std::string::npos);
    }
    REQUIRE(sawReference);
    REQUIRE(sawDemo);
}

TEST_CASE("printer target migration only rewrites the untouched default",
          "[database][migration][printer]") {
    // Migration 016 exists because an earlier build hardcoded a LAN printer
    // address AND rewrote it back on every startup, which made it impossible to
    // keep a USB printer selected. Anything the operator actually chose has to
    // survive the upgrade untouched.
    const auto definitions = [](std::size_t count) {
        std::vector<pos::db::MigrationDefinition> out;
        for (std::size_t i = 0; i < count && i < pos::db::kMigrations.size(); ++i) {
            const auto& script = pos::db::kMigrations[i];
            out.push_back(pos::db::MigrationDefinition{script.version, std::string(script.name),
                                                       std::string(script.checksum), script.sql()});
        }
        return out;
    };
    const auto upToFifteen = definitions(15);
    const auto allMigrations = definitions(pos::db::kMigrations.size());

    struct Case {
        const char* before;
        const char* after;
    };
    const Case cases[] = {
        {"tcp:192.168.1.200:9100", "auto"},  // the shipped default
        {"virtual", "auto"},                 // "no printer", same situation
        {"", "auto"},
        {"win:KASSA", "win:KASSA"},                    // deliberately chosen
        {"tcp:10.0.0.55:9100", "tcp:10.0.0.55:9100"},  // a real LAN printer
    };

    for (const auto& testCase : cases) {
        MigrationTestDatabase fixture;
        auto& database = fixture.database();

        pos::db::Migrator before(database, upToFifteen);
        REQUIRE(before.migrate({}) == 15);

        auto set = database.prepare(
            "INSERT INTO app_settings (key, value, value_type, updated_at) "
            "VALUES ('printer.receipt', :value, 'string', 0) "
            "ON CONFLICT(key) DO UPDATE SET value = :value");
        set.bind(":value", std::string(testCase.before));
        set.exec();

        database.exec(
            "INSERT INTO app_settings (key, value, value_type, updated_at) "
            "VALUES ('printer.currencyDisplay', 'symbol', 'string', 0) "
            "ON CONFLICT(key) DO UPDATE SET value = 'symbol'");

        pos::db::Migrator upgrade(database, allMigrations);
        REQUIRE(upgrade.migrate({}) >= 1);

        REQUIRE(scalarText(database,
                           "SELECT value FROM app_settings WHERE key = 'printer.receipt'") ==
                testCase.after);
        REQUIRE(scalarText(database,
                           "SELECT value FROM app_settings WHERE key = 'printer.autoDetect'") ==
                "1");
        // The dead key written by migration 012 but read by nothing.
        REQUIRE(scalarInt(database,
                          "SELECT COUNT(*) FROM app_settings "
                          "WHERE key = 'printer.currencyDisplay'") == 0);
    }
}
