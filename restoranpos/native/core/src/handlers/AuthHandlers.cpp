#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

Json sessionToJson(const Session& session) {
    Json permissions = Json::array();
    for (const auto& permission : session.permissions) permissions.push_back(permission);

    return Json{
        {"userId", session.userId},   {"code", session.code},
        {"fullName", session.fullName}, {"role", session.role},
        {"shiftId", session.shiftId}, {"permissions", permissions},
        {"loginAt", session.loginAt}, {"authenticated", session.authenticated},
    };
}

/**
 * Whether any active member of staff already uses this PIN.
 *
 * PINs are salted PBKDF2, so there is nothing to index or compare directly -
 * every candidate has to be verified. The same walk backs PIN-only sign-in and
 * manager overrides (`Context::requireManagerApproval`).
 *
 * `exceptUserId` lets a user keep their own PIN when only their name changes.
 */
bool pinAlreadyUsed(Context& ctx, const std::string& pin, const std::string& exceptUserId) {
    auto stmt = ctx.db().prepare(
        "SELECT id, pin_hash FROM users WHERE active = 1");
    while (stmt.step()) {
        if (stmt.columnText(0) == exceptUserId) continue;
        if (crypto::verifyPin(pin, stmt.columnText(1))) return true;
    }
    return false;
}

/**
 * Turns whatever the screen sent into a real role id.
 *
 * Accepts a role id outright, or a role name. Roles used to be six hardcoded
 * ids in two copies of an if-chain, which meant a role an operator created was
 * unassignable - the staff screen could list it and then refuse to save it.
 */
std::string resolveRoleId(Context& ctx, const std::string& wanted,
                          const std::string& fallback) {
    if (!wanted.empty()) {
        auto byId = ctx.db().prepare("SELECT id FROM roles WHERE id = :id");
        byId.bind(":id", wanted);
        if (byId.step()) return byId.columnText(0);

        auto byName = ctx.db().prepare("SELECT id FROM roles WHERE name = :name");
        byName.bind(":name", wanted);
        if (byName.step()) return byName.columnText(0);
    }
    if (fallback.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "Rol tanınmadı");
    }
    return fallback;
}

/** A staff PIN is exactly four digits: the pad on the login screen has four boxes. */
void requireValidPin(const std::string& pin) {
    require(pin.size() == 4, "PIN 4 rəqəm olmalıdır");
    for (char c : pin) {
        require(c >= '0' && c <= '9', "PIN yalnız rəqəmlərdən ibarət olmalıdır");
    }
}

/**
 * Brute-force protection for PIN-only sign-in.
 *
 * `users.failed_attempts` cannot be used here: a wrong PIN belongs to no
 * account, so there is nobody to charge the attempt to. The counter is per
 * terminal instead, which is also the thing physically in front of the person
 * guessing. Kept in app_settings under `security.`, which `settings.set`
 * already refuses to write.
 */
std::string terminalKey(Context& ctx, const char* suffix) {
    return std::string("security.pin.") + suffix + "." + ctx.terminalId();
}

std::int64_t terminalCounter(Context& ctx, const char* suffix) {
    auto stmt = ctx.db().prepare("SELECT value FROM app_settings WHERE key = :key");
    const std::string key = terminalKey(ctx, suffix);
    stmt.bind(":key", key);
    if (!stmt.step()) return 0;
    try {
        return std::stoll(stmt.columnText(0));
    } catch (const std::exception&) {
        return 0;
    }
}

void setTerminalCounter(Context& ctx, const char* suffix, std::int64_t value) {
    auto stmt = ctx.db().prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'int', :now) "
        "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
    const std::string key = terminalKey(ctx, suffix);
    stmt.bind(":key", key).bind(":value", std::to_string(value)).bind(":now", nowMs());
    stmt.exec();
}

}  // namespace

void registerAuth(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(
        std::string(protocol::method::kAuthLogin), [ctx](const ipc::Request& request) {
            const auto requestedUserId = getOr<std::string>(request.payload, "userId", "");
            const auto pin = getOr<std::string>(request.payload, "pin", "");
            require(!pin.empty(), "PIN is required");

            const auto maxAttempts = ctx->settingInt("security.maxPinAttempts", 5);
            const auto lockoutSeconds = ctx->settingInt("security.lockoutSeconds", 300);
            const bool pinOnly = requestedUserId.empty();

            // The till is the thing being guessed at, so it is the till that
            // gets locked. Only PIN-only sign-in needs this; a named login is
            // still rate-limited on the account itself, below.
            if (pinOnly) {
                const auto lockedUntil = terminalCounter(*ctx, "lockedUntil");
                if (lockedUntil > nowMs()) {
                    const auto seconds = (lockedUntil - nowMs()) / 1000;
                    throw PosError(std::string(protocol::err::kPinLocked),
                                   "Kassa " + std::to_string(seconds) +
                                       " saniyə müddətinə bloklandı");
                }
            }

            // PIN-only: the PIN identifies the person. Salted PBKDF2 cannot be
            // looked up, so every active account is verified in turn - the same
            // walk a manager override already performs.
            std::string userId = requestedUserId;
            if (pinOnly) {
                auto scan = ctx->db().prepare(
                    "SELECT id, pin_hash FROM users WHERE active = 1 ORDER BY code");
                while (scan.step()) {
                    if (crypto::verifyPin(pin, scan.columnText(1))) {
                        userId = scan.columnText(0);
                        break;
                    }
                }
                if (userId.empty()) {
                    const auto attempts = terminalCounter(*ctx, "failures") + 1;
                    setTerminalCounter(*ctx, "failures", attempts);
                    const bool lock = attempts >= maxAttempts;
                    if (lock) {
                        setTerminalCounter(*ctx, "lockedUntil",
                                           nowMs() + lockoutSeconds * 1000);
                        setTerminalCounter(*ctx, "failures", 0);
                    }
                    ctx->audit("auth.login_failed", "terminal", ctx->terminalId(),
                               Json{{"attempts", attempts}, {"locked", lock}});
                    logger()->warn("failed PIN sign-in on {} (attempt {})", ctx->terminalId(),
                                   attempts);
                    if (lock) {
                        throw PosError(std::string(protocol::err::kPinLocked),
                                       "Çox sayda səhv cəhd. Kassa müvəqqəti bloklandı.");
                    }
                    throw PosError::of(protocol::err::kInvalidPin);
                }
                setTerminalCounter(*ctx, "failures", 0);
            }

            auto stmt = ctx->db().prepare(
                "SELECT u.id, u.code, u.full_name, u.pin_hash, u.primary_role_id, "
                "       u.failed_attempts, u.locked_until, r.name "
                "FROM users u JOIN roles r ON r.id = u.primary_role_id "
                "WHERE u.id = :userId AND u.active = 1");
            stmt.bind(":userId", userId);

            if (!stmt.step()) {
                // Same error as a wrong PIN: distinguishing them would let an
                // attacker enumerate valid accounts.
                throw PosError::of(protocol::err::kInvalidPin);
            }

            const std::string code = stmt.columnText(1);
            const std::string fullName = stmt.columnText(2);
            const std::string hash = stmt.columnText(3);
            const std::string roleId = stmt.columnText(4);
            const auto failedAttempts = stmt.columnInt(5);
            const bool hasLock = !stmt.columnIsNull(6);
            const auto lockedUntil = stmt.columnInt(6);
            const std::string roleName = stmt.columnText(7);

            const auto now = nowMs();

            if (hasLock && lockedUntil > now) {
                const auto seconds = (lockedUntil - now) / 1000;
                throw PosError(std::string(protocol::err::kPinLocked),
                               "Account is locked for another " + std::to_string(seconds) +
                                   " seconds");
            }

            if (!crypto::verifyPin(pin, hash)) {
                const auto attempts = failedAttempts + 1;

                auto update = ctx->db().prepare(
                    "UPDATE users SET failed_attempts = :attempts, locked_until = :lockedUntil,"
                    "                 updated_at = :now WHERE id = :userId");
                update.bind(":attempts", attempts).bind(":now", now).bind(":userId", userId);

                if (attempts >= maxAttempts) {
                    update.bind(":lockedUntil", now + lockoutSeconds * 1000);
                } else {
                    update.bind(":lockedUntil", nullptr);
                }
                update.exec();

                // The PIN itself is never logged, only the outcome.
                ctx->audit("auth.login_failed", "user", userId,
                           Json{{"attempts", attempts}, {"locked", attempts >= maxAttempts}},
                           userId);
                logger()->warn("failed login for {} (attempt {})", code, attempts);

                if (attempts >= maxAttempts) {
                    throw PosError(std::string(protocol::err::kPinLocked),
                                   "Too many incorrect attempts. Account locked.");
                }
                throw PosError::of(protocol::err::kInvalidPin);
            }

            auto reset = ctx->db().prepare(
                "UPDATE users SET failed_attempts = 0, locked_until = NULL, "
                "                 last_login_at = :now, updated_at = :now WHERE id = :userId");
            reset.bind(":now", now).bind(":userId", userId);
            reset.exec();

            Session session;
            session.userId = userId;
            session.code = code;
            session.fullName = fullName;
            session.role = roleName;
            session.loginAt = now;
            session.authenticated = true;
            ctx->loadPermissions(session, roleId);

            // Reattach an already-open shift so a re-login mid-service does not
            // orphan the till.
            auto shift = ctx->db().prepare(
                "SELECT id FROM shifts WHERE status = 'open' AND terminal_id = :terminal "
                "ORDER BY opened_at DESC LIMIT 1");
            shift.bind(":terminal", ctx->terminalId());
            if (shift.step()) session.shiftId = shift.columnText(0);

            ctx->session() = session;
            ctx->audit("auth.login", "user", userId, Json{{"role", roleName}});
            logger()->info("login: {} ({})", fullName, roleName);

            return Json{{"session", sessionToJson(session)}};
        });

    server.registerHandler(std::string(protocol::method::kAuthLogout), [ctx](const ipc::Request&) {
        const auto& session = ctx->session();
        if (session.authenticated) {
            ctx->audit("auth.logout", "user", session.userId);
            logger()->info("logout: {}", session.fullName);
        }
        ctx->session().clear();
        return Json{{"ok", true}};
    });

    server.registerHandler(
        std::string(protocol::method::kAuthVerifyManagerPin), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto pin = getOr<std::string>(request.payload, "pin", "");
            const auto action = getOr<std::string>(request.payload, "action", "override");
            const auto permission = getOr<std::string>(request.payload, "permission", "order.void");

            const std::string approverId = ctx->requireManagerApproval(permission, pin, action);
            return Json{{"approved", true}, {"approverId", approverId}};
        });

    // ----------------------------------------------------------------- staff
    server.registerHandler(
        std::string(protocol::method::kUsersList), [ctx](const ipc::Request&) {
            ctx->requirePermission("users.manage");
            auto stmt = ctx->db().prepare(
                "SELECT u.id, u.code, u.full_name AS fullName, u.color, r.name AS role, "
                "       u.active, u.created_at AS createdAt "
                "FROM users u JOIN roles r ON r.id = u.primary_role_id "
                "ORDER BY u.active DESC, r.rank DESC, u.full_name");
            return Json{{"users", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kUsersCreate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("users.manage");

            const auto fullName = getOr<std::string>(request.payload, "fullName", "");
            const auto pin = getOr<std::string>(request.payload, "pin", "");
            auto code = getOr<std::string>(request.payload, "code", "");
            const auto roleName = getOr<std::string>(request.payload, "role", "waiter");
            const auto color = getOr<std::string>(request.payload, "color", "#C9A86A");

            require(!fullName.empty(), "Ad tələb olunur");
            requireValidPin(pin);
            if (pinAlreadyUsed(*ctx, pin, "")) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Bu PIN artıq başqa işçidə var - başqa PIN seçin");
            }

            if (roleName == "administrator") {
                throw PosError(std::string(protocol::err::kValidation),
                               "Administrator yalnız sistem tərəfindən yaradılır");
            }
            // Looked up rather than hardcoded, so a role an operator created on
            // the roles screen can be assigned like any shipped one.
            const std::string roleId = resolveRoleId(*ctx, roleName, "role-waiter");

            if (code.empty()) {
                // Allocate the next free numeric staff code starting at 2001.
                auto next = ctx->db().prepare(
                    "SELECT COALESCE(MAX(CAST(code AS INTEGER)), 2000) FROM users "
                    "WHERE code GLOB '[0-9]*' AND CAST(code AS INTEGER) >= 2000");
                next.step();
                code = std::to_string(next.columnInt(0) + 1);
            }

            const std::string userId = crypto::uuid4();
            const std::string hash = crypto::hashPin(pin);
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            auto insert = ctx->db().prepare(
                "INSERT INTO users (id, code, full_name, pin_hash, primary_role_id, color, active,"
                "                   failed_attempts, created_at, updated_at) "
                "VALUES (:id, :code, :name, :hash, :role, :color, 1, 0, :now, :now)");
            insert.bind(":id", userId)
                .bind(":code", code)
                .bind(":name", fullName)
                .bind(":hash", hash)
                .bind(":role", roleId)
                .bind(":color", color)
                .bind(":now", now);
            insert.exec();

            auto link = ctx->db().prepare(
                "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (:user, :role)");
            link.bind(":user", userId).bind(":role", roleId);
            link.exec();

            ctx->auditRequired("users.create", "user", userId,
                               Json{{"fullName", fullName}, {"code", code}, {"role", roleName}});
            txn.commit();

            return Json{{"id", userId},
                        {"code", code},
                        {"fullName", fullName},
                        {"role", roleName},
                        {"color", color},
                        {"active", true}};
        });

    // Until this existed a staff member's name and role were fixed at creation
    // and their PIN could never be changed - including the seeded administrator
    // PIN that the README says must be changed before the till handles money.
    server.registerHandler(
        std::string(protocol::method::kUsersUpdate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("users.manage");

            const auto userId = getOr<std::string>(request.payload, "userId", "");
            require(!userId.empty(), "userId is required");

            auto current = ctx->db().prepare(
                "SELECT u.full_name, u.color, r.name FROM users u "
                "JOIN roles r ON r.id = u.primary_role_id WHERE u.id = :id AND u.active = 1");
            current.bind(":id", userId);
            if (!current.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "İstifadəçi tapılmadı");
            }
            const std::string wasName = current.columnText(0);
            const std::string wasColor = current.columnText(1);
            const std::string wasRole = current.columnText(2);

            std::string fullName = getOr<std::string>(request.payload, "fullName", wasName);
            std::string color = getOr<std::string>(request.payload, "color", wasColor);
            const auto roleName = getOr<std::string>(request.payload, "role", wasRole);
            require(!fullName.empty(), "Ad tələb olunur");

            std::string roleId = resolveRoleId(*ctx, roleName, "");

            // The last administrator must keep the role, or nobody can ever
            // grant it again: `users.create` refuses to mint one.
            if (wasRole == "administrator" && roleName != "administrator") {
                auto admins = ctx->db().prepare(
                    "SELECT COUNT(*) FROM users WHERE active = 1 "
                    "  AND primary_role_id = 'role-administrator'");
                admins.step();
                require(admins.columnInt(0) > 1,
                        "Sistemdə ən azı bir administrator qalmalıdır");
            }

            db::Transaction txn(ctx->db());
            auto upd = ctx->db().prepare(
                "UPDATE users SET full_name = :name, color = :color, primary_role_id = :role, "
                "                 updated_at = :now WHERE id = :id");
            upd.bind(":name", fullName)
                .bind(":color", color)
                .bind(":role", roleId)
                .bind(":now", nowMs())
                .bind(":id", userId);
            upd.exec();

            // primary_role_id and user_roles are read as a union when permissions
            // load, so a stale secondary row would silently keep the old rights.
            auto unlink = ctx->db().prepare("DELETE FROM user_roles WHERE user_id = :user");
            unlink.bind(":user", userId);
            unlink.exec();
            auto link = ctx->db().prepare(
                "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (:user, :role)");
            link.bind(":user", userId).bind(":role", roleId);
            link.exec();

            ctx->auditRequired("users.update", "user", userId,
                               Json{{"fullName", fullName},
                                    {"role", roleName},
                                    {"previousRole", wasRole}});
            txn.commit();

            return Json{{"id", userId},
                        {"fullName", fullName},
                        {"role", roleName},
                        {"color", color},
                        {"active", true}};
        });

    server.registerHandler(
        std::string(protocol::method::kUsersSetPin), [ctx](const ipc::Request& request) {
            ctx->requirePermission("users.manage");

            const auto userId = getOr<std::string>(request.payload, "userId", "");
            const auto pin = getOr<std::string>(request.payload, "pin", "");
            require(!userId.empty(), "userId is required");
            requireValidPin(pin);

            // Sign-in identifies the person by PIN alone, so a duplicate would
            // hand one person's session to another.
            if (pinAlreadyUsed(*ctx, pin, userId)) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Bu PIN artıq başqa işçidə var - başqa PIN seçin");
            }

            db::Transaction txn(ctx->db());
            auto upd = ctx->db().prepare(
                "UPDATE users SET pin_hash = :hash, failed_attempts = 0, locked_until = NULL, "
                "                 updated_at = :now WHERE id = :id AND active = 1");
            upd.bind(":hash", crypto::hashPin(pin)).bind(":now", nowMs()).bind(":id", userId);
            upd.exec();
            if (ctx->db().changes() != 1) {
                throw PosError(std::string(protocol::err::kNotFound), "İstifadəçi tapılmadı");
            }

            // The PIN itself is never recorded, only that it changed.
            ctx->auditRequired("users.setPin", "user", userId, Json::object());
            txn.commit();

            return Json{{"ok", true}, {"userId", userId}};
        });

    // ------------------------------------------------------------ roles
    //
    // Roles were six fixed rows and permissions could only be changed by editing
    // SQL, so "let this manager refund" had no answer inside the product. These
    // four methods are the whole story: read the catalogue, read the roles, save
    // one, delete one.

    server.registerHandler(
        std::string(protocol::method::kPermissionsList), [ctx](const ipc::Request&) {
            ctx->requirePermission("roles.manage");

            // Grouped by the part of the key before the dot, which is already
            // how they are named, so the screen needs no second source of truth
            // and a key added later appears without a front-end release.
            auto stmt = ctx->db().prepare(
                "SELECT key, description FROM permissions ORDER BY key");
            Json groups = Json::object();
            while (stmt.step()) {
                const std::string key = stmt.columnText(0);
                const auto dot = key.find('.');
                const std::string group = dot == std::string::npos ? key : key.substr(0, dot);
                groups[group].push_back(
                    Json{{"key", key}, {"description", stmt.columnText(1)}});
            }
            return Json{{"groups", groups}};
        });

    server.registerHandler(
        std::string(protocol::method::kRolesList), [ctx](const ipc::Request&) {
            ctx->requirePermission("roles.manage");

            auto roles = ctx->db().prepare(
                "SELECT r.id, r.name, r.description, r.rank, r.custom, "
                "       (SELECT COUNT(*) FROM users u WHERE u.primary_role_id = r.id "
                "          AND u.active = 1) AS staffCount "
                "FROM roles r ORDER BY r.rank");
            Json out = Json::array();
            while (roles.step()) {
                const std::string roleId = roles.columnText(0);
                auto granted = ctx->db().prepare(
                    "SELECT p.key FROM role_permissions rp "
                    "JOIN permissions p ON p.id = rp.permission_id "
                    "WHERE rp.role_id = :role ORDER BY p.key");
                granted.bind(":role", roleId);
                Json keys = Json::array();
                while (granted.step()) keys.push_back(granted.columnText(0));

                out.push_back(Json{{"id", roleId},
                                   {"name", roles.columnText(1)},
                                   {"description", roles.columnText(2)},
                                   {"rank", roles.columnInt(3)},
                                   {"custom", roles.columnInt(4) != 0},
                                   {"staffCount", roles.columnInt(5)},
                                   {"permissions", keys}});
            }
            return Json{{"roles", out}};
        });

    server.registerHandler(
        std::string(protocol::method::kRolesSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("roles.manage");

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Rol adı tələb olunur");
            auto roleId = getOr<std::string>(request.payload, "id", "");

            require(request.payload.contains("permissions") &&
                        request.payload["permissions"].is_array(),
                    "permissions is required");

            db::Transaction txn(ctx->db());

            bool creating = roleId.empty();
            if (creating) {
                roleId = "role-" + crypto::uuid4().substr(0, 8);
            } else {
                auto exists = ctx->db().prepare("SELECT custom FROM roles WHERE id = :id");
                exists.bind(":id", roleId);
                require(exists.step(), "Rol tapılmadı");
            }

            const auto rank = getOr<std::int64_t>(request.payload, "rank", 10);
            const auto description = getOr<std::string>(request.payload, "description", "");

            if (creating) {
                auto insert = ctx->db().prepare(
                    "INSERT INTO roles (id, name, description, rank, custom) "
                    "VALUES (:id, :name, :desc, :rank, 1)");
                insert.bind(":id", roleId)
                    .bind(":name", name)
                    .bind(":desc", description)
                    .bind(":rank", rank);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE roles SET name = :name, description = :desc, rank = :rank "
                    "WHERE id = :id");
                update.bind(":name", name)
                    .bind(":desc", description)
                    .bind(":rank", rank)
                    .bind(":id", roleId);
                update.exec();
            }

            // Replace rather than diff: the screen sends the whole set, and a
            // half-applied grant is worse than a slow one.
            auto clear = ctx->db().prepare(
                "DELETE FROM role_permissions WHERE role_id = :role");
            clear.bind(":role", roleId);
            clear.exec();

            int granted = 0;
            for (const auto& entry : request.payload["permissions"]) {
                if (!entry.is_string()) continue;
                auto grant = ctx->db().prepare(
                    "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
                    "SELECT :role, id FROM permissions WHERE key = :key");
                grant.bind(":role", roleId).bind(":key", entry.get<std::string>());
                grant.exec();
                granted += ctx->db().changes();
            }

            // An administrator who cannot manage roles can never undo a mistake
            // made on this screen, so the role is restored to the full set
            // whatever was sent for it.
            auto restoreAdmin = ctx->db().prepare(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
                "SELECT 'role-administrator', id FROM permissions");
            restoreAdmin.exec();

            ctx->auditRequired("roles.save", "role", roleId,
                               Json{{"name", name}, {"granted", granted},
                                    {"created", creating}});
            txn.commit();

            return Json{{"id", roleId}, {"name", name}, {"granted", granted},
                        {"created", creating}};
        });

    // Applies the role policy the owner set on possistem.az.
    //
    // No `requirePermission` here, and that is deliberate: this is reached only
    // from the Electron main process, which pulls the policy on its heartbeat
    // tick and has no staff session to speak of. The privilege boundary is that
    // the method is marked `"internal": true` in protocol.json, so
    // apply-restaurant-contract.mjs keeps it OUT of main's renderer-facing
    // method gate - the till UI gets E_UNKNOWN_METHOD, main reaches the core
    // directly. tests/unit/method-gate.test.ts fails if that ever slips.
    //
    // The website is the master copy (the owner's decision): whatever arrives
    // replaces the local permission set for the roles it names. Roles it does
    // not name are left alone, so a role created on this till survives.
    server.registerHandler(
        std::string(protocol::method::kRolesApplyPolicy), [ctx](const ipc::Request& request) {
            const auto version = getOr<std::int64_t>(request.payload, "version", 0);
            require(version > 0, "version is required");
            require(request.payload.contains("roles") && request.payload["roles"].is_array(),
                    "roles is required");

            // After DB grants change, the signed-in staff still holds the old
            // permission set in memory until the next PIN. Reload it here and
            // return `session` so Electron can push onSession without logout.
            const auto attachLiveSession = [&](Json result) -> Json {
                auto& session = ctx->session();
                if (!session.authenticated || session.userId.empty()) return result;
                auto role = ctx->db().prepare(
                    "SELECT primary_role_id FROM users WHERE id = :id AND active = 1");
                role.bind(":id", session.userId);
                if (!role.step()) return result;
                ctx->loadPermissions(session, role.columnText(0));
                result["session"] = sessionToJson(session);
                return result;
            };

            // Main posts whatever the website last returned on every heartbeat,
            // so the common case is a policy that has not changed. Comparing
            // here rather than in main keeps the decision next to the data and
            // saves main a second round trip just to read a setting.
            if (ctx->settingInt("pos.rolePolicyVersion", 0) == version) {
                // Version matches, but licence gates (Anbar/Parametrlər) can still
                // flip without a new role list. Re-apply the feature strip so a
                // closed module stays closed even for administrator.
                const auto features = request.payload.value("features", Json::object());
                const auto featureOn = [&](const char* key, bool fallback) -> bool {
                    if (!features.is_object() || !features.contains(key)) return fallback;
                    const auto& value = features.at(key);
                    if (value.is_boolean()) return value.get<bool>();
                    if (value.is_object() && value.contains("enabled")) {
                        return value.at("enabled").get<bool>();
                    }
                    return fallback;
                };
                db::Transaction txn(ctx->db());
                if (!featureOn("inventory", true)) {
                    auto strip = ctx->db().prepare(
                        "DELETE FROM role_permissions WHERE permission_id IN ("
                        "  SELECT id FROM permissions WHERE key LIKE 'inventory.%'"
                        "     OR key LIKE 'suppliers.%')");
                    strip.exec();
                } else {
                    // Prior skip may have stripped these while version stayed put;
                    // put administrator inventory keys back when the gate opens.
                    auto restoreInv = ctx->db().prepare(
                        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
                        "SELECT 'role-administrator', id FROM permissions "
                        "WHERE key LIKE 'inventory.%' OR key LIKE 'suppliers.%'");
                    restoreInv.exec();
                }
                if (!featureOn("settings", true)) {
                    auto strip = ctx->db().prepare(
                        "DELETE FROM role_permissions WHERE permission_id IN ("
                        "  SELECT id FROM permissions WHERE key LIKE 'settings.%')");
                    strip.exec();
                } else {
                    auto restoreSet = ctx->db().prepare(
                        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
                        "SELECT 'role-administrator', id FROM permissions "
                        "WHERE key LIKE 'settings.%'");
                    restoreSet.exec();
                }
                txn.commit();
                return attachLiveSession(Json{{"version", version}, {"skipped", true},
                            {"applied", 0}, {"created", 0}, {"granted", 0},
                            {"inventory", featureOn("inventory", true)},
                            {"settings", featureOn("settings", true)}});
            }

            db::Transaction txn(ctx->db());

            std::int64_t applied = 0;
            std::int64_t created = 0;
            std::int64_t granted = 0;
            for (const auto& role : request.payload["roles"]) {
                if (!role.is_object()) continue;
                const auto name = getOr<std::string>(role, "name", "");
                if (name.empty()) continue;
                if (!role.contains("permissions") || !role["permissions"].is_array()) continue;

                // The administrator is restored to the full set below whatever
                // arrives, so a policy pushed from the website can never lock
                // the owner out of their own till.
                auto byName = ctx->db().prepare("SELECT id FROM roles WHERE name = :name");
                byName.bind(":name", name);
                std::string roleId;
                if (byName.step()) {
                    roleId = byName.columnText(0);
                } else {
                    roleId = "role-" + crypto::uuid4().substr(0, 8);
                    auto insert = ctx->db().prepare(
                        "INSERT INTO roles (id, name, description, rank, custom) "
                        "VALUES (:id, :name, :desc, :rank, 1)");
                    insert.bind(":id", roleId)
                        .bind(":name", name)
                        .bind(":desc", getOr<std::string>(role, "description", ""))
                        .bind(":rank", getOr<std::int64_t>(role, "rank", 10));
                    insert.exec();
                    created += 1;
                }

                auto clear = ctx->db().prepare(
                    "DELETE FROM role_permissions WHERE role_id = :role");
                clear.bind(":role", roleId);
                clear.exec();

                for (const auto& key : role["permissions"]) {
                    if (!key.is_string()) continue;
                    auto grant = ctx->db().prepare(
                        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
                        "SELECT :role, id FROM permissions WHERE key = :key");
                    grant.bind(":role", roleId).bind(":key", key.get<std::string>());
                    grant.exec();
                    granted += ctx->db().changes();
                }
                applied += 1;
            }

            auto restoreAdmin = ctx->db().prepare(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
                "SELECT 'role-administrator', id FROM permissions");
            restoreAdmin.exec();

            // Licence / portal gates can withdraw whole modules (Anbar, Parametrlər)
            // even from administrator. Without this strip, Admin always keeps every
            // key and "bağlı" on possistem.az never matches the till UI.
            const auto features = request.payload.value("features", Json::object());
            const auto featureOn = [&](const char* key, bool fallback) -> bool {
                if (!features.is_object() || !features.contains(key)) return fallback;
                const auto& value = features.at(key);
                if (value.is_boolean()) return value.get<bool>();
                if (value.is_object() && value.contains("enabled")) {
                    return value.at("enabled").get<bool>();
                }
                return fallback;
            };
            if (!featureOn("inventory", true)) {
                auto strip = ctx->db().prepare(
                    "DELETE FROM role_permissions WHERE permission_id IN ("
                    "  SELECT id FROM permissions WHERE key LIKE 'inventory.%'"
                    "     OR key LIKE 'suppliers.%')");
                strip.exec();
            }
            if (!featureOn("settings", true)) {
                auto strip = ctx->db().prepare(
                    "DELETE FROM role_permissions WHERE permission_id IN ("
                    "  SELECT id FROM permissions WHERE key LIKE 'settings.%')");
                strip.exec();
            }

            // Remembered so main can tell an already-applied policy from a new
            // one without re-writing the same grants on every heartbeat.
            auto mark = ctx->db().prepare(
                "INSERT INTO app_settings (key, value, value_type, updated_at) "
                "VALUES ('pos.rolePolicyVersion', :value, 'int', :now) "
                "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
            mark.bind(":value", std::to_string(version))
                .bind(":now", nowMs());
            mark.exec();

            ctx->auditRequired("roles.applyPolicy", "policy", std::to_string(version),
                               Json{{"applied", applied},
                                    {"created", created},
                                    {"granted", granted},
                                    {"inventory", featureOn("inventory", true)},
                                    {"settings", featureOn("settings", true)}});
            txn.commit();

            return attachLiveSession(Json{{"version", version},
                        {"applied", applied},
                        {"created", created},
                        {"granted", granted},
                        {"inventory", featureOn("inventory", true)},
                        {"settings", featureOn("settings", true)}});
        });

    server.registerHandler(
        std::string(protocol::method::kRolesDelete), [ctx](const ipc::Request& request) {
            ctx->requirePermission("roles.manage");

            const auto roleId = getOr<std::string>(request.payload, "roleId", "");
            require(!roleId.empty(), "roleId is required");

            auto role = ctx->db().prepare("SELECT custom FROM roles WHERE id = :id");
            role.bind(":id", roleId);
            require(role.step(), "Rol tapılmadı");
            // The shipped roles are what `users.create` assigns and what the
            // seed's grants hang off; removing one would leave staff pointing at
            // a role that no longer exists.
            require(role.columnInt(0) != 0, "Sistem rolları silinə bilməz");

            auto inUse = ctx->db().prepare(
                "SELECT COUNT(*) FROM users WHERE primary_role_id = :id AND active = 1");
            inUse.bind(":id", roleId);
            inUse.step();
            require(inUse.columnInt(0) == 0,
                    "Bu rolda işçi var - əvvəlcə onların rolunu dəyişin");

            db::Transaction txn(ctx->db());
            auto drop = ctx->db().prepare("DELETE FROM roles WHERE id = :id");
            drop.bind(":id", roleId);
            drop.exec();
            auto dropGrants = ctx->db().prepare(
                "DELETE FROM role_permissions WHERE role_id = :id");
            dropGrants.bind(":id", roleId);
            dropGrants.exec();

            ctx->auditRequired("roles.delete", "role", roleId, Json::object());
            txn.commit();

            return Json{{"ok", true}, {"roleId", roleId}};
        });

    server.registerHandler(
        std::string(protocol::method::kUsersDeactivate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("users.manage");
            const auto userId = getOr<std::string>(request.payload, "userId", "");
            require(!userId.empty(), "userId is required");
            require(userId != ctx->session().userId, "Öz hesabınızı silə bilməzsiniz");
            require(userId != "usr-admin", "Əsas administrator silinə bilməz");

            auto role = ctx->db().prepare(
                "SELECT r.name FROM users u JOIN roles r ON r.id = u.primary_role_id "
                "WHERE u.id = :id");
            role.bind(":id", userId);
            if (!role.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "İstifadəçi tapılmadı");
            }
            if (role.columnText(0) == "administrator") {
                throw PosError(std::string(protocol::err::kValidation),
                               "Administrator silinə bilməz");
            }

            const auto now = nowMs();
            auto upd = ctx->db().prepare(
                "UPDATE users SET active = 0, updated_at = :now WHERE id = :id AND active = 1");
            upd.bind(":now", now).bind(":id", userId);
            upd.exec();
            if (ctx->db().changes() != 1) {
                throw PosError(std::string(protocol::err::kNotFound), "İstifadəçi tapılmadı");
            }

            ctx->auditRequired("users.deactivate", "user", userId, Json::object());
            return Json{{"ok", true}, {"userId", userId}};
        });
}

}  // namespace pos::handlers
