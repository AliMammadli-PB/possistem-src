#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"

TEST_CASE("prepare does not share an in-use statement", "[db][cache]") {
    ServiceFixture fixture;

    // Same SQL text, two live wrappers — the historical bug reused one
    // sqlite3_stmt* so the second bind/exec overwrote the first.
    auto first = fixture.db().prepare(
        "UPDATE restaurant_tables SET updated_at = :now WHERE id = :id");
    auto second = fixture.db().prepare(
        "UPDATE restaurant_tables SET updated_at = :now WHERE id = :id");

    first.bind(":now", static_cast<std::int64_t>(111)).bind(":id", "tbl-01");
    second.bind(":now", static_cast<std::int64_t>(222)).bind(":id", "tbl-02");
    first.exec();
    second.exec();

    auto a = fixture.db().prepare("SELECT updated_at FROM restaurant_tables WHERE id = 'tbl-01'");
    auto b = fixture.db().prepare("SELECT updated_at FROM restaurant_tables WHERE id = 'tbl-02'");
    REQUIRE(a.step());
    REQUIRE(b.step());
    REQUIRE(a.columnInt(0) == 111);
    REQUIRE(b.columnInt(0) == 222);
}
