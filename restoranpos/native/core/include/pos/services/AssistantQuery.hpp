#pragma once

#include <string>

#include "pos/Common.hpp"

namespace pos::services {

/**
 * The assistant's read-only window on the till's data.
 *
 * One SELECT (or WITH ... SELECT) runs on its own read-only connection to the
 * database file, so it can never write, never sees an open transaction and
 * never blocks the till. An authorizer admits only business tables and keeps
 * secrets out (PIN hashes, card digits, bank references, idempotency keys,
 * settings, licence and sync state). At most kMaxRows rows come back and a
 * query is interrupted after about two seconds.
 */
Json runAssistantQuery(const std::string& databasePath, const std::string& sql);

}  // namespace pos::services
