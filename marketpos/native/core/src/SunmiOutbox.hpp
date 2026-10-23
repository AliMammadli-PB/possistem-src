#pragma once
#include "market/db/Database.hpp"
#include <nlohmann/json.hpp>
#include <chrono>
namespace market::sunmi {
using Json=nlohmann::json;
inline std::int64_t timestamp(){return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();}
inline void store(db::Database& db,const Json& doc){db.execBound("INSERT OR IGNORE INTO sunmi_outbox(id,kind,parent_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",{doc.at("id").get<std::string>(),doc.at("kind").get<std::string>(),doc.value("parentId",std::string{}),doc.dump(),std::to_string(timestamp()),std::to_string(timestamp())});}
inline void sale(db::Database& db,const std::string& id,const std::string& rrn=""){
 auto sales=db.query("SELECT * FROM sales WHERE id=?",{id});if(sales.empty())return;const auto& s=sales[0];
 auto rows=db.query("SELECT i.id,i.product_id,i.qty,i.qty_milli,i.line_total_minor,p.name_az,p.barcode,p.unit,p.cost_minor FROM sale_items i JOIN products p ON p.id=i.product_id WHERE i.sale_id=? ORDER BY i.id",{id});
 Json items=Json::array();for(const auto& r:rows){items.push_back(Json{{"lineId",std::to_string(r.at("id").get<std::int64_t>())},{"productId",r.at("product_id")},{"name",r.at("name_az")},{"barcode",r["barcode"].is_null()?Json(""):r["barcode"]},{"unit",r.at("unit")},{"purchasePriceMinor",r.at("cost_minor")},{"quantityMilli",r["qty_milli"].is_null()?r.at("qty").get<std::int64_t>()*1000:r["qty_milli"].get<std::int64_t>()},{"stockQty",r.at("qty")},{"lineTotalMinor",r.at("line_total_minor")}});}
 const auto cash=s["cash_minor"].is_null()?0:s["cash_minor"].get<std::int64_t>();const auto card=s["card_minor"].is_null()?0:s["card_minor"].get<std::int64_t>();
 const auto total=s.at("total_minor").get<std::int64_t>(),credit=s.value("credit_minor",std::int64_t{0}),bonus=s.value("loyalty_redeemed_minor",std::int64_t{0});
 store(db,Json{{"id","sale:"+id},{"saleId",id},{"kind","sale"},{"totalMinor",total},{"serviceMinor",0},{"createdAt",s.at("created_at")},{"items",items},{"cashierName",s.at("cashier_id")},{"customerName",s["customer_name"].is_null()?Json(""):s["customer_name"]},{"payment",Json{{"cashMinor",cash},{"cardMinor",card},{"creditMinor",credit},{"bonusMinor",bonus},{"rrn",rrn}}}});
}
inline void refund(db::Database& db,const std::string& saleId,const std::string& refundId,const std::string& rrn=""){
 auto parent=db.query("SELECT payload_json FROM sunmi_outbox WHERE id=?",{"sale:"+saleId});
 auto rows=db.query("SELECT sale_item_id,qty,amount_minor FROM refund_lines WHERE refund_id=? ORDER BY id",{refundId});if(rows.empty())return;
 Json items=Json::array();std::int64_t total=0;for(const auto& r:rows)total+=r.at("amount_minor").get<std::int64_t>();
 if(!parent.empty())for(const auto& r:rows){const auto original=Json::parse(parent[0].at("payload_json").get<std::string>());for(const auto& line:original.at("items"))if(line.at("lineId")==std::to_string(r.at("sale_item_id").get<std::int64_t>())){auto copy=line;copy["quantityMilli"]=line.at("quantityMilli").get<std::int64_t>()*r.at("qty").get<std::int64_t>()/std::max<std::int64_t>(1,line.value("stockQty",std::int64_t{1}));copy["lineTotalMinor"]=r.at("amount_minor");items.push_back(copy);}}
 auto sales=db.query("SELECT * FROM sales WHERE id=?",{saleId});const auto& s=sales[0];
 const auto saleTotal=s.at("total_minor").get<std::int64_t>();
 const auto before=db.queryInt("SELECT COALESCE(SUM(amount_minor),0) FROM refund_lines WHERE sale_id=? AND refund_id!=?",{saleId,refundId});
 const auto originalCash=s["cash_minor"].is_null()?0:s["cash_minor"].get<std::int64_t>();
 const auto cash=saleTotal>0?((before+total)*originalCash+saleTotal/2)/saleTotal-(before*originalCash+saleTotal/2)/saleTotal:0;
 const auto credit=db.queryInt("SELECT COALESCE(-SUM(amount_minor),0) FROM customer_ledger WHERE ref_type='refund' AND ref_id=? AND kind='refund'",{refundId});
 // An inconsistent legacy cash/credit refund stays visible for review, never silently rebalanced.
 const auto card=total-cash-credit;
 store(db,Json{{"id","refund:"+refundId},{"parentId","sale:"+saleId},{"kind","refund"},{"totalMinor",total},{"serviceMinor",0},{"createdAt",timestamp()},{"items",items},{"cashierName","Kassir"},{"payment",Json{{"cashMinor",cash},{"cardMinor",card},{"creditMinor",credit},{"rrn",rrn}}}});
}
}
