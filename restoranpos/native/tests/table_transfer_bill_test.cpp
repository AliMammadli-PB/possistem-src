#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"


/**
 * A bill that moves to another table must not follow the one it left.
 *
 * Reported from the floor: move table 1's bill to table 2, table 1 correctly
 * goes free, but anything added to table 1 afterwards appeared on table 2's
 * bill. The till was reusing the create key that had already produced the moved
 * order, and the core replayed that order straight back.
 */
namespace {

class TransferFixture {
public:
    TransferFixture() {
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerTables(fixture_.contextPtr());
    }

    pos::Json call(std::string_view method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(method);
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** Moves a whole bill from one table to another, as the floor screen does. */
    void moveBill(const char* from, const char* to) {
        call(pos::protocol::method::kTablesTransfer,
             pos::Json{{"fromTableId", from}, {"toTableId", to}});
    }

    /** Mirrors the till: one key per table, held until something clears it. */
    pos::Json createOn(const std::string& tableId, const std::string& key) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(pos::protocol::method::kOrdersCreate);
        request.payload = pos::Json{{"tableId", tableId}, {"guestCount", 2}};
        request.idempotencyKey = key;
        return fixture_.server().callHandler(request);
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("reopening a table whose bill moved away does not hand back the moved bill",
          "[tables][transfer][money]") {
    TransferFixture f;
    const std::string key = pos::crypto::uuid4();

    const auto first = f.createOn("tbl-01", key);
    const auto orderId = first.at("id").get<std::string>();
    REQUIRE(first.at("tableId") == "tbl-01");

    // The bill moves to table 2; table 1 goes free.
    f.moveBill("tbl-01", "tbl-02");

    auto moved = f.fixture().db().prepare("SELECT table_id FROM orders WHERE id = :id");
    moved.bind(":id", orderId);
    REQUIRE(moved.step());
    REQUIRE(moved.columnText(0) == "tbl-02");

    // The till reopens table 1 still holding the old key. Replaying it would
    // return the order that now lives on table 2, and every item added next
    // would land on that bill.
    REQUIRE_THROWS_AS(f.createOn("tbl-01", key), pos::PosError);
}

TEST_CASE("a fresh key opens a genuinely new bill on the emptied table",
          "[tables][transfer][money]") {
    TransferFixture f;

    const auto first = f.createOn("tbl-01", pos::crypto::uuid4());
    const auto movedId = first.at("id").get<std::string>();
    f.moveBill("tbl-01", "tbl-02");

    // Which is what the till now does: the key is retired once a bill exists.
    const auto second = f.createOn("tbl-01", pos::crypto::uuid4());
    REQUIRE(second.at("id") != movedId);
    REQUIRE(second.at("tableId") == "tbl-01");

    // Two separate bills: the moved one on table 2, the new one on table 1.
    auto count = f.fixture().db().prepare(
        "SELECT COUNT(*) FROM orders WHERE status IN ('draft','open','sent','partially_paid')");
    count.step();
    REQUIRE(count.columnInt(0) == 2);
}

TEST_CASE("replaying a create key still works while the bill has not moved",
          "[tables][transfer]") {
    TransferFixture f;
    const std::string key = pos::crypto::uuid4();

    const auto first = f.createOn("tbl-05", key);
    // A retry after a slow reply must not open a second bill on the table -
    // which is the whole reason the key exists.
    const auto retry = f.createOn("tbl-05", key);
    REQUIRE(retry.at("id") == first.at("id"));
}
