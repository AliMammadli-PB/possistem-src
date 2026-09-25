#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

/**
 * Roles an operator creates, and the permissions granted to them.
 *
 * Before this, roles were six rows the seed wrote and a grant could only be
 * changed by editing SQL — "let this manager refund" had no answer inside the
 * product.
 */
namespace {

class RoleFixture {
public:
    RoleFixture() { pos::handlers::registerAuth(fixture_.contextPtr()); }

    pos::Json call(std::string_view method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(method);
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    bool roleHas(const std::string& roleId, const char* key) {
        auto stmt = fixture_.db().prepare(
            "SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id "
            "WHERE rp.role_id = :role AND p.key = :key");
        stmt.bind(":role", roleId).bind(":key", std::string(key));
        return stmt.step();
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("the permission catalogue is grouped by what it governs", "[roles]") {
    RoleFixture f;
    const auto res = f.call(pos::protocol::method::kPermissionsList, pos::Json::object());

    const auto& groups = res.at("groups");
    REQUIRE(groups.contains("order"));
    REQUIRE(groups.contains("payment"));
    REQUIRE(groups.contains("roles"));
    // Grouping comes from the key itself, so a key added later needs no
    // front-end change to appear.
    REQUIRE(groups.at("roles")[0].at("key") == "roles.manage");
}

TEST_CASE("roles list what each one may do and who holds it", "[roles]") {
    RoleFixture f;
    const auto res = f.call(pos::protocol::method::kRolesList, pos::Json::object());

    const auto& roles = res.at("roles");
    REQUIRE(roles.size() >= 6);

    bool sawAdmin = false;
    for (const auto& role : roles) {
        if (role.at("id") != "role-administrator") continue;
        sawAdmin = true;
        REQUIRE(role.at("custom") == false);
        // The seeded administrator is the one account that exists on a fresh
        // till, so the count has to find it.
        REQUIRE(role.at("staffCount").get<int>() >= 1);
    }
    REQUIRE(sawAdmin);
}

TEST_CASE("an operator can create a role and grant it permissions", "[roles]") {
    RoleFixture f;

    const auto created = f.call(
        pos::protocol::method::kRolesSave,
        pos::Json{{"name", "Baş ofisiant"},
                  {"rank", 25},
                  {"permissions", pos::Json::array({"order.create", "order.view",
                                                    "payment.take", "order.transfer"})}});
    REQUIRE(created.at("created") == true);
    const auto roleId = created.at("id").get<std::string>();

    REQUIRE(f.roleHas(roleId, "order.create"));
    REQUIRE(f.roleHas(roleId, "payment.take"));
    REQUIRE_FALSE(f.roleHas(roleId, "payment.refund"));
}

TEST_CASE("saving a role replaces its grants rather than adding to them", "[roles]") {
    RoleFixture f;
    const auto roleId = f.call(pos::protocol::method::kRolesSave,
                               pos::Json{{"name", "Müvəqqəti"},
                                         {"permissions", pos::Json::array({"order.create",
                                                                           "payment.take"})}})
                            .at("id")
                            .get<std::string>();
    REQUIRE(f.roleHas(roleId, "payment.take"));

    // Taking a right away is the whole point of the screen, so an unchecked box
    // has to actually revoke.
    f.call(pos::protocol::method::kRolesSave,
           pos::Json{{"id", roleId},
                     {"name", "Müvəqqəti"},
                     {"permissions", pos::Json::array({"order.create"})}});

    REQUIRE(f.roleHas(roleId, "order.create"));
    REQUIRE_FALSE(f.roleHas(roleId, "payment.take"));
}

TEST_CASE("the administrator keeps every permission, whatever is saved", "[roles]") {
    RoleFixture f;
    REQUIRE(f.roleHas("role-administrator", "payment.refund"));

    // Stripping the administrator would leave nobody able to undo a mistake
    // made on this very screen.
    f.call(pos::protocol::method::kRolesSave,
           pos::Json{{"id", "role-administrator"},
                     {"name", "administrator"},
                     {"permissions", pos::Json::array({"order.create"})}});

    REQUIRE(f.roleHas("role-administrator", "payment.refund"));
    REQUIRE(f.roleHas("role-administrator", "roles.manage"));
    REQUIRE(f.roleHas("role-administrator", "users.manage"));
}

TEST_CASE("granting a manager a right leaves the administrator holding it too", "[roles]") {
    RoleFixture f;

    f.call(pos::protocol::method::kRolesSave,
           pos::Json{{"id", "role-manager"},
                     {"name", "manager"},
                     {"permissions", pos::Json::array({"payment.refund", "roles.manage"})}});

    REQUIRE(f.roleHas("role-manager", "payment.refund"));
    REQUIRE(f.roleHas("role-administrator", "payment.refund"));
}

TEST_CASE("a shipped role cannot be deleted", "[roles]") {
    RoleFixture f;
    REQUIRE_THROWS_AS(f.call(pos::protocol::method::kRolesDelete,
                             pos::Json{{"roleId", "role-waiter"}}),
                      pos::PosError);
}

TEST_CASE("a role still held by staff cannot be deleted", "[roles]") {
    RoleFixture f;
    const auto roleId = f.call(pos::protocol::method::kRolesSave,
                               pos::Json{{"name", "Gecə növbəsi"},
                                         {"permissions", pos::Json::array({"order.create"})}})
                            .at("id")
                            .get<std::string>();

    f.fixture().ctx().session().permissions.insert("users.manage");
    f.call(pos::protocol::method::kUsersCreate,
           pos::Json{{"fullName", "Gecə Ofisiantı"}, {"pin", "7788"}, {"role", roleId}});

    // Deleting it would leave that member of staff pointing at a role that no
    // longer exists.
    REQUIRE_THROWS_AS(
        f.call(pos::protocol::method::kRolesDelete, pos::Json{{"roleId", roleId}}),
        pos::PosError);
}

TEST_CASE("a custom role is assignable and takes effect at sign-in", "[roles][auth]") {
    RoleFixture f;
    const auto roleId = f.call(pos::protocol::method::kRolesSave,
                               pos::Json{{"name", "Kassir-ofisiant"},
                                         {"permissions", pos::Json::array(
                                             {"order.create", "payment.take", "order.view"})}})
                            .at("id")
                            .get<std::string>();

    f.fixture().ctx().session().permissions.insert("users.manage");
    f.call(pos::protocol::method::kUsersCreate,
           pos::Json{{"fullName", "Qarışıq Rol"}, {"pin", "6677"}, {"role", roleId}});

    const auto session = f.call(pos::protocol::method::kAuthLogin, pos::Json{{"pin", "6677"}});
    const auto& permissions = session.at("session").at("permissions");

    bool hasTake = false, hasRefund = false;
    for (const auto& key : permissions) {
        if (key == "payment.take") hasTake = true;
        if (key == "payment.refund") hasRefund = true;
    }
    REQUIRE(hasTake);
    REQUIRE_FALSE(hasRefund);
}

/**
 * The policy the owner sets on possistem.az, applied on the till.
 *
 * The website is the master copy, so what arrives replaces the permission set
 * for every role it names. Roles it does not name are left alone - a role a
 * branch manager created locally should not vanish because head office pushed
 * a policy that never heard of it.
 */
TEST_CASE("a website policy replaces the permissions of the roles it names", "[roles][policy]") {
    RoleFixture f;

    const auto waiter = f.call(pos::protocol::method::kRolesApplyPolicy,
                               pos::Json{{"version", 7},
                                         {"roles", pos::Json::array({
                                              pos::Json{{"name", "waiter"},
                                                        {"permissions", pos::Json::array(
                                                             {"order.view", "payment.take"})}},
                                          })}});

    REQUIRE(waiter.at("applied") == 1);
    REQUIRE(waiter.at("created") == 0);
    REQUIRE(f.roleHas("role-waiter", "order.view"));
    REQUIRE(f.roleHas("role-waiter", "payment.take"));
    // The seed gave the waiter these; the policy did not, so they go.
    REQUIRE_FALSE(f.roleHas("role-waiter", "tables.status"));
    REQUIRE_FALSE(f.roleHas("role-waiter", "receipt.print"));
}

TEST_CASE("a policy creates a role the till has never seen", "[roles][policy]") {
    RoleFixture f;

    const auto res = f.call(pos::protocol::method::kRolesApplyPolicy,
                            pos::Json{{"version", 3},
                                      {"roles", pos::Json::array({
                                           pos::Json{{"name", "Baş ofisiant"},
                                                     {"permissions", pos::Json::array(
                                                          {"order.view", "order.transfer"})}},
                                       })}});

    REQUIRE(res.at("created") == 1);

    auto stmt = f.fixture().db().prepare("SELECT id, custom FROM roles WHERE name = :name");
    stmt.bind(":name", std::string("Baş ofisiant"));
    REQUIRE(stmt.step());
    REQUIRE(stmt.columnInt(1) == 1);
    REQUIRE(f.roleHas(stmt.columnText(0), "order.transfer"));
}

TEST_CASE("a policy leaves roles it does not name alone", "[roles][policy]") {
    RoleFixture f;
    REQUIRE(f.roleHas("role-kitchen", "kds.view"));

    f.call(pos::protocol::method::kRolesApplyPolicy,
           pos::Json{{"version", 2},
                     {"roles", pos::Json::array({
                          pos::Json{{"name", "cashier"},
                                    {"permissions", pos::Json::array({"payment.take"})}},
                      })}});

    REQUIRE(f.roleHas("role-kitchen", "kds.view"));
}

/**
 * The one thing a remote policy must never be able to do.
 *
 * `roles.manage` is how a mistake on this screen gets undone. If head office
 * could push a policy that strips the administrator, the owner would be locked
 * out of their own till with no way back that does not involve editing SQLite
 * by hand.
 */
TEST_CASE("a policy cannot lock the administrator out", "[roles][policy]") {
    RoleFixture f;

    f.call(pos::protocol::method::kRolesApplyPolicy,
           pos::Json{{"version", 9},
                     {"roles", pos::Json::array({
                          pos::Json{{"name", "administrator"},
                                    {"permissions", pos::Json::array({"order.view"})}},
                      })}});

    REQUIRE(f.roleHas("role-administrator", "roles.manage"));
    REQUIRE(f.roleHas("role-administrator", "users.manage"));
    REQUIRE(f.roleHas("role-administrator", "order.view"));
}

TEST_CASE("the applied version is remembered so the same policy is not rewritten",
          "[roles][policy]") {
    RoleFixture f;

    f.call(pos::protocol::method::kRolesApplyPolicy,
           pos::Json{{"version", 41},
                     {"roles", pos::Json::array({
                          pos::Json{{"name", "waiter"},
                                    {"permissions", pos::Json::array({"order.view"})}},
                      })}});

    auto stmt = f.fixture().db().prepare(
        "SELECT value FROM app_settings WHERE key = 'pos.rolePolicyVersion'");
    REQUIRE(stmt.step());
    REQUIRE(stmt.columnText(0) == "41");
}

TEST_CASE("a policy without a version is refused", "[roles][policy]") {
    RoleFixture f;
    REQUIRE_THROWS(f.call(pos::protocol::method::kRolesApplyPolicy,
                          pos::Json{{"roles", pos::Json::array()}}));
}

TEST_CASE("an unchanged policy is not rewritten", "[roles][policy]") {
    RoleFixture f;
    const pos::Json policy{{"version", 12},
                           {"roles", pos::Json::array({
                                pos::Json{{"name", "waiter"},
                                          {"permissions", pos::Json::array({"order.view"})}},
                            })}};

    const auto first = f.call(pos::protocol::method::kRolesApplyPolicy, policy);
    REQUIRE(first.at("applied") == 1);

    // Main re-posts the same policy on every heartbeat; the second one must
    // cost nothing rather than re-writing the same grants every two minutes.
    const auto second = f.call(pos::protocol::method::kRolesApplyPolicy, policy);
    REQUIRE(second.at("skipped") == true);
    REQUIRE(second.at("applied") == 0);
    REQUIRE(f.roleHas("role-waiter", "order.view"));
}

/**
 * The storekeeper.
 *
 * Every shipped role was a floor role; the person who actually receives the
 * delivery and counts the store had to be made a supervisor - which also let
 * them void orders and take payments.
 */
TEST_CASE("a storekeeper handles stock and nothing else", "[roles]") {
    RoleFixture f;

    REQUIRE(f.roleHas("role-storekeeper", "inventory.view"));
    REQUIRE(f.roleHas("role-storekeeper", "inventory.count"));
    REQUIRE(f.roleHas("role-storekeeper", "suppliers.receive"));
    REQUIRE(f.roleHas("role-storekeeper", "recipes.manage"));

    // The point of the role is what it cannot do.
    REQUIRE_FALSE(f.roleHas("role-storekeeper", "payment.take"));
    REQUIRE_FALSE(f.roleHas("role-storekeeper", "order.void"));
    REQUIRE_FALSE(f.roleHas("role-storekeeper", "cash.manage"));
    REQUIRE_FALSE(f.roleHas("role-storekeeper", "roles.manage"));
}

TEST_CASE("a storekeeper can be assigned to a new member of staff", "[roles]") {
    RoleFixture f;
    const auto created = f.call(pos::protocol::method::kUsersCreate,
                                pos::Json{{"fullName", "Anbarçı"},
                                          {"pin", "7731"},
                                          {"role", "storekeeper"}});
    REQUIRE(created.at("role") == "storekeeper");
}
