#include "pos/handlers/Handlers.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/ReportService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/CatalogAdminService.hpp"
#include "TransferWorkflows.hpp"
#include "WasteDocuments.hpp"
#include <set>
#include <map>

namespace pos::handlers {
namespace {
bool manager(Context& ctx) {
    const auto& s=ctx.requireAuth();
    return s.role=="administrator" || s.role=="manager" || s.permissions.contains("users.manage");
}
std::set<std::string> stores(Context& ctx) {
    auto q=ctx.db().prepare("SELECT a.warehouse_id FROM user_warehouse_access a JOIN warehouses w ON w.id=a.warehouse_id AND w.active=1 WHERE a.user_id=:id");
    q.bind(":id",ctx.session().userId);
    std::set<std::string> ids;
    while(q.step()) ids.insert(q.columnText(0));
    return ids;
}
void checkStore(const std::set<std::string>& allowed,const std::string& id) {
    if(!allowed.contains(id)) throw PosError(std::string(protocol::err::kForbidden),"Yalnız sizə təyin edilmiş anbara icazəniz var");
}
// Runs inside the authenticated request scope, for local AND LAN/portal calls.
bool scopedManager(Context&ctx,const Json&p){return p.contains("_marketScope")?p.at("_marketScope").value("role",std::string{})=="manager":manager(ctx);}
std::set<std::string> scopedStores(Context&ctx,const Json&p){if(!p.contains("_marketScope"))return stores(ctx);std::set<std::string> out;for(const auto&id:p.at("_marketScope").value("warehouseIds",Json::array()))out.insert(id.get<std::string>());return out;}
void warehouseRequest(Context& ctx,ipc::Request& r) {
    if(!ctx.session().authenticated || scopedManager(ctx,r.payload)) return;
    const auto& m=r.method;
    if(m=="reports.export") throw PosError(std::string(protocol::err::kForbidden),"Təyin edilmiş anbarın Excel düyməsindən istifadə edin");
    const bool stock=m.rfind("inventory.",0)==0 || m.rfind("stocktake.",0)==0 || m.rfind("purchases.",0)==0 ||
        m.rfind("goods.",0)==0 || m.rfind("ingredients.",0)==0 || m.rfind("warehouses.",0)==0 || m.rfind("replenishment.",0)==0 ||
        m.rfind("lots.",0)==0 || m.rfind("locations.",0)==0 || m.rfind("stock.",0)==0 || m.rfind("stockRules.",0)==0 || m.rfind("replenish.",0)==0 || m=="reports.expiry" || m=="reports.stockLoss" || m=="reports.suppliers" || m=="reports.costing";
    if(!stock) return;
    require(m!="inventory.costingMethod","Maya hesablama üsulunu yalnız müdir dəyişə bilər");
    const auto allowed=scopedStores(ctx,r.payload);
    if(m=="warehouses.list" || m=="ingredients.list") return;
    require(!allowed.empty(),"İşçiyə anbar təyin edilməyib. Müdir İşçilər bölməsindən anbar seçməlidir");
    if(m=="warehouses.save") {
        checkStore(allowed,r.payload.value("id",std::string{}));
    }
    for(const char* k:{"warehouseId","fromWarehouseId","toWarehouseId"}) {
        if(r.payload.contains(k) && !r.payload[k].is_null() && !r.payload.value(k,std::string{}).empty()) checkStore(allowed,r.payload[k]);
    }
    // A missing filter is this operator's store, never all stores.
    if(!r.payload.contains("warehouseId") || r.payload["warehouseId"].is_null() || r.payload.value("warehouseId",std::string{}).empty()) {
        require(allowed.size()==1,"Anbarı seçin");
        r.payload["warehouseId"]=*allowed.begin();
    }
    // Detail and mutation endpoints also need protection against a foreign ID.
    auto document=[&](const char* key,const std::string& table,const std::string& column="warehouse_id") {
        const auto id=r.payload.value(key,std::string{});
        if(id.empty()) return;
        auto q=ctx.db().prepare("SELECT "+column+" FROM "+table+" WHERE id=:id");
        q.bind(":id",id); if(q.step()) checkStore(allowed,q.columnText(0));
    };
    if(m.rfind("stocktake.",0)==0) {document("id","stocktakes");document("stocktakeId","stocktakes");}
    if(m.rfind("purchases.",0)==0) {document("purchaseId","purchase_orders");document("id","purchase_orders");document("returnId","purchase_returns");}
    if(m.rfind("lots.",0)==0) {document("lotId","stock_lots");document("id","stock_lots");}
    if(m.rfind("locations.",0)==0) document("id","stock_locations");
}
void warehouseResult(Context& ctx,const ipc::Request& r,Json& data) {
    if(!ctx.session().authenticated || scopedManager(ctx,r.payload)) return;
    if(r.method=="ingredients.list") {
        std::map<std::string,std::int64_t> quantities;
        auto q=ctx.db().prepare("SELECT s.ingredient_id,SUM(s.qty_milli) FROM stock_levels s JOIN user_warehouse_access a ON a.warehouse_id=s.warehouse_id WHERE a.user_id=:u GROUP BY s.ingredient_id");
        q.bind(":u",ctx.session().userId);while(q.step())quantities[q.columnText(0)]=q.columnInt(1);
        if(r.payload.contains("_marketScope")){quantities.clear();for(const auto&w:scopedStores(ctx,r.payload)){auto stock=ctx.db().prepare("SELECT ingredient_id,qty_milli FROM stock_levels WHERE warehouse_id=:w");stock.bind(":w",w);while(stock.step())quantities[stock.columnText(0)]+=stock.columnInt(1);}}
        for(auto& row:data["ingredients"]) row["qtyMilli"]=quantities[row.at("id").get<std::string>()];
    }
    if(r.method!="warehouses.list") return;
    const auto allowed=scopedStores(ctx,r.payload);
    Json rows=Json::array();
    for(const auto& w:data.value("warehouses",Json::array())) if(allowed.contains(w.value("id",std::string{}))) rows.push_back(w);
    data["warehouses"]=rows;
}
Json context(Context& ctx) {
    ctx.requireAuth();
    auto q=ctx.db().prepare("SELECT a.id AS accountId,a.name AS accountName,COALESCE(o.id,'') AS objectId,COALESCE(o.name,'') AS branchName,COALESCE(o.warehouse_id,'') AS warehouseId FROM cash_accounts a LEFT JOIN cash_objects o ON o.id=a.object_id WHERE a.kind='till' AND a.active=1 AND a.terminal_id=:t LIMIT 1");
    q.bind(":t",ctx.saleTerminalId());
    Json out=q.step()?q.row():Json::object();
    if(out.value("branchName",std::string{}).empty()) out["branchName"]=ctx.setting("branch.name",ctx.setting("restaurant.name"));
    const auto cloudName=ctx.setting("branch.cloudName","");if(!cloudName.empty())out["branchName"]=cloudName;
    out["terminalId"]=ctx.saleTerminalId();out["manager"]=manager(ctx);
    return out;
}
Json correct(Context& ctx,const Json& p) {
    auto type=p.value("type",std::string{});if(type=="cash")type="expense";const auto id=p.value("id",std::string{});
    const bool cash=type=="expense" || type=="cash", customer=type=="customer",supplier=type=="supplier",salary=type=="salary";
    require(cash||customer||supplier||salary,"Qaimə növü tanınmadı");
    ctx.requirePermission(cash?"cash.manage":customer?"customers.credit":supplier?"suppliers.pay":"salary.manage");
    const bool cancel=p.value("cancel",false);
    const Money amount=cancel?0:getOr<Money>(p,"amountMinor",-1);
    require((amount>0 || cancel) && amount<=1000000000000LL,"Məbləğ düzgün deyil");
    if(cancel)require(p.value("note",std::string{}).find_first_not_of(" \t\r\n")!=std::string::npos,"Ləğv səbəbini yazın");
    auto cancelled=ctx.db().prepare("SELECT 1 FROM document_voids WHERE doc_type=:t AND doc_id=:id");cancelled.bind(":t",type).bind(":id",id);require(!cancelled.step(),"Qaimə artıq ləğv edilib");
    const auto table=cash?"cash_movements":customer?"customer_ledger":supplier?"supplier_ledger":"salary_payments";
    auto q=ctx.db().prepare("SELECT * FROM "+std::string(table)+" WHERE id=:id");q.bind(":id",id);
    require(q.step(),"Qaimə tapılmadı"); const Json before=q.row();
    require(cash || before.value("kind",std::string{})=="payment" || salary,"Yalnız ödəniş qaiməsini burada dəyişmək olar");
    require(!cash || !before.contains("deleted_at") || before["deleted_at"].is_null(),"Qaimə artıq ləğv edilib");
    require(!cash || before.value("kind",std::string{})!="drawer_open","Kassa açılması ödəniş deyil");
    require(!salary || before.value("kind",std::string{})!="note","Bu sənəd qeyddir");
    auto link=ctx.db().prepare("SELECT account_id,cash_movement_id FROM document_cash_links WHERE doc_type=:t AND doc_id=:id");
    link.bind(":t",type).bind(":id",id);
    std::string oldAccount, linkedCash;
    bool known=link.step();
    if(known){oldAccount=link.columnText(0);linkedCash=link.columnText(1);}
    if(cash) {
        auto a=ctx.db().prepare("SELECT account_id FROM cash_account_moves WHERE ref_type='cash_movement' AND ref_id=:id ORDER BY created_at DESC,rowid DESC LIMIT 1");
        a.bind(":id",id);if(a.step()) oldAccount=a.columnText(0);known=true;
        // Salary expenses are edited from the salary document to keep both ledgers together.
        auto owner=ctx.db().prepare("SELECT 1 FROM document_cash_links WHERE doc_type='salary' AND cash_movement_id=:id");
        owner.bind(":id",id);require(!owner.step(),"Maaş qaiməsini Maaşlar bölməsindən düzəldin");
    }
    require(known,"Köhnə ödənişin kassası dəqiq müəyyən edilmir. Kassa əlaqəsi yoxlanılmadan məbləğ dəyişdirilə bilməz");
    if(customer&&!cancel&&p.contains("_marketScope")) {
        auto due=ctx.db().prepare("SELECT debt_minor FROM customers WHERE id=:id");due.bind(":id",before.at("customer_id").get<std::string>());
        require(due.step()&&amount<=due.columnInt(0)+before.value("amount_minor",Money{0}),"Ödəniş müştəri borcunu aşa bilməz");
    }
    const auto nextAccount=p.value("accountId",oldAccount);
    const auto note=p.value("note",before.value("note",std::string{}));
    const auto at=p.value("docAt",before.value("created_at",Timestamp{0}));
    require(at>0,"Tarix düzgün deyil");
    const auto reason=p.value("reason",before.value("reason",std::string{}));
    require(!cash || !reason.empty(),"Səbəb tələb olunur");
    const auto kind=before.value("kind",std::string{});
    const int sign=customer || (cash && (kind=="cash_in"||kind=="float_adjust"))?1:-1;
    services::CashService service(ctx);
    if(!oldAccount.empty()) service.accountMove(oldAccount,-sign*before.value("amount_minor",Money{0}),"correction",cash?"cash_movement":type,id,"Əvvəlki qaimənin əks yazılışı");
    if(!nextAccount.empty() && amount>0) service.accountMove(nextAccount,sign*amount,"correction",cash?"cash_movement":type,id,"Qaiməyə düzəliş");
    auto u=ctx.db().prepare("UPDATE "+std::string(table)+" SET amount_minor=:a,note=:n,created_at=:at"+(cash?",reason=:r":std::string{})+" WHERE id=:id");
    u.bind(":a",amount).bind(":n",note).bind(":at",at).bind(":id",id);if(cash)u.bind(":r",reason);u.exec();
    if(cancel) {
        auto archive=ctx.db().prepare("INSERT INTO document_voids(doc_type,doc_id,before_json,original_amount_minor,reason,actor_id,voided_at) VALUES(:t,:id,:b,:amount,:reason,:actor,:at)");
        archive.bind(":t",type).bind(":id",id).bind(":b",before.dump()).bind(":amount",before.value("amount_minor",Money{0})).bind(":reason",note).bind(":actor",transfer_workflows::actor(ctx,p)).bind(":at",nowMs());archive.exec();
        if(cash || !linkedCash.empty()){auto mark=ctx.db().prepare("UPDATE cash_movements SET deleted_at=:at WHERE id=:id");mark.bind(":at",nowMs()).bind(":id",cash?id:linkedCash);mark.exec();}
    }
    auto save=ctx.db().prepare("INSERT INTO document_cash_links(doc_type,doc_id,account_id,cash_movement_id) VALUES(:t,:id,:a,:c) ON CONFLICT(doc_type,doc_id) DO UPDATE SET account_id=excluded.account_id");
    save.bind(":t",type).bind(":id",id).bind(":a",nextAccount).bind(":c",linkedCash);save.exec();
    if(customer) {
        auto debt=ctx.db().prepare("UPDATE customers SET debt_minor=(SELECT COALESCE(SUM(CASE WHEN kind='payment' THEN -amount_minor ELSE amount_minor END),0) FROM customer_ledger WHERE customer_id=customers.id),updated_at=:now WHERE id=:id");
        debt.bind(":id",before.at("customer_id").get<std::string>()).bind(":now",nowMs());debt.exec();
    }
    if(supplier && before.contains("purchase_id") && before["purchase_id"].is_string()) {
        refreshPurchase(ctx,before["purchase_id"].get<std::string>());
    }
    if(salary && !linkedCash.empty()) {
        auto expense=ctx.db().prepare("UPDATE cash_movements SET amount_minor=:a,note=:n,created_at=:at WHERE id=:id");
        expense.bind(":a",amount).bind(":n",note).bind(":at",at).bind(":id",linkedCash);expense.exec();
    }
    ctx.auditRequired("document.correct",type,id,Json{{"before",before},{"after",p},{"oldAccountId",oldAccount},{"accountId",nextAccount}});
    return Json{{"id",id},{"amountMinor",amount}};
}
}
void registerBusiness(const ContextPtr& ctx) {
    ctx->server().setRequestFilter([ctx](ipc::Request& r){warehouseRequest(*ctx,r);},[ctx](const ipc::Request& r,Json& d){warehouseResult(*ctx,r,d);});
    ctx->server().registerHandler("business.call",[ctx](const ipc::Request& r) {
        ctx->requireAuth(); const auto action=r.payload.value("action",std::string{});
        if(auto transfer=transfer_workflows::run(*ctx,r))return *transfer;
        if(auto waste=waste_documents::run(*ctx,r))return *waste;
        if(action=="context") return context(*ctx);
        if(action=="stock.snapshot"){ctx->requirePermission("inventory.view");auto q=ctx->db().prepare("SELECT id,name FROM warehouses WHERE active=1 ORDER BY sort_order,name");auto levels=ctx->db().prepare("SELECT ingredient_id AS ingredientId,warehouse_id AS warehouseId,qty_milli AS qtyMilli FROM stock_levels");return Json{{"warehouses",q.rows()},{"levels",levels.rows()}};}
        if(action=="party.snapshot"){ctx->requirePermission("customers.view");auto q=ctx->db().prepare("SELECT id,name,phone,active,credit_allowed AS creditAllowed,credit_limit_minor AS creditLimitMinor,debt_minor AS debtMinor FROM customers WHERE kind='customer'");return Json{{"customers",q.rows()}};}
        if(action=="party.import"){
            ctx->requirePermission("customers.manage");ctx->requirePermission("customers.credit");db::Transaction tx(ctx->db());
            for(const auto&c:r.payload.value("customers",Json::array())){const auto id=c.at("id").get<std::string>();const auto limit=c.value("creditLimitMinor",Money{0});require(limit>=0,"Kredit limiti mənfi ola bilməz");auto up=ctx->db().prepare("INSERT INTO customers(id,name,phone,credit_allowed,credit_limit_minor,created_at,updated_at) VALUES(:id,:n,:p,:a,:l,:at,:at) ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,credit_allowed=excluded.credit_allowed,credit_limit_minor=excluded.credit_limit_minor,updated_at=excluded.updated_at");up.bind(":id",id).bind(":n",c.at("name").get<std::string>()).bind(":p",c.value("phone",std::string{})).bind(":a",c.value("creditAllowed",false)?1:0).bind(":l",limit).bind(":at",nowMs());up.exec();}
            Json ack=Json::array();for(const auto&e:r.payload.value("events",Json::array())){const auto id=e.at("id").get<std::string>(),customer=e.at("customer_id").get<std::string>();auto q=ctx->db().prepare("SELECT 1 FROM market_customer_events WHERE id=:id");q.bind(":id",id);if(q.step()){ack.push_back(id);continue;}auto party=ctx->db().prepare("SELECT kind FROM customers WHERE id=:id");party.bind(":id",customer);require(party.step()&&party.columnText(0)=="customer","Partnyor tapılmadı");const auto amount=e.at("amount_minor").get<Money>();auto event=ctx->db().prepare("INSERT INTO market_customer_events(id,customer_id,amount_minor,created_at) VALUES(:id,:c,:a,:at)");event.bind(":id",id).bind(":c",customer).bind(":a",amount).bind(":at",e.at("created_at").get<Timestamp>());event.exec();auto ledger=ctx->db().prepare("INSERT INTO customer_ledger(id,customer_id,kind,amount_minor,note,created_at,actor_user_id) VALUES(:id,:c,'adjustment',:a,:note,:at,:u)");ledger.bind(":id","market-"+id).bind(":c",customer).bind(":a",amount).bind(":note",e.value("note",std::string{})).bind(":at",e.at("created_at").get<Timestamp>()).bind(":u",ctx->session().userId);ledger.exec();auto debt=ctx->db().prepare("UPDATE customers SET debt_minor=debt_minor+:a WHERE id=:id");debt.bind(":a",amount).bind(":id",customer);debt.exec();auto ref=ctx->db().prepare("UPDATE market_customer_events SET ref_type=:t,ref_id=:r WHERE id=:id");ref.bind(":t",e.value("ref_type",std::string{})).bind(":r",e.value("ref_id",std::string{})).bind(":id",id);ref.exec();ack.push_back(id);}
            tx.commit();return Json{{"ids",ack}};
        }
        if(action=="document.get") {
            const auto type=r.payload.value("type",std::string{}),id=r.payload.value("id",std::string{});
            const bool customer=type=="customer",supplier=type=="supplier",salary=type=="salary",income=type=="income",cash=type=="expense"||type=="cash";
            require(customer||supplier||salary||income||cash,"Qaimə növü tanınmadı");
            ctx->requirePermission(customer?"customers.view":supplier?"suppliers.view":salary?"salary.manage":"cash.manage");
            const auto table=customer?"customer_ledger":supplier?"supplier_ledger":salary?"salary_payments":income?"income_docs":"cash_movements";
            auto q=ctx->db().prepare("SELECT * FROM "+std::string(table)+" WHERE id=:id");q.bind(":id",id);require(q.step(),"Qaimə tapılmadı");auto doc=q.row();doc["type"]=type;
            auto user=ctx->db().prepare("SELECT full_name FROM users WHERE id=:id");user.bind(":id",doc.contains("actor_user_id")&&!doc["actor_user_id"].is_null()?doc["actor_user_id"].get<std::string>():std::string{});if(user.step())doc["userName"]=user.columnText(0);
            if(cash){auto a=ctx->db().prepare("SELECT a.id AS accountId,a.name AS accountName,COALESCE(o.name,'') AS objectName FROM cash_account_moves m JOIN cash_accounts a ON a.id=m.account_id LEFT JOIN cash_objects o ON o.id=a.object_id WHERE m.ref_type='cash_movement' AND m.ref_id=:id ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1");a.bind(":id",id);if(a.step())doc.merge_patch(a.row());}
            if(income){auto a=ctx->db().prepare("SELECT a.name AS accountName,COALESCE(o.name,'') AS objectName FROM income_docs d LEFT JOIN cash_accounts a ON a.id=d.account_id LEFT JOIN cash_objects o ON o.id=a.object_id WHERE d.id=:id");a.bind(":id",id);if(a.step())doc.merge_patch(a.row());}
            auto link=ctx->db().prepare("SELECT l.account_id AS accountId,a.name AS accountName,COALESCE(o.name,'') AS objectName FROM document_cash_links l LEFT JOIN cash_accounts a ON a.id=l.account_id LEFT JOIN cash_objects o ON o.id=a.object_id WHERE l.doc_type=:t AND l.doc_id=:id");link.bind(":t",type).bind(":id",id);if(link.step())doc.merge_patch(link.row());
            auto v=ctx->db().prepare("SELECT original_amount_minor AS originalAmountMinor,reason,voided_at AS voidedAt,actor_id AS voidedBy FROM document_voids WHERE doc_type=:t AND doc_id=:id");v.bind(":t",type).bind(":id",id);doc["cancelled"]=v.step();if(doc["cancelled"]==true)doc["cancellation"]=v.row();
            return Json{{"document",doc}};
        }
        if(action=="branch.summary") {
            require(manager(*ctx),"Hesabata yalnız müdir baxa bilər");
            ctx->requirePermission("reports.view");ctx->requirePermission("cash.manage");
            const auto from=getOr<Timestamp>(r.payload,"from",0),to=getOr<Timestamp>(r.payload,"to",nowMs()+1);
            require(from>=0 && to>from,"Tarix aralığı düzgün deyil");
            const auto report=services::ReportService(*ctx).periodSummary(from,to-1);
            auto expenses=ctx->db().prepare("SELECT COALESCE(SUM(amount_minor),0) FROM cash_movements WHERE kind='expense' AND deleted_at IS NULL AND created_at>=:from AND created_at<:to");
            expenses.bind(":from",from).bind(":to",to);expenses.step();
            const Money net=report.at("sales").value("netMinor",Money{0}),cost=expenses.columnInt(0);
            return Json{{"from",from},{"to",to},{"netSalesMinor",net},{"expensesMinor",cost},{"afterExpensesMinor",net-cost},{"costOfGoodsDeducted",false},{"report",report},{"generatedAt",nowMs()}};
        }

        if(action=="correct") {
            db::Transaction tx(ctx->db());services::Idempotency idem(*ctx);
            const auto key=r.idempotencyKey.empty()?r.payload.value("idempotencyKey",std::string{}):r.idempotencyKey;
            require(!key.empty(),"Əməliyyat açarı tələb olunur");
            if(auto replay=idem.begin(key,"business.correct",r.payload)) return *replay;
            const auto out=correct(*ctx,r.payload);idem.complete(key,out,"document",out.value("id",std::string{}));tx.commit();return out;
        }
        if(action=="catalog.publish") {
            ctx->requirePermission("catalog.manage");ctx->requirePermission("inventory.manage");
            db::Transaction tx(ctx->db());
            const auto id=r.payload.value("ingredientId",std::string{});
            auto q=ctx->db().prepare("SELECT * FROM ingredients WHERE id=:id AND active=1");q.bind(":id",id);require(q.step(),"Mal tapılmadı");const auto good=q.row();
            auto link=ctx->db().prepare("SELECT menu_id FROM catalog_goods_links WHERE ingredient_id=:id");link.bind(":id",id);
            if(link.step())return Json{{"id",link.columnText(0)}};
            require(good.value("sale_price_minor",Money{0})>0,"Əvvəlcə malın satış qiymətini yazın");
            auto category=ctx->db().prepare("INSERT OR IGNORE INTO menu_categories(id,name_az,name_tr,name_en,sort_order) VALUES('cat-goods','Mallar','Ürünler','Goods',999)");category.exec();
            // Publication reuses this exact stock identity, including weighed goods.
            // The catalog service owns the link and recipe in this transaction.
            const auto menu=services::CatalogAdminService(*ctx).upsertProduct(Json{{"id","goods-"+id},{"nameAz",good.at("name")},{"categoryId","cat-goods"},{"priceMinor",good.at("sale_price_minor")},{"barcode",good.at("barcode")},{"active",true}},id);
            ctx->auditRequired("catalog.link","ingredient",id,menu);tx.commit();return menu;
        }
        if(action=="documents") {
            Json rows=Json::array();
            const auto has=[&](const char* permission){return ctx->session().permissions.contains(permission);};
            if(!has("cash.manage")&&!has("customers.view")&&!has("customers.credit")&&!has("suppliers.view")&&!has("suppliers.pay")&&!has("salary.manage")) throw PosError(std::string(protocol::err::kForbidden),"Ödəniş qaimələrini görmək icazəniz yoxdur");
            const auto append=[&](const std::string& sql){auto q=ctx->db().prepare(sql);for(auto& row:q.rows()) rows.push_back(row);};
            if(has("cash.manage")) append("SELECT 'expense' AS type,id,kind,reason AS name,amount_minor AS amountMinor,note,created_at AS createdAt FROM cash_movements WHERE kind!='drawer_open' AND (deleted_at IS NULL OR id IN(SELECT doc_id FROM document_voids WHERE doc_type='expense'))");
            if(has("customers.view")||has("customers.credit")) append("SELECT 'customer' AS type,l.id,l.kind,l.customer_id AS partyId,c.name,l.amount_minor AS amountMinor,l.note,l.created_at AS createdAt FROM customer_ledger l JOIN customers c ON c.id=l.customer_id WHERE l.kind='payment'");
            if(has("suppliers.view")||has("suppliers.pay")) append("SELECT 'supplier' AS type,l.id,l.kind,l.supplier_id AS partyId,c.name,l.amount_minor AS amountMinor,l.note,l.created_at AS createdAt FROM supplier_ledger l JOIN suppliers c ON c.id=l.supplier_id WHERE l.kind='payment'");
            if(has("salary.manage")) append("SELECT 'salary' AS type,l.id,l.kind,l.customer_id AS partyId,c.name,l.amount_minor AS amountMinor,l.note,l.created_at AS createdAt FROM salary_payments l JOIN customers c ON c.id=l.customer_id WHERE l.kind!='note'");
            for(auto& row:rows){auto q=ctx->db().prepare("SELECT account_id AS accountId FROM document_cash_links WHERE doc_type=:t AND doc_id=:id");q.bind(":t",row.at("type").get<std::string>()).bind(":id",row.at("id").get<std::string>());if(q.step())row["accountId"]=q.columnText(0);else if(row.at("type")=="expense"){auto a=ctx->db().prepare("SELECT account_id FROM cash_account_moves WHERE ref_type='cash_movement' AND ref_id=:id ORDER BY created_at DESC,rowid DESC LIMIT 1");a.bind(":id",row.at("id").get<std::string>());if(a.step())row["accountId"]=a.columnText(0);}}
            for(auto& row:rows){auto v=ctx->db().prepare("SELECT original_amount_minor,voided_at,reason FROM document_voids WHERE doc_type=:t AND doc_id=:id");v.bind(":t",row.at("type").get<std::string>()).bind(":id",row.at("id").get<std::string>());row["cancelled"]=v.step();if(row["cancelled"]==true){row["originalAmountMinor"]=v.columnInt(0);row["voidedAt"]=v.columnInt(1);row["cancelReason"]=v.columnText(2);}}
            return Json{{"documents",rows}};
        }
        if(action=="delivery.update") {
            ctx->requirePermission("delivery.manage");
            const auto id=r.payload.value("id",std::string{});
            db::Transaction tx(ctx->db());
            auto q=ctx->db().prepare("SELECT * FROM delivery_orders WHERE id=:id");q.bind(":id",id);require(q.step(),"Çatdırılma tapılmadı");const auto before=q.row();
            auto u=ctx->db().prepare("UPDATE delivery_orders SET customer_name=:n,address=:a,phone=:p,note=:note WHERE id=:id");
            require(!r.payload.value("address",std::string{}).empty(),"Ünvan tələb olunur");
            u.bind(":n",r.payload.value("customerName",std::string{})).bind(":a",r.payload.value("address",std::string{})).bind(":p",r.payload.value("phone",std::string{})).bind(":note",r.payload.value("note",std::string{})).bind(":id",id);u.exec();
            ctx->auditRequired("delivery.correct","delivery",id,Json{{"before",before},{"after",r.payload}});tx.commit();return Json{{"id",id}};
        }
        ctx->requirePermission("users.manage");
        if(action=="staff.link") {
            const auto user=r.payload.value("userId",std::string{}),target=r.payload.value("customerId",std::string{});
            require(user!="possistem-admin","POSSISTEM işçi kartı deyil");
            db::Transaction tx(ctx->db());
            auto old=ctx->db().prepare("SELECT id FROM customers WHERE user_id=:u");old.bind(":u",user);require(old.step(),"İşçinin maaş kartı tapılmadı");const auto source=old.columnText(0);
            auto check=ctx->db().prepare("SELECT user_id FROM customers WHERE id=:c AND kind='employee' AND active=1");check.bind(":c",target);require(check.step() && (check.columnIsNull(0)||check.columnText(0)==user),"Bu işçi kartı başqa hesaba bağlıdır");
            if(source==target)return Json{{"ok",true}};
            // Repoint each known customer relation, preserving every row and its ID.
            for(const auto* table:{"customer_ledger","loyalty_ledger","salary_payments","orders","reservations","delivery_orders"}) {
                auto move=ctx->db().prepare("UPDATE "+std::string(table)+" SET customer_id=:to WHERE customer_id=:from");move.bind(":to",target).bind(":from",source);move.exec();
            }
            auto detach=ctx->db().prepare("UPDATE customers SET user_id=NULL,active=0 WHERE id=:id");detach.bind(":id",source);detach.exec();
            auto bind=ctx->db().prepare("UPDATE customers SET user_id=:u,name=(SELECT full_name FROM users WHERE id=:u),debt_minor=(SELECT COALESCE(SUM(CASE WHEN kind='payment' THEN -amount_minor ELSE amount_minor END),0) FROM customer_ledger WHERE customer_id=:id),loyalty_points=MAX(0,(SELECT COALESCE(SUM(points),0) FROM loyalty_ledger WHERE customer_id=:id)),updated_at=:at WHERE id=:id");
            bind.bind(":u",user).bind(":id",target).bind(":at",nowMs());bind.exec();ctx->auditRequired("staff.link","user",user,Json{{"sourceCustomerId",source},{"targetCustomerId",target}});tx.commit();return Json{{"ok",true}};
        }
        if(action=="staff") {
            auto q=ctx->db().prepare("SELECT u.id,u.full_name AS name,u.active,c.id AS customerId,c.salary_minor AS salaryMinor,COALESCE(c.object_id,'') AS objectId FROM users u LEFT JOIN customers c ON c.user_id=u.id WHERE u.id<>'possistem-admin' ORDER BY u.active DESC,u.full_name");
            Json rows=q.rows();for(auto& row:rows){auto a=ctx->db().prepare("SELECT warehouse_id FROM user_warehouse_access WHERE user_id=:u");a.bind(":u",row.at("id").get<std::string>());row["warehouses"]=Json::array();while(a.step())row["warehouses"].push_back(a.columnText(0));}
            auto loose=ctx->db().prepare("SELECT id,name FROM customers WHERE kind='employee' AND active=1 AND user_id IS NULL ORDER BY name");
            return Json{{"staff",rows},{"unlinked",loose.rows()}};
        }
        if(action=="staff.save") {
            const auto user=r.payload.value("userId",std::string{});
            require(user!="possistem-admin","POSSISTEM işçi kartı deyil");
            db::Transaction tx(ctx->db());
            auto check=ctx->db().prepare("SELECT 1 FROM users WHERE id=:id");check.bind(":id",user);require(check.step(),"İşçi tapılmadı");
            const auto salary=r.payload.value("salaryMinor",Money{0});require(salary>=0,"Maaş düzgün deyil");
            auto u=ctx->db().prepare("UPDATE customers SET salary_minor=:s,object_id=:o WHERE user_id=:id");
            u.bind(":s",salary).bindOptional(":o",r.payload.value("objectId",std::string{})).bind(":id",user);u.exec();
            auto drop=ctx->db().prepare("DELETE FROM user_warehouse_access WHERE user_id=:id");drop.bind(":id",user);drop.exec();
            for(const auto& w:r.payload.value("warehouses",Json::array())){auto i=ctx->db().prepare("INSERT INTO user_warehouse_access(user_id,warehouse_id) SELECT :u,id FROM warehouses WHERE id=:w AND active=1");i.bind(":u",user).bind(":w",w.get<std::string>());i.exec();require(ctx->db().changes()==1,"Anbar tapılmadı");}
            ctx->auditRequired("staff.scope","user",user,r.payload);tx.commit();return Json{{"ok",true}};
        }
        throw PosError(std::string(protocol::err::kForbidden),"Əməliyyata icazə yoxdur");
    });
}
}
