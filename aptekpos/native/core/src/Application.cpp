#include "market/Application.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include "market/RetailOps.hpp"
#include "market/printing/PrinterHandlers.hpp"
#include "market/Warehouse.hpp"
#include "market/protocol_generated.hpp"
#include <cmath>
#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <optional>
#include <random>
#include <sstream>
#include <vector>

#ifndef MARKET_CORE_VERSION
#define MARKET_CORE_VERSION "0.0.0"
#endif

namespace market {
namespace {

std::string newId(const std::string& prefix) {
  static thread_local std::mt19937_64 rng{std::random_device{}()};
  std::uniform_int_distribution<std::uint64_t> dist;
  std::ostringstream oss;
  oss << prefix << "-" << std::hex << dist(rng);
  return oss.str();
}

std::int64_t nowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

std::string requireString(const nlohmann::json& p, const char* key) {
  if (!p.contains(key) || !p[key].is_string() || p[key].get<std::string>().empty()) {
    throw PosError("E_VALIDATION", std::string("missing string field: ") + key);
  }
  return p[key].get<std::string>();
}

std::int64_t requireInt(const nlohmann::json& p, const char* key) {
  if (!p.contains(key) || !p[key].is_number_integer()) {
    throw PosError("E_VALIDATION", std::string("missing int field: ") + key);
  }
  return p[key].get<std::int64_t>();
}

// Safer audit via binds
void audit(db::Database& db, const std::string& actorId, const std::string& action, const std::string& detail) {
  sqlite3_stmt* stmt = nullptr;
  const char* sql = "INSERT INTO audit_logs(id, created_at, actor_id, action, detail) VALUES (?,?,?,?,?)";
  if (sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr) != SQLITE_OK) {
    throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
  }
  const std::string id = newId("audit");
  const auto ts = nowMs();
  sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 2, ts);
  sqlite3_bind_text(stmt, 3, actorId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 4, action.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, detail.c_str(), -1, SQLITE_TRANSIENT);
  if (sqlite3_step(stmt) != SQLITE_DONE) {
    const std::string msg = sqlite3_errmsg(db.raw());
    sqlite3_finalize(stmt);
    throw PosError("E_DB", msg, true);
  }
  sqlite3_finalize(stmt);
}

nlohmann::json productRowToJson(const nlohmann::json& row, db::Database& db) {
  const std::string id = row.at("id").get<std::string>();
  auto stocks = db.query(
      "SELECT warehouse_id, qty FROM stock_levels WHERE product_id = ?", {id}, {});
  nlohmann::json warehouseStock = nlohmann::json::object();
  std::int64_t totalStock = 0;
  for (const auto& s : stocks) {
    const auto qty = s["qty"].get<std::int64_t>();
    warehouseStock[s["warehouse_id"].get<std::string>()] = qty;
    totalStock += qty;
  }
  nlohmann::json image = nlohmann::json::parse(db::columnOr(row, "image_json", "{\"kind\":\"sprite\",\"index\":0}"));
  return {
      {"id", id},
      {"sku", row.at("sku")},
      {"barcode", row.at("barcode")},
      {"internalCode", db::columnOr(row, "internal_code", "")},
      {"color", db::columnOr(row, "color", "")},
      {"size", db::columnOr(row, "size", "")},
      {"inn", db::columnOr(row, "inn", "")},
      {"strength", db::columnOr(row, "strength", "")},
      {"dosageForm", db::columnOr(row, "dosage_form", "")},
      {"packUnits", row.contains("pack_units") && !row["pack_units"].is_null() ? row["pack_units"] : nlohmann::json(1)},
      {"splitAllowed", row.contains("split_allowed") && row["split_allowed"].is_number() && row["split_allowed"].get<std::int64_t>() != 0},
      {"rxRequired", row.contains("rx_required") && row["rx_required"].is_number() && row["rx_required"].get<std::int64_t>() != 0},
      {"storage", db::columnOr(row, "storage", "room")},
      {"manufacturer", db::columnOr(row, "manufacturer", "")},
      {"country", db::columnOr(row, "country", "")},
      {"regNo", db::columnOr(row, "reg_no", "")},
      {"shelf", db::columnOr(row, "shelf", "")},
      {"parentProductId", row.contains("parent_product_id") && !row["parent_product_id"].is_null() ? row["parent_product_id"] : nlohmann::json(nullptr)},
      {"name", {{"az", row.at("name_az")}, {"ru", db::columnOr(row, "name_ru", "")}, {"en", db::columnOr(row, "name_en", "")}}},
      {"category", row.at("category")},
      {"unit", row.at("unit")},
      {"priceMinor", row.at("price_minor")},
      {"costMinor", row.at("cost_minor")},
      {"minStock", row.at("min_stock")},
      {"taxRate", row.at("tax_rate")},
      {"supplier", row.at("supplier")},
      // `stock` is the single number the UI works with. `warehouseStock` stays
      // on the wire — as a one-key map now — so peers and tests on the older
      // shape keep parsing.
      {"stock", totalStock},
      {"warehouseStock", warehouseStock},
      {"accent", row.at("accent")},
      {"image", image},
      {"active", row.at("active").get<std::int64_t>() != 0},
      {"createdAt", row.at("created_at")},
  };
}

nlohmann::json listProducts(db::Database& db, bool activeOnly) {
  auto rows = activeOnly
                  ? db.query("SELECT * FROM products WHERE active = 1 ORDER BY category, name_az")
                  : db.query("SELECT * FROM products ORDER BY category, name_az");
  nlohmann::json out = nlohmann::json::array();
  for (const auto& row : rows) out.push_back(productRowToJson(row, db));
  return out;
}

void upsertStock(db::Database& db, const std::string& productId, const std::string& warehouseId,
                 std::int64_t qty) {
  sqlite3_stmt* stmt = nullptr;
  const char* sql =
      "INSERT INTO stock_levels(product_id, warehouse_id, qty) VALUES (?,?,?) "
      "ON CONFLICT(product_id, warehouse_id) DO UPDATE SET qty = excluded.qty";
  if (sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr) != SQLITE_OK) {
    throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
  }
  sqlite3_bind_text(stmt, 1, productId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, warehouseId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 3, qty);
  if (sqlite3_step(stmt) != SQLITE_DONE) {
    const std::string msg = sqlite3_errmsg(db.raw());
    sqlite3_finalize(stmt);
    throw PosError("E_DB", msg, true);
  }
  sqlite3_finalize(stmt);
}

std::int64_t getStock(db::Database& db, const std::string& productId, const std::string& warehouseId) {
  return db.queryInt("SELECT COALESCE(qty,0) FROM stock_levels WHERE product_id = ? AND warehouse_id = ?",
                     {productId, warehouseId}, {});
}

std::string settingValue(db::Database& db, const std::string& key, const std::string& fallback = "") {
  auto rows = db.query("SELECT value FROM settings WHERE key = ?", {key}, {});
  return rows.empty() ? fallback : rows[0].value("value", fallback);
}

void setSettingValue(db::Database& db, const std::string& key, const std::string& value) {
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                     -1, &stmt, nullptr);
  sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);
  if (sqlite3_step(stmt) != SQLITE_DONE) {
    const std::string msg = sqlite3_errmsg(db.raw());
    sqlite3_finalize(stmt);
    throw PosError("E_DB", msg, true);
  }
  sqlite3_finalize(stmt);
}

/** Quarantines an inbound event we could not apply, so the batch can continue. */
void deadLetterSyncEvent(db::Database& db, const nlohmann::json& event, const std::string& reason) {
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO sync_events_dead(event_id,origin_device_id,origin_seq,kind,payload_json,"
                     "created_at,failed_at,reason) VALUES (?,?,?,?,?,?,?,?) "
                     "ON CONFLICT(event_id) DO UPDATE SET failed_at=excluded.failed_at,reason=excluded.reason,"
                     "attempts=sync_events_dead.attempts+1",
                     -1, &stmt, nullptr);
  const std::string eventId = event.value("eventId", std::string{});
  const std::string origin = event.value("originDeviceId", std::string{});
  const std::string kind = event.value("kind", std::string{});
  const std::string payloadJson = event.value("payload", nlohmann::json::object()).dump();
  sqlite3_bind_text(stmt, 1, eventId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, origin.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 3, event.value("originSeq", static_cast<std::int64_t>(0)));
  sqlite3_bind_text(stmt, 4, kind.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, payloadJson.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 6, event.value("createdAt", nowMs()));
  sqlite3_bind_int64(stmt, 7, nowMs());
  sqlite3_bind_text(stmt, 8, reason.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
}

/** Holds events produced before sync.configure assigned this device an identity. */
void parkOrphanSyncEvent(db::Database& db, const std::string& kind, const nlohmann::json& payload,
                         const std::string& forcedEventId, std::int64_t forcedCreatedAt) {
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT OR IGNORE INTO sync_events_orphan(event_id,kind,payload_json,created_at) "
                     "VALUES (?,?,?,?)", -1, &stmt, nullptr);
  const std::string eventId = forcedEventId.empty() ? newId("evt") : forcedEventId;
  const std::string payloadJson = payload.dump();
  const auto createdAt = forcedCreatedAt > 0 ? forcedCreatedAt : nowMs();
  sqlite3_bind_text(stmt, 1, eventId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, kind.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 3, payloadJson.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 4, createdAt);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
}

std::string appendSyncEvent(db::Database& db, const std::string& kind, const nlohmann::json& payload,
                            const std::string& forcedEventId = "", std::int64_t forcedCreatedAt = 0) {
  const std::string deviceId = settingValue(db, "syncDeviceId");
  if (deviceId.empty()) {
    // Pre-activation writes would otherwise be invisible to sync forever. Park them
    // so sync.configure can replay them once the device identity is known.
    parkOrphanSyncEvent(db, kind, payload, forcedEventId, forcedCreatedAt);
    return forcedEventId;
  }
  // MAX() guards against a sequence regression after a backup restore: a plain
  // assignment lets last_seq go backwards, and the next append then collides with
  // UNIQUE(origin_device_id, origin_seq) and aborts the enclosing sale.
  const auto seq = db.queryInt(
      "SELECT MAX("
      "  COALESCE((SELECT last_seq FROM sync_vectors WHERE origin_device_id = ?1),0),"
      "  COALESCE((SELECT MAX(origin_seq) FROM sync_events WHERE origin_device_id = ?1),0)"
      ")+1",
      {deviceId}, {});
  const auto createdAt = forcedCreatedAt > 0 ? forcedCreatedAt : nowMs();
  const std::string eventId = forcedEventId.empty() ? newId("evt") : forcedEventId;
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO sync_events(event_id,origin_device_id,origin_seq,kind,payload_json,created_at) "
                     "VALUES (?,?,?,?,?,?)", -1, &stmt, nullptr);
  const std::string payloadJson = payload.dump();
  sqlite3_bind_text(stmt, 1, eventId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, deviceId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 3, seq);
  sqlite3_bind_text(stmt, 4, kind.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, payloadJson.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 6, createdAt);
  if (sqlite3_step(stmt) != SQLITE_DONE) {
    const std::string msg = sqlite3_errmsg(db.raw());
    sqlite3_finalize(stmt);
    throw PosError("E_DB", msg, true);
  }
  sqlite3_finalize(stmt);
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO sync_vectors(origin_device_id,last_seq,updated_at) VALUES (?,?,?) "
                     "ON CONFLICT(origin_device_id) DO UPDATE SET "
                     "last_seq=MAX(sync_vectors.last_seq,excluded.last_seq),updated_at=excluded.updated_at",
                     -1, &stmt, nullptr);
  sqlite3_bind_text(stmt, 1, deviceId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 2, seq);
  sqlite3_bind_int64(stmt, 3, createdAt);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
  return eventId;
}

/** Re-files events parked before this device had a sync identity. */
void replayOrphanSyncEvents(db::Database& db) {
  const auto rows = db.query("SELECT event_id,kind,payload_json,created_at FROM sync_events_orphan ORDER BY created_at");
  if (rows.empty()) return;
  for (const auto& row : rows) {
    appendSyncEvent(db, row.at("kind").get<std::string>(),
                    nlohmann::json::parse(row.at("payload_json").get<std::string>()),
                    row.at("event_id").get<std::string>(), row.at("created_at").get<std::int64_t>());
  }
  db.exec("DELETE FROM sync_events_orphan");
  logging::info("replayed " + std::to_string(rows.size()) + " parked sync event(s)");
}

/** Records how far a given peer has consumed each origin's stream. */
void savePeerVector(db::Database& db, const std::string& peerDeviceId, const nlohmann::json& vector) {
  if (!vector.is_object()) return;
  for (const auto& [origin, seq] : vector.items()) {
    if (!seq.is_number_integer()) continue;
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO sync_peer_vectors(peer_device_id,origin_device_id,last_seq,updated_at) "
                       "VALUES (?,?,?,?) ON CONFLICT(peer_device_id,origin_device_id) DO UPDATE SET "
                       "last_seq=MAX(sync_peer_vectors.last_seq,excluded.last_seq),updated_at=excluded.updated_at",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, peerDeviceId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, origin.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, seq.get<std::int64_t>());
    sqlite3_bind_int64(stmt, 4, nowMs());
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
  }
}

/**
 * Drops events every known peer has already consumed. Without this the outbox
 * grows for the life of the install; the user-visible "pending" count and the
 * export window both degrade with it.
 */
std::int64_t pruneSyncEvents(db::Database& db, std::int64_t keepDays) {
  if (keepDays < 1) keepDays = 1;
  const auto cutoff = nowMs() - keepDays * 24 * 60 * 60 * 1000;
  // Only prune what the server acked AND every tracked peer has seen, so a till
  // that has been offline for a while still receives its backlog.
  const auto before = db.queryInt("SELECT COUNT(*) FROM sync_events", {}, {});
  db.exec(
      "DELETE FROM sync_events WHERE server_acked=1 AND created_at < " + std::to_string(cutoff) +
      " AND origin_seq <= COALESCE((SELECT MIN(last_seq) FROM sync_peer_vectors "
      "WHERE sync_peer_vectors.origin_device_id = sync_events.origin_device_id),0)");
  const auto after = db.queryInt("SELECT COUNT(*) FROM sync_events", {}, {});
  db.exec("DELETE FROM sync_events_dead WHERE failed_at < " + std::to_string(cutoff));
  return before - after;
}

void recordMovement(db::Database& db, const std::string& type, const std::string& productId,
                    const std::string& warehouseId, std::int64_t qtyDelta, std::int64_t qtyAfter,
                    const std::string& refType, const std::string& refId, const std::string& actorId,
                    const std::string& note, bool emitSync = true, const std::string& forcedId = "") {
  sqlite3_stmt* stmt = nullptr;
  const char* sql =
      "INSERT INTO stock_movements(id, created_at, type, product_id, warehouse_id, qty_delta, qty_after, "
      "ref_type, ref_id, actor_id, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)";
  if (sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr) != SQLITE_OK) {
    throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
  }
  const std::string id = forcedId.empty() ? newId("mv") : forcedId;
  const auto ts = nowMs();
  sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 2, ts);
  sqlite3_bind_text(stmt, 3, type.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 4, productId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, warehouseId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 6, qtyDelta);
  sqlite3_bind_int64(stmt, 7, qtyAfter);
  sqlite3_bind_text(stmt, 8, refType.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 9, refId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 10, actorId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 11, note.c_str(), -1, SQLITE_TRANSIENT);
  if (sqlite3_step(stmt) != SQLITE_DONE) {
    const std::string msg = sqlite3_errmsg(db.raw());
    sqlite3_finalize(stmt);
    throw PosError("E_DB", msg, true);
  }
  sqlite3_finalize(stmt);
  if (emitSync) {
    appendSyncEvent(db, "stock.movement",
                    {{"productId", productId}, {"warehouseId", warehouseId}, {"qtyDelta", qtyDelta},
                     {"type", type}, {"refType", refType}, {"refId", refId}, {"actorId", actorId},
                     {"note", note}}, id, ts);
  }
}

/**
 * The reasons a shop writes stock off.
 *
 * A closed list rather than free text: free text cannot be summed, and
 * "what did we lose to expiry this quarter" is the whole point of recording
 * the reason at all. `other` exists so nothing has to be misfiled - it carries
 * the operator's note alongside it.
 */
struct WasteReason { const char* code; const char* label; };
constexpr WasteReason kWasteReasons[] = {
    {"expired", "Vaxtı keçib"},
    {"damaged", "Zədələnib"},
    {"spoiled", "Xarab olub"},
    {"theft", "Oğurluq"},
    {"sample", "Nümunə / dequstasiya"},
    {"internal", "Daxili istifadə"},
    {"other", "Digər"},
};

bool isKnownWasteReason(const std::string& code) {
  for (const auto& entry : kWasteReasons) {
    if (code == entry.code) return true;
  }
  return false;
}

void applyStockDelta(db::Database& db, const std::string& type, const std::string& productId,
                     const std::string& warehouseId, std::int64_t qtyDelta, const std::string& refType,
                     const std::string& refId, const std::string& actorId, const std::string& note,
                     bool allowNegative, bool emitSync = true, const std::string& forcedMovementId = "") {
  // The shop keeps one warehouse now, so this lock would freeze the whole store
  // for the length of a count. Trade keeps running; stocktake.post computes the
  // delta against the live quantity, so sales made during the count are already
  // reflected and are not counted twice. Receiving and manual adjustments stay
  // blocked — pausing those is the point of a count.
  const bool exemptFromStocktakeLock =
      type == "STOCKTAKE" || type == "SALE" || type == "SALE_RETURN";
  if (!exemptFromStocktakeLock &&
      db.queryInt("SELECT COUNT(*) FROM stocktakes WHERE warehouse_id = ? AND status IN ('draft','counting','review')", {warehouseId}, {}) > 0) {
    throw PosError("E_CONFLICT", "Warehouse is locked by an active stocktake");
  }
  const std::int64_t current = getStock(db, productId, warehouseId);
  const std::int64_t next = current + qtyDelta;
  if (next < 0) {
    const std::string policy = stockPolicyOf(db);
    const bool blocked = !allowNegative && policy == "BLOCK_NEGATIVE_STOCK";
    if (blocked) {
      throw PosError("INSUFFICIENT_STOCK", "Insufficient stock for product " + productId, false,
                     nlohmann::json{{"productId", productId}, {"warehouseId", warehouseId},
                                    {"available", current}, {"requested", -qtyDelta}});
    }
    if (!allowNegative && policy == "WARN_ONLY") {
      audit(db, actorId, "STOCK_WARN", productId + " -> " + std::to_string(next));
    }
  }
  upsertStock(db, productId, warehouseId, next);
  recordMovement(db, type, productId, warehouseId, qtyDelta, next, refType, refId, actorId, note,
                 emitSync, forcedMovementId);
}

std::optional<std::int64_t> scalarStock(const nlohmann::json& product) {
  if (!product.contains("stock") || !product["stock"].is_number()) return std::nullopt;
  return std::max<std::int64_t>(0, product["stock"].get<std::int64_t>());
}

std::optional<std::int64_t> mapStock(const nlohmann::json& product) {
  if (!product.contains("warehouseStock") || !product["warehouseStock"].is_object()) return std::nullopt;
  std::int64_t total = 0;
  for (const auto& entry : product["warehouseStock"]) {
    if (entry.is_number()) total += entry.get<std::int64_t>();
  }
  return std::max<std::int64_t>(0, total);
}

/**
 * The requested on-hand quantity for a product write.
 *
 * The UI sends a single `stock` number; `warehouseStock` is still accepted
 * because it is the shape older peers and the legacy import speak, summed the
 * same way migration 007 collapsed the table.
 *
 * Callers routinely read a product and write it back with one field edited, so
 * both keys arrive and disagree — one of them is just an echo of the read. The
 * one that differs from what is stored is the one the caller actually changed.
 * Preferring `stock` blindly would silently discard an edit made through the
 * older shape, and vice versa.
 *
 * Returns nullopt when the caller said nothing about stock, so renaming a
 * product does not zero it.
 */
std::optional<std::int64_t> requestedStock(const nlohmann::json& product, std::int64_t current) {
  const auto scalar = scalarStock(product);
  const auto mapped = mapStock(product);
  if (scalar && mapped && *scalar != *mapped) {
    if (*scalar == current) return mapped;  // only the map was edited
    return scalar;                          // scalar changed (or both did)
  }
  return scalar ? scalar : mapped;
}

void saveProduct(db::Database& db, const nlohmann::json& product, bool isCreate) {
  const std::string id = product.at("id").get<std::string>();
  // Tills send {az, ru, en}; the portal sends a plain string and a float price.
  const auto& name = product.at("name");
  const std::string nameAz = name.is_string() ? name.get<std::string>() : name.at("az").get<std::string>();
  const std::string nameRu = name.is_object() ? name.value("ru", "") : "";
  const std::string nameEn = name.is_object() ? name.value("en", "") : "";
  const std::string imageJson = product.value("image", nlohmann::json{{"kind", "sprite"}, {"index", 0}}).dump();
  sqlite3_stmt* stmt = nullptr;
  const char* sql =
      "INSERT INTO products(id, sku, barcode, name_az, name_ru, name_en, category, unit, price_minor, "
      "cost_minor, min_stock, tax_rate, supplier, accent, image_json, active, created_at, internal_code, color, "
      "size, parent_product_id, inn, strength, dosage_form, pack_units, split_allowed, rx_required, storage, "
      "manufacturer, country, reg_no, shelf) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
      "ON CONFLICT(id) DO UPDATE SET sku=excluded.sku, barcode=excluded.barcode, name_az=excluded.name_az, "
      "name_ru=excluded.name_ru, name_en=excluded.name_en, category=excluded.category, unit=excluded.unit, "
      "price_minor=excluded.price_minor, cost_minor=excluded.cost_minor, min_stock=excluded.min_stock, "
      "tax_rate=excluded.tax_rate, supplier=excluded.supplier, accent=excluded.accent, "
      "image_json=excluded.image_json, active=excluded.active, internal_code=excluded.internal_code, "
      "color=excluded.color, size=excluded.size, parent_product_id=excluded.parent_product_id, inn=excluded.inn, "
      "strength=excluded.strength, dosage_form=excluded.dosage_form, pack_units=excluded.pack_units, "
      "split_allowed=excluded.split_allowed, rx_required=excluded.rx_required, storage=excluded.storage, "
      "manufacturer=excluded.manufacturer, country=excluded.country, reg_no=excluded.reg_no, shelf=excluded.shelf";
  if (sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr) != SQLITE_OK) {
    throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
  }
  const std::int64_t createdAt = product.value("createdAt", nowMs());
  const int active = product.value("active", true) ? 1 : 0;
  sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, product.at("sku").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 3, product.at("barcode").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 4, nameAz.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, nameRu.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 6, nameEn.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 7, product.value("category", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 8, product.value("unit", "əd").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 9, static_cast<std::int64_t>(std::llround(product.at("priceMinor").get<double>())));
  sqlite3_bind_int64(stmt, 10, product.value("costMinor", 0));
  sqlite3_bind_int64(stmt, 11, product.value("minStock", 0));
  sqlite3_bind_int64(stmt, 12, product.value("taxRate", 18));
  sqlite3_bind_text(stmt, 13, product.value("supplier", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 14, product.value("accent", "#2563eb").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 15, imageJson.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int(stmt, 16, active);
  sqlite3_bind_int64(stmt, 17, createdAt);
  sqlite3_bind_text(stmt, 18, product.value("internalCode", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 19, product.value("color", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 20, product.value("size", "").c_str(), -1, SQLITE_TRANSIENT);
  if (product.contains("parentProductId") && product["parentProductId"].is_string() && !product["parentProductId"].get<std::string>().empty())
    sqlite3_bind_text(stmt, 21, product["parentProductId"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
  else
    sqlite3_bind_null(stmt, 21);
  sqlite3_bind_text(stmt, 22, product.value("inn", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 23, product.value("strength", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 24, product.value("dosageForm", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 25, std::max<std::int64_t>(1, product.value("packUnits", std::int64_t{1})));
  sqlite3_bind_int(stmt, 26, product.value("splitAllowed", false) ? 1 : 0);
  sqlite3_bind_int(stmt, 27, product.value("rxRequired", false) ? 1 : 0);
  sqlite3_bind_text(stmt, 28, product.value("storage", "room").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 29, product.value("manufacturer", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 30, product.value("country", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 31, product.value("regNo", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 32, product.value("shelf", "").c_str(), -1, SQLITE_TRANSIENT);
  if (sqlite3_step(stmt) != SQLITE_DONE) {
    const std::string msg = sqlite3_errmsg(db.raw());
    sqlite3_finalize(stmt);
    throw PosError("E_DB", msg, true);
  }
  sqlite3_finalize(stmt);

  if (product.contains("warehouseStock") && product["warehouseStock"].is_object()) {
    for (auto it = product["warehouseStock"].begin(); it != product["warehouseStock"].end(); ++it) {
      upsertStock(db, id, it.key(), it.value().get<std::int64_t>());
      if (isCreate) {
        recordMovement(db, "STOCKTAKE", id, it.key(), it.value().get<std::int64_t>(),
                       it.value().get<std::int64_t>(), "product", id, "system", "initial stock");
      }
    }
  }
}

void emitProductSync(db::Database& db, const std::string& productId) {
  auto rows = db.query("SELECT * FROM products WHERE id = ?", {productId}, {});
  if (rows.empty()) return;
  auto product = productRowToJson(rows[0], db);
  product.erase("warehouseStock");
  const auto logicalAt = nowMs();
  appendSyncEvent(db, "product.upsert", {{"product", product}, {"logicalAt", logicalAt}});
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO sync_catalog_clock(entity_type,entity_id,logical_at,origin_device_id) VALUES ('product',?,?,?) "
                     "ON CONFLICT(entity_type,entity_id) DO UPDATE SET logical_at=excluded.logical_at,origin_device_id=excluded.origin_device_id",
                     -1, &stmt, nullptr);
  const std::string deviceId = settingValue(db, "syncDeviceId");
  sqlite3_bind_text(stmt, 1, productId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 2, logicalAt);
  sqlite3_bind_text(stmt, 3, deviceId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
}

void emitWarehouseSync(db::Database& db, const std::string& warehouseId) {
  auto rows = db.query("SELECT * FROM warehouses WHERE id=?", {warehouseId}, {});
  if (rows.empty()) return;
  const auto logicalAt = nowMs();
  const auto& row = rows[0];
  appendSyncEvent(db, "warehouse.upsert", {{"warehouse", {{"id", row.at("id")}, {"code", row.at("code")},
                    {"name", row.at("name")}, {"address", db::columnOr(row, "address", "")},
                    {"manager", db::columnOr(row, "manager", "")}, {"active", row.at("active").get<std::int64_t>() != 0}}},
                    {"logicalAt", logicalAt}});
}

nlohmann::json syncStatus(db::Database& db) {
  nlohmann::json vector = nlohmann::json::object();
  for (const auto& row : db.query("SELECT origin_device_id,last_seq FROM sync_vectors")) {
    vector[row.at("origin_device_id").get<std::string>()] = row.at("last_seq");
  }
  return {{"deviceId", settingValue(db, "syncDeviceId")},
          {"vector", vector},
          {"pending", db.queryInt("SELECT COUNT(*) FROM sync_events WHERE server_acked=0")},
          {"bootstrapDone", settingValue(db, "syncBootstrapDone", "false") == "true"}};
}

nlohmann::json saleToJson(db::Database& db, const nlohmann::json& saleRow) {
  const std::string saleId = saleRow.at("id").get<std::string>();
  auto items = db.query(
      "SELECT id, product_id, qty, discount_minor, note FROM sale_items WHERE sale_id = ? ORDER BY id", {saleId},
      {});
  nlohmann::json lines = nlohmann::json::array();
  for (const auto& it : items) {
    nlohmann::json line = {{"saleItemId", it.at("id")}, {"productId", it.at("product_id")}, {"qty", it.at("qty")}};
    if (!it["discount_minor"].is_null() && it["discount_minor"].get<std::int64_t>() != 0) {
      line["discountMinor"] = it["discount_minor"];
    }
    if (!it["note"].is_null()) line["note"] = it["note"];
    lines.push_back(line);
  }
  nlohmann::json payment = {
      {"method", saleRow.at("payment_method")},
      {"amountMinor", saleRow.at("payment_amount_minor")},
      {"tenderedMinor", saleRow.at("tendered_minor")},
      {"changeMinor", saleRow.at("change_minor")},
  };
  if (!saleRow["cash_minor"].is_null()) payment["cashMinor"] = saleRow["cash_minor"];
  if (!saleRow["card_minor"].is_null()) payment["cardMinor"] = saleRow["card_minor"];
  payment["creditMinor"] = saleRow.value("credit_minor", 0);
  payment["loyaltyMinor"] = saleRow.value("loyalty_redeemed_minor", 0);
  return {
      {"id", saleId},
      {"receiptNo", saleRow.at("receipt_no")},
      {"createdAt", saleRow.at("created_at")},
      {"items", lines},
      {"subtotalMinor", saleRow.at("subtotal_minor")},
      {"discountMinor", saleRow.at("discount_minor")},
      {"totalMinor", saleRow.at("total_minor")},
      {"payment", payment},
      {"refunded", saleRow.at("refunded").get<std::int64_t>() != 0},
      {"cashierId", saleRow.at("cashier_id")},
      {"registerId", saleRow.at("register_id")},
      {"customerId", saleRow.contains("customer_id") && !saleRow["customer_id"].is_null() ? saleRow["customer_id"] : nlohmann::json(nullptr)},
      {"customerName", saleRow["customer_name"].is_null() ? nullptr : saleRow["customer_name"]},
      {"loyaltyEarnedMinor", saleRow.value("loyalty_earned_minor", 0)},
      {"loyaltyRedeemedMinor", saleRow.value("loyalty_redeemed_minor", 0)},
      {"creditMinor", saleRow.value("credit_minor", 0)},
      {"note", saleRow["note"].is_null() ? nullptr : saleRow["note"]},
  };
}

nlohmann::json exportState(db::Database& db) {
  nlohmann::json products = listProducts(db, false);
  auto saleRows = db.query("SELECT * FROM sales ORDER BY created_at DESC");
  nlohmann::json sales = nlohmann::json::array();
  for (const auto& row : saleRows) sales.push_back(saleToJson(db, row));

  auto wh = db.query("SELECT * FROM warehouses ORDER BY code");
  nlohmann::json warehouses = nlohmann::json::array();
  for (const auto& row : wh) {
    warehouses.push_back({{"id", row.at("id")},
                          {"code", row.at("code")},
                          {"name", row.at("name")},
                          {"address", db::columnOr(row, "address", "")},
                          {"manager", db::columnOr(row, "manager", "")},
                          {"active", row.at("active").get<std::int64_t>() != 0}});
  }

  auto regs = db.query("SELECT * FROM registers ORDER BY code");
  nlohmann::json registers = nlohmann::json::array();
  for (const auto& row : regs) {
    nlohmann::json r = {{"id", row.at("id")},
                        {"code", row.at("code")},
                        {"name", row.at("name")},
                        {"location", db::columnOr(row, "location", "")},
                        {"status", row.at("status")},
                        {"openingFloatMinor", row.at("opening_float_minor")}};
    if (!row["operator_id"].is_null()) r["operatorId"] = row["operator_id"];
    if (!row["opened_at"].is_null()) r["openedAt"] = row["opened_at"];
    registers.push_back(r);
  }

  auto pos = db.query("SELECT * FROM purchase_orders ORDER BY created_at DESC");
  nlohmann::json purchaseOrders = nlohmann::json::array();
  for (const auto& row : pos) {
    const auto id = row.at("id").get<std::string>();
    auto structured = db.query("SELECT id, product_id AS productId, qty, cost_minor AS costMinor, returned_qty AS returnedQty FROM purchase_order_lines WHERE purchase_id=? ORDER BY rowid", {id}, {});
    purchaseOrders.push_back({{"id", row.at("id")},
                              {"documentNo", db::columnOr(row, "document_no", id)},
                              {"supplier", row.at("supplier")},
                              {"expectedAt", db::columnOr(row, "expected_at", "")},
                              {"createdAt", row.at("created_at")},
                              {"updatedAt", db::columnOr(row, "updated_at", row.at("created_at"))},
                              {"createdBy", row.at("created_by")},
                              {"warehouseId", row.at("warehouse_id")},
                              {"status", row.at("status")},
                              {"totalMinor", db::columnOr(row, "total_minor", 0)},
                              {"paymentStatus", db::columnOr(row, "payment_status", "unpaid")},
                              {"lines", structured.empty() ? nlohmann::json::parse(row.at("lines_json").get<std::string>()) : structured}});
  }

  auto held = db.query("SELECT * FROM held_carts ORDER BY created_at DESC");
  nlohmann::json heldCarts = nlohmann::json::array();
  for (const auto& row : held) {
    heldCarts.push_back({{"id", row.at("id")},
                         {"label", row.at("label")},
                         {"createdAt", row.at("created_at")},
                         {"lines", nlohmann::json::parse(row.at("lines_json").get<std::string>())},
                         {"discountMinor", db::columnOr(row, "discount_minor", 0)},
                         {"customerId", row.contains("customer_id") && !row["customer_id"].is_null() ? row["customer_id"] : nlohmann::json(nullptr)},
                         {"customerName", row.contains("customer_name") && !row["customer_name"].is_null() ? row["customer_name"] : nlohmann::json(nullptr)},
                         {"note", row.contains("note") && !row["note"].is_null() ? row["note"] : nlohmann::json(nullptr)}});
  }

  auto audits = db.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200");
  nlohmann::json auditEntries = nlohmann::json::array();
  for (const auto& row : audits) {
    auditEntries.push_back({{"id", row.at("id")},
                            {"createdAt", row.at("created_at")},
                            {"actorId", row.at("actor_id")},
                            {"action", row.at("action")},
                            {"detail", db::columnOr(row, "detail", "")}});
  }

  auto settingsRows = db.query("SELECT key, value FROM settings");
  nlohmann::json settings = {
      {"storeName", "Aptek"},
      {"legalName", "Aptek MMC"},
      {"taxId", ""},
      {"phone", ""},
      {"address", ""},
      {"terminalName", "APTEKPOS-01"},
      {"defaultWarehouseId", primaryWarehouseId(db)},
      {"defaultRegisterId", "reg-2"},
      {"syncUrl", "https://possistem.az/aptekpos"},
  };
  for (const auto& row : settingsRows) {
    settings[row.at("key").get<std::string>()] = row.at("value");
  }

  return {{"schemaVersion", 4},
          {"products", products},
          {"sales", sales},
          {"purchaseOrders", purchaseOrders},
          {"warehouses", warehouses},
          {"registers", registers},
          {"heldCarts", heldCarts},
          {"audits", auditEntries},
          {"settings", settings},
          {"syncQueue", 0}};
}

void importLegacy(db::Database& db, const nlohmann::json& snapshot) {
  db.begin();
  try {
    if (snapshot.contains("warehouses")) {
      for (const auto& w : snapshot["warehouses"]) {
        sqlite3_stmt* stmt = nullptr;
        const char* sql =
            "INSERT INTO warehouses(id, code, name, address, manager, active) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, address=excluded.address, "
            "manager=excluded.manager, active=excluded.active";
        sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, w.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, w.at("code").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, w.at("name").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, w.value("address", "").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 5, w.value("manager", "").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 6, w.value("active", true) ? 1 : 0);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }
    }
    if (snapshot.contains("registers")) {
      for (const auto& r : snapshot["registers"]) {
        sqlite3_stmt* stmt = nullptr;
        const char* sql =
            "INSERT INTO registers(id, code, name, location, status, operator_id, opening_float_minor, opened_at) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, "
            "location=excluded.location, status=excluded.status, operator_id=excluded.operator_id, "
            "opening_float_minor=excluded.opening_float_minor, opened_at=excluded.opened_at";
        sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, r.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, r.at("code").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, r.at("name").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, r.value("location", "").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 5, r.value("status", "closed").c_str(), -1, SQLITE_TRANSIENT);
        if (r.contains("operatorId") && r["operatorId"].is_string())
          sqlite3_bind_text(stmt, 6, r["operatorId"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        else
          sqlite3_bind_null(stmt, 6);
        sqlite3_bind_int64(stmt, 7, r.value("openingFloatMinor", 0));
        if (r.contains("openedAt") && r["openedAt"].is_number())
          sqlite3_bind_int64(stmt, 8, r["openedAt"].get<std::int64_t>());
        else
          sqlite3_bind_null(stmt, 8);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }
    }
    if (snapshot.contains("products")) {
      for (const auto& p : snapshot["products"]) {
        saveProduct(db, p, true);
      }
    }
    if (snapshot.contains("settings") && snapshot["settings"].is_object()) {
      for (auto it = snapshot["settings"].begin(); it != snapshot["settings"].end(); ++it) {
        const std::string key = it.key();
        const std::string value = it.value().is_string() ? it.value().get<std::string>() : it.value().dump();
        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(db.raw(),
                           "INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }
    }
    if (snapshot.contains("purchaseOrders")) {
      for (const auto& po : snapshot["purchaseOrders"]) {
        sqlite3_stmt* stmt = nullptr;
        const std::string lines = po.at("lines").dump();
        sqlite3_prepare_v2(db.raw(),
                           "INSERT INTO purchase_orders(id, supplier, expected_at, created_at, created_by, "
                           "warehouse_id, status, lines_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, po.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, po.at("supplier").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, po.value("expectedAt", "").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 4, po.at("createdAt").get<std::int64_t>());
        sqlite3_bind_text(stmt, 5, po.at("createdBy").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 6, po.at("warehouseId").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 7, po.value("status", "ordered").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 8, lines.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }
    }
    audit(db, "system", "LEGACY_IMPORT", "imported localStorage snapshot");
    db.commit();
  } catch (...) {
    db.rollback();
    throw;
  }
}

/**
 * Pharmacy lots. A sale takes stock from the lot that expires first (FEFO), and
 * stock that sits in expired lots cannot be sold: it is written off, never
 * handed to a customer. Products without lots are unaffected.
 * ponytail: a refund restocks the product but not its lot; add lot-aware
 * refunds when a pharmacy needs to trace returned boxes by batch.
 */
std::int64_t expiredLotQty(db::Database& db, const std::string& productId) {
  return db.queryInt(
      "SELECT COALESCE(SUM(qty_remaining),0) FROM product_lots WHERE product_id = ? AND qty_remaining > 0 "
      "AND expires_at IS NOT NULL AND expires_at < ?",
      {productId}, {nowMs()});
}

void consumeLotsFefo(db::Database& db, const std::string& productId, std::int64_t qty) {
  auto lots = db.query(
      "SELECT id, qty_remaining FROM product_lots WHERE product_id = ? AND qty_remaining > 0 "
      "AND (expires_at IS NULL OR expires_at >= ?) ORDER BY expires_at IS NULL, expires_at, id",
      {productId}, {nowMs()});
  for (const auto& lot : lots) {
    if (qty <= 0) break;
    const auto take = std::min(qty, lot.at("qty_remaining").get<std::int64_t>());
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(), "UPDATE product_lots SET qty_remaining = qty_remaining - ? WHERE id = ?", -1, &stmt,
                       nullptr);
    sqlite3_bind_int64(stmt, 1, take);
    sqlite3_bind_text(stmt, 2, lot.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    const int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
    qty -= take;
  }
}

/** Written-off stock leaves its lots too; an "expired" write-off empties expired lots first. */
void writeOffLots(db::Database& db, const std::string& productId, std::int64_t qty, bool expiredFirst) {
  if (expiredFirst) {
    auto lots = db.query(
        "SELECT id, qty_remaining FROM product_lots WHERE product_id = ? AND qty_remaining > 0 "
        "AND expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at, id",
        {productId}, {nowMs()});
    for (const auto& lot : lots) {
      if (qty <= 0) break;
      const auto take = std::min(qty, lot.at("qty_remaining").get<std::int64_t>());
      db.query("UPDATE product_lots SET qty_remaining = qty_remaining - " + std::to_string(take) + " WHERE id = ?",
               {lot.at("id").get<std::string>()}, {});
      qty -= take;
    }
  }
  if (qty > 0) consumeLotsFefo(db, productId, qty);
}

nlohmann::json completeSale(db::Database& db, const nlohmann::json& payload) {
  const auto items = payload.at("items");
  if (!items.is_array() || items.empty()) throw PosError("E_VALIDATION", "sale items required");
  const std::string cashierId = requireString(payload, "cashierId");
  const std::string registerId = requireString(payload, "registerId");
  const std::string wh = ensurePrimaryWarehouse(db);

  const auto regStatus = db.queryText("SELECT status FROM registers WHERE id = ?", {registerId}, {});
  if (regStatus != "open") throw PosError("REGISTER_CLOSED", "Register is closed");

  std::int64_t subtotal = 0;
  struct Line {
    std::string productId;
    std::int64_t qty;
    std::int64_t unitPrice;
    std::int64_t discount;
    std::int64_t lineTotal;
    std::string note;
  };
  std::vector<Line> lines;
  for (const auto& item : items) {
    const std::string productId = item.at("productId").get<std::string>();
    const std::int64_t qty = item.at("qty").get<std::int64_t>();
    if (qty <= 0) throw PosError("E_VALIDATION", "qty must be > 0");
    auto prows = db.query("SELECT price_minor, active FROM products WHERE id = ?", {productId}, {});
    if (prows.empty()) throw PosError("E_NOT_FOUND", "product not found: " + productId);
    if (prows[0].at("active").get<std::int64_t>() == 0) throw PosError("E_VALIDATION", "product inactive");
    if (const auto expired = expiredLotQty(db, productId); expired > 0) {
      const auto onHand = db.queryInt("SELECT COALESCE(SUM(qty),0) FROM stock_levels WHERE product_id = ?", {productId}, {});
      if (qty > onHand - expired)
        throw PosError("E_EXPIRED_STOCK", "Vaxtı keçmiş seriya satıla bilməz: " +
                                              db.queryText("SELECT name_az FROM products WHERE id = ?", {productId}, {}));
    }
    const std::int64_t catalogUnit = prows[0].at("price_minor").get<std::int64_t>();
    std::int64_t unit = catalogUnit;
    if (item.contains("unitPriceMinor") && item["unitPriceMinor"].is_number_integer()) {
      const auto overrideUnit = item["unitPriceMinor"].get<std::int64_t>();
      if (overrideUnit != catalogUnit) {
        // Price override must carry role/approver on the sale payload
        nlohmann::json gate = payload;
        gate["reason"] = item.value("overrideReason", "");
        requirePermission(db, gate, "PRICE_OVERRIDE");
        unit = overrideUnit;
      }
    }
    const std::int64_t disc = item.value("discountMinor", 0);
    // Support weighted qtyMilli (thousandths)
    std::int64_t lineTotal = 0;
    if (item.contains("qtyMilli") && item["qtyMilli"].is_number_integer()) {
      const auto qtyMilli = item["qtyMilli"].get<std::int64_t>();
      lineTotal = (unit * qtyMilli) / 1000 - disc;
      subtotal += (unit * qtyMilli) / 1000;
    } else {
      lineTotal = unit * qty - disc;
      subtotal += unit * qty;
    }
    if (lineTotal < 0) throw PosError("E_VALIDATION", "line total negative");
    lines.push_back({productId, qty, unit, disc, lineTotal, item.value("note", "")});
  }
  const std::int64_t discountMinor = std::min(subtotal, payload.value("discountMinor", static_cast<std::int64_t>(0)));
  const std::int64_t total = subtotal - discountMinor;
  const auto& payment = payload.at("payment");
  const std::string method = payment.at("method").get<std::string>();
  const std::int64_t tendered = payment.value("tenderedMinor", total);
  const std::int64_t cashMinor = payment.value("cashMinor", method == "cash" ? total : 0);
  const std::int64_t cardMinor = payment.value("cardMinor", method == "card" ? total : 0);
  const std::int64_t creditMinor = payment.value("creditMinor", method == "credit" ? total : 0);
  const std::int64_t loyaltyMinor = payment.value("loyaltyMinor", method == "loyalty" ? total : 0);
  const std::string customerId = payload.value("customerId", "");
  if ((creditMinor > 0 || loyaltyMinor > 0) && customerId.empty())
    throw PosError("E_VALIDATION", "customer required for credit or loyalty");
  if (method == "cash" && tendered < total) throw PosError("E_VALIDATION", "tendered less than total");
  if (cashMinor + cardMinor + creditMinor + loyaltyMinor < total)
    throw PosError("E_VALIDATION", "payment insufficient");
  if (creditMinor > 0) {
    requirePermission(db, payload, "CUSTOMER_CREDIT");
    auto customer = db.query("SELECT credit_allowed, credit_limit_minor FROM customers WHERE id = ? AND active = 1", {customerId}, {});
    if (customer.empty() || customer[0].at("credit_allowed").get<std::int64_t>() == 0)
      throw PosError("PERMISSION_DENIED", "customer credit is disabled");
    const auto balance = db.queryInt("SELECT COALESCE((SELECT balance_after_minor FROM customer_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1),0)", {customerId}, {});
    if (balance + creditMinor > customer[0].at("credit_limit_minor").get<std::int64_t>())
      throw PosError("CREDIT_LIMIT_EXCEEDED", "customer credit limit exceeded");
  }
  const auto loyaltyBalance = customerId.empty() ? 0 : db.queryInt("SELECT COALESCE((SELECT points_after FROM loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1),0)", {customerId}, {});
  if (loyaltyMinor > loyaltyBalance) throw PosError("E_VALIDATION", "insufficient loyalty balance");
  if (loyaltyMinor > 0) requirePermission(db, payload, "LOYALTY_REDEEM");
  std::int64_t loyaltyRateBps = 0;
  try { loyaltyRateBps = std::stoll(db.queryText("SELECT value FROM settings WHERE key='loyaltyRateBps'")); } catch (...) {}
  const std::int64_t loyaltyEarnedMinor = customerId.empty() ? 0 : std::max<std::int64_t>(0, total - loyaltyMinor) * loyaltyRateBps / 10000;
  const std::int64_t change = method == "cash" ? std::max<std::int64_t>(0, tendered - total) : 0;

  const auto createdAt = payload.value("createdAt", nowMs());
  const std::string saleId = payload.value("id", newId("sale"));

  // receipt number
  const auto day = [&]() {
    const auto tt = std::chrono::system_clock::time_point(std::chrono::milliseconds(createdAt));
    std::time_t t = std::chrono::system_clock::to_time_t(tt);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[16];
    std::snprintf(buf, sizeof(buf), "%02d%02d%02d", (tm.tm_year + 1900) % 100, tm.tm_mon + 1, tm.tm_mday);
    return std::string(buf);
  }();
  // Receipt numbers carry the register code. Sales are never replicated
  // between tills, so numbering from this PC's own COUNT(*) had two tills
  // issue the same M-<day>-0001.
  const auto registerCode = db.queryText("SELECT code FROM registers WHERE id = ?", {registerId}, {});
  const std::string prefix = "M-" + (registerCode.empty() ? std::string() : registerCode + "-") + day + "-";
  const auto seq = db.queryInt("SELECT COUNT(*) FROM sales WHERE receipt_no LIKE ?", {prefix + "%"}) + 1;
  char seqBuf[16];
  std::snprintf(seqBuf, sizeof(seqBuf), "%04lld", static_cast<long long>(seq));
  const std::string receiptNo = payload.value("receiptNo", prefix + seqBuf);

  db.begin();
  try {
    for (const auto& line : lines) {
      applyStockDelta(db, "SALE", line.productId, wh, -line.qty, "sale", saleId, cashierId, "", false);
      consumeLotsFefo(db, line.productId, line.qty);
    }

    sqlite3_stmt* stmt = nullptr;
    const char* sql =
        "INSERT INTO sales(id, receipt_no, created_at, subtotal_minor, discount_minor, total_minor, "
        "payment_method, payment_amount_minor, tendered_minor, change_minor, cash_minor, card_minor, "
        "refunded, cashier_id, register_id, customer_name, note, warehouse_id, customer_id, "
        "loyalty_earned_minor, loyalty_redeemed_minor, credit_minor) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)";
    if (sqlite3_prepare_v2(db.raw(), sql, -1, &stmt, nullptr) != SQLITE_OK) {
      throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
    }
    sqlite3_bind_text(stmt, 1, saleId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, receiptNo.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, createdAt);
    sqlite3_bind_int64(stmt, 4, subtotal);
    sqlite3_bind_int64(stmt, 5, discountMinor);
    sqlite3_bind_int64(stmt, 6, total);
    sqlite3_bind_text(stmt, 7, method.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 8, total);
    sqlite3_bind_int64(stmt, 9, tendered);
    sqlite3_bind_int64(stmt, 10, change);
    sqlite3_bind_int64(stmt, 11, cashMinor);
    sqlite3_bind_int64(stmt, 12, cardMinor);
    sqlite3_bind_text(stmt, 13, cashierId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 14, registerId.c_str(), -1, SQLITE_TRANSIENT);
    if (payload.contains("customerName") && payload["customerName"].is_string())
      sqlite3_bind_text(stmt, 15, payload["customerName"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 15);
    if (payload.contains("note") && payload["note"].is_string())
      sqlite3_bind_text(stmt, 16, payload["note"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 16);
    sqlite3_bind_text(stmt, 17, wh.c_str(), -1, SQLITE_TRANSIENT);
    if (!customerId.empty()) sqlite3_bind_text(stmt, 18, customerId.c_str(), -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(stmt, 18);
    sqlite3_bind_int64(stmt, 19, loyaltyEarnedMinor);
    sqlite3_bind_int64(stmt, 20, loyaltyMinor);
    sqlite3_bind_int64(stmt, 21, creditMinor);
    if (sqlite3_step(stmt) != SQLITE_DONE) {
      const std::string msg = sqlite3_errmsg(db.raw());
      sqlite3_finalize(stmt);
      throw PosError("E_DB", msg, true);
    }
    sqlite3_finalize(stmt);

    for (const auto& line : lines) {
      sqlite3_stmt* is = nullptr;
      sqlite3_prepare_v2(db.raw(),
                         "INSERT INTO sale_items(sale_id, product_id, qty, unit_price_minor, discount_minor, "
                         "line_total_minor, note) VALUES (?,?,?,?,?,?,?)",
                         -1, &is, nullptr);
      sqlite3_bind_text(is, 1, saleId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(is, 2, line.productId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(is, 3, line.qty);
      sqlite3_bind_int64(is, 4, line.unitPrice);
      sqlite3_bind_int64(is, 5, line.discount);
      sqlite3_bind_int64(is, 6, line.lineTotal);
      if (line.note.empty()) sqlite3_bind_null(is, 7);
      else sqlite3_bind_text(is, 7, line.note.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(is);
      sqlite3_finalize(is);
    }

    if (!customerId.empty() && creditMinor > 0) {
      const auto balance = db.queryInt("SELECT COALESCE((SELECT balance_after_minor FROM customer_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1),0)", {customerId}, {});
      const std::string ledgerId = newId("cl");
      sqlite3_stmt* ls = nullptr;
      sqlite3_prepare_v2(db.raw(), "INSERT INTO customer_ledger(id, customer_id, kind, amount_minor, balance_after_minor, ref_type, ref_id, note, created_at, actor_id) VALUES (?,?,?,?,?,'sale',?,'Nisye satis',?,?)", -1, &ls, nullptr);
      sqlite3_bind_text(ls, 1, ledgerId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(ls, 2, customerId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(ls, 3, "sale_credit", -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(ls, 4, creditMinor);
      sqlite3_bind_int64(ls, 5, balance + creditMinor);
      sqlite3_bind_text(ls, 6, saleId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(ls, 7, createdAt);
      sqlite3_bind_text(ls, 8, cashierId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(ls); sqlite3_finalize(ls);
    }
    if (!customerId.empty() && (loyaltyEarnedMinor > 0 || loyaltyMinor > 0)) {
      const auto delta = loyaltyEarnedMinor - loyaltyMinor;
      const std::string loyaltyId = newId("ly");
      sqlite3_stmt* ls = nullptr;
      sqlite3_prepare_v2(db.raw(), "INSERT INTO loyalty_ledger(id, customer_id, points_delta, points_after, kind, ref_type, ref_id, created_at) VALUES (?,?,?,?,?,'sale',?,?)", -1, &ls, nullptr);
      sqlite3_bind_text(ls, 1, loyaltyId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(ls, 2, customerId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(ls, 3, delta);
      sqlite3_bind_int64(ls, 4, loyaltyBalance + delta);
      sqlite3_bind_text(ls, 5, loyaltyMinor > 0 ? "sale_redeem" : "sale_earn", -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(ls, 6, saleId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(ls, 7, createdAt);
      sqlite3_step(ls); sqlite3_finalize(ls);
    }

    audit(db, cashierId, "SALE_COMPLETE", receiptNo);
    db.commit();
  } catch (...) {
    db.rollback();
    throw;
  }

  auto rows = db.query("SELECT * FROM sales WHERE id = ?", {saleId}, {});
  return saleToJson(db, rows.at(0));
}

}  // namespace

void applySharedStockDelta(db::Database& db, const std::string& type, const std::string& productId,
                           const std::string& warehouseId, std::int64_t qtyDelta,
                           const std::string& refType, const std::string& refId,
                           const std::string& actorId, const std::string& note, bool allowNegative,
                           bool emitSync) {
  applyStockDelta(db, type, productId, warehouseId, qtyDelta, refType, refId, actorId, note,
                  allowNegative, emitSync);
}

Application::Application(AppConfig config) : config_(std::move(config)) {}

void Application::bootstrap() {
  logging::info("opening database " + config_.dbPath);
  db_.open(config_.dbPath);
  db::Migrator migrator(db_);
  migrator.migrate();
  migrator.seedIfEmpty();
  // A till whose configured warehouse was deleted cannot sell at all: the
  // foreign key on stock_levels rolls the whole sale back. Self-heal on launch.
  repairWarehouseSetting(db_);
  logging::info("bootstrap complete");
}

void Application::registerHandlers(ipc::StdioServer& server) {
  // Permissions. The catalogue has always promised STOCK_ADJUSTMENT,
  // RECEIVE_PURCHASE and the rest, and the permissions screen let an operator
  // hand them out - but only the handlers in RetailOps.cpp ever checked one.
  // Everything registered here was reachable by anyone with a session, so a
  // cashier could write off stock, delete a product or close a shift through
  // `market:invoke` while their own screen hid the button.
  //
  // `role` comes from the session main verified, never from the renderer (see
  // electron/core-payload.cjs), and requirePermission still accepts a manager
  // PIN as an override, so an overridden refund keeps working as before.
  server.on("core.ping", [](const nlohmann::json&) { return nlohmann::json{{"pong", true}}; });
  server.on("core.info", [this](const nlohmann::json&) {
    return nlohmann::json{{"version", MARKET_CORE_VERSION},
                          {"protocolVersion", protocol::kVersion},
                          {"dbPath", config_.dbPath}};
  });
  server.on("state.get", [this](const nlohmann::json&) { return exportState(db_); });
  server.on("state.importLegacy", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "MANAGE_SETTINGS");
    if (!p.contains("snapshot")) throw PosError("E_VALIDATION", "snapshot required");
    importLegacy(db_, p.at("snapshot"));
    return exportState(db_);
  });

  server.on("sync.configure", [this](const nlohmann::json& p) {
    setSettingValue(db_, "syncDeviceId", requireString(p, "deviceId"));
    replayOrphanSyncEvents(db_);
    return syncStatus(db_);
  });
  server.on("sync.prune", [this](const nlohmann::json& p) {
    return nlohmann::json{{"removed", pruneSyncEvents(db_, p.value("keepDays", static_cast<std::int64_t>(30)))}};
  });
  server.on("sync.getServerVector", [this](const nlohmann::json&) {
    const auto raw = settingValue(db_, "syncServerVector", "{}");
    nlohmann::json vector = nlohmann::json::object();
    try { vector = nlohmann::json::parse(raw); } catch (...) { vector = nlohmann::json::object(); }
    if (!vector.is_object()) vector = nlohmann::json::object();
    return nlohmann::json{{"vector", vector}};
  });
  server.on("sync.setServerVector", [this](const nlohmann::json& p) {
    const auto vector = p.value("vector", nlohmann::json::object());
    setSettingValue(db_, "syncServerVector", vector.is_object() ? vector.dump() : "{}");
    savePeerVector(db_, "__server__", vector);
    return syncStatus(db_);
  });
  server.on("sync.setPeerVector", [this](const nlohmann::json& p) {
    const auto peerId = p.value("peerDeviceId", std::string{});
    if (peerId.empty()) throw PosError("E_VALIDATION", "peerDeviceId required");
    savePeerVector(db_, peerId, p.value("vector", nlohmann::json::object()));
    return syncStatus(db_);
  });
  server.on("sync.status", [this](const nlohmann::json&) { return syncStatus(db_); });
  server.on("sync.export", [this](const nlohmann::json& p) {
    const auto peerVector = p.value("vector", nlohmann::json::object());
    // The peer cursor must be applied in SQL, not after LIMIT. Filtering a fixed
    // window of the oldest rows in C++ means that once the table outgrows the
    // window every export is filtered down to nothing and replication stops dead.
    std::vector<std::string> textBinds;
    std::vector<std::int64_t> intBinds;
    std::string where;
    if (peerVector.is_object() && !peerVector.empty()) {
      const auto pairs = peerVector.size();
      std::size_t n = 0;
      for (const auto& [origin, seq] : peerVector.items()) {
        if (!seq.is_number_integer()) continue;
        textBinds.push_back(origin);
        intBinds.push_back(seq.get<std::int64_t>());
        // bindAll binds every text param first, so text sits at 1..pairs and the
        // matching int at pairs+1..2*pairs.
        where += (n == 0 ? " WHERE " : " AND ");
        where += "NOT (origin_device_id = ?" + std::to_string(n + 1) + " AND origin_seq <= ?" +
                 std::to_string(pairs + n + 1) + ")";
        ++n;
      }
    }
    const std::string sql = "SELECT * FROM sync_events" + where +
                            " ORDER BY created_at,origin_device_id,origin_seq LIMIT 5000";
    nlohmann::json events = nlohmann::json::array();
    for (const auto& row : db_.query(sql, textBinds, intBinds)) {
      events.push_back({{"eventId", row.at("event_id")},
                        {"originDeviceId", row.at("origin_device_id")},
                        {"originSeq", row.at("origin_seq")}, {"kind", row.at("kind")},
                        {"payload", nlohmann::json::parse(row.at("payload_json").get<std::string>())},
                        {"createdAt", row.at("created_at")}});
    }
    auto status = syncStatus(db_);
    status["events"] = events;
    // Tell the caller whether this was a full drain, so it can keep pulling
    // instead of assuming a short batch means "up to date".
    status["more"] = events.size() >= 5000;
    return status;
  });
  server.on("sync.apply", [this](const nlohmann::json& p) {
    if (!p.contains("events") || !p["events"].is_array()) throw PosError("E_VALIDATION", "events required");
    std::int64_t applied = 0;
    std::int64_t rejected = 0;
    db_.begin();
    try {
      for (const auto& event : p["events"]) {
        const auto eventId = requireString(event, "eventId");
        if (db_.queryInt("SELECT COUNT(*) FROM sync_events WHERE event_id=?", {eventId}, {}) > 0) continue;
        if (db_.queryInt("SELECT COUNT(*) FROM sync_events_dead WHERE event_id=?", {eventId}, {}) > 0) continue;
        // One unapplicable event must not abort the batch. Without this savepoint a
        // single FK violation (e.g. a movement for a product this till has not seen
        // yet) rolls back every sibling event, and the identical batch is retried
        // every 2s forever.
        db_.exec("SAVEPOINT sync_evt");
        try {
        const auto origin = requireString(event, "originDeviceId");
        const auto seq = requireInt(event, "originSeq");
        const auto kind = requireString(event, "kind");
        const auto createdAt = event.value("createdAt", nowMs());
        const auto payload = event.value("payload", nlohmann::json::object());

        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(db_.raw(),
                           "INSERT INTO sync_events(event_id,origin_device_id,origin_seq,kind,payload_json,created_at) VALUES (?,?,?,?,?,?)",
                           -1, &stmt, nullptr);
        const auto payloadJson = payload.dump();
        sqlite3_bind_text(stmt, 1, eventId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, origin.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 3, seq);
        sqlite3_bind_text(stmt, 4, kind.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 5, payloadJson.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 6, createdAt);
        if (sqlite3_step(stmt) != SQLITE_DONE) {
          const std::string msg = sqlite3_errmsg(db_.raw()); sqlite3_finalize(stmt); throw PosError("E_DB", msg, true);
        }
        sqlite3_finalize(stmt);

        if (kind == "stock.movement") {
          const auto productId = requireString(payload, "productId");
          const auto warehouseId = normalizeWarehouseId(db_, payload.value("warehouseId", std::string{}));
          const auto delta = requireInt(payload, "qtyDelta");
          const auto next = getStock(db_, productId, warehouseId) + delta;
          upsertStock(db_, productId, warehouseId, next);
          recordMovement(db_, payload.value("type", "SYNC"), productId, warehouseId, delta, next,
                         payload.value("refType", "sync"), payload.value("refId", eventId),
                         payload.value("actorId", origin), payload.value("note", "remote sync"), false, eventId);
          if (next < 0) audit(db_, origin, "STOCK_MISMATCH", productId + "@" + warehouseId + "=" + std::to_string(next));
        } else if (kind == "stock.snapshot") {
          // Absolute set with last-writer-wins, so a repeated or crossed bootstrap
          // converges instead of accumulating.
          const auto productId = requireString(payload, "productId");
          const auto warehouseId = normalizeWarehouseId(db_, payload.value("warehouseId", std::string{}));
          const auto qty = requireInt(payload, "qty");
          const auto logicalAt = payload.value("logicalAt", createdAt);
          const std::string entityId = productId + "@" + warehouseId;
          auto clocks = db_.query(
              "SELECT logical_at,origin_device_id FROM sync_catalog_clock WHERE entity_type='stock' AND entity_id=?",
              {entityId}, {});
          const bool wins = clocks.empty() || logicalAt > clocks[0].at("logical_at").get<std::int64_t>() ||
                            (logicalAt == clocks[0].at("logical_at").get<std::int64_t>() &&
                             origin > clocks[0].at("origin_device_id").get<std::string>());
          if (wins) {
            const auto before = getStock(db_, productId, warehouseId);
            upsertStock(db_, productId, warehouseId, qty);
            if (before != qty) {
              recordMovement(db_, "SNAPSHOT", productId, warehouseId, qty - before, qty,
                             payload.value("refType", "bootstrap"), payload.value("refId", eventId),
                             payload.value("actorId", origin), payload.value("note", "remote snapshot"), false,
                             eventId);
            }
            sqlite3_prepare_v2(db_.raw(),
                               "INSERT INTO sync_catalog_clock(entity_type,entity_id,logical_at,origin_device_id) "
                               "VALUES ('stock',?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET "
                               "logical_at=excluded.logical_at,origin_device_id=excluded.origin_device_id",
                               -1, &stmt, nullptr);
            sqlite3_bind_text(stmt, 1, entityId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(stmt, 2, logicalAt);
            sqlite3_bind_text(stmt, 3, origin.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_step(stmt); sqlite3_finalize(stmt);
          }
          // A peer already seeded the cluster — do not broadcast our own snapshot on top.
          setSettingValue(db_, "syncBootstrapDone", "true");
        } else if (kind == "product.upsert" && payload.contains("product")) {
          const auto product = payload.at("product");
          const auto productId = requireString(product, "id");
          const auto logicalAt = payload.value("logicalAt", createdAt);
          auto clocks = db_.query("SELECT logical_at,origin_device_id FROM sync_catalog_clock WHERE entity_type='product' AND entity_id=?", {productId}, {});
          const bool wins = clocks.empty() || logicalAt > clocks[0].at("logical_at").get<std::int64_t>() ||
                            (logicalAt == clocks[0].at("logical_at").get<std::int64_t>() && origin > clocks[0].at("origin_device_id").get<std::string>());
          if (wins) {
            saveProduct(db_, product, false);
            sqlite3_prepare_v2(db_.raw(), "INSERT INTO sync_catalog_clock(entity_type,entity_id,logical_at,origin_device_id) VALUES ('product',?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET logical_at=excluded.logical_at,origin_device_id=excluded.origin_device_id", -1, &stmt, nullptr);
            sqlite3_bind_text(stmt, 1, productId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(stmt, 2, logicalAt);
            sqlite3_bind_text(stmt, 3, origin.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_step(stmt); sqlite3_finalize(stmt);
          }
        } else if (kind == "warehouse.upsert" && payload.contains("warehouse")) {
          const auto warehouse = payload.at("warehouse");
          const auto warehouseId = requireString(warehouse, "id");
          const auto logicalAt = payload.value("logicalAt", createdAt);
          auto clocks = db_.query("SELECT logical_at,origin_device_id FROM sync_catalog_clock WHERE entity_type='warehouse' AND entity_id=?", {warehouseId}, {});
          const bool wins = clocks.empty() || logicalAt > clocks[0].at("logical_at").get<std::int64_t>() ||
                            (logicalAt == clocks[0].at("logical_at").get<std::int64_t>() && origin > clocks[0].at("origin_device_id").get<std::string>());
          if (wins) {
            sqlite3_prepare_v2(db_.raw(), "INSERT INTO warehouses(id,code,name,address,manager,active) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,address=excluded.address,manager=excluded.manager,active=excluded.active", -1, &stmt, nullptr);
            sqlite3_bind_text(stmt, 1, warehouseId.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 2, warehouse.value("code", warehouseId).c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 3, warehouse.value("name", warehouseId).c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 4, warehouse.value("address", "").c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 5, warehouse.value("manager", "").c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_int(stmt, 6, warehouse.value("active", true) ? 1 : 0);
            if (sqlite3_step(stmt) != SQLITE_DONE) { const std::string msg = sqlite3_errmsg(db_.raw()); sqlite3_finalize(stmt); throw PosError("E_DB", msg, true); }
            sqlite3_finalize(stmt);
            sqlite3_prepare_v2(db_.raw(), "INSERT INTO sync_catalog_clock(entity_type,entity_id,logical_at,origin_device_id) VALUES ('warehouse',?,?,?) ON CONFLICT(entity_type,entity_id) DO UPDATE SET logical_at=excluded.logical_at,origin_device_id=excluded.origin_device_id", -1, &stmt, nullptr);
            sqlite3_bind_text(stmt, 1, warehouseId.c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_int64(stmt, 2, logicalAt); sqlite3_bind_text(stmt, 3, origin.c_str(), -1, SQLITE_TRANSIENT); sqlite3_step(stmt); sqlite3_finalize(stmt);
          }
        }
        sqlite3_prepare_v2(db_.raw(), "INSERT INTO sync_vectors(origin_device_id,last_seq,updated_at) VALUES (?,?,?) ON CONFLICT(origin_device_id) DO UPDATE SET last_seq=MAX(last_seq,excluded.last_seq),updated_at=excluded.updated_at", -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, origin.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 2, seq);
        sqlite3_bind_int64(stmt, 3, nowMs());
        sqlite3_step(stmt); sqlite3_finalize(stmt);
        db_.exec("RELEASE sync_evt");
        ++applied;
        } catch (const std::exception& ex) {
          db_.exec("ROLLBACK TO sync_evt");
          db_.exec("RELEASE sync_evt");
          deadLetterSyncEvent(db_, event, ex.what());
          ++rejected;
        }
      }
      db_.commit();
    } catch (...) { db_.rollback(); throw; }
    if (rejected > 0) {
      logging::warn("sync.apply rejected " + std::to_string(rejected) + " event(s) to dead-letter");
    }
    auto status = syncStatus(db_);
    status["applied"] = applied;
    status["rejected"] = rejected;
    return status;
  });
  server.on("sync.ack", [this](const nlohmann::json& p) {
    if (!p.contains("eventIds") || !p["eventIds"].is_array()) throw PosError("E_VALIDATION", "eventIds required");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_.raw(), "UPDATE sync_events SET server_acked=1 WHERE event_id=?", -1, &stmt, nullptr);
    for (const auto& id : p["eventIds"]) {
      if (!id.is_string()) continue;
      sqlite3_reset(stmt); sqlite3_clear_bindings(stmt);
      sqlite3_bind_text(stmt, 1, id.get_ref<const std::string&>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
    }
    sqlite3_finalize(stmt);
    return syncStatus(db_);
  });
  server.on("sync.bootstrap", [this](const nlohmann::json&) {
    if (settingValue(db_, "syncBootstrapDone", "false") == "true") return syncStatus(db_);
    db_.begin();
    try {
      for (const auto& row : db_.query("SELECT id FROM products")) emitProductSync(db_, row.at("id").get<std::string>());
      for (const auto& row : db_.query("SELECT id FROM warehouses")) emitWarehouseSync(db_, row.at("id").get<std::string>());
      // Absolute snapshot, never a delta. Two tills seeded from the same catalog
      // would each broadcast their full on-hand as a delta and apply the other's,
      // silently doubling stock store-wide with no way to detect it afterwards.
      const auto logicalAt = nowMs();
      for (const auto& row : db_.query("SELECT product_id,warehouse_id,qty FROM stock_levels WHERE qty<>0")) {
        appendSyncEvent(db_, "stock.snapshot", {{"productId", row.at("product_id")}, {"warehouseId", row.at("warehouse_id")},
                         {"qty", row.at("qty")}, {"logicalAt", logicalAt}, {"refType", "bootstrap"},
                         {"refId", "initial"}, {"actorId", "system"}, {"note", "initial shared stock"}});
      }
      setSettingValue(db_, "syncBootstrapDone", "true");
      db_.commit();
    } catch (...) { db_.rollback(); throw; }
    return syncStatus(db_);
  });

  server.on("product.list", [this](const nlohmann::json& p) {
    return listProducts(db_, p.value("activeOnly", false));
  });
  server.on("product.get", [this](const nlohmann::json& p) {
    const auto id = requireString(p, "id");
    auto rows = db_.query("SELECT * FROM products WHERE id = ?", {id}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "product not found");
    return productRowToJson(rows[0], db_);
  });
  server.on("product.create", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "CREATE_PRODUCT");
    auto product = p.contains("product") ? p.at("product") : p;
    if (!product.contains("id")) product["id"] = newId("p");
    if (!product.contains("createdAt")) product["createdAt"] = nowMs();
    db_.begin();
    try {
      auto productFields = product;
      productFields.erase("warehouseStock");
      productFields.erase("stock");
      saveProduct(db_, productFields, true);
      const auto productId = product.at("id").get<std::string>();
      emitProductSync(db_, productId);
      const auto warehouseId = ensurePrimaryWarehouse(db_);
      const auto opening = requestedStock(product, 0);
      if (opening && *opening != 0) {
        applyStockDelta(db_, "STOCKTAKE", productId, warehouseId, *opening, "product", productId,
                        p.value("actorId", "system"), "initial stock", true);
      } else {
        upsertStock(db_, productId, warehouseId, 0);
      }
      audit(db_, p.value("actorId", "system"), "PRODUCT_CREATE", product.at("sku").get<std::string>());
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return productRowToJson(db_.query("SELECT * FROM products WHERE id = ?", {product.at("id").get<std::string>()}, {})[0],
                            db_);
  });
  server.on("product.update", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "EDIT_PRODUCT");
    auto product = p.contains("product") ? p.at("product") : p;
    requireString(product, "id");
    db_.begin();
    try {
      // Stock changes need to pass through applyStockDelta so stocktake locks,
      // movement history and negative-stock rules stay authoritative.
      auto productFields = product;
      productFields.erase("warehouseStock");
      productFields.erase("stock");
      saveProduct(db_, productFields, false);
      const auto productId = product.at("id").get<std::string>();
      emitProductSync(db_, productId);
      const auto warehouseId = ensurePrimaryWarehouse(db_);
      const auto currentStock = getStock(db_, productId, warehouseId);
      if (const auto target = requestedStock(product, currentStock)) {
        const auto delta = *target - currentStock;
        if (delta != 0) {
          applyStockDelta(db_, delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", productId, warehouseId, delta,
                          "product", productId, p.value("actorId", "system"), "product stock update", false);
        }
      }
      audit(db_, p.value("actorId", "system"), "PRODUCT_UPDATE", product.at("sku").get<std::string>());
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return productRowToJson(
        db_.query("SELECT * FROM products WHERE id = ?", {product.at("id").get<std::string>()}, {})[0], db_);
  });
  server.on("product.delete", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "EDIT_PRODUCT");
    const auto id = requireString(p, "id");
    db_.execBound("UPDATE products SET active = 0 WHERE id = ?", {id});
    emitProductSync(db_, id);
    audit(db_, p.value("actorId", "system"), "PRODUCT_DELETE", id);
    return nlohmann::json{{"ok", true}};
  });
  server.on("barcode.resolve", [this](const nlohmann::json& p) {
    std::string barcode = requireString(p, "barcode");
    // Clothing tags are often alphanumeric CODE128: look the code up as
    // scanned first, and only then as digits (EAN, scale barcodes).
    std::string raw = barcode;
    raw.erase(0, raw.find_first_not_of(" \t\r\n"));
    raw.erase(raw.find_last_not_of(" \t\r\n") + 1);
    if (!raw.empty()) {
      auto exact = db_.query(
          "SELECT p.* FROM products p WHERE p.active = 1 AND (p.barcode = ?1 OR p.sku = ?1 OR EXISTS "
          "(SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ?1)) LIMIT 1",
          {raw}, {});
      if (!exact.empty()) return productRowToJson(exact[0], db_);
    }
    barcode.erase(std::remove_if(barcode.begin(), barcode.end(), [](unsigned char c) { return !std::isdigit(c); }),
                  barcode.end());
    auto scaled = resolveScaleBarcode(db_, barcode);
    if (!scaled.is_null()) return scaled;
    auto rows = db_.query("SELECT * FROM products WHERE active = 1 AND barcode = ?", {barcode}, {});
    if (rows.empty()) {
      rows = db_.query(
          "SELECT p.* FROM products p JOIN product_barcodes b ON b.product_id = p.id WHERE p.active = 1 AND "
          "b.barcode = ?",
          {barcode}, {});
    }
    if (rows.empty()) throw PosError("E_NOT_FOUND", "barcode not found");
    return productRowToJson(rows[0], db_);
  });
  server.on("category.list", [this](const nlohmann::json&) {
    return db_.query("SELECT DISTINCT category AS name FROM products WHERE active = 1 ORDER BY category");
  });

  server.on("warehouse.list", [this](const nlohmann::json&) {
    return exportState(db_)["warehouses"];
  });
  server.on("warehouse.create", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "MANAGE_SETTINGS");
    const auto w = p.contains("warehouse") ? p.at("warehouse") : p;
    const std::string id = w.value("id", newId("wh"));
    db_.begin();
    try {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db_.raw(),
                         "INSERT INTO warehouses(id, code, name, address, manager, active) VALUES (?,?,?,?,?,1)", -1,
                         &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, w.at("code").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, w.at("name").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 4, w.value("address", "").c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 5, w.value("manager", "").c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
      // zero stock slots for all products
      auto products = db_.query("SELECT id FROM products");
      for (const auto& pr : products) {
        upsertStock(db_, pr.at("id").get<std::string>(), id, 0);
      }
      audit(db_, p.value("actorId", "system"), "WAREHOUSE_CREATE", w.at("name").get<std::string>());
      emitWarehouseSync(db_, id);
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return exportState(db_)["warehouses"];
  });

  server.on("warehouse.update", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "MANAGE_SETTINGS");
    const auto id = requireString(p, "id");
    const auto name = requireString(p, "name");
    const bool active = p.value("active", true);
    if (!active) {
      auto stock = db_.query("SELECT COALESCE(SUM(qty), 0) AS total FROM stock_levels WHERE warehouse_id = ?", {id}, {});
      if (!stock.empty() && stock[0].at("total").get<std::int64_t>() != 0) {
        throw PosError("E_VALIDATION", "Qalıq olan anbar bağlana bilməz");
      }
    }
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_.raw(), "UPDATE warehouses SET name = ?, active = ? WHERE id = ?", -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 2, active ? 1 : 0);
    sqlite3_bind_text(stmt, 3, id.c_str(), -1, SQLITE_TRANSIENT);
    const int result = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (result != SQLITE_DONE || sqlite3_changes(db_.raw()) != 1) {
      throw PosError("E_NOT_FOUND", "Anbar tapılmadı");
    }
    audit(db_, p.value("actorId", "system"), active ? "WAREHOUSE_RENAME" : "WAREHOUSE_CLOSE", id);
    return exportState(db_)["warehouses"];
  });

  server.on("inventory.getStock", [this](const nlohmann::json& p) {
    return nlohmann::json{{"qty", getStock(db_, requireString(p, "productId"),
                                       normalizeWarehouseId(db_, p.value("warehouseId", std::string{})))}};
  });
  server.on("inventory.movements", [this](const nlohmann::json& p) {
    if (p.contains("productId")) {
      return db_.query(
          "SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC LIMIT 200",
          {requireString(p, "productId")}, {});
    }
    return db_.query("SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 200");
  });
  server.on("inventory.adjust", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "STOCK_ADJUSTMENT");
    const auto productId = requireString(p, "productId");
    const auto warehouseId = normalizeWarehouseId(db_, p.value("warehouseId", std::string{}));
    const auto qtyDelta = requireInt(p, "qtyDelta");
    const std::string portalCommandId = p.value("portalCommandId", "");
    const std::string type = qtyDelta >= 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
    db_.begin();
    try {
      if (portalCommandId.empty() || db_.queryInt(
            "SELECT COUNT(*) FROM stock_movements WHERE ref_type = 'adjust' AND ref_id = ?",
            {portalCommandId}, {}) == 0) {
        applyStockDelta(db_, type, productId, warehouseId, qtyDelta, "adjust",
                        portalCommandId.empty() ? newId("adj") : portalCommandId,
                        p.value("actorId", "system"), p.value("note", ""), false);
      }
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return nlohmann::json{{"qty", getStock(db_, productId, warehouseId)}};
  });
  /**
   * A write-off, with a reason.
   *
   * Not a negative `inventory.adjust`: an adjustment corrects a number that was
   * wrong, a write-off records goods that existed and are now gone. Keeping
   * them apart is what lets an owner ask "what did we throw away this month",
   * which is the question shrinkage is actually found with - and the reason is
   * required, because "-12" with an empty note answers nothing.
   *
   * Negative stock is allowed here whatever the policy says: the goods are
   * already in the bin, and refusing the record does not put them back. It only
   * loses the fact that they went.
   */
  server.on("inventory.waste", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "STOCK_ADJUSTMENT");

    const auto productId = requireString(p, "productId");
    const auto warehouseId = requireString(p, "warehouseId");
    const auto qty = requireInt(p, "qty");
    const auto reason = requireString(p, "reason");
    const std::string portalCommandId = p.value("portalCommandId", "");
    if (qty <= 0) throw PosError("VALIDATION", "Miqdar sıfırdan böyük olmalıdır");
    if (!isKnownWasteReason(reason)) {
      throw PosError("VALIDATION", "Naməlum itki səbəbi: " + reason);
    }

    db_.begin();
    try {
      if (portalCommandId.empty() || db_.queryInt(
            "SELECT COUNT(*) FROM stock_movements WHERE ref_type = 'waste' AND ref_id = ?",
            {portalCommandId}, {}) == 0) {
      const auto refId = portalCommandId.empty() ? newId("waste") : portalCommandId;
      applyStockDelta(db_, "WASTE", productId, warehouseId, -qty, "waste", refId,
                      p.value("actorId", "system"), reason + (p.value("note", "").empty()
                                                                  ? ""
                                                                  : " — " + p.value("note", "")),
                      true);
      writeOffLots(db_, productId, qty, reason == "expired");
      audit(db_, p.value("actorId", "system"), "STOCK_WASTE",
            productId + " x" + std::to_string(qty) + " (" + reason + ")");
      }
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return nlohmann::json{{"qty", getStock(db_, productId, warehouseId)}, {"reason", reason}};
  });

  /** What the write-off screen offers, so the till and the reports agree. */
  server.on("inventory.wasteReasons", [](const nlohmann::json&) {
    nlohmann::json reasons = nlohmann::json::array();
    for (const auto& entry : kWasteReasons) {
      reasons.push_back(nlohmann::json{{"code", entry.code}, {"label", entry.label}});
    }
    return nlohmann::json{{"reasons", reasons}};
  });

  server.on("inventory.transfer", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "TRANSFER_STOCK");
    const auto productId = requireString(p, "productId");
    const auto from = normalizeWarehouseId(db_, p.value("fromWarehouseId", std::string{}));
    const auto to = normalizeWarehouseId(db_, p.value("toWarehouseId", std::string{}));
    const auto qty = requireInt(p, "qty");
    const std::string portalCommandId = p.value("portalCommandId", "");
    if (qty <= 0) throw PosError("E_VALIDATION", "qty must be > 0");
    const std::string ref = portalCommandId.empty() ? newId("xfer") : portalCommandId;
    db_.begin();
    try {
      if (portalCommandId.empty() || db_.queryInt(
            "SELECT COUNT(*) FROM stock_movements WHERE ref_type = 'transfer' AND ref_id = ?",
            {portalCommandId}, {}) == 0) {
      applyStockDelta(db_, "TRANSFER_OUT", productId, from, -qty, "transfer", ref, p.value("actorId", "system"), "",
                      false);
      applyStockDelta(db_, "TRANSFER_IN", productId, to, qty, "transfer", ref, p.value("actorId", "system"), "", true);
      audit(db_, p.value("actorId", "system"), "STOCK_TRANSFER", productId);
      }
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return exportState(db_);
  });

  // Sale draft helpers kept minimal — UI may complete in one shot via sale.complete
  server.on("sale.create", [](const nlohmann::json& p) {
    return nlohmann::json{{"id", p.value("id", newId("draft"))}, {"items", nlohmann::json::array()}, {"discountMinor", 0}};
  });
  server.on("sale.addItem", [](const nlohmann::json& p) { return p; });
  server.on("sale.removeItem", [](const nlohmann::json& p) { return p; });
  server.on("sale.setQuantity", [](const nlohmann::json& p) { return p; });
  server.on("sale.applyDiscount", [](const nlohmann::json& p) { return p; });
  server.on("sale.discardDraft", [](const nlohmann::json&) { return nlohmann::json{{"ok", true}}; });
  server.on("sale.complete", [this](const nlohmann::json& p) { return completeSale(db_, p); });
  server.on("sale.get", [this](const nlohmann::json& p) {
    auto rows = db_.query("SELECT * FROM sales WHERE id = ?", {requireString(p, "id")}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "sale not found");
    return saleToJson(db_, rows[0]);
  });
  server.on("sale.list", [this](const nlohmann::json&) {
    auto rows = db_.query("SELECT * FROM sales ORDER BY created_at DESC LIMIT 500");
    nlohmann::json out = nlohmann::json::array();
    for (const auto& row : rows) out.push_back(saleToJson(db_, row));
    return out;
  });
  server.on("sale.hold", [this](const nlohmann::json& p) {
    const std::string id = p.value("id", newId("hold"));
    const std::string label = p.value("label", "Held");
    const std::string lines = p.at("lines").dump();
    const auto ts = nowMs();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_.raw(),
                       "INSERT INTO held_carts(id, label, created_at, lines_json, cashier_id, register_id, "
                       "discount_minor, customer_name, note, customer_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, label.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, ts);
    sqlite3_bind_text(stmt, 4, lines.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, p.value("cashierId", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 6, p.value("registerId", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 7, p.value("discountMinor", 0));
    if (p.contains("customerName") && p["customerName"].is_string())
      sqlite3_bind_text(stmt, 8, p["customerName"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 8);
    if (p.contains("note") && p["note"].is_string())
      sqlite3_bind_text(stmt, 9, p["note"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 9);
    if (p.contains("customerId") && p["customerId"].is_string())
      sqlite3_bind_text(stmt, 10, p["customerId"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 10);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    audit(db_, p.value("cashierId", "system"), "SALE_HOLD", id);
    return nlohmann::json{{"id", id},
                          {"label", label},
                          {"lines", p.at("lines")},
                          {"createdAt", ts},
                          {"discountMinor", p.value("discountMinor", 0)},
                          {"customerId", p.value("customerId", "")},
                          {"customerName", p.value("customerName", "")},
                          {"note", p.value("note", "")}};
  });
  server.on("sale.resume", [this](const nlohmann::json& p) {
    const auto id = requireString(p, "id");
    auto rows = db_.query("SELECT * FROM held_carts WHERE id = ?", {id}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "held cart not found");
    db_.execBound("DELETE FROM held_carts WHERE id = ?", {id});
    return nlohmann::json{{"id", id},
                          {"label", rows[0].at("label")},
                          {"createdAt", rows[0].at("created_at")},
                          {"lines", nlohmann::json::parse(rows[0].at("lines_json").get<std::string>())},
                          {"discountMinor", rows[0].value("discount_minor", 0)},
                          {"customerId", rows[0].contains("customer_id") && !rows[0]["customer_id"].is_null() ? rows[0]["customer_id"] : nlohmann::json(nullptr)},
                          {"customerName", rows[0].contains("customer_name") && !rows[0]["customer_name"].is_null() ? rows[0]["customer_name"] : nlohmann::json(nullptr)},
                          {"note", rows[0].contains("note") && !rows[0]["note"].is_null() ? rows[0]["note"] : nlohmann::json(nullptr)}};
  });

  server.on("return.create", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "SALE_REFUND");
    const auto saleId = requireString(p, "saleId");
    auto rows = db_.query("SELECT * FROM sales WHERE id = ?", {saleId}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "sale not found");
    if (rows[0].at("refunded").get<std::int64_t>() != 0) throw PosError("E_ALREADY_REFUNDED", "already refunded");
    const std::string wh = rows[0].at("warehouse_id").get<std::string>();
    const std::string actor = p.value("actorId", rows[0].at("cashier_id").get<std::string>());
    db_.begin();
    try {
      auto items = db_.query("SELECT product_id, qty FROM sale_items WHERE sale_id = ?", {saleId}, {});
      for (const auto& it : items) {
        applyStockDelta(db_, "SALE_RETURN", it.at("product_id").get<std::string>(), wh,
                        it.at("qty").get<std::int64_t>(), "sale", saleId, actor, "refund", true);
      }
      db_.execBound("UPDATE sales SET refunded = 1 WHERE id = ?", {saleId});
      audit(db_, actor, "SALE_REFUND", rows[0].at("receipt_no").get<std::string>());
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return saleToJson(db_, db_.query("SELECT * FROM sales WHERE id = ?", {saleId}, {})[0]);
  });

  // purchase.create / purchase.receive / purchase.list live in RetailOps, which
  // registers after this and used to overwrite the copies that stood here. They
  // now route stock through applySharedStockDelta, so the sync event is emitted.

  server.on("cash.listRegisters", [this](const nlohmann::json&) { return exportState(db_)["registers"]; });
  server.on("cash.bindDeviceRegister", [this](const nlohmann::json& p) {
    const auto name = requireString(p, "name");
    const auto operatorId = p.value("operatorId", "system");
    const auto updatedAt = p.value("updatedAt", nowMs());
    auto deviceRegisterId = db_.queryText("SELECT value FROM settings WHERE key='deviceRegisterId'");
    auto rows = deviceRegisterId.empty()
                    ? nlohmann::json::array()
                    : db_.query("SELECT id FROM registers WHERE id=? LIMIT 1", {deviceRegisterId}, {});
    if (rows.empty()) {
      deviceRegisterId = db_.queryText("SELECT value FROM settings WHERE key='defaultRegisterId'");
      rows = deviceRegisterId.empty()
                 ? nlohmann::json::array()
                 : db_.query("SELECT id FROM registers WHERE id=? LIMIT 1", {deviceRegisterId}, {});
    }
    if (rows.empty()) {
      rows = db_.query("SELECT id FROM registers ORDER BY rowid LIMIT 1");
      deviceRegisterId = rows.empty() ? newId("reg") : rows[0].at("id").get<std::string>();
    }

    db_.begin();
    try {
      sqlite3_stmt* stmt = nullptr;
      if (rows.empty()) {
        sqlite3_prepare_v2(db_.raw(),
                           "INSERT INTO registers(id, code, name, location, status, opening_float_minor) "
                           "VALUES (?, 'POS-01', ?, '', 'closed', 0)",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, deviceRegisterId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, name.c_str(), -1, SQLITE_TRANSIENT);
      } else {
        sqlite3_prepare_v2(db_.raw(), "UPDATE registers SET name=? WHERE id=?", -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, deviceRegisterId.c_str(), -1, SQLITE_TRANSIENT);
      }
      if (sqlite3_step(stmt) != SQLITE_DONE) {
        sqlite3_finalize(stmt);
        throw PosError("E_DATABASE", "device register could not be saved");
      }
      sqlite3_finalize(stmt);

      const std::array<std::pair<std::string, std::string>, 4> settings = {{
          {"deviceRegisterId", deviceRegisterId},
          {"defaultRegisterId", deviceRegisterId},
          {"terminalName", name},
          {"terminalNameUpdatedAt", std::to_string(updatedAt)},
      }};
      for (const auto& [key, value] : settings) {
        sqlite3_prepare_v2(db_.raw(),
                           "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }
      audit(db_, operatorId, "DEVICE_REGISTER_BIND", deviceRegisterId + " · " + name);
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    const auto fresh = exportState(db_);
    auto registerRows = fresh.at("registers");
    auto bound = registerRows.front();
    for (const auto& row : registerRows) {
      if (row.at("id").get<std::string>() == deviceRegisterId) bound = row;
    }
    return nlohmann::json{{"register", bound}, {"settings", fresh.at("settings")}};
  });
  server.on("cash.createRegister", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "MANAGE_SETTINGS");
    auto r = p.contains("register") ? p.at("register") : p;
    const std::string id = r.value("id", newId("reg"));
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db_.raw(),
                       "INSERT INTO registers(id, code, name, location, status, opening_float_minor) VALUES "
                       "(?,?,?,?, 'closed', ?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, r.at("code").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, r.at("name").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, r.value("location", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 5, r.value("openingFloatMinor", 0));
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return exportState(db_)["registers"];
  });
  server.on("cash.openSession", [this](const nlohmann::json& p) {
    const auto registerId = requireString(p, "registerId");
    const auto operatorId = requireString(p, "operatorId");
    const auto openingFloat = p.value("openingFloatMinor", static_cast<std::int64_t>(0));
    auto openRows = db_.query(
        "SELECT * FROM cash_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
        {registerId}, {});
    if (!openRows.empty()) {
      const auto sessionId = openRows[0].at("id").get<std::string>();
      const auto previousOperator = openRows[0].at("operator_id").get<std::string>();
      if (previousOperator != operatorId) {
        db_.begin();
        try {
          sqlite3_stmt* stmt = nullptr;
          sqlite3_prepare_v2(db_.raw(), "UPDATE cash_sessions SET operator_id=? WHERE id=?", -1, &stmt, nullptr);
          sqlite3_bind_text(stmt, 1, operatorId.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_bind_text(stmt, 2, sessionId.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_step(stmt);
          sqlite3_finalize(stmt);
          sqlite3_prepare_v2(db_.raw(), "UPDATE registers SET status='open', operator_id=? WHERE id=?", -1,
                             &stmt, nullptr);
          sqlite3_bind_text(stmt, 1, operatorId.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_bind_text(stmt, 2, registerId.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_step(stmt);
          sqlite3_finalize(stmt);
          audit(db_, operatorId, "REGISTER_OPERATOR_CHANGE", registerId + " from " + previousOperator);
          db_.commit();
        } catch (...) {
          db_.rollback();
          throw;
        }
      }
      return nlohmann::json{{"sessionId", sessionId},
                            {"registerId", registerId},
                            {"status", "open"},
                            {"reused", true}};
    }
    const auto openedAt = nowMs();
    const std::string sessionId = newId("cs");
    db_.begin();
    try {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db_.raw(),
                         "INSERT INTO cash_sessions(id, register_id, opened_at, operator_id, opening_float_minor, "
                         "status) VALUES (?,?,?,?,?,'open')",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, sessionId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, registerId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 3, openedAt);
      sqlite3_bind_text(stmt, 4, operatorId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 5, openingFloat);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
      sqlite3_prepare_v2(db_.raw(),
                         "UPDATE registers SET status='open', operator_id=?, opening_float_minor=?, opened_at=? WHERE "
                         "id=?",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, operatorId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 2, openingFloat);
      sqlite3_bind_int64(stmt, 3, openedAt);
      sqlite3_bind_text(stmt, 4, registerId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
      audit(db_, operatorId, "REGISTER_OPEN", registerId);
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return nlohmann::json{{"sessionId", sessionId}, {"registerId", registerId}, {"status", "open"}};
  });
  server.on("cash.closeSession", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "CLOSE_SHIFT");
    const auto registerId = requireString(p, "registerId");
    const auto operatorId = p.value("operatorId", "system");
    db_.begin();
    try {
      db_.exec("UPDATE cash_sessions SET status='closed', closed_at=" + std::to_string(nowMs()) +
               " WHERE register_id='" + registerId + "' AND status='open';");
      db_.execBound("UPDATE registers SET status='closed', operator_id=NULL, opened_at=NULL WHERE id = ?", {registerId});
      audit(db_, operatorId, "REGISTER_CLOSE", registerId);
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return nlohmann::json{{"registerId", registerId}, {"status", "closed"}};
  });
  server.on("cash.currentSession", [this](const nlohmann::json& p) {
    const auto registerId = requireString(p, "registerId");
    auto rows = db_.query(
        "SELECT * FROM cash_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
        {registerId}, {});
    if (rows.empty()) return nlohmann::json{{"open", false}};
    return nlohmann::json{{"open", true}, {"session", rows[0]}};
  });

  server.on("report.dailySales", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "VIEW_REPORTS");
    const auto from = p.value("fromMs", nowMs() - 86400000);
    const auto to = p.value("toMs", nowMs());
    auto rows = db_.query(
        "SELECT COUNT(*) AS salesCount, COALESCE(SUM(total_minor),0) AS revenueMinor, "
        "COALESCE(SUM(CASE WHEN refunded=0 THEN total_minor ELSE 0 END),0) AS netMinor "
        "FROM sales WHERE created_at >= ? AND created_at <= ?",
        {}, {from, to});
    return rows.empty() ? nlohmann::json::object() : rows[0];
  });
  server.on("report.inventory", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "VIEW_REPORTS");
    return db_.query(
        "SELECT p.id AS productId, p.sku, p.name_az AS name, sl.warehouse_id AS warehouseId, sl.qty, p.min_stock AS "
        "minStock "
        "FROM stock_levels sl JOIN products p ON p.id = sl.product_id ORDER BY p.name_az");
  });
  server.on("report.topProducts", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "VIEW_REPORTS");
    const auto limit = p.value("limit", static_cast<std::int64_t>(10));
    return db_.query(
        "SELECT si.product_id AS productId, SUM(si.qty) AS qty, SUM(si.line_total_minor) AS revenueMinor "
        "FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.refunded = 0 "
        "GROUP BY si.product_id ORDER BY qty DESC LIMIT " +
        std::to_string(limit));
  });

  server.on("settings.get", [this](const nlohmann::json&) { return exportState(db_)["settings"]; });
  server.on("settings.set", [this](const nlohmann::json& p) {
    requirePermission(db_, p, "MANAGE_SETTINGS");
    const auto settings = p.contains("settings") ? p.at("settings") : p;
    db_.begin();
    try {
      for (auto it = settings.begin(); it != settings.end(); ++it) {
        const std::string key = it.key();
        const std::string value = it.value().is_string() ? it.value().get<std::string>() : it.value().dump();
        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(db_.raw(),
                           "INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET "
                           "value=excluded.value",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, key.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, value.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }
      audit(db_, p.value("actorId", "system"), "SETTINGS_SAVE", "settings");
      db_.commit();
    } catch (...) {
      db_.rollback();
      throw;
    }
    return exportState(db_)["settings"];
  });

  server.on("audit.list", [this](const nlohmann::json&) { return exportState(db_)["audits"]; });
  server.on("audit.append", [this](const nlohmann::json& p) {
    audit(db_, requireString(p, "actorId"), requireString(p, "action"), p.value("detail", ""));
    return nlohmann::json{{"ok", true}};
  });

  registerRetailHandlers(server, db_);
  // Printing talks to hardware (setupapi, winspool, raw device handles, a
  // socket sweep), so it lives in the core rather than in Electron, where the
  // only sink that ever existed wrote the receipt to a file.
  printing::registerPrinterHandlers(server, db_);

  // Every method that changes what a screen shows. `sync.apply` is the one that
  // carries another till's edits, so it is what makes a price typed on register
  // 1 appear on register 2 without anyone refreshing.
  for (const char* method : {"product.create", "product.update", "product.delete",
                             "product.importCommit", "shelf.save", "shelf.delete"}) {
    server.markMutating(method, "catalog");
  }
  for (const char* method : {"inventory.adjust", "inventory.transfer", "purchase.create",
                             "purchase.update", "purchase.receive", "purchase.returnPartial",
                             "stocktake.create", "stocktake.updateLine", "stocktake.setStatus",
                             "stocktake.post", "lot.receive"}) {
    server.markMutating(method, "stock");
  }
  for (const char* method : {"sale.complete", "return.create", "return.partial", "sale.hold",
                             "sale.resume", "sale.cancelHeld", "sale.overridePrice"}) {
    server.markMutating(method, "sales");
  }
  for (const char* method : {"cash.open", "cash.close", "cash.zClose", "cash.bindDeviceRegister",
                             "register.create", "register.update"}) {
    server.markMutating(method, "cash");
  }
  for (const char* method : {"settings.set", "settings.setValue", "warehouse.create",
                             "customer.create", "customer.update", "staff.save"}) {
    server.markMutating(method, "settings");
  }
  server.markMutating("sync.apply", "sync");
  server.markMutating("state.importLegacy", "catalog");

  // The lists above name some methods as 1.4 planned them (cash.open,
  // register.create, staff.save); the handlers that exist are these. Without
  // them opening a shift or paying a debt on one till never refreshed another.
  for (const char* method : {"cash.openSession", "cash.closeSession", "cash.createRegister",
                             "cash.cashIn", "cash.cashOut", "cash.safeDrop", "treasury.transfer"}) {
    server.markMutating(method, "cash");
  }
  for (const char* method : {"customer.payDebt", "supplier.pay", "warehouse.update", "auth.saveRole",
                             "auth.deleteRole", "auth.setOverride", "roles.applyPolicy"}) {
    server.markMutating(method, "settings");
  }
  // Added after 1.4: waste reasons, delivery and recipes change what screens show too.
  server.markMutating("inventory.waste", "stock");
  for (const char* method : {"delivery.create", "delivery.assign", "delivery.setStatus"}) {
    server.markMutating(method, "sales");
  }
  server.markMutating("recipe.save", "catalog");
}

int Application::run() {
  server_ = std::make_unique<ipc::StdioServer>();
  registerHandlers(*server_);
  server_->emitEvent("core.stage", {{"stage", "ready"}});
  server_->emitEvent("core.ready", {{"protocolVersion", protocol::kVersion}, {"version", MARKET_CORE_VERSION}});
  return server_->run();
}

}  // namespace market
