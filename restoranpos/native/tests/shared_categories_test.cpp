#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
namespace {
pos::Json run(ServiceFixture& f,const std::string& method,pos::Json payload){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.idempotencyKey=pos::crypto::uuid4();r.method=method;r.payload=std::move(payload);return f.server().callHandler(r);}
void setup(ServiceFixture& f){pos::handlers::registerCatalog(f.contextPtr());pos::handlers::registerErp(f.contextPtr());}
std::string stock(ServiceFixture& f,const std::string& menu){auto q=f.db().prepare("SELECT stock_category_id FROM catalog_category_links WHERE menu_category_id=:m");q.bind(":m",menu);REQUIRE(q.step());return q.columnText(0);}
}
TEST_CASE("menu and warehouse categories share stable linked identities including same-name roots and children","[shared_categories]"){
 ServiceFixture f;setup(f);
 const auto root=run(f,"catalog.upsertCategory",{{"nameAz","1"}}).at("id").get<std::string>();
 const auto child=run(f,"catalog.upsertCategory",{{"nameAz","2"},{"parentId",root}}).at("id").get<std::string>();
 const auto another=run(f,"catalog.upsertCategory",{{"nameAz","2"}}).at("id").get<std::string>();
 REQUIRE(stock(f,another)!=stock(f,child));
 auto q=f.db().prepare("SELECT parent_id,name FROM stock_categories WHERE id=:id");q.bind(":id",stock(f,child));REQUIRE(q.step());REQUIRE(q.columnText(0)==stock(f,root));REQUIRE(q.columnText(1)=="2");
 run(f,"categories.save",{{"id",stock(f,child)},{"name","Döner"},{"parentId",stock(f,root)}});
 auto m=f.db().prepare("SELECT name_az,parent_id FROM menu_categories WHERE id=:id");m.bind(":id",child);REQUIRE(m.step());REQUIRE(m.columnText(0)=="Döner");REQUIRE(m.columnText(1)==root);
 REQUIRE_THROWS(run(f,"categories.save",{{"id",stock(f,root)},{"name","1"},{"parentId",stock(f,another)}}));
}
TEST_CASE("finished dishes classify their existing stock cards and follow native category moves","[shared_categories]"){
 ServiceFixture f;setup(f);const auto a=run(f,"catalog.upsertCategory",{{"nameAz","A"}}).at("id").get<std::string>(),b=run(f,"catalog.upsertCategory",{{"nameAz","B"}}).at("id").get<std::string>();
 const auto dish=run(f,"catalog.upsertProduct",{{"nameAz","Döner"},{"categoryId",a},{"priceMinor",500},{"active",true}}).at("id").get<std::string>();
 auto i=f.db().prepare("SELECT i.id,i.category_id FROM ingredients i JOIN catalog_goods_links l ON l.ingredient_id=i.id WHERE l.menu_id=:m");i.bind(":m",dish);REQUIRE(i.step());const auto ingredient=i.columnText(0);REQUIRE(i.columnText(1)==stock(f,a));
 run(f,"catalog.upsertProduct",{{"id",dish},{"nameAz","Döner"},{"categoryId",b}});
 auto check=f.db().prepare("SELECT category_id,sale_price_minor FROM ingredients WHERE id=:i");check.bind(":i",ingredient);REQUIRE(check.step());REQUIRE(check.columnText(0)==stock(f,b));REQUIRE(check.columnInt(1)==500);
 REQUIRE_THROWS(run(f,"catalog.archiveCategory",{{"categoryId",b}}));
}
TEST_CASE("stock-only raw materials are not silently made into sale products","[shared_categories]"){
 ServiceFixture f;setup(f);const auto category=run(f,"categories.save",{{"name","Xammal"}}).at("id").get<std::string>();
 auto q=f.db().prepare("SELECT COUNT(*) FROM catalog_category_links WHERE stock_category_id=:id");q.bind(":id",category);REQUIRE(q.step());REQUIRE(q.columnInt(0)==1);
 auto products=f.db().prepare("SELECT COUNT(*) FROM menu_items WHERE category_id=(SELECT menu_category_id FROM catalog_category_links WHERE stock_category_id=:id)");products.bind(":id",category);REQUIRE(products.step());REQUIRE(products.columnInt(0)==0);
}
