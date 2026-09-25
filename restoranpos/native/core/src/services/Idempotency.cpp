#include "pos/services/Idempotency.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {
namespace {

/** Keys live long enough to cover a service, not forever. */
constexpr Timestamp kTtlMs = 24LL * 60 * 60 * 1000;
constexpr Timestamp kPortalTtlMs = 5LL * 365 * 24 * 60 * 60 * 1000;

/** A claim older than this was abandoned by a crash and may be retaken. */
constexpr Timestamp kStaleInProgressMs = 30 * 1000;

/**
 * Fingerprints the request so a key reused with different data is caught.
 * The key itself is excluded, since it is not part of the intent.
 */
std::string fingerprint(const std::string& method, const Json& payload) {
    Json canonical = payload.is_object() ? payload : Json::object();
    canonical.erase("idempotencyKey");
    return crypto::sha256Hex(method + "|" + serialize(canonical));
}

}  // namespace

std::optional<Json> Idempotency::begin(const std::string& key, const std::string& method,
                                       const Json& payload) {
    if (key.empty()) return std::nullopt;

    const std::string hash = fingerprint(method, payload);
    const auto now = nowMs();

    auto existing = ctx_.db().prepare(
        "SELECT status, request_hash, response_json, created_at FROM idempotency_keys "
        "WHERE key = :key");
    existing.bind(":key", key);

    if (existing.step()) {
        const std::string status = existing.columnText(0);
        const std::string storedHash = existing.columnText(1);
        const std::string response = existing.columnText(2);
        const auto createdAt = existing.columnInt(3);

        if (storedHash != hash) {
            throw PosError(std::string(protocol::err::kIdempotencyKeyReuse),
                           "This request key was already used with different data");
        }

        if (status == "completed") {
            try {
                Json stored = Json::parse(response);
                stored["idempotentReplay"] = true;
                return stored;
            } catch (const std::exception&) {
                // Unreadable stored response: treat as not-yet-done rather than
                // failing the caller outright.
                return std::nullopt;
            }
        }

        if (now - createdAt < kStaleInProgressMs) {
            throw PosError::of(protocol::err::kInProgress);
        }

        // Abandoned by a crash - take it over.
        auto clear = ctx_.db().prepare("DELETE FROM idempotency_keys WHERE key = :key");
        clear.bind(":key", key);
        clear.exec();
    }

    auto claim = ctx_.db().prepare(
        "INSERT INTO idempotency_keys (key, method, request_hash, status, created_at, expires_at) "
        "VALUES (:key, :method, :hash, 'in_progress', :now, :expires)");
    claim.bind(":key", key)
        .bind(":method", method)
        .bind(":hash", hash)
        .bind(":now", now)
        .bind(":expires", now + (key.rfind("portal-", 0) == 0 ? kPortalTtlMs : kTtlMs));
    claim.exec();

    return std::nullopt;
}

void Idempotency::complete(const std::string& key, const Json& response,
                           std::string_view entityType, const std::string& entityId) {
    if (key.empty()) return;

    auto stmt = ctx_.db().prepare(
        "UPDATE idempotency_keys SET status = 'completed', response_json = :response, "
        "                            entity_type = :entityType, entity_id = :entityId "
        "WHERE key = :key");
    stmt.bind(":response", serialize(response))
        .bind(":entityType", std::string(entityType))
        .bind(":entityId", entityId)
        .bind(":key", key);
    stmt.exec();
}

int Idempotency::purgeExpired(db::Database& db) {
    auto stmt = db.prepare("DELETE FROM idempotency_keys WHERE expires_at < :now");
    stmt.bind(":now", nowMs());
    stmt.exec();
    return db.changes();
}

}  // namespace pos::services
