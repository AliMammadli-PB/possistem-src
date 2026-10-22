#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

/**
 * The seeded administrator's PIN (1234) ships in the source, so it is public.
 * It may only be used to choose a new PIN, and it never approves anything.
 * Manager approvals are rate-limited per till.
 */
namespace {

class AuthFixture {
public:
    AuthFixture() { pos::handlers::registerAuth(fixture_.contextPtr()); }

    pos::Json call(std::string_view method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(method);
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string errorOf(std::string_view method, pos::Json payload) {
        try {
            call(method, std::move(payload));
        } catch (const pos::PosError& err) {
            return err.code();
        }
        return "";
    }

    std::string approvalError(const std::string& pin) {
        try {
            fixture_.ctx().requireManagerApproval("order.void", pin, "test");
        } catch (const pos::PosError& err) {
            return err.code();
        }
        return "";
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

const std::string kChangeRequired(pos::protocol::err::kPinChangeRequired);
const std::string kInvalidPin(pos::protocol::err::kInvalidPin);
const std::string kPinLocked(pos::protocol::err::kPinLocked);

}  // namespace

TEST_CASE("the shipped admin PIN only buys a PIN change", "[auth][default-pin]") {
    AuthFixture f;
    using pos::protocol::method::kAuthLogin;

    REQUIRE(f.errorOf(kAuthLogin, pos::Json{{"pin", "1234"}}) == kChangeRequired);
    REQUIRE_FALSE(f.fixture().ctx().session().userId.empty());  // fixture session untouched
    REQUIRE(f.errorOf(kAuthLogin, pos::Json{{"pin", "1234"}, {"newPin", "1234"}}) ==
            std::string(pos::protocol::err::kValidation));

    const auto session = f.call(kAuthLogin, pos::Json{{"pin", "1234"}, {"newPin", "4826"}});
    REQUIRE(session.at("session").at("userId") == "usr-admin");

    REQUIRE(f.errorOf(kAuthLogin, pos::Json{{"pin", "1234"}}) == kInvalidPin);
    REQUIRE(f.call(kAuthLogin, pos::Json{{"pin", "4826"}}).at("session").at("userId") ==
            "usr-admin");
}

TEST_CASE("an account on the shipped PIN never approves", "[auth][default-pin]") {
    AuthFixture f;
    f.fixture().ctx().session().permissions.erase("order.void");
    REQUIRE(f.approvalError("1234") == kInvalidPin);
}

TEST_CASE("manager approvals lock after five wrong PINs", "[auth][approval]") {
    AuthFixture f;
    f.call(pos::protocol::method::kAuthLogin, pos::Json{{"pin", "1234"}, {"newPin", "4826"}});
    f.fixture().ctx().session().permissions.erase("order.void");

    REQUIRE(f.approvalError("4826").empty());
    for (int i = 0; i < 4; ++i) REQUIRE(f.approvalError("1111") == kInvalidPin);
    REQUIRE(f.approvalError("1111") == kPinLocked);
    // Locked: even the right PIN is refused until the lock runs out.
    REQUIRE(f.approvalError("4826") == kPinLocked);
}

TEST_CASE("public staff listing exposes identity but never credentials", "[auth][bootstrap]") {
    AuthFixture f;
    f.fixture().ctx().session().clear();
    const auto users = f.call(pos::protocol::method::kAuthListUsers, pos::Json::object()).at("users");
    REQUIRE(users.size() == 1);
    REQUIRE(users[0].at("id") == "usr-admin");
    REQUIRE(users[0].at("role") == "administrator");
    REQUIRE(users[0].at("locked") == false);
    REQUIRE_FALSE(users[0].contains("pin_hash"));
    REQUIRE_FALSE(users[0].contains("permissions"));
    REQUIRE(f.errorOf(pos::protocol::method::kUsersList, pos::Json::object()) ==
            std::string(pos::protocol::err::kUnauthorized));
}

TEST_CASE("untouched legacy bootstrap accepts 1234 without resetting personal PINs", "[auth][bootstrap]") {
    AuthFixture f;
    using pos::protocol::method::kAuthLogin;
    auto update = f.fixture().db().prepare("UPDATE users SET pin_hash=:hash WHERE id='usr-admin'");
    update.bind(":hash", pos::crypto::hashPin("9001")).exec();
    f.fixture().ctx().session().clear();
    REQUIRE(f.errorOf(kAuthLogin, {{"pin","1234"}}) == kChangeRequired);
    REQUIRE(f.errorOf(kAuthLogin, {{"userId","usr-admin"},{"pin","9001"}}) == kChangeRequired);
    REQUIRE(f.errorOf(kAuthLogin, {{"pin","1234"},{"newPin","9001"}}) ==
            std::string(pos::protocol::err::kValidation));
    REQUIRE(f.call(kAuthLogin, {{"pin","1234"},{"newPin","8642"}}).at("session").at("role") == "administrator");
    REQUIRE(f.errorOf(kAuthLogin, {{"pin","1234"}}) == kInvalidPin);
    REQUIRE(f.errorOf(kAuthLogin, {{"pin","9001"}}) == kInvalidPin);
    // Reopening a populated DB must preserve the personal hash and history.
    pos::db::Migrator migrator(f.fixture().db());migrator.seedIfEmpty({});
    REQUIRE(f.call(kAuthLogin, {{"pin","8642"}}).at("session").at("userId") == "usr-admin");
}

TEST_CASE("PIN-only native login enforces terminal lockout", "[auth][bootstrap]") {
    AuthFixture f;
    using pos::protocol::method::kAuthLogin;
    f.fixture().ctx().session().clear();
    for (int i=0;i<4;++i) REQUIRE(f.errorOf(kAuthLogin, {{"pin","0000"}}) == kInvalidPin);
    REQUIRE(f.errorOf(kAuthLogin, {{"pin","0000"}}) == kPinLocked);
    REQUIRE(f.errorOf(kAuthLogin, {{"pin","1234"},{"newPin","8642"}}) == kPinLocked);
    REQUIRE_FALSE(f.fixture().ctx().session().authenticated);
}
