#pragma once

#include <cstdint>
#include <string>

#include "pos/Common.hpp"
#include "pos/db/Database.hpp"

namespace pos::services {

/**
 * Turns a till's database back into a new install, for the signed `data.wipeAll`
 * command only. The renderer, the LAN server and the portal cannot call it: the
 * method is in none of their allowlists.
 *
 * A fresh database is built next to the live one and restored over it, because
 * deleting row by row would fight the triggers that keep reports and the audit
 * log immutable. The licence and the till's identity move across, so the till
 * stays activated. The old database stays in `backups/` for 30 days; every older
 * copy and the archived audit trail go now, or "all data" would not be true.
 */
class DataWipe {
public:
    /** Returns the file name of the copy kept in `backups/`. */
    static std::string run(db::Database& db);

    /** Moves this till's licence and identity from the database at `fromPath` into `target`. */
    static void carryIdentity(db::Database& target, const std::string& fromPath);

    /** Removes kept copies older than 30 days. Never throws: called on every start. */
    static void purgeExpiredCopies(const std::string& dbPath, std::int64_t now);
};

}  // namespace pos::services
