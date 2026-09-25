#pragma once

#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

#include "pos/Common.hpp"
#include "pos/db/Database.hpp"
#include "pos/ipc/StdioServer.hpp"

namespace pos::handlers {

/**
 * The currently authenticated operator.
 *
 * Held in the core rather than the renderer so a compromised or reloaded UI
 * cannot claim a role it was not granted. The Electron main process keeps a
 * mirror purely for routing decisions.
 */
struct Session {
    std::string userId;
    std::string code;
    std::string fullName;
    std::string role;
    std::string shiftId;
    std::unordered_set<std::string> permissions;
    Timestamp loginAt = 0;
    bool authenticated = false;

    void clear() { *this = Session{}; }
};

/** Shared state handed to every request handler. */
class Context {
public:
    Context(ipc::StdioServer& server, db::Database& database)
        : server_(server), database_(database) {}

    db::Database& db() { return database_; }
    ipc::StdioServer& server() { return server_; }
    Session& session() { return session_; }

    /** Throws E_UNAUTHORIZED unless someone is logged in. */
    const Session& requireAuth() const;

    /** Throws E_FORBIDDEN unless the session carries the permission. */
    void requirePermission(std::string_view permission) const;

    /**
     * Confirms a manager-level override.
     *
     * Accepts either an already-privileged session or a supplied manager PIN.
     * Every successful override is written to the audit log with the approver.
     */
    std::string requireManagerApproval(std::string_view permission, const std::string& managerPin,
                                       std::string_view action);

    /** Appends an audit entry. Never throws; auditing must not block business flow. */
    void audit(std::string_view action, std::string_view entityType, std::string_view entityId,
               Json data = Json::object(), const std::string& actorOverride = "");

    /**
     * Appends an audit entry and throws E_INTERNAL if the write fails.
     * Use for financial/admin mutations that must not continue without a trail.
     */
    void auditRequired(std::string_view action, std::string_view entityType,
                       std::string_view entityId, Json data = Json::object(),
                       const std::string& actorOverride = "");

    std::string setting(std::string_view key, const std::string& fallback = "");
    std::int64_t settingInt(std::string_view key, std::int64_t fallback = 0);
    std::string terminalId();

    /** Reloads permissions for the primary role plus all secondary user_roles. */
    void loadPermissions(Session& session, const std::string& roleId);

    /** Queues an entry in sync_outbox so a future server can catch up. */
    void enqueueSync(std::string_view entityType, std::string_view entityId,
                     std::string_view operation, Json payload);

private:
    ipc::StdioServer& server_;
    db::Database& database_;
    Session session_;
};

using ContextPtr = std::shared_ptr<Context>;

}  // namespace pos::handlers
