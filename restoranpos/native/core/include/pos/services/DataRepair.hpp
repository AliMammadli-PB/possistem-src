#pragma once

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

/**
 * Puts right stock data that older versions left wrong. Runs at every start, changes nothing when
 * all is well, and either finishes or rolls back. Returns what it changed, also kept in data_repairs.
 */
Json repairStockData(handlers::Context& ctx);

/** Also called when a dish is archived, so its card leaves the pickers at once. */
std::int64_t retireArchivedCards(db::Database& db);

}  // namespace pos::services
