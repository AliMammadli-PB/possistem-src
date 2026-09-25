#include "catch_amalgamated.hpp"
#include "market/Application.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include "market/db/Database.hpp"
#include "market/db/migrations_generated.hpp"
#include "market/ipc/StdioServer.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;

/**
 * The 1.4.x graft: the sync core recovered from history, joined onto the tree
 * built from 1.3.0.
 *
 * What would rot here is quiet: migration numbers that two lines of the
 * product used for different files (either kind of till then refuses to start
 * on the other's build), and portal documents that the till receives more than
 * once until it acknowledges them (stock in twice).
 */
namespace {

fs::path freshDir(const char* tag) {
  static std::atomic<unsigned long long> sequence{0};
  const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
  auto dir = fs::temp_directory_path() /
             (std::string("market-graft-") + tag + "-" + std::to_string(tick) + "-" +
              std::to_string(sequence.fetch_add(1)));
  fs::create_directories(dir);
  return dir;
}

struct App {
  explicit App(const fs::path& dir) {
    market::logging::init((dir / "logs").string(), "error");
    market::AppConfig config;
    config.dbPath = (dir / "market.db").string();
    config.logDir = (dir / "logs").string();
    app = std::make_unique<market::Application>(config);
    app->bootstrap();
    app->registerHandlers(server);
  }
  ~App() {
    app.reset();
    market::logging::shutdown();
  }
  nlohmann::json call(const std::string& method, nlohmann::json payload) {
    return server.dispatch(method, payload);
  }
  std::unique_ptr<market::Application> app;
  market::ipc::StdioServer server;
};

}  // namespace

TEST_CASE("the field's 1.4 migrations keep their numbers and checksums", "[graft]") {
  // These are what a 1.4.4 till recorded in database_migrations. A different
  // checksum at the same version stops the core at startup.
  const std::pair<int, const char*> field[] = {
      {4, "be2a5510"}, {5, "086f6064"}, {6, "9486b96d"}, {7, "499d781e"}, {8, "5e2bf1bf"}};
  for (const auto& [version, checksum] : field) {
    const auto& m = market::db::kMigrations[version - 1];
    REQUIRE(m.version == version);
    REQUIRE(std::string(m.checksum) == checksum);
  }
}

TEST_CASE("a database from the 1.3.0 line is renumbered, not refused", "[graft]") {
  const auto dir = freshDir("renumber");
  {
    // What a build from the 1.3.0 line left behind: its own two migrations at
    // versions 4 and 5, and none of 1.4's.
    market::db::Database db;
    db.open((dir / "market.db").string());
    db.exec("CREATE TABLE database_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, "
            "checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')));");
    for (int i = 0; i < 3; ++i) {
      const auto& m = market::db::kMigrations[i];
      db.exec(std::string(m.sql));
      db.exec("INSERT INTO database_migrations(version, name, checksum) VALUES (" +
              std::to_string(m.version) + ", '" + m.name + "', '" + m.checksum + "');");
    }
    for (int version : {9, 10}) {
      const auto& m = market::db::kMigrations[version - 1];
      db.exec(std::string(m.sql));
      const std::string old = std::string("00") + std::to_string(version - 5) +
                              std::string(m.name).substr(3);
      db.exec("INSERT INTO database_migrations(version, name, checksum) VALUES (" +
              std::to_string(version - 5) + ", '" + old + "', '" + m.checksum + "');");
    }
  }

  App app(dir);
  auto rows = app.app->database().query("SELECT version, name FROM database_migrations ORDER BY version");
  REQUIRE(rows.size() == 10);
  REQUIRE(rows[3].at("name") == "004_market_140.sql");
  REQUIRE(rows[8].at("name") == "009_role_catalogue.sql");
  REQUIRE(rows[9].at("name") == "010_delivery_recipes_roster.sql");
}

TEST_CASE("a portal purchase order delivered twice is written once", "[graft]") {
  const auto dir = freshDir("po");
  App app(dir);
  app.app->database().exec(
      "INSERT OR IGNORE INTO warehouses(id, code, name) VALUES ('wh-po', 'P1', 'Anbar');"
      "INSERT OR IGNORE INTO products(id, sku, barcode, name_az, price_minor, cost_minor, created_at) "
      "  VALUES ('prod-po', 'SKU-PO', '4800000000099', 'Un', 500, 300, 0);");
  const nlohmann::json order = {
      {"id", "PO-portal-1"}, {"supplier", "Təchizatçı"}, {"warehouseId", "wh-po"},
      {"createdBy", "staff-manager"}, {"lines", {{{"productId", "prod-po"}, {"qty", 5}, {"costMinor", 300}}}}};
  const nlohmann::json who = {{"role", "manager"}, {"actorId", "staff-manager"}};

  auto first = who; first["order"] = order;
  app.call("purchase.create", first);
  app.call("purchase.create", first);  // the redelivery
  REQUIRE(app.app->database().queryInt("SELECT COUNT(*) FROM purchase_orders WHERE id = 'PO-portal-1'") == 1);

  auto receive = who; receive["id"] = "PO-portal-1"; receive["portalCommandId"] = "cmd-1";
  app.call("purchase.receive", receive);
  app.call("purchase.receive", receive);  // the redelivery must not add stock again
  REQUIRE(app.app->database().queryInt(
              "SELECT COALESCE(SUM(qty),0) FROM stock_levels WHERE product_id = 'prod-po'") == 5);
}

TEST_CASE("the same id for a different supplier is refused", "[graft]") {
  const auto dir = freshDir("po-conflict");
  App app(dir);
  app.app->database().exec(
      "INSERT OR IGNORE INTO warehouses(id, code, name) VALUES ('wh-po', 'P1', 'Anbar');"
      "INSERT OR IGNORE INTO products(id, sku, barcode, name_az, price_minor, cost_minor, created_at) "
      "  VALUES ('prod-po', 'SKU-PO', '4800000000099', 'Un', 500, 300, 0);");
  nlohmann::json p = {{"role", "manager"}, {"actorId", "staff-manager"},
                      {"order", {{"id", "PO-x"}, {"supplier", "A"}, {"warehouseId", "wh-po"},
                                 {"lines", {{{"productId", "prod-po"}, {"qty", 1}}}}}}};
  app.call("purchase.create", p);
  p["order"]["supplier"] = "B";
  REQUIRE_THROWS_AS(app.call("purchase.create", p), market::PosError);
}

TEST_CASE("a cashier cannot raise a purchase order", "[graft]") {
  const auto dir = freshDir("po-gate");
  App app(dir);
  nlohmann::json p = {{"role", "cashier"}, {"actorId", "staff-cashier"},
                      {"order", {{"supplier", "A"}, {"warehouseId", "wh-po"},
                                 {"lines", {{{"productId", "prod-po"}, {"qty", 1}}}}}}};
  REQUIRE_THROWS_AS(app.call("purchase.create", p), market::PosError);
}
