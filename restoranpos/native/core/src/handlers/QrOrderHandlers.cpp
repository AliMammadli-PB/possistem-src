#include <algorithm>
#include <vector>
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/LicenseService.hpp"

namespace pos::handlers {
namespace {
Money qrPrice(Context& ctx,const std::string& id,Money fallback){
 auto s=ctx.db().prepare("SELECT p.sale_price_minor FROM item_prices p JOIN ingredients i ON i.id=p.ingredient_id AND i.active=1 AND i.sku='MENU-'||:product JOIN cash_accounts a ON a.object_id=p.object_id AND a.kind='till' AND a.active=1 WHERE a.terminal_id=:terminal AND a.terminal_id!='' LIMIT 1");
 s.bind(":product",id).bind(":terminal",ctx.saleTerminalId());return s.step()?s.columnInt(0):fallback;
}
// A dish archived and made again keeps its name but not its id, and a QR menu published before
// that still sends the old id: the one live dish of that name takes the line. Prices are still
// checked against the guest's, so nothing is charged differently.
std::string qrLiveProduct(Context& ctx,const std::string& id){
 auto live=ctx.db().prepare("SELECT 1 FROM menu_items WHERE id=:id AND active=1 AND archived=0");live.bind(":id",id);if(live.step())return id;
 auto same=ctx.db().prepare("SELECT n.id FROM menu_items o JOIN menu_items n ON n.name_az=o.name_az AND n.id<>o.id AND n.active=1 AND n.archived=0 WHERE o.id=:id LIMIT 2");same.bind(":id",id);
 std::vector<std::string> found;while(same.step())found.push_back(same.columnText(0));return found.size()==1?found[0]:id;
}
std::string qrUnavailable(Context& ctx,const std::string& id){
 auto n=ctx.db().prepare("SELECT name_az,active=1 AND archived=0 FROM menu_items WHERE id=:id");n.bind(":id",id);
 if(!n.step())return "Sifarişdəki məhsul kassada tapılmadı. QR menyunu yenidən yayımlayın.";
 return "«"+n.columnText(0)+"» "+(n.columnInt(1)?"hazırda satışda deyil (stop-list).":"kassada artıq yoxdur. QR menyunu yenidən yayımlayın.");
}
struct QrLine{std::string product,name,note,course;Money price,delta;std::int64_t qty;std::vector<services::ResolvedModifier> modifiers;};
}
void registerQrOrders(const ContextPtr& ctx){
 ctx->server().registerHandler("qr.access",[ctx](const ipc::Request& req){ctx->requirePermission(getOr<bool>(req.payload,"manage",false)?"settings.manage":"order.create");return Json{{"ok",true}};});
 ctx->server().registerHandler("qr.catalog",[ctx](const ipc::Request&){
  ctx->requirePermission("settings.manage");
  Json doc={{"name",ctx->setting("restaurant.name","Restoran")},{"description",""},{"logo",""},{"accent","blue"},{"layout","cards"}};
  auto categories=ctx->db().prepare("SELECT id,name_az AS name,name_tr AS nameTr,name_en AS nameEn FROM menu_categories WHERE active=1 ORDER BY sort_order");doc["categories"]=categories.rows();
  auto tables=ctx->db().prepare("SELECT t.id,a.name_az||' · '||t.label AS label FROM restaurant_tables t JOIN restaurant_areas a ON a.id=t.area_id WHERE t.active=1 AND a.active=1 AND t.area_id!='area-delivery' ORDER BY a.sort_order,t.sort_order");doc["tables"]=tables.rows();
  auto products=ctx->db().prepare("SELECT id,category_id AS categoryId,name_az AS name,name_tr AS nameTr,name_en AS nameEn,description_az AS description,image,price_minor AS priceMinor,available,sold_out AS soldOut,image_hidden AS imageHidden FROM menu_items WHERE active=1 AND archived=0 ORDER BY sort_order,name_az LIMIT 500");
  Json items=products.rows();
  for(auto& p:items){const auto id=p["id"].get<std::string>();p["priceMinor"]=qrPrice(*ctx,id,p["priceMinor"].get<Money>());p["available"]=p.value("available",0)!=0&&p.value("soldOut",0)==0;p["hidden"]=false;
   auto img=p.value("image",std::string());p["image"]=p.value("imageHidden",0)==0&&img.rfind("https://",0)==0?img:"";p.erase("soldOut");p.erase("imageHidden");
   auto groups=ctx->db().prepare("SELECT g.id,g.name_az AS name,g.min_select AS min,g.max_select AS max,g.required FROM modifier_groups g JOIN menu_item_modifier_groups l ON l.group_id=g.id WHERE l.item_id=:id ORDER BY l.sort_order");groups.bind(":id",id);p["groups"]=groups.rows();
   for(auto& g:p["groups"]){if(g.value("required",0)!=0&&g.value("min",0)==0)g["min"]=1;g.erase("required");auto opts=ctx->db().prepare("SELECT id,name_az AS name,price_delta_minor AS priceDeltaMinor FROM modifiers WHERE group_id=:id AND available=1 ORDER BY sort_order");opts.bind(":id",g["id"].get<std::string>());g["options"]=opts.rows();}
  }doc["items"]=items;return doc;
 });
 auto accept=[ctx](const ipc::Request& req){
  const bool waiter=req.method=="waiter.accept";
  if(waiter){ctx->requirePermission("order.view");require(ctx->session().role=="waiter","Yalnız ofisiant girişindən sifariş qəbul edilir");}
  ctx->requirePermission("order.create");const auto external=getOr<std::string>(req.payload,"externalId",""),tableId=getOr<std::string>(req.payload,"tableId",""),note=getOr<std::string>(req.payload,"note","");
  require(external.size()==36,"QR sifariş nömrəsi düzgün deyil");require(!tableId.empty()&&tableId.size()<=120,"Masa düzgün deyil");require(note.size()<=1500,"Qeyd çox uzundur");
  const auto hash=crypto::sha256Hex(serialize(req.payload));db::Transaction txn(ctx->db());
  {auto previous=ctx->db().prepare("SELECT request_hash,response_json FROM qr_order_imports WHERE external_id=:id");previous.bind(":id",external);if(previous.step()){require(previous.columnText(0)==hash,"QR sifariş nömrəsi başqa məlumatla təkrar istifadə edilib");auto response=Json::parse(previous.columnText(1));if(waiter)require(response.value("waiterUserId",std::string{})==ctx->session().userId,"Sifariş başqa işçiyə aiddir");response["idempotentReplay"]=true;txn.commit();return response;}}
  services::LicenseService(*ctx).requirePaidForSale();
  require(req.payload.contains("lines")&&req.payload["lines"].is_array()&&!req.payload["lines"].empty()&&req.payload["lines"].size()<=40,"Sifariş sətirləri düzgün deyil");
  auto table=ctx->db().prepare("SELECT id FROM restaurant_tables WHERE id=:id AND active=1 AND area_id!='area-delivery'");table.bind(":id",tableId);require(table.step(),"Masa aktiv deyil");
  services::OrderService orders(*ctx);std::vector<QrLine> lines;
  for(const auto& l:req.payload["lines"]){QrLine line;line.product=getOr<std::string>(l,"productId","");line.qty=getOr<std::int64_t>(l,"qty",0);line.note=getOr<std::string>(l,"note","");require(line.qty>=1&&line.qty<=20,"Miqdar düzgün deyil");require(line.note.size()<=1000,"Məhsul qeydi çox uzundur");
   line.product=qrLiveProduct(*ctx,line.product);
   auto p=ctx->db().prepare("SELECT name_az,price_minor,course FROM menu_items WHERE id=:id AND active=1 AND archived=0 AND available=1 AND sold_out=0");p.bind(":id",line.product);require(p.step(),qrUnavailable(*ctx,line.product));line.name=p.columnText(0);line.price=qrPrice(*ctx,line.product,p.columnInt(1));line.course=p.columnText(2);
   std::vector<std::string> mods;if(l.contains("modifiers")){require(l["modifiers"].is_array()&&l["modifiers"].size()<=30,"Seçimlər düzgün deyil");for(const auto& m:l["modifiers"]){require(m.is_string(),"Seçim düzgün deyil");mods.push_back(m.get<std::string>());}}
   auto unique=mods;std::sort(unique.begin(),unique.end());require(std::adjacent_find(unique.begin(),unique.end())==unique.end(),"Təkrarlanan seçim");line.modifiers=orders.resolveModifiers(line.product,mods);line.delta=0;for(const auto& m:line.modifiers)line.delta+=m.priceDelta;
   require(line.price==getOr<Money>(l,"unitPriceMinor",-1)&&line.delta==getOr<Money>(l,"modifierPriceMinor",-1),"QR menyudakı qiymət dəyişib. Menyunu yenidən yayımlayın və müştəridən sifarişi yeniləməsini istəyin");require(line.price+line.delta>=0,"Qiymət düzgün deyil");lines.push_back(line);
  }
  services::BusinessDayService days(*ctx);const auto day=days.requireOpenTill();auto orderId=orders.openOrderIdForTable(tableId);const auto now=nowMs();
  if(orderId.empty()){
   orderId=crypto::uuid4();auto insert=ctx->db().prepare("INSERT INTO orders(id,order_number,table_id,user_id,shift_id,status,guest_count,business_day_id,opened_at,updated_at) VALUES(:id,:number,:table,:user,:shift,'draft',1,:day,:now,:now)");
   insert.bind(":id",orderId).bind(":number",orders.nextOrderNumber()).bind(":table",tableId).bind(":user",ctx->session().userId).bindOptional(":shift",ctx->session().shiftId).bind(":day",day).bind(":now",now);insert.exec();
  }else{orders.requireEditable(orderId);days.adoptOrderIntoDay(orderId,day);}
  auto seq=ctx->db().prepare("SELECT COALESCE(MAX(line_seq),0) FROM order_items WHERE order_id=:id");seq.bind(":id",orderId);std::int64_t sequence=seq.step()?seq.columnInt(0):0;
  Json added=Json::array();
  for(const auto& l:lines){const auto itemId=crypto::uuid4();added.push_back(itemId);auto insert=ctx->db().prepare("INSERT INTO order_items(id,order_id,product_id,line_seq,name_snapshot,unit_price_minor,quantity,modifier_total_minor,line_total_minor,status,course,note,created_at,updated_at) VALUES(:id,:order,:product,:seq,:name,:price,:qty,:mods,:total,'draft',:course,:note,:now,:now)");
   insert.bind(":id",itemId).bind(":order",orderId).bind(":product",l.product).bind(":seq",++sequence).bind(":name",l.name).bind(":price",l.price).bind(":qty",l.qty).bind(":mods",l.delta*l.qty).bind(":total",services::lineTotal(l.price,l.delta,l.qty)).bind(":course",l.course).bind(":note",std::string(waiter?"Ofisiant: ":"QR: ")+note+(note.empty()?"":" · ")+l.note).bind(":now",now);insert.exec();
   for(const auto& m:l.modifiers){auto link=ctx->db().prepare("INSERT INTO order_item_modifiers(id,order_item_id,modifier_id,group_name_snapshot,name_snapshot,price_delta_minor) VALUES(:id,:item,:mod,:group,:name,:price)");link.bind(":id",crypto::uuid4()).bind(":item",itemId).bind(":mod",m.id).bind(":group",m.groupName).bind(":name",m.name).bind(":price",m.priceDelta);link.exec();}
  }
  orders.recalculate(orderId);orders.refreshTableStatus(tableId);orders.logEvent(orderId,waiter?"waiter.accepted":"qr.accepted",Json{{"externalId",external},{"lines",lines.size()}});ctx->audit(waiter?"waiter.accept":"qr.accept","order",orderId,Json{{"externalId",external},{"tableId",tableId}});
  Json result={{"orderId",orderId},{"tableId",tableId}};if(waiter){result["waiterUserId"]=ctx->session().userId;result["itemIds"]=added;}auto save=ctx->db().prepare("INSERT INTO qr_order_imports(external_id,request_hash,order_id,table_id,response_json,created_at) VALUES(:id,:hash,:order,:table,:response,:now)");save.bind(":id",external).bind(":hash",hash).bind(":order",orderId).bind(":table",tableId).bind(":response",serialize(result)).bind(":now",now);save.exec();txn.commit();ctx->server().emitEvent(protocol::event::kTablesUpdated,Json{{"tableIds",{tableId}}});return result;
 };
 ctx->server().registerHandler("qr.accept",accept);
 ctx->server().registerHandler("waiter.accept",accept);
 ctx->server().registerHandler("waiter.status",[ctx](const ipc::Request& req){
  ctx->requirePermission("order.view");require(ctx->session().role=="waiter","Yalnız ofisiant girişi");
  auto q=ctx->db().prepare("SELECT response_json FROM qr_order_imports WHERE external_id=:id");q.bind(":id",getOr<std::string>(req.payload,"externalId",""));
  if(!q.step())return Json{{"accepted",false}};
  auto result=Json::parse(q.columnText(0));require(result.value("waiterUserId",std::string{})==ctx->session().userId,"Bu sifariş başqa işçiyə aiddir");
  bool sent=true;for(const auto& id:result.at("itemIds")){auto line=ctx->db().prepare("SELECT status FROM order_items WHERE id=:id");line.bind(":id",id.get<std::string>());if(!line.step()||line.columnText(0)=="draft")sent=false;}
  result["accepted"]=true;result["kitchenSent"]=sent;return result;
 });
}
}
