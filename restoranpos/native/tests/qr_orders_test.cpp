#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
namespace {
class QrFixture{
public:
 ServiceFixture f;
 QrFixture(){pos::handlers::registerQrOrders(f.contextPtr());auto c=f.db().prepare("SELECT id FROM menu_categories LIMIT 1");REQUIRE(c.step());auto i=f.db().prepare("INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,active,available,created_at,updated_at) VALUES('qr-dish',:cat,'QR-TEST','Sınaq yeməyi',700,1,1,0,0)");i.bind(":cat",c.columnText(0));i.exec();}
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
