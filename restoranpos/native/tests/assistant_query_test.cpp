#include "ServiceFixture.hpp"
#include "pos/Error.hpp"
#include "pos/services/AssistantQuery.hpp"

#include <string>

namespace {
std::string refusal(ServiceFixture& f, const std::string& sql) {
    try { pos::services::runAssistantQuery(f.db().path(), sql); } catch (const pos::PosError& e) { return e.message(); }
    return "";
}
}  // namespace

TEST_CASE("the assistant reads business data on a read-only connection", "[assistant_query]") {
    ServiceFixture f;
    const auto out = pos::services::runAssistantQuery(f.db().path(), "SELECT id, full_name FROM users ORDER BY id");
    REQUIRE(out.at("columns") == pos::Json::array({"id", "full_name"}));
    REQUIRE(!out.at("rows").empty());
    REQUIRE(out.at("truncated") == false);
    const auto counted = pos::services::runAssistantQuery(f.db().path(), "WITH t AS (SELECT count(*) AS n FROM orders) SELECT n FROM t;");
    REQUIRE(counted.at("rows").at(0).at(0) == 0);
}

TEST_CASE("the assistant can never write, read secrets or leave the allowed tables", "[assistant_query]") {
    ServiceFixture f;
    REQUIRE(refusal(f, "SELECT pin_hash FROM users").find("users.pin_hash") != std::string::npos);
    REQUIRE(refusal(f, "SELECT * FROM users").find("users.pin_hash") != std::string::npos);
    REQUIRE(refusal(f, "SELECT card_last4 FROM payments") != "");
    REQUIRE(refusal(f, "SELECT * FROM app_settings").find("app_settings") != std::string::npos);
    REQUIRE(refusal(f, "SELECT name FROM sqlite_master") != "");
    REQUIRE(refusal(f, "WITH u AS (SELECT pin_hash AS full_name FROM users) SELECT full_name FROM u").find("users.pin_hash") != std::string::npos);
    REQUIRE(refusal(f, "WITH users AS (SELECT pin_hash AS full_name FROM users) SELECT full_name FROM users") != "");
    REQUIRE(refusal(f, "DELETE FROM orders") != "");
    REQUIRE(refusal(f, "WITH x AS (SELECT 1) DELETE FROM orders") != "");
    REQUIRE(refusal(f, "SELECT 1; DELETE FROM orders") != "");
    REQUIRE(refusal(f, "SELECT load_extension('evil')") != "");
    REQUIRE(refusal(f, "ATTACH DATABASE 'x.db' AS x") != "");
    REQUIRE(refusal(f, "PRAGMA table_info(users)") != "");
    auto users = f.db().prepare("SELECT count(*) FROM users");
    REQUIRE(users.step());
    REQUIRE(users.columnInt(0) > 0);
}

TEST_CASE("the assistant's queries stop at 200 rows and about two seconds", "[assistant_query]") {
    ServiceFixture f;
    const auto many = pos::services::runAssistantQuery(
        f.db().path(), "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT x FROM c");
    REQUIRE(many.at("rows").size() == 200);
    REQUIRE(many.at("truncated") == true);
    const auto slow = refusal(f, "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c");
    INFO(slow);
    REQUIRE(slow.find("uzun") != std::string::npos);
}
