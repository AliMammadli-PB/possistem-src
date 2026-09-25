#include "catch_amalgamated.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include "market/RetailOps.hpp"
#include "market/db/Database.hpp"
#include "market/ipc/StdioServer.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;

/**
 * The role policy the shop sets on the website, applied to this till.
 *
 * Until now everything the admin panel and the customer portal could say about
 * market staff stopped at the server: the till never asked. These cases cover
 * the half that runs here - who is allowed to apply a policy, what happens when
 * the same one arrives again, and what the policy is not allowed to do.
 */
namespace {

struct PolicyDb {
  PolicyDb() {
    static std::atomic<unsigned long long> sequence{0};
    const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
    dir = fs::temp_directory_path() /
          ("market-policy-test-" + std::to_string(tick) + "-" +
           std::to_string(sequence.fetch_add(1)));
    fs::create_directories(dir);
    market::logging::init((dir / "logs").string(), "error");
    db.open((dir / "market.db").string());
    market::db::Migrator(db).migrate();
    market::registerRetailHandlers(server, db);
  }
  ~PolicyDb() {
    db.close();
    market::logging::shutdown();
  }

  nlohmann::json apply(const nlohmann::json& payload) {
    return server.dispatch("roles.applyPolicy", payload);
  }

  bool roleHas(const std::string& role, const std::string& permission) {
    return db.queryInt("SELECT COUNT(*) FROM role_permissions WHERE role = ? AND permission = ?",
                       {role, permission}, {}) > 0;
  }

  fs::path dir;
  market::db::Database db;
  market::ipc::StdioServer server;
};

nlohmann::json policy(int version, const nlohmann::json& roles) {
  return nlohmann::json{{"policySource", "control-plane"}, {"version", version}, {"roles", roles}};
}

}  // namespace

TEST_CASE("the renderer cannot apply a role policy", "[roles][policy]") {
  PolicyDb t;

  // `policySource` is stripped from every payload the renderer sends (see
  // electron/core-payload.cjs), so its absence is what marks a call as coming
  // from the window rather than from the control plane. Without this check any
  // script in the window could rewrite every grant in the shop.
  nlohmann::json fromRenderer = {
      {"version", 1},
      {"roles", nlohmann::json::array({{{"name", "cashier"}, {"permissions", {"SALE_REFUND"}}}})}};
  REQUIRE_THROWS_AS(t.apply(fromRenderer), market::PosError);
  REQUIRE_FALSE(t.roleHas("cashier", "SALE_REFUND"));

  // Nor by naming itself the control plane in a field it does not control -
  // there is no such field; the only way in is main having stripped it first.
  fromRenderer["policySource"] = "renderer";
  REQUIRE_THROWS_AS(t.apply(fromRenderer), market::PosError);
}

TEST_CASE("a policy grants and revokes exactly what it lists", "[roles][policy]") {
  PolicyDb t;

  t.apply(policy(4, nlohmann::json::array({
                        {{"name", "cashier"}, {"permissions", {"SALE_REFUND", "OPEN_DRAWER"}}},
                    })));
  REQUIRE(t.roleHas("cashier", "SALE_REFUND"));
  REQUIRE(t.roleHas("cashier", "OPEN_DRAWER"));

  // The site sends the whole set for a role, so an unchecked box has to revoke.
  // Diffing instead would make "take this away" impossible to express.
  t.apply(policy(5, nlohmann::json::array({
                        {{"name", "cashier"}, {"permissions", {"OPEN_DRAWER"}}},
                    })));
  REQUIRE_FALSE(t.roleHas("cashier", "SALE_REFUND"));
  REQUIRE(t.roleHas("cashier", "OPEN_DRAWER"));

  // A role the policy does not mention is left alone: the site may be editing
  // one role while the till is mid-shift with the others.
  REQUIRE(t.roleHas("warehouse", "EDIT_STOCK"));
}

TEST_CASE("the same policy arriving again changes nothing", "[roles][policy]") {
  PolicyDb t;

  const auto first = t.apply(policy(7, nlohmann::json::array({
                                           {{"name", "cashier"}, {"permissions", {"SALE_REFUND"}}},
                                       })));
  REQUIRE(first.value("changed", false));

  // This runs on every heartbeat. An unchanged policy must cost one settings
  // read, not a full rewrite of every grant in the shop.
  const auto again = t.apply(policy(7, nlohmann::json::array({
                                           {{"name", "cashier"}, {"permissions", {"SALE_REFUND"}}},
                                       })));
  REQUIRE_FALSE(again.value("changed", true));
  REQUIRE(t.roleHas("cashier", "SALE_REFUND"));

  // A lower version is still applied: the server's number went backwards
  // because someone rolled the policy back, which is what a rollback is for.
  const auto rolledBack = t.apply(policy(6, nlohmann::json::array({
                                              {{"name", "cashier"}, {"permissions", nlohmann::json::array()}},
                                          })));
  REQUIRE(rolledBack.value("changed", false));
  REQUIRE_FALSE(t.roleHas("cashier", "SALE_REFUND"));
}

TEST_CASE("a policy cannot lock the shop out of its own till", "[roles][policy]") {
  PolicyDb t;

  t.apply(policy(2, nlohmann::json::array({
                        {{"name", "manager"}, {"permissions", nlohmann::json::array()}},
                    })));

  // The website is further away than the till. A manager stripped of role
  // management could not undo the mistake that stripped them.
  const auto missing = t.db.queryInt(
      "SELECT COUNT(*) FROM permission_catalogue c "
      "WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp "
      "                  WHERE rp.role = 'manager' AND rp.permission = c.permission)");
  REQUIRE(missing == 0);
}

TEST_CASE("a permission this build has never heard of is dropped", "[roles][policy]") {
  PolicyDb t;

  // The server's catalogue can run ahead of an old till. Storing an unknown key
  // would leave a grant nothing ever checks, which reads as "granted" on the
  // website and does nothing here.
  t.apply(policy(3, nlohmann::json::array({
                        {{"name", "cashier"}, {"permissions", {"SALE_REFUND", "TIME_TRAVEL"}}},
                    })));
  REQUIRE(t.roleHas("cashier", "SALE_REFUND"));
  REQUIRE(t.db.queryInt("SELECT COUNT(*) FROM role_permissions WHERE permission = 'TIME_TRAVEL'")
          == 0);
}

TEST_CASE("a malformed policy is refused rather than half-applied", "[roles][policy]") {
  PolicyDb t;

  REQUIRE_THROWS_AS(t.apply(nlohmann::json{{"policySource", "control-plane"}, {"version", 0}}),
                    market::PosError);
  REQUIRE_THROWS_AS(t.apply(nlohmann::json{{"policySource", "control-plane"}, {"version", 3}}),
                    market::PosError);
}
