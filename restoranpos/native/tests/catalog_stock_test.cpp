#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/db/migrations_generated.hpp"
#include "pos/services/InventoryService.hpp"
namespace {
class CatalogStockFixture {
public:
 ServiceFixture f;std::string category;
 CatalogStockFixture(){pos::handlers::registerCatalog(f.contextPtr());pos::handlers::registerInventory(f.contextPtr());pos::handlers::registerErp(f.contextPtr());category=call("catalog.upsertCategory",{{"nameAz","Test içkilər"}}).at("id").get<std::string>();}
 pos::Json call(const std::string& method,pos::Json payload){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.idempotencyKey=pos::crypto::uuid4();r.method=method;r.payload=payload;return f.server().callHandler(r);}
 pos::Json product(const std::string& id,const std::string& name="Cola",pos::Money price=150,const std::string& barcode=""){return call("catalog.upsertProduct",{{"id",id},{"categoryId",category},{"nameAz",name},{"priceMinor",price},{"active",true},{"barcode",barcode}});}
 std::string card(const std::string& id){auto q=f.db().prepare("SELECT ingredient_id FROM catalog_goods_links WHERE menu_id=:id");q.bind(":id",id);return q.step()?q.columnText(0):"";}
};
}
TEST_CASE("catalog create owns an immediately visible stock card even with a preallocated product ID", "[catalog][stock-sync]"){
 CatalogStockFixture x;const auto id=pos::crypto::uuid4();x.product(id,"Test Cola",150,"476-test-cola");const auto card=x.card(id);REQUIRE_FALSE(card.empty());
 auto goods=x.call("goods.list",{{"search","Test Cola"}}).at("goods");REQUIRE(goods.size()==1);REQUIRE(goods[0].at("id")==card);REQUIRE(goods[0].at("qtyMilli")==0);REQUIRE(goods[0].at("basePriceMinor")==150);
 x.product(id,"Test Cola yeni",220,"476-test-new");goods=x.call("goods.list",{{"search","476-test-new"}}).at("goods");REQUIRE(goods.size()==1);REQUIRE(goods[0].at("id")==card);REQUIRE(goods[0].at("name")=="Test Cola yeni");REQUIRE(goods[0].at("basePriceMinor")==220);
 auto recipes=x.call("recipes.get",{{"menuItemId",id}}).at("lines");REQUIRE(recipes.size()==1);REQUIRE(recipes[0].at("ingredientId")==card);REQUIRE(recipes[0].at("qtyMilli")==1000);
 auto oldClient=x.call("ingredients.save",{{"sku","MENU-"+id},{"name","Test Cola yeni"},{"unit","ədəd"},{"costMinor",0}});REQUIRE(oldClient.at("id")==card);REQUIRE(x.call("goods.list",{{"search","476-test-new"}}).at("goods").size()==1);
}
TEST_CASE("catalog-only permissions create the paired empty stock card without an inventory permission hop", "[catalog][stock-sync]"){
 CatalogStockFixture x;x.f.ctx().session().permissions={"catalog.manage"};const auto id=pos::crypto::uuid4();REQUIRE_NOTHROW(x.product(id));REQUIRE_FALSE(x.card(id).empty());
}
TEST_CASE("catalog updates preserve a real recipe and archived stock card", "[catalog][stock-sync]"){
 CatalogStockFixture x;const auto id=pos::crypto::uuid4();x.product(id,"Dönər");const auto proxy=x.card(id);const auto raw=x.call("ingredients.save",{{"name","Ət"},{"unit","kg"},{"costMinor",1200}}).at("id");
 x.call("recipes.save",{{"menuItemId",id},{"lines",pos::Json::array({{{"ingredientId",raw},{"qtyMilli",200}}})}});
 x.call("ingredients.deactivate",{{"ingredientId",proxy}});x.product(id,"Dönər yeni",600);
 const auto lines=x.call("recipes.get",{{"menuItemId",id}}).at("lines");REQUIRE(lines.size()==1);REQUIRE(lines[0].at("ingredientId")==raw);REQUIRE(lines[0].at("qtyMilli")==200);
 auto q=x.f.db().prepare("SELECT active FROM ingredients WHERE id=:id");q.bind(":id",proxy);REQUIRE(q.step());REQUIRE(q.columnInt(0)==0);
}
TEST_CASE("a barcode conflict rolls the entire catalog write back instead of hiding a missing stock card", "[catalog][stock-sync]"){
 CatalogStockFixture x;x.call("ingredients.save",{{"name","Raw material"},{"unit","kg"},{"barcode","shared-code"},{"costMinor",100}});const auto id=pos::crypto::uuid4();REQUIRE_THROWS_AS(x.product(id,"New dish",150,"shared-code"),pos::PosError);
 auto q=x.f.db().prepare("SELECT COUNT(*) FROM menu_items WHERE id=:id");q.bind(":id",id);REQUIRE(q.step());REQUIRE(q.columnInt(0)==0);REQUIRE(x.card(id).empty());
}
TEST_CASE("an existing piece good with the same barcode is linked without duplicating its balance", "[catalog][stock-sync]"){
 CatalogStockFixture x;const auto existing=x.call("ingredients.save",{{"name","Cola stock"},{"unit","ədəd"},{"barcode","cola-existing"},{"costMinor",80}}).at("id").get<std::string>();pos::services::InventoryService(x.f.ctx()).move(existing,"wh-main",7000,"adjustment","","test");const auto id=pos::crypto::uuid4();x.product(id,"Cola",150,"cola-existing");REQUIRE(x.card(id)==existing);
 auto goods=x.call("goods.list",{{"search","cola-existing"}}).at("goods");REQUIRE(goods.size()==1);REQUIRE(goods[0].at("qtyMilli")==7000);REQUIRE(goods[0].at("costMinor")==80);
}
TEST_CASE("migration repairs missing historical stock links without replacing real recipes or stock values", "[catalog][stock-sync]"){
 CatalogStockFixture x;const auto missing=pos::crypto::uuid4(),recipe=pos::crypto::uuid4();
 for(const auto& id:{missing,recipe}){auto q=x.f.db().prepare("INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,active,created_at,updated_at) VALUES(:id,:cat,:sku,:name,300,1,1,1)");q.bind(":id",id).bind(":cat",x.category).bind(":sku","SKU-"+id).bind(":name",id).exec();}
 const auto raw=x.call("ingredients.save",{{"name","Real ingredient"},{"unit","kg"},{"costMinor",500}}).at("id");x.call("recipes.save",{{"menuItemId",recipe},{"lines",pos::Json::array({{{"ingredientId",raw},{"qtyMilli",250}}})}});
 x.f.db().exec(pos::db::kMigrations.back().sql());REQUIRE_FALSE(x.card(missing).empty());REQUIRE(x.card(recipe).empty());
 const auto lines=x.call("recipes.get",{{"menuItemId",recipe}}).at("lines");REQUIRE(lines.size()==1);REQUIRE(lines[0].at("ingredientId")==raw);REQUIRE(lines[0].at("qtyMilli")==250);
 const auto good=x.call("goods.list",{{"search",missing}}).at("goods");REQUIRE(good.size()==1);REQUIRE(good[0].at("qtyMilli")==0);
 x.f.db().exec(pos::db::kMigrations.back().sql());REQUIRE(x.call("goods.list",{{"search",missing}}).at("goods").size()==1);
}
TEST_CASE("free-form pizza sizes have independent stock cards prices and recipes and replay once", "[catalog][stock-sync][sizes]") {
 CatalogStockFixture x;pos::ipc::Request req;req.requestId=pos::crypto::uuid4();req.idempotencyKey="pizza-sizes-once";req.method="catalog.upsertProduct";req.payload={{"nameAz","Marqarit pizza"},{"categoryId",x.category},{"active",true},{"sizeVariants",pos::Json::array({{{"sizeCm",28},{"priceMinor",800}},{{"sizeCm",29.5},{"priceMinor",950}},{{"sizeCm",32},{"priceMinor",1200}}})}};
 const auto saved=x.f.server().callHandler(req);const auto rows=saved.at("variants");REQUIRE(rows.size()==3);REQUIRE(rows[0].at("nameAz")=="Marqarit pizza · 28 sm");REQUIRE(rows[1].at("nameAz")=="Marqarit pizza · 29.5 sm");
 const auto raw=x.call("ingredients.save",{{"name","Pizza unu"},{"unit","kg"},{"costMinor",200}}).at("id");
 for(int i=0;i<3;++i){const auto id=rows[i].at("id").get<std::string>();REQUIRE_FALSE(x.card(id).empty());x.call("recipes.save",{{"menuItemId",id},{"lines",pos::Json::array({{{"ingredientId",raw},{"qtyMilli",200+50*i}}})}});}
 for(int i=0;i<3;++i){const auto id=rows[i].at("id").get<std::string>();REQUIRE(x.call("recipes.get",{{"menuItemId",id}}).at("lines")[0].at("qtyMilli")==200+50*i);REQUIRE(x.call("catalog.product",{{"productId",id}}).at("priceMinor")==rows[i].at("priceMinor"));}
 req.requestId=pos::crypto::uuid4();REQUIRE(x.f.server().callHandler(req).at("variants")==rows);
 auto count=x.f.db().prepare("SELECT COUNT(*) FROM menu_items WHERE category_id=:cat");count.bind(":cat",x.category);REQUIRE(count.step());REQUIRE(count.columnInt(0)==3);
}
TEST_CASE("invalid or duplicate sizes never create partial catalog products", "[catalog][stock-sync][sizes]") {
 CatalogStockFixture x;for(const auto& variants:{pos::Json::array({{{"sizeCm",28},{"priceMinor",800}},{{"sizeCm",28.0},{"priceMinor",900}}}),pos::Json::array({{{"sizeCm",28},{"priceMinor",800}},{{"sizeCm",0},{"priceMinor",900}}}),pos::Json::array({{{"sizeCm",28},{"priceMinor",800}},{{"sizeCm",29},{"priceMinor",-1}}})})REQUIRE_THROWS_AS(x.call("catalog.upsertProduct",{{"nameAz","Pizza"},{"categoryId",x.category},{"sizeVariants",variants}}),pos::PosError);
 auto count=x.f.db().prepare("SELECT COUNT(*) FROM menu_items WHERE category_id=:cat");count.bind(":cat",x.category);REQUIRE(count.step());REQUIRE(count.columnInt(0)==0);
}
