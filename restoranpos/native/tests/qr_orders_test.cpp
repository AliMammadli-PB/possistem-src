#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
namespace {
class QrFixture{
public:
 ServiceFixture f;
 QrFixture(){f.openTill();pos::handlers::registerQrOrders(f.contextPtr());auto c=f.db().prepare("SELECT id FROM menu_categories LIMIT 1");REQUIRE(c.step());auto i=f.db().prepare("INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,active,available,created_at,updated_at) VALUES('qr-dish',:cat,'QR-TEST','Sınaq yeməyi',700,1,1,0,0)");i.bind(":cat",c.columnText(0));i.exec();}
 pos::Json body(){return {{"externalId",pos::crypto::uuid4()},{"tableId","tbl-01"},{"note","Sınaq"},{"lines",pos::Json::array({{{"productId","qr-dish"},{"qty",2},{"modifiers",pos::Json::array()},{"note",""},{"unitPriceMinor",700},{"modifierPriceMinor",0}}})}};}
 pos::Json call(const pos::Json& body){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method="qr.accept";r.payload=body;return f.server().callHandler(r);}
 long count(const char* table){auto q=f.db().prepare(std::string("SELECT count(*) FROM ")+table);REQUIRE(q.step());return q.columnInt(0);}
};
}
TEST_CASE("QR acceptance is atomic and a permanent external key survives replay","[qr]"){
 QrFixture q;auto body=q.body();const auto first=q.call(body);const auto again=q.call(body);REQUIRE(first["orderId"]==again["orderId"]);REQUIRE(again["idempotentReplay"]==true);REQUIRE(q.count("orders")==1);REQUIRE(q.count("order_items")==1);REQUIRE(q.count("qr_order_imports")==1);
 body["lines"][0]["qty"]=3;REQUIRE_THROWS_AS(q.call(body),pos::PosError);REQUIRE(q.count("order_items")==1);
}
TEST_CASE("QR price or product changes roll back the entire bill","[qr]"){
 QrFixture q;auto body=q.body();body["lines"][0]["unitPriceMinor"]=1;REQUIRE_THROWS_AS(q.call(body),pos::PosError);REQUIRE(q.count("orders")==0);
 body=q.body();body["lines"].push_back(body["lines"][0]);body["lines"][1]["productId"]="missing";REQUIRE_THROWS_AS(q.call(body),pos::PosError);REQUIRE(q.count("orders")==0);REQUIRE(q.count("qr_order_imports")==0);
}
TEST_CASE("QR cashier approval joins only the selected table and validates permissions","[qr]"){
 QrFixture q;auto first=q.call(q.body());auto second=q.call(q.body());REQUIRE(first["orderId"]==second["orderId"]);REQUIRE(q.count("orders")==1);REQUIRE(q.count("order_items")==2);
 auto other=q.body();other["tableId"]="tbl-02";auto third=q.call(other);REQUIRE(first["orderId"]!=third["orderId"]);REQUIRE(q.count("orders")==2);
 q.f.ctx().session().permissions.clear();REQUIRE_THROWS_AS(q.call(q.body()),pos::PosError);
}
TEST_CASE("a QR menu published before a dish was archived and made again still orders the live dish","[qr][stale]"){
 QrFixture q;
 // The menu the guest sees still carries 'qr-dish'; the till archived it and made 'qr-dish-2' of the same name.
 q.f.db().exec("UPDATE menu_items SET active=0,archived=1 WHERE id='qr-dish';INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,active,available,created_at,updated_at) SELECT 'qr-dish-2',category_id,'QR-TEST-2',name_az,700,1,1,0,0 FROM menu_items WHERE id='qr-dish'");
 const auto r=q.call(q.body());
 auto line=q.f.db().prepare("SELECT product_id,quantity,unit_price_minor FROM order_items WHERE order_id=:o");line.bind(":o",r["orderId"].get<std::string>());REQUIRE(line.step());
 CHECK(line.columnText(0)=="qr-dish-2");CHECK(line.columnInt(1)==2);CHECK(line.columnInt(2)==700);
 // A different price on the live dish is still refused: the guest is never charged another amount.
 q.f.db().exec("UPDATE menu_items SET price_minor=900 WHERE id='qr-dish-2'");
 REQUIRE_THROWS_AS(q.call(q.body()),pos::PosError);
 // Two live dishes of that name: which was meant is not known, so the order is refused by name.
 q.f.db().exec("UPDATE menu_items SET price_minor=700 WHERE id='qr-dish-2';INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,active,available,created_at,updated_at) SELECT 'qr-dish-3',category_id,'QR-TEST-3',name_az,700,1,1,0,0 FROM menu_items WHERE id='qr-dish'");
 try{q.call(q.body());FAIL("ambiguous dish accepted");}catch(const pos::PosError& e){CHECK(std::string(e.what()).find("«Sınaq yeməyi» kassada artıq yoxdur")!=std::string::npos);}
}
TEST_CASE("a dish on the stop-list or unknown to the till is named in the refusal","[qr][stale]"){
 QrFixture q;
 q.f.db().exec("UPDATE menu_items SET sold_out=1 WHERE id='qr-dish'");
 try{q.call(q.body());FAIL("sold-out dish accepted");}catch(const pos::PosError& e){CHECK(std::string(e.what()).find("«Sınaq yeməyi» hazırda satışda deyil")!=std::string::npos);}
 auto body=q.body();body["lines"][0]["productId"]="nowhere";
 try{q.call(body);FAIL("unknown dish accepted");}catch(const pos::PosError& e){CHECK(std::string(e.what()).find("kassada tapılmadı")!=std::string::npos);}
}

TEST_CASE("web waiter provisioning is owner-only and repeat-safe", "[waiter][auth]"){
 QrFixture q;pos::handlers::registerAuth(q.f.contextPtr());const auto account=pos::crypto::uuid4();
 auto invoke=[&](const std::string& method,pos::Json payload){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method=method;r.payload=payload;return q.f.server().callHandler(r);};
 const pos::Json payload{{"accountId",account},{"fullName","Tərlan"}};const auto first=invoke("waiter.provision",payload);REQUIRE(first["role"]=="waiter");REQUIRE(first["id"]=="web-"+account);REQUIRE(invoke("waiter.provision",payload)["id"]==first["id"]);
 auto count=q.f.db().prepare("SELECT COUNT(*) FROM users WHERE id=:id");count.bind(":id",first["id"].get<std::string>());REQUIRE(count.step());REQUIRE(count.columnInt(0)==1);
 auto unsafe=payload;unsafe["nativeUserId"]="usr-admin";REQUIRE_THROWS_AS(invoke("waiter.provision",unsafe),pos::PosError);
 q.f.ctx().session().userId=first["id"].get<std::string>();q.f.ctx().session().role="waiter";q.f.ctx().loadPermissions(q.f.ctx().session(),"role-waiter");
 REQUIRE(invoke("waiter.identity",pos::Json::object())["id"]==first["id"]);REQUIRE_THROWS_AS(invoke("waiter.provision",payload),pos::PosError);
}
TEST_CASE("web waiter orders are priced natively, attributed and sent once", "[waiter][orders]"){
 QrFixture q;pos::handlers::registerAuth(q.f.contextPtr());pos::handlers::registerOrders(q.f.contextPtr());
 auto invoke=[&](const std::string& method,pos::Json payload,const std::string& key=""){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method=method;r.payload=payload;r.idempotencyKey=key;return q.f.server().callHandler(r);};
 auto user=invoke("waiter.provision",{{"accountId",pos::crypto::uuid4()},{"fullName","Test waiter"}});
 q.f.ctx().session().userId=user["id"].get<std::string>();q.f.ctx().session().role="waiter";q.f.ctx().loadPermissions(q.f.ctx().session(),"role-waiter");
 auto body=q.body();body["lines"][0]["unitPriceMinor"]=1;REQUIRE_THROWS_AS(invoke("waiter.accept",body),pos::PosError);REQUIRE(q.count("orders")==0);
 body["lines"][0]["unitPriceMinor"]=700;auto accepted=invoke("waiter.accept",body);REQUIRE(accepted["waiterUserId"]==user["id"]);REQUIRE(accepted["itemIds"].size()==1);REQUIRE(invoke("waiter.accept",body)["idempotentReplay"]==true);REQUIRE(q.count("order_items")==1);
 const auto external=body["externalId"];REQUIRE(invoke("waiter.status",{{"externalId",external}})["kitchenSent"]==false);
 const pos::Json send{{"orderId",accepted["orderId"]}};invoke("orders.submit",send,"waiter-send-once");REQUIRE(invoke("waiter.status",{{"externalId",external}})["kitchenSent"]==true);REQUIRE(invoke("orders.submit",send,"waiter-send-once")["idempotentReplay"]==true);
 auto order=q.f.db().prepare("SELECT user_id FROM orders WHERE id=:id");order.bind(":id",accepted["orderId"].get<std::string>());REQUIRE(order.step());REQUIRE(order.columnText(0)==user["id"].get<std::string>());
 q.f.ctx().session().userId="another-waiter";REQUIRE_THROWS_AS(invoke("waiter.status",{{"externalId",external}}),pos::PosError);REQUIRE_THROWS_AS(invoke("waiter.accept",body),pos::PosError);
}
TEST_CASE("web waiter role and an open till are mandatory", "[waiter][permissions]"){
 QrFixture q;pos::handlers::registerAuth(q.f.contextPtr());
 pos::ipc::Request r;r.method="waiter.identity";r.payload=pos::Json::object();REQUIRE_THROWS_AS(q.f.server().callHandler(r),pos::PosError);
 q.f.ctx().session().role="waiter";q.f.ctx().session().permissions.clear();r.method="waiter.accept";r.payload=q.body();REQUIRE_THROWS_AS(q.f.server().callHandler(r),pos::PosError);REQUIRE(q.count("orders")==0);
 q.f.ctx().loadPermissions(q.f.ctx().session(),"role-waiter");q.f.db().exec("UPDATE business_days SET status='closed'");REQUIRE_THROWS_AS(q.f.server().callHandler(r),pos::PosError);REQUIRE(q.count("orders")==0);
}
