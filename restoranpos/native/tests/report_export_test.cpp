#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"

/** Reports as CSV, which is what a spreadsheet opens without extra software. */
namespace {

class ExportFixture {
public:
    ExportFixture() { pos::handlers::registerExport(fixture_.contextPtr()); }

    pos::Json exportKind(const char* kind) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(pos::protocol::method::kReportsExport);
        request.payload = pos::Json{{"kind", kind}};
        return fixture_.server().callHandler(request);
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("every offered report produces a file with a header", "[export]") {
    ExportFixture f;
    for (const char* kind : {"sales", "products", "payments", "refunds", "stock", "waste",
                             "purchases", "attendance"}) {
        const auto result = f.exportKind(kind);
        const auto csv = result.at("csv").get<std::string>();
        // An empty result still needs its header, or the file looks broken
        // rather than simply empty.
        REQUIRE_FALSE(csv.empty());
        REQUIRE(csv.find("\r\n") != std::string::npos);
    }
}

TEST_CASE("an unknown report is refused rather than guessed at", "[export]") {
    ExportFixture f;
    REQUIRE_THROWS_AS(f.exportKind("hər-şey"), pos::PosError);
}

TEST_CASE("a name with a comma or a quote cannot shift the columns", "[export]") {
    ExportFixture f;

    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = f.fixture().db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
        "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
        "  opened_at, updated_at, row_version) "
        "VALUES (:id, 'EXP-1', 'usr-admin', 'closed', 1, 0,0,0,0, 1000, 1000, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();

    auto anyItem = f.fixture().db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(anyItem.step());
    auto item = f.fixture().db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, :name, 1000, 1, 0, 1000, 'sent', :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4()).bind(":order", orderId)
        .bind(":product", anyItem.columnText(0))
        // A dish whose name carries both a comma and a quote.
        .bind(":name", std::string("5\" Pizza, böyük"))
        .bind(":now", now);
    item.exec();

    const auto csv = f.exportKind("products").at("csv").get<std::string>();
    // The quote is doubled and the whole field is wrapped, so the comma stays
    // inside its own column.
    REQUIRE(csv.find("\"5\"\" Pizza, böyük\"") != std::string::npos);
}

TEST_CASE("the sales export carries the bills it was asked for", "[export]") {
    ExportFixture f;

    const auto now = pos::nowMs();
    for (const char* number : {"EXP-A", "EXP-B"}) {
        auto order = f.fixture().db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
            "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
            "  opened_at, updated_at, row_version) "
            "VALUES (:id, :num, 'usr-admin', 'closed', 2, 0,0,0,0, 4500, 4500, 0, :now, :now, 1)");
        order.bind(":id", pos::crypto::uuid4()).bind(":num", std::string(number)).bind(":now", now);
        order.exec();
    }

    const auto result = f.exportKind("sales");
    REQUIRE(result.at("rows") == 2);
    const auto csv = result.at("csv").get<std::string>();
    REQUIRE(csv.find("EXP-A") != std::string::npos);
    REQUIRE(csv.find("EXP-B") != std::string::npos);
    // Money is exported in major units, which is what a spreadsheet sums.
    REQUIRE(csv.find("45.0") != std::string::npos);
}

TEST_CASE("a voided bill is not exported as a sale", "[export]") {
    ExportFixture f;
    const auto now = pos::nowMs();
    auto order = f.fixture().db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
        "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
        "  opened_at, updated_at, row_version) "
        "VALUES (:id, 'EXP-V', 'usr-admin', 'voided', 1, 0,0,0,0, 9900, 0, 0, :now, :now, 1)");
    order.bind(":id", pos::crypto::uuid4()).bind(":now", now);
    order.exec();

    const auto result = f.exportKind("sales");
    REQUIRE(result.at("rows") == 0);
}
