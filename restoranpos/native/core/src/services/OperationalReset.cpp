#include "pos/services/OperationalReset.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include <filesystem>
#include <vector>

namespace pos::services {
namespace {
// Explicit allowlist: a future table is never silently erased. FK validation rejects an incomplete reset.
const std::vector<std::string> operational={
    "bill_split_parts","bill_splits","attendance","cash_account_moves","cash_movements","cash_transfer_documents",
    "customer_ledger","delivery_events","delivery_orders","document_cash_links","document_voids","external_sales",
    "income_docs","kitchen_jobs","loyalty_ledger","market_customer_events","market_document_actors",
    "order_events","order_gifts","order_item_modifiers","order_items","orders","payment_events","payment_tenders",
    "payments","print_jobs","purchase_costs","purchase_order_items","purchase_orders","purchase_receipt_lines",
    "purchase_receipts","purchase_return_items","purchase_returns","qr_order_imports","receipts","refund_items","refunds",
    "report_snapshots","reservations","salary_payments","shifts","business_days","stock_levels","stock_lot_moves","stock_lots",
    "stock_movements","stocktake_lines","stocktakes","sunmi_outbox","supplier_ledger","supplier_price_history",
    "sync_inbox","sync_outbox","table_transfer_events","transfer_lines","transfer_returns","transfer_docs","transfer_inbox",
    "transfer_outbox","waste_document_items","waste_documents","x_reports","z_reports"
};
const std::vector<std::string> catalog={
    "menu_categories","menu_items","menu_item_components","menu_item_ingredients","menu_item_modifier_groups",
    "menu_item_price_history","menu_item_schedules","modifier_groups","modifiers","ingredients","stock_categories",
    "catalog_category_links","catalog_goods_links","item_prices","supplier_items","stock_rules","stock_locations",
    "warehouses","cash_objects","cash_accounts","restaurant_areas","users","roles","permissions","role_permissions",
    "user_roles","user_warehouse_access","staff_schedules","couriers","suppliers","license_state"
};
std::string quote(const std::string& name){std::string out="\"";for(char c:name){out+=c;if(c=='"')out+='"';}return out+'"';}
bool exists(db::Database& db,const std::string& table){auto q=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name");q.bind(":name",table);return q.step();}
std::int64_t scalar(db::Database& db,const std::string& sql){auto q=db.prepare(sql);return q.step()?q.columnInt(0):0;}
Json counts(db::Database& db,const std::vector<std::string>& tables){Json out=Json::object();for(const auto& t:tables)if(exists(db,t))out[t]=scalar(db,"SELECT COUNT(*) FROM "+quote(t));return out;}
std::string hash(db::Database& db){Json data=Json::object();for(const auto& table:catalog)if(exists(db,table)){auto q=db.prepare("SELECT * FROM "+quote(table)+" ORDER BY rowid");data[table]=q.rows();}{auto q=db.prepare("SELECT * FROM app_settings WHERE key NOT LIKE 'operations.reset.%' ORDER BY key");data["app_settings"]=q.rows();}{auto q=db.prepare("SELECT id,area_id,label,seats,pos_x,pos_y,width,height,shape,sort_order,active FROM restaurant_tables ORDER BY id");data["table_layout"]=q.rows();}return crypto::sha256Hex(data.dump());}
void guardIdle(db::Database& db){
    require(scalar(db,"SELECT COUNT(*) FROM payments WHERE status IN ('pending','processing') AND method='card'")==0,"Kart əməliyyatı gözlənilir. Nəticəsini yoxladıqdan sonra yenidən sınayın.");
    require(scalar(db,"SELECT COUNT(*) FROM sunmi_outbox WHERE status IN ('sending','processing')")==0,"Fiskal əməliyyat icra olunur. Tamamlanmasını gözləyin.");
    auto printing=db.prepare("SELECT COUNT(*) FROM print_jobs WHERE status IN ('printing','processing') AND updated_at>=:recent");
    printing.bind(":recent",nowMs()-120000);require(printing.step()&&printing.columnInt(0)==0,"Çap icra olunur. Tamamlanmasını gözləyin.");
}
}
Json OperationalReset::preview(db::Database& db){
    return Json{{"catalogHash",hash(db)},{"preserved",counts(db,catalog)},{"cleared",counts(db,operational)},
                {"backupRequired",true},{"scope","test-operations"}};
}
Json OperationalReset::run(db::Database& db,const std::string& commandId,const std::string& expectedCatalogHash,const std::string& reason){
    require(!commandId.empty()&&commandId.size()<=120,"Əməliyyat identifikatoru yoxdur");
    require(reason.size()>=3&&reason.size()<=500,"Sıfırlama səbəbini yazın");
    const auto key="operations.reset."+commandId;
    {auto q=db.prepare("SELECT value FROM app_settings WHERE key=:key");q.bind(":key",key);if(q.step()){auto result=Json::parse(q.columnText(0));result["replayed"]=true;return result;}}
    const auto before=preview(db);require(expectedCatalogHash.size()==64&&before.at("catalogHash")==expectedCatalogHash,"Menyu və ya ayarlar dəyişib. Əvvəlcə yenidən yoxlayın.");
    guardIdle(db);
    const auto source=std::filesystem::path(db.path()),directory=source.parent_path()/"backups";
    const auto stamp=std::to_string(nowMs())+"-"+crypto::uuid4().substr(0,8);
    const auto kept=directory/(source.stem().string()+"-before-operational-reset-"+stamp+".db");
    const auto work=source.parent_path()/(source.stem().string()+"-reset-working-"+stamp+".db");
    // A consistent, checked SQLite backup is mandatory and is never modified or automatically pruned here.
    db.backupTo(kept.string());
    Json result;
    try{
        std::filesystem::copy_file(kept,work);
        db::Database fresh;fresh.open(work.string());
        require(hash(fresh)==expectedCatalogHash,"Yedəyin menyusu uyğun deyil");
        {
            db::Transaction transaction(fresh);fresh.exec("PRAGMA defer_foreign_keys=ON");
            // Immutable report protections remain installed in production. Only the isolated reset copy
            // removes them temporarily, restores every definition, and validates before the atomic swap.
            std::vector<std::pair<std::string,std::string>> triggers;
            for(const auto& table:operational){auto q=fresh.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=:table");q.bind(":table",table);for(const auto& r:q.rows())triggers.emplace_back(r.at("name"),r.at("sql"));}
            for(const auto& [name,sql]:triggers)fresh.exec("DROP TRIGGER "+quote(name));
            for(const auto& table:operational)if(exists(fresh,table))fresh.exec("DELETE FROM "+quote(table));
            fresh.exec("UPDATE customers SET debt_minor=0,loyalty_points=0");
            fresh.exec("UPDATE restaurant_tables SET status='available',merged_into_id=NULL,row_version=row_version+1");
            for(const auto& [name,sql]:triggers)fresh.exec(sql);
            require(hash(fresh)==expectedCatalogHash,"Qorunan menyu və ya ayarlar dəyişib");
            auto fk=fresh.prepare("PRAGMA foreign_key_check");require(!fk.step(),"Əlaqəli məlumat qalıb; sıfırlama tətbiq edilmədi");
            result=Json{{"reset",true},{"scope","test-operations"},{"keptCopy",kept.filename().string()},
                {"catalogHash",expectedCatalogHash},{"preserved",before.at("preserved")},{"cleared",before.at("cleared")},{"restartRequired",true}};
            auto marker=fresh.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(:key,:value,:now)");
            marker.bind(":key",key).bind(":value",result.dump()).bind(":now",nowMs()).exec();
            transaction.commit();
        }
        {auto integrity=fresh.prepare("PRAGMA integrity_check");require(integrity.step()&&integrity.columnText(0)=="ok","Sıfırlanmış baza yoxlamadan keçmədi");}
        fresh.close();
        // Do not overwrite a catalog edited while the working copy was prepared.
        require(hash(db)==expectedCatalogHash,"Menyu dəyişib. Əməliyyat tətbiq edilmədi");guardIdle(db);
        db.restoreFrom(work.string());
    }catch(...){std::error_code error;for(const auto* suffix:{"","-wal","-shm"})std::filesystem::remove(work.string()+suffix,error);throw;}
    std::error_code error;for(const auto* suffix:{"","-wal","-shm"})std::filesystem::remove(work.string()+suffix,error);
    return result;
}
}
