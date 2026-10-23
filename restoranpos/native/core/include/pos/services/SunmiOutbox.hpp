#pragma once
#include "pos/handlers/Context.hpp"
#include "pos/Error.hpp"
#include "pos/services/OrderService.hpp"

namespace pos::services {
inline void guardSunmiEdit(handlers::Context& ctx,const std::string& orderId){
 std::int64_t since=0;try{since=std::stoll(ctx.setting("sunmi.activatedAt","0"));}catch(...){}
 auto s=ctx.db().prepare("SELECT created_at,status FROM sunmi_outbox WHERE id=:id");s.bind(":id","sale:"+orderId);
 if(s.step()&&((since>0&&s.columnInt(0)>=since)||s.columnText(1)=="success"||s.columnText(1)=="unknown"))
  throw PosError("E_FISCAL_FINALIZED","Fiskal satış birbaşa dəyişdirilmir. Məhsul üzrə geri qaytarma və yeni satış yaradın.");
}
inline void storeSunmi(handlers::Context& ctx,const Json& doc){
 auto s=ctx.db().prepare("INSERT INTO sunmi_outbox(id,kind,parent_id,terminal_id,payload_json,created_at,updated_at) VALUES(:id,:kind,:parent,:terminal,:payload,:now,:now) ON CONFLICT(id) DO NOTHING");
 s.bind(":id",doc.at("id").get<std::string>()).bind(":kind",doc.at("kind").get<std::string>()).bind(":parent",doc.value("parentId",std::string{})).bind(":terminal",ctx.saleTerminalId()).bind(":payload",doc.dump()).bind(":now",nowMs());s.exec();
}
inline void queueSunmiSale(handlers::Context& ctx,const std::string& orderId){
 const auto order=OrderService(ctx).load(orderId);
 Json lines=Json::array();for(const auto& line:order.at("items")){
  if(line.value("status",std::string{})=="voided"||(line.at("complimentary")==Json(true)||line.at("complimentary")==Json(1))||line.value("lineTotalMinor",Money{0})<=0)continue;
  auto meta=ctx.db().prepare("SELECT sku FROM menu_items WHERE id=:id");meta.bind(":id",line.at("productId").get<std::string>());std::string sku;if(meta.step())sku=meta.columnText(0);
  lines.push_back(Json{{"barcode",sku},{"lineId",line.at("id")},{"productId",line.at("productId")},{"name",line.at("name")},{"unit","ədəd"},{"quantityMilli",line.at("quantity").get<std::int64_t>()*1000},{"lineTotalMinor",line.at("lineTotalMinor")}});
 }
 auto p=ctx.db().prepare("SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount_minor ELSE 0 END),0) AS cashMinor,COALESCE(SUM(CASE WHEN method='card' THEN amount_minor ELSE 0 END),0) AS cardMinor FROM payments WHERE order_id=:id AND status IN ('approved','refunded')");p.bind(":id",orderId);p.step();
 Json pay=p.row();
 auto rrn=ctx.db().prepare("SELECT bank_rrn FROM payments WHERE order_id=:id AND method='card' AND bank_rrn IS NOT NULL ORDER BY created_at DESC LIMIT 1");rrn.bind(":id",orderId);if(rrn.step())pay["rrn"]=rrn.columnText(0);
pay["creditMinor"]=order.value("accountMinor",Money{0});
 const auto customer=order.contains("partnerName")&&!order["partnerName"].is_null()?order["partnerName"]:Json("");
 storeSunmi(ctx,Json{{"id","sale:"+orderId},{"saleId",orderId},{"kind","sale"},{"items",lines},{"payment",pay},{"totalMinor",order.at("totalMinor")},{"serviceMinor",order.value("serviceMinor",Money{0})},{"cashierName",ctx.session().fullName},{"customerName",customer},{"createdAt",nowMs()}});
}
inline void queueSunmiRefund(handlers::Context& ctx,const std::string& orderId,const std::string& refundId,Money total,const std::string& method,const std::string& bankRrn=""){
 auto parent=ctx.db().prepare("SELECT payload_json FROM sunmi_outbox WHERE id=:id");parent.bind(":id","sale:"+orderId);
 Json doc={{"id","refund:"+refundId},{"kind","refund"},{"parentId","sale:"+orderId},{"saleId",orderId},{"totalMinor",total},{"cashierName",ctx.session().fullName},{"serviceMinor",0},{"createdAt",nowMs()},{"items",Json::array()},{"payment",Json{{"cashMinor",method=="cash"?total:0},{"cardMinor",method=="card"?total:0},{"rrn",bankRrn}}}};
 if(parent.step()){
  const auto original=Json::parse(parent.columnText(0));
  auto selected=ctx.db().prepare("SELECT order_item_id,quantity,amount_minor FROM refund_items WHERE refund_id=:id");selected.bind(":id",refundId);const auto returned=selected.rows();
  for(const auto& line:original.at("items")){
   for(const auto& r:returned)if(r.at("order_item_id")==line.at("lineId")){
    auto copy=line;copy["quantityMilli"]=r.at("quantity").get<std::int64_t>()*1000;copy["lineTotalMinor"]=r.at("amount_minor");doc["items"].push_back(copy);
   }
  }
  // An amount-only partial refund cannot truthfully invent product quantities.
  if(returned.empty()&&total==original.at("totalMinor").get<Money>()){doc["items"]=original.at("items");doc["serviceMinor"]=original.value("serviceMinor",Money{0});}
 }
 storeSunmi(ctx,doc);
}
}
