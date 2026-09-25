#include "pos/handlers/Context.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

}  // namespace

const Session& Context::requireAuth() const {
    if (!session_.authenticated) {
        throw PosError::of(protocol::err::kUnauthorized);
    }
    return session_;
}

void Context::requirePermission(std::string_view permission) const {
    requireAuth();
    if (session_.permissions.count(std::string(permission)) == 0) {
        throw PosError(std::string(protocol::err::kForbidden),
                       "Your role does not allow this action (" + std::string(permission) + ")");
    }
}

std::string Context::requireManagerApproval(std::string_view permission,
                                            const std::string& managerPin,
                                            std::string_view action) {
    requireAuth();

    // Already privileged: no second authentication needed.
    if (session_.permissions.count(std::string(permission)) > 0) {
        return session_.userId;
    }

    if (managerPin.empty()) {
        throw PosError(std::string(protocol::err::kManagerApprovalRequired),
                       "This action requires manager approval");
    }

    // Look for an active user holding the permission (primary or secondary role)
    // whose PIN matches.
    auto stmt = database_.prepare(
        "SELECT DISTINCT u.id, u.full_name, u.pin_hash FROM users u "
        "JOIN ("
        "  SELECT user_id AS uid, role_id FROM user_roles "
        "  UNION "
        "  SELECT id AS uid, primary_role_id AS role_id FROM users"
        ") roles ON roles.uid = u.id "
        "JOIN role_permissions rp ON rp.role_id = roles.role_id "
        "JOIN permissions p ON p.id = rp.permission_id "
        "WHERE p.key = :permission AND u.active = 1");
    stmt.bind(":permission", std::string(permission));

    while (stmt.step()) {
        const std::string userId = stmt.columnText(0);
        const std::string name = stmt.columnText(1);
        const std::string hash = stmt.columnText(2);

        if (crypto::verifyPin(managerPin, hash)) {
            audit("manager_override", "permission", std::string(permission),
                  Json{{"action", std::string(action)},
                       {"approvedBy", name},
                       {"requestedBy", session_.fullName}},
                  userId);
            logger()->info("manager override for {} approved by {}", action, name);
            return userId;
        }
    }

    throw PosError(std::string(protocol::err::kInvalidPin), "Manager PIN was not recognised");
}

void Context::audit(std::string_view action, std::string_view entityType,
                    std::string_view entityId, Json data, const std::string& actorOverride) {
    try {
        auto stmt = database_.prepare(
            "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, data,"
            "                        terminal_id, created_at) "
            "VALUES (:id, :actor, :action, :entityType, :entityId, :data, :terminal, :now)");

        const std::string actor = actorOverride.empty() ? session_.userId : actorOverride;

        stmt.bind(":id", crypto::uuid4())
            .bindOptional(":actor", actor)
            .bind(":action", std::string(action))
            .bind(":entityType", std::string(entityType))
            .bind(":entityId", std::string(entityId))
            .bind(":data", serialize(data))
            .bind(":terminal", terminalId())
            .bind(":now", nowMs());
        stmt.exec();
    } catch (const std::exception& err) {
        // A failed audit write must not abort the operation being audited;
        // it is logged loudly instead.
        logger()->error("audit write failed for {}: {}", action, err.what());
    }
}

void Context::auditRequired(std::string_view action, std::string_view entityType,
                            std::string_view entityId, Json data,
                            const std::string& actorOverride) {
    try {
        auto stmt = database_.prepare(
            "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, data,"
            "                        terminal_id, created_at) "
            "VALUES (:id, :actor, :action, :entityType, :entityId, :data, :terminal, :now)");

        const std::string actor = actorOverride.empty() ? session_.userId : actorOverride;

        stmt.bind(":id", crypto::uuid4())
            .bindOptional(":actor", actor)
            .bind(":action", std::string(action))
            .bind(":entityType", std::string(entityType))
            .bind(":entityId", std::string(entityId))
            .bind(":data", serialize(data))
            .bind(":terminal", terminalId())
            .bind(":now", nowMs());
        stmt.exec();
    } catch (const std::exception& err) {
        logger()->error("required audit write failed for {}: {}", action, err.what());
        throw PosError(std::string(protocol::err::kInternal),
                       "Audit trail write failed; the operation was aborted");
    }
}

std::string Context::setting(std::string_view key, const std::string& fallback) {
    auto stmt = database_.prepare("SELECT value FROM app_settings WHERE key = :key");
    stmt.bind(":key", std::string(key));
    return stmt.step() ? stmt.columnText(0) : fallback;
}

std::int64_t Context::settingInt(std::string_view key, std::int64_t fallback) {
    const std::string raw = setting(key);
    if (raw.empty()) return fallback;
    try {
        return std::stoll(raw);
    } catch (...) {
        return fallback;
    }
}

std::string Context::terminalId() {
    static std::string cached;
    if (cached.empty()) cached = setting("terminal.id", "TERM-01");
    return cached;
}

void Context::loadPermissions(Session& session, const std::string& roleId) {
    session.permissions.clear();

    auto stmt = database_.prepare(
        "SELECT DISTINCT p.key FROM permissions p "
        "JOIN role_permissions rp ON rp.permission_id = p.id "
        "JOIN ("
        "  SELECT :role AS role_id "
        "  UNION "
        "  SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = :userId"
        ") roles ON roles.role_id = rp.role_id");
    stmt.bind(":role", roleId).bind(":userId", session.userId);

    while (stmt.step()) session.permissions.insert(stmt.columnText(0));
}

void Context::enqueueSync(std::string_view entityType, std::string_view entityId,
                          std::string_view operation, Json payload) {
    auto stmt = database_.prepare(
        "INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload, created_at) "
        "VALUES (:id, :entityType, :entityId, :operation, :payload, :now)");
    stmt.bind(":id", crypto::uuid4())
        .bind(":entityType", std::string(entityType))
        .bind(":entityId", std::string(entityId))
        .bind(":operation", std::string(operation))
        .bind(":payload", serialize(payload))
        .bind(":now", nowMs());
    stmt.exec();
}

}  // namespace pos::handlers
