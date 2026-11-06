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
