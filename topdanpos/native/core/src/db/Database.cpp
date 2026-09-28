#include "market/db/Database.hpp"
#include "market/db/migrations_generated.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include <filesystem>

namespace market::db {

Database::~Database() { close(); }

void Database::open(const std::string& path) {
  close();
  path_ = path;
  std::filesystem::create_directories(std::filesystem::path(path).parent_path());
  if (sqlite3_open(path.c_str(), &db_) != SQLITE_OK) {
    throw PosError("E_DB", db_ ? sqlite3_errmsg(db_) : "sqlite3_open failed", true);
  }
  exec("PRAGMA foreign_keys = ON;");
  exec("PRAGMA journal_mode = WAL;");
  const std::string mode = queryText("PRAGMA journal_mode;");
  if (mode != "wal" && mode != "WAL") {
    throw PosError("E_DB_UNSUITABLE_LOCATION", "journal_mode is not WAL (got " + mode + ")");
  }
  exec("PRAGMA synchronous = NORMAL;");
  exec("PRAGMA busy_timeout = 5000;");
}

void Database::close() {
  if (db_) {
    sqlite3_close(db_);
    db_ = nullptr;
  }
}

void Database::exec(const std::string& sql) {
  char* err = nullptr;
  if (sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
    std::string msg = err ? err : "exec failed";
    sqlite3_free(err);
    throw PosError("E_DB", msg, true);
  }
}

void Database::begin() { exec("BEGIN IMMEDIATE;"); }
void Database::commit() { exec("COMMIT;"); }
void Database::rollback() {
  char* err = nullptr;
  sqlite3_exec(db_, "ROLLBACK;", nullptr, nullptr, &err);
  sqlite3_free(err);
}

namespace {
sqlite3_stmt* prepare(sqlite3* db, const std::string& sql) {
  sqlite3_stmt* stmt = nullptr;
  if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
    throw PosError("E_DB", sqlite3_errmsg(db), true);
  }
  return stmt;
}

void bindAll(sqlite3_stmt* stmt, const std::vector<std::string>& textBinds,
             const std::vector<std::int64_t>& intBinds) {
  int idx = 1;
  for (const auto& t : textBinds) {
    sqlite3_bind_text(stmt, idx++, t.c_str(), -1, SQLITE_TRANSIENT);
  }
  for (const auto& v : intBinds) {
    sqlite3_bind_int64(stmt, idx++, v);
  }
}
}  // namespace

void Database::execBound(const std::string& sql, const std::vector<std::string>& textBinds) {
  sqlite3_stmt* stmt = prepare(db_, sql);
  bindAll(stmt, textBinds, {});
  const int rc = sqlite3_step(stmt);
  sqlite3_finalize(stmt);
  if (rc != SQLITE_DONE && rc != SQLITE_ROW) throw PosError("E_DB", sqlite3_errmsg(db_), true);
}

nlohmann::json Database::query(const std::string& sql, const std::vector<std::string>& textBinds,
                               const std::vector<std::int64_t>& intBinds) {
  sqlite3_stmt* stmt = prepare(db_, sql);
  bindAll(stmt, textBinds, intBinds);
  nlohmann::json rows = nlohmann::json::array();
  const int cols = sqlite3_column_count(stmt);
  while (sqlite3_step(stmt) == SQLITE_ROW) {
    nlohmann::json row = nlohmann::json::object();
    for (int c = 0; c < cols; ++c) {
      const char* name = sqlite3_column_name(stmt, c);
      const int type = sqlite3_column_type(stmt, c);
      if (type == SQLITE_NULL) row[name] = nullptr;
      else if (type == SQLITE_INTEGER) row[name] = sqlite3_column_int64(stmt, c);
      else if (type == SQLITE_FLOAT) row[name] = sqlite3_column_double(stmt, c);
      else row[name] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, c));
    }
    rows.push_back(std::move(row));
  }
  sqlite3_finalize(stmt);
  return rows;
}

std::int64_t Database::queryInt(const std::string& sql, const std::vector<std::string>& textBinds,
                                const std::vector<std::int64_t>& intBinds) {
  sqlite3_stmt* stmt = prepare(db_, sql);
  bindAll(stmt, textBinds, intBinds);
  std::int64_t value = 0;
  if (sqlite3_step(stmt) == SQLITE_ROW) value = sqlite3_column_int64(stmt, 0);
  sqlite3_finalize(stmt);
  return value;
}

std::string Database::queryText(const std::string& sql, const std::vector<std::string>& textBinds,
                                const std::vector<std::int64_t>& intBinds) {
  sqlite3_stmt* stmt = prepare(db_, sql);
  bindAll(stmt, textBinds, intBinds);
  std::string value;
  if (sqlite3_step(stmt) == SQLITE_ROW) {
    const unsigned char* t = sqlite3_column_text(stmt, 0);
    if (t) value = reinterpret_cast<const char*>(t);
  }
  sqlite3_finalize(stmt);
  return value;
}

int Database::changes() const { return sqlite3_changes(db_); }

void Migrator::migrate() {
  db_.exec(R"(CREATE TABLE IF NOT EXISTS database_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );)");

  // Versions 4-8 belong to 1.4.x (market_140, market_sync, sync_resilience,
  // single_stock, loyalty) - that is what the tills in the field recorded.
  // Builds from the 1.3.0 line numbered their own two migrations 4 and 5; a
  // database made by one of those keeps them, renumbered, and then receives
  // the 1.4.x ones it never had. Without this, the checksum check refuses to
  // start either kind of till on the other kind's build.
  db_.exec("UPDATE database_migrations SET version = 9, name = '009_role_catalogue.sql' "
           "WHERE version = 4 AND name = '004_role_catalogue.sql';");
  db_.exec("UPDATE database_migrations SET version = 10, name = '010_delivery_recipes_roster.sql' "
           "WHERE version = 5 AND name = '005_delivery_recipes_roster.sql';");

  for (std::size_t i = 0; i < kMigrationCount; ++i) {
    const auto& m = kMigrations[i];
    const auto existing = db_.query("SELECT checksum FROM database_migrations WHERE version = ?", {}, {m.version});
    if (!existing.empty()) {
      if (existing[0]["checksum"] != m.checksum) {
        throw PosError("E_MIGRATION_FAILED",
                       std::string("checksum mismatch for migration ") + m.name);
      }
      continue;
    }
    logging::info(std::string("applying migration ") + m.name);
    try {
      db_.begin();
      db_.exec(std::string(m.sql));
      db_.exec("INSERT INTO database_migrations(version, name, checksum) VALUES (" +
               std::to_string(m.version) + ", '" + m.name + "', '" + m.checksum + "');");
      // Prefer bind — but simple insert for bootstrap; checksum/name are controlled.
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
  }
}

void Migrator::seedIfEmpty() {
  if (kSeedCount == 0) return;
  const auto count = db_.queryInt("SELECT COUNT(*) FROM products;");
  if (count > 0) return;
  for (std::size_t i = 0; i < kSeedCount; ++i) {
    logging::info(std::string("applying seed ") + kSeeds[i].name);
    db_.exec(std::string(kSeeds[i].sql));
  }
}

}  // namespace market::db
