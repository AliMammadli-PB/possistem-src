#include "catch_amalgamated.hpp"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>

#include <sqlite3.h>

#include "pos/db/Database.hpp"

namespace {

class TempDirectory {
public:
    TempDirectory() {
        static std::atomic<unsigned long long> sequence{0};
        const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
        path_ = std::filesystem::temp_directory_path() /
                ("maison-pos-backup-test-" + std::to_string(tick) + "-" +
                 std::to_string(sequence.fetch_add(1)));
        std::filesystem::create_directories(path_);
    }

    ~TempDirectory() {
        std::error_code ec;
        std::filesystem::remove_all(path_, ec);
    }

    std::filesystem::path file(const std::string& name) const { return path_ / name; }
    const std::filesystem::path& path() const { return path_; }

private:
    std::filesystem::path path_;
};

std::int64_t scalarInt(pos::db::Database& db, const std::string& sql) {
    auto statement = db.prepare(sql);
    REQUIRE(statement.step());
    return statement.columnInt(0);
}

std::int64_t rawScalarInt(sqlite3* db, const char* sql) {
    sqlite3_stmt* statement = nullptr;
    REQUIRE(sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK);
    REQUIRE(sqlite3_step(statement) == SQLITE_ROW);
    const auto value = sqlite3_column_int64(statement, 0);
    REQUIRE(sqlite3_finalize(statement) == SQLITE_OK);
    return value;
}

std::string rawScalarText(sqlite3* db, const char* sql) {
    sqlite3_stmt* statement = nullptr;
    REQUIRE(sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) == SQLITE_OK);
    REQUIRE(sqlite3_step(statement) == SQLITE_ROW);
    const auto* text = reinterpret_cast<const char*>(sqlite3_column_text(statement, 0));
    const std::string value = text ? text : "";
    REQUIRE(sqlite3_finalize(statement) == SQLITE_OK);
    return value;
}

}  // namespace

TEST_CASE("online backup includes committed rows still in the WAL", "[database][backup]") {
    TempDirectory temp;
    const auto sourcePath = temp.file("source.db");
    const auto backupPath = temp.file("backup.db");

    pos::db::Database source;
    source.open(sourcePath.string());
    source.exec("PRAGMA wal_autocheckpoint=0");
    source.exec(
        "CREATE TABLE backup_probe ("
        "  id INTEGER PRIMARY KEY,"
        "  amount_minor INTEGER NOT NULL,"
        "  note TEXT NOT NULL)");
    source.exec(
        "WITH RECURSIVE rows(id) AS ("
        "  VALUES(1) UNION ALL SELECT id + 1 FROM rows WHERE id < 1500"
        ") "
        "INSERT INTO backup_probe (id, amount_minor, note) "
        "SELECT id, id * 7, 'row-' || id FROM rows");

    auto walPath = sourcePath;
    walPath += "-wal";
    REQUIRE(std::filesystem::exists(walPath));
    REQUIRE(std::filesystem::file_size(walPath) > 0);

    source.backupTo(backupPath.string());

    REQUIRE_FALSE(std::filesystem::exists(backupPath.string() + "-wal"));
    REQUIRE_FALSE(std::filesystem::exists(backupPath.string() + "-shm"));

    sqlite3* restored = nullptr;
    REQUIRE(sqlite3_open_v2(backupPath.string().c_str(), &restored,
                            SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nullptr) == SQLITE_OK);
    REQUIRE(sqlite3_db_readonly(restored, "main") == 1);
    REQUIRE(rawScalarText(restored, "PRAGMA quick_check") == "ok");
    REQUIRE(rawScalarText(restored, "PRAGMA journal_mode") == "delete");
    REQUIRE(rawScalarInt(restored, "SELECT COUNT(*) FROM backup_probe") == 1500);
    REQUIRE(rawScalarInt(restored, "SELECT SUM(amount_minor) FROM backup_probe") == 7'880'250);
    REQUIRE(rawScalarText(restored, "SELECT note FROM backup_probe WHERE id = 1500") ==
            "row-1500");
    REQUIRE(sqlite3_close(restored) == SQLITE_OK);

    REQUIRE_FALSE(std::filesystem::exists(backupPath.string() + "-wal"));
    REQUIRE_FALSE(std::filesystem::exists(backupPath.string() + "-shm"));
}

TEST_CASE("online backup atomically replaces an existing destination", "[database][backup]") {
    TempDirectory temp;
    const auto sourcePath = temp.file("source.db");
    const auto backupPath = temp.file("backup.db");

    pos::db::Database source;
    source.open(sourcePath.string());
    source.exec("CREATE TABLE current_data (value INTEGER NOT NULL)");
    source.exec("INSERT INTO current_data VALUES (42)");

    {
        pos::db::Database stale;
        stale.open(backupPath.string());
        stale.exec("CREATE TABLE obsolete_data (value TEXT NOT NULL)");
        stale.exec("INSERT INTO obsolete_data VALUES ('stale')");
    }

    source.backupTo(backupPath.string());

    pos::db::Database restored;
    restored.open(backupPath.string());
    REQUIRE(scalarInt(restored, "SELECT value FROM current_data") == 42);
    REQUIRE(scalarInt(
                restored,
                "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'obsolete_data'") ==
            0);
}

TEST_CASE("online backup removes its temporary file when replacement fails",
          "[database][backup]") {
    TempDirectory temp;
    const auto sourcePath = temp.file("source.db");
    const auto blockedDestination = temp.file("blocked.db");

    pos::db::Database source;
    source.open(sourcePath.string());
    source.exec("CREATE TABLE current_data (value INTEGER NOT NULL)");
    source.exec("INSERT INTO current_data VALUES (42)");

    std::filesystem::create_directory(blockedDestination);
    REQUIRE_THROWS(source.backupTo(blockedDestination.string()));

    for (const auto& entry : std::filesystem::directory_iterator(temp.path())) {
        const auto filename = entry.path().filename().string();
        REQUIRE(filename.rfind("blocked.db.tmp-", 0) != 0);
    }
}

TEST_CASE("restoreFrom replaces live contents through the open handle",
          "[database][backup][restore]") {
    TempDirectory temp;
    const auto livePath = temp.file("live.db");
    const auto backupPath = temp.file("snapshot.db");

    pos::db::Database live;
    live.open(livePath.string());
    live.exec("CREATE TABLE takings (id INTEGER PRIMARY KEY, amount_minor INTEGER NOT NULL)");
    live.exec("INSERT INTO takings (id, amount_minor) VALUES (1, 1000), (2, 2500)");

    live.backupTo(backupPath.string());

    // Trading continues after the snapshot; the restore has to undo exactly this.
    live.exec("INSERT INTO takings (id, amount_minor) VALUES (3, 9900)");
    live.exec("CREATE TABLE after_snapshot (note TEXT)");
    {
        auto count = live.prepare("SELECT COUNT(*) FROM takings");
        REQUIRE(count.step());
        REQUIRE(count.columnInt(0) == 3);
    }

    live.restoreFrom(backupPath.string());

    // The same connection is still usable, and sees the snapshot's contents.
    auto restoredCount = live.prepare("SELECT COUNT(*) FROM takings");
    REQUIRE(restoredCount.step());
    REQUIRE(restoredCount.columnInt(0) == 2);

    auto sum = live.prepare("SELECT SUM(amount_minor) FROM takings");
    REQUIRE(sum.step());
    REQUIRE(sum.columnInt(0) == 3500);

    // A table created after the snapshot is gone, which is what "restore" means.
    auto missing = live.prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'after_snapshot'");
    REQUIRE(missing.step());
    REQUIRE(missing.columnInt(0) == 0);
}

TEST_CASE("restoreFrom refuses a source that is not a usable database",
          "[database][backup][restore]") {
    TempDirectory temp;
    const auto livePath = temp.file("live.db");
    const auto junkPath = temp.file("not-a-db.db");

    pos::db::Database live;
    live.open(livePath.string());
    live.exec("CREATE TABLE takings (amount_minor INTEGER NOT NULL)");
    live.exec("INSERT INTO takings VALUES (4200)");

    {
        std::ofstream junk(junkPath, std::ios::binary | std::ios::trunc);
        junk << "this is not a SQLite file";
    }

    REQUIRE_THROWS(live.restoreFrom(junkPath.string()));
    REQUIRE_THROWS(live.restoreFrom((temp.path() / "missing.db").string()));

    // The till is untouched by a failed restore.
    auto sum = live.prepare("SELECT SUM(amount_minor) FROM takings");
    REQUIRE(sum.step());
    REQUIRE(sum.columnInt(0) == 4200);
}
