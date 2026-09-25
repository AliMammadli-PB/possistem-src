#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/ReceiptBuilder.hpp"

/**
 * Three printers, and which document goes to which.
 *
 * A restaurant runs a ticket printer in the kitchen, a receipt printer at the
 * till, and - where deliveries are taken in - one in the store room. The core
 * knew two roles and the settings screen wrote only one, so a third machine
 * could be cabled to the switch and have nothing addressed to it at all.
 *
 * These cases pin the two halves that would rot quietly: the routing table
 * (which kind lands on which printer) and the goods-receipt note, which is the
 * only reason the third role is not decoration.
 */
namespace {

class PrinterRoleFixture {
public:
    PrinterRoleFixture() {
        pos::handlers::registerPrinting(fixture_.contextPtr());
        pos::handlers::registerInventory(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    std::string setting(const std::string& key) {
        return fixture_.ctx().setting(key, "auto");
    }

    /** A received delivery: supplier, store room, two lines, real money. */
    std::string makeReceivedPurchase() {
        const auto now = pos::nowMs();
        const std::string supplierId = pos::crypto::uuid4();
        const std::string purchaseId = pos::crypto::uuid4();

        auto supplier = fixture_.db().prepare(
            "INSERT INTO suppliers (id, name, contact, phone, created_at, updated_at) "
            "VALUES (:id, :name, 'Elçin', '0501112233', :now, :now)");
        supplier.bind(":id", supplierId)
            .bind(":name", "Zəfər Ticarət " + supplierId.substr(0, 4))
            .bind(":now", now);
        supplier.exec();

        // The store room the seed already ships, or one of our own. Names are
        // unique, so a fixture that always inserts collides the second time it
        // is used in the same database.
        std::string warehouseId;
        auto existing = fixture_.db().prepare("SELECT id FROM warehouses LIMIT 1");
        if (existing.step()) {
            warehouseId = existing.columnText(0);
        } else {
            warehouseId = pos::crypto::uuid4();
            auto warehouse = fixture_.db().prepare(
                "INSERT INTO warehouses (id, name, kind, created_at, updated_at) "
                "VALUES (:id, 'Test anbarı', 'store', :now, :now)");
            warehouse.bind(":id", warehouseId).bind(":now", now);
            warehouse.exec();
        }

        const std::string ingredientId = pos::crypto::uuid4();
        auto ingredient = fixture_.db().prepare(
            "INSERT INTO ingredients (id, sku, name, unit, cost_minor, created_at, updated_at) "
            "VALUES (:id, :sku, 'Un', 'kg', 1800, :now, :now)");
        ingredient.bind(":id", ingredientId)
            .bind(":sku", "ING-" + ingredientId.substr(0, 8))
            .bind(":now", now);
        ingredient.exec();

        auto order = fixture_.db().prepare(
            "INSERT INTO purchase_orders (id, number, supplier_id, warehouse_id, status, "
            "  total_minor, due_minor, created_at, received_at) "
            "VALUES (:id, :number, :supplier, :warehouse, 'received', 4500, 4500, :now, :now)");
        order.bind(":id", purchaseId).bind(":number", "AL-" + purchaseId.substr(0, 8))
            .bind(":supplier", supplierId)
            .bind(":warehouse", warehouseId).bind(":now", now);
        order.exec();

        auto line = fixture_.db().prepare(
            "INSERT INTO purchase_order_items (id, purchase_id, ingredient_id, qty_milli, "
            "  unit_cost_minor, line_total_minor) "
            "VALUES (:id, :purchase, :ingredient, 2500, 1800, 4500)");
        line.bind(":id", pos::crypto::uuid4()).bind(":purchase", purchaseId)
            .bind(":ingredient", ingredientId);
        line.exec();

        return purchaseId;
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("each role can be assigned its own printer", "[printer][roles]") {
    PrinterRoleFixture f;

    // What the settings screen does when the operator presses Test, sees paper
    // come out of one machine, and labels that row.
    f.call("print.setPrinter", pos::Json{{"target", "receipt"}, {"printerName", "usbraw:till"}});
    f.call("print.setPrinter", pos::Json{{"target", "kitchen"}, {"printerName", "tcp:192.168.1.51:9100"}});
    f.call("print.setPrinter", pos::Json{{"target", "warehouse"}, {"printerName", "tcp:192.168.1.52:9100"}});

    REQUIRE(f.setting("printer.receipt") == "usbraw:till");
    REQUIRE(f.setting("printer.kitchen") == "tcp:192.168.1.51:9100");
    REQUIRE(f.setting("printer.warehouse") == "tcp:192.168.1.52:9100");

    // And the screen reads all three back, or the operator cannot see what they
    // assigned and starts pressing Test again.
    const auto listed = f.call("print.printers", pos::Json::object());
    REQUIRE(listed.at("receipt") == "usbraw:till");
    REQUIRE(listed.at("kitchen") == "tcp:192.168.1.51:9100");
    REQUIRE(listed.at("warehouse") == "tcp:192.168.1.52:9100");
}

TEST_CASE("a role nobody defined does not overwrite the till", "[printer][roles]") {
    PrinterRoleFixture f;
    f.call("print.setPrinter", pos::Json{{"target", "receipt"}, {"printerName", "usbraw:till"}});

    // A role the core does not know is refused rather than falling through to
    // the receipt printer, which is the one machine that must not move by
    // accident. Either answer is safe; what matters is where it did not land.
    try {
        f.call("print.setPrinter", pos::Json{{"target", "bar"}, {"printerName", "tcp:10.0.0.9:9100"}});
    } catch (const pos::PosError&) {
        // refused outright, which is the stricter of the two safe answers
    }
    REQUIRE(f.setting("printer.receipt") == "usbraw:till");
    REQUIRE(f.setting("printer.bar") == "auto");
}

TEST_CASE("documents go to the printer their job belongs on", "[printer][roles]") {
    PrinterRoleFixture f;
    f.call("print.setPrinter", pos::Json{{"target", "receipt"}, {"printerName", "usbraw:till"}});
    f.call("print.setPrinter", pos::Json{{"target", "kitchen"}, {"printerName", "tcp:kitchen:9100"}});
    f.call("print.setPrinter", pos::Json{{"target", "warehouse"}, {"printerName", "tcp:store:9100"}});

    const std::string purchaseId = f.makeReceivedPurchase();

    // The job records the printer it was addressed to when it was queued, so
    // the routing is observable without a printer attached.
    const auto slip = f.call("print.enqueue",
                             pos::Json{{"kind", "warehouse_slip"},
                                       {"options", pos::Json{{"purchaseId", purchaseId}}}});
    auto stored = f.fixture().db().prepare(
        "SELECT target_printer FROM print_jobs WHERE id = :id");
    stored.bind(":id", slip.at("id").get<std::string>());
    REQUIRE(stored.step());
    REQUIRE(stored.columnText(0) == "tcp:store:9100");

    // An X report is not a kitchen ticket and not a delivery note, so it lands
    // at the till - the rule everything that is neither still follows.
    const auto report = f.call("print.enqueue", pos::Json{{"kind", "x_report"}});
    auto reportJob = f.fixture().db().prepare(
        "SELECT target_printer FROM print_jobs WHERE id = :id");
    reportJob.bind(":id", report.at("id").get<std::string>());
    REQUIRE(reportJob.step());
    REQUIRE(reportJob.columnText(0) == "usbraw:till");
}

TEST_CASE("a delivery note says what came in and who signs for it", "[printer][warehouse]") {
    PrinterRoleFixture f;
    const std::string purchaseId = f.makeReceivedPurchase();

    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    const auto slip = builder.warehouseSlip(purchaseId);

    REQUIRE(slip.text.find("MAL QƏBULU") != std::string::npos);
    REQUIRE(slip.text.find(purchaseId.substr(0, 8)) != std::string::npos);
    REQUIRE(slip.text.find("Zəfər Ticarət") != std::string::npos);
    REQUIRE(slip.totalMinor == 4500);
    // A delivery nobody signed for settles no argument with a supplier later.
    REQUIRE(slip.text.find("Təhvil aldı") != std::string::npos);
    REQUIRE(slip.data.at("items").size() == 1);
}

TEST_CASE("a delivery note needs a delivery", "[printer][warehouse]") {
    PrinterRoleFixture f;

    // Queued without one it would fail at render, after the operator had been
    // told it was printing.
    REQUIRE_THROWS_AS(f.call("print.enqueue", pos::Json{{"kind", "warehouse_slip"}}),
                      pos::PosError);

    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    REQUIRE_THROWS_AS(builder.warehouseSlip(pos::crypto::uuid4()), pos::PosError);
}
