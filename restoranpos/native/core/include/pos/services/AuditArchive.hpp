#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "pos/Common.hpp"
#include "pos/db/Database.hpp"

namespace pos::services {

/**
 * Keeps `audit_logs` from growing for the life of the till.
 *
 * The table is append-only by trigger, so nothing ever removed a row: the
 * history of every order line, void, discount and login accumulated in `pos.db`
 * on the restaurant's own disk, indefinitely. Deleting it outright is not an
 * option either — the trail is the reason the table exists.
 *
 * So old entries are written out as newline-delimited JSON under the data
 * directory, next to the database they came from, and only then removed. Full
 * detail stays on the machine; the file the till depends on to take an order
 * stays small.
 *
 * Two conditions must both hold before an entry is archived:
 *
 *   - it is older than `audit.retentionDays`
 *   - control has already acknowledged it (`audit.sync.watermarkAt`), or it is
 *     older than the hard limit, so a till that never syncs still gets swept
 *
 * The prune itself is recorded as an audit entry, and the escape-hatch flag it
 * needs (`audit.pruneAllowed`) is cleared again immediately — see
 * database/migrations/024_audit_retention.sql.
 */
class AuditArchive {
public:
    struct Result {
        int archived = 0;
        /** Absolute paths written, one per calendar month touched. */
        std::vector<std::string> files;
        std::string error;
    };

    /**
     * Archives and prunes in bounded batches. Called during startup
     * housekeeping, where a slow sweep delays nothing the user is waiting on.
     *
     * Never throws: a till that cannot write its archive must still open.
     */
    static Result run(db::Database& db, const std::string& dbPath);

    /** `<dirname(dbPath)>/audit-archive` — created on demand. */
    static std::string archiveDir(const std::string& dbPath);

private:
    static std::int64_t settingInt(db::Database& db, const std::string& key,
                                   std::int64_t fallback);
    static void setSetting(db::Database& db, const std::string& key, const std::string& value);
};

}  // namespace pos::services
