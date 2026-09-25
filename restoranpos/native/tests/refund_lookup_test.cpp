#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/printing/ReceiptFormatter.hpp"

/**
 * Refunding a guest who has already left.
 *
 * The refund engine was complete and unreachable: `payments.refund` takes a
 * paymentId, and the only screen that knew one belonged to an order still open
 * on a table. Once the table was cleared there was no way back to that sale, so
 * a guest returning an hour later with a receipt could not be refunded at all.
 *
 * These cases cover the path that fixes it - the code on the paper, the lookup
 * behind it, and the slip that goes back with the money - and in particular the
 * ways the path could quietly do the wrong thing: refunding against an unpaid
 * bill, returning a dish twice, or failing to find a sale because the guest
 * read the code out without its prefix.
 */
namespace {

class RefundLookupFixture {
public:
    RefundLookupFixture() {
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerPrinting(fixture_.contextPtr());
    }

    pos::Json call(const std::string& method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** An order with two lines, so a single-dish refund has something to leave. */
    std::string makeOrder(const char* number, pos::Money unitMinor, std::int64_t quantity) {
        const auto now = pos::nowMs();
        const std::string orderId = pos::crypto::uuid4();
        const pos::Money total = unitMinor * quantity;

        auto order = fixture_.db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
            "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
            "  tip_minor, opened_at, updated_at, row_version) "
            "VALUES (:id, :number, 'usr-admin', 'open', 1, :total, 0, 0, 0, :total, 0, 0, "
            "        :now, :now, 1)");
        order.bind(":id", orderId)
            .bind(":number", std::string(number))
            .bind(":total", total)
            .bind(":now", now);
        order.exec();

        auto anyItem = fixture_.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
        REQUIRE(anyItem.step());
        auto item = fixture_.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "  created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, 1, 'Çay', :unit, :qty, 0, :total, 'sent', :now, :now, 1)");
        item.bind(":id", pos::crypto::uuid4())
            .bind(":order", orderId)
            .bind(":product", anyItem.columnText(0))
            .bind(":unit", unitMinor)
            .bind(":qty", quantity)
            .bind(":total", total)
            .bind(":now", now);
        item.exec();

        return orderId;
    }

    /** Pays the order in cash and prints the receipt the guest walks out with. */
    std::string payAndPrint(const std::string& orderId, pos::Money totalMinor) {
        call("payments.createCash", pos::Json{{"orderId", orderId},
                                              {"amountMinor", totalMinor},
                                              {"tenderedMinor", totalMinor}});

        // storeReceipt is what issues the number the guest carries away, so the
        // test has to go through it rather than rendering a document in memory.
        pos::printing::ReceiptBuilder builder(fixture_.ctx());
        const auto rendered = builder.customerReceipt(orderId);
        pos::printing::storeReceipt(fixture_.ctx(), orderId, "customer_receipt", rendered);
        return rendered.number;
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("the code on the receipt finds the sale behind it", "[refund][lookup]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-1", 500, 4);
    const std::string code = f.payAndPrint(orderId, 2000);

    const auto found = f.call("receipts.lookupByCode", pos::Json{{"code", code}});
    REQUIRE(found.at("orderId") == orderId);
    REQUIRE(found.at("number") == code);
    REQUIRE(found.at("totalMinor") == 2000);
    REQUIRE(found.at("refundableTotalMinor") == 2000);
    // The time on the paper: the receipt is stamped, so a dispute has a moment
    // to point at rather than "some time on Tuesday".
    REQUIRE(found.at("printedAt").get<pos::Timestamp>() > 0);

    REQUIRE(found.at("payments").size() == 1);
    REQUIRE(found.at("payments")[0].at("method") == "cash");
    REQUIRE(found.at("payments")[0].at("remainingRefundableMinor") == 2000);

    REQUIRE(found.at("items").size() == 1);
    REQUIRE(found.at("items")[0].at("refundableQuantity") == 4);
}

TEST_CASE("a code is found however the guest reads it out", "[refund][lookup]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-2", 1000, 1);
    const std::string code = f.payAndPrint(orderId, 1000);   // "R-ABC23XYZ"
    const std::string body = code.substr(2);                  // "ABC23XYZ"

    // Lower case, no prefix, and the spacing somebody adds when copying from
    // paper. All three are the same sale; the alphabet has no I/O/0/1, so none
    // of this has to guess between look-alike characters.
    for (const std::string typed : {code, body, "r-" + body,
                                    body.substr(0, 4) + " " + body.substr(4)}) {
        const auto found = f.call("receipts.lookupByCode", pos::Json{{"code", typed}});
        REQUIRE(found.at("orderId") == orderId);
    }
}

TEST_CASE("an unpaid bill is not refundable from its number", "[refund][lookup]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-3", 1500, 1);

    // A preliminary bill carries a number too. Refunding against one would
    // return money that never arrived, so only a paid receipt is a way in.
    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    const auto config = builder.settings();
    const auto doc = builder.customerDocument(orderId, config, false, true);
    pos::printing::RenderedReceipt bill;
    bill.number = doc.receiptNumber;
    bill.data = doc.toJson();
    bill.totalMinor = doc.grandTotal;
    pos::printing::storeReceipt(f.fixture().ctx(), orderId, "customer_bill", bill);

    REQUIRE_THROWS_AS(f.call("receipts.lookupByCode", pos::Json{{"code", bill.number}}),
                      pos::PosError);
}

TEST_CASE("a code nobody issued is refused", "[refund][lookup]") {
    RefundLookupFixture f;
    REQUIRE_THROWS_AS(f.call("receipts.lookupByCode", pos::Json{{"code", "R-ZZZZZZZZ"}}),
                      pos::PosError);
    // And a stray keystroke is not a search: two characters would match far too
    // much if the column were ever prefix-matched by a later change.
    REQUIRE_THROWS_AS(f.call("receipts.lookupByCode", pos::Json{{"code", "R-"}}), pos::PosError);
}

TEST_CASE("what is left shrinks as money goes back", "[refund][lookup]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-4", 500, 4);
    const std::string code = f.payAndPrint(orderId, 2000);

    auto found = f.call("receipts.lookupByCode", pos::Json{{"code", code}});
    const std::string paymentId = found.at("payments")[0].at("id");
    const std::string itemId = found.at("items")[0].at("id");

    // One of the four was rung up wrong: the guest gets that one back.
    f.call("payments.refund", pos::Json{{"paymentId", paymentId},
                                        {"reason", "Səhv vurulub"},
                                        {"items", pos::Json::array({
                                            pos::Json{{"orderItemId", itemId}, {"quantity", 1}}})}});

    found = f.call("receipts.lookupByCode", pos::Json{{"code", code}});
    REQUIRE(found.at("payments")[0].at("remainingRefundableMinor") == 1500);
    REQUIRE(found.at("payments")[0].at("refundedMinor") == 500);
    // The cashier must not be able to hand the same dish back twice: three of
    // the four remain, and the screen is told so rather than finding out from a
    // rejection after the drawer is already open.
    REQUIRE(found.at("items")[0].at("refundableQuantity") == 3);
    REQUIRE(found.at("refunds").size() == 1);
    REQUIRE(found.at("refunds")[0].at("reason") == "Səhv vurulub");
}

TEST_CASE("the paid receipt tells the guest to keep it", "[refund][receipt]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-5", 750, 2);
    f.call("payments.createCash", pos::Json{{"orderId", orderId},
                                            {"amountMinor", 1500},
                                            {"tenderedMinor", 1500}});

    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    const auto rendered = builder.customerReceipt(orderId);

    // A guest who does not know the paper matters throws it away on the way
    // out, and then there is nothing to look the sale up by.
    REQUIRE(rendered.text.find("GERİ QAYTARMA KODU") != std::string::npos);
    REQUIRE(rendered.text.find(rendered.number) != std::string::npos);
    REQUIRE(rendered.text.find("təqdim edin") != std::string::npos);

    // Not on a bill: nothing has been paid yet, so there is nothing to return.
    const auto config = builder.settings();
    const auto bill = builder.customerDocument(orderId, config, false, true);
    const auto billText = pos::printing::renderPlainText(
        pos::printing::formatReceipt(bill), bill.charsPerLine);
    REQUIRE(billText.find("GERİ QAYTARMA KODU") == std::string::npos);
}

TEST_CASE("the refund slip names the receipt it came off", "[refund][receipt]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-6", 1200, 1);
    const std::string code = f.payAndPrint(orderId, 1200);

    const auto found = f.call("receipts.lookupByCode", pos::Json{{"code", code}});
    const std::string paymentId = found.at("payments")[0].at("id");

    const auto refund = f.call("payments.refund", pos::Json{{"paymentId", paymentId},
                                                            {"amountMinor", 1200},
                                                            {"reason", "Müştəri imtina etdi"}});
    const std::string refundId = refund.at("refundId");

    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    const auto slip = builder.refundReceipt(refundId);

    // The two pieces of paper have to be matchable by eye a week later, when
    // whoever settles the dispute has neither the guest nor the database.
    REQUIRE(slip.text.find("GERİ QAYTARMA") != std::string::npos);
    REQUIRE(slip.text.find(code) != std::string::npos);
    REQUIRE(slip.text.find("Müştəri imtina etdi") != std::string::npos);
    REQUIRE(slip.totalMinor == 1200);
    REQUIRE(slip.data.at("method") == "cash");
    REQUIRE(slip.number != code);  // its own number, not the sale's
}

TEST_CASE("the refund slip survives the trip through the print queue", "[refund][receipt]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-8", 800, 1);
    const std::string code = f.payAndPrint(orderId, 800);

    const auto found = f.call("receipts.lookupByCode", pos::Json{{"code", code}});
    const auto refund = f.call("payments.refund",
                               pos::Json{{"paymentId", found.at("payments")[0].at("id")},
                                         {"amountMinor", 800},
                                         {"reason", "Səhv vurulub"}});
    const std::string refundId = refund.at("refundId");

    // print.enqueue rebuilds the job's options from the printer profile rather
    // than storing what the caller sent, so the refund id has to be carried
    // across on purpose. If it is dropped the slip fails at render time - after
    // the money has already gone back, which is the worst moment to find out.
    const auto job = f.call("print.enqueue", pos::Json{{"kind", "refund_receipt"},
                                                       {"orderId", orderId},
                                                       {"options", pos::Json{{"refundId", refundId}}}});
    const std::string jobId = job.at("id");

    auto stored = f.fixture().db().prepare("SELECT payload FROM print_jobs WHERE id = :id");
    stored.bind(":id", jobId);
    REQUIRE(stored.step());
    const auto options = pos::Json::parse(stored.columnText(0));
    REQUIRE(options.at("refundId") == refundId);

    // And without one it is refused at the door rather than queued to fail.
    REQUIRE_THROWS_AS(f.call("print.enqueue", pos::Json{{"kind", "refund_receipt"},
                                                        {"orderId", orderId}}),
                      pos::PosError);
}

TEST_CASE("cash going back out is logged against the drawer", "[refund][cash]") {
    RefundLookupFixture f;
    const std::string orderId = f.makeOrder("L-7", 900, 1);
    const std::string code = f.payAndPrint(orderId, 900);

    const auto found = f.call("receipts.lookupByCode", pos::Json{{"code", code}});
    const std::string paymentId = found.at("payments")[0].at("id");

    f.call("payments.refund", pos::Json{{"paymentId", paymentId},
                                        {"amountMinor", 900},
                                        {"reason", "Keyfiyyət problemi"}});

    // Money physically left the drawer, so the drawer's own log has to say so -
    // otherwise the count at close is short by exactly the refund and nobody
    // can tell that from a till that is short for a worse reason.
    auto movement = f.fixture().db().prepare(
        "SELECT COUNT(*) FROM cash_movements WHERE kind = 'cash_out' AND amount_minor = 900");
    REQUIRE(movement.step());
    REQUIRE(movement.columnInt(0) == 1);
}
