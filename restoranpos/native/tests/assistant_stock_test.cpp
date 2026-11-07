#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

namespace {
class AssistantFixture {
public:
 ServiceFixture f;
 AssistantFixture(){pos::handlers::registerInventory(f.contextPtr());}
 pos::Json call(const std::string& method,pos::Json payload=pos::Json::object()){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method=method;r.payload=std::move(payload);r.idempotencyKey=pos::crypto::uuid4();return f.server().callHandler(r);}
 pos::Json good(const std::string& id){const auto response=call("ingredients.list");for(const auto& row:response.at("ingredients"))if(row.at("id")==id)return row;throw std::runtime_error("missing good");}
 std::int64_t scalar(const std::string& sql){auto q=f.db().prepare(sql);q.step();return q.columnInt(0);}
};
}
TEST_CASE("assistant patches preserve unrelated fields, detect conflicts and replay once","[assistant]"){
 AssistantFixture x;
 const auto id=x.call("ingredients.save",{{"name","Kola"},{"unit","ədəd"},{"barcode","1234567890123"},{"costMinor",120},{"salePriceMinor",250},{"minQtyMilli",3000}}).at("id").get<std::string>();
 REQUIRE(x.call("ingredients.list").at("assistantToolsVersion")==1);
 const auto before=x.good(id);
 pos::Json change{{"id",id},{"expectedUpdatedAt",before.at("updatedAt")},{"cardPatch",{{"salePriceMinor",350}}},{"idempotencyKey","assistant-price"}};
 REQUIRE(x.call("ingredients.save",change).at("patched")==true);
 const auto after=x.good(id);REQUIRE(after.at("salePriceMinor")==350);REQUIRE(after.at("updatedAt").get<std::int64_t>()>before.at("updatedAt").get<std::int64_t>());
 for(const auto key:{"name","unit","costMinor","minQtyMilli","barcode","qtyMilli","sku"})REQUIRE(after.at(key)==before.at(key));
 REQUIRE_NOTHROW(x.call("ingredients.save",change));REQUIRE(x.scalar("SELECT COUNT(*) FROM audit_logs WHERE action='ingredient.assistant_patch'")==1);
 change["idempotencyKey"]="assistant-stale";change["cardPatch"]={{"name","Kola yeni"}};REQUIRE_THROWS_AS(x.call("ingredients.save",change),pos::PosError);REQUIRE(x.good(id).at("name")=="Kola");
 change["expectedUpdatedAt"]=after.at("updatedAt");change["cardPatch"]={{"barcode","999"}};REQUIRE_THROWS_AS(x.call("ingredients.save",change),pos::PosError);
 change["cardPatch"]={{"salePriceMinor",-1}};REQUIRE_THROWS_AS(x.call("ingredients.save",change),pos::PosError);REQUIRE(x.good(id).at("salePriceMinor")==350);
 auto& session=x.f.ctx().session();session.role="waiter";session.permissions={"inventory.view"};change["cardPatch"]={{"name","Forbidden"}};REQUIRE_THROWS_AS(x.call("ingredients.save",change),pos::PosError);
}
TEST_CASE("assistant menu price changes are atomic and retain price history","[assistant]"){
 AssistantFixture x;
 auto q=x.f.db().prepare("INSERT INTO menu_items(id,category_id,sku,name_az,name_en,name_tr,price_minor,active,created_at,updated_at) VALUES('assistant-cola',(SELECT id FROM menu_categories WHERE active=1 LIMIT 1),'QA-COLA','Kola','Cola','Kola',250,1,0,0)");q.exec();
 const auto id=x.call("ingredients.save",{{"name","Kola"},{"sku","MENU-assistant-cola"},{"unit","ədəd"},{"salePriceMinor",250}}).at("id").get<std::string>();
 const auto before=x.good(id);
 const pos::Json patch{{"id",id},{"expectedUpdatedAt",before.at("updatedAt")},{"cardPatch",{{"name","Kola 0.5 l"},{"salePriceMinor",300}}},{"idempotencyKey","assistant-menu"}};
 REQUIRE_NOTHROW(x.call("ingredients.save",patch));REQUIRE(x.scalar("SELECT price_minor FROM menu_items WHERE id='assistant-cola'")==300);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM menu_item_price_history WHERE item_id='assistant-cola' AND old_price_minor=250 AND new_price_minor=300")==1);
 REQUIRE_NOTHROW(x.call("ingredients.save",patch));REQUIRE(x.scalar("SELECT COUNT(*) FROM menu_item_price_history WHERE item_id='assistant-cola'")==1);
 const auto snapshot=x.good(id);auto changed=patch;changed["idempotencyKey"]="assistant-race";changed["expectedUpdatedAt"]=snapshot.at("updatedAt");
 auto external=x.f.db().prepare("UPDATE menu_items SET updated_at=:v,price_minor=400 WHERE id='assistant-cola'");external.bind(":v",snapshot.at("updatedAt").get<std::int64_t>()+10);external.exec();
 REQUIRE_THROWS_AS(x.call("ingredients.save",changed),pos::PosError);REQUIRE(x.scalar("SELECT price_minor FROM menu_items WHERE id='assistant-cola'")==400);
 changed["expectedUpdatedAt"]=x.good(id).at("updatedAt");auto& session=x.f.ctx().session();session.role="warehouse";session.permissions={"inventory.manage","inventory.view"};
 REQUIRE_THROWS_AS(x.call("ingredients.save",changed),pos::PosError);REQUIRE(x.good(id).at("salePriceMinor")==400);REQUIRE(x.scalar("SELECT COUNT(*) FROM audit_logs WHERE action='ingredient.assistant_patch'")==1);
}
TEST_CASE("assistant stock corrections reject stale warehouse balances and keep a single movement","[assistant]"){
 AssistantFixture x;const auto id=x.call("ingredients.save",{{"name","Kola"},{"unit","ədəd"}}).at("id").get<std::string>();
 pos::Json adjust{{"ingredientId",id},{"warehouseId","wh-main"},{"qtyDeltaMilli",10000},{"expectedQtyMilli",0},{"reason","Faktiki sayım"},{"idempotencyKey","assistant-qty"}};
 x.call("inventory.adjust",adjust);x.call("inventory.adjust",adjust);REQUIRE(x.good(id).at("qtyMilli")==10000);
 adjust["idempotencyKey"]="assistant-stale-stock";REQUIRE_THROWS_AS(x.call("inventory.adjust",adjust),pos::PosError);REQUIRE(x.good(id).at("qtyMilli")==10000);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM stock_movements WHERE ingredient_id='"+id+"'")==1);
}
