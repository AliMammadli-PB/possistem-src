#include "market/Warehouse.hpp"
#include "market/Logging.hpp"
#include <sqlite3.h>

namespace market {
namespace {

constexpr const char* kFallbackId = "wh-sales";

void setSetting(db::Database& db, const std::string& key, const std::string& value) {
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO settings(key,value) VALUES (?,?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                     -1, &stmt, nullptr);
  sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
}

}  // namespace

std::string primaryWarehouseId(db::Database& db) {
  // The configured warehouse wins whenever it is real — that pin keeps the id
  // stable for the life of the install once it has been set.
  const auto configured = db.queryText(
      "SELECT w.id FROM warehouses w JOIN settings s "
      "ON s.key='defaultWarehouseId' AND s.value=w.id LIMIT 1");
  if (!configured.empty()) return configured;

  const auto seeded = db.queryText("SELECT id FROM warehouses WHERE id=? LIMIT 1", {kFallbackId}, {});
  if (!seeded.empty()) return seeded;

  // ORDER BY id rather than rowid so two tills that were handed the same set of
  // warehouses independently still settle on the same one.
  return db.queryText("SELECT id FROM warehouses ORDER BY id LIMIT 1");
}

std::string ensurePrimaryWarehouse(db::Database& db) {
  auto id = primaryWarehouseId(db);
  if (!id.empty()) return id;

  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT OR IGNORE INTO warehouses(id,code,name,address,manager,active) "
                     "VALUES (?,'ZAL-01','Mağaza','','',1)",
                     -1, &stmt, nullptr);
  sqlite3_bind_text(stmt, 1, kFallbackId, -1, SQLITE_TRANSIENT);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);

  id = kFallbackId;
  setSetting(db, "defaultWarehouseId", id);
  return id;
}

std::string normalizeWarehouseId(db::Database& db, const std::string&) {
  return ensurePrimaryWarehouse(db);
}

void repairWarehouseSetting(db::Database& db) {
  const auto current = db.queryText("SELECT value FROM settings WHERE key='defaultWarehouseId'");
  const auto resolved = primaryWarehouseId(db);
  if (resolved.empty()) return;  // nothing to point at yet; first write will create it
  if (current == resolved) return;
  logging::info("repairing defaultWarehouseId: '" + current + "' -> '" + resolved + "'");
  setSetting(db, "defaultWarehouseId", resolved);
}

}  // namespace market
