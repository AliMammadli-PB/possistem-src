#pragma once
// Included inside Application's private namespace: corrections use the SAME sale
// and refund writers in one transaction, so validation failure restores all ledgers.
nlohmann::json correctSale(db::Database& db,const nlohmann::json& p){
 const bool cancel=p.value("cancel",false);
 requirePermission(db,p,cancel?"DOCS_DELETE":"DOCS_EDIT");
 const auto key=requireString(p,"idempotencyKey"),saleId=requireString(p,"saleId"),reason=requireString(p,"reason");
 if(reason.find_first_not_of(" \r\n\t")==std::string::npos)throw PosError("E_VALIDATION","Səbəbi yazın");
 auto request=p;for(auto k:{"role","actorId","approverId","approverRole"})request.erase(k);
 const auto fingerprint=request.dump();
 const auto cached=db.query("SELECT * FROM sale_corrections WHERE id=?",{key});
 if(!cached.empty()){
  if(cached[0].at("request_json")!=fingerprint)throw PosError("E_IDEMPOTENCY_CONFLICT","Əməliyyat açarı başqa düzəlişdə istifadə olunub");
  return cached[0];
 }
 const auto rows=db.query("SELECT * FROM sales WHERE id=?",{saleId});
 if(rows.empty())throw PosError("E_NOT_FOUND","Satış tapılmadı");
 if(db.queryInt("SELECT COUNT(*) FROM sale_corrections WHERE sale_id=?",{saleId}))throw PosError("E_VALIDATION","Bu satış artıq dəyişdirilib");
 db.begin();
 try{
  refundSale(db,p,false);
  std::string replacement;
  if(!cancel){
   auto next=p.at("replacement");
   for(const auto k:{"id","receiptNo","createdAt","idempotencyKey","cartId","cartRevision","approvalVersion","role","actorId","approverId","approverRole"})next.erase(k);
   next["role"]=p.value("role","");next["actorId"]=p.value("actorId","");
   next["cashierId"]=p.value("actorId","");next["registerId"]=rows[0].at("register_id");
   next["customerId"]=rows[0].at("customer_id");next["customerName"]=rows[0].at("customer_name");
   next["note"]="Düzəliş: "+saleId+" · "+reason;
   replacement=completeSale(db,next,false,rows[0].at("warehouse_id").get<std::string>()).at("id").get<std::string>();
  }
  db.execBound("INSERT INTO sale_corrections(id,request_json,sale_id,replacement_id,reason,actor_id,created_at) VALUES(?,?,?,NULLIF(?,''),?,?,?)",{key,fingerprint,saleId,replacement,reason,p.value("actorId",""),std::to_string(nowMs())});
  audit(db,p.value("actorId",""),cancel?"SALE_VOID":"SALE_CORRECTION",saleId+" -> "+replacement+" · "+reason);
  db.commit();
  return nlohmann::json{{"id",key},{"saleId",saleId},{"replacementId",replacement},{"cancelled",cancel}};
 }catch(...){db.rollback();throw;}
}
nlohmann::json customerHistory(db::Database& db,const nlohmann::json& p){
 requirePermission(db,p,"DOCS_VIEW");
 const auto id=requireString(p,"customerId");
 auto sales=nlohmann::json::array();
 for(const auto& row:db.query("SELECT * FROM sales WHERE customer_id=? ORDER BY created_at DESC",{id})){
  auto sale=saleToJson(db,row,nullptr,true);
  for(auto& line:sale["items"]){line["returnedQty"]=db.queryInt("SELECT COALESCE(SUM(qty),0) FROM refund_lines WHERE sale_id=? AND sale_item_id=?",{sale.at("id").get<std::string>(),std::to_string(line.at("saleItemId").get<std::int64_t>())});line["name"]=db.queryText("SELECT name_az FROM products WHERE id=?",{line.at("productId").get<std::string>()});}
  sale["registerName"]=db.queryText("SELECT name FROM registers WHERE id=?",{sale.at("registerId").get<std::string>()});
  sale["corrections"]=db.query("SELECT id,sale_id AS saleId,replacement_id AS replacementId,reason,actor_id AS actorId,created_at AS createdAt FROM sale_corrections WHERE sale_id=? OR replacement_id=?",{sale.at("id").get<std::string>(),sale.at("id").get<std::string>()});
  sales.push_back(sale);
 }
 return {{"sales",sales},{"events",db.query("SELECT * FROM customer_ledger WHERE customer_id=? AND kind!='bridge_adjustment' ORDER BY created_at,rowid",{id})}};
}
