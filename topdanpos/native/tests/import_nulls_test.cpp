#include "catch_amalgamated.hpp"
#include "market/Application.hpp"
#include "market/Logging.hpp"
#include "market/ipc/StdioServer.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <memory>
#include <string>

namespace fs = std::filesystem;

/**
 * A first launch imports the built-in catalogue with `state.importLegacy`,
 * which writes purchase orders without document_no or payment_status. Those
 * columns come back as SQL NULL, and `row.value(key, fallback)` returns the
 * null rather than the fallback - so the export after the import threw, the
 * import rolled back, and a new till never got its catalogue.
 * Driven through StdioServer::processLine, the path the web demo uses.
 */
namespace {

struct InlineApp {
  InlineApp() {
    static std::atomic<unsigned long long> sequence{0};
    dir = fs::temp_directory_path() /
          ("market-import-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) +
           "-" + std::to_string(sequence.fetch_add(1)));
    fs::create_directories(dir);
    market::logging::init((dir / "logs").string(), "error");
    market::AppConfig config;
    config.dbPath = (dir / "topdan.db").string();
    config.logDir = (dir / "logs").string();
    app = std::make_unique<market::Application>(config);
    app->bootstrap();
    app->registerHandlers(server);
  }
  ~InlineApp() {
    app.reset();
    market::logging::shutdown();
    std::error_code ec;
    fs::remove_all(dir, ec);
  }
  nlohmann::json call(const std::string& method, const nlohmann::json& payload) {
    const auto out = server.processLine(
        nlohmann::json{{"requestId", "t"}, {"method", method}, {"payload", payload}}.dump());
    return nlohmann::json::parse(out.substr(0, out.find('\n')));
  }
  fs::path dir;
  std::unique_ptr<market::Application> app;
  market::ipc::StdioServer server;
};

}  // namespace

TEST_CASE("the first-launch catalogue import survives purchase orders with NULL columns", "[import]") {
  InlineApp f;
  const nlohmann::json snapshot = {
      {"schemaVersion", 5},
      {"warehouses", {{{"id", "wh-main"}, {"code", "DEP-01"}, {"name", "Depo"}, {"active", true}}}},
      {"products", nlohmann::json::array()},
      {"purchaseOrders",
       {{{"id", "PO-1"}, {"supplier", "Bravo"}, {"expectedAt", "2026-09-15"}, {"createdAt", 1},
         {"createdBy", "u-manager"}, {"warehouseId", "wh-main"}, {"status", "ordered"},
         {"lines", nlohmann::json::array()}}}},
  };
  const auto imported = f.call("state.importLegacy", {{"snapshot", snapshot}, {"role", "manager"}, {"actorId", "u-manager"}});
  INFO(imported.dump());
  REQUIRE(imported["success"] == true);
  const auto& po = imported["data"]["purchaseOrders"][0];
  REQUIRE(po["documentNo"] == "PO-1");
  REQUIRE(po["paymentStatus"] == "unpaid");
  REQUIRE(f.call("state.get", {{"role", "manager"}, {"actorId", "u-manager"}})["success"] == true);
}
