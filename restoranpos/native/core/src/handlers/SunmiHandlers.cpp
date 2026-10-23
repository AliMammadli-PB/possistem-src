#include "pos/handlers/Handlers.hpp"
#include "pos/Error.hpp"
namespace pos::handlers {
void registerSunmi(const ContextPtr& ctx){
 ctx->server().registerHandler("sunmi.pending",[ctx](const ipc::Request& request){
  ctx->requirePermission("payment.take");auto s=ctx->db().prepare("SELECT payload_json FROM sunmi_outbox WHERE status IN ('pending','failed','unknown') AND created_at>=:since AND terminal_id=:terminal ORDER BY created_at,id LIMIT 100");s.bind(":since",getOr<std::int64_t>(request.payload,"since",0));s.bind(":terminal",ctx->saleTerminalId());Json out=Json::array();while(s.step())out.push_back(Json::parse(s.columnText(0)));return out;
 });
 ctx->server().registerHandler("sunmi.finish",[ctx](const ipc::Request& request){
  ctx->requirePermission("payment.take");const auto id=getOr<std::string>(request.payload,"id","");const auto state=getOr<std::string>(request.payload,"status","");require(state=="success"||state=="failed"||state=="unknown"||state=="blocked"||state=="pending","Invalid SUNMI state");
  auto s=ctx->db().prepare("UPDATE sunmi_outbox SET status=:status,response_json=:result,updated_at=:now WHERE id=:id AND terminal_id=:terminal AND status<>'success'");s.bind(":status",state).bind(":result",request.payload.value("result",Json::object()).dump()).bind(":now",nowMs()).bind(":id",id).bind(":terminal",ctx->saleTerminalId());s.exec();ctx->auditRequired("sunmi.result","fiscal",id,Json{{"status",state}});return Json{{"ok",true}};
 });
}
}
