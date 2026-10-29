#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

namespace {
struct PlatformFixture {
    ServiceFixture f;
    PlatformFixture(){pos::handlers::registerAuth(f.contextPtr());}
    pos::Json call(const std::string& method,pos::Json payload=pos::Json::object(),bool trusted=false){
        pos::ipc::Request request;request.requestId=pos::crypto::uuid4();request.method=method;
        request.payload=std::move(payload);if(trusted)request.actorUserId="usr-admin";
        return f.server().callHandler(request);
    }
    std::string error(const std::string& method,pos::Json payload,bool trusted=false){
        try{call(method,payload,trusted);}catch(const pos::PosError& e){return e.code();}return "";
    }
};
}
TEST_CASE("platform identity provisioning requires a trusted native actor", "[auth][platform]"){
    PlatformFixture x;const auto secret=std::string(64,'a');
    REQUIRE(x.error("auth.provisionPlatformSession",{{"secret",secret}})=="E_FORBIDDEN");
    REQUIRE(x.error("auth.provisionPlatformSession",{{"secret","7777777777"}},true)=="E_VALIDATION");
    x.f.ctx().session().role="waiter";
    REQUIRE(x.error("auth.provisionPlatformSession",{{"secret",secret}},true)=="E_FORBIDDEN");
}
TEST_CASE("platform authentication leaves the merchant PIN and worker list unchanged", "[auth][platform]"){
    PlatformFixture x;const auto secret=std::string(64,'b');
    auto before=x.f.db().prepare("SELECT pin_hash FROM users WHERE id='usr-admin'");REQUIRE(before.step());const auto hash=before.columnText(0);
    REQUIRE(x.call("auth.provisionPlatformSession",{{"secret",secret},{"grantUpdatedAt",100}},true).at("ok")==true);
    const auto session=x.call("auth.login",{{"userId","possistem-admin"},{"pin",secret}}).at("session");
    REQUIRE(session.at("superAdmin")==true);REQUIRE(session.at("fullName")=="POSSISTEM");REQUIRE(session.at("role")=="administrator");
    REQUIRE(x.call("auth.listUsers").at("users").size()==1);
    REQUIRE(x.call("users.list").at("users").size()==1);
    auto after=x.f.db().prepare("SELECT pin_hash FROM users WHERE id='usr-admin'");REQUIRE(after.step());REQUIRE(after.columnText(0)==hash);
    REQUIRE(x.error("users.setPin",{{"userId","possistem-admin"},{"pin","9876"}})=="E_VALIDATION");
    REQUIRE(x.error("users.update",{{"userId","possistem-admin"},{"role","waiter"}})=="E_VALIDATION");
    REQUIRE(x.error("users.update",{{"userId","usr-admin"},{"role","manager"}})=="E_VALIDATION");
    auto ledger=x.f.db().prepare("SELECT COUNT(*) FROM audit_logs WHERE actor_user_id='possistem-admin' AND action='auth.login'");REQUIRE(ledger.step());REQUIRE(ledger.columnInt(0)==1);
    auto employee=x.f.db().prepare("SELECT COUNT(*) FROM customers WHERE user_id='possistem-admin'");REQUIRE(employee.step());REQUIRE(employee.columnInt(0)==0);
}
TEST_CASE("wrong platform PINs share the native terminal lockout", "[auth][platform]"){
    PlatformFixture x;
    for(int i=0;i<4;++i)REQUIRE(x.error("auth.login",{{"pin","7777777777"}})=="E_INVALID_PIN");
    REQUIRE(x.error("auth.login",{{"pin","7777777777"}})=="E_PIN_LOCKED");
    REQUIRE(x.error("auth.provisionPlatformSession",{{"secret",std::string(64,'c')}},true)=="E_PIN_LOCKED");
}
TEST_CASE("unpaid and expired subscriptions cannot enter the PIN session", "[auth][billing]"){
 PlatformFixture x;
 x.f.db().exec("UPDATE license_state SET status='active',features_json='{\"billingManaged\":true,\"billingStatus\":\"awaiting_payment\"}',expires_at=9999999999999 WHERE id='local'");
 REQUIRE(x.error("auth.login",{{"pin","0000"}})=="E_LICENSE_EXPIRED");
 x.f.db().exec("UPDATE license_state SET features_json='{\"billingManaged\":true,\"billingStatus\":\"active\"}',expires_at=1 WHERE id='local'");
 REQUIRE(x.error("auth.login",{{"pin","0000"}})=="E_LICENSE_EXPIRED");
 x.f.db().exec("UPDATE license_state SET expires_at=9999999999999 WHERE id='local'");
 REQUIRE(x.error("auth.login",{{"pin","0000"}})=="E_INVALID_PIN");
}
