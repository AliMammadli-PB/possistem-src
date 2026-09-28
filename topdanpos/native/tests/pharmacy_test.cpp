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
          ("topdan-pharmacy-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()) +
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
 * Topdan POS: medicine fields (011), lots sold first-expiry-first-out, stock
 * in expired lots refused at the till, and receiving a lot needs the
 * stock-receiving right.
 */
namespace {
const nlohmann::json kManager = {{"role", "manager"}, {"actorId", "u-manager"}};

void openShop(InlineApp& f) {
  const nlohmann::json snap = {
      {"schemaVersion", 5},
      {"warehouses", {{{"id", "wh-sales"}, {"code", "ZAL"}, {"name", "Zal"}, {"active", true}}}},
      {"registers", {{{"id", "reg-1"}, {"code", "K1"}, {"name", "Kassa"}, {"location", ""}, {"status", "open"},
                      {"openingFloatMinor", 0}, {"operatorId", "u-manager"}, {"openedAt", 1}}}},
      {"products", nlohmann::json::array()},
      {"settings", {{"defaultWarehouseId", "wh-sales"}, {"defaultRegisterId", "reg-1"}}},
  };
  auto payload = kManager;
  payload["snapshot"] = snap;
  REQUIRE(f.call("state.importLegacy", payload)["success"] == true);
}

nlohmann::json medicine() {
  return {{"id", "p-para"}, {"sku", "PARA-500"}, {"barcode", "4600000000017"},
          {"name", {{"az", "Parasetamol"}, {"ru", ""}, {"en", ""}}}, {"category", "Ağrıkəsici"},
          {"unit", "ədəd"}, {"priceMinor", 15}, {"costMinor", 8}, {"minStock", 10}, {"taxRate", 0},
          {"supplier", ""}, {"accent", "#fff"}, {"image", {{"kind", "url"}, {"url", ""}}}, {"active", true},
          {"inn", "Paracetamol"}, {"strength", "500 mg"}, {"dosageForm", "tablet"}, {"packUnits", 20},
          {"splitAllowed", true}, {"rxRequired", false}, {"storage", "room"}, {"manufacturer", "Pharma LLC"},
          {"country", "AZ"}, {"regNo", "DV-123"}};
}

nlohmann::json receive(InlineApp& f, const std::string& lot, std::int64_t expiresAt, std::int64_t qty,
                       const std::string& role = "manager") {
  return f.call("lot.receive", {{"role", role}, {"actorId", "u-" + role}, {"productId", "p-para"},
                                {"lotNumber", lot}, {"expiresAt", expiresAt}, {"qty", qty}});
}

nlohmann::json sell(InlineApp& f, std::int64_t qty) {
  return f.call("sale.complete", {{"role", "manager"}, {"actorId", "u-manager"}, {"cashierId", "u-manager"},
                                  {"registerId", "reg-1"}, {"items", {{{"productId", "p-para"}, {"qty", qty}}}},
                                  {"payment", {{"method", "cash"}, {"tenderedMinor", 100000}}}});
}

std::int64_t lotLeft(InlineApp& f, const std::string& lot) {
  return f.app->database().queryInt("SELECT qty_remaining FROM product_lots WHERE lot_number = ?", {lot}, {});
}
}  // namespace

TEST_CASE("a medicine keeps its pharmacy fields", "[pharmacy]") {
  InlineApp f;
  auto payload = kManager;
  payload["product"] = medicine();
  const auto created = f.call("product.create", payload);
  INFO(created.dump());
  REQUIRE(created["success"] == true);
  const auto& data = created["data"];
  REQUIRE(data["inn"] == "Paracetamol");
  REQUIRE(data["strength"] == "500 mg");
  REQUIRE(data["dosageForm"] == "tablet");
  REQUIRE(data["packUnits"] == 20);
  REQUIRE(data["splitAllowed"] == true);
  REQUIRE(data["rxRequired"] == false);
  REQUIRE(data["regNo"] == "DV-123");
}

TEST_CASE("lots are sold first-expiry-first-out and expired stock is refused", "[pharmacy]") {
  InlineApp f;
  openShop(f);
  auto payload = kManager;
  payload["product"] = medicine();
  REQUIRE(f.call("product.create", payload)["success"] == true);

  const std::int64_t day = 86400000;
  const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::system_clock::now().time_since_epoch()).count();
  REQUIRE(receive(f, "LATE", now + 400 * day, 20)["success"] == true);
  REQUIRE(receive(f, "SOON", now + 60 * day, 10)["success"] == true);

  const auto first = sell(f, 12);
  INFO(first.dump());
  REQUIRE(first["success"] == true);
  REQUIRE(lotLeft(f, "SOON") == 0);
  REQUIRE(lotLeft(f, "LATE") == 18);

  // 5 units of a lot that expired yesterday: the 18 good ones sell, the 19th does not.
  REQUIRE(receive(f, "OLD", now - day, 5)["success"] == true);
  const auto refused = sell(f, 19);
  REQUIRE(refused["success"] == false);
  REQUIRE(refused["error"]["code"] == "E_EXPIRED_STOCK");
  REQUIRE(sell(f, 18)["success"] == true);
  REQUIRE(lotLeft(f, "OLD") == 5);

  // Writing the expired boxes off empties their lot, and nothing is left to sell.
  const auto waste = f.call("inventory.waste", {{"role", "manager"}, {"actorId", "u-manager"}, {"productId", "p-para"},
                                               {"warehouseId", "wh-sales"}, {"qty", 5}, {"reason", "expired"}});
  INFO(waste.dump());
  REQUIRE(waste["success"] == true);
  REQUIRE(lotLeft(f, "OLD") == 0);
}

TEST_CASE("a cashier cannot receive a lot", "[pharmacy]") {
  InlineApp f;
  openShop(f);
  auto payload = kManager;
  payload["product"] = medicine();
  REQUIRE(f.call("product.create", payload)["success"] == true);
  REQUIRE(receive(f, "X", 0, 5, "cashier")["success"] == false);
}

TEST_CASE("medicines sit on shelves; a shelf with medicines cannot be deleted", "[pharmacy]") {
  InlineApp f;
  auto shelf = kManager;
  shelf["code"] = "A-1";
  shelf["zone"] = "Ağrıkəsicilər";
  REQUIRE(f.call("shelf.save", shelf)["success"] == true);
  REQUIRE(f.call("shelf.save", {{"role", "cashier"}, {"actorId", "u-cashier"}, {"code", "Z-9"}})["success"] == false);

  auto payload = kManager;
  payload["product"] = medicine();
  payload["product"]["shelf"] = "A-1";
  const auto created = f.call("product.create", payload);
  REQUIRE(created["data"]["shelf"] == "A-1");

  const auto list = f.call("shelf.list", kManager);
  REQUIRE(list["data"][0]["code"] == "A-1");
  REQUIRE(list["data"][0]["products"] == 1);

  auto remove = kManager;
  remove["code"] = "A-1";
  REQUIRE(f.call("shelf.delete", remove)["success"] == false);
}
