#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/CashService.hpp"

namespace {
class BusinessFixture {
public:
 ServiceFixture f;
 BusinessFixture(){auto c=f.contextPtr();pos::handlers::registerInventory(c);pos::handlers::registerGuests(c);pos::handlers::registerCashAccounts(c);pos::handlers::registerSystem(c);pos::handlers::registerAuth(c);pos::handlers::registerBusiness(c);}
 pos::Json call(const std::string& method,pos::Json payload=pos::Json::object(),const std::string& key=""){pos::ipc::Request r;r.requestId=pos::crypto::uuid4();r.method=method;r.payload=std::move(payload);r.idempotencyKey=key.empty()?pos::crypto::uuid4():key;return f.server().callHandler(r);}
 pos::Json biz(const std::string& action,pos::Json p=pos::Json::object(),const std::string& key=""){p["action"]=action;return call("business.call",p,key);}
 std::string till(const std::string& name){return call("cashAccounts.save",{{"name",name},{"kind","treasury"}}).at("id");}
 pos::Money balance(const std::string& id){return pos::services::CashService(f.ctx()).accountBalance(id);}
 std::int64_t scalar(const std::string& sql){auto q=f.db().prepare(sql);q.step();return q.columnInt(0);}
};
}
TEST_CASE("payment corrections reverse the original till and replay only once","[business]"){
 BusinessFixture x;const auto a=x.till("A"),b=x.till("B");
 const auto customer=x.call("customers.save",{{"name","Aysel"}}).at("id").get<std::string>();
 x.call("customers.charge",{{"customerId",customer},{"amountMinor",10000}});
 x.call("customers.payDebt",{{"customerId",customer},{"amountMinor",2500},{"accountId",a},{"idempotencyKey","first-pay"}});
 const auto docs=x.biz("documents").at("documents");std::string id;for(const auto& d:docs)if(d.at("type")=="customer")id=d.at("id");REQUIRE(!id.empty());REQUIRE(x.balance(a)==2500);
 const pos::Json correction{{"type","customer"},{"id",id},{"amountMinor",4000},{"accountId",b},{"note","Düzəliş"}};
 x.biz("correct",correction,"edit-once");REQUIRE(x.balance(a)==0);REQUIRE(x.balance(b)==4000);
 REQUIRE(x.scalar("SELECT debt_minor FROM customers WHERE id='"+customer+"'")==6000);
 x.biz("correct",correction,"edit-once");REQUIRE(x.balance(b)==4000);
 REQUIRE_THROWS_AS(x.biz("correct",{{"type","customer"},{"id",id},{"amountMinor",8000},{"accountId","missing"}}),pos::PosError);
 REQUIRE(x.balance(b)==4000);REQUIRE(x.scalar("SELECT debt_minor FROM customers WHERE id='"+customer+"'")==6000);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM audit_logs WHERE action='document.correct'")==1);
}
TEST_CASE("expense editing updates one document and keeps till balances consistent","[business]"){
 BusinessFixture x;const auto a=x.till("Xəzinə"),b=x.till("İkinci xəzinə");
 const auto doc=x.call("cash.movement",{{"kind","expense"},{"amountMinor",1000},{"reason","İcarə"},{"accountId",a}}).at("movement");
 x.biz("correct",{{"type","expense"},{"id",doc.at("id")},{"amountMinor",1500},{"accountId",b},{"reason","İcarə düzəliş"}});
 REQUIRE(x.balance(a)==0);REQUIRE(x.balance(b)==-1500);
 const auto list=x.call("cash.list").at("movements");REQUIRE(list.size()==1);REQUIRE(list[0].at("accountId")==b);REQUIRE(list[0].at("amountMinor")==1500);
}
TEST_CASE("warehouse staff cannot bypass assigned stores with filters or document IDs","[business]"){
 BusinessFixture x;const auto other=x.call("warehouses.save",{{"name","Filial 2"},{"kind","store"}}).at("id").get<std::string>();
 const auto good=x.call("ingredients.save",{{"name","Çay"},{"unit","kg"}}).at("id").get<std::string>();
 pos::services::InventoryService inv(x.f.ctx());inv.move(good,"wh-main",3000,"adjustment","","test");inv.move(good,other,9000,"adjustment","","test");
 const auto count=x.call("stocktake.create",{{"warehouseId",other}}).at("id");
 auto q=x.f.db().prepare("INSERT INTO user_warehouse_access VALUES('usr-admin','wh-main')");q.exec();
 auto& s=x.f.ctx().session();s.role="warehouse";s.permissions={"inventory.view","inventory.manage","inventory.adjust","inventory.count","inventory.transfer","suppliers.view"};
 const auto warehouses=x.call("warehouses.list").at("warehouses");REQUIRE(warehouses.size()==1);REQUIRE(warehouses[0].at("id")=="wh-main");
 REQUIRE(x.call("ingredients.list").at("ingredients")[0].at("qtyMilli")==3000);
 REQUIRE(x.call("goods.list").at("goods")[0].at("qtyMilli")==3000);
 REQUIRE_THROWS_AS(x.call("inventory.levels",{{"warehouseId",other}}),pos::PosError);
 REQUIRE_THROWS_AS(x.call("stocktake.get",{{"id",count}}),pos::PosError);
 REQUIRE_THROWS_AS(x.call("ingredients.save",{{"id",good},{"name","Çay"},{"unit","kg"},{"stockDeltaMilli",1000},{"warehouseId",other}}),pos::PosError);
 REQUIRE_THROWS_AS(x.call("inventory.transfer",{{"ingredientId",good},{"fromWarehouseId","wh-main"},{"toWarehouseId",other},{"qtyMilli",1000}}),pos::PosError);
 s.role="manager";REQUIRE(x.call("warehouses.list").at("warehouses").size()>=2);
}
TEST_CASE("staff PIN identity and payroll identity stay linked without merging names blindly","[business]"){
 BusinessFixture x;
 const auto user=x.call("users.create",{{"fullName","Elvin"},{"pin","9286"},{"role","waiter"}}).at("id").get<std::string>();
 REQUIRE(x.scalar("SELECT COUNT(*) FROM customers WHERE user_id='"+user+"'")==1);
 x.biz("staff.save",{{"userId",user},{"salaryMinor",70000},{"warehouses",pos::Json::array({"wh-main"})}});
 REQUIRE(x.scalar("SELECT salary_minor FROM customers WHERE user_id='"+user+"'")==70000);
 x.call("users.update",{{"userId",user},{"fullName","Elvin Yeni"}});
 auto name=x.f.db().prepare("SELECT name FROM customers WHERE user_id=:u");name.bind(":u",user);REQUIRE(name.step());REQUIRE(name.columnText(0)=="Elvin Yeni");
 REQUIRE(x.scalar("SELECT COUNT(*) FROM user_warehouse_access WHERE user_id='"+user+"'")==1);
}
TEST_CASE("unified catalog publishes the same stock card and synchronizes name and price","[business]"){
 BusinessFixture x;
 const auto good=x.call("ingredients.save",{{"name","Sirab"},{"unit","ədəd"},{"salePriceMinor",120},{"barcode","4760000000123"}}).at("id").get<std::string>();
 const auto item=x.biz("catalog.publish",{{"ingredientId",good}}).at("id").get<std::string>();
 REQUIRE(x.biz("catalog.publish",{{"ingredientId",good}}).at("id")==item);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM ingredients WHERE id='"+good+"'")==1);
 REQUIRE(x.scalar("SELECT qty_milli FROM menu_item_ingredients WHERE menu_item_id='"+item+"' AND ingredient_id='"+good+"'")==1000);
 x.call("ingredients.save",{{"id",good},{"name","Sirab yeni"},{"unit","ədəd"},{"salePriceMinor",170}});
 REQUIRE(x.scalar("SELECT price_minor FROM menu_items WHERE id='"+item+"'")==170);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM menu_item_price_history WHERE item_id='"+item+"' AND old_price_minor=120 AND new_price_minor=170")==1);
}
TEST_CASE("an explicit staff merge keeps both payroll histories and customer debt","[business]"){
 BusinessFixture x;
 const auto user=x.call("users.create",{{"fullName","Leyla"},{"pin","6492"},{"role","waiter"}}).at("id").get<std::string>();
 const auto legacy=x.call("customers.save",{{"name","Leyla anbar"},{"kind","employee"}}).at("id").get<std::string>();
 auto q=x.f.db().prepare("SELECT id FROM customers WHERE user_id=:u");q.bind(":u",user);REQUIRE(q.step());const auto generated=q.columnText(0);
 x.call("customers.charge",{{"customerId",legacy},{"amountMinor",1000}});
 x.call("customers.charge",{{"customerId",generated},{"amountMinor",2000}});
 x.biz("staff.link",{{"userId",user},{"customerId",legacy}});
 REQUIRE(x.scalar("SELECT debt_minor FROM customers WHERE id='"+legacy+"'")==3000);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM customers WHERE user_id='"+user+"'")==1);
 REQUIRE(x.scalar("SELECT active FROM customers WHERE id='"+generated+"'")==0);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM customer_ledger WHERE customer_id='"+legacy+"'")==2);
}
TEST_CASE("salary correction preserves the expense link and changes each cash ledger exactly once","[business]"){
 BusinessFixture x;const auto a=x.till("Maaş xəzinəsi"),b=x.till("Maaş xəzinəsi 2");
 auto q=x.f.db().prepare("SELECT id FROM customers WHERE user_id='usr-admin'");REQUIRE(q.step());const auto employee=q.columnText(0);
 x.call("salary.pay",{{"customerId",employee},{"month","2026-10"},{"kind","advance"},{"amountMinor",2000},{"accountId",a},{"fromCash",true}});
 const auto paymentDocs=x.biz("documents").at("documents");std::string id;for(const auto& doc:paymentDocs)if(doc.at("type")=="salary")id=doc.at("id");REQUIRE(!id.empty());
 x.biz("correct",{{"type","salary"},{"id",id},{"amountMinor",3500},{"accountId",b}});
 REQUIRE(x.balance(a)==0);REQUIRE(x.balance(b)==-3500);
 const auto expenses=x.call("cash.list").at("movements");REQUIRE(expenses.size()==1);REQUIRE(expenses[0].at("amountMinor")==3500);REQUIRE(expenses[0].at("accountId")==b);
 REQUIRE_THROWS_AS(x.biz("correct",{{"type","expense"},{"id",expenses[0].at("id")},{"amountMinor",1500}}),pos::PosError);
}
TEST_CASE("deleting an expense reverses its cash once and hides the cancelled document","[business]"){
 BusinessFixture x;const auto a=x.till("Expense cancel");
 const auto id=x.call("cash.movement",{{"kind","expense"},{"amountMinor",1200},{"reason","Təmir"},{"accountId",a}}).at("movement").at("id");
 const pos::Json payload{{"type","expense"},{"id",id},{"amountMinor",0},{"cancel",true},{"accountId",a},{"note","Səhv xərc qaiməsi"}};
 x.biz("correct",payload,"cancel-once");x.biz("correct",payload,"cancel-once");
 REQUIRE(x.balance(a)==0);REQUIRE(x.call("cash.list").at("movements").empty());
 REQUIRE(x.scalar("SELECT COUNT(*) FROM cash_movements WHERE deleted_at IS NOT NULL")==1);
}
TEST_CASE("supplier payments can be corrected without changing the purchase history","[business]"){
 BusinessFixture x;const auto a=x.till("Supplier till");
 const auto supplier=x.call("suppliers.save",{{"name","Təchizatçı"}}).at("id").get<std::string>();
 x.call("suppliers.pay",{{"supplierId",supplier},{"amountMinor",500},{"accountId",a},{"idempotencyKey","supplier-pay"}});
 const auto docs=x.biz("documents").at("documents");std::string id;for(const auto& d:docs)if(d.at("type")=="supplier")id=d.at("id");REQUIRE(!id.empty());
 x.biz("correct",{{"type","supplier"},{"id",id},{"amountMinor",900},{"accountId",a}});
 REQUIRE(x.balance(a)==-900);REQUIRE(x.scalar("SELECT amount_minor FROM supplier_ledger WHERE id='"+id+"'")==900);
}
TEST_CASE("delivery filters by branch before pagination and identifies unpaid orders by origin","[business][delivery]"){
 BusinessFixture x;pos::handlers::registerOrders(x.f.contextPtr());pos::handlers::registerDelivery(x.f.contextPtr());
 const auto one=x.call("cashObjects.save",{{"name","Filial 1"}}).at("id");
 const auto two=x.call("cashObjects.save",{{"name","Filial 2"}}).at("id");
 x.call("cashAccounts.save",{{"name","Kassa A"},{"kind","till"},{"terminalId","terminal-a"},{"objectId",one}});
 x.call("cashAccounts.save",{{"name","Kassa B"},{"kind","till"},{"terminalId","terminal-b"},{"objectId",two}});
 const auto a=x.call("delivery.start",{{"address","Ünvan A"}}).at("id").get<std::string>();
 const auto b=x.call("delivery.start",{{"address","Ünvan B"}}).at("id").get<std::string>();
 auto set=x.f.db().prepare("UPDATE delivery_orders SET terminal_id=CASE WHEN id=:a THEN 'terminal-a' ELSE 'terminal-b' END WHERE id IN(:a,:b)");set.bind(":a",a).bind(":b",b);set.exec();
 const auto list=x.call("delivery.list",{{"objectId",two}});
 REQUIRE(list.at("deliveries").size()==1);REQUIRE(list.at("deliveries")[0].at("id")==b);REQUIRE(list.at("deliveries")[0].at("objectName")=="Filial 2");REQUIRE(list.at("objects").size()==2);
}
TEST_CASE("warehouse export cannot bypass store scoping","[business]"){
 BusinessFixture x;auto& s=x.f.ctx().session();s.role="storekeeper";s.permissions={"inventory.view","reports.export"};
 REQUIRE_THROWS_AS(x.call("reports.export",{{"kind","inventory"}}),pos::PosError);
}
TEST_CASE("remote branch summary counts all expenses without a row limit and rejects warehouse staff","[business][cloud]") {
 BusinessFixture x;const auto account=x.till("Filial");
 const auto expense=x.call("cash.movement",{{"kind","expense"},{"amountMinor",1000},{"reason","Cloud report"},{"accountId",account}}).at("movement");
 const auto now=pos::nowMs();const auto r=x.biz("branch.summary",{{"from",now-10000},{"to",now+10000}});
 REQUIRE(r.at("netSalesMinor")==0);REQUIRE(r.at("expensesMinor")==1000);REQUIRE(r.at("afterExpensesMinor")==-1000);REQUIRE(r.at("costOfGoodsDeducted")==false);
 x.biz("correct",{{"type","expense"},{"id",expense.at("id")},{"amountMinor",1500},{"accountId",account},{"reason","Updated"}});
 REQUIRE(x.biz("branch.summary",{{"from",now-10000},{"to",now+10000}}).at("expensesMinor")==1500);
 REQUIRE(x.biz("branch.summary",{{"from",now+20000},{"to",now+30000}}).at("expensesMinor")==0);
 auto bulk=x.f.db().prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<6000) INSERT INTO cash_movements(id,business_day_id,shift_id,kind,amount_minor,reason,note,actor_user_id,created_at) SELECT 'cloud-expense-'||x,m.business_day_id,m.shift_id,'expense',100,'Bulk','','usr-admin',m.created_at FROM n,cash_movements m WHERE m.id=:id");bulk.bind(":id",expense.at("id").get<std::string>());bulk.exec();
 REQUIRE(x.biz("branch.summary",{{"from",now-10000},{"to",now+10000}}).at("expensesMinor")==601500);

 REQUIRE_THROWS_AS(x.biz("branch.summary",{{"from",now+10000},{"to",now}}),pos::PosError);
 x.f.ctx().session().role="warehouse";x.f.ctx().session().permissions={"inventory.view"};
 REQUIRE_THROWS_AS(x.biz("branch.summary",{{"from",0},{"to",now+10000}}),pos::PosError);
}
TEST_CASE("owner-assigned cloud branch name is shown in the POS context","[business][cloud]") {
 BusinessFixture x;x.call("settings.set",{{"key","branch.cloudName"},{"value","Gənclik"}});
 REQUIRE(x.biz("context").at("branchName")=="Gənclik");
 x.call("settings.set",{{"key","branch.cloudName"},{"value","Nərimanov"}});
 REQUIRE(x.biz("context").at("branchName")=="Nərimanov");
}

TEST_CASE("payment documents use financial read or payment permissions and preserve party identity","[business][documents]") {
 BusinessFixture x;const auto account=x.till("Qaimə kassası");
 const auto customer=x.call("customers.save",{{"name","Qaimə müştərisi"}}).at("id").get<std::string>();
 x.call("customers.charge",{{"customerId",customer},{"amountMinor",5000}});
 x.call("customers.payDebt",{{"customerId",customer},{"amountMinor",1200},{"accountId",account}});
 x.call("cash.movement",{{"kind","expense"},{"amountMinor",500},{"reason","Qaimə xərci"},{"accountId",account}});
 auto& session=x.f.ctx().session();const auto all=session.permissions;
 REQUIRE(x.biz("documents").at("documents").size()==2);
 for(const auto* permission:{"customers.view","customers.credit"}) {
  session.permissions={permission};const auto docs=x.biz("documents").at("documents");
  REQUIRE(docs.size()==1);REQUIRE(docs[0].at("type")=="customer");REQUIRE(docs[0].at("partyId")==customer);REQUIRE(docs[0].at("accountId")==account);
  if(std::string(permission)=="customers.view")REQUIRE_THROWS_AS(x.biz("correct",{{"type","customer"},{"id",docs[0].at("id")},{"amountMinor",1500},{"accountId",account}}),pos::PosError);
 }
 session.permissions={"cash.manage"};REQUIRE(x.biz("documents").at("documents").size()==1);
 session.permissions={"inventory.view"};REQUIRE_THROWS_AS(x.biz("documents"),pos::PosError);
 session.permissions=all;REQUIRE(x.biz("documents").at("documents").size()==2);
}

TEST_CASE("transfer dispatch, partial acceptance and returned-stock receipt are separate idempotent movements","[market1529][transfer]"){
 BusinessFixture x;const auto destination=x.call("warehouses.save",{{"name","Qəbul anbarı"}}).at("id").get<std::string>();
 const auto good=x.call("ingredients.save",{{"name","Su"},{"unit","ədəd"},{"barcode","4760000000017"}}).at("id").get<std::string>();
 pos::services::InventoryService inv(x.f.ctx());inv.move(good,"wh-main",10000,"adjustment","","Opening");
 const auto payload=pos::Json{{"fromWarehouseId","wh-main"},{"toWarehouseId",destination},{"lines",pos::Json::array({{{"ingredientId",good},{"qtyMilli",6000}}})}};
 const auto draft=x.biz("transfer.save",payload,"draft");const auto id=draft.at("id");
 REQUIRE(x.biz("transfer.save",payload,"draft").at("id")==id);REQUIRE(inv.levelOf(good,"wh-main")==10000);
 const auto sent=x.biz("transfer.dispatch",{{"id",id}},"dispatch");REQUIRE(inv.levelOf(good,"wh-main")==4000);REQUIRE(inv.levelOf(good,destination)==0);
 x.biz("transfer.dispatch",{{"id",id}},"dispatch");REQUIRE(inv.levelOf(good,"wh-main")==4000);
 REQUIRE_THROWS_AS(x.biz("transfer.dispatch",{{"id",id}}),pos::PosError);
 const auto line=sent.at("lines")[0].at("id");
 REQUIRE_THROWS_AS(x.biz("transfer.receive",{{"id",id},{"lines",pos::Json::array({{{"id",line},{"acceptedMilli",4000},{"rejectedMilli",1000},{"reason","zədə"}}})}}),pos::PosError);
 REQUIRE_THROWS_AS(x.biz("transfer.receive",{{"id",id},{"lines",pos::Json::array({{{"id",line},{"acceptedMilli",4000},{"rejectedMilli",2000},{"reason"," "}}})}}),pos::PosError);
 REQUIRE(inv.levelOf(good,destination)==0);
 const pos::Json accept{{"id",id},{"lines",pos::Json::array({{{"id",line},{"acceptedMilli",4000},{"rejectedMilli",2000},{"reason","Zədələnib"}}})}};
 const auto received=x.biz("transfer.receive",accept,"receive");REQUIRE(received.at("status")=="return_pending");REQUIRE(received.at("returnDocument").at("status")=="return_pending");
 REQUIRE(inv.levelOf(good,destination)==4000);REQUIRE(inv.levelOf(good,"wh-main")==4000);
 x.biz("transfer.receive",accept,"receive");REQUIRE(inv.levelOf(good,destination)==4000);
 x.biz("transfer.returnConfirm",{{"id",id}},"back");x.biz("transfer.returnConfirm",{{"id",id}},"back");
 REQUIRE(inv.levelOf(good,"wh-main")==6000);REQUIRE(inv.levelOf(good,destination)==4000);
 REQUIRE(x.biz("transfer.get",{{"id",id}}).at("returnDocument").at("status")=="closed");
 const auto reverse=x.biz("transfer.reverse",{{"id",id},{"reason","Səhv göndəriş"}});REQUIRE(reverse.at("reversalOf")==id);REQUIRE(reverse.at("status")=="draft");REQUIRE(inv.levelOf(good,destination)==4000);
 REQUIRE_THROWS_AS(x.biz("transfer.reverse",{{"id",id},{"reason","yenə"}}),pos::PosError);
}
TEST_CASE("cross-device transfer survives repeated delivery and binds signed sender and recipient","[market1529][transfer]"){
 BusinessFixture a,b;const auto good=a.call("ingredients.save",{{"name","Çay"},{"unit","kg"},{"barcode","4761111111111"}}).at("id").get<std::string>();
 pos::services::InventoryService ai(a.f.ctx()),bi(b.f.ctx());ai.move(good,"wh-main",5000,"adjustment","","Opening");
 const auto doc=a.biz("transfer.save",{{"fromWarehouseId","wh-main"},{"toWarehouseId","wh-main"},{"fromDeviceId","A"},{"toDeviceId","B"},{"lines",pos::Json::array({{{"ingredientId",good},{"qtyMilli",5000}}})}});
 a.biz("transfer.dispatch",{{"id",doc.at("id")}});const auto event=a.biz("transfer.outbox").at("events")[0];
 REQUIRE(ai.levelOf(good,"wh-main")==0);REQUIRE(b.biz("transfer.list").at("documents").empty());
 REQUIRE_THROWS_AS(b.biz("transfer.sync",{{"event",event.at("payload")},{"cloudSourceDeviceId","C"},{"cloudTargetDeviceId","B"}}),pos::PosError);
 REQUIRE_THROWS_AS(b.biz("transfer.sync",{{"event",event.at("payload")},{"cloudSourceDeviceId","A"},{"cloudTargetDeviceId","C"}}),pos::PosError);
 const pos::Json delivery{{"event",event.at("payload")},{"cloudSourceDeviceId","A"},{"cloudTargetDeviceId","B"}};
 b.biz("transfer.sync",delivery,"first-delivery");b.biz("transfer.sync",delivery,"first-delivery");b.biz("transfer.sync",delivery,"again");
 const auto received=b.biz("transfer.get",{{"id",doc.at("id")}}),localGood=received.at("lines")[0].at("ingredientId");REQUIRE(bi.levelOf(localGood,"wh-main")==0);
 b.biz("transfer.receive",{{"id",doc.at("id")},{"lines",pos::Json::array({{{"id",received.at("lines")[0].at("id")},{"acceptedMilli",0},{"rejectedMilli",5000},{"reason","Qəbul edilmir"}}})}});
 REQUIRE(bi.levelOf(localGood,"wh-main")==0);
 const auto response=b.biz("transfer.outbox").at("events")[0].at("payload");a.biz("transfer.sync",{{"event",response},{"cloudSourceDeviceId","B"},{"cloudTargetDeviceId","A"}});
 REQUIRE(ai.levelOf(good,"wh-main")==0);a.biz("transfer.returnConfirm",{{"id",doc.at("id")}});REQUIRE(ai.levelOf(good,"wh-main")==5000);
 const auto events=a.biz("transfer.outbox").at("events");const auto returned=events[events.size()-1].at("payload");
 b.biz("transfer.sync",{{"event",returned},{"cloudSourceDeviceId","A"},{"cloudTargetDeviceId","B"}});REQUIRE(b.biz("transfer.get",{{"id",doc.at("id")}}).at("status")=="closed");
}
TEST_CASE("soft-cancelled customer and payroll payments retain evidence and reverse balances once","[market1529][documents]"){
 BusinessFixture x;const auto account=x.till("Əsas xəzinə");const auto customer=x.call("customers.save",{{"name","Borc müştərisi"}}).at("id");
 x.call("customers.charge",{{"customerId",customer},{"amountMinor",10000}});x.call("customers.payDebt",{{"customerId",customer},{"amountMinor",3000},{"accountId",account},{"idempotencyKey","pay"}});
 const auto paymentRows=x.biz("documents").at("documents");pos::Json payment;for(const auto&r:paymentRows)if(r.at("type")=="customer")payment=r;
 const pos::Json cancel{{"type","customer"},{"id",payment.at("id")},{"cancel",true},{"note","Səhv ödəniş"}};
 REQUIRE_THROWS_AS(x.biz("correct",{{"type","customer"},{"id",payment.at("id")},{"cancel",true}}),pos::PosError);
 x.biz("correct",cancel,"cancel");x.biz("correct",cancel,"cancel");REQUIRE(x.balance(account)==0);REQUIRE(x.scalar("SELECT debt_minor FROM customers WHERE id='"+customer.get<std::string>()+"'")==10000);
 REQUIRE(x.biz("document.get",{{"type","customer"},{"id",payment.at("id")}}).at("document").at("cancelled")==true);REQUIRE_THROWS_AS(x.biz("correct",cancel),pos::PosError);
 const auto employee=x.call("customers.save",{{"name","Maaş işçisi"},{"kind","employee"},{"salaryMinor",50000}}).at("id");
 x.call("salary.pay",{{"customerId",employee},{"month","2026-10"},{"kind","advance"},{"amountMinor",2000},{"accountId",account},{"fromCash",true}});
 const auto salaryRows=x.biz("documents").at("documents");pos::Json salary;for(const auto&r:salaryRows)if(r.at("type")=="salary")salary=r;
 const pos::Json salaryCancel{{"type","salary"},{"id",salary.at("id")},{"cancel",true},{"note","Səhv maaş ödənişi"}};
 REQUIRE(x.balance(account)==-2000);x.biz("correct",salaryCancel,"salary-cancel");x.biz("correct",salaryCancel,"salary-cancel");REQUIRE(x.balance(account)==0);REQUIRE(x.scalar("SELECT SUM(amount_minor) FROM salary_payments")==0);
 REQUIRE(x.scalar("SELECT COUNT(*) FROM document_voids")==2);
}
TEST_CASE("market credit ledger events replay without duplicate debt","[market1529][credit]"){
 BusinessFixture x;const pos::Json payload{{"customers",pos::Json::array({{{"id","native-customer"},{"name","Partnyor"},{"creditAllowed",true},{"creditLimitMinor",10000}}})},{"events",pos::Json::array({{{"id","ledger-sale"},{"customer_id","native-customer"},{"amount_minor",2500},{"created_at",pos::nowMs()}}})}};
 x.biz("party.import",payload);x.biz("party.import",payload);REQUIRE(x.scalar("SELECT debt_minor FROM customers WHERE id='native-customer'")==2500);REQUIRE(x.scalar("SELECT COUNT(*) FROM market_customer_events")==1);
 x.biz("party.import",{{"events",pos::Json::array({{{"id","ledger-refund"},{"customer_id","native-customer"},{"amount_minor",-500},{"created_at",pos::nowMs()}}})}});REQUIRE(x.scalar("SELECT debt_minor FROM customers WHERE id='native-customer'")==2000);
}
TEST_CASE("a reverse cross-device transfer restores the original product without a barcode","[market1529][transfer]"){
 BusinessFixture a,b;const auto good=a.call("ingredients.save",{{"name","Barkodsuz məhsul"},{"unit","kg"}}).at("id").get<std::string>();pos::services::InventoryService ai(a.f.ctx()),bi(b.f.ctx());ai.move(good,"wh-main",3000,"adjustment","","Opening");
 const auto d=a.biz("transfer.save",{{"fromWarehouseId","wh-main"},{"toWarehouseId","wh-main"},{"fromDeviceId","A"},{"toDeviceId","B"},{"lines",pos::Json::array({{{"ingredientId",good},{"qtyMilli",3000}}})}});a.biz("transfer.dispatch",{{"id",d.at("id")}});
 auto event=a.biz("transfer.outbox").at("events")[0];b.biz("transfer.sync",{{"event",event.at("payload")},{"cloudSourceDeviceId","A"},{"cloudTargetDeviceId","B"}});const auto incoming=b.biz("transfer.get",{{"id",d.at("id")}});b.biz("transfer.receive",{{"id",d.at("id")},{"lines",pos::Json::array({{{"id",incoming.at("lines")[0].at("id")},{"acceptedMilli",3000},{"rejectedMilli",0}}})}});
 event=b.biz("transfer.outbox").at("events")[0];a.biz("transfer.sync",{{"event",event.at("payload")},{"cloudSourceDeviceId","B"},{"cloudTargetDeviceId","A"}});b.biz("transfer.ack",{{"eventId",event.at("id")}});
 const auto reverse=b.biz("transfer.reverse",{{"id",d.at("id")},{"reason","Əlaqəli düzəliş"}});b.biz("transfer.dispatch",{{"id",reverse.at("id")}});event=b.biz("transfer.outbox").at("events")[0];a.biz("transfer.sync",{{"event",event.at("payload")},{"cloudSourceDeviceId","B"},{"cloudTargetDeviceId","A"}});const auto returned=a.biz("transfer.get",{{"id",reverse.at("id")}});REQUIRE(returned.at("lines")[0].at("ingredientId")==good);
 a.biz("transfer.receive",{{"id",reverse.at("id")},{"lines",pos::Json::array({{{"id",returned.at("lines")[0].at("id")},{"acceptedMilli",3000},{"rejectedMilli",0}}})}});REQUIRE(ai.levelOf(good,"wh-main")==3000);REQUIRE(a.scalar("SELECT COUNT(*) FROM ingredients WHERE name='Barkodsuz məhsul'")==1);
}
