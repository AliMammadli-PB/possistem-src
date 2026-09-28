#pragma once
#include "market/db/Database.hpp"
#include <string>

namespace market {

/**
 * Single-stock model: the shop keeps one warehouse and the UI never shows it.
 *
 * These exist because `settings.defaultWarehouseId` could name a row that was
 * never created — the seed ships 'wh-sales' but a shop that makes its own
 * warehouses never gets it. `stock_levels.warehouse_id` is a real foreign key
 * and `foreign_keys` is ON, so a dangling setting does not merely display an
 * empty stock: every sale fails on SQLITE_CONSTRAINT and rolls back.
 */

/** Read-only. Returns "" only when no warehouse exists yet. */
std::string primaryWarehouseId(db::Database& db);

/** Write path: creates the implicit warehouse if the table is empty. */
std::string ensurePrimaryWarehouse(db::Database& db);

/**
 * What every handler that still accepts a `warehouseId` on the wire calls.
 * The requested value is ignored — kept as a parameter so callers read as
 * deliberate rather than as an oversight, and so peers on the old protocol
 * keep working.
 */
std::string normalizeWarehouseId(db::Database& db, const std::string& requested);

/** Repairs a dangling `defaultWarehouseId`. Called once at startup. */
void repairWarehouseSetting(db::Database& db);

}  // namespace market
