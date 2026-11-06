#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/services/OperationalReset.hpp"
#include "pos/services/CashService.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/Crypto.hpp"
#include <filesystem>
namespace {
std::int64_t count(pos::db::Database& db,const std::string& table){auto q=db.prepare("SELECT COUNT(*) FROM "+table);REQUIRE(q.step());return q.columnInt(0);}
void seed(ServiceFixture& f){
 auto& db=f.db();
 db.exec("INSERT INTO menu_categories(id,name_az) VALUES('reset-cat','Pizza')");
 db.exec("INSERT INTO menu_items(id,category_id,sku,name_az,price_minor,cost_minor,image,created_at,updated_at) VALUES('reset-pizza','reset-cat','RESET-PIZZA','Pizza 28 sm',1200,500,'https://possistem.az/a.webp',1,1)");
 db.exec("INSERT INTO ingredients(id,sku,name,unit,cost_minor,sale_price_minor,created_at,updated_at) VALUES('reset-flour','RESET-FLOUR','Un','kg',200,0,1,1)");
 db.exec("INSERT INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) VALUES('reset-pizza','reset-flour',250)");
 db.exec("INSERT INTO cash_accounts(id,name,kind,created_at) VALUES('reset-safe','Xəzinə','treasury',1)");
 db.exec("INSERT INTO cash_account_moves(id,account_id,amount_minor,kind,created_at) VALUES('reset-opening','reset-safe',32530,'opening',1)");
 db.exec("INSERT INTO income_docs(id,number,doc_at,amount_minor,kind,reason,created_at,updated_at) VALUES('reset-income','TEST',1,200,'other','Test',1,1)");
 db.exec("INSERT INTO stock_levels(ingredient_id,warehouse_id,qty_milli,updated_at) VALUES('reset-flour','wh-main',10000,1)");
 db.exec("UPDATE restaurant_tables SET status='occupied' WHERE id='tbl-01'");
 db.exec("INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES('printer.receipt','Xprinter',1)");
}
}
TEST_CASE("test operation reset keeps catalog recipes prices access and printer settings with a recoverable copy","[reset-operations]"){
 ServiceFixture f;seed(f);auto& db=f.db();const auto before=pos::services::OperationalReset::preview(db);
 const auto result=pos::services::OperationalReset::run(db,"test-reset",before.at("catalogHash"),"Customer requested test data reset");
 REQUIRE(result.at("reset")==true);REQUIRE(pos::services::OperationalReset::preview(db).at("catalogHash")==before.at("catalogHash"));
 REQUIRE(count(db,"cash_account_moves")==0);REQUIRE(count(db,"stock_levels")==0);REQUIRE(count(db,"income_docs")==0);
 REQUIRE(count(db,"menu_item_ingredients")==1);REQUIRE(count(db,"users")>0);REQUIRE(pos::services::CashService(f.ctx()).accountBalance("reset-safe")==0);
 auto table=db.prepare("SELECT status FROM restaurant_tables WHERE id='tbl-01'");REQUIRE(table.step());REQUIRE(table.columnText(0)=="available");
 const auto file=std::filesystem::path(db.path()).parent_path()/"backups"/result.at("keptCopy").get<std::string>();REQUIRE(std::filesystem::exists(file));
 pos::db::Database backup;backup.open(file.string());REQUIRE(count(backup,"cash_account_moves")==1);REQUIRE(count(backup,"stock_levels")==1);backup.close();
 // Replaying a reset after new activity must leave the new activity alone.
 db.exec("INSERT INTO cash_account_moves(id,account_id,amount_minor,kind,created_at) VALUES('new-money','reset-safe',100,'opening',2)");
 REQUIRE(pos::services::OperationalReset::run(db,"test-reset",before.at("catalogHash"),"Same reset retry").at("replayed")==true);REQUIRE(count(db,"cash_account_moves")==1);
}
TEST_CASE("reset refuses a stale catalog and rolls back on unknown dependent operational data","[reset-operations]"){
 ServiceFixture f;seed(f);auto& db=f.db();const auto hash=pos::services::OperationalReset::preview(db).at("catalogHash").get<std::string>();
 db.exec("UPDATE menu_items SET price_minor=1500 WHERE id='reset-pizza'");
 REQUIRE_THROWS(pos::services::OperationalReset::run(db,"stale",hash,"Stale preview"));REQUIRE(count(db,"cash_account_moves")==1);
 const auto current=pos::services::OperationalReset::preview(db).at("catalogHash").get<std::string>();
 db.exec("CREATE TABLE future_document(id TEXT PRIMARY KEY,move_id TEXT REFERENCES cash_account_moves(id))");db.exec("INSERT INTO future_document VALUES('future','reset-opening')");
 REQUIRE_THROWS(pos::services::OperationalReset::run(db,"future",current,"New schema dependency"));REQUIRE(count(db,"cash_account_moves")==1);REQUIRE(count(db,"future_document")==1);
}
TEST_CASE("reset method requires permission confirmation and an idle payment service","[reset-operations]"){
 ServiceFixture f;seed(f);pos::handlers::registerSystem(f.contextPtr());pos::ipc::Request req;req.requestId=pos::crypto::uuid4();req.method="system.resetOperational";req.payload={{"preview",true}};
 const auto preview=f.server().callHandler(req);REQUIRE(preview.contains("catalogHash"));
 req.payload={{"commandId","no-confirm"},{"catalogHash",preview.at("catalogHash")},{"reason","Test reset"}};REQUIRE_THROWS(f.server().callHandler(req));
 f.ctx().session().permissions.clear();req.payload={{"preview",true}};REQUIRE_THROWS(f.server().callHandler(req));
}
