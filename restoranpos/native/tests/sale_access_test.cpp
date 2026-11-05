#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/BusinessDayService.hpp"
namespace {
pos::Json call(ServiceFixture& f,const std::string& method,pos::Json payload={}) {
 pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.idempotencyKey=pos::crypto::uuid4();r.method=method;r.payload=std::move(payload);return f.server().callHandler(r);
}
}
TEST_CASE("sales require an assigned active till and deliberately opened business day","[sale_access]"){
 ServiceFixture f;pos::handlers::registerOrders(f.contextPtr());pos::handlers::registerPayments(f.contextPtr());pos::handlers::registerSystem(f.contextPtr());pos::services::BusinessDayService days(f.ctx());
 REQUIRE(days.saleReadiness().at("reason")=="missing_register");
 REQUIRE_THROWS_AS(call(f,"orders.create",{{"tableId","tbl-01"}}),pos::PosError);
 REQUIRE_FALSE(days.openBusinessDayId().has_value());
 REQUIRE_THROWS_AS(call(f,"businessDay.open",{{"openingFloatMinor",0}}),pos::PosError);
 f.openTill();const auto day=days.requireOpenTill();REQUIRE(!day.empty());
 const auto order=call(f,"orders.create",{{"tableId","tbl-01"}});REQUIRE(!order.at("id").get<std::string>().empty());
 f.db().exec("UPDATE business_days SET status='closed'");
 REQUIRE(days.saleReadiness().at("reason")=="closed");
 REQUIRE_THROWS_AS(call(f,"orders.create",{{"tableId","tbl-02"}}),pos::PosError);
 REQUIRE_THROWS_AS(call(f,"orders.addItem",{{"orderId",order.at("id")},{"productId","none"}}),pos::PosError);
 REQUIRE_THROWS_AS(call(f,"reports.x"),pos::PosError);REQUIRE_FALSE(days.openBusinessDayId().has_value());
 for(const auto& method:{"payments.createCash","payments.createCard","payments.createMixed"}) {
   try {call(f,method,{{"orderId",order.at("id")},{"amountMinor",100},{"tenders",pos::Json::array({{{"method","cash"},{"amountMinor",100}}})}});FAIL("closed till accepted payment");}
   catch(const pos::PosError& e){REQUIRE(e.code()=="E_SHIFT_NOT_OPEN");}
 }
 auto paid=f.db().prepare("SELECT count(*) FROM payments");REQUIRE(paid.step());REQUIRE(paid.columnInt(0)==0);

 call(f,"businessDay.open",{{"openingFloatMinor",0}});REQUIRE(days.saleReadiness().at("ready")==true);
 f.db().exec("UPDATE cash_accounts SET active=0");REQUIRE_THROWS_AS(days.requireOpenTill(),pos::PosError);
}
TEST_CASE("another physical till cannot satisfy the local sales gate","[sale_access]"){
 ServiceFixture f;f.openTill();f.db().exec("UPDATE cash_accounts SET terminal_id='other-pc'");
 REQUIRE(pos::services::BusinessDayService(f.ctx()).saleReadiness().at("ready")==false);
}
TEST_CASE("initial administrator is not an automatic payroll employee; real cashiers are","[sale_access][staff]"){
 ServiceFixture f;pos::handlers::registerGuests(f.contextPtr());
 auto list=call(f,"customers.list",{{"kind","employee"}}).at("customers");REQUIRE(list.empty());
 f.db().exec("UPDATE customers SET salary_minor=50000 WHERE user_id='usr-admin'");
 list=call(f,"customers.list",{{"kind","employee"}}).at("customers");REQUIRE(list.empty());
 auto saved=f.db().prepare("SELECT salary_minor FROM customers WHERE user_id='usr-admin'");REQUIRE(saved.step());REQUIRE(saved.columnInt(0)==50000);
 auto identity=f.db().prepare("SELECT primary_role_id FROM users WHERE id='usr-admin'");REQUIRE(identity.step());REQUIRE(identity.columnText(0)=="role-administrator");
 f.db().exec("INSERT INTO users(id,code,full_name,pin_hash,primary_role_id,created_at,updated_at) SELECT 'test-cashier','9912','Aysel',pin_hash,'role-cashier',0,0 FROM users WHERE id='usr-admin'");
 list=call(f,"customers.list",{{"kind","employee"}}).at("customers");bool found=false;for(const auto& row:list)if(row.at("name")=="Aysel"){found=true;REQUIRE(row.at("userRole")=="role-cashier");}REQUIRE(found);

}
TEST_CASE("cashiers can open their assigned till without gaining Z-close permissions","[sale_access]"){
 ServiceFixture f;f.openTill();f.db().exec("UPDATE business_days SET status='closed'");
 pos::handlers::registerBusiness(f.contextPtr());f.ctx().session().permissions={"shift.manage"};
 REQUIRE(call(f,"business.call",{{"action","sale.open"},{"idempotencyKey","cashier-open"}}).at("businessDay").at("status")=="open");
 REQUIRE(call(f,"business.call",{{"action","sale.open"},{"idempotencyKey","cashier-open"}}).at("businessDay").at("status")=="open");
 f.db().exec("UPDATE business_days SET status='closed'");f.ctx().session().permissions={"order.create"};
 REQUIRE_THROWS_AS(call(f,"business.call",{{"action","sale.open"},{"idempotencyKey","waiter-open"}}),pos::PosError);
 REQUIRE_FALSE(pos::services::BusinessDayService(f.ctx()).openBusinessDayId().has_value());
}
TEST_CASE("upgrade keeps administrator financial history and roles","[sale_access][migration]"){
 ServiceFixture f;
 f.db().exec("UPDATE users SET full_name='Super Admin' WHERE id='usr-admin'; UPDATE customers SET partner_origin='partner',salary_minor=12345 WHERE user_id='usr-admin'");
 f.db().exec(pos::db::kMigrations[64].sql());  // 065_system_login_partner
 auto card=f.db().prepare("SELECT salary_minor,partner_origin,name FROM customers WHERE user_id='usr-admin'");REQUIRE(card.step());REQUIRE(card.columnInt(0)==12345);REQUIRE(card.columnText(1)=="partner");REQUIRE(card.columnText(2)=="Yerli administrator");
}
