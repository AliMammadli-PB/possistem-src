#include "catch_amalgamated.hpp"
#include "market/Logging.hpp"
#include "market/db/Database.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <string>

namespace fs = std::filesystem;

namespace {

/** A directory no other test in this process can be handed. */
inline std::filesystem::path uniqueTestDir(const char* prefix) {
  static std::atomic<unsigned long long> sequence{0};
  const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
  auto dir = std::filesystem::temp_directory_path() /
             (std::string(prefix) + "-" + std::to_string(tick) + "-" +
              std::to_string(sequence.fetch_add(1)));
  std::filesystem::create_directories(dir);
  return dir;
}

}  // namespace


/**
 * Roles an operator creates, and the permissions granted to them.
 *
 * Roles used to be three names baked into the seed, and a grant could only be
 * changed by editing SQL — so "let this cashier refund" had no answer inside
 * the product.
 */
namespace {

struct RoleDb {
  RoleDb() {
    dir = uniqueTestDir("market-role-test");
    market::logging::init((dir / "logs").string(), "error");
    db.open((dir / "market.db").string());
    market::db::Migrator(db).migrate();
  }
  ~RoleDb() {
    db.close();
    market::logging::shutdown();
  }

  bool roleHas(const std::string& role, const std::string& permission) {
    return db.queryInt("SELECT COUNT(*) FROM role_permissions WHERE role = ? AND permission = ?",
                       {role, permission}, {}) > 0;
  }

  fs::path dir;
  market::db::Database db;
};

}  // namespace

TEST_CASE("the permission catalogue describes every key in words", "[roles]") {
  RoleDb t;

  // A screen that shows SALE_REFUND teaches nobody anything.
  REQUIRE(t.db.queryInt("SELECT COUNT(*) FROM permission_catalogue") >= 20);
  REQUIRE(t.db.queryText("SELECT label FROM permission_catalogue WHERE permission = 'SALE_REFUND'")
          == "Geri qaytarma");
  REQUIRE(t.db.queryText("SELECT grp FROM permission_catalogue WHERE permission = 'CASH_IN'")
          == "kassa");
}

TEST_CASE("the shipped roles exist and are not deletable custom rows", "[roles]") {
  RoleDb t;

  REQUIRE(t.db.queryInt("SELECT COUNT(*) FROM roles WHERE custom = 0") == 3);
  REQUIRE(t.db.queryText("SELECT label FROM roles WHERE role = 'manager'") == "Müdir");
}

TEST_CASE("the manager holds every permission there is", "[roles]") {
  RoleDb t;

  // Without this, granting a right the manager lacked would leave nobody able
  // to take it back.
  const auto missing = t.db.queryInt(
      "SELECT COUNT(*) FROM permission_catalogue c "
      "WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp "
      "                  WHERE rp.role = 'manager' AND rp.permission = c.permission)");
  REQUIRE(missing == 0);
}

TEST_CASE("a cashier is not quietly given manager rights", "[roles]") {
  RoleDb t;

  REQUIRE_FALSE(t.roleHas("cashier", "SALE_REFUND"));
  REQUIRE_FALSE(t.roleHas("cashier", "PRICE_OVERRIDE"));
  REQUIRE_FALSE(t.roleHas("cashier", "MANAGE_ROLES"));
  // ...but keeps what a till actually needs.
  REQUIRE(t.roleHas("cashier", "OPEN_DRAWER"));
}

TEST_CASE("the new modules bring their own permission keys", "[roles][modules]") {
    RoleDb t;

    // A key that governs nothing is a switch that lies, so each of these has a
    // handler behind it.
    for (const char* key : {"DELIVERY_VIEW", "DELIVERY_MANAGE", "DELIVERY_ASSIGN",
                            "EDIT_RECIPE", "SCHEDULE_VIEW", "SCHEDULE_MANAGE",
                            "SCHEDULE_CLOCK"}) {
        REQUIRE(t.db.queryInt("SELECT COUNT(*) FROM permission_catalogue WHERE permission = ?",
                              {key}, {}) == 1);
    }

    // The manager still holds everything, including the keys just added.
    REQUIRE(t.db.queryInt(
                "SELECT COUNT(*) FROM permission_catalogue c "
                "WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp "
                "                  WHERE rp.role = 'manager' AND rp.permission = c.permission)")
            == 0);

    // A cashier can take a delivery out but not rewrite a recipe.
    REQUIRE(t.roleHas("cashier", "DELIVERY_ASSIGN"));
    REQUIRE_FALSE(t.roleHas("cashier", "EDIT_RECIPE"));
}

TEST_CASE("one sale is one delivery", "[modules][delivery]") {
    RoleDb t;

    // UNIQUE on sale_id is what stops a double tap putting the same basket on
    // two couriers' lists.
    t.db.exec(
        "INSERT INTO delivery_orders(id, sale_id, address, created_at, updated_at) "
        "VALUES ('d1','sale-1','Ünvan',0,0)");
    REQUIRE_THROWS(t.db.exec(
        "INSERT INTO delivery_orders(id, sale_id, address, created_at, updated_at) "
        "VALUES ('d2','sale-1','Başqa ünvan',0,0)"));
}

TEST_CASE("a recipe cannot contain itself", "[modules][recipe]") {
    RoleDb t;
    REQUIRE_THROWS(t.db.exec(
        "INSERT INTO product_recipes(product_id, component_id, qty_milli) "
        "VALUES ('p-1','p-1',100)"));
}

TEST_CASE("only one attendance punch can be open per person", "[modules][roster]") {
    RoleDb t;
    t.db.exec("INSERT INTO attendance(id, user_id, clock_in_at, created_at) "
              "VALUES ('a1','u-1',1000,1000)");
    // Clocking in twice is a mistake, not a second shift.
    REQUIRE_THROWS(t.db.exec("INSERT INTO attendance(id, user_id, clock_in_at, created_at) "
                             "VALUES ('a2','u-1',2000,2000)"));

    t.db.exec("UPDATE attendance SET clock_out_at = 5000 WHERE id = 'a1'");
    t.db.exec("INSERT INTO attendance(id, user_id, clock_in_at, created_at) "
              "VALUES ('a2','u-1',6000,6000)");
}

TEST_CASE("clocking out in the same millisecond is allowed", "[modules][roster]") {
    RoleDb t;
    // Someone clocks in and immediately realises their mistake; the app should
    // record it rather than throw an error they can do nothing about.
    t.db.exec("INSERT INTO attendance(id, user_id, clock_in_at, clock_out_at, created_at) "
              "VALUES ('a1','u-1',1000,1000,1000)");
    REQUIRE(t.db.queryInt("SELECT COUNT(*) FROM attendance") == 1);
}
