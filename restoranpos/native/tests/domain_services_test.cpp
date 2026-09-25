#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/db/Migrator.hpp"
#include "pos/db/migrations_generated.hpp"
#include "pos/handlers/Context.hpp"
#include "pos/ipc/StdioServer.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/CatalogAdminService.hpp"
#include "pos/services/GiftCampaignService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/RefundService.hpp"
#include "pos/services/ReportService.hpp"
#include "pos/services/SplitBillService.hpp"
#include "pos/printing/ReceiptBuilder.hpp"

TEST_CASE("business day open X report immutable Z blocked by open order",
          "[business_day][report]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::ReportService reports(fixture.ctx());

    {
        pos::db::Transaction txn(fixture.db());
        const auto day = days.open(10000);
        REQUIRE(day.at("status") == "open");
        txn.commit();
    }

    const auto dayId = *days.openBusinessDayId();
    pos::Json xReport;
    {
        pos::db::Transaction txn(fixture.db());
        xReport = reports.createXReport(dayId);
        txn.commit();
    }
    REQUIRE(xReport.at("kind") == "x");
    const auto snapshotId = xReport.at("snapshotId").get<std::string>();

    REQUIRE_THROWS(fixture.db().exec(
        "UPDATE report_snapshots SET content_sha256 = 'tampered' WHERE id = '" + snapshotId +
        "'"));

    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto insertOrder = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, business_day_id, row_version) "
        "VALUES (:id, 'T-1', 'usr-admin', 'open', 1, 1000, 0, 0, 0, 1000, 0, 0, :now, :now, :day, 1)");
    insertOrder.bind(":id", orderId).bind(":now", now).bind(":day", dayId);
    insertOrder.exec();

    auto ready = days.readiness(dayId);
    REQUIRE_FALSE(ready.ready);
    REQUIRE(ready.openOrders == 1);

    REQUIRE_THROWS_AS(days.closeZ(dayId), pos::PosError);

    fixture.db().exec("UPDATE orders SET status = 'closed', closed_at = " + std::to_string(now) +
                      " WHERE id = '" + orderId + "'");

    fixture.db().exec(
        "UPDATE business_days SET status = 'open', closed_at = NULL, closed_by = NULL "
        "WHERE id = '" +
        dayId + "'");

    {
        pos::db::Transaction txn(fixture.db());
        const auto closed = days.closeZ(dayId);
        REQUIRE(closed["zReport"]["kind"] == "z");
        txn.commit();
    }

    // Counting cash was removed from the Z flow entirely.
    auto counted = fixture.db().prepare(
        "SELECT counted_cash_minor FROM business_days WHERE id = '" + dayId + "'");
    REQUIRE(counted.step());
    REQUIRE(counted.columnIsNull(0));
}

TEST_CASE("refund ledger supports partial refunds without mutating early", "[refund]") {
    ServiceFixture fixture;
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    const std::string paymentId = pos::crypto::uuid4();

    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'R-1', 'usr-admin', 'paid', 1, 5000, 0, 0, 0, 5000, 5000, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();

    auto payment = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at) "
        "VALUES (:id, :order, 'cash', 'approved', 5000, 0, 5000, 0, 'usr-admin', :now, :now)");
    payment.bind(":id", paymentId).bind(":order", orderId).bind(":now", now);
    payment.exec();

    pos::services::RefundService refunds(fixture.ctx());
    {
        pos::db::Transaction txn(fixture.db());
        const auto first = refunds.createRefund(paymentId, 2000, "partial", "usr-admin");
        REQUIRE(first.at("remainingMinor") == 3000);
        txn.commit();
    }

    {
        auto status = fixture.db().prepare("SELECT status FROM payments WHERE id = :id");
        status.bind(":id", paymentId);
        REQUIRE(status.step());
        REQUIRE(status.columnText(0) == "approved");
    }

    {
        pos::db::Transaction txn(fixture.db());
        REQUIRE_THROWS_AS(refunds.createRefund(paymentId, 4000, "too much", "usr-admin"),
                          pos::PosError);
        const auto second = refunds.createRefund(paymentId, 3000, "remainder", "usr-admin");
        REQUIRE(second.at("remainingMinor") == 0);
        txn.commit();
    }

    {
        auto status = fixture.db().prepare("SELECT status FROM payments WHERE id = :id");
        status.bind(":id", paymentId);
        REQUIRE(status.step());
        REQUIRE(status.columnText(0) == "refunded");
    }
}

TEST_CASE("gift threshold ignores gift line price and charges zero", "[gift]") {
    ServiceFixture fixture;
    pos::services::GiftCampaignService gifts(fixture.ctx());

    auto anyItem = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(anyItem.step());
    const std::string productId = anyItem.columnText(0);

    pos::Json campaign;
    {
        pos::db::Transaction txn(fixture.db());
        campaign = gifts.upsertCampaign(pos::Json{
            {"nameAz", "Test Gift"},
            {"minOrderMinor", 5000},
            {"reviewRequired", 0},
            {"tiers", pos::Json::array({pos::Json{{"thresholdMinor", 5000},
                                                  {"giftItemId", productId},
                                                  {"quantity", 1}}})}});
        txn.commit();
    }

    const auto& campaigns = campaign.at("campaigns");
    REQUIRE_FALSE(campaigns.empty());
    const auto campaignId = campaigns.at(0).at("id").get<std::string>();
    const auto tierId = campaigns.at(0).at("tiers").at(0).at("id").get<std::string>();

    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'G-1', 'usr-admin', 'open', 1, 6000, 0, 0, 0, 6000, 0, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();

    auto item = fixture.db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Paid', 6000, 1, 0, 6000, 'sent', :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":product", productId)
        .bind(":now", now);
    item.exec();

    const auto evaluation = gifts.evaluateOrder(orderId);
    REQUIRE(evaluation.at("payableSubtotalMinor") == 6000);
    REQUIRE_FALSE(evaluation.at("eligible").empty());

    pos::Json applied;
    {
        pos::db::Transaction txn(fixture.db());
        applied = gifts.applyGift(orderId, campaignId, tierId);
        txn.commit();
    }
    REQUIRE(applied.at("chargedPriceMinor") == 0);

    auto giftLine = fixture.db().prepare(
        "SELECT line_total_minor, is_gift, original_price_minor FROM order_items "
        "WHERE order_id = :order AND is_gift = 1");
    giftLine.bind(":order", orderId);
    REQUIRE(giftLine.step());
    REQUIRE(giftLine.columnInt(0) == 0);
    REQUIRE(giftLine.columnInt(1) == 1);

    REQUIRE(gifts.evaluateOrder(orderId).at("payableSubtotalMinor") == 6000);
}

TEST_CASE("catalog upsert sold-out and price history", "[catalog]") {
    ServiceFixture fixture;
    pos::services::CatalogAdminService catalog(fixture.ctx());

    auto cat = fixture.db().prepare("SELECT id FROM menu_categories WHERE active = 1 LIMIT 1");
    REQUIRE(cat.step());
    const std::string categoryId = cat.columnText(0);

    pos::Json product;
    {
        pos::db::Transaction txn(fixture.db());
        product = catalog.upsertProduct(pos::Json{
            {"categoryId", categoryId},
            {"sku", "TEST-SKU-001"},
            {"nameAz", "Test Dish"},
            {"priceMinor", 2500},
        });
        txn.commit();
    }
    const auto productId = product.at("id").get<std::string>();

    {
        pos::db::Transaction txn(fixture.db());
        catalog.setSoldOut(productId, true);
        catalog.upsertProduct(pos::Json{
            {"id", productId},
            {"categoryId", categoryId},
            {"sku", "TEST-SKU-001"},
            {"nameAz", "Test Dish"},
            {"priceMinor", 3000},
            {"priceReason", "seasonal"},
        });
        txn.commit();
    }

    const auto history = catalog.priceHistory(productId);
    REQUIRE(history.at("history").size() >= 1);
    auto sold = fixture.db().prepare("SELECT sold_out FROM menu_items WHERE id = :id");
    sold.bind(":id", productId);
    REQUIRE(sold.step());
    REQUIRE(sold.columnInt(0) == 1);
}

TEST_CASE("equal split rounding preserves total", "[split]") {
    ServiceFixture fixture;
    auto anyItem = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(anyItem.step());
    const std::string productId = anyItem.columnText(0);
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();
    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'S-1', 'usr-admin', 'open', 2, 1001, 0, 0, 0, 1001, 0, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();
    auto item = fixture.db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Split', 1001, 1, 0, 1001, 'sent', :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":product", productId)
        .bind(":now", now);
    item.exec();

    pos::Json split;
    {
        pos::db::Transaction txn(fixture.db());
        split = pos::services::SplitBillService(fixture.ctx()).createEqualSplit(orderId, 3);
        txn.commit();
    }
    REQUIRE(split.at("parts").size() == 3);
    pos::Money sum = 0;
    for (const auto& part : split.at("parts")) sum += part.at("amountMinor").get<pos::Money>();
    auto total = fixture.db().prepare("SELECT total_minor FROM orders WHERE id = :id");
    total.bind(":id", orderId);
    REQUIRE(total.step());
    REQUIRE(sum == total.columnInt(0));
}

TEST_CASE("order numbers stay unique across business days", "[orders][order_number]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::OrderService orders(fixture.ctx());

    {
        pos::db::Transaction txn(fixture.db());
        days.open(0);
        txn.commit();
    }

    // Legacy globally-unique numbers from earlier builds must not collide.
    const auto now = pos::nowMs();
    auto legacy = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'A-0001', 'usr-admin', 'closed', 1, 0, 0, 0, 0, 0, 0, 0, :now, :now, 1)");
    legacy.bind(":id", pos::crypto::uuid4()).bind(":now", now);
    legacy.exec();

    const std::string first = orders.nextOrderNumber();
    REQUIRE(first.find("A-") == 0);
    REQUIRE(first != "A-0001");
    REQUIRE(first.size() > 8);

    auto insert = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, :num, 'usr-admin', 'open', 1, 0, 0, 0, 0, 0, 0, 0, :now, :now, 1)");
    insert.bind(":id", pos::crypto::uuid4()).bind(":num", first).bind(":now", now);
    REQUIRE_NOTHROW(insert.exec());

    const std::string second = orders.nextOrderNumber();
    REQUIRE(second != first);
    REQUIRE(second != "A-0001");
}

TEST_CASE("X report canonical exposes cash card and total for receipt", "[report][x_report]") {
    ServiceFixture fixture;
    pos::services::BusinessDayService days(fixture.ctx());
    pos::services::ReportService reports(fixture.ctx());

    {
        pos::db::Transaction txn(fixture.db());
        days.open(5000);
        txn.commit();
    }
    const auto dayId = *days.openBusinessDayId();
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, closed_at, business_day_id, row_version) "
        "VALUES (:id, 'X-PAY-1', 'usr-admin', 'paid', 1, 10000, 0, 0, 0, 10000, 10000, 0, "
        "        :now, :now, :now, :day, 1)");
    order.bind(":id", orderId).bind(":now", now).bind(":day", dayId);
    order.exec();

    auto cash = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, 'cash', 'approved', 4000, 0, 4000, 0, 'usr-admin', :now, :now, :day)");
    cash.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":now", now)
        .bind(":day", dayId);
    cash.exec();

    auto card = fixture.db().prepare(
        "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
        "  tendered_minor, change_minor, user_id, created_at, updated_at, business_day_id) "
        "VALUES (:id, :order, 'card', 'approved', 6000, 0, 0, 0, 'usr-admin', :now, :now, :day)");
    card.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":now", now)
        .bind(":day", dayId);
    card.exec();

    pos::Json report;
    {
        pos::db::Transaction txn(fixture.db());
        report = reports.createXReport(dayId);
        txn.commit();
    }

    REQUIRE(report.at("kind") == "x");
    const auto& canonical = report.at("canonical");
    REQUIRE(canonical.at("expectedCashMinor").get<pos::Money>() >= 4000);
    REQUIRE(canonical.at("sales").at("grossMinor").get<pos::Money>() == 10000);

    bool sawCash = false;
    bool sawCard = false;
    for (const auto& row : canonical.at("sales").at("byMethod")) {
        const auto method = row.at("method").get<std::string>();
        const auto total = row.at("totalMinor").get<pos::Money>();
        if (method == "cash") {
            sawCash = true;
            REQUIRE(total == 4000);
        }
        if (method == "card") {
            sawCard = true;
            REQUIRE(total == 6000);
        }
    }
    REQUIRE(sawCash);
    REQUIRE(sawCard);

    const auto receipt = pos::printing::ReceiptBuilder(fixture.ctx()).xzReport(canonical, "x_report");
    REQUIRE(receipt.text.find("X HESABAT") != std::string::npos);
    REQUIRE(receipt.text.find("Na") != std::string::npos);
    REQUIRE(receipt.text.find("Kart") != std::string::npos);
    REQUIRE(receipt.text.find("Gözlənilən kassa") == std::string::npos);
    REQUIRE(receipt.text.find("Aralıq hesabat") == std::string::npos);
    REQUIRE(receipt.text.find("kassa sıfırlanmır") == std::string::npos);
    REQUIRE(receipt.text.find("Gözlənilən ümumi məbləğ") != std::string::npos);
    REQUIRE(receipt.data.at("expectedTotalMinor").get<pos::Money>() ==
            receipt.data.at("grossMinor").get<pos::Money>() +
                receipt.data.at("openTablesTotalMinor").get<pos::Money>());
    REQUIRE(receipt.totalMinor == 10000);
}

TEST_CASE("mixed payment records tenders and settles", "[payment][mixed]") {
    ServiceFixture fixture;
    auto anyItem = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
    REQUIRE(anyItem.step());
    const std::string productId = anyItem.columnText(0);
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'M-1', 'usr-admin', 'open', 1, 5000, 0, 0, 0, 5000, 0, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();
    auto item = fixture.db().prepare(
        "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
        "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
        "  created_at, updated_at, row_version) "
        "VALUES (:id, :order, :product, 1, 'Item', 5000, 1, 0, 5000, 'sent', :now, :now, 1)");
    item.bind(":id", pos::crypto::uuid4())
        .bind(":order", orderId)
        .bind(":product", productId)
        .bind(":now", now);
    item.exec();

    std::vector<pos::services::MixedTender> tenders{
        {.method = "cash", .amountMinor = 2000, .tenderedMinor = 2000},
        {.method = "card", .amountMinor = 3000},
    };

    // A card leg is authorised, never assumed: prepare writes a durable but
    // unsettled payment, and settlement records what the terminal answered.
    pos::services::MixedPreparation prepared;
    {
        pos::db::Transaction txn(fixture.db());
        prepared = pos::services::SplitBillService(fixture.ctx())
                       .prepareMixedPayment(orderId, tenders, "idem-mixed-1");
        pos::services::PaymentService(fixture.ctx())
            .applyTransition(prepared.paymentId,
                             pos::services::PaymentStatus::WaitingForTerminal, "terminal", "TX-1");
        txn.commit();
    }
    REQUIRE(prepared.cardAmountMinor == 3000);

    pos::Json result;
    {
        pos::db::Transaction txn(fixture.db());
        result = pos::services::SplitBillService(fixture.ctx())
                     .settleMixedPayment(orderId, prepared.paymentId,
                                         pos::services::PaymentStatus::Approved, "approved",
                                         "TX-1");
        txn.commit();
    }
    REQUIRE(result.at("tenders").size() == 2);
    REQUIRE(result.at("payment").at("method") == "mixed");
    REQUIRE(result.at("payment").at("status") == "approved");
}

TEST_CASE("a declined terminal leaves a mixed payment unsettled", "[payment][mixed]") {
    ServiceFixture fixture;
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'M-2', 'usr-admin', 'open', 1, 5000, 0, 0, 0, 5000, 0, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();
    {
        // Totals are recomputed from the items, so the order needs a line to be
        // worth anything at all.
        auto anyItem = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
        REQUIRE(anyItem.step());
        auto item = fixture.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "  created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, 1, 'Item', :price, 1, 0, :price, 'sent', :now, :now, 1)");
        item.bind(":id", pos::crypto::uuid4())
            .bind(":order", orderId)
            .bind(":product", anyItem.columnText(0))
            .bind(":price", 5000)
            .bind(":now", now);
        item.exec();
    }

    std::vector<pos::services::MixedTender> tenders{
        {.method = "cash", .amountMinor = 2000, .tenderedMinor = 2000},
        {.method = "card", .amountMinor = 3000},
    };

    pos::services::MixedPreparation prepared;
    {
        pos::db::Transaction txn(fixture.db());
        prepared = pos::services::SplitBillService(fixture.ctx())
                       .prepareMixedPayment(orderId, tenders, "idem-mixed-declined");
        pos::services::PaymentService(fixture.ctx())
            .applyTransition(prepared.paymentId,
                             pos::services::PaymentStatus::WaitingForTerminal, "terminal", "TX-2");
        txn.commit();
    }

    pos::Json result;
    {
        pos::db::Transaction txn(fixture.db());
        result = pos::services::SplitBillService(fixture.ctx())
                     .settleMixedPayment(orderId, prepared.paymentId,
                                         pos::services::PaymentStatus::Declined, "declined",
                                         "TX-2");
        txn.commit();
    }

    REQUIRE(result.at("payment").at("status") == "declined");
    // Nothing was collected, so the whole bill is still owing.
    REQUIRE(pos::services::PaymentService(fixture.ctx()).outstanding(orderId) == 5000);
    REQUIRE(result.at("changeMinor") == 0);
}

TEST_CASE("split parts record which payment settled them", "[payment][split]") {
    ServiceFixture fixture;
    const auto now = pos::nowMs();
    const std::string orderId = pos::crypto::uuid4();

    auto order = fixture.db().prepare(
        "INSERT INTO orders (id, order_number, user_id, status, guest_count, "
        "  subtotal_minor, discount_minor, tax_minor, service_minor, total_minor, paid_minor, "
        "  tip_minor, opened_at, updated_at, row_version) "
        "VALUES (:id, 'S-2', 'usr-admin', 'open', 2, 6000, 0, 0, 0, 6000, 0, 0, :now, :now, 1)");
    order.bind(":id", orderId).bind(":now", now);
    order.exec();
    {
        // Totals are recomputed from the items, so the order needs a line to be
        // worth anything at all.
        auto anyItem = fixture.db().prepare("SELECT id FROM menu_items WHERE active = 1 LIMIT 1");
        REQUIRE(anyItem.step());
        auto item = fixture.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, "
            "  unit_price_minor, quantity, modifier_total_minor, line_total_minor, status, "
            "  created_at, updated_at, row_version) "
            "VALUES (:id, :order, :product, 1, 'Item', 6000, 1, 0, 6000, 'sent', :now, :now, 1)");
        item.bind(":id", pos::crypto::uuid4())
            .bind(":order", orderId)
            .bind(":product", anyItem.columnText(0))
            .bind(":now", now);
        item.exec();
    }

    pos::Json split;
    {
        pos::db::Transaction txn(fixture.db());
        split = pos::services::SplitBillService(fixture.ctx()).createEqualSplit(orderId, 2);
        txn.commit();
    }
    REQUIRE(split.at("kind") == "equal");
    REQUIRE(split.at("parts").size() == 2);

    // `bill_split_parts.payment_id` is a foreign key, so the parts have to be
    // attributed to payments that really exist.
    const auto addPayment = [&](const std::string& id, pos::Money amount) {
        auto payment = fixture.db().prepare(
            "INSERT INTO payments (id, order_id, method, status, amount_minor, tip_minor, "
            "  tendered_minor, change_minor, user_id, created_at, updated_at) "
            "VALUES (:id, :order, 'cash', 'approved', :amount, 0, :amount, 0, 'usr-admin', "
            "        :now, :now)");
        payment.bind(":id", id).bind(":order", orderId).bind(":amount", amount).bind(":now", now);
        payment.exec();
    };

    const std::string firstPartId = split.at("parts")[0].at("id");
    {
        pos::db::Transaction txn(fixture.db());
        addPayment("pay-1", 3000);
        pos::services::SplitBillService(fixture.ctx())
            .markPartPaid(firstPartId, "pay-1", 3000);
        txn.commit();
    }

    const pos::Json reloaded =
        pos::services::SplitBillService(fixture.ctx()).openSplitForOrder(orderId);
    REQUIRE(reloaded.at("status") == "partial");
    REQUIRE(reloaded.at("parts")[0].at("paidMinor") == 3000);
    REQUIRE(reloaded.at("parts")[0].at("paymentId") == "pay-1");
    REQUIRE(reloaded.at("parts")[1].at("paidMinor") == 0);

    {
        pos::db::Transaction txn(fixture.db());
        addPayment("pay-2", 3000);
        pos::services::SplitBillService(fixture.ctx())
            .markPartPaid(split.at("parts")[1].at("id"), "pay-2", 3000);
        txn.commit();
    }
    // Every part settled closes the split, so it stops being offered.
    REQUIRE(pos::services::SplitBillService(fixture.ctx()).openSplitForOrder(orderId).is_null());
}
