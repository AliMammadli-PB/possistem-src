#pragma once
#include <sqlite3.h>
#include <nlohmann/json.hpp>
#include <cstdint>
#include <string>
#include <vector>

namespace market::db {

/**
 * Null-safe read of a column out of a row returned by Database::query.
 *
 * Use this instead of `row.value(key, fallback)`. nlohmann's value() falls back
 * only when the key is ABSENT; when the key is present and holds null it calls
 * get<T>() on that null and throws type_error.302. Every nullable SQLite column
 * arrives as exactly that, so `row.value("terminal_ref", "")` threw on any sale
 * without a card terminal reference — taking the whole handler down with it,
 * which is how receipt printing came to fail on ordinary sales.
 */
template <typename T>
T columnOr(const nlohmann::json& row, const char* key, T fallback) {
  if (!row.contains(key) || row[key].is_null()) return fallback;
  return row[key].template get<T>();
}

/** String-literal overload, so columnOr(row, "k", "") yields std::string. */
inline std::string columnOr(const nlohmann::json& row, const char* key, const char* fallback) {
  if (!row.contains(key) || row[key].is_null()) return fallback ? fallback : "";
  return row[key].get<std::string>();
}

class Database {
 public:
  Database() = default;
  ~Database();
  Database(const Database&) = delete;
  Database& operator=(const Database&) = delete;

  void open(const std::string& path);
  void close();
  sqlite3* raw() const { return db_; }
  const std::string& path() const { return path_; }

  void exec(const std::string& sql);
  /** One statement with bound text values; throws like exec() when it fails. */
  void execBound(const std::string& sql, const std::vector<std::string>& textBinds);
  void begin();
  void commit();
  void rollback();

  /** Run a query returning rows as JSON array of objects. */
  nlohmann::json query(const std::string& sql, const std::vector<std::string>& textBinds = {},
                       const std::vector<std::int64_t>& intBinds = {});

  std::int64_t queryInt(const std::string& sql, const std::vector<std::string>& textBinds = {},
                        const std::vector<std::int64_t>& intBinds = {});

  std::string queryText(const std::string& sql, const std::vector<std::string>& textBinds = {},
                        const std::vector<std::int64_t>& intBinds = {});

  int changes() const;

 private:
  sqlite3* db_{nullptr};
  std::string path_;
};

class Migrator {
 public:
  explicit Migrator(Database& db) : db_(db) {}
  void migrate();
  void seedIfEmpty();

 private:
  Database& db_;
};

}  // namespace market::db
