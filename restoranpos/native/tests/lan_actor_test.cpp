#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

/**
 * One database, several PCs.
 *
 * The host PC's core serves the terminals on the LAN too, and it has a single
 * signed-in session. A terminal's call arrives with the terminal's own staff
 * member as `actor`; it must run with that person's permissions and must leave
 * whoever is signed in at the host untouched - otherwise a waiter's PIN on the
 * floor would sign the manager out at the till, or worse, act as the manager.
 */
namespace {

class LanFixture {
public:
    LanFixture() {
        pos::handlers::registerAuth(fixture_.contextPtr());
        pos::handlers::installRequestScope(fixture_.contextPtr());
        // Reports back whoever the core thinks is calling.
        fixture_.server().registerHandler("test.whoami", [ctx = fixture_.contextPtr()](const pos::ipc::Request&) {
            return pos::Json{{"userId", ctx->session().userId},
                             {"authenticated", ctx->session().authenticated},
                             {"canRefund", ctx->session().permissions.count("payment.refund") > 0}};
        });
    }

    pos::Json call(const std::string& method, pos::Json payload, bool scoped, std::string actor = "") {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        request.scoped = scoped;
        request.actorUserId = std::move(actor);
        return fixture_.server().callHandler(request);
    }

    /** A waiter with a known PIN. */
    std::string waiter(const char* pin) {
        const std::string id = pos::crypto::uuid4();
        auto insert = fixture_.db().prepare(
            "INSERT INTO users (id, code, full_name, pin_hash, primary_role_id, created_at, updated_at) "
            "VALUES (:id, :code, 'Ofisiant Test', :hash, 'role-waiter', :now, :now)");
        insert.bind(":id", id).bind(":code", "W" + id.substr(0, 6))
            .bind(":hash", pos::crypto::hashPin(pin)).bind(":now", pos::nowMs());
        insert.exec();
        return id;
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("a terminal's call runs as the terminal's staff member", "[lan]") {
    LanFixture f;
    const auto waiter = f.waiter("4812");

    const auto seen = f.call("test.whoami", pos::Json::object(), true, waiter);
    REQUIRE(seen.at("userId") == waiter);
    // A waiter does not refund, whatever the host's manager may do.
    REQUIRE(seen.at("canRefund") == false);

    // And the host is still the administrator afterwards.
    REQUIRE(f.fixture().ctx().session().userId == "usr-admin");
    REQUIRE(f.call("test.whoami", pos::Json::object(), false).at("canRefund") == true);
}

TEST_CASE("a terminal with nobody signed in is nobody", "[lan]") {
    LanFixture f;
    const auto seen = f.call("test.whoami", pos::Json::object(), true, "");
    REQUIRE(seen.at("authenticated") == false);
    REQUIRE(f.fixture().ctx().session().userId == "usr-admin");
}

TEST_CASE("an unknown or deactivated terminal user is refused", "[lan]") {
    LanFixture f;
    REQUIRE_THROWS_AS(f.call("test.whoami", pos::Json::object(), true, "no-such-user"), pos::PosError);
    REQUIRE(f.fixture().ctx().session().userId == "usr-admin");
}

TEST_CASE("a PIN typed at a terminal does not sign the host out", "[lan]") {
    LanFixture f;
    const auto waiter = f.waiter("4813");

    const auto result = f.call("auth.login", pos::Json{{"userId", waiter}, {"pin", "4813"}}, true, "");
    REQUIRE(result.dump().find(waiter) != std::string::npos);
    REQUIRE(f.fixture().ctx().session().userId == "usr-admin");
}
