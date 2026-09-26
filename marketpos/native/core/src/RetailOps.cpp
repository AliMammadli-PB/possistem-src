#include "market/RetailOps.hpp"
#include "market/Error.hpp"
#include "market/Warehouse.hpp"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <random>
#include <sstream>
#include <sqlite3.h>

namespace market {
using db::columnOr;
namespace {

/**
 * The one shape the renderer's CustomerSummary type expects: camelCase aliases
 * plus the derived debt balance and bonus balance. Shared by customer.list and
 * customer.summary so the two can never drift into different field names again.
 */
constexpr const char* CUSTOMER_PROJECTION_SQL =
    "SELECT c.id, c.name, c.phone, c.loyalty_card AS loyaltyCard, "
    "c.credit_allowed AS creditAllowed, c.credit_limit_minor AS creditLimitMinor, "
    "COALESCE((SELECT balance_after_minor FROM customer_ledger l WHERE l.customer_id=c.id "
    "ORDER BY created_at DESC LIMIT 1),0) AS balanceMinor, "
    "COALESCE((SELECT points_after FROM loyalty_ledger y WHERE y.customer_id=c.id "
    "ORDER BY created_at DESC, rowid DESC LIMIT 1),0) AS loyaltyMinor "
    "FROM customers c WHERE c.active=1";

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

void audit(db::Database& db, const std::string& actorId, const std::string& action, const std::string& detail) {
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO audit_logs(id, created_at, actor_id, action, detail) VALUES (?,?,?,?,?)", -1, &stmt,
                     nullptr);
  const std::string id = newId("audit");
  sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 2, nowMs());
  sqlite3_bind_text(stmt, 3, actorId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 4, action.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 5, detail.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
}

std::string settingRaw(db::Database& db, const std::string& key, const std::string& fallback) {
  auto v = db.queryText("SELECT value FROM settings WHERE key = ?", {key}, {});
  return v.empty() ? fallback : v;
}

nlohmann::json settingJson(db::Database& db, const std::string& key, const nlohmann::json& fallback) {
  const auto raw = settingRaw(db, key, "");
  if (raw.empty()) return fallback;
  try {
    return nlohmann::json::parse(raw);
  } catch (...) {
    return fallback;
  }
}

std::int64_t getStock(db::Database& db, const std::string& productId, const std::string& warehouseId) {
  return db.queryInt("SELECT COALESCE(qty,0) FROM stock_levels WHERE product_id = ? AND warehouse_id = ?",
                     {productId, warehouseId}, {});
}

/**
 * Delegates to the one canonical stock path. This used to be a parallel
 * implementation that applied the same policy but never emitted a sync event, so
 * goods receiving, stocktakes, returns and lot receipts never reached the other
 * tills.
 */
void applyStockPolicy(db::Database& db, const std::string& type, const std::string& productId,
                      const std::string& warehouseId, std::int64_t qtyDelta, const std::string& refType,
                      const std::string& refId, const std::string& actorId, const std::string& note) {
  applySharedStockDelta(db, type, productId, warehouseId, qtyDelta, refType, refId, actorId, note);
}

nlohmann::json openSessionRow(db::Database& db, const std::string& registerId) {
  auto rows = db.query(
      "SELECT * FROM cash_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      {registerId}, {});
  if (rows.empty()) throw PosError("REGISTER_CLOSED", "No open cash session");
  return rows[0];
}

nlohmann::json buildSessionReport(db::Database& db, const nlohmann::json& session) {
  const std::string sessionId = session.at("id").get<std::string>();
  const std::string registerId = session.at("register_id").get<std::string>();
  const std::int64_t openedAt = session.at("opened_at").get<std::int64_t>();
  const std::int64_t closedBound = session.contains("closed_at") && !session["closed_at"].is_null()
                                    ? session["closed_at"].get<std::int64_t>()
                                    : nowMs();
  const std::int64_t opening = session.at("opening_float_minor").get<std::int64_t>();

  auto sales = db.query(
      "SELECT * FROM sales WHERE register_id = ? AND created_at >= ? AND created_at <= ?", {registerId},
      {openedAt, closedBound});
  std::int64_t gross = 0, net = 0, cashSales = 0, cardSales = 0, discounts = 0, refunds = 0;
  std::int64_t txCount = 0, canceled = 0;
  for (const auto& s : sales) {
    const bool refunded = s.at("refunded").get<std::int64_t>() != 0;
    const auto total = s.at("total_minor").get<std::int64_t>();
    const auto disc = s.at("discount_minor").get<std::int64_t>();
    const auto method = s.at("payment_method").get<std::string>();
    const auto cash = columnOr<std::int64_t>(s, "cash_minor", method == "cash" ? total : 0);
    const auto card = columnOr<std::int64_t>(s, "card_minor", method == "card" ? total : 0);
    gross += total;
    discounts += disc;
    ++txCount;
    if (refunded) {
      refunds += total;
      // The cash give-back is NOT deducted here any more. Refunds now post a
      // `cash_out` movement at refund time (recordRefundCashOut), which the
      // movement loop below subtracts. Deducting in both places would
      // double-count a same-session refund.
      //
      // ponytail: `refunds` is still flag-based, so this figure counts only
      // fully returned sales; partial refunds are missing from it (the drawer
      // math is correct either way). Sum refund_lines by refund time if the
      // reported refund total needs to be exact too.
    } else {
      net += total;
      if (method == "cash" || method == "mixed") cashSales += cash;
      if (method == "card" || method == "mixed") cardSales += card;
    }
  }

  auto moves = db.query("SELECT * FROM cash_movements WHERE session_id = ?", {sessionId}, {});
  std::int64_t cashIn = 0, cashOut = 0, safeDrop = 0;
  for (const auto& m : moves) {
    const auto amt = m.at("amount_minor").get<std::int64_t>();
    const auto type = m.at("type").get<std::string>();
    if (type == "cash_in") cashIn += amt;
    else if (type == "cash_out") cashOut += amt;
    else if (type == "safe_drop") safeDrop += amt;
  }

  // expected = opening + cash sales + cashIn - cashOut - safeDrop
  // Refunds arrive through cashOut (a `cash_out` movement written at refund
  // time), so they are counted here exactly once, in the session that actually
  // paid the money out.
  const std::int64_t expected = opening + cashSales + cashIn - cashOut - safeDrop;

  return {
      {"sessionId", sessionId},
      {"registerId", registerId},
      {"operatorId", session.at("operator_id")},
      {"openedAt", openedAt},
      {"closedAt", closedBound},
      {"openingFloatMinor", opening},
      {"grossSalesMinor", gross},
      {"netSalesMinor", net},
      {"cashSalesMinor", cashSales},
      {"cardSalesMinor", cardSales},
      {"discountsMinor", discounts},
      {"refundsMinor", refunds},
      {"canceledSales", canceled},
      {"cashInMinor", cashIn},
      {"cashOutMinor", cashOut},
      {"safeDropMinor", safeDrop},
      {"expectedCashMinor", expected},
      {"transactionCount", txCount},
  };
}

nlohmann::json insertCashMovement(db::Database& db, const nlohmann::json& p, const std::string& type,
                                  const std::string& permission) {
  requirePermission(db, p, permission);
  const auto registerId = requireString(p, "registerId");
  const auto session = openSessionRow(db, registerId);
  const auto amount = requireInt(p, "amountMinor");
  if (amount <= 0) throw PosError("E_VALIDATION", "amount must be > 0");
  const std::string actor = p.value("actorId", "system");
  const std::string portalCommandId = p.value("portalCommandId", "");
  const std::string id = portalCommandId.empty() ? newId("cm") : "cm-" + portalCommandId;
  if (!portalCommandId.empty()) {
    const auto existing = db.query("SELECT type, register_id, amount_minor FROM cash_movements WHERE id = ?", {id}, {});
    if (!existing.empty()) {
      if (existing[0].at("type") != type || existing[0].at("register_id") != registerId ||
          existing[0].at("amount_minor") != amount) {
        throw PosError("E_CONFLICT", "Portal command id was reused with different cash movement");
      }
      return {{"id", id}, {"type", type}, {"amountMinor", amount}, {"idempotentReplay", true}};
    }
  }
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO cash_movements(id, session_id, register_id, type, amount_minor, reason, actor_id, "
                     "approver_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     -1, &stmt, nullptr);
  sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 2, session.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 3, registerId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 4, type.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 5, amount);
  sqlite3_bind_text(stmt, 6, p.value("reason", "").c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 7, actor.c_str(), -1, SQLITE_TRANSIENT);
  if (p.contains("approverId") && p["approverId"].is_string())
    sqlite3_bind_text(stmt, 8, p["approverId"].get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
  else
    sqlite3_bind_null(stmt, 8);
  sqlite3_bind_int64(stmt, 9, nowMs());
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
  audit(db, actor, type == "cash_in" ? "CASH_IN" : type == "cash_out" ? "CASH_OUT" : "SAFE_DROP",
        std::to_string(amount));
  return {{"id", id}, {"type", type}, {"amountMinor", amount}};
}

int ean13Checksum(const std::string& digits12) {
  int sum = 0;
  for (std::size_t i = 0; i < 12; ++i) {
    const int d = digits12[i] - '0';
    sum += (i % 2 == 0) ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

}  // namespace

std::string stockPolicyOf(db::Database& db) {
  auto j = settingJson(db, "stockPolicy", "BLOCK_NEGATIVE_STOCK");
  if (j.is_string()) return j.get<std::string>();
  return "BLOCK_NEGATIVE_STOCK";
}

void recordRefundCashOut(db::Database& db, const nlohmann::json& sale, std::int64_t refundTotalMinor,
                         const std::string& refundRef, const std::string& actorId) {
  if (refundTotalMinor <= 0) return;

  const auto saleTotal = columnOr<std::int64_t>(sale, "total_minor", 0);
  if (saleTotal <= 0) return;
  const auto method = columnOr<std::string>(sale, "payment_method", "");
  // cash_minor is absent on older rows, where the method alone carried it.
  const auto saleCash = columnOr<std::int64_t>(sale, "cash_minor", method == "cash" ? saleTotal : 0);
  if (saleCash <= 0) return;

  // Cash share of this refund, rounded half-up so a part-cash sale refunded in
  // slices does not lose a qəpik per slice.
  const auto capped = std::min(refundTotalMinor, saleTotal);
  const auto cashShare = (capped * saleCash + saleTotal / 2) / saleTotal;
  if (cashShare <= 0) return;

  const auto registerId = columnOr<std::string>(sale, "register_id", "");
  if (registerId.empty()) return;
  // Cash sessions are optional in this product — a sale completes without one —
  // so a missing session must not fail the refund. With no session there is
  // also nothing to reconcile: buildSessionReport only ever reports per session.
  auto sessions = db.query(
      "SELECT id FROM cash_sessions WHERE register_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1",
      {registerId}, {});
  if (sessions.empty()) return;
  const auto& session = sessions[0];

  const std::string id = newId("cm");
  sqlite3_stmt* stmt = nullptr;
  sqlite3_prepare_v2(db.raw(),
                     "INSERT INTO cash_movements(id, session_id, register_id, type, amount_minor, reason, "
                     "actor_id, approver_id, created_at) VALUES (?,?,?,'cash_out',?,?,?,NULL,?)",
                     -1, &stmt, nullptr);
  sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
  const auto sessionId = session.at("id").get<std::string>();
  sqlite3_bind_text(stmt, 2, sessionId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 3, registerId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 4, cashShare);
  const std::string reason = "refund:" + refundRef;
  sqlite3_bind_text(stmt, 5, reason.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_text(stmt, 6, actorId.c_str(), -1, SQLITE_TRANSIENT);
  sqlite3_bind_int64(stmt, 7, nowMs());
  sqlite3_step(stmt);
  sqlite3_finalize(stmt);
}

bool roleHasPermission(db::Database& db, const std::string& role, const std::string& permission) {
  return db.queryInt("SELECT COUNT(*) FROM role_permissions WHERE role = ? AND permission = ?", {role, permission},
                     {}) > 0;
}

bool actorHasPermission(db::Database& db, const std::string& actorId, const std::string& role,
                        const std::string& permission) {
  if (!actorId.empty()) {
    auto rows = db.query("SELECT allowed FROM employee_permission_overrides WHERE employee_id = ? AND permission = ?",
                         {actorId, permission}, {});
    if (!rows.empty()) return rows[0].at("allowed").get<std::int64_t>() != 0;
  }
  return roleHasPermission(db, role, permission);
}

void requirePermission(db::Database& db, const nlohmann::json& payload, const std::string& permission) {
  const std::string role = payload.value("role", "");
  if (role.empty()) {
    // Back-compat: allow if actor is system/manager-like when role omitted
    if (payload.value("actorId", "") == "system") return;
    throw PosError("PERMISSION_DENIED", "role required for " + permission);
  }
  if (actorHasPermission(db, payload.value("actorId", ""), role, permission)) return;


  // A manager override. `approverId` is only ever set by the Electron layer,
  // after it has matched a manager's PIN against its staff store - the renderer
  // cannot set it, because main strips the field from every payload it forwards
  // (see electron/core-payload.cjs). Staff do not live in this database, so
  // this layer cannot re-check the identity; it checks that one was asserted by
  // the only party allowed to assert it.
  if (payload.contains("approverId") && payload["approverId"].is_string() &&
      !payload["approverId"].get<std::string>().empty()) {
    audit(db, payload.value("actorId", ""), "MANAGER_APPROVAL",
          permission + " by " + payload["approverId"].get<std::string>());
    return;
  }
  throw PosError("MANAGER_APPROVAL_REQUIRED", "Permission " + permission + " requires manager approval", false,
                 nlohmann::json{{"permission", permission}});
}

nlohmann::json resolveScaleBarcode(db::Database& db, const std::string& barcodeIn) {
  std::string barcode = barcodeIn;
  barcode.erase(std::remove_if(barcode.begin(), barcode.end(), [](unsigned char c) { return !std::isdigit(c); }),
                barcode.end());
  if (barcode.size() != 13) return nullptr;

  const auto rules = settingJson(db, "scaleBarcodeRules", nlohmann::json::array());
  if (!rules.is_array()) return nullptr;

  for (const auto& rule : rules) {
    const std::string prefix = rule.value("prefix", "");
    if (barcode.compare(0, prefix.size(), prefix) != 0) continue;
    const int pluStart = rule.value("pluStart", 2);
    const int pluLen = rule.value("pluLen", 5);
    const int valueStart = rule.value("valueStart", 7);
    const int valueLen = rule.value("valueLen", 5);
    const int decimals = rule.value("decimals", 3);
    const std::string mode = rule.value("mode", "WEIGHT");
    if (pluStart + pluLen > 12 || valueStart + valueLen > 12) continue;
    if (rule.value("checkChecksum", true)) {
      if (ean13Checksum(barcode.substr(0, 12)) != (barcode[12] - '0')) {
        throw PosError("SCALE_BARCODE_INVALID", "EAN-13 checksum failed");
      }
    }
    const std::string plu = barcode.substr(static_cast<std::size_t>(pluStart), static_cast<std::size_t>(pluLen));
    const std::string valueDigits =
        barcode.substr(static_cast<std::size_t>(valueStart), static_cast<std::size_t>(valueLen));
    std::int64_t raw = 0;
    try {
      raw = std::stoll(valueDigits);
    } catch (...) {
      throw PosError("SCALE_BARCODE_INVALID", "bad value digits");
    }
    std::int64_t scale = 1;
    for (int i = 0; i < decimals; ++i) scale *= 10;
    // qtyMilli: thousandths of unit (kg → grams-like), or priceMinor when PRICE mode
    nlohmann::json product;
    auto byPlu = db.query("SELECT * FROM products WHERE active = 1 AND plu = ?", {plu}, {});
    if (byPlu.empty()) {
      // try barcode = prefix+plu padded
      auto byBarcode = db.query("SELECT * FROM products WHERE active = 1 AND barcode = ?", {plu}, {});
      if (byBarcode.empty()) {
        byBarcode = db.query("SELECT * FROM products WHERE active = 1 AND barcode LIKE ?", {"%" + plu}, {});
      }
      if (byBarcode.empty()) throw PosError("E_NOT_FOUND", "PLU not found: " + plu);
      product = byBarcode[0];
    } else {
      product = byPlu[0];
    }

    nlohmann::json out = {{"scale", true},
                          {"mode", mode},
                          {"plu", plu},
                          {"productId", product.at("id")},
                          {"sku", product.at("sku")},
                          {"barcode", product.at("barcode")},
                          {"name",
                           {{"az", product.at("name_az")},
                            {"ru", product.value("name_ru", "")},
                            {"en", product.value("name_en", "")}}},
                          {"unit", product.at("unit")},
                          {"priceMinor", product.at("price_minor")},
                          {"costMinor", product.at("cost_minor")},
                          {"category", product.at("category")}};
    if (mode == "PRICE") {
      out["embeddedPriceMinor"] = raw;
      // qty 1 piece with embedded price
      out["qty"] = 1;
      out["unitPriceMinor"] = raw;
    } else {
      // WEIGHT: raw / scale = kg; express qty as milli-units (×1000)
      out["qtyMilli"] = (raw * 1000) / scale;
      out["qty"] = 1;  // UI uses qtyMilli when present
      const auto unitPrice = product.at("price_minor").get<std::int64_t>();
      out["lineTotalMinor"] = (unitPrice * raw) / scale;
    }
    return out;
  }
  return nullptr;
}

void registerRetailHandlers(ipc::StdioServer& server, db::Database& db) {
  server.on("auth.checkPermission", [&db](const nlohmann::json& p) {
    const auto role = requireString(p, "role");
    const auto permission = requireString(p, "permission");
    return nlohmann::json{{"allowed", actorHasPermission(db, p.value("actorId", ""), role, permission)}};
  });
  server.on("auth.listPermissions", [&db](const nlohmann::json& p) {
    const auto role = requireString(p, "role");
    return db.query("SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission", {role}, {});
  });
  // ------------------------------------------------------------------ roles
  //
  // Roles were three names baked into the seed and a grant could only be changed
  // by editing SQL, so "let this cashier refund" had no answer inside the
  // product. These four methods are the whole story.

  // --------------------------------------------------------------- delivery
  //
  // A delivery is a sale with a destination and a courier, not a different kind
  // of sale: it points at the sale so revenue and stock stay in one place.

  server.on("courier.list", [&db](const nlohmann::json&) {
    return db.query(
        "SELECT c.id, c.name, c.phone, c.vehicle, "
        "       (SELECT COUNT(*) FROM delivery_orders d WHERE d.courier_id = c.id "
        "          AND d.status IN ('assigned','picked_up')) AS openCount "
        "FROM couriers c WHERE c.active = 1 ORDER BY c.name",
        {}, {});
  });

  server.on("courier.save", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "DELIVERY_MANAGE");
    const auto name = requireString(p, "name");
    const std::string id = p.value("id", "").empty() ? newId("cur") : p.value("id", "");

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO couriers(id, name, phone, vehicle, created_at) "
                       "VALUES (?,?,?,?,?) "
                       "ON CONFLICT(id) DO UPDATE SET name = excluded.name, "
                       "  phone = excluded.phone, vehicle = excluded.vehicle",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, name.c_str(), -1, SQLITE_TRANSIENT);
    const std::string phone = p.value("phone", "");
    const std::string vehicle = p.value("vehicle", "");
    sqlite3_bind_text(stmt, 3, phone.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, vehicle.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 5, nowMs());
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    audit(db, p.value("actorId", ""), "COURIER_SAVE", name);
    return nlohmann::json{{"id", id}, {"name", name}};
  });

  server.on("delivery.list", [&db](const nlohmann::json& p) {
    const std::string status = p.value("status", "");
    // Parenthesised: an empty filter must mean "all", not "every row joined to
    // the last branch".
    return db.query(
        "SELECT d.id, d.sale_id AS saleId, d.customer_id AS customerId, "
        "       d.courier_id AS courierId, c.name AS courierName, d.address, d.phone, "
        "       d.note, d.fee_minor AS feeMinor, d.status, d.created_at AS createdAt "
        "FROM delivery_orders d LEFT JOIN couriers c ON c.id = d.courier_id "
        "WHERE (? = '' OR d.status = ?) ORDER BY d.created_at DESC LIMIT 200",
        {status, status}, {});
  });

  server.on("delivery.create", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "DELIVERY_MANAGE");
    const auto saleId = requireString(p, "saleId");
    const auto address = requireString(p, "address");
    const std::int64_t fee = p.value("feeMinor", 0);
    if (fee < 0) throw PosError("VALIDATION", "Çatdırılma haqqı mənfi ola bilməz");

    const std::string id = newId("del");
    const auto now = nowMs();

    // UNIQUE on sale_id: one sale is one delivery, so a double tap cannot put
    // the same basket on two couriers' lists.
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO delivery_orders(id, sale_id, customer_id, address, phone, "
                       "  note, fee_minor, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                       -1, &stmt, nullptr);
    const std::string customerId = p.value("customerId", "");
    const std::string phone = p.value("phone", "");
    const std::string note = p.value("note", "");
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, saleId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, customerId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, address.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, phone.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 6, note.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 7, fee);
    sqlite3_bind_int64(stmt, 8, now);
    sqlite3_bind_int64(stmt, 9, now);
    if (sqlite3_step(stmt) != SQLITE_DONE) {
      sqlite3_finalize(stmt);
      throw PosError("VALIDATION", "Bu satış üçün çatdırılma artıq var");
    }
    sqlite3_finalize(stmt);

    audit(db, p.value("actorId", ""), "DELIVERY_CREATE", saleId);
    return nlohmann::json{{"id", id}, {"saleId", saleId}, {"status", "pending"}};
  });

  server.on("delivery.assign", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "DELIVERY_ASSIGN");
    const auto id = requireString(p, "deliveryId");
    const auto courierId = requireString(p, "courierId");

    if (db.queryInt("SELECT COUNT(*) FROM couriers WHERE id = ? AND active = 1", {courierId},
                    {}) == 0) {
      throw PosError("NOT_FOUND", "Kuryer tapılmadı");
    }

    // A delivered one is history, not a work item.
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "UPDATE delivery_orders SET courier_id = ?, status = 'assigned', "
                       "  assigned_at = ?, updated_at = ? "
                       "WHERE id = ? AND status IN ('pending','assigned','picked_up')",
                       -1, &stmt, nullptr);
    const auto now = nowMs();
    sqlite3_bind_text(stmt, 1, courierId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, now);
    sqlite3_bind_int64(stmt, 3, now);
    sqlite3_bind_text(stmt, 4, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (db.changes() != 1) throw PosError("VALIDATION", "Çatdırılma tapılmadı və ya bağlanıb");

    audit(db, p.value("actorId", ""), "DELIVERY_ASSIGN", id + " -> " + courierId);
    return nlohmann::json{{"id", id}, {"courierId", courierId}, {"status", "assigned"}};
  });

  server.on("delivery.setStatus", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "DELIVERY_ASSIGN");
    const auto id = requireString(p, "deliveryId");
    const auto status = requireString(p, "status");
    if (status != "picked_up" && status != "delivered" && status != "failed" &&
        status != "cancelled") {
      throw PosError("VALIDATION", "Status tanınmadı");
    }

    const auto was = db.queryText("SELECT status FROM delivery_orders WHERE id = ?", {id}, {});
    if (was.empty()) throw PosError("NOT_FOUND", "Çatdırılma tapılmadı");
    if (was == "delivered" || was == "cancelled") {
      throw PosError("VALIDATION", "Bu çatdırılma artıq bağlanıb");
    }
    const auto courierId =
        db.queryText("SELECT COALESCE(courier_id, '') FROM delivery_orders WHERE id = ?", {id}, {});
    // Goods cannot be picked up by nobody.
    if (status == "picked_up" && courierId.empty()) {
      throw PosError("VALIDATION", "Əvvəlcə kuryer təyin edin");
    }

    const auto now = nowMs();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "UPDATE delivery_orders SET status = ?, updated_at = ?, "
                       "  delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END "
                       "WHERE id = ?",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, status.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, now);
    sqlite3_bind_text(stmt, 3, status.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 4, now);
    sqlite3_bind_text(stmt, 5, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    audit(db, p.value("actorId", ""), "DELIVERY_STATUS", id + " " + status);
    return nlohmann::json{{"id", id}, {"status", status}};
  });

  server.on("delivery.courierReport", [&db](const nlohmann::json& p) {
    const std::int64_t from = p.value("fromMs", nowMs() - 86400000LL);
    const std::int64_t to = p.value("toMs", nowMs());
    return db.query(
        "SELECT c.id AS courierId, c.name AS courierName, COUNT(d.id) AS deliveries, "
        "       COALESCE(SUM(CASE WHEN d.status = 'delivered' THEN 1 ELSE 0 END), 0) AS completed, "
        "       COALESCE(SUM(d.fee_minor), 0) AS feeMinor "
        "FROM couriers c "
        "LEFT JOIN delivery_orders d ON d.courier_id = c.id AND d.created_at BETWEEN ? AND ? "
        "WHERE c.active = 1 GROUP BY c.id ORDER BY c.name",
        {}, {from, to});
  });

  // ---------------------------------------------------------------- recipes
  server.on("recipe.get", [&db](const nlohmann::json& p) {
    const auto productId = requireString(p, "productId");
    auto lines = db.query(
        "SELECT r.component_id AS componentId, pr.name_az AS name, r.qty_milli AS qtyMilli, "
        "       pr.cost_minor AS costMinor "
        "FROM product_recipes r LEFT JOIN products pr ON pr.id = r.component_id "
        "WHERE r.product_id = ?",
        {productId}, {});

    // What it costs to make, which is the number a price is set against. Cost
    // is per whole unit and quantity is thousandths.
    std::int64_t cost = 0;
    for (const auto& line : lines) {
      cost += line.value("qtyMilli", 0LL) * line.value("costMinor", 0LL) / 1000;
    }
    return nlohmann::json{{"productId", productId}, {"lines", lines}, {"costMinor", cost}};
  });

  server.on("recipe.save", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "EDIT_RECIPE");
    const auto productId = requireString(p, "productId");
    if (!p.contains("lines") || !p["lines"].is_array()) {
      throw PosError("VALIDATION", "lines required");
    }

    db.begin();
    // Replace rather than diff: a removed line has to stop consuming stock.
    {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(), "DELETE FROM product_recipes WHERE product_id = ?", -1, &stmt,
                         nullptr);
      sqlite3_bind_text(stmt, 1, productId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }

    int saved = 0;
    for (const auto& line : p["lines"]) {
      if (!line.is_object()) continue;
      const std::string componentId = line.value("componentId", "");
      const std::int64_t qty = line.value("qtyMilli", 0LL);
      if (componentId.empty() || qty <= 0 || componentId == productId) continue;

      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(),
                         "INSERT OR REPLACE INTO product_recipes(product_id, component_id, "
                         "  qty_milli) VALUES (?,?,?)",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, productId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, componentId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 3, qty);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
      saved += 1;
    }
    db.commit();

    audit(db, p.value("actorId", ""), "RECIPE_SAVE", productId);
    return nlohmann::json{{"productId", productId}, {"lines", saved}};
  });

  // ----------------------------------------------------------------- roster
  server.on("schedule.list", [&db](const nlohmann::json& p) {
    const std::int64_t from = p.value("fromMs", nowMs() - 86400000LL);
    const std::int64_t to = p.value("toMs", nowMs() + 7 * 86400000LL);
    return db.query(
        "SELECT id, user_id AS userId, starts_at AS startsAt, ends_at AS endsAt, "
        "       role_note AS roleNote, status FROM staff_schedules "
        "WHERE starts_at BETWEEN ? AND ? ORDER BY starts_at",
        {}, {from, to});
  });

  server.on("schedule.save", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "SCHEDULE_MANAGE");
    const auto userId = requireString(p, "userId");
    const std::int64_t startsAt = p.value("startsAt", 0LL);
    const std::int64_t endsAt = p.value("endsAt", 0LL);
    if (startsAt <= 0 || endsAt <= startsAt) {
      throw PosError("VALIDATION", "Növbənin vaxtı yanlışdır");
    }

    const std::string id = p.value("id", "").empty() ? newId("shf") : p.value("id", "");
    // Nobody works two shifts at once; a clash is a rota mistake worth catching
    // while it is still on screen.
    if (db.queryInt(
            "SELECT COUNT(*) FROM staff_schedules WHERE user_id = ? AND status != 'cancelled' "
            "  AND id != ? AND starts_at < ? AND ends_at > ?",
            {userId, id}, {endsAt, startsAt}) > 0) {
      throw PosError("VALIDATION", "Bu işçinin həmin vaxtda başqa növbəsi var");
    }

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO staff_schedules(id, user_id, starts_at, ends_at, role_note, "
                       "  created_at) VALUES (?,?,?,?,?,?) "
                       "ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, "
                       "  starts_at = excluded.starts_at, ends_at = excluded.ends_at, "
                       "  role_note = excluded.role_note",
                       -1, &stmt, nullptr);
    const std::string note = p.value("roleNote", "");
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, userId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, startsAt);
    sqlite3_bind_int64(stmt, 4, endsAt);
    sqlite3_bind_text(stmt, 5, note.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 6, nowMs());
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return nlohmann::json{{"id", id}, {"userId", userId}};
  });

  server.on("attendance.clockIn", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "SCHEDULE_CLOCK");
    std::string userId = p.value("userId", "");
    if (userId.empty()) userId = p.value("actorId", "");
    if (userId.empty()) throw PosError("VALIDATION", "userId required");

    // Clocking in twice is a mistake, not a second shift.
    if (db.queryInt("SELECT COUNT(*) FROM attendance WHERE user_id = ? AND clock_out_at IS NULL",
                    {userId}, {}) > 0) {
      throw PosError("VALIDATION", "Bu işçi artıq işə başlayıb");
    }

    const std::string id = newId("att");
    const auto now = nowMs();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO attendance(id, user_id, clock_in_at, created_at) "
                       "VALUES (?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, userId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, now);
    sqlite3_bind_int64(stmt, 4, now);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return nlohmann::json{{"id", id}, {"userId", userId}, {"clockInAt", now}};
  });

  server.on("attendance.clockOut", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "SCHEDULE_CLOCK");
    std::string userId = p.value("userId", "");
    if (userId.empty()) userId = p.value("actorId", "");
    if (userId.empty()) throw PosError("VALIDATION", "userId required");

    const auto now = nowMs();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "UPDATE attendance SET clock_out_at = ? WHERE user_id = ? "
                       "  AND clock_out_at IS NULL",
                       -1, &stmt, nullptr);
    sqlite3_bind_int64(stmt, 1, now);
    sqlite3_bind_text(stmt, 2, userId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (db.changes() != 1) throw PosError("VALIDATION", "Açıq iş vaxtı tapılmadı");

    return nlohmann::json{{"userId", userId}, {"clockOutAt", now}};
  });

  server.on("attendance.list", [&db](const nlohmann::json& p) {
    const std::int64_t from = p.value("fromMs", nowMs() - 7 * 86400000LL);
    const std::int64_t to = p.value("toMs", nowMs());
    return db.query(
        "SELECT a.id, a.user_id AS userId, a.schedule_id AS scheduleId, "
        "       a.clock_in_at AS clockInAt, a.clock_out_at AS clockOutAt, "
        "       CASE WHEN a.clock_out_at IS NULL THEN NULL "
        "            ELSE (a.clock_out_at - a.clock_in_at) / 60000 END AS workedMinutes "
        "FROM attendance a WHERE a.clock_in_at BETWEEN ? AND ? "
        "ORDER BY a.clock_in_at DESC LIMIT 300",
        {}, {from, to});
  });

  server.on("auth.permissionCatalogue", [&db](const nlohmann::json&) {
    // Grouped so the screen can show sections an operator understands rather
    // than a flat wall of SALE_REFUND.
    auto rows = db.query(
        "SELECT permission, grp, label FROM permission_catalogue ORDER BY grp, permission", {}, {});
    nlohmann::json groups = nlohmann::json::object();
    for (const auto& row : rows) {
      groups[db::columnOr(row, "grp", "other")].push_back(
          nlohmann::json{{"permission", db::columnOr(row, "permission", "")},
                         {"label", db::columnOr(row, "label", "")}});
    }
    return nlohmann::json{{"groups", groups}};
  });

  server.on("auth.roles", [&db](const nlohmann::json&) {
    auto roles = db.query("SELECT role, label, custom FROM roles ORDER BY role", {}, {});
    nlohmann::json out = nlohmann::json::array();
    for (const auto& role : roles) {
      const std::string name = role.value("role", "");
      auto granted = db.query(
          "SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission", {name}, {});
      nlohmann::json keys = nlohmann::json::array();
      for (const auto& g : granted) keys.push_back(g.value("permission", ""));
      out.push_back(nlohmann::json{{"role", name},
                                   {"label", role.value("label", "")},
                                   {"custom", role.value("custom", 0) != 0},
                                   {"permissions", keys}});
    }
    return nlohmann::json{{"roles", out}};
  });

  server.on("auth.saveRole", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "MANAGE_ROLES");

    const auto role = requireString(p, "role");
    const auto label = p.value("label", role);
    if (!p.contains("permissions") || !p["permissions"].is_array()) {
      throw PosError("VALIDATION", "permissions required");
    }

    db.begin();
    {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(),
                         "INSERT INTO roles(role, label, custom) VALUES (?,?,1) "
                         "ON CONFLICT(role) DO UPDATE SET label = excluded.label",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, label.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }

    // Replace rather than diff: the screen sends the whole set, and an
    // unchecked box has to actually revoke.
    {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(), "DELETE FROM role_permissions WHERE role = ?", -1, &stmt,
                         nullptr);
      sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }

    int granted = 0;
    for (const auto& entry : p["permissions"]) {
      if (!entry.is_string()) continue;
      const std::string permission = entry.get<std::string>();
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(),
                         "INSERT OR IGNORE INTO role_permissions(role, permission) "
                         "SELECT ?, permission FROM permission_catalogue WHERE permission = ?",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, permission.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
      granted += db.changes();
    }

    // A manager who cannot manage roles can never undo a mistake made on this
    // screen, so the role is restored to the full set whatever was sent for it.
    db.exec(
        "INSERT OR IGNORE INTO role_permissions(role, permission) "
        "SELECT 'manager', permission FROM permission_catalogue");
    db.commit();

    audit(db, p.value("actorId", ""), "ROLE_SAVE", role + " granted=" + std::to_string(granted));
    return nlohmann::json{{"role", role}, {"granted", granted}};
  });

  /**
   * The role policy the shop set on the website, applied to this till.
   *
   * Not reachable from the renderer: `policySource` is in core-payload.cjs's
   * stripped list, so only Electron main - which fetched this from the control
   * plane over a signed device call - can set it. Without that a window script
   * could rewrite every grant in the shop.
   *
   * Idempotent by version, because it runs on every heartbeat: an unchanged
   * policy costs one settings read. The version is the server's, so a rollback
   * there lowers it and the next pull applies the older policy - which is what
   * a rollback is for.
   */
  server.on("roles.applyPolicy", [&db](const nlohmann::json& p) {
    if (p.value("policySource", "") != "control-plane") {
      throw PosError("PERMISSION_DENIED", "roles.applyPolicy is not callable from the renderer");
    }
    const auto version = static_cast<std::int64_t>(p.value("version", 0));
    if (version <= 0) throw PosError("VALIDATION", "version required");
    if (!p.contains("roles") || !p["roles"].is_array()) {
      throw PosError("VALIDATION", "roles array required");
    }

    const auto applied = settingJson(db, "pos.rolePolicyVersion", 0);
    if (applied.is_number_integer() && applied.get<std::int64_t>() == version) {
      return nlohmann::json{{"ok", true}, {"version", version}, {"changed", false}};
    }

    int touched = 0;
    db.begin();
    try {
      for (const auto& entry : p["roles"]) {
        if (!entry.is_object()) continue;
        const std::string role = entry.value("name", "");
        if (role.empty()) continue;

        {
          // `custom` stays 1 for a role the website invented, so the till's own
          // screen can still delete it; a shipped role keeps whatever it had.
          sqlite3_stmt* stmt = nullptr;
          sqlite3_prepare_v2(db.raw(),
                             "INSERT INTO roles(role, label, custom) VALUES (?,?,1) "
                             "ON CONFLICT(role) DO NOTHING",
                             -1, &stmt, nullptr);
          sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_bind_text(stmt, 2, entry.value("label", role).c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_step(stmt);
          sqlite3_finalize(stmt);
        }
        {
          sqlite3_stmt* stmt = nullptr;
          sqlite3_prepare_v2(db.raw(), "DELETE FROM role_permissions WHERE role = ?", -1, &stmt,
                             nullptr);
          sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_step(stmt);
          sqlite3_finalize(stmt);
        }

        if (entry.contains("permissions") && entry["permissions"].is_array()) {
          for (const auto& key : entry["permissions"]) {
            if (!key.is_string()) continue;
            // Joined against the catalogue, so a key this build has never heard
            // of is dropped here rather than stored as a grant nothing checks.
            sqlite3_stmt* stmt = nullptr;
            sqlite3_prepare_v2(db.raw(),
                               "INSERT OR IGNORE INTO role_permissions(role, permission) "
                               "SELECT ?, permission FROM permission_catalogue WHERE permission = ?",
                               -1, &stmt, nullptr);
            sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(stmt, 2, key.get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
            sqlite3_step(stmt);
            sqlite3_finalize(stmt);
          }
        }
        touched += 1;
      }

      // Same reason as auth.saveRole: a manager locked out of role management
      // has no way back, and the website is further away than the till.
      db.exec(
          "INSERT OR IGNORE INTO role_permissions(role, permission) "
          "SELECT 'manager', permission FROM permission_catalogue");

      {
        const auto value = std::to_string(version);
        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(db.raw(),
                           "INSERT INTO settings(key, value) VALUES ('pos.rolePolicyVersion', ?) "
                           "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, value.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
      }

      audit(db, "control-plane", "ROLE_POLICY_APPLY",
            "version=" + std::to_string(version) + " roles=" + std::to_string(touched));
      db.commit();
    } catch (...) {
      db.rollback();
      throw;
    }

    return nlohmann::json{{"ok", true}, {"version", version}, {"changed", true}, {"roles", touched}};
  });

  server.on("auth.deleteRole", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "MANAGE_ROLES");

    const auto role = requireString(p, "role");
    // The shipped roles are what staff are assigned and what the seed's grants
    // hang off; removing one would leave people pointing at nothing.
    if (db.queryInt("SELECT COUNT(*) FROM roles WHERE role = ? AND custom = 1", {role}, {}) == 0) {
      throw PosError("VALIDATION", "Sistem rolları silinə bilməz");
    }

    db.begin();
    {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(), "DELETE FROM roles WHERE role = ?", -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }
    {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(), "DELETE FROM role_permissions WHERE role = ?", -1, &stmt,
                         nullptr);
      sqlite3_bind_text(stmt, 1, role.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }
    db.commit();

    audit(db, p.value("actorId", ""), "ROLE_DELETE", role);
    return nlohmann::json{{"ok", true}, {"role", role}};
  });

  server.on("auth.recordApproval", [&db](const nlohmann::json& p) {
    audit(db, requireString(p, "actorId"), "MANAGER_APPROVAL",
          p.value("permission", "") + " approver=" + p.value("approverId", ""));
    return nlohmann::json{{"ok", true}};
  });
  server.on("auth.getOverrides", [&db](const nlohmann::json& p) {
    return db.query("SELECT permission, allowed, updated_at AS updatedAt, updated_by AS updatedBy FROM employee_permission_overrides WHERE employee_id = ? ORDER BY permission",
                    {requireString(p, "employeeId")}, {});
  });
  server.on("auth.setOverride", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "MANAGE_PERMISSIONS");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(), "INSERT INTO employee_permission_overrides(employee_id, permission, allowed, updated_at, updated_by) VALUES (?,?,?,?,?) ON CONFLICT(employee_id,permission) DO UPDATE SET allowed=excluded.allowed, updated_at=excluded.updated_at, updated_by=excluded.updated_by", -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, requireString(p, "employeeId").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, requireString(p, "permission").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 3, p.value("allowed", false) ? 1 : 0);
    sqlite3_bind_int64(stmt, 4, nowMs());
    sqlite3_bind_text(stmt, 5, p.value("actorId", "system").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt); sqlite3_finalize(stmt);
    audit(db, p.value("actorId", "system"), "PERMISSION_OVERRIDE", p.value("employeeId", "") + ":" + p.value("permission", ""));
    return nlohmann::json{{"ok", true}};
  });

  auto purchaseJson = [&db](const std::string& id) -> nlohmann::json {
    auto rows = db.query("SELECT * FROM purchase_orders WHERE id = ?", {id}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "purchase not found");
    const auto& row = rows[0];
    return {{"id", row.at("id")}, {"documentNo", columnOr<std::string>(row, "document_no", id.c_str())},
            {"supplier", row.at("supplier")}, {"expectedAt", columnOr(row, "expected_at", "")},
            {"createdAt", row.at("created_at")}, {"updatedAt", columnOr<nlohmann::json>(row, "updated_at", row.at("created_at"))},
            {"createdBy", row.at("created_by")}, {"warehouseId", row.at("warehouse_id")},
            {"status", row.at("status")}, {"totalMinor", columnOr<std::int64_t>(row, "total_minor", 0)},
            {"paymentStatus", columnOr(row, "payment_status", "unpaid")},
            {"lines", db.query("SELECT id, product_id AS productId, qty, cost_minor AS costMinor, returned_qty AS returnedQty FROM purchase_order_lines WHERE purchase_id = ? ORDER BY rowid", {id}, {})},
            {"returns", db.query("SELECT * FROM purchase_returns WHERE purchase_id = ? ORDER BY created_at DESC", {id}, {})}};
  };
  auto nextDocumentNo = [&db](std::int64_t createdAt) {
    const auto tt = std::chrono::system_clock::time_point(std::chrono::milliseconds(createdAt));
    std::time_t t = std::chrono::system_clock::to_time_t(tt);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char day[16];
    std::snprintf(day, sizeof(day), "%04d%02d%02d", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday);
    const auto seq = db.queryInt("SELECT COUNT(*) + 1 FROM purchase_orders WHERE document_no LIKE ?", {std::string("A-") + day + "-%"}, {});
    char out[32];
    std::snprintf(out, sizeof(out), "A-%s-%04lld", day, static_cast<long long>(seq));
    return std::string(out);
  };
  auto appendSupplier = [&db](const std::string& supplier, std::int64_t amount, const std::string& kind,
                              const std::string& refType, const std::string& refId, const std::string& actor) {
    const auto balance = db.queryInt("SELECT COALESCE((SELECT balance_after_minor FROM supplier_ledger WHERE supplier_name = ? ORDER BY created_at DESC LIMIT 1),0)", {supplier}, {});
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(), "INSERT INTO supplier_ledger(id,supplier_name,kind,amount_minor,balance_after_minor,ref_type,ref_id,note,created_at,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?)", -1, &stmt, nullptr);
    const auto id = newId("sl");
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, supplier.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, kind.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 4, amount);
    sqlite3_bind_int64(stmt, 5, balance + amount);
    sqlite3_bind_text(stmt, 6, refType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 7, refId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 8, "", -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 9, nowMs());
    sqlite3_bind_text(stmt, 10, actor.c_str(), -1, SQLITE_TRANSIENT);
    if (sqlite3_step(stmt) != SQLITE_DONE) { const std::string message = sqlite3_errmsg(db.raw()); sqlite3_finalize(stmt); throw PosError("E_DB", message, true); }
    sqlite3_finalize(stmt);
  };

  server.on("purchase.create", [&db, nextDocumentNo, purchaseJson](const nlohmann::json& p) {
    requirePermission(db, p, "RECEIVE_PURCHASE");
    const auto order = p.contains("order") ? p.at("order") : p;
    const auto lines = order.at("lines");
    if (!lines.is_array() || lines.empty()) throw PosError("E_VALIDATION", "purchase lines required");
    const auto createdAt = order.value("createdAt", nowMs());
    const std::string id = order.value("id", newId("po"));
    // A portal purchase order arrives with a fixed id (PO-<command id>) and is
    // re-delivered until the till acknowledges it. The second delivery must
    // answer with the order already written, not fail on the primary key -
    // unless the id was reused for a different supplier.
    const auto prior = db.query("SELECT supplier FROM purchase_orders WHERE id = ?", {id}, {});
    if (!prior.empty()) {
      if (prior[0].at("supplier") != order.value("supplier", std::string{}))
        throw PosError("E_CONFLICT", "purchase id was reused with different details");
      return purchaseJson(id);
    }
    const std::string documentNo = order.value("documentNo", nextDocumentNo(createdAt));
    const std::string supplier = requireString(order, "supplier");
    std::int64_t total = 0;
    for (const auto& line : lines) total += requireInt(line, "qty") * line.value("costMinor", 0);
    db.begin();
    try {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(), "INSERT INTO purchase_orders(id,supplier,expected_at,created_at,created_by,warehouse_id,status,lines_json,document_no,updated_at,total_minor,payment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'unpaid')", -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 2, supplier.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, order.value("expectedAt", "").c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_int64(stmt, 4, createdAt);
      sqlite3_bind_text(stmt, 5, order.value("createdBy", "system").c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 6, requireString(order, "warehouseId").c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 7, order.value("status", "ordered").c_str(), -1, SQLITE_TRANSIENT); const auto lineJson = lines.dump(); sqlite3_bind_text(stmt, 8, lineJson.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 9, documentNo.c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_int64(stmt, 10, createdAt); sqlite3_bind_int64(stmt, 11, total);
      if (sqlite3_step(stmt) != SQLITE_DONE) { const std::string message = sqlite3_errmsg(db.raw()); sqlite3_finalize(stmt); throw PosError("E_DB", message, true); } sqlite3_finalize(stmt);
      for (const auto& line : lines) {
        const auto lineId = newId("pol"); sqlite3_prepare_v2(db.raw(), "INSERT INTO purchase_order_lines(id,purchase_id,product_id,qty,cost_minor) VALUES (?,?,?,?,?)", -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, lineId.c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 2, id.c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 3, requireString(line, "productId").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 4, requireInt(line, "qty")); sqlite3_bind_int64(stmt, 5, line.value("costMinor", 0)); sqlite3_step(stmt); sqlite3_finalize(stmt);
      }
      audit(db, order.value("createdBy", "system"), "PURCHASE_CREATE", documentNo); db.commit();
    } catch (...) { db.rollback(); throw; }
    return purchaseJson(id);
  });

  server.on("purchase.list", [purchaseJson, &db](const nlohmann::json&) {
    auto ids = db.query("SELECT id FROM purchase_orders ORDER BY created_at DESC LIMIT 500");
    nlohmann::json out = nlohmann::json::array();
    for (const auto& row : ids) {
      out.push_back(purchaseJson(row.at("id").get<std::string>()));
    }
    return out;
  });
  server.on("purchase.get", [purchaseJson](const nlohmann::json& p) { return purchaseJson(requireString(p, "id")); });

  server.on("purchase.receive", [&db, purchaseJson, appendSupplier](const nlohmann::json& p) {
    requirePermission(db, p, "RECEIVE_PURCHASE"); const auto id = requireString(p, "id"); const auto doc = purchaseJson(id);
    // The portal re-sends a receive command until the till acknowledges it;
    // stock must come in once.
    const std::string portalCommandId = p.value("portalCommandId", "");
    if (!portalCommandId.empty() && db.queryInt(
        "SELECT COUNT(*) FROM audit_logs WHERE action = 'PORTAL_PURCHASE_RECEIVE' AND detail = ?",
        {portalCommandId}, {}) > 0) return doc;
    if (doc.at("status") == "received") throw PosError("E_CONFLICT", "purchase already received");
    const auto actor = p.value("actorId", "system"); db.begin();
    try {
      for (const auto& line : doc.at("lines")) applyStockPolicy(db, "PURCHASE", line.at("productId"), normalizeWarehouseId(db, doc.value("warehouseId", std::string{})), line.at("qty"), "purchase", id, actor, "received");
      db.exec("UPDATE purchase_orders SET status='received', updated_at=" + std::to_string(nowMs()) + " WHERE id='" + id + "';");
      appendSupplier(doc.at("supplier"), doc.at("totalMinor"), "purchase", "purchase", id, actor);
      audit(db, actor, "PURCHASE_RECEIVE", doc.at("documentNo"));
      if (!portalCommandId.empty()) audit(db, actor, "PORTAL_PURCHASE_RECEIVE", portalCommandId);
      db.commit();
    } catch (...) { db.rollback(); throw; }
    return purchaseJson(id);
  });

  server.on("purchase.update", [&db, purchaseJson, appendSupplier](const nlohmann::json& p) {
    requirePermission(db, p, "PURCHASE_EDIT");
    const auto id = requireString(p, "id");
    const auto old = purchaseJson(id);
    const auto lines = p.at("lines");
    if (!lines.is_array() || lines.empty()) throw PosError("E_VALIDATION", "purchase lines required");
    const bool received = old.at("status") == "received";
    const auto actor = p.value("actorId", "system");
    const auto returnedTotal = db.queryInt(
        "SELECT COALESCE(SUM(total_minor),0) FROM purchase_returns WHERE purchase_id = ?", {id}, {});
    std::int64_t total = 0;
    for (const auto& line : lines) total += requireInt(line, "qty") * line.value("costMinor", 0);
    if (total < returnedTotal)
      throw PosError("E_VALIDATION", "purchase total cannot be below returned total");
    for (const auto& oldLine : old.at("lines")) {
      const auto returned = oldLine.value<std::int64_t>("returnedQty", 0);
      if (returned <= 0) continue;
      const auto productId = oldLine.at("productId").get<std::string>();
      const auto match = std::find_if(lines.begin(), lines.end(), [&](const auto& line) {
        return line.value("productId", "") == productId;
      });
      if (match == lines.end() || match->at("qty").get<std::int64_t>() < returned) {
        throw PosError("E_VALIDATION", "returned purchase quantity cannot be removed");
      }
    }
    db.begin();
    try {
      if (received) {
        for (const auto& line : old.at("lines")) {
          const auto netQty = line.at("qty").get<std::int64_t>() -
                              line.value<std::int64_t>("returnedQty", 0);
          if (netQty > 0)
            applyStockPolicy(db, "PURCHASE_EDIT_REVERSAL", line.at("productId"),
                             normalizeWarehouseId(db, old.value("warehouseId", std::string{})), -netQty, "purchase", id, actor,
                             "edit reversal");
        }
        appendSupplier(old.at("supplier"),
                       -(old.at("totalMinor").get<std::int64_t>() - returnedTotal),
                       "purchase_edit_reversal", "purchase", id, actor);
      }
      sqlite3_stmt* stmt = nullptr; const auto json = lines.dump();
      sqlite3_prepare_v2(db.raw(), "UPDATE purchase_orders SET supplier=?, expected_at=?, warehouse_id=?, lines_json=?, total_minor=?, updated_at=? WHERE id=?", -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, p.value("supplier", old.at("supplier").get<std::string>()).c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 2, p.value("expectedAt", old.value("expectedAt", "")).c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, normalizeWarehouseId(db, p.value("warehouseId", std::string{})).c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_text(stmt, 4, json.c_str(), -1, SQLITE_TRANSIENT); sqlite3_bind_int64(stmt, 5, total); sqlite3_bind_int64(stmt, 6, nowMs()); sqlite3_bind_text(stmt, 7, id.c_str(), -1, SQLITE_TRANSIENT); sqlite3_step(stmt); sqlite3_finalize(stmt);
      db.exec("DELETE FROM purchase_order_lines WHERE purchase_id='" + id +
              "' AND returned_qty=0;");
      for (const auto& line : lines) {
        const auto productId = requireString(line, "productId");
        auto existing = db.query(
            "SELECT id FROM purchase_order_lines WHERE purchase_id=? AND product_id=?",
            {id, productId}, {});
        if (!existing.empty()) {
          sqlite3_prepare_v2(db.raw(),
                             "UPDATE purchase_order_lines SET qty=?, cost_minor=? WHERE id=?",
                             -1, &stmt, nullptr);
          sqlite3_bind_int64(stmt, 1, requireInt(line, "qty"));
          sqlite3_bind_int64(stmt, 2, line.value("costMinor", 0));
          sqlite3_bind_text(stmt, 3, existing[0].at("id").get<std::string>().c_str(),
                            -1, SQLITE_TRANSIENT);
        } else {
          const auto lid = newId("pol");
          sqlite3_prepare_v2(db.raw(),
                             "INSERT INTO purchase_order_lines(id,purchase_id,product_id,qty,cost_minor) VALUES (?,?,?,?,?)",
                             -1, &stmt, nullptr);
          sqlite3_bind_text(stmt, 1, lid.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_bind_text(stmt, 2, id.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_bind_text(stmt, 3, productId.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_bind_int64(stmt, 4, requireInt(line, "qty"));
          sqlite3_bind_int64(stmt, 5, line.value("costMinor", 0));
        }
        if (sqlite3_step(stmt) != SQLITE_DONE) {
          const std::string message = sqlite3_errmsg(db.raw());
          sqlite3_finalize(stmt);
          throw PosError("E_DB", message, true);
        }
        sqlite3_finalize(stmt);
      }
      if (received) {
        const auto updated = purchaseJson(id);
        for (const auto& line : updated.at("lines")) {
          const auto netQty = line.at("qty").get<std::int64_t>() -
                              line.value<std::int64_t>("returnedQty", 0);
          if (netQty > 0)
            applyStockPolicy(db, "PURCHASE", line.at("productId"),
                             normalizeWarehouseId(db, updated.value("warehouseId", std::string{})), netQty, "purchase", id,
                             actor, "edited");
        }
        appendSupplier(updated.at("supplier"), total - returnedTotal,
                       "purchase_edit", "purchase", id, actor);
      }
      audit(db, actor, "PURCHASE_EDIT", old.at("documentNo")); db.commit();
    } catch (...) { db.rollback(); throw; }
    return purchaseJson(id);
  });

  server.on("purchase.returnPartial", [&db, purchaseJson, appendSupplier](const nlohmann::json& p) {
    requirePermission(db, p, "PURCHASE_RETURN"); const auto purchaseId = requireString(p, "purchaseId"); const auto doc = purchaseJson(purchaseId);
    if (doc.at("status") != "received") throw PosError("E_CONFLICT", "only received purchases can be returned");
    const auto lines = p.at("lines"); const auto actor = p.value("actorId", "system"); const auto returnId = newId("pr"); std::int64_t total = 0;
    db.begin();
    try {
      for (const auto& requested : lines) {
        const auto lineId = requireString(requested, "lineId"); const auto qty = requireInt(requested, "qty");
        auto found = db.query("SELECT * FROM purchase_order_lines WHERE id=? AND purchase_id=?", {lineId, purchaseId}, {});
        if (found.empty() || qty <= 0 || qty > found[0].at("qty").get<std::int64_t>() - found[0].at("returned_qty").get<std::int64_t>()) throw PosError("INVALID_REFUND_QUANTITY", "invalid purchase return quantity");
        const auto productId = found[0].at("product_id").get<std::string>(); const auto amount = qty * found[0].at("cost_minor").get<std::int64_t>(); total += amount;
        applyStockPolicy(db, "PURCHASE_RETURN", productId, normalizeWarehouseId(db, doc.value("warehouseId", std::string{})), -qty, "purchase_return", returnId, actor, "supplier return");
        db.exec("UPDATE purchase_order_lines SET returned_qty=returned_qty+" + std::to_string(qty) + " WHERE id='" + lineId + "';");
        sqlite3_stmt* stmt = nullptr; const auto rid = newId("prl"); sqlite3_prepare_v2(db.raw(), "INSERT INTO purchase_return_lines(id,return_id,purchase_line_id,product_id,qty,amount_minor) VALUES (?,?,?,?,?,?)", -1, &stmt, nullptr); sqlite3_bind_text(stmt,1,rid.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,2,returnId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,3,lineId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,4,productId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,5,qty); sqlite3_bind_int64(stmt,6,amount); sqlite3_step(stmt); sqlite3_finalize(stmt);
      }
      const auto returnNo = std::string("Q-") + std::to_string(nowMs()); sqlite3_stmt* stmt = nullptr; sqlite3_prepare_v2(db.raw(), "INSERT INTO purchase_returns(id,return_no,purchase_id,supplier_name,warehouse_id,total_minor,created_at,actor_id,note) VALUES (?,?,?,?,?,?,?,?,?)", -1, &stmt, nullptr); sqlite3_bind_text(stmt,1,returnId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,2,returnNo.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,3,purchaseId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,4,doc.at("supplier").get<std::string>().c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,5,normalizeWarehouseId(db, doc.value("warehouseId", std::string{})).c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,6,total); sqlite3_bind_int64(stmt,7,nowMs()); sqlite3_bind_text(stmt,8,actor.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,9,p.value("note","").c_str(),-1,SQLITE_TRANSIENT); sqlite3_step(stmt); sqlite3_finalize(stmt);
      appendSupplier(doc.at("supplier"), -total, "purchase_return", "purchase_return", returnId, actor); audit(db, actor, "PURCHASE_RETURN", returnNo); db.commit();
    } catch (...) { db.rollback(); throw; }
    return nlohmann::json{{"id", returnId}, {"totalMinor", total}, {"purchase", purchaseJson(purchaseId)}};
  });
  server.on("purchase.returns", [&db](const nlohmann::json& p) { return db.query("SELECT * FROM purchase_returns WHERE purchase_id=? ORDER BY created_at DESC", {requireString(p,"purchaseId")}, {}); });

  server.on("sale.listHeld", [&db](const nlohmann::json&) {
    auto rows = db.query("SELECT * FROM held_carts ORDER BY created_at DESC");
    nlohmann::json out = nlohmann::json::array();
    for (const auto& row : rows) {
      out.push_back({{"id", row.at("id")},
                     {"label", row.at("label")},
                     {"createdAt", row.at("created_at")},
                     {"cashierId", columnOr(row, "cashier_id", "")},
                     {"registerId", db::columnOr(row, "register_id", "")},
                     {"discountMinor", db::columnOr(row, "discount_minor", 0)},
                     {"customerId", row.contains("customer_id") && !row["customer_id"].is_null() ? row["customer_id"] : nlohmann::json(nullptr)},
                     {"customerName", row.contains("customer_name") ? row.at("customer_name") : nullptr},
                     {"lines", nlohmann::json::parse(row.at("lines_json").get<std::string>())}});
    }
    return out;
  });

  server.on("sale.cancelHeld", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "HOLD_CANCEL");
    const auto id = requireString(p, "id");
    auto rows = db.query("SELECT id FROM held_carts WHERE id = ?", {id}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "held cart not found");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(), "DELETE FROM held_carts WHERE id = ?", -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    audit(db, p.value("actorId", "system"), "HOLD_CANCEL", id);
    return nlohmann::json{{"ok", true}, {"id", id}};
  });

  server.on("sale.overridePrice", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "PRICE_OVERRIDE");
    // Validation helper for UI — actual override applied on sale.complete via unitPriceMinor
    const auto original = requireInt(p, "originalPriceMinor");
    const auto overridden = requireInt(p, "overriddenPriceMinor");
    if (overridden < 0) throw PosError("E_VALIDATION", "price negative");
    audit(db, p.value("actorId", "system"), "PRICE_OVERRIDE",
          "from " + std::to_string(original) + " to " + std::to_string(overridden) + " reason=" +
              p.value("reason", ""));
    return nlohmann::json{{"ok", true},
                          {"originalPriceMinor", original},
                          {"overriddenPriceMinor", overridden},
                          {"reason", p.value("reason", "")},
                          {"approverId", p.value("approverId", "")}};
  });

  server.on("sale.receipt", [&db](const nlohmann::json& p) {
    const auto saleId = requireString(p, "saleId");
    auto rows = db.query("SELECT * FROM sales WHERE id = ?", {saleId}, {});
    if (rows.empty()) throw PosError("E_NOT_FOUND", "sale not found");
    const auto& s = rows[0];
    auto items = db.query(
        "SELECT si.*, p.name_az AS name, p.sku, p.unit FROM sale_items si JOIN products p ON p.id = si.product_id "
        "WHERE si.sale_id = ?",
        {saleId}, {});
    auto settings = db.query("SELECT key, value FROM settings");
    nlohmann::json settingsMap = nlohmann::json::object();
    for (const auto& row : settings) {
      settingsMap[row.at("key").get<std::string>()] = row.at("value");
    }
    // `sales` stores only customer_id — the name lives on the customer row — so
    // the bonus block is resolved here rather than read off the sale.
    const std::string saleCustomerId =
        s.contains("customer_id") && !s["customer_id"].is_null() ? s["customer_id"].get<std::string>() : std::string{};
    nlohmann::json customerName = nullptr;
    std::int64_t loyaltyBalanceMinor = 0;
    if (!saleCustomerId.empty()) {
      auto cust = db.query("SELECT name FROM customers WHERE id = ?", {saleCustomerId}, {});
      if (!cust.empty()) customerName = cust[0].at("name");
      loyaltyBalanceMinor =
          db.queryInt("SELECT COALESCE((SELECT points_after FROM loyalty_ledger WHERE customer_id = ? "
                      "ORDER BY created_at DESC, rowid DESC LIMIT 1),0)",
                      {saleCustomerId}, {});
    }
    return nlohmann::json{
        {"storeName", db::columnOr(settingsMap, "storeName", "MarketPos Supermarket")},
        {"receiptNo", s.at("receipt_no")},
        {"createdAt", s.at("created_at")},
        {"cashierId", s.at("cashier_id")},
        {"registerId", s.at("register_id")},
        {"items", items},
        {"subtotalMinor", s.at("subtotal_minor")},
        {"discountMinor", s.at("discount_minor")},
        {"totalMinor", s.at("total_minor")},
        {"paymentMethod", s.at("payment_method")},
        {"tenderedMinor", s.at("tendered_minor")},
        {"changeMinor", s.at("change_minor")},
        {"cashMinor", columnOr<std::int64_t>(s, "cash_minor", 0)},
        {"cardMinor", columnOr<std::int64_t>(s, "card_minor", 0)},
        {"fiscalStatus", columnOr<std::string>(s, "fiscal_status", "none")},
        {"terminalRef", columnOr<std::string>(s, "terminal_ref", "")},
        // Bonus was earned and spent on this sale but appeared nowhere the
        // customer could see it — not on the receipt, not on screen. A loyalty
        // scheme nobody is shown a number for is one nobody trusts.
        {"loyaltyEarnedMinor", columnOr<std::int64_t>(s, "loyalty_earned_minor", 0)},
        {"loyaltyRedeemedMinor", columnOr<std::int64_t>(s, "loyalty_redeemed_minor", 0)},
        {"loyaltyBalanceMinor", loyaltyBalanceMinor},
        {"customerName", customerName},
        {"fiscal", nlohmann::json::object()},
    };
  });

  server.on("cash.cashIn", [&db](const nlohmann::json& p) { return insertCashMovement(db, p, "cash_in", "CASH_IN"); });
  server.on("cash.cashOut",
            [&db](const nlohmann::json& p) { return insertCashMovement(db, p, "cash_out", "CASH_OUT"); });
  server.on("cash.safeDrop",
            [&db](const nlohmann::json& p) { return insertCashMovement(db, p, "safe_drop", "SAFE_DROP"); });
  server.on("cash.movements", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "VIEW_REPORTS");
    return db.query("SELECT id, type AS kind, amount_minor AS amountMinor, reason, "
                    "created_at AS createdAt FROM cash_movements ORDER BY created_at DESC LIMIT 5000");
  });

  server.on("cash.xReport", [&db](const nlohmann::json& p) {
    const auto registerId = requireString(p, "registerId");
    auto session = openSessionRow(db, registerId);
    auto report = buildSessionReport(db, session);
    report["reportType"] = "X";
    report["actualCashMinor"] = nullptr;
    report["differenceMinor"] = nullptr;
    return report;
  });

  server.on("cash.zClose", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "CLOSE_SHIFT");
    const auto registerId = requireString(p, "registerId");
    const auto actual = requireInt(p, "actualCashMinor");
    auto session = openSessionRow(db, registerId);
    auto report = buildSessionReport(db, session);
    const auto expected = report.at("expectedCashMinor").get<std::int64_t>();
    const auto treasuryMinor = p.value("treasuryMinor", static_cast<std::int64_t>(0));
    if (treasuryMinor < 0 || treasuryMinor > actual) throw PosError("E_VALIDATION", "invalid treasury amount");
    if (treasuryMinor > 0) requirePermission(db, p, "TREASURY_TRANSFER");
    const auto diff = actual - expected;
    report["reportType"] = "Z";
    report["actualCashMinor"] = actual;
    report["differenceMinor"] = diff;
    report["closedAt"] = nowMs();
    const std::string zId = newId("z");
    const std::string transferId = treasuryMinor > 0 ? newId("tr") : "";
    if (treasuryMinor > 0) {
      report["treasuryMinor"] = treasuryMinor;
      report["treasuryTransferId"] = transferId;
    }
    const std::string payload = report.dump();
    db.begin();
    try {
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(),
                         "UPDATE cash_sessions SET status='closed', closed_at=?, expected_cash_minor=?, "
                         "actual_cash_minor=?, difference_minor=?, z_report_json=? WHERE id=?",
                         -1, &stmt, nullptr);
      sqlite3_bind_int64(stmt, 1, report["closedAt"].get<std::int64_t>());
      sqlite3_bind_int64(stmt, 2, expected);
      sqlite3_bind_int64(stmt, 3, actual);
      sqlite3_bind_int64(stmt, 4, diff);
      sqlite3_bind_text(stmt, 5, payload.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 6, session.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);

      if (treasuryMinor > 0) {
        sqlite3_prepare_v2(db.raw(), "INSERT INTO treasury_transfers(id,session_id,register_id,amount_minor,created_at,actor_id,note) VALUES (?,?,?,?,?,?,?)", -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, transferId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, session.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, registerId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 4, treasuryMinor);
        sqlite3_bind_int64(stmt, 5, nowMs());
        sqlite3_bind_text(stmt, 6, p.value("actorId", "system").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 7, p.value("treasuryNote", "Gun sonu transfer").c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt); sqlite3_finalize(stmt);
      }

      sqlite3_prepare_v2(db.raw(),
                         "INSERT INTO z_reports(id, session_id, register_id, operator_id, opened_at, closed_at, "
                         "payload_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, zId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, session.at("id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, registerId.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 4, session.at("operator_id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 5, session.at("opened_at").get<std::int64_t>());
      sqlite3_bind_int64(stmt, 6, report["closedAt"].get<std::int64_t>());
      sqlite3_bind_text(stmt, 7, payload.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 8, nowMs());
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);

      db.exec("UPDATE registers SET status='closed', operator_id=NULL, opened_at=NULL WHERE id='" + registerId +
              "';");
      audit(db, p.value("actorId", session.at("operator_id").get<std::string>()), "Z_CLOSE", registerId);
      db.commit();
    } catch (...) {
      db.rollback();
      throw;
    }
    report["zReportId"] = zId;
    return report;
  });

  server.on("treasury.transfer", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "TREASURY_TRANSFER");
    const auto registerId = requireString(p, "registerId"); const auto amount = requireInt(p, "amountMinor");
    if (amount <= 0) throw PosError("E_VALIDATION", "amount must be positive");
    const auto id = newId("tr"); sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(), "INSERT INTO treasury_transfers(id,session_id,register_id,amount_minor,created_at,actor_id,note) VALUES (?,NULL,?,?,?,?,?)", -1, &stmt, nullptr);
    sqlite3_bind_text(stmt,1,id.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,2,registerId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,3,amount); sqlite3_bind_int64(stmt,4,nowMs()); sqlite3_bind_text(stmt,5,p.value("actorId","system").c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,6,p.value("note","").c_str(),-1,SQLITE_TRANSIENT); sqlite3_step(stmt); sqlite3_finalize(stmt);
    audit(db,p.value("actorId","system"),"TREASURY_TRANSFER",std::to_string(amount)); return nlohmann::json{{"id",id},{"amountMinor",amount}};
  });
  server.on("treasury.list", [&db](const nlohmann::json&) { return db.query("SELECT * FROM treasury_transfers ORDER BY created_at DESC LIMIT 500"); });

  server.on("drawer.openLogged", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "OPEN_DRAWER");
    audit(db, p.value("actorId", "system"), "OPEN_DRAWER", p.value("reason", "manual"));
    return nlohmann::json{{"ok", true}};
  });

  // --- Fiscal queue ---
  server.on("fiscal.enqueue", [&db](const nlohmann::json& p) {
    const std::string id = newId("fq");
    const std::string key = p.value("idempotencyKey", id);
    const auto existing = db.query("SELECT * FROM fiscal_queue WHERE idempotency_key = ?", {key}, {});
    if (!existing.empty()) return existing[0];
    const auto ts = nowMs();
    const std::string req = p.value("request", nlohmann::json::object()).dump();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO fiscal_queue(id, idempotency_key, sale_id, kind, provider, status, request_json, "
                       "payload_hash, created_at, updated_at) VALUES (?,?,?,?,?,'pending',?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, key.c_str(), -1, SQLITE_TRANSIENT);
    if (p.contains("saleId"))
      sqlite3_bind_text(stmt, 3, p.at("saleId").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 3);
    sqlite3_bind_text(stmt, 4, p.value("kind", "sale").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, p.value("provider", "mock").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 6, req.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 7, p.value("payloadHash", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 8, ts);
    sqlite3_bind_int64(stmt, 9, ts);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (p.contains("saleId")) {
      db.exec("UPDATE sales SET fiscal_status='pending' WHERE id='" + p.at("saleId").get<std::string>() + "';");
    }
    return db.query("SELECT * FROM fiscal_queue WHERE id = ?", {id}, {})[0];
  });

  server.on("fiscal.listPending", [&db](const nlohmann::json&) {
    return db.query("SELECT * FROM fiscal_queue WHERE status IN ('pending','failed') ORDER BY created_at");
  });

  server.on("fiscal.updateStatus", [&db](const nlohmann::json& p) {
    const auto id = requireString(p, "id");
    const auto status = requireString(p, "status");
    const auto ts = nowMs();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "UPDATE fiscal_queue SET status=?, response_json=?, fiscal_receipt_id=?, qr_data=?, "
                       "last_error=?, attempts=attempts+1, updated_at=? WHERE id=?",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, status.c_str(), -1, SQLITE_TRANSIENT);
    const std::string resp = p.value("response", nlohmann::json::object()).dump();
    sqlite3_bind_text(stmt, 2, resp.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, p.value("fiscalReceiptId", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, p.value("qrData", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, p.value("lastError", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 6, ts);
    sqlite3_bind_text(stmt, 7, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    auto rows = db.query("SELECT * FROM fiscal_queue WHERE id = ?", {id}, {});
    if (!rows.empty() && rows[0].contains("sale_id") && !rows[0]["sale_id"].is_null()) {
      const std::string saleId = rows[0]["sale_id"].get<std::string>();
      const std::string fs = status == "success" ? "success" : status == "rejected" ? "rejected" : "failed";
      if (status == "success" || status == "rejected" || status == "failed") {
        db.exec("UPDATE sales SET fiscal_status='" + fs + "' WHERE id='" + saleId + "';");
      }
    }
    return rows.empty() ? nlohmann::json::object() : rows[0];
  });

  server.on("fiscal.retry", [&db](const nlohmann::json& p) {
    const auto id = requireString(p, "id");
    db.exec("UPDATE fiscal_queue SET status='pending', updated_at=" + std::to_string(nowMs()) + " WHERE id='" + id +
            "';");
    return db.query("SELECT * FROM fiscal_queue WHERE id = ?", {id}, {})[0];
  });

  server.on("terminal.record", [&db](const nlohmann::json& p) {
    const std::string id = newId("tt");
    const auto ts = nowMs();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO terminal_transactions(id, sale_id, terminal_id, provider, amount_minor, currency, "
                       "reference, auth_code, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    if (p.contains("saleId"))
      sqlite3_bind_text(stmt, 2, p.at("saleId").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    else
      sqlite3_bind_null(stmt, 2);
    sqlite3_bind_text(stmt, 3, p.value("terminalId", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, p.value("provider", "manual").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 5, requireInt(p, "amountMinor"));
    sqlite3_bind_text(stmt, 6, p.value("currency", "AZN").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 7, p.value("reference", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 8, p.value("authCode", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 9, p.value("status", "approved").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 10, ts);
    sqlite3_bind_int64(stmt, 11, ts);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (p.value("status", "approved") == "declined") {
      throw PosError("TERMINAL_DECLINED", "Terminal declined payment");
    }
    return db.query("SELECT * FROM terminal_transactions WHERE id = ?", {id}, {})[0];
  });

  // Partial refund
  server.on("return.partial", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "PARTIAL_REFUND");
    const auto saleId = requireString(p, "saleId");
    auto sales = db.query("SELECT * FROM sales WHERE id = ?", {saleId}, {});
    if (sales.empty()) throw PosError("E_NOT_FOUND", "sale not found");
    if (sales[0].at("refunded").get<std::int64_t>() != 0)
      throw PosError("E_ALREADY_REFUNDED", "sale already fully refunded");
    const auto lines = p.at("lines");
    if (!lines.is_array() || lines.empty()) throw PosError("E_VALIDATION", "lines required");
    const std::string actor = p.value("actorId", "system");
    const std::string wh = normalizeWarehouseId(db, sales[0].value("warehouse_id", std::string{}));
    const std::string refundId = newId("ref");
    std::int64_t refundTotal = 0;
    std::string lastLineId;
    const auto saleLineTotal = std::max<std::int64_t>(
        1, db.queryInt("SELECT COALESCE(SUM(line_total_minor),0) FROM sale_items WHERE sale_id = ?", {saleId}, {}));
    const auto paidSaleTotal = sales[0].at("total_minor").get<std::int64_t>();
    db.begin();
    try {
      for (const auto& line : lines) {
        const auto saleItemId = line.at("saleItemId").get<std::int64_t>();
        const auto qty = line.at("qty").get<std::int64_t>();
        auto items = db.query("SELECT * FROM sale_items WHERE id = ? AND sale_id = ?", {}, {saleItemId});
        // bind sale_id as text
        items = db.query("SELECT * FROM sale_items WHERE id = " + std::to_string(saleItemId) + " AND sale_id = ?",
                         {saleId}, {});
        if (items.empty()) throw PosError("E_NOT_FOUND", "sale item not found");
        const auto soldQty = items[0].at("qty").get<std::int64_t>();
        const auto already = db.queryInt(
            "SELECT COALESCE(SUM(qty),0) FROM refund_lines WHERE sale_id = ? AND sale_item_id = " +
                std::to_string(saleItemId),
            {saleId}, {});
        if (qty <= 0 || already + qty > soldQty) throw PosError("INVALID_REFUND_QUANTITY", "qty exceeds remaining");
        const auto paidLine = items[0].at("line_total_minor").get<std::int64_t>();
        // Two half-up divisions instead of the old four-step truncating chain
        // (`paidLine * qty / soldQty * paidSaleTotal / saleLineTotal`), which
        // floored twice and refunded a discounted sale short of what was paid.
        // Split in two so neither product overflows on large B2B lines.
        const auto lineShare = (paidLine * qty + soldQty / 2) / soldQty;
        const auto amount = (lineShare * paidSaleTotal + saleLineTotal / 2) / saleLineTotal;
        refundTotal += amount;
        const std::string productId = items[0].at("product_id").get<std::string>();
        const std::string rid = newId("rl");
        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(db.raw(),
                           "INSERT INTO refund_lines(id, refund_id, sale_id, sale_item_id, product_id, qty, "
                           "amount_minor, created_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?)",
                           -1, &stmt, nullptr);
        sqlite3_bind_text(stmt, 1, rid.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, refundId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, saleId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 4, saleItemId);
        sqlite3_bind_text(stmt, 5, productId.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 6, qty);
        sqlite3_bind_int64(stmt, 7, amount);
        sqlite3_bind_int64(stmt, 8, nowMs());
        sqlite3_bind_text(stmt, 9, actor.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
        lastLineId = rid;
        if (p.value("restock", true)) {
          applyStockPolicy(db, "SALE_RETURN", productId, wh, qty, "refund", refundId, actor, "partial");
        }
      }
      // Mark fully refunded if all qty returned
      auto allItems = db.query("SELECT id, qty FROM sale_items WHERE sale_id = ?", {saleId}, {});
      bool full = true;
      for (const auto& it : allItems) {
        const auto id = it.at("id").get<std::int64_t>();
        const auto sold = it.at("qty").get<std::int64_t>();
        const auto got = db.queryInt(
            "SELECT COALESCE(SUM(qty),0) FROM refund_lines WHERE sale_id = ? AND sale_item_id = " + std::to_string(id),
            {saleId}, {});
        if (got < sold) full = false;
      }
      const auto saleTotal = std::max<std::int64_t>(1, sales[0].at("total_minor").get<std::int64_t>());
      if (sales[0].contains("customer_id") && !sales[0]["customer_id"].is_null()) {
        const auto customerId = sales[0]["customer_id"].get<std::string>();
        const auto saleCredit = sales[0].value<std::int64_t>("credit_minor", 0);
        const auto creditReverse = std::min<std::int64_t>(
            saleCredit, saleCredit * refundTotal / saleTotal);
        if (creditReverse > 0) {
          const auto balance = db.queryInt("SELECT COALESCE((SELECT balance_after_minor FROM customer_ledger WHERE customer_id=? ORDER BY created_at DESC LIMIT 1),0)", {customerId}, {});
          const auto id = newId("cl"); sqlite3_stmt* stmt = nullptr; sqlite3_prepare_v2(db.raw(), "INSERT INTO customer_ledger(id,customer_id,kind,amount_minor,balance_after_minor,ref_type,ref_id,note,created_at,actor_id) VALUES (?,?,?,-?,?,'refund',?,'Qaytarma',?,?)", -1, &stmt, nullptr);
          sqlite3_bind_text(stmt,1,id.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,2,customerId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,3,"refund",-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,4,creditReverse); sqlite3_bind_int64(stmt,5,balance-creditReverse); sqlite3_bind_text(stmt,6,refundId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,7,nowMs()); sqlite3_bind_text(stmt,8,actor.c_str(),-1,SQLITE_TRANSIENT); sqlite3_step(stmt); sqlite3_finalize(stmt);
        }
        const auto earnedReverse =
            sales[0].value<std::int64_t>("loyalty_earned_minor", 0) * refundTotal / saleTotal;
        const auto redeemedRestore =
            sales[0].value<std::int64_t>("loyalty_redeemed_minor", 0) * refundTotal / saleTotal;
        const auto current = db.queryInt("SELECT COALESCE((SELECT points_after FROM loyalty_ledger WHERE customer_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1),0)", {customerId}, {});
        const auto delta = redeemedRestore - std::min(current + redeemedRestore, earnedReverse);
        if (delta != 0) {
          const auto id = newId("ly"); sqlite3_stmt* stmt = nullptr; sqlite3_prepare_v2(db.raw(), "INSERT INTO loyalty_ledger(id,customer_id,points_delta,points_after,kind,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,'refund',?,?)", -1, &stmt, nullptr);
          sqlite3_bind_text(stmt,1,id.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,2,customerId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,3,delta); sqlite3_bind_int64(stmt,4,current+delta); sqlite3_bind_text(stmt,5,"refund_adjustment",-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,6,refundId.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_int64(stmt,7,nowMs()); sqlite3_step(stmt); sqlite3_finalize(stmt);
        }
      }
      if (full) {
        db.exec("UPDATE sales SET refunded = 1 WHERE id='" + saleId + "';");
        // Everything came back, so the customer is owed exactly what they paid.
        // Per-line proration can still land a qəpik or two off across many
        // lines; put the residual on the last line so the refund reconciles to
        // the sale instead of quietly short-changing the customer.
        const auto residual = paidSaleTotal - refundTotal;
        if (residual != 0 && !lastLineId.empty()) {
          sqlite3_stmt* fix = nullptr;
          sqlite3_prepare_v2(db.raw(), "UPDATE refund_lines SET amount_minor = amount_minor + ? WHERE id = ?", -1,
                             &fix, nullptr);
          sqlite3_bind_int64(fix, 1, residual);
          sqlite3_bind_text(fix, 2, lastLineId.c_str(), -1, SQLITE_TRANSIENT);
          sqlite3_step(fix);
          sqlite3_finalize(fix);
          refundTotal += residual;
        }
      }
      recordRefundCashOut(db, sales[0], refundTotal, refundId, actor);
      audit(db, actor, "PARTIAL_REFUND", saleId + " " + std::to_string(refundTotal));
      db.commit();
    } catch (...) {
      db.rollback();
      throw;
    }
    return nlohmann::json{{"refundId", refundId}, {"amountMinor", refundTotal}, {"saleId", saleId}};
  });

  // Stocktake
  server.on("stocktake.create", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "STOCK_ADJUSTMENT");
    const std::string id = newId("st");
    const auto wh = normalizeWarehouseId(db, p.value("warehouseId", std::string{}));
    const auto actor = p.value("actorId", "system");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO stocktakes(id, warehouse_id, status, created_at, created_by, note) VALUES "
                       "(?,?,'draft',?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, wh.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 3, nowMs());
    sqlite3_bind_text(stmt, 4, actor.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 5, p.value("note", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    auto products = db.query(
        "SELECT p.id AS product_id, COALESCE(sl.qty,0) AS qty FROM products p LEFT JOIN stock_levels sl ON "
        "sl.product_id = p.id AND sl.warehouse_id = ? WHERE p.active = 1",
        {wh}, {});
    for (const auto& pr : products) {
      const std::string lid = newId("stl");
      sqlite3_prepare_v2(db.raw(),
                         "INSERT INTO stocktake_lines(id, stocktake_id, product_id, expected_qty) VALUES (?,?,?,?)",
                         -1, &stmt, nullptr);
      sqlite3_bind_text(stmt, 1, lid.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 2, id.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, pr.at("product_id").get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_int64(stmt, 4, pr.at("qty").get<std::int64_t>());
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
    }
    return db.query("SELECT * FROM stocktakes WHERE id = ?", {id}, {})[0];
  });

  server.on("stocktake.updateLine", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "STOCK_ADJUSTMENT");
    const auto lineId = requireString(p, "id");
    const auto counted = requireInt(p, "countedQty");
    auto lines = db.query("SELECT * FROM stocktake_lines WHERE id = ?", {lineId}, {});
    if (lines.empty()) throw PosError("E_NOT_FOUND", "line not found");
    const auto expected = lines[0].at("expected_qty").get<std::int64_t>();
    const auto diff = counted - expected;
    auto costRows =
        db.query("SELECT cost_minor FROM products WHERE id = ?", {lines[0].at("product_id").get<std::string>()}, {});
    const auto cost = costRows.empty() ? 0 : costRows[0].at("cost_minor").get<std::int64_t>();
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "UPDATE stocktake_lines SET counted_qty=?, difference_qty=?, difference_value_minor=? WHERE id=?",
                       -1, &stmt, nullptr);
    sqlite3_bind_int64(stmt, 1, counted);
    sqlite3_bind_int64(stmt, 2, diff);
    sqlite3_bind_int64(stmt, 3, diff * cost);
    sqlite3_bind_text(stmt, 4, lineId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return db.query("SELECT * FROM stocktake_lines WHERE id = ?", {lineId}, {})[0];
  });

  server.on("stocktake.setStatus", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "STOCK_ADJUSTMENT");
    const auto id = requireString(p, "id");
    const auto status = requireString(p, "status");
    if (status != "draft" && status != "counting" && status != "review" && status != "canceled") throw PosError("E_VALIDATION", "invalid stocktake status");
    db.exec("UPDATE stocktakes SET status='" + status + "' WHERE id='" + id + "';");
    return db.query("SELECT * FROM stocktakes WHERE id = ?", {id}, {})[0];
  });

  server.on("stocktake.post", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "STOCK_ADJUSTMENT");
    const auto id = requireString(p, "id");
    auto docs = db.query("SELECT * FROM stocktakes WHERE id = ?", {id}, {});
    if (docs.empty()) throw PosError("E_NOT_FOUND", "stocktake not found");
    if (docs[0].at("status").get<std::string>() == "posted") throw PosError("E_CONFLICT", "already posted");
    const std::string wh = normalizeWarehouseId(db, docs[0].value("warehouse_id", std::string{}));
    const std::string actor = p.value("actorId", docs[0].at("created_by").get<std::string>());
    auto lines = db.query("SELECT * FROM stocktake_lines WHERE stocktake_id = ? AND counted_qty IS NOT NULL", {id},
                          {});
    db.begin();
    try {
      for (const auto& line : lines) {
        const auto productId = line.at("product_id").get<std::string>();
        const auto counted = line.at("counted_qty").get<std::int64_t>();
        const auto current = getStock(db, productId, wh);
        const auto delta = counted - current;
        if (delta != 0) {
          applyStockPolicy(db, "STOCKTAKE", productId, wh, delta, "stocktake", id, actor, "posted");
        }
      }
      sqlite3_stmt* stmt = nullptr;
      sqlite3_prepare_v2(db.raw(),
                         "UPDATE stocktakes SET status='posted', posted_at=?, posted_by=? WHERE id=?", -1, &stmt,
                         nullptr);
      sqlite3_bind_int64(stmt, 1, nowMs());
      sqlite3_bind_text(stmt, 2, actor.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_bind_text(stmt, 3, id.c_str(), -1, SQLITE_TRANSIENT);
      sqlite3_step(stmt);
      sqlite3_finalize(stmt);
      audit(db, actor, "STOCKTAKE_POST", id);
      db.commit();
    } catch (...) {
      db.rollback();
      throw;
    }
    return db.query("SELECT * FROM stocktakes WHERE id = ?", {id}, {})[0];
  });

  server.on("stocktake.list", [&db](const nlohmann::json&) {
    return db.query("SELECT * FROM stocktakes ORDER BY created_at DESC LIMIT 100");
  });
  server.on("stocktake.get", [&db](const nlohmann::json& p) {
    const auto id = requireString(p, "id");
    auto docs = db.query("SELECT * FROM stocktakes WHERE id = ?", {id}, {});
    if (docs.empty()) throw PosError("E_NOT_FOUND", "not found");
    return nlohmann::json{{"stocktake", docs[0]},
                          {"lines", db.query("SELECT l.*, p.name_az AS product_name, p.sku, p.barcode, p.internal_code FROM stocktake_lines l JOIN products p ON p.id=l.product_id WHERE l.stocktake_id = ? ORDER BY p.name_az", {id}, {})}};
  });

  // Valuation / low stock / profit
  server.on("inventory.valuation", [&db](const nlohmann::json&) {
    // The per-warehouse filter used to be concatenated into the SQL unescaped.
    // With a single warehouse it has no meaning left, so the injection is
    // removed by removing the string building rather than by adding a bind.
    auto rows = db.query(
        "SELECT p.category, sl.warehouse_id AS warehouseId, SUM(sl.qty) AS qty, "
        "SUM(sl.qty * COALESCE(p.avg_cost_minor, p.cost_minor)) AS costValueMinor, "
        "SUM(sl.qty * p.price_minor) AS retailValueMinor "
        "FROM stock_levels sl JOIN products p ON p.id = sl.product_id WHERE p.active = 1 "
        "GROUP BY p.category");
    std::int64_t cost = 0, retail = 0;
    for (const auto& r : rows) {
      cost += r.value("costValueMinor", 0);
      retail += r.value("retailValueMinor", 0);
    }
    return nlohmann::json{{"rows", rows},
                          {"costValueMinor", cost},
                          {"retailValueMinor", retail},
                          {"potentialMarginMinor", retail - cost}};
  });

  server.on("inventory.lowStock", [&db](const nlohmann::json&) {
    return db.query(
        "SELECT p.id AS productId, p.sku, p.name_az AS name, p.min_stock AS minStock, p.target_stock AS targetStock, "
        "p.reorder_qty AS reorderQty, p.preferred_supplier AS preferredSupplier, "
        "COALESCE(SUM(sl.qty),0) AS qty, "
        "CASE WHEN p.target_stock > 0 THEN MAX(p.target_stock - COALESCE(SUM(sl.qty),0), 0) "
        "ELSE MAX(p.min_stock - COALESCE(SUM(sl.qty),0), 0) END AS suggestedOrderQty "
        "FROM products p LEFT JOIN stock_levels sl ON sl.product_id = p.id WHERE p.active = 1 "
        "GROUP BY p.id HAVING COALESCE(SUM(sl.qty),0) <= p.min_stock ORDER BY qty");
  });

  server.on("report.profit", [&db](const nlohmann::json& p) {
    const auto from = p.value("fromMs", nowMs() - 86400000LL * 30);
    const auto to = p.value("toMs", nowMs());
    return db.query(
        "SELECT si.product_id AS productId, p.category, p.name_az AS name, SUM(si.qty) AS qty, "
        "SUM(si.line_total_minor) AS revenueMinor, "
        "SUM(si.qty * COALESCE(p.avg_cost_minor, p.cost_minor)) AS cogsMinor, "
        "SUM(si.line_total_minor) - SUM(si.qty * COALESCE(p.avg_cost_minor, p.cost_minor)) AS profitMinor "
        "FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id "
        "WHERE s.refunded = 0 AND s.created_at >= ? AND s.created_at <= ? "
        "GROUP BY si.product_id ORDER BY profitMinor DESC",
        {}, {from, to});
  });

  // Customers / nisyə
  // Same projection as customer.summary, ordered by name. It used to be
  // `SELECT *`, which handed the renderer snake_case columns (loyalty_card,
  // credit_allowed) and no balance/bonus at all — so anything reading it saw
  // undefined loyaltyCard and loyaltyMinor, silently disabling card lookup and
  // bonus redemption. Two endpoints describing the same customer must not
  // disagree about the field names.
  server.on("customer.list", [&db](const nlohmann::json&) {
    return db.query(CUSTOMER_PROJECTION_SQL + std::string(" ORDER BY c.name"));
  });
  server.on("portal.finance", [&db](const nlohmann::json&) {
    const auto customers = db.query(
        "SELECT c.id, c.name, COALESCE((SELECT balance_after_minor FROM customer_ledger l "
        "WHERE l.customer_id = c.id ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1), 0) AS debtMinor "
        "FROM customers c WHERE c.active = 1 ORDER BY c.name LIMIT 5000", {}, {});
    const auto suppliers = db.query(
        "SELECT name AS id, name, COALESCE((SELECT balance_after_minor FROM supplier_ledger l "
        "WHERE l.supplier_name = name ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1), 0) AS dueMinor "
        "FROM (SELECT supplier_name AS name FROM supplier_ledger "
        "UNION SELECT supplier AS name FROM purchase_orders) WHERE name <> '' ORDER BY name LIMIT 5000", {}, {});
    const auto payments = db.query(
        "SELECT l.id, 'customer' AS partyType, l.customer_id AS partyId, "
        "COALESCE(c.name, l.customer_id) AS partyName, -l.amount_minor AS amountMinor, "
        "l.note, l.created_at AS createdAt FROM customer_ledger l "
        "LEFT JOIN customers c ON c.id = l.customer_id WHERE l.kind = 'payment' "
        "UNION ALL SELECT l.id, 'supplier', l.supplier_name, l.supplier_name, "
        "-l.amount_minor, l.note, l.created_at FROM supplier_ledger l WHERE l.kind = 'payment' "
        "ORDER BY createdAt DESC LIMIT 5000", {}, {});
    return nlohmann::json{{"customers", customers}, {"suppliers", suppliers}, {"payments", payments}};
  });
  server.on("customer.create", [&db](const nlohmann::json& p) {
    const std::string id = p.value("id", newId("cust"));
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO customers(id, name, phone, credit_allowed, credit_limit_minor, loyalty_card, "
                       "active, created_at) VALUES (?,?,?,?,?,?,1,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, requireString(p, "name").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, p.value("phone", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 4, p.value("creditAllowed", false) ? 1 : 0);
    sqlite3_bind_int64(stmt, 5, p.value("creditLimitMinor", 0));
    sqlite3_bind_text(stmt, 6, p.value("loyaltyCard", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 7, nowMs());
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return db.query("SELECT * FROM customers WHERE id = ?", {id}, {})[0];
  });
  server.on("customer.update", [&db](const nlohmann::json& p) {
    const auto id = requireString(p, "id");
    auto cur = db.query("SELECT * FROM customers WHERE id = ?", {id}, {});
    if (cur.empty()) throw PosError("E_NOT_FOUND", "customer not found");
    const auto& c = cur[0];

    // A partial update must stay partial. Every omitted field used to be bound
    // as ''/false/0, so assigning a loyalty card to an existing customer wiped
    // their name, phone and credit limit — which is the one edit this endpoint
    // exists for.
    const auto name = p.contains("name") ? p.at("name").get<std::string>() : columnOr(c, "name", "");
    const auto phone = p.contains("phone") ? p.at("phone").get<std::string>() : columnOr(c, "phone", "");
    const bool creditAllowed = p.contains("creditAllowed")
                                   ? p.at("creditAllowed").get<bool>()
                                   : columnOr<std::int64_t>(c, "credit_allowed", 0) != 0;
    const auto creditLimit = p.contains("creditLimitMinor")
                                 ? p.at("creditLimitMinor").get<std::int64_t>()
                                 : columnOr<std::int64_t>(c, "credit_limit_minor", 0);
    auto card = p.contains("loyaltyCard") ? p.at("loyaltyCard").get<std::string>()
                                          : columnOr(c, "loyalty_card", "");
    // Cards are scanned, so surrounding whitespace from a keyboard wedge or a
    // pasted list must not become part of the identity.
    while (!card.empty() && std::isspace(static_cast<unsigned char>(card.front()))) card.erase(card.begin());
    while (!card.empty() && std::isspace(static_cast<unsigned char>(card.back()))) card.pop_back();
    if (name.empty()) throw PosError("E_VALIDATION", "name is required");

    // One card, one customer — otherwise a scan is ambiguous. The unique index
    // would reject it anyway; this turns that into a message a cashier can read.
    if (!card.empty()) {
      const auto clash = db.queryInt(
          "SELECT COUNT(*) FROM customers WHERE loyalty_card = ? AND id <> ?", {card, id}, {});
      if (clash > 0) throw PosError("E_VALIDATION", "loyalty card already belongs to another customer");
    }

    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "UPDATE customers SET name=?, phone=?, credit_allowed=?, credit_limit_minor=?, loyalty_card=? "
                       "WHERE id=?",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, phone.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 3, creditAllowed ? 1 : 0);
    sqlite3_bind_int64(stmt, 4, creditLimit);
    // NULL rather than '' so the partial unique index stays meaningful.
    if (card.empty()) sqlite3_bind_null(stmt, 5);
    else sqlite3_bind_text(stmt, 5, card.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 6, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    audit(db, p.value("actorId", "system"), "CUSTOMER_UPDATE", id);
    return db.query(CUSTOMER_PROJECTION_SQL + std::string(" AND c.id = ?"), {id}, {})[0];
  });
  server.on("customer.ledger", [&db](const nlohmann::json& p) {
    return db.query("SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY created_at DESC",
                    {requireString(p, "customerId")}, {});
  });
  server.on("customer.payDebt", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "CUSTOMER_DEBT");
    const auto customerId = requireString(p, "customerId");
    const auto amount = requireInt(p, "amountMinor");
    if (amount <= 0) throw PosError("E_VALIDATION", "amount must be > 0");
    const std::string portalCommandId = p.value("portalCommandId", "");
    const std::string id = portalCommandId.empty() ? newId("cl") : "cl-" + portalCommandId;
    const auto previous = db.query("SELECT customer_id, amount_minor, balance_after_minor FROM customer_ledger WHERE id = ?", {id}, {});
    if (!previous.empty()) {
      if (previous[0].at("customer_id") != customerId || previous[0].at("amount_minor") != -amount)
        throw PosError("E_CONFLICT", "Portal command id was reused with another customer payment");
      return nlohmann::json{{"balanceMinor", previous[0].at("balance_after_minor")}, {"idempotentReplay", true}};
    }
    if (db.queryInt("SELECT COUNT(*) FROM customers WHERE id = ? AND active = 1", {customerId}, {}) != 1)
      throw PosError("E_NOT_FOUND", "customer not found");
    const auto bal = db.queryInt(
        "SELECT COALESCE((SELECT balance_after_minor FROM customer_ledger WHERE customer_id = ? ORDER BY created_at "
        "DESC, rowid DESC LIMIT 1),0)",
        {customerId}, {});
    const auto next = bal - amount;
    if (!portalCommandId.empty() && next < 0) throw PosError("E_VALIDATION", "payment exceeds customer debt");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO customer_ledger(id, customer_id, kind, amount_minor, balance_after_minor, "
                       "ref_type, ref_id, note, created_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, customerId.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, "payment", -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 4, -amount);
    sqlite3_bind_int64(stmt, 5, next);
    sqlite3_bind_text(stmt, 6, "payment", -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 7, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 8, p.value("note", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 9, nowMs());
    sqlite3_bind_text(stmt, 10, p.value("actorId", "system").c_str(), -1, SQLITE_TRANSIENT);
    if (sqlite3_step(stmt) != SQLITE_DONE) {
      const auto message = std::string(sqlite3_errmsg(db.raw()));
      sqlite3_finalize(stmt);
      throw PosError("E_DB", message, true);
    }
    sqlite3_finalize(stmt);
    return nlohmann::json{{"balanceMinor", next}};
  });
  server.on("customer.summary", [&db](const nlohmann::json&) {
    return db.query(CUSTOMER_PROJECTION_SQL + std::string(" ORDER BY balanceMinor DESC, c.name"));
  });

  server.on("supplier.ledger", [&db](const nlohmann::json& p) {
    return db.query("SELECT * FROM supplier_ledger WHERE supplier_name = ? ORDER BY created_at DESC",
                    {requireString(p, "supplierName")}, {});
  });
  server.on("supplier.pay", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "SUPPLIER_DEBT");
    const auto name = requireString(p, "supplierName");
    const auto amount = requireInt(p, "amountMinor");
    if (amount <= 0) throw PosError("E_VALIDATION", "amount must be > 0");
    const std::string portalCommandId = p.value("portalCommandId", "");
    const std::string id = portalCommandId.empty() ? newId("sl") : "sl-" + portalCommandId;
    const auto previous = db.query("SELECT supplier_name, amount_minor, balance_after_minor FROM supplier_ledger WHERE id = ?", {id}, {});
    if (!previous.empty()) {
      if (previous[0].at("supplier_name") != name || previous[0].at("amount_minor") != -amount)
        throw PosError("E_CONFLICT", "Portal command id was reused with another supplier payment");
      return nlohmann::json{{"balanceMinor", previous[0].at("balance_after_minor")}, {"idempotentReplay", true}};
    }
    const auto bal = db.queryInt(
        "SELECT COALESCE((SELECT balance_after_minor FROM supplier_ledger WHERE supplier_name = ? ORDER BY created_at "
        "DESC, rowid DESC LIMIT 1),0)",
        {name}, {});
    const auto next = bal - amount;
    if (!portalCommandId.empty() && next < 0) throw PosError("E_VALIDATION", "payment exceeds supplier debt");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO supplier_ledger(id, supplier_name, kind, amount_minor, balance_after_minor, "
                       "ref_type, ref_id, note, created_at, actor_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, "payment", -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 4, -amount);
    sqlite3_bind_int64(stmt, 5, next);
    sqlite3_bind_text(stmt, 6, "payment", -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 7, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 8, p.value("note", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 9, nowMs());
    sqlite3_bind_text(stmt, 10, p.value("actorId", "system").c_str(), -1, SQLITE_TRANSIENT);
    if (sqlite3_step(stmt) != SQLITE_DONE) {
      const auto message = std::string(sqlite3_errmsg(db.raw()));
      sqlite3_finalize(stmt);
      throw PosError("E_DB", message, true);
    }
    sqlite3_finalize(stmt);
    return nlohmann::json{{"balanceMinor", next}};
  });
  server.on("supplier.summary", [&db](const nlohmann::json&) {
    return db.query("SELECT supplier_name AS supplierName, MAX(created_at) AS updatedAt, (SELECT balance_after_minor FROM supplier_ledger x WHERE x.supplier_name=supplier_ledger.supplier_name ORDER BY created_at DESC LIMIT 1) AS balanceMinor FROM supplier_ledger GROUP BY supplier_name ORDER BY balanceMinor DESC");
  });

  server.on("loyalty.config", [&db](const nlohmann::json&) {
    std::int64_t rate = 0; try { rate = std::stoll(db.queryText("SELECT value FROM settings WHERE key='loyaltyRateBps'")); } catch (...) {}
    // "enabled" is the rate being above zero — there is no separate switch.
    // minorPerPoint is gone: bonus is stored as money (qəpik), never points,
    // so a conversion factor of 1 only invited someone to divide by it.
    return nlohmann::json{{"enabled", rate > 0}, {"rateBps", rate}};
  });
  server.on("promo.list", [&db](const nlohmann::json&) {
    return db.query("SELECT * FROM promotions ORDER BY priority");
  });
  server.on("promo.upsert", [&db](const nlohmann::json& p) {
    const std::string id = p.value("id", newId("promo"));
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO promotions(id, name, kind, config_json, active, starts_at, ends_at, priority) "
                       "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, "
                       "config_json=excluded.config_json, active=excluded.active, starts_at=excluded.starts_at, "
                       "ends_at=excluded.ends_at, priority=excluded.priority",
                       -1, &stmt, nullptr);
    const std::string cfg = p.value("config", nlohmann::json::object()).dump();
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, requireString(p, "name").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, requireString(p, "kind").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, cfg.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 5, p.value("active", true) ? 1 : 0);
    if (p.contains("startsAt")) sqlite3_bind_int64(stmt, 6, p.at("startsAt").get<std::int64_t>());
    else sqlite3_bind_null(stmt, 6);
    if (p.contains("endsAt")) sqlite3_bind_int64(stmt, 7, p.at("endsAt").get<std::int64_t>());
    else sqlite3_bind_null(stmt, 7);
    sqlite3_bind_int64(stmt, 8, p.value("priority", 100));
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return db.query("SELECT * FROM promotions WHERE id = ?", {id}, {})[0];
  });
  server.on("promo.evaluate", [&db](const nlohmann::json& p) {
    // Deterministic: percentage / fixed on matching productId in config
    auto promos = db.query("SELECT * FROM promotions WHERE active = 1 ORDER BY priority");
    const auto items = p.value("items", nlohmann::json::array());
    nlohmann::json applied = nlohmann::json::array();
    std::int64_t discount = 0;
    for (const auto& promo : promos) {
      nlohmann::json cfg;
      try {
        cfg = nlohmann::json::parse(promo.at("config_json").get<std::string>());
      } catch (...) {
        continue;
      }
      const std::string kind = promo.at("kind").get<std::string>();
      if (kind == "percent" && cfg.contains("productId") && cfg.contains("percent")) {
        for (const auto& item : items) {
          if (item.value("productId", "") == cfg["productId"].get<std::string>()) {
            const auto line = item.value("qty", 1) * item.value("unitPriceMinor", 0);
            const auto d = line * cfg["percent"].get<std::int64_t>() / 100;
            discount += d;
            applied.push_back({{"promoId", promo.at("id")},
                               {"name", promo.at("name")},
                               {"explanation", std::to_string(cfg["percent"].get<std::int64_t>()) + "% off"},
                               {"discountMinor", d}});
          }
        }
      } else if (kind == "fixed" && cfg.contains("productId") && cfg.contains("amountMinor")) {
        for (const auto& item : items) {
          if (item.value("productId", "") == cfg["productId"].get<std::string>()) {
            const auto d = cfg["amountMinor"].get<std::int64_t>();
            discount += d;
            applied.push_back({{"promoId", promo.at("id")},
                               {"name", promo.at("name")},
                               {"explanation", "fixed discount"},
                               {"discountMinor", d}});
          }
        }
      }
    }
    return nlohmann::json{{"discountMinor", discount}, {"applied", applied}};
  });

  server.on("lot.list", [&db](const nlohmann::json& p) {
    if (p.contains("productId"))
      return db.query("SELECT * FROM product_lots WHERE product_id = ?", {requireString(p, "productId")}, {});
    return db.query("SELECT * FROM product_lots ORDER BY expires_at");
  });
  server.on("lot.receive", [&db](const nlohmann::json& p) {
    const std::string id = newId("lot");
    sqlite3_stmt* stmt = nullptr;
    sqlite3_prepare_v2(db.raw(),
                       "INSERT INTO product_lots(id, product_id, warehouse_id, lot_number, produced_at, expires_at, "
                       "qty_remaining, supplier, purchase_ref) VALUES (?,?,?,?,?,?,?,?,?)",
                       -1, &stmt, nullptr);
    sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, requireString(p, "productId").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, normalizeWarehouseId(db, p.value("warehouseId", std::string{})).c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, requireString(p, "lotNumber").c_str(), -1, SQLITE_TRANSIENT);
    if (p.contains("producedAt")) sqlite3_bind_int64(stmt, 5, p.at("producedAt").get<std::int64_t>());
    else sqlite3_bind_null(stmt, 5);
    if (p.contains("expiresAt")) sqlite3_bind_int64(stmt, 6, p.at("expiresAt").get<std::int64_t>());
    else sqlite3_bind_null(stmt, 6);
    sqlite3_bind_int64(stmt, 7, requireInt(p, "qty"));
    sqlite3_bind_text(stmt, 8, p.value("supplier", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 9, p.value("purchaseRef", "").c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    applyStockPolicy(db, "PURCHASE", requireString(p, "productId"),
                     normalizeWarehouseId(db, p.value("warehouseId", std::string{})),
                     requireInt(p, "qty"), "lot", id, p.value("actorId", "system"), "lot receive");
    return db.query("SELECT * FROM product_lots WHERE id = ?", {id}, {})[0];
  });
  server.on("lot.expiryReport", [&db](const nlohmann::json& p) {
    const auto days = p.value("withinDays", 14);
    const auto until = nowMs() + days * 86400000LL;
    return db.query(
        "SELECT * FROM product_lots WHERE expires_at IS NOT NULL AND expires_at <= ? AND qty_remaining > 0 "
        "ORDER BY expires_at",
        {}, {until});
  });

  // Import preview/commit (CSV rows as JSON array)
  server.on("product.importPreview", [&db](const nlohmann::json& p) {
    const auto rows = p.at("rows");
    nlohmann::json errors = nlohmann::json::array();
    int ok = 0;
    int i = 0;
    for (const auto& row : rows) {
      ++i;
      if (!row.contains("sku") || !row.contains("barcode") || !row.contains("name") || !row.contains("priceMinor")) {
        errors.push_back({{"row", i}, {"error", "missing required fields"}});
        continue;
      }
      if (row.at("priceMinor").get<std::int64_t>() < 0) {
        errors.push_back({{"row", i}, {"error", "negative price"}});
        continue;
      }
      ++ok;
    }
    return nlohmann::json{{"validRows", ok}, {"errors", errors}, {"total", rows.size()}};
  });
  server.on("product.importCommit", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "CREATE_PRODUCT");
    const auto rows = p.at("rows");
    if (p.value("dryRun", false)) {
      nlohmann::json errors = nlohmann::json::array();
      int ok = 0;
      int i = 0;
      for (const auto& row : rows) {
        ++i;
        if (!row.contains("sku") || !row.contains("barcode") || !row.contains("name") || !row.contains("priceMinor")) {
          errors.push_back({{"row", i}, {"error", "missing required fields"}});
          continue;
        }
        ++ok;
      }
      return nlohmann::json{{"dryRun", true}, {"validRows", ok}, {"errors", errors}};
    }
    db.begin();
    try {
      for (const auto& row : rows) {
        const std::string id = newId("p");
        sqlite3_stmt* stmt = nullptr;
        sqlite3_prepare_v2(db.raw(),
                           "INSERT INTO products(id, sku, barcode, name_az, name_ru, name_en, category, unit, "
                           "price_minor, cost_minor, min_stock, tax_rate, supplier, accent, image_json, active, "
                           "created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                           -1, &stmt, nullptr);
        const std::string imageJson = "{\"kind\":\"url\",\"url\":\"\"}";
        const std::string sku = row.at("sku").get<std::string>();
        const std::string barcode = row.at("barcode").get<std::string>();
        const std::string nameAz = row.at("name").get<std::string>();
        const std::string nameRu = db::columnOr(row, "nameRu", "");
        const std::string nameEn = db::columnOr(row, "nameEn", "");
        const std::string category = db::columnOr(row, "category", "Digər");
        const std::string unit = db::columnOr(row, "unit", "əd");
        const std::string supplier = db::columnOr(row, "supplier", "");
        sqlite3_bind_text(stmt, 1, id.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 2, sku.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, barcode.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 4, nameAz.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 5, nameRu.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 6, nameEn.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 7, category.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 8, unit.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 9, row.at("priceMinor").get<std::int64_t>());
        sqlite3_bind_int64(stmt, 10, db::columnOr(row, "costMinor", 0));
        sqlite3_bind_int64(stmt, 11, db::columnOr(row, "minStock", 0));
        sqlite3_bind_int64(stmt, 12, db::columnOr(row, "taxRate", 18));
        sqlite3_bind_text(stmt, 13, supplier.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 14, "#2563eb", -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 15, imageJson.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 16, 1);
        sqlite3_bind_int64(stmt, 17, nowMs());
        if (sqlite3_step(stmt) != SQLITE_DONE) {
          sqlite3_finalize(stmt);
          throw PosError("E_DB", sqlite3_errmsg(db.raw()), true);
        }
        sqlite3_finalize(stmt);
      }
      db.commit();
    } catch (...) {
      db.rollback();
      throw;
    }
    return nlohmann::json{{"imported", rows.size()}};
  });

  // Phase 6 platform stubs — real sync / e-qaimə / aggregators need vendor docs
  server.on("platform.syncStatus", [&db](const nlohmann::json&) {
    const auto pending = db.queryInt("SELECT COUNT(*) FROM sync_meta WHERE sync_state != 'synced'");
    return nlohmann::json{{"status", "local_only"},
                          {"pendingEntities", pending},
                          {"note", "Multi-branch sync not configured; UUID entities ready"}};
  });
  server.on("platform.priceScopes", [&db](const nlohmann::json&) {
    return db.query("SELECT * FROM price_scopes ORDER BY product_id LIMIT 200");
  });
  server.on("platform.eqaimeStatus", [](const nlohmann::json&) {
    return nlohmann::json{{"provider", "stub"},
                          {"status", "not_configured"},
                          {"docs", "market-pos/docs/INTEGRATIONS.md"}};
  });
  server.on("platform.aggregatorStatus", [](const nlohmann::json&) {
    return nlohmann::json{{"provider", "stub"},
                          {"status", "not_configured"},
                          {"supported", nlohmann::json::array({"wolt", "bolt", "custom"})}};
  });
  server.on("settings.setValue", [&db](const nlohmann::json& p) {
    requirePermission(db, p, "MANAGE_SETTINGS");
    const auto key = requireString(p, "key");
    if (key != "stockPolicy" && key != "loyaltyRateBps" && key != "backupRetentionDays") throw PosError("E_VALIDATION", "setting is not editable");
    const auto value = p.at("value").is_string() && key == "stockPolicy" ? p.at("value").dump() : p.at("value").is_string() ? p.at("value").get<std::string>() : p.at("value").dump();
    sqlite3_stmt* stmt = nullptr; sqlite3_prepare_v2(db.raw(), "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", -1, &stmt, nullptr); sqlite3_bind_text(stmt,1,key.c_str(),-1,SQLITE_TRANSIENT); sqlite3_bind_text(stmt,2,value.c_str(),-1,SQLITE_TRANSIENT); sqlite3_step(stmt); sqlite3_finalize(stmt);
    audit(db,p.value("actorId","system"),"SETTING_CHANGE",key); return nlohmann::json{{"key",key},{"value",value}};
  });
}

}  // namespace market
