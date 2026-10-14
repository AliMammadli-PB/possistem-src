#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

/**
 * Kassalar (1.7.23).
 *
 * Two sales points in one shop each feed their own till, so the owner can see
 * what each took today. These cases pin the money: a till holds its opening
 * balance plus the cash its PC took, card money goes to the bank, a transfer
 * cannot overdraw, and salary, debt, supplier and expense money lands on the
 * kassa that was picked.
 */
namespace {

class KassaFixture {
public:
    KassaFixture() {
        pos::handlers::registerPayments(fixture_.contextPtr());
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerGuests(fixture_.contextPtr());
        pos::handlers::registerInventory(fixture_.contextPtr());
        pos::handlers::registerSystem(fixture_.contextPtr());
        pos::handlers::registerCashAccounts(fixture_.contextPtr());
    }

    /** A call as made at the PC `terminal` ("" = this core's own). */
    pos::Json call(const std::string& method, pos::Json payload, const std::string& terminal = "") {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = method;
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        request.terminalId = terminal;
        request.terminalName = terminal.empty() ? "" : "Kassa PC " + terminal;
        return fixture_.server().callHandler(request);
    }

    std::string kassa(const std::string& name, const std::string& kind, pos::Money opening,
                      const std::string& terminal = "", const std::string& object = "") {
        return call("cashAccounts.save", pos::Json{{"name", name}, {"kind", kind}, {"openingMinor", opening},
                                                   {"terminalId", terminal}, {"objectId", object}})
            .at("id").get<std::string>();
    }

    pos::Json account(const std::string& id) {
        const auto now = pos::nowMs();
        const auto list = call("cashAccounts.list", pos::Json{{"from", now - 3600000}, {"to", now + 3600000}});
        for (const auto& row : list.at("accounts"))
            if (row.at("id") == id) return row;
        FAIL("kassa missing: " << id << " in " << list.dump().substr(0, 700));
        return pos::Json();
    }

    pos::Money balance(const std::string& id) { return account(id).at("balanceMinor").get<pos::Money>(); }

    /** An open bill for `total`, nothing on it paid yet. */
    std::string order(pos::Money total) {
        const auto now = pos::nowMs();
        auto category = fixture_.db().prepare("SELECT id FROM menu_categories LIMIT 1");
        REQUIRE(category.step());
        const std::string dish = pos::crypto::uuid4();
        auto item = fixture_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, created_at, updated_at) "
            "VALUES (:id, :cat, :sku, 'Plov', :price, 1, :now, :now)");
        item.bind(":id", dish).bind(":cat", category.columnText(0)).bind(":sku", "M-" + dish.substr(0, 8))
            .bind(":price", total).bind(":now", now);
        item.exec();
        const std::string orderId = pos::crypto::uuid4();
        auto o = fixture_.db().prepare(
            "INSERT INTO orders (id, order_number, user_id, status, guest_count, subtotal_minor, "
            "  discount_minor, tax_minor, service_minor, total_minor, paid_minor, tip_minor, "
            "  opened_at, updated_at, row_version) "
            "VALUES (:id, :no, 'usr-admin', 'open', 1, :total, 0, 0, 0, :total, 0, 0, :now, :now, 1)");
        o.bind(":id", orderId).bind(":no", "KAS-" + orderId.substr(0, 8)).bind(":total", total).bind(":now", now);
        o.exec();
        auto line = fixture_.db().prepare(
            "INSERT INTO order_items (id, order_id, product_id, line_seq, name_snapshot, unit_price_minor, "
            "  quantity, modifier_total_minor, line_total_minor, status, created_at, updated_at, row_version) "
            "VALUES (:id, :order, :dish, 1, 'Plov', :total, 1, 0, :total, 'served', :now, :now, 1)");
        line.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":dish", dish).bind(":total", total)
            .bind(":now", now);
        line.exec();
        return orderId;
    }

    /** An approved card payment taken at `terminal`, as the card flow leaves it. */
    void cardPaid(const std::string& orderId, pos::Money amount, const std::string& terminal) {
        auto pay = fixture_.db().prepare(
            "INSERT INTO payments (id, order_id, method, status, amount_minor, user_id, created_at, "
            "  updated_at, terminal_id) VALUES (:id, :order, 'card', 'approved', :amount, 'usr-admin', "
            "  :now, :now, :terminal)");
        pay.bind(":id", pos::crypto::uuid4()).bind(":order", orderId).bind(":amount", amount)
            .bind(":now", pos::nowMs()).bind(":terminal", terminal);
        pay.exec();
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

}  // namespace

TEST_CASE("a till holds its opening balance and the cash its sales point takes", "[kassa]") {
    KassaFixture f;
    const auto till = f.kassa("Kassa 1", "till", 10000, "pc-1");
    REQUIRE(f.balance(till) == 10000);

    // Rung up at PC 1: lands in Kassa 1.
    f.call("payments.createCash", pos::Json{{"orderId", f.order(1400)}, {"amountMinor", 1400}, {"tenderedMinor", 2000}}, "pc-1");
    // Rung up at PC 2, which feeds no till: not Kassa 1's money.
    f.call("payments.createCash", pos::Json{{"orderId", f.order(900)}, {"amountMinor", 900}, {"tenderedMinor", 900}}, "pc-2");

    const auto row = f.account(till);
    REQUIRE(row.at("balanceMinor") == 11400);
    REQUIRE(row.at("todayCashMinor") == 1400);

    // The second sales point shows up as unassigned, with what it took.
    const auto now = pos::nowMs();
    const auto list = f.call("cashAccounts.list", pos::Json{{"from", now - 3600000}, {"to", now + 3600000}});
    bool loose = false;
    for (const auto& u : list.at("unassigned"))
        if (u.at("terminalId") == "pc-2") { loose = true; REQUIRE(u.at("cashMinor") == 900); }
    REQUIRE(loose);
    // Both PCs were seen and named, so a till can be tied to either.
    REQUIRE(list.at("terminals").size() >= 2);
}

TEST_CASE("one sales point feeds one till", "[kassa]") {
    KassaFixture f;
    f.kassa("Kassa 1", "till", 0, "pc-1");
    REQUIRE_THROWS_AS(f.kassa("Kassa 1b", "till", 0, "pc-1"), pos::PosError);
}

TEST_CASE("card money goes to the bank, cash to the till", "[kassa]") {
    KassaFixture f;
    const auto till = f.kassa("Kassa 1", "till", 0, "pc-1");
    const auto bank = f.kassa("Bank", "bank", 0);
    f.cardPaid(f.order(2500), 2500, "pc-1");
    REQUIRE(f.balance(till) == 0);
    REQUIRE(f.balance(bank) == 2500);
    REQUIRE(f.account(till).at("todayCardMinor") == 2500);
}

TEST_CASE("a transfer moves money between kassas and never overdraws", "[kassa]") {
    KassaFixture f;
    const auto till = f.kassa("Kassa 1", "till", 5000, "pc-1");
    const auto safe = f.kassa("Xəzinə", "treasury", 0);
    f.call("cashAccounts.transfer", pos::Json{{"fromId", till}, {"toId", safe}, {"amountMinor", 2000}, {"note", "axşam"}});
    REQUIRE(f.balance(till) == 3000);
    REQUIRE(f.balance(safe) == 2000);
    REQUIRE_THROWS_AS(f.call("cashAccounts.transfer", pos::Json{{"fromId", till}, {"toId", safe}, {"amountMinor", 9000}}),
                      pos::PosError);
    REQUIRE(f.balance(till) == 3000);
    // A kassa with money in it cannot be closed.
    REQUIRE_THROWS_AS(f.call("cashAccounts.deactivate", pos::Json{{"accountId", safe}}), pos::PosError);
}

TEST_CASE("salary, debt, supplier and expense money uses the kassa picked", "[kassa]") {
    KassaFixture f;
    const auto till = f.kassa("Kassa 1", "till", 10000, "pc-1");
    const auto safe = f.kassa("Xəzinə", "treasury", 50000);

    const auto elvin = f.call("customers.save", pos::Json{{"name", "Elvin"}, {"kind", "employee"}, {"salaryMinor", 80000}})
                           .at("id").get<std::string>();
    f.call("salary.pay", pos::Json{{"customerId", elvin}, {"month", "2026-10"}, {"kind", "advance"},
                                   {"amountMinor", 20000}, {"accountId", safe}});
    REQUIRE(f.balance(safe) == 30000);

    const auto guest = f.call("customers.save", pos::Json{{"name", "Nigar"}}).at("id").get<std::string>();
    f.call("customers.charge", pos::Json{{"customerId", guest}, {"amountMinor", 1500}});
    f.call("customers.payDebt", pos::Json{{"customerId", guest}, {"amountMinor", 1000}, {"accountId", till}});
    REQUIRE(f.balance(till) == 11000);

    f.call("cash.movement", pos::Json{{"kind", "expense"}, {"amountMinor", 500}, {"reason", "Bazarlıq"}, {"accountId", till}});
    REQUIRE(f.balance(till) == 10500);

    const auto moves = f.call("cashAccounts.moves", pos::Json{{"accountId", till}});
    REQUIRE(moves.at("balanceMinor") == 10500);
    REQUIRE(moves.at("moves").size() == 3);  // opening, debt in, expense
}

TEST_CASE("a bank tied to a branch takes only that branch's card money", "[kassa]") {
    KassaFixture f;
    const auto branch = f.call("cashObjects.save", pos::Json{{"name", "Filial 2"}}).at("id").get<std::string>();
    f.kassa("Kassa F2", "till", 0, "pc-2", branch);
    const auto bank2 = f.kassa("Bank F2", "bank", 0, "", branch);
    f.cardPaid(f.order(1000), 1000, "pc-2");
    f.cardPaid(f.order(700), 700, "pc-1");  // another branch's sale
    REQUIRE(f.balance(bank2) == 1000);
}
