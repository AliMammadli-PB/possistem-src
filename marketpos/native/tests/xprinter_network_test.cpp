#include "catch_amalgamated.hpp"
#include "market/Error.hpp"
#include "market/printing/XprinterNetwork.hpp"

#include <string>
#include <utility>
#include <vector>

// Ported from restoranpos/native/tests/xprinter_network_test.cpp: bad input never reaches the printer.
namespace {
nlohmann::json config() { return {{"mac", "00:ED:09:21:53:3D"}, {"oldIp", "192.168.1.100"}, {"ip", "192.168.1.120"}, {"mask", "255.255.255.0"}, {"gateway", "192.168.1.1"}}; }
}  // namespace

TEST_CASE("Xprinter network validates addresses before touching hardware", "[printing][xprinter]") {
    auto input = config();
    REQUIRE(market::printing::validateXprinterNetwork(input)["ip"] == "192.168.1.120");
    for (const auto& [key, value] : std::vector<std::pair<std::string, std::string>>{
             {"ip", "8.8.8.8"}, {"ip", "192.168.1.0"}, {"ip", "192.168.1.255"}, {"gateway", "192.168.2.1"},
             {"gateway", "192.168.1.120"}, {"mask", "255.0.255.0"}, {"mac", "FF:FF:FF:FF:FF:FF"},
             {"mac", "00:00:00:00:00:00"}, {"oldIp", "127.0.0.1"}, {"ip", "192.168.001.12"}}) {
        auto wrong = input;
        wrong[key] = value;
        REQUIRE_THROWS_AS(market::printing::validateXprinterNetwork(wrong), market::PosError);
    }
    // Unconfirmed changes are refused before the SDK is touched.
    REQUIRE_THROWS_AS(market::printing::configureXprinterNetwork(input), market::PosError);
}

#ifdef _WIN32
TEST_CASE("Xprinter official SDK can load its documented exports", "[printing][xprinter]") { REQUIRE(market::printing::xprinterSdkAvailable()); }
#endif
