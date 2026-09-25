#include "catch_amalgamated.hpp"

#include <string>

#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/handlers/Handlers.hpp"

/**
 * `settings.applyProvisionedIdentity` is reachable without a session, because
 * activation happens before anyone signs in. That is only defensible while it
 * refuses to touch a value somebody chose, so these are the tests that keep it
 * honest.
 */
namespace {

class IdentityFixture {
public:
    IdentityFixture() { pos::handlers::registerSystem(fixture_.contextPtr()); }

    pos::Json apply(pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = "settings.applyProvisionedIdentity";
        request.payload = std::move(payload);
        return fixture_.server().callHandler(request);
    }

    void set(const std::string& key, const std::string& value) {
        auto stmt = fixture_.db().prepare(
            "INSERT INTO app_settings (key, value, value_type, updated_at) "
            "VALUES (:key, :value, 'string', 1) "
            "ON CONFLICT(key) DO UPDATE SET value = :value");
        stmt.bind(":key", key).bind(":value", value);
        stmt.exec();
    }

    std::string get(const std::string& key) {
        auto stmt = fixture_.db().prepare("SELECT value FROM app_settings WHERE key = :key");
        stmt.bind(":key", key);
        return stmt.step() ? stmt.columnText(0) : "";
    }

    std::int64_t auditCount() {
        auto stmt = fixture_.db().prepare(
            "SELECT COUNT(*) FROM audit_logs WHERE action = 'settings.provisionIdentity'");
        REQUIRE(stmt.step());
        return stmt.columnInt(0);
    }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("provisioning replaces the seeded restaurant name", "[settings][provisioning]") {
    IdentityFixture fixture;
    fixture.set("restaurant.name", "Milioner Pub");

    const auto result = fixture.apply({{"restaurant.name", "Şəhriyar Restoran"},
                                       {"restaurant.address", "Nizami 12"},
                                       {"restaurant.phone", "+994551112233"},
                                       {"restaurant.taxId", "1900123456"}});

    REQUIRE(fixture.get("restaurant.name") == "Şəhriyar Restoran");
    REQUIRE(fixture.get("restaurant.address") == "Nizami 12");
    REQUIRE(fixture.get("restaurant.phone") == "+994551112233");
    REQUIRE(fixture.get("restaurant.taxId") == "1900123456");
    REQUIRE(result["applied"].size() == 4);
    REQUIRE(result["skipped"].empty());
    REQUIRE(fixture.auditCount() == 4);
}

TEST_CASE("provisioning never overwrites a name an operator chose",
          "[settings][provisioning]") {
    IdentityFixture fixture;
    fixture.set("restaurant.name", "Şəhriyar Restoran");

    const auto result = fixture.apply({{"restaurant.name", "Someone Else"}});

    REQUIRE(fixture.get("restaurant.name") == "Şəhriyar Restoran");
    REQUIRE(result["applied"].empty());
    REQUIRE(result["skipped"].size() == 1);
    REQUIRE(fixture.auditCount() == 0);
}

TEST_CASE("re-activating the same till changes nothing", "[settings][provisioning]") {
    // Activation can be repeated - a device re-added, a licence re-imported.
    // The second call must be a no-op rather than a second audit entry.
    IdentityFixture fixture;
    fixture.set("restaurant.name", "Milioner Pub");

    fixture.apply({{"restaurant.name", "Şəhriyar Restoran"}});
    const auto again = fixture.apply({{"restaurant.name", "Şəhriyar Restoran"}});

    REQUIRE(fixture.get("restaurant.name") == "Şəhriyar Restoran");
    REQUIRE(again["applied"].empty());
    REQUIRE(again["skipped"].empty());
    REQUIRE(fixture.auditCount() == 1);
}

TEST_CASE("every seeded default is recognised as replaceable", "[settings][provisioning]") {
    for (const char* seeded : {"", "Milioner", "Milioner Pub", "Milioner Pub & Lounge",
                               "Maison Aurelia", "Maison Aurelia POS"}) {
        IdentityFixture fixture;
        fixture.set("restaurant.name", seeded);
        fixture.apply({{"restaurant.name", "Yeni Restoran"}});
        REQUIRE(fixture.get("restaurant.name") == "Yeni Restoran");
    }
}

TEST_CASE("a blank incoming value leaves the existing one alone",
          "[settings][provisioning]") {
    // An older control server, or a customer record with no address, must not
    // wipe what is already on the receipt.
    IdentityFixture fixture;
    fixture.set("restaurant.address", "Lütfizadə 98");

    fixture.apply({{"restaurant.address", ""}, {"restaurant.phone", "   "}});

    REQUIRE(fixture.get("restaurant.address") == "Lütfizadə 98");
}

TEST_CASE("keys outside the identity set are ignored", "[settings][provisioning]") {
    // The handler is unauthenticated, so it must not become a general setter.
    IdentityFixture fixture;
    fixture.set("printer.receipt", "win:KASSA");

    fixture.apply({{"printer.receipt", "tcp:10.0.0.9:9100"},
                   {"security.autoLogoutSeconds", "1"}});

    REQUIRE(fixture.get("printer.receipt") == "win:KASSA");
    REQUIRE(fixture.auditCount() == 0);
}
