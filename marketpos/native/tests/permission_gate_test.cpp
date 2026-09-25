#include "catch_amalgamated.hpp"
#include "market/Application.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include "market/db/Database.hpp"
#include "market/ipc/StdioServer.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;

/**
 * Who may change stock, products and money.
 *
 * The permission catalogue has always listed STOCK_ADJUSTMENT,
 * RECEIVE_PURCHASE, EDIT_PRODUCT and the rest, and the permissions screen let a
 * manager hand them out - but only the handlers in RetailOps.cpp ever checked
 * one. Everything registered in Application.cpp was reachable by anyone with a
 * session: a cashier could write off stock or delete a product through
 * `market:invoke` while their own screen hid the button.
 *
 * These cases are the enforcement. They matter more than the screen does,
 * because the screen is the half an attacker skips.
 */
namespace {

struct GatedApp {
  GatedApp() {
    static std::atomic<unsigned long long> sequence{0};
    const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
    dir = fs::temp_directory_path() /
          ("market-gate-test-" + std::to_string(tick) + "-" +
           std::to_string(sequence.fetch_add(1)));
    fs::create_directories(dir);
    market::logging::init((dir / "logs").string(), "error");

    market::AppConfig config;
    config.dbPath = (dir / "market.db").string();
    config.logDir = (dir / "logs").string();
    app = std::make_unique<market::Application>(config);
    app->bootstrap();
    app->registerHandlers(server);

    // A till to act on. Inserted directly rather than through the handlers,
    // because the handlers are what these cases are about.
    app->database().exec(
        "INSERT OR IGNORE INTO warehouses(id, code, name) VALUES ('wh-test', 'T1', 'Test anbar');"
        "INSERT OR IGNORE INTO products(id, sku, barcode, name_az, price_minor, cost_minor, created_at) "
        "  VALUES ('prod-test', 'SKU-T1', '4800000000001', 'Test məhsul', 500, 300, 0);"
        "INSERT OR IGNORE INTO stock_levels(product_id, warehouse_id, qty) "
        "  VALUES ('prod-test', 'wh-test', 100);");
    warehouseId = "wh-test";
    productId = "prod-test";
  }
  ~GatedApp() {
    app.reset();
    market::logging::shutdown();
  }

  nlohmann::json call(const std::string& method, nlohmann::json payload) {
    return server.dispatch(method, payload);
  }

  /** What main writes onto a payload once it has verified the session. */
  nlohmann::json as(const std::string& role) {
    return nlohmann::json{{"role", role}, {"actorId", "staff-" + role}};
  }

  fs::path dir;
  std::unique_ptr<market::Application> app;
  market::ipc::StdioServer server;
  std::string warehouseId;
  std::string productId;
};

}  // namespace

TEST_CASE("a cashier cannot write off stock", "[permissions][gate]") {
  GatedApp t;
  REQUIRE_FALSE(t.productId.empty());

  auto adjust = t.as("cashier");
  adjust["productId"] = t.productId;
  adjust["warehouseId"] = t.warehouseId;
  adjust["qtyDelta"] = -5;
  REQUIRE_THROWS_AS(t.call("inventory.adjust", adjust), market::PosError);

  // The warehouse role holds STOCK_ADJUSTMENT, so the same call is ordinary work.
  auto allowed = adjust;
  allowed["role"] = "warehouse";
  allowed["actorId"] = "staff-warehouse";
  REQUIRE_NOTHROW(t.call("inventory.adjust", allowed));
}

TEST_CASE("a cashier cannot delete or reprice the catalogue", "[permissions][gate]") {
  GatedApp t;

  auto remove = t.as("cashier");
  remove["id"] = t.productId;
  REQUIRE_THROWS_AS(t.call("product.delete", remove), market::PosError);

  // And the product is still there afterwards - refused, not half-applied.
  REQUIRE(t.app->database().queryInt("SELECT COUNT(*) FROM products WHERE id = ?",
                                     {t.productId}, {}) == 1);
}

TEST_CASE("a manager PIN still carries a refusal through", "[permissions][gate]") {
  GatedApp t;

  // The override path main already had: a manager typed their PIN, main
  // verified it and wrote approverId. Gating must not break the one way a
  // cashier legitimately does a manager's job at the counter.
  auto adjust = t.as("cashier");
  adjust["productId"] = t.productId;
  adjust["warehouseId"] = t.warehouseId;
  adjust["qtyDelta"] = -1;
  adjust["approverId"] = "staff-manager";
  REQUIRE_NOTHROW(t.call("inventory.adjust", adjust));

  REQUIRE(t.app->database().queryInt(
              "SELECT COUNT(*) FROM audit_logs WHERE action = 'MANAGER_APPROVAL'") > 0);
}

TEST_CASE("a payload with no role at all is refused", "[permissions][gate]") {
  GatedApp t;

  // This is what a renderer call looks like when nobody is signed in:
  // core-payload.cjs strips role and actorId and writes neither.
  nlohmann::json anonymous = {{"productId", t.productId},
                              {"warehouseId", t.warehouseId},
                              {"qtyDelta", -3}};
  REQUIRE_THROWS_AS(t.call("inventory.adjust", anonymous), market::PosError);
}

TEST_CASE("selling is not gated", "[permissions][gate]") {
  GatedApp t;

  // A cashier's own job must stay unobstructed: the gates are on the handlers
  // that change stock, catalogue and settings, never on the sale path.
  REQUIRE_NOTHROW(t.call("product.list", nlohmann::json::object()));
  REQUIRE_NOTHROW(t.call("inventory.getStock",
                         nlohmann::json{{"productId", t.productId},
                                        {"warehouseId", t.warehouseId}}));
}

TEST_CASE("a write-off is recorded as a loss, not as a correction", "[inventory][waste]") {
  GatedApp t;

  auto waste = t.as("warehouse");
  waste["productId"] = t.productId;
  waste["warehouseId"] = t.warehouseId;
  waste["qty"] = 4;
  waste["reason"] = "expired";
  REQUIRE_NOTHROW(t.call("inventory.waste", waste));

  // Its own movement type: "what did we throw away this month" cannot be
  // answered if a write-off and a stock correction look the same in history.
  REQUIRE(t.app->database().queryInt(
              "SELECT COUNT(*) FROM stock_movements WHERE type = 'WASTE' AND qty_delta = -4") == 1);
  REQUIRE(t.app->database().queryText(
              "SELECT note FROM stock_movements WHERE type = 'WASTE'") == "expired");
  REQUIRE(t.app->database().queryInt("SELECT qty FROM stock_levels WHERE product_id = ?",
                                     {t.productId}, {}) == 96);
}

TEST_CASE("a write-off without a usable reason is refused", "[inventory][waste]") {
  GatedApp t;

  auto waste = t.as("warehouse");
  waste["productId"] = t.productId;
  waste["warehouseId"] = t.warehouseId;
  waste["qty"] = 1;

  // Free text cannot be summed, so the reason comes from a closed list; the
  // screen reads that same list, so the two can never disagree.
  waste["reason"] = "dropped it";
  REQUIRE_THROWS_AS(t.call("inventory.waste", waste), market::PosError);

  waste["reason"] = "expired";
  waste["qty"] = 0;
  REQUIRE_THROWS_AS(t.call("inventory.waste", waste), market::PosError);

  // And a cashier cannot write stock off at all.
  auto cashier = t.as("cashier");
  cashier["productId"] = t.productId;
  cashier["warehouseId"] = t.warehouseId;
  cashier["qty"] = 1;
  cashier["reason"] = "expired";
  REQUIRE_THROWS_AS(t.call("inventory.waste", cashier), market::PosError);

  REQUIRE(t.app->database().queryInt("SELECT COUNT(*) FROM stock_movements WHERE type = 'WASTE'") == 0);
}

TEST_CASE("the reason list the screen shows is the list the core checks", "[inventory][waste]") {
  GatedApp t;

  const auto listed = t.call("inventory.wasteReasons", nlohmann::json::object());
  REQUIRE(listed["reasons"].size() >= 5);

  for (const auto& entry : listed["reasons"]) {
    auto waste = t.as("warehouse");
    waste["productId"] = t.productId;
    waste["warehouseId"] = t.warehouseId;
    waste["qty"] = 1;
    waste["reason"] = entry.at("code");
    REQUIRE_NOTHROW(t.call("inventory.waste", waste));
    REQUIRE_FALSE(entry.at("label").get<std::string>().empty());
  }
}
