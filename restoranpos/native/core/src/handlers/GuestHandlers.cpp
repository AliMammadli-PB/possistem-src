/**
 * Guests we know by name, and the tables they book.
 *
 * Debt and loyalty are ledgers with a projection on the customer row, the same
 * shape stock uses: every change writes a row explaining itself, and the balance
 * is derived from those rows rather than edited directly.
 */
#include <algorithm>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/Idempotency.hpp"

namespace pos::handlers {
namespace {

/** Recomputes the customer's balance from the ledger and stores it. */
Money refreshDebt(Context& ctx, const std::string& customerId) {
    auto sum = ctx.db().prepare(
        "SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN -amount_minor "
        "                         ELSE amount_minor END), 0) "
        "FROM customer_ledger WHERE customer_id = :id");
    sum.bind(":id", customerId);
    sum.step();
    const Money debt = sum.columnInt(0);

    auto update = ctx.db().prepare(
        "UPDATE customers SET debt_minor = :debt, updated_at = :now WHERE id = :id");
    update.bind(":debt", debt).bind(":now", nowMs()).bind(":id", customerId);
    update.exec();
    return debt;
}

/** Recomputes loyalty points from the ledger and stores them. */
std::int64_t refreshPoints(Context& ctx, const std::string& customerId) {
    auto sum = ctx.db().prepare(
        "SELECT COALESCE(SUM(points), 0) FROM loyalty_ledger WHERE customer_id = :id");
    sum.bind(":id", customerId);
    sum.step();
    const auto points = std::max<std::int64_t>(0, sum.columnInt(0));

    auto update = ctx.db().prepare(
        "UPDATE customers SET loyalty_points = :points, updated_at = :now WHERE id = :id");
    update.bind(":points", points).bind(":now", nowMs()).bind(":id", customerId);
    update.exec();
    return points;
}

void requireCustomer(Context& ctx, const std::string& customerId) {
    auto stmt = ctx.db().prepare("SELECT 1 FROM customers WHERE id = :id AND active = 1");
    stmt.bind(":id", customerId);
    if (!stmt.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Müştəri tapılmadı");
    }
}

}  // namespace

void registerGuests(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // -------------------------------------------------------------- customers
    server.registerHandler(
        std::string(protocol::method::kCustomersList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.view");
            const auto search = getOr<std::string>(request.payload, "search", "");
            auto stmt = ctx->db().prepare(
                "SELECT id, name, phone, email, address, note, "
                "       loyalty_points AS loyaltyPoints, debt_minor AS debtMinor, "
                "       kind, salary_minor AS salaryMinor, COALESCE(object_id, '') AS objectId "
                "FROM customers "
                // Parenthesised: without it the AND binds tighter than the ORs
                // and an inactive customer would surface on any search.
                "WHERE active = 1 AND (:kind = '' OR kind = :kind) "
                "  AND (:search = '' OR name LIKE :like OR phone LIKE :like) "
                "ORDER BY name LIMIT 5000");
            stmt.bind(":search", search).bind(":like", "%" + search + "%")
                .bind(":kind", getOr<std::string>(request.payload, "kind", ""));
            return Json{{"customers", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.view");
            const auto id = getOr<std::string>(request.payload, "customerId", "");
            require(!id.empty(), "customerId is required");

            auto stmt = ctx->db().prepare(
                "SELECT id, name, phone, email, address, note, "
                "       loyalty_points AS loyaltyPoints, debt_minor AS debtMinor, active, "
                "       kind, salary_minor AS salaryMinor "
                "FROM customers WHERE id = :id");
            stmt.bind(":id", id);
            if (!stmt.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "Müştəri tapılmadı");
            }
            return stmt.row();
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.manage");

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Ad tələb olunur");
            auto id = getOr<std::string>(request.payload, "id", "");
            const auto phone = getOr<std::string>(request.payload, "phone", "");
            const auto email = getOr<std::string>(request.payload, "email", "");
            const auto address = getOr<std::string>(request.payload, "address", "");
            const auto note = getOr<std::string>(request.payload, "note", "");
            // A partner is a guest or an employee; an employee has a salary.
            const auto kind = getOr<std::string>(request.payload, "kind", "customer");
            require(kind == "customer" || kind == "employee", "Partnyorun tipi tanınmadı");
            const auto salary = getOr<std::int64_t>(request.payload, "salaryMinor", 0);
            require(salary >= 0, "Maaş mənfi ola bilməz");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            if (id.empty()) {
                id = "cus-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO customers (id, name, phone, email, address, note, "
                    "                       created_at, updated_at) "
                    "VALUES (:id, :name, :phone, :email, :address, :note, :now, :now)");
                insert.bind(":id", id).bind(":name", name).bind(":phone", phone)
                    .bind(":email", email).bind(":address", address).bind(":note", note)
                    .bind(":now", now);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE customers SET name = :name, phone = :phone, email = :email, "
                    "  address = :address, note = :note, updated_at = :now WHERE id = :id");
                update.bind(":name", name).bind(":phone", phone).bind(":email", email)
                    .bind(":address", address).bind(":note", note).bind(":now", now)
                    .bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Müştəri tapılmadı");
            }
            if (request.payload.contains("kind") || request.payload.contains("salaryMinor")) {
                auto partner = ctx->db().prepare(
                    "UPDATE customers SET kind = :kind, salary_minor = :salary WHERE id = :id");
                partner.bind(":kind", kind).bind(":salary", salary).bind(":id", id);
                partner.exec();
            }
            if (request.payload.contains("objectId")) {
                // Which branch they belong to ("" = none).
                auto branch = ctx->db().prepare("UPDATE customers SET object_id = :object WHERE id = :id");
                branch.bindOptional(":object", getOr<std::string>(request.payload, "objectId", "")).bind(":id", id);
                branch.exec();
            }
            ctx->audit("customer.save", "customer", id, Json{{"name", name}});
            txn.commit();
            return Json{{"id", id}, {"name", name}, {"phone", phone}};
        });

    // ---------------------------------------------------------------- salary
    // An employee's month: the salary, what was paid (advances, full
    // payments), what their tab took (meals put on their account that month)
    // and what is still due. Months are passed in as local-time bounds, so a
    // new month starts at the full salary on its own.
    server.registerHandler(
        std::string(protocol::method::kSalaryList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("salary.manage");
            const auto month = getOr<std::string>(request.payload, "month", "");
            const auto from = getOr<std::int64_t>(request.payload, "from", 0);
            const auto to = getOr<std::int64_t>(request.payload, "to", 0);
            require(month.size() == 7 && to > from, "Ay düzgün deyil");

            auto stmt = ctx->db().prepare(
                "SELECT c.id, c.name, c.phone, c.salary_minor AS salaryMinor, c.debt_minor AS debtMinor, "
                "  COALESCE(c.object_id, '') AS objectId, "
                "  COALESCE((SELECT SUM(p.amount_minor) FROM salary_payments p "
                "            WHERE p.customer_id = c.id AND p.month = :month), 0) AS paidMinor, "
                "  COALESCE((SELECT SUM(l.amount_minor) FROM customer_ledger l "
                "            WHERE l.customer_id = c.id AND l.kind = 'charge' "
                "              AND l.created_at >= :from AND l.created_at < :to), 0) AS mealsMinor, "
                "  EXISTS (SELECT 1 FROM salary_payments p WHERE p.customer_id = c.id "
                "          AND p.month = :month AND p.kind = 'full') AS settled "
                "FROM customers c WHERE c.active = 1 AND c.kind = 'employee' ORDER BY c.name");
            stmt.bind(":month", month).bind(":from", from).bind(":to", to);
            auto rows = stmt.rows();
            for (auto& row : rows) {
                const Money salary = row.value("salaryMinor", Money{0});
                const Money paid = row.value("paidMinor", Money{0});
                const Money meals = row.value("mealsMinor", Money{0});
                const bool settled = row.value("settled", std::int64_t{0}) != 0;
                row["settled"] = settled;
                row["remainingMinor"] = settled ? Money{0} : std::max<Money>(0, salary - paid - meals);
                auto history = ctx->db().prepare(
                    "SELECT id, kind, amount_minor AS amountMinor, note, created_at AS createdAt "
                    "FROM salary_payments WHERE customer_id = :id AND month = :month "
                    "ORDER BY created_at DESC");
                history.bind(":id", row.value("id", std::string{})).bind(":month", month);
                row["history"] = history.rows();
            }
            return Json{{"month", month}, {"employees", rows}};
        });

    server.registerHandler(
        std::string(protocol::method::kSalaryPay), [ctx](const ipc::Request& request) {
            ctx->requirePermission("salary.manage");
            const auto customerId = getOr<std::string>(request.payload, "customerId", "");
            const auto month = getOr<std::string>(request.payload, "month", "");
            const auto kind = getOr<std::string>(request.payload, "kind", "");
            const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
            const auto note = getOr<std::string>(request.payload, "note", "");
            require(!customerId.empty() && month.size() == 7, "İşçi və ay tələb olunur");
            require(kind == "advance" || kind == "full" || kind == "note", "Ödəniş növü tanınmadı");
            require(kind == "note" ? !note.empty() : amount >= 0, "Məbləğ və ya qeyd düzgün deyil");
            require(kind != "advance" || amount > 0, "Avans sıfırdan böyük olmalıdır");

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = request.idempotencyKey.empty()
                                 ? getOr<std::string>(request.payload, "idempotencyKey", "")
                                 : request.idempotencyKey;
            if (auto replay = idem.begin(key, "salary.pay", request.payload)) return *replay;

            auto who = ctx->db().prepare(
                "SELECT name FROM customers WHERE id = :id AND active = 1 AND kind = 'employee'");
            who.bind(":id", customerId);
            require(who.step(), "İşçi tapılmadı");
            const std::string name = who.columnText(0);
            const auto now = nowMs();

            auto insert = ctx->db().prepare(
                "INSERT INTO salary_payments (id, customer_id, month, kind, amount_minor, note, "
                "                             actor_user_id, created_at) "
                "VALUES (:id, :customer, :month, :kind, :amount, :note, :actor, :now)");
            insert.bind(":id", crypto::uuid4()).bind(":customer", customerId).bind(":month", month)
                .bind(":kind", kind).bind(":amount", kind == "note" ? Money{0} : amount)
                .bind(":note", note).bindOptional(":actor", ctx->session().userId).bind(":now", now);
            insert.exec();

            // The full payment is net of the tab: the meals were taken out of the
            // salary, so the tab is cleared rather than collected again.
            if (kind == "full") {
                auto debt = ctx->db().prepare("SELECT debt_minor FROM customers WHERE id = :id");
                debt.bind(":id", customerId);
                const Money owed = debt.step() ? debt.columnInt(0) : 0;
                if (owed > 0) {
                    auto adjust = ctx->db().prepare(
                        "INSERT INTO customer_ledger (id, customer_id, amount_minor, kind, note, "
                        "                             actor_user_id, created_at) "
                        "VALUES (:id, :customer, :amount, 'adjustment', 'Maaşdan tutuldu', :actor, :now)");
                    adjust.bind(":id", crypto::uuid4()).bind(":customer", customerId)
                        .bind(":amount", -owed).bindOptional(":actor", ctx->session().userId)
                        .bind(":now", now);
                    adjust.exec();
                    refreshDebt(*ctx, customerId);
                }
            }
            const auto accountId = getOr<std::string>(request.payload, "accountId", "");
            if (kind != "note" && amount > 0 && (getOr<bool>(request.payload, "fromCash", false) || !accountId.empty())) {
                // Listed under Xərclər, and taken out of the kassa or treasury picked.
                const auto label = name + (kind == "advance" ? " · avans" : " · maaş");
                const auto row = services::CashService(*ctx).recordMovement("expense", amount, "Maaş", label);
                services::CashService(*ctx).accountMove(accountId, -amount, "salary", "cash_movement",
                                                        row.value("id", std::string{}), "Maaş: " + label);
            }
            ctx->auditRequired("salary.pay", "customer", customerId,
                               Json{{"kind", kind}, {"amountMinor", amount}, {"month", month}});
            Json response{{"ok", true}, {"customerId", customerId}, {"month", month}};
            idem.complete(key, response, "customer", customerId);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersDeactivate),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.manage");
            const auto id = getOr<std::string>(request.payload, "customerId", "");
            require(!id.empty(), "customerId is required");

            // Someone who still owes money cannot be filed away: the debt would
            // vanish from every list that reads active customers.
            auto debt = ctx->db().prepare("SELECT debt_minor FROM customers WHERE id = :id");
            debt.bind(":id", id);
            require(debt.step(), "Müştəri tapılmadı");
            require(debt.columnInt(0) <= 0, "Borcu olan müştəri arxivə salına bilməz");

            auto stmt = ctx->db().prepare(
                "UPDATE customers SET active = 0, updated_at = :now WHERE id = :id AND active = 1");
            stmt.bind(":now", nowMs()).bind(":id", id);
            stmt.exec();
            require(ctx->db().changes() == 1, "Müştəri tapılmadı");
            ctx->auditRequired("customer.deactivate", "customer", id, Json::object());
            return Json{{"ok", true}, {"customerId", id}};
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersLedger), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.view");
            const auto id = getOr<std::string>(request.payload, "customerId", "");
            require(!id.empty(), "customerId is required");

            auto entries = ctx->db().prepare(
                "SELECT l.id, l.order_id AS orderId, o.order_number AS orderNumber, "
                "       l.amount_minor AS amountMinor, l.kind, l.note, "
                "       u.full_name AS actorName, l.created_at AS createdAt "
                "FROM customer_ledger l "
                "LEFT JOIN orders o ON o.id = l.order_id "
                "LEFT JOIN users u ON u.id = l.actor_user_id "
                "WHERE l.customer_id = :id ORDER BY l.created_at DESC LIMIT 200");
            entries.bind(":id", id);

            auto head = ctx->db().prepare(
                "SELECT name, debt_minor AS debtMinor, loyalty_points AS loyaltyPoints "
                "FROM customers WHERE id = :id");
            head.bind(":id", id);
            require(head.step(), "Müştəri tapılmadı");

            Json result = head.row();
            result["customerId"] = id;
            result["entries"] = entries.rows();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersCharge), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.credit");

            const auto customerId = getOr<std::string>(request.payload, "customerId", "");
            const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
            require(!customerId.empty(), "customerId is required");
            require(amount > 0, "Məbləğ sıfırdan böyük olmalıdır");
            requireCustomer(*ctx, customerId);

            db::Transaction txn(ctx->db());
            auto insert = ctx->db().prepare(
                "INSERT INTO customer_ledger (id, customer_id, order_id, amount_minor, kind, "
                "                             note, actor_user_id, created_at) "
                "VALUES (:id, :customer, :order, :amount, 'charge', :note, :actor, :now)");
            insert.bind(":id", crypto::uuid4()).bind(":customer", customerId)
                .bindOptional(":order", getOr<std::string>(request.payload, "orderId", ""))
                .bind(":amount", amount)
                .bind(":note", getOr<std::string>(request.payload, "note", ""))
                .bindOptional(":actor", ctx->session().userId).bind(":now", nowMs());
            insert.exec();

            const Money debt = refreshDebt(*ctx, customerId);
            ctx->auditRequired("customer.charge", "customer", customerId,
                               Json{{"amountMinor", amount}, {"debtMinor", debt}});
            txn.commit();
            return Json{{"customerId", customerId}, {"debtMinor", debt}};
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersPayDebt), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.credit");

            const auto customerId = getOr<std::string>(request.payload, "customerId", "");
            const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
            require(!customerId.empty(), "customerId is required");
            require(amount > 0, "Məbləğ sıfırdan böyük olmalıdır");
            requireCustomer(*ctx, customerId);

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "customers.payDebt", request.payload)) return *replay;
            if (key.rfind("portal-", 0) == 0) {
                auto due = ctx->db().prepare("SELECT debt_minor FROM customers WHERE id = :id");
                due.bind(":id", customerId);
                require(due.step() && due.columnInt(0) >= amount,
                        "Ödəniş müştəri borcunu aşa bilməz");
            }
            auto insert = ctx->db().prepare(
                "INSERT INTO customer_ledger (id, customer_id, amount_minor, kind, note, "
                "                             actor_user_id, created_at) "
                "VALUES (:id, :customer, :amount, 'payment', :note, :actor, :now)");
            insert.bind(":id", crypto::uuid4()).bind(":customer", customerId)
                .bind(":amount", amount)
                .bind(":note", getOr<std::string>(request.payload, "note", ""))
                .bindOptional(":actor", ctx->session().userId).bind(":now", nowMs());
            insert.exec();

            const Money debt = refreshDebt(*ctx, customerId);
            // The money comes into the kassa the cashier picked.
            {
                auto who = ctx->db().prepare("SELECT name FROM customers WHERE id = :id");
                who.bind(":id", customerId);
                services::CashService(*ctx).accountMove(
                    getOr<std::string>(request.payload, "accountId", ""), amount, "debt_in", "customer",
                    customerId, "Borc: " + (who.step() ? who.columnText(0) : std::string{}));
            }
            ctx->auditRequired("customer.payDebt", "customer", customerId,
                               Json{{"amountMinor", amount}, {"debtMinor", debt}});
            Json response{{"customerId", customerId}, {"debtMinor", debt}};
            idem.complete(key, response, "customer", customerId);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kCustomersPayments), [ctx](const ipc::Request&) {
            ctx->requirePermission("customers.view");
            auto stmt = ctx->db().prepare(
                "SELECT l.id, 'customer' AS partyType, l.customer_id AS partyId, "
                "       c.name AS partyName, l.amount_minor AS amountMinor, "
                "       l.note, l.created_at AS createdAt "
                "FROM customer_ledger l JOIN customers c ON c.id = l.customer_id "
                "WHERE l.kind = 'payment' ORDER BY l.created_at DESC LIMIT 5000");
            return Json{{"payments", stmt.rows()}};
        });

    // ---------------------------------------------------------------- loyalty
    server.registerHandler(
        std::string(protocol::method::kLoyaltyEarn), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.loyalty");

            const auto customerId = getOr<std::string>(request.payload, "customerId", "");
            require(!customerId.empty(), "customerId is required");
            requireCustomer(*ctx, customerId);

            // Points are earned from a bill at a configurable rate, so the rate
            // lives in settings rather than being baked into the calculation.
            const auto spentMinor = getOr<Money>(request.payload, "spentMinor", 0);
            auto points = getOr<std::int64_t>(request.payload, "points", 0);
            if (points <= 0 && spentMinor > 0) {
                const auto perMajor = ctx->settingInt("loyalty.pointsPerMajorUnit", 1);
                points = spentMinor * perMajor / 100;
            }
            require(points > 0, "Bal sıfırdan böyük olmalıdır");

            db::Transaction txn(ctx->db());
            auto insert = ctx->db().prepare(
                "INSERT INTO loyalty_ledger (id, customer_id, order_id, points, kind, "
                "                            actor_user_id, created_at) "
                "VALUES (:id, :customer, :order, :points, 'earn', :actor, :now)");
            insert.bind(":id", crypto::uuid4()).bind(":customer", customerId)
                .bindOptional(":order", getOr<std::string>(request.payload, "orderId", ""))
                .bind(":points", points)
                .bindOptional(":actor", ctx->session().userId).bind(":now", nowMs());
            insert.exec();

            const auto balance = refreshPoints(*ctx, customerId);
            txn.commit();
            return Json{{"customerId", customerId}, {"points", points}, {"balance", balance}};
        });

    server.registerHandler(
        std::string(protocol::method::kLoyaltyRedeem), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.loyalty");

            const auto customerId = getOr<std::string>(request.payload, "customerId", "");
            const auto points = getOr<std::int64_t>(request.payload, "points", 0);
            require(!customerId.empty(), "customerId is required");
            require(points > 0, "Bal sıfırdan böyük olmalıdır");
            requireCustomer(*ctx, customerId);

            auto balance = ctx->db().prepare(
                "SELECT loyalty_points FROM customers WHERE id = :id");
            balance.bind(":id", customerId);
            balance.step();
            // Spending points the guest does not have would turn the balance
            // negative, and a negative loyalty balance means nothing.
            require(balance.columnInt(0) >= points, "Kifayət qədər bal yoxdur");

            db::Transaction txn(ctx->db());
            auto insert = ctx->db().prepare(
                "INSERT INTO loyalty_ledger (id, customer_id, order_id, points, kind, "
                "                            actor_user_id, created_at) "
                "VALUES (:id, :customer, :order, :points, 'redeem', :actor, :now)");
            insert.bind(":id", crypto::uuid4()).bind(":customer", customerId)
                .bindOptional(":order", getOr<std::string>(request.payload, "orderId", ""))
                .bind(":points", -points)
                .bindOptional(":actor", ctx->session().userId).bind(":now", nowMs());
            insert.exec();

            const auto remaining = refreshPoints(*ctx, customerId);
            ctx->auditRequired("loyalty.redeem", "customer", customerId, Json{{"points", points}});
            txn.commit();
            return Json{{"customerId", customerId}, {"redeemed", points}, {"balance", remaining}};
        });

    server.registerHandler(
        std::string(protocol::method::kLoyaltyLedger), [ctx](const ipc::Request& request) {
            ctx->requirePermission("customers.view");
            const auto id = getOr<std::string>(request.payload, "customerId", "");
            require(!id.empty(), "customerId is required");

            auto stmt = ctx->db().prepare(
                "SELECT id, order_id AS orderId, points, kind, created_at AS createdAt "
                "FROM loyalty_ledger WHERE customer_id = :id ORDER BY created_at DESC LIMIT 200");
            stmt.bind(":id", id);
            return Json{{"customerId", id}, {"entries", stmt.rows()}};
        });

    // ----------------------------------------------------------- reservations
    server.registerHandler(
        std::string(protocol::method::kReservationsList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reservations.view");

            // Defaults to the coming day, which is what a host actually looks at.
            const auto from = getOr<Timestamp>(request.payload, "from", nowMs() - 6 * 3600000LL);
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs() + 36 * 3600000LL);

            auto stmt = ctx->db().prepare(
                "SELECT r.id, r.table_id AS tableId, t.label AS tableLabel, "
                "       r.customer_id AS customerId, c.name AS customerName, "
                "       r.guest_name AS guestName, r.guest_phone AS guestPhone, "
                "       r.party_size AS partySize, r.starts_at AS startsAt, "
                "       r.duration_min AS durationMin, r.status, r.note, "
                "       r.order_id AS orderId "
                "FROM reservations r "
                "LEFT JOIN restaurant_tables t ON t.id = r.table_id "
                "LEFT JOIN customers c ON c.id = r.customer_id "
                "WHERE r.starts_at BETWEEN :from AND :to ORDER BY r.starts_at");
            stmt.bind(":from", from).bind(":to", to);
            return Json{{"reservations", stmt.rows()}, {"from", from}, {"to", to}};
        });

    server.registerHandler(
        std::string(protocol::method::kReservationsSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reservations.manage");

            const auto startsAt = getOr<Timestamp>(request.payload, "startsAt", 0);
            require(startsAt > 0, "Rezervasiya vaxtı tələb olunur");
            const auto partySize = getOr<std::int64_t>(request.payload, "partySize", 2);
            require(partySize > 0 && partySize <= 100, "Qonaq sayı 1-100 aralığında olmalıdır");
            const auto duration = getOr<std::int64_t>(request.payload, "durationMin", 90);
            require(duration > 0, "Müddət sıfırdan böyük olmalıdır");

            const auto tableId = getOr<std::string>(request.payload, "tableId", "");
            auto id = getOr<std::string>(request.payload, "id", "");

            // A table cannot be promised to two parties at once. Overlap is
            // checked on the stored window, not on a guessed turn time.
            if (!tableId.empty()) {
                auto clash = ctx->db().prepare(
                    "SELECT COUNT(*) FROM reservations "
                    "WHERE table_id = :table AND status IN ('booked','seated') "
                    "  AND id != :id "
                    "  AND starts_at < :endsAt "
                    "  AND (starts_at + duration_min * 60000) > :startsAt");
                clash.bind(":table", tableId).bind(":id", id).bind(":startsAt", startsAt)
                    .bind(":endsAt", startsAt + duration * 60000);
                clash.step();
                require(clash.columnInt(0) == 0, "Bu masa həmin vaxt üçün artıq rezerv olunub");
            }

            const auto now = nowMs();
            db::Transaction txn(ctx->db());
            if (id.empty()) {
                id = "res-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO reservations (id, table_id, customer_id, guest_name, guest_phone, "
                    "  party_size, starts_at, duration_min, note, actor_user_id, "
                    "  created_at, updated_at) "
                    "VALUES (:id, :table, :customer, :name, :phone, :party, :starts, :duration, "
                    "        :note, :actor, :now, :now)");
                insert.bind(":id", id)
                    .bindOptional(":table", tableId)
                    .bindOptional(":customer", getOr<std::string>(request.payload, "customerId", ""))
                    .bind(":name", getOr<std::string>(request.payload, "guestName", ""))
                    .bind(":phone", getOr<std::string>(request.payload, "guestPhone", ""))
                    .bind(":party", partySize).bind(":starts", startsAt).bind(":duration", duration)
                    .bind(":note", getOr<std::string>(request.payload, "note", ""))
                    .bindOptional(":actor", ctx->session().userId).bind(":now", now);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE reservations SET table_id = :table, customer_id = :customer, "
                    "  guest_name = :name, guest_phone = :phone, party_size = :party, "
                    "  starts_at = :starts, duration_min = :duration, note = :note, "
                    "  updated_at = :now WHERE id = :id");
                update.bindOptional(":table", tableId)
                    .bindOptional(":customer", getOr<std::string>(request.payload, "customerId", ""))
                    .bind(":name", getOr<std::string>(request.payload, "guestName", ""))
                    .bind(":phone", getOr<std::string>(request.payload, "guestPhone", ""))
                    .bind(":party", partySize).bind(":starts", startsAt).bind(":duration", duration)
                    .bind(":note", getOr<std::string>(request.payload, "note", ""))
                    .bind(":now", now).bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Rezervasiya tapılmadı");
            }
            ctx->audit("reservation.save", "reservation", id, Json{{"startsAt", startsAt}});
            txn.commit();
            return Json{{"id", id}, {"startsAt", startsAt}, {"status", "booked"}};
        });

    server.registerHandler(
        std::string(protocol::method::kReservationsSetStatus),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("reservations.manage");

            const auto id = getOr<std::string>(request.payload, "reservationId", "");
            const auto status = getOr<std::string>(request.payload, "status", "");
            require(!id.empty(), "reservationId is required");
            require(status == "booked" || status == "seated" || status == "completed" ||
                        status == "no_show" || status == "cancelled",
                    "Status tanınmadı");

            auto stmt = ctx->db().prepare(
                "UPDATE reservations SET status = :status, updated_at = :now WHERE id = :id");
            stmt.bind(":status", status).bind(":now", nowMs()).bind(":id", id);
            stmt.exec();
            require(ctx->db().changes() == 1, "Rezervasiya tapılmadı");

            ctx->audit("reservation.status", "reservation", id, Json{{"status", status}});
            return Json{{"id", id}, {"status", status}};
        });

    server.registerHandler(
        std::string(protocol::method::kReservationsSeat), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reservations.manage");

            const auto id = getOr<std::string>(request.payload, "reservationId", "");
            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            require(!id.empty(), "reservationId is required");
            require(!orderId.empty(), "orderId is required");

            // Recording the bill is what tells a no-show apart from a booking
            // that turned into a sale - which is the only reason to keep either.
            auto stmt = ctx->db().prepare(
                "UPDATE reservations SET status = 'seated', order_id = :order, updated_at = :now "
                "WHERE id = :id AND status = 'booked'");
            stmt.bind(":order", orderId).bind(":now", nowMs()).bind(":id", id);
            stmt.exec();
            require(ctx->db().changes() == 1, "Rezervasiya tapılmadı və ya artıq oturdulub");

            ctx->audit("reservation.seat", "reservation", id, Json{{"orderId", orderId}});
            return Json{{"id", id}, {"status", "seated"}, {"orderId", orderId}};
        });
}

}  // namespace pos::handlers
