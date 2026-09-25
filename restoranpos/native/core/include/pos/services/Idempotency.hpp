#pragma once

#include <optional>
#include <string>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

/**
 * Durable request de-duplication.
 *
 * The renderer mints a key when an *intent* is created (order draft opened,
 * payment sheet mounted) and reuses it across retries, so two clicks are one
 * intention. Electron's main process coalesces duplicates still in flight; this
 * class is the authority that survives a restart.
 *
 * A replayed key returns the ORIGINAL response verbatim rather than an error -
 * the caller gets the same order id and totals it would have got first time.
 */
class Idempotency {
public:
    explicit Idempotency(handlers::Context& ctx) : ctx_(ctx) {}

    /**
     * Claims a key.
     *
     * Returns the stored response when this key already completed (the caller
     * should return it unchanged). Returns nullopt when the caller should do
     * the real work. Throws when the key is being reused with a different
     * payload, or an identical request is still running.
     *
     * Must be called inside the same transaction as the work it guards, so a
     * crash rolls the claim back along with everything else.
     */
    std::optional<Json> begin(const std::string& key, const std::string& method,
                              const Json& payload);

    /** Marks the key completed and stores the response for future replays. */
    void complete(const std::string& key, const Json& response, std::string_view entityType,
                  const std::string& entityId);

    /** Drops expired keys. Called during startup housekeeping. */
    static int purgeExpired(db::Database& db);

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
