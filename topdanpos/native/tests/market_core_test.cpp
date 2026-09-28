#include "catch_amalgamated.hpp"
#include "market/Logging.hpp"
#include "market/db/Database.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <string>

#if !defined(_WIN32)
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

static fs::path tempDbDir() {
  // Unseeded std::rand() returns the same sequence every run, so two tests
  // could be handed the same path - and therefore the same database.
  static std::atomic<unsigned long long> sequence{0};
  const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
  auto dir = fs::temp_directory_path() /
             ("market-core-test-" + std::to_string(tick) + "-" +
              std::to_string(sequence.fetch_add(1)));
  fs::create_directories(dir);
  return dir;
}

static fs::path coreBinary() {
  // tests run from native/build
  return fs::current_path() / "topdan-pos-core";
}

TEST_CASE("migrations apply with WAL", "[db]") {
  auto dir = tempDbDir();
  auto dbPath = dir / "topdan.db";
  market::logging::init((dir / "logs").string(), "error");
  market::db::Database db;
  db.open(dbPath.string());
  market::db::Migrator(db).migrate();
  REQUIRE(db.queryInt("SELECT COUNT(*) FROM database_migrations") >= 1);
  const auto mode = db.queryText("PRAGMA journal_mode;");
  REQUIRE((mode == "wal" || mode == "WAL"));
  db.close();
  market::logging::shutdown();
}

#if !defined(_WIN32)
TEST_CASE("core binary: ping barcode sale stock refund", "[ipc]") {
  auto dir = tempDbDir();
  auto dbPath = dir / "topdan.db";
  auto logDir = dir / "logs";
  fs::create_directories(logDir);
  REQUIRE(fs::exists(coreBinary()));

  int inPipe[2];
  int outPipe[2];
  REQUIRE(pipe(inPipe) == 0);
  REQUIRE(pipe(outPipe) == 0);
  pid_t pid = fork();
  REQUIRE(pid >= 0);
  if (pid == 0) {
    dup2(inPipe[0], STDIN_FILENO);
    dup2(outPipe[1], STDOUT_FILENO);
    close(inPipe[0]);
    close(inPipe[1]);
    close(outPipe[0]);
    close(outPipe[1]);
    const auto bin = coreBinary().string();
    const auto db = dbPath.string();
    const auto logs = logDir.string();
    execl(bin.c_str(), bin.c_str(), "--db", db.c_str(), "--log-dir", logs.c_str(), "--log-level", "error",
          "--protocol", "1", static_cast<char*>(nullptr));
    _exit(127);
  }
  close(inPipe[0]);
  close(outPipe[1]);

  auto writeLine = [&](const nlohmann::json& j) {
    const auto line = j.dump() + "\n";
    const auto n = write(inPipe[1], line.data(), line.size());
    REQUIRE(n == static_cast<ssize_t>(line.size()));
  };
  auto readRawFrame = [&]() {
    std::string buf;
    char c;
    while (true) {
      const ssize_t n = read(outPipe[0], &c, 1);
      REQUIRE(n == 1);
      if (c == '\n') break;
      buf.push_back(c);
    }
    return nlohmann::json::parse(buf);
  };
  // The core announces `state.changed` after every write, so responses are
  // interleaved with events. Skip them the way core-supervisor.cjs does.
  auto readFrame = [&]() {
    while (true) {
      auto frame = readRawFrame();
      if (frame.value("type", std::string{}) != "event") return frame;
    }
  };

  auto e1 = readRawFrame();
  REQUIRE(e1["type"] == "event");
  auto e2 = readRawFrame();
  REQUIRE(e2["event"] == "core.ready");

  nlohmann::json snap = {
      {"warehouses",
       {{{"id", "wh-sales"}, {"code", "ZAL"}, {"name", "Sales"}, {"address", ""}, {"manager", ""}, {"active", true}}}},
      {"registers",
       {{{"id", "reg-1"},
         {"code", "K1"},
         {"name", "Kassa"},
         {"location", ""},
         {"status", "open"},
         {"openingFloatMinor", 0},
         {"operatorId", "u1"},
         {"openedAt", 1}}}},
      {"products",
       {{{"id", "p1"},
         {"sku", "SKU1"},
         {"barcode", "4769901000001"},
         {"name", {{"az", "Test"}, {"ru", "Test"}, {"en", "Test"}}},
         {"category", "Cat"},
         {"unit", "əd"},
         {"priceMinor", 100},
         {"costMinor", 50},
         {"minStock", 1},
         {"taxRate", 18},
         {"supplier", "S"},
         {"warehouseStock", {{"wh-sales", 10}}},
         {"accent", "#000"},
         {"image", {{"kind", "sprite"}, {"index", 0}}},
         {"active", true},
         {"createdAt", 1}}}},
      {"settings", {{"defaultWarehouseId", "wh-sales"}, {"defaultRegisterId", "reg-1"}}},
  };

  writeLine({{"requestId", "imp"},
             {"method", "state.importLegacy"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"snapshot", snap}, {"role", "manager"}, {"actorId", "u1"}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "1"},
             {"method", "core.ping"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", nlohmann::json::object()}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "2"},
             {"method", "barcode.resolve"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"barcode", "4769901000001"}}}});
  REQUIRE(readFrame()["data"]["id"] == "p1");

  writeLine({{"requestId", "3"},
             {"method", "sale.complete"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"cashierId", "u1"},
               {"registerId", "reg-1"},
               {"warehouseId", "wh-sales"},
               {"discountMinor", 10},
               {"items", {{{"productId", "p1"}, {"qty", 2}}}},
               {"payment", {{"method", "cash"}, {"tenderedMinor", 500}}}}}});
  auto sale = readFrame();
  REQUIRE(sale["success"] == true);
  REQUIRE(sale["data"]["totalMinor"] == 190);
  const std::string saleId = sale["data"]["id"].get<std::string>();

  writeLine({{"requestId", "4"},
             {"method", "inventory.getStock"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"productId", "p1"}, {"warehouseId", "wh-sales"}}}});
  REQUIRE(readFrame()["data"]["qty"] == 8);

  writeLine({{"requestId", "5"},
             {"method", "sale.complete"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"cashierId", "u1"},
               {"registerId", "reg-1"},
               {"warehouseId", "wh-sales"},
               {"items", {{{"productId", "p1"}, {"qty", 100}}}},
               {"payment", {{"method", "cash"}, {"tenderedMinor", 100000}}}}}});
  auto fail = readFrame();
  REQUIRE(fail["success"] == false);
  REQUIRE(fail["error"]["code"] == "INSUFFICIENT_STOCK");

  writeLine({{"requestId", "6"},
             {"method", "return.create"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"saleId", saleId}, {"actorId", "u1"}, {"role", "manager"}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "7"},
             {"method", "inventory.getStock"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"productId", "p1"}, {"warehouseId", "wh-sales"}}}});
  REQUIRE(readFrame()["data"]["qty"] == 10);

  const nlohmann::json portalAdjustment = {
      {"productId", "p1"}, {"warehouseId", "wh-sales"}, {"qtyDelta", 3},
      {"actorId", "u1"}, {"role", "manager"}, {"portalCommandId", "11111111-1111-4111-8111-111111111111"}};
  for (int attempt = 0; attempt < 2; ++attempt) {
    writeLine({{"requestId", "portal-adjust-" + std::to_string(attempt)},
               {"method", "inventory.adjust"}, {"protocolVersion", 1}, {"timestamp", 1},
               {"payload", portalAdjustment}});
    REQUIRE(readFrame()["success"] == true);
  }
  writeLine({{"requestId", "portal-stock"}, {"method", "inventory.getStock"},
             {"protocolVersion", 1}, {"timestamp", 1},
             {"payload", {{"productId", "p1"}, {"warehouseId", "wh-sales"}}}});
  REQUIRE(readFrame()["data"]["qty"] == 13);

  // Cash in/out belongs to a drawer session; the sales above only needed the register open.
  writeLine({{"requestId", "open-session"}, {"method", "cash.openSession"},
             {"protocolVersion", 1}, {"timestamp", 1},
             {"payload", {{"registerId", "reg-1"}, {"operatorId", "u1"}, {"openingFloatMinor", 0},
                          {"actorId", "u1"}, {"role", "manager"}}}});
  const auto opened = readFrame();
  INFO(opened.dump());
  REQUIRE(opened["success"] == true);

  const nlohmann::json portalCash = {
      {"registerId", "reg-1"}, {"amountMinor", 100}, {"reason", "test"},
      {"actorId", "u1"}, {"role", "manager"},
      {"portalCommandId", "22222222-2222-4222-8222-222222222222"}};
  for (int attempt = 0; attempt < 2; ++attempt) {
    writeLine({{"requestId", "portal-cash-" + std::to_string(attempt)},
               {"method", "cash.cashIn"}, {"protocolVersion", 1}, {"timestamp", 1},
               {"payload", portalCash}});
    const auto cashIn = readFrame();
    INFO(cashIn.dump());
    REQUIRE(cashIn["success"] == true);
  }
  writeLine({{"requestId", "portal-cash-list"}, {"method", "cash.movements"},
             {"protocolVersion", 1}, {"timestamp", 1},
             {"payload", {{"actorId", "u1"}, {"role", "manager"}}}});
  auto cashRows = readFrame();
  REQUIRE(cashRows["success"] == true);
  REQUIRE(cashRows["data"].size() == 1);

  writeLine({{"requestId", "portal-finance"}, {"method", "portal.finance"},
             {"protocolVersion", 1}, {"timestamp", 1}, {"payload", nlohmann::json::object()}});
  auto financeRows = readFrame();
  REQUIRE(financeRows["success"] == true);
  REQUIRE(financeRows["data"].contains("customers"));
  REQUIRE(financeRows["data"].contains("suppliers"));
  REQUIRE(financeRows["data"].contains("payments"));

  const nlohmann::json purchase = {
      {"id", "PO-portal-test"}, {"supplier", "Sınaq təchizatçı"},
      {"createdAt", 1000}, {"createdBy", "u1"}, {"warehouseId", "wh-sales"},
      {"status", "ordered"}, {"lines", {{{"productId", "p1"}, {"qty", 2}, {"costMinor", 100}}}}};
  for (int attempt = 0; attempt < 2; ++attempt) {
    writeLine({{"requestId", "portal-purchase-create-" + std::to_string(attempt)},
               {"method", "purchase.create"}, {"protocolVersion", 1}, {"timestamp", 1},
               {"payload", {{"order", purchase}, {"actorId", "u1"}, {"role", "manager"}}}});
    REQUIRE(readFrame()["success"] == true);
    writeLine({{"requestId", "portal-purchase-receive-" + std::to_string(attempt)},
               {"method", "purchase.receive"}, {"protocolVersion", 1}, {"timestamp", 1},
               {"payload", {{"id", "PO-portal-test"}, {"actorId", "u1"}, {"role", "manager"},
                            {"portalCommandId", "33333333-3333-4333-8333-333333333333"}}}});
    REQUIRE(readFrame()["success"] == true);
  }
  writeLine({{"requestId", "portal-stock-after-purchase"}, {"method", "inventory.getStock"},
             {"protocolVersion", 1}, {"timestamp", 1},
             {"payload", {{"productId", "p1"}, {"warehouseId", "wh-sales"}}}});
  REQUIRE(readFrame()["data"]["qty"] == 15);
  writeLine({{"requestId", "portal-finance-after-purchase"}, {"method", "portal.finance"},
             {"protocolVersion", 1}, {"timestamp", 1}, {"payload", nlohmann::json::object()}});
  auto afterPurchase = readFrame();
  REQUIRE(afterPurchase["success"] == true);
  REQUIRE(afterPurchase["data"]["suppliers"][0]["dueMinor"] == 200);
  const nlohmann::json supplierPayment = {
      {"supplierName", "Sınaq təchizatçı"}, {"amountMinor", 100},
      {"actorId", "u1"}, {"role", "manager"}, {"portalCommandId", "44444444-4444-4444-8444-444444444444"}};
  for (int attempt = 0; attempt < 2; ++attempt) {
    writeLine({{"requestId", "portal-supplier-pay-" + std::to_string(attempt)},
               {"method", "supplier.pay"}, {"protocolVersion", 1}, {"timestamp", 1},
               {"payload", supplierPayment}});
    REQUIRE(readFrame()["success"] == true);
  }
  writeLine({{"requestId", "portal-finance-after-payment"}, {"method", "portal.finance"},
             {"protocolVersion", 1}, {"timestamp", 1}, {"payload", nlohmann::json::object()}});
  auto afterPayment = readFrame();
  REQUIRE(afterPayment["success"] == true);
  REQUIRE(afterPayment["data"]["suppliers"][0]["dueMinor"] == 100);
  REQUIRE(afterPayment["data"]["payments"].size() == 1);

  // closed register rejection
  writeLine({{"requestId", "8"},
             {"method", "cash.closeSession"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"registerId", "reg-1"}, {"operatorId", "u1"}, {"actorId", "u1"}, {"role", "manager"}}}});
  const auto closedSession = readFrame();
  INFO(closedSession.dump());
  REQUIRE(closedSession["success"] == true);
  writeLine({{"requestId", "9"},
             {"method", "sale.complete"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"cashierId", "u1"},
               {"registerId", "reg-1"},
               {"warehouseId", "wh-sales"},
               {"items", {{{"productId", "p1"}, {"qty", 1}}}},
               {"payment", {{"method", "cash"}, {"tenderedMinor", 100}}}}}});
  auto closed = readFrame();
  REQUIRE(closed["success"] == false);
  REQUIRE(closed["error"]["code"] == "REGISTER_CLOSED");

  close(inPipe[1]);
  int status = 0;
  waitpid(pid, &status, 0);
  REQUIRE(WIFEXITED(status));
  REQUIRE(WEXITSTATUS(status) == 0);
  close(outPipe[0]);
}

TEST_CASE("phase1: hold permissions cash xz", "[ipc][phase1]") {
  auto dir = tempDbDir();
  auto dbPath = dir / "topdan.db";
  auto logDir = dir / "logs";
  fs::create_directories(logDir);
  int inPipe[2];
  int outPipe[2];
  REQUIRE(pipe(inPipe) == 0);
  REQUIRE(pipe(outPipe) == 0);
  pid_t pid = fork();
  REQUIRE(pid >= 0);
  if (pid == 0) {
    dup2(inPipe[0], STDIN_FILENO);
    dup2(outPipe[1], STDOUT_FILENO);
    close(inPipe[0]);
    close(inPipe[1]);
    close(outPipe[0]);
    close(outPipe[1]);
    const auto bin = coreBinary().string();
    execl(bin.c_str(), bin.c_str(), "--db", dbPath.string().c_str(), "--log-dir", logDir.string().c_str(),
          "--log-level", "error", "--protocol", "1", static_cast<char*>(nullptr));
    _exit(127);
  }
  close(inPipe[0]);
  close(outPipe[1]);
  auto writeLine = [&](const nlohmann::json& j) {
    const auto line = j.dump() + "\n";
    REQUIRE(write(inPipe[1], line.data(), line.size()) == static_cast<ssize_t>(line.size()));
  };
  auto readRawFrame = [&]() {
    std::string buf;
    char c;
    while (true) {
      REQUIRE(read(outPipe[0], &c, 1) == 1);
      if (c == '\n') break;
      buf.push_back(c);
    }
    return nlohmann::json::parse(buf);
  };
  // Responses are interleaved with `state.changed`; skip events as the real
  // client does.
  auto readFrame = [&]() {
    while (true) {
      auto frame = readRawFrame();
      if (frame.value("type", std::string{}) != "event") return frame;
    }
  };
  readRawFrame();  // core.stage
  readRawFrame();  // core.ready

  nlohmann::json snap = {
      {"warehouses",
       {{{"id", "wh-sales"}, {"code", "ZAL"}, {"name", "Sales"}, {"address", ""}, {"manager", ""}, {"active", true}}}},
      {"registers",
       {{{"id", "reg-1"},
         {"code", "K1"},
         {"name", "Kassa"},
         {"location", ""},
         {"status", "closed"},
         {"openingFloatMinor", 0}}}},
      {"products",
       {{{"id", "p1"},
         {"sku", "SKU1"},
         {"barcode", "4769901000001"},
         {"name", {{"az", "Test"}, {"ru", "Test"}, {"en", "Test"}}},
         {"category", "Cat"},
         {"unit", "əd"},
         {"priceMinor", 100},
         {"costMinor", 50},
         {"minStock", 1},
         {"taxRate", 18},
         {"supplier", "S"},
         {"warehouseStock", {{"wh-sales", 20}}},
         {"accent", "#000"},
         {"image", {{"kind", "sprite"}, {"index", 0}}},
         {"active", true},
         {"createdAt", 1}}}},
      {"settings", {{"defaultWarehouseId", "wh-sales"}, {"defaultRegisterId", "reg-1"}}},
  };
  writeLine({{"requestId", "imp"}, {"method", "state.importLegacy"}, {"protocolVersion", 1}, {"timestamp", 1},
             {"payload", {{"snapshot", snap}, {"role", "manager"}, {"actorId", "u1"}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "open"},
             {"method", "cash.openSession"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"registerId", "reg-1"}, {"operatorId", "u1"}, {"openingFloatMinor", 5000}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "perm"},
             {"method", "auth.checkPermission"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"role", "cashier"}, {"permission", "PRICE_OVERRIDE"}}}});
  auto perm = readFrame();
  REQUIRE(perm["success"] == true);
  REQUIRE(perm["data"]["allowed"] == false);

  writeLine({{"requestId", "hold"},
             {"method", "sale.hold"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"lines", {{{"productId", "p1"}, {"qty", 1}}}},
               {"label", "T1"},
               {"cashierId", "u1"},
               {"registerId", "reg-1"}}}});
  auto held = readFrame();
  REQUIRE(held["success"] == true);
  const std::string holdId = held["data"]["id"].get<std::string>();

  writeLine({{"requestId", "listH"},
             {"method", "sale.listHeld"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", nlohmann::json::object()}});
  REQUIRE(readFrame()["data"].size() >= 1);

  writeLine({{"requestId", "resume"},
             {"method", "sale.resume"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"id", holdId}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "cin"},
             {"method", "cash.cashIn"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"registerId", "reg-1"},
               {"amountMinor", 1000},
               {"reason", "float"},
               {"actorId", "u1"},
               {"role", "manager"}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "sale"},
             {"method", "sale.complete"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"cashierId", "u1"},
               {"registerId", "reg-1"},
               {"warehouseId", "wh-sales"},
               {"items", {{{"productId", "p1"}, {"qty", 1}}}},
               {"payment", {{"method", "cash"}, {"tenderedMinor", 100}, {"cashMinor", 100}}}}}});
  REQUIRE(readFrame()["success"] == true);

  writeLine({{"requestId", "x"},
             {"method", "cash.xReport"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"registerId", "reg-1"}}}});
  auto x = readFrame();
  REQUIRE(x["success"] == true);
  REQUIRE(x["data"]["expectedCashMinor"].get<std::int64_t>() == 5000 + 1000 + 100);

  // A PARTIAL refund has to move the drawer too. It never sets sales.refunded
  // (only a full return does), so while expected cash was derived from that
  // flag the cash went out with no effect on the session and Z showed a
  // shortage that nothing explained. Sell 2, return 1, expect -100.
  writeLine({{"requestId", "sale2"},
             {"method", "sale.complete"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"cashierId", "u1"},
               {"registerId", "reg-1"},
               {"warehouseId", "wh-sales"},
               {"items", {{{"productId", "p1"}, {"qty", 2}}}},
               {"payment", {{"method", "cash"}, {"tenderedMinor", 200}, {"cashMinor", 200}}}}}});
  auto sale2 = readFrame();
  REQUIRE(sale2["success"] == true);
  const std::string sale2Id = sale2["data"]["id"].get<std::string>();
  const auto sale2ItemId = sale2["data"]["items"][0]["saleItemId"].get<std::int64_t>();
  // Receipt numbers carry the register code. Without it every till numbered
  // from its own COUNT(*) and two tills issued the same M-<day>-0001, because
  // sales are never replicated between them.
  REQUIRE(sale2["data"]["receiptNo"].get<std::string>().rfind("M-K1-", 0) == 0);

  writeLine({{"requestId", "x2"},
             {"method", "cash.xReport"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"registerId", "reg-1"}}}});
  auto x2 = readFrame();
  REQUIRE(x2["data"]["expectedCashMinor"].get<std::int64_t>() == 5000 + 1000 + 100 + 200);

  writeLine({{"requestId", "partial"},
             {"method", "return.partial"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"saleId", sale2Id},
               {"actorId", "u1"},
               {"role", "manager"},
               {"lines", {{{"saleItemId", sale2ItemId}, {"qty", 1}}}}}}});
  auto partial = readFrame();
  REQUIRE(partial["success"] == true);
  REQUIRE(partial["data"]["amountMinor"].get<std::int64_t>() == 100);

  writeLine({{"requestId", "x3"},
             {"method", "cash.xReport"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"registerId", "reg-1"}}}});
  auto x3 = readFrame();
  REQUIRE(x3["success"] == true);
  REQUIRE(x3["data"]["expectedCashMinor"].get<std::int64_t>() == 5000 + 1000 + 100 + 200 - 100);

  // Bonus card: 1% of the purchase has to land on the customer's balance.
  // Migration 008 ships loyaltyRateBps = 100 (1%); before it the seed was 0, so
  // a fresh till earned nothing no matter what the admin panel showed.
  writeLine({{"requestId", "cust"},
             {"method", "customer.create"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"name", "Bonus Müştəri"},
               {"loyaltyCard", "9001234567"},
               {"actorId", "u1"},
               {"role", "manager"}}}});
  auto cust = readFrame();
  REQUIRE(cust["success"] == true);
  const std::string customerId = cust["data"].contains("id")
                                     ? cust["data"]["id"].get<std::string>()
                                     : cust["data"]["customerId"].get<std::string>();

  writeLine({{"requestId", "rate"},
             {"method", "loyalty.config"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", nlohmann::json::object()}});
  auto rate = readFrame();
  REQUIRE(rate["success"] == true);
  REQUIRE(rate["data"]["rateBps"].get<std::int64_t>() == 100);
  REQUIRE(rate["data"]["enabled"] == true);

  // 7 x 100 qəpik = 7.00 AZN; 1% = 7 qəpik.
  writeLine({{"requestId", "bonusSale"},
             {"method", "sale.complete"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"cashierId", "u1"},
               {"registerId", "reg-1"},
               {"warehouseId", "wh-sales"},
               {"customerId", customerId},
               {"items", {{{"productId", "p1"}, {"qty", 7}}}},
               {"payment", {{"method", "cash"}, {"tenderedMinor", 700}, {"cashMinor", 700}}}}}});
  auto bonusSale = readFrame();
  REQUIRE(bonusSale["success"] == true);
  REQUIRE(bonusSale["data"]["loyaltyEarnedMinor"].get<std::int64_t>() == 7);
  const std::string bonusSaleId = bonusSale["data"]["id"].get<std::string>();

  // The balance must be readable back through the same projection the till uses.
  writeLine({{"requestId", "sum"},
             {"method", "customer.summary"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", nlohmann::json::object()}});
  auto sum = readFrame();
  REQUIRE(sum["success"] == true);
  bool foundCustomer = false;
  for (const auto& row : sum["data"]) {
    if (row["id"].get<std::string>() == customerId) {
      foundCustomer = true;
      REQUIRE(row["loyaltyMinor"].get<std::int64_t>() == 7);
      // camelCase alias, not the raw loyalty_card column: the till's customer
      // lookup and card scan both read this field.
      REQUIRE(row["loyaltyCard"].get<std::string>() == "9001234567");
    }
  }
  REQUIRE(foundCustomer);

  // And the receipt has to show it, or the customer has no proof of the bonus.
  // Assigning a card to an existing customer must not wipe the rest of the row:
  // every omitted field used to be written as ''/0, so this edit erased the name.
  writeLine({{"requestId", "cardAssign"},
             {"method", "customer.update"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"id", customerId}, {"loyaltyCard", "  7005550001  "}, {"actorId", "u1"}}}});
  auto assigned = readFrame();
  INFO("customer.update response: " << assigned.dump());
  REQUIRE(assigned["success"] == true);
  REQUIRE(assigned["data"]["name"].get<std::string>() == "Bonus Müştəri");
  // Trimmed, because a wedge scanner and a pasted list both bring whitespace.
  REQUIRE(assigned["data"]["loyaltyCard"].get<std::string>() == "7005550001");
  // The balance survives the edit too.
  REQUIRE(assigned["data"]["loyaltyMinor"].get<std::int64_t>() == 7);

  // A card identifies exactly one customer, or a scan is ambiguous.
  writeLine({{"requestId", "cust2"},
             {"method", "customer.create"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"name", "İkinci"}, {"actorId", "u1"}}}});
  auto cust2 = readFrame();
  REQUIRE(cust2["success"] == true);
  const std::string customer2Id = cust2["data"].contains("id")
                                      ? cust2["data"]["id"].get<std::string>()
                                      : cust2["data"]["customerId"].get<std::string>();
  writeLine({{"requestId", "dupCard"},
             {"method", "customer.update"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"id", customer2Id}, {"loyaltyCard", "7005550001"}, {"actorId", "u1"}}}});
  auto dupCard = readFrame();
  REQUIRE(dupCard["success"] == false);

  writeLine({{"requestId", "rcpt"},
             {"method", "sale.receipt"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"saleId", bonusSaleId}}}});

  auto rcpt = readFrame();
  INFO("sale.receipt response: " << rcpt.dump());
  REQUIRE(rcpt["success"] == true);
  // No storeName setting: the receipt header is the plain default, not a JSON-quoted one.
  REQUIRE(rcpt["data"]["storeName"] == "Topdan");
  REQUIRE(rcpt["data"]["loyaltyEarnedMinor"].get<std::int64_t>() == 7);
  REQUIRE(rcpt["data"]["loyaltyBalanceMinor"].get<std::int64_t>() == 7);

  writeLine({{"requestId", "z"},
             {"method", "cash.zClose"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"registerId", "reg-1"},
               // Matches the expected total above: float + cashIn + all three
               // cash sales minus the partial refund, so a balanced drawer
               // still reads 0.
               {"actualCashMinor", 5000 + 1000 + 100 + 200 - 100 + 700},
               {"actorId", "u1"},
               {"role", "manager"}}}});
  auto z = readFrame();
  REQUIRE(z["success"] == true);
  REQUIRE(z["data"]["differenceMinor"] == 0);

  writeLine({{"requestId", "deact"},
             {"method", "sync.apply"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload",
              {{"events",
                {{{"eventId", "srv-deact-1"},
                  {"originDeviceId", "00000000-0000-4000-a000-000000000001"},
                  {"originSeq", 1},
                  {"kind", "product.upsert"},
                  {"createdAt", 2000000000000},
                  {"payload",
                   {{"logicalAt", 2000000000000},
                    {"product",
                     {{"id", "p1"},
                      {"sku", "SKU1"},
                      {"barcode", "4769901000001"},
                      {"name", "Test"},
                      {"priceMinor", 100.0},
                      {"active", false}}}}}}}}}}});
  auto deact = readFrame();
  INFO(deact.dump());
  REQUIRE(deact["success"] == true);
  REQUIRE(deact["data"].value("rejected", 0) == 0);

  writeLine({{"requestId", "plist"},
             {"method", "product.list"},
             {"protocolVersion", 1},
             {"timestamp", 1},
             {"payload", {{"activeOnly", true}}}});
  auto plist = readFrame();
  REQUIRE(plist["success"] == true);
  REQUIRE(plist["data"].size() == 0);

  close(inPipe[1]);
  int status = 0;
  waitpid(pid, &status, 0);
  close(outPipe[0]);
}
#endif
