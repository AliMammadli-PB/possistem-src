#include "catch_amalgamated.hpp"
#include "pos/printing/XprinterNetwork.hpp"
#include "pos/Error.hpp"
#include "ServiceFixture.hpp"
#include "pos/handlers/Handlers.hpp"
namespace {pos::Json config(){return {{"mac","00:ED:09:21:53:3D"},{"oldIp","192.168.1.100"},{"ip","192.168.1.120"},{"mask","255.255.255.0"},{"gateway","192.168.1.1"}};}}
TEST_CASE("Xprinter network validates addresses before touching hardware","[printer][xprinter]"){
 auto input=config();REQUIRE(pos::printing::validateXprinterNetwork(input)["ip"]=="192.168.1.120");
 for(const auto& pair:std::vector<std::pair<std::string,std::string>>{{"ip","8.8.8.8"},{"ip","192.168.1.0"},{"ip","192.168.1.255"},{"gateway","192.168.2.1"},{"gateway","192.168.1.120"},{"mask","255.0.255.0"},{"mac","FF:FF:FF:FF:FF:FF"},{"mac","00:00:00:00:00:00"},{"oldIp","127.0.0.1"},{"ip","192.168.001.12"}}){auto wrong=input;wrong[pair.first]=pair.second;REQUIRE_THROWS_AS(pos::printing::validateXprinterNetwork(wrong),pos::PosError);}
 REQUIRE_THROWS_AS(pos::printing::configureXprinterNetwork(input),pos::PosError);
}
TEST_CASE("Xprinter configuration requires settings permission","[printer][xprinter]"){
 ServiceFixture f;pos::handlers::registerPrinting(f.contextPtr());f.ctx().session().permissions.clear();pos::ipc::Request request;request.requestId="xprinter-test";request.method="print.xprinterConfigure";request.payload=config();request.payload["confirmed"]=true;REQUIRE_THROWS_AS(f.server().callHandler(request),pos::PosError);
}

#ifdef _WIN32
TEST_CASE("Xprinter official SDK can load its documented exports", "[printer][xprinter]") { REQUIRE(pos::printing::xprinterSdkAvailable()); }
#endif
