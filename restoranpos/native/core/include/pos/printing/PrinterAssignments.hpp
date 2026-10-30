#pragma once
#include <map>
#include <set>
#include "pos/Common.hpp"
#include "pos/Error.hpp"
namespace pos::printing {
struct PrinterAssignments { Json stations=Json::array(); std::map<std::string,std::string> roles; };
// One explicit destination per document role; a device can hold multiple roles.
inline PrinterAssignments printerAssignments(const Json& input) {
 require(input.is_array() && input.size()<=64,"Printer siyahısı düzgün deyil");
 PrinterAssignments result;std::set<std::string> ids;
 for(auto row:input){
  require(row.is_object(),"Printer məlumatı düzgün deyil");
  const auto id=row.value("id",std::string()),target=row.value("printer",std::string());
  require(!id.empty()&&id.size()<=100&&ids.insert(id).second,"Printer identifikatoru təkrarlanır");
  require(!target.empty()&&target.size()<=512&&target.find_first_of("\r\n\0",0,3)==std::string::npos,"Printer ünvanı düzgün deyil");
  Json roles=row.value("roles",Json::array());
  if(!row.contains("roles")){const auto kind=row.value("kind",std::string());if(kind=="receipt"||kind=="warehouse"||(kind=="kitchen"&&row.value("main",false)))roles.push_back(kind);}
  require(roles.is_array(),"Printer rolları düzgün deyil");
  Json clean=Json::array();std::set<std::string> seen;
  for(const auto& v:roles){
   require(v.is_string(),"Printer rolu düzgün deyil");const auto role=v.get<std::string>();
   require(role=="receipt"||role=="kitchen"||role=="warehouse","Printer rolu tanınmır");
   if(!seen.insert(role).second)continue;
   require(!result.roles.contains(role),"Bu rol üçün artıq printer seçilib");result.roles[role]=target;clean.push_back(role);
  }
  row["roles"]=clean;row["main"]=seen.contains("kitchen");
  // A till can also print selected dishes without becoming the main kitchen.
  if(seen.contains("kitchen")||row.value("kind",std::string())=="kitchen")row["kind"]="kitchen";
  else if(seen.contains("receipt"))row["kind"]="receipt";
  else if(seen.contains("warehouse"))row["kind"]="warehouse";
  for(const auto key:{"itemIds","categoryIds"}){if(!row.contains(key))row[key]=Json::array();require(row[key].is_array(),"Yemək siyahısı düzgün deyil");for(const auto& v:row[key])require(v.is_string(),"Yemək identifikatoru düzgün deyil");}
  result.stations.push_back(std::move(row));
 }
 return result;
}
}
