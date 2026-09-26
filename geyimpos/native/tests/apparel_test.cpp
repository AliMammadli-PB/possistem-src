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

namespace {

struct InlineApp {
  InlineApp() {
    static std::atomic<unsigned long long> sequence{0};
    dir = fs::temp_directory_path() /
          ("geyim-apparel-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) +
           "-" + std::to_string(sequence.fetch_add(1)));
    fs::create_directories(dir);
    market::logging::init((dir / "logs").string(), "error");
    market::AppConfig config;
    config.dbPath = (dir / "geyim.db").string();
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

/**
 * Geyim POS: a variant carries brand/material/season/gender (011), a clothing
 * tag's alphanumeric CODE128 resolves as scanned, and product.delete binds the
 * id instead of splicing it into SQL.
 */
TEST_CASE("an apparel variant keeps its attributes and resolves by an alphanumeric tag", "[apparel]") {
  InlineApp f;
  const nlohmann::json actor = {{"role", "manager"}, {"actorId", "u-manager"}};
  auto payload = actor;
  payload["product"] = {{"id", "p-shirt-bl-m"}, {"sku", "KN-100-QARA-M"}, {"barcode", "KN100-BL-M"},
                        {"name", {{"az", "Köynək Oxford"}, {"ru", ""}, {"en", ""}}}, {"category", "Köynək"},
                        {"unit", "əd"}, {"priceMinor", 4990}, {"costMinor", 2100}, {"minStock", 1},
                        {"taxRate", 18}, {"supplier", ""}, {"accent", "#111111"},
                        {"image", {{"kind", "url"}, {"url", ""}}}, {"active", true}, {"color", "Qara"},
                        {"size", "M"}, {"parentProductId", "p-shirt"}, {"brand", "Oxford"},
                        {"material", "Pambıq"}, {"season", "Bütün mövsüm"}, {"gender", "Kişi"}, {"stock", 3}};
  const auto created = f.call("product.create", payload);
  INFO(created.dump());
  REQUIRE(created["success"] == true);
  REQUIRE(created["data"]["brand"] == "Oxford");
  REQUIRE(created["data"]["material"] == "Pambıq");
  REQUIRE(created["data"]["season"] == "Bütün mövsüm");
  REQUIRE(created["data"]["gender"] == "Kişi");
  REQUIRE(created["data"]["parentProductId"] == "p-shirt");

  auto scan = actor;
  scan["barcode"] = " KN100-BL-M ";
  const auto resolved = f.call("barcode.resolve", scan);
  INFO(resolved.dump());
  REQUIRE(resolved["success"] == true);
  REQUIRE(resolved["data"]["id"] == "p-shirt-bl-m");

  scan["barcode"] = "KN-100-QARA-M";
  REQUIRE(f.call("barcode.resolve", scan)["data"]["id"] == "p-shirt-bl-m");
}

TEST_CASE("product.delete treats a quote in the id as data", "[apparel]") {
  InlineApp f;
  f.app->database().exec(
      "INSERT INTO products(id, sku, barcode, name_az, price_minor, cost_minor, created_at) "
      "VALUES ('p-keep', 'K-1', '2000000000015', 'Şərf', 1500, 700, 1);");
  f.call("product.delete", {{"role", "manager"}, {"actorId", "u-manager"}, {"id", "x' OR '1'='1"}});
  REQUIRE(f.app->database().queryInt("SELECT COUNT(*) FROM products WHERE active = 1") == 1);
}
