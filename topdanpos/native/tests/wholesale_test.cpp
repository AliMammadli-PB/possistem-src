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
          ("topdan-wholesale-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) +
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

/**
 * Topdan POS: three price levels on a product (013), the customer's level
 * decides the price at the till, and a wholesale customer buys on credit up to
 * the limit the manager set, then pays the debt back.
 */
const nlohmann::json kManager = {{"role", "manager"}, {"actorId", "u-manager"}};

void openShop(InlineApp& f) {
  const nlohmann::json snap = {
      {"schemaVersion", 5},
      {"warehouses", {{{"id", "wh-main"}, {"code", "ANB"}, {"name", "Anbar"}, {"active", true}}}},
      {"registers", {{{"id", "reg-1"}, {"code", "K1"}, {"name", "Kassa"}, {"location", ""}, {"status", "open"},
                      {"openingFloatMinor", 0}, {"operatorId", "u-manager"}, {"openedAt", 1}}}},
      {"products", nlohmann::json::array()},
      {"settings", {{"defaultWarehouseId", "wh-main"}, {"defaultRegisterId", "reg-1"}}},
  };
  auto payload = kManager;
  payload["snapshot"] = snap;
  REQUIRE(f.call("state.importLegacy", payload)["success"] == true);
}

// A 6-bottle pack of water: stock and prices per bottle.
nlohmann::json water() {
  return {{"id", "p-water"}, {"sku", "SU-15"}, {"barcode", "2000000000428"},
          {"name", {{"az", "Su 1.5 L"}, {"ru", ""}, {"en", ""}}}, {"category", "İçkilər"},
          {"unit", "ədəd"}, {"priceMinor", 150}, {"priceWholesaleMinor", 120}, {"priceDealerMinor", 100},
          {"costMinor", 80}, {"minStock", 60}, {"taxRate", 18}, {"supplier", ""}, {"accent", "#fff"},
          {"image", {{"kind", "url"}, {"url", ""}}}, {"active", true}, {"packUnits", 6}, {"splitAllowed", true},
          {"packName", "yeşik"}, {"warehouseStock", {{"wh-main", 600}}}};
}

std::string customer(InlineApp& f, const std::string& name, const std::string& tier, std::int64_t limitMinor) {
  auto payload = kManager;
  payload.update({{"name", name}, {"priceTier", tier}, {"voen", "1234567891"}, {"address", "Bakı"},
                  {"creditAllowed", limitMinor > 0}, {"creditLimitMinor", limitMinor}});
  const auto created = f.call("customer.create", payload);
  INFO(created.dump());
  REQUIRE(created["success"] == true);
  REQUIRE(created["data"]["priceTier"] == tier);
  REQUIRE(created["data"]["voen"] == "1234567891");
  return created["data"]["id"].get<std::string>();
}

nlohmann::json sell(InlineApp& f, const std::string& customerId, std::int64_t qty, const std::string& method = "cash") {
  nlohmann::json payload = {{"role", "manager"}, {"actorId", "u-manager"}, {"cashierId", "u-manager"},
                            {"registerId", "reg-1"}, {"items", {{{"productId", "p-water"}, {"qty", qty}}}},
                            {"payment", {{"method", method}, {"tenderedMinor", 1000000}}}};
  if (!customerId.empty()) payload["customerId"] = customerId;
  return f.call("sale.complete", payload);
}
}  // namespace

TEST_CASE("a product keeps its three price levels and its pack", "[wholesale]") {
  InlineApp f;
  auto payload = kManager;
  payload["product"] = water();
  const auto created = f.call("product.create", payload);
  INFO(created.dump());
  REQUIRE(created["data"]["priceWholesaleMinor"] == 120);
  REQUIRE(created["data"]["priceDealerMinor"] == 100);
  REQUIRE(created["data"]["packName"] == "yeşik");

  // An edit that does not name the levels (a portal price change) keeps them.
  auto edit = kManager;
  edit["product"] = water();
  edit["product"].erase("priceWholesaleMinor");
  edit["product"].erase("priceDealerMinor");
  edit["product"].erase("packName");
  edit["product"]["priceMinor"] = 160;
  const auto updated = f.call("product.update", edit);
  INFO(updated.dump());
  REQUIRE(updated["data"]["priceMinor"] == 160);
  REQUIRE(updated["data"]["priceWholesaleMinor"] == 120);
  REQUIRE(updated["data"]["packName"] == "yeşik");
}

TEST_CASE("the customer's price level decides the price", "[wholesale]") {
  InlineApp f;
  openShop(f);
  auto payload = kManager;
  payload["product"] = water();
  REQUIRE(f.call("product.create", payload)["success"] == true);
  const auto shop = customer(f, "Nərgiz market", "wholesale", 0);
  const auto dealer = customer(f, "Region diler", "dealer", 0);

  REQUIRE(sell(f, "", 6)["data"]["totalMinor"] == 900);        // walk-in: retail 1.50
  REQUIRE(sell(f, shop, 6)["data"]["totalMinor"] == 720);      // wholesale 1.20
  REQUIRE(sell(f, dealer, 6)["data"]["totalMinor"] == 600);    // dealer 1.00

  auto bad = kManager;
  bad.update({{"name", "X"}, {"priceTier", "vip"}});
  REQUIRE(f.call("customer.create", bad)["success"] == false);
}

TEST_CASE("a wholesale customer buys on credit up to the limit and pays back", "[wholesale]") {
  InlineApp f;
  openShop(f);
  auto payload = kManager;
  payload["product"] = water();
  REQUIRE(f.call("product.create", payload)["success"] == true);
  const auto shop = customer(f, "Nərgiz market", "wholesale", 100000);  // 1000 AZN limit

  REQUIRE(sell(f, shop, 600, "credit")["success"] == true);  // 720 AZN on credit
  const auto over = sell(f, shop, 300, "credit");             // +360 AZN > limit
  REQUIRE(over["success"] == false);
  REQUIRE(over["error"]["code"] == "CREDIT_LIMIT_EXCEEDED");

  auto pay = kManager;
  pay.update({{"customerId", shop}, {"amountMinor", 20000}, {"note", "Nağd"}});
  REQUIRE(f.call("customer.payDebt", pay)["success"] == true);
  const auto list = f.call("customer.list", kManager);
  REQUIRE(list["data"][0]["balanceMinor"] == 52000);
  REQUIRE(list["data"][0]["priceTier"] == "wholesale");
}
