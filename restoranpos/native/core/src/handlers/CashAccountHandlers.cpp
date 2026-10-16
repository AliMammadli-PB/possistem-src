/**
 * Kassalar: named tills, the treasury and the bank, grouped by branch.
 *
 * A till is tied to one sales point (the PC that rang the sale up, see
 * payments.terminal_id), so "how much did the second till take today" has an
 * answer. Balances are never stored: they are the sales since the kassa was
 * opened plus its moves (opening balance, transfers, salaries, debts...).
 */
#include <algorithm>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/Idempotency.hpp"

namespace pos::handlers {
namespace {

/** The branch's own warehouse, created (or an existing one of that name reused) on first need. */
std::string ensureObjectWarehouse(Context& ctx, const std::string& objectId) {
    auto row = ctx.db().prepare("SELECT name, COALESCE(warehouse_id, '') FROM cash_objects WHERE id = :id");
    row.bind(":id", objectId);
    if (!row.step()) return {};
    const std::string name = row.columnText(0);
    std::string warehouseId = row.columnText(1);
    if (!warehouseId.empty()) return warehouseId;
    auto existing = ctx.db().prepare("SELECT id FROM warehouses WHERE name = :name");
    existing.bind(":name", name);
    if (existing.step()) {
        warehouseId = existing.columnText(0);
    } else {
        warehouseId = "wh-" + crypto::uuid4().substr(0, 8);
        const auto now = nowMs();
        // After the main store, which stays the default for everything else.
        auto insert = ctx.db().prepare(
            "INSERT INTO warehouses (id, name, kind, active, sort_order, created_at, updated_at) "
            "VALUES (:id, :name, 'store', 1, 100, :now, :now)");
        insert.bind(":id", warehouseId).bind(":name", name).bind(":now", now);
        insert.exec();
    }
    auto link = ctx.db().prepare("UPDATE cash_objects SET warehouse_id = :wh WHERE id = :id");
    link.bind(":wh", warehouseId).bind(":id", objectId);
    link.exec();
    return warehouseId;
}

}  // namespace

void registerCashAccounts(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // Private desktop bridge. A physical Market register has one stable terminal
    // identity in the warehouse ledger; only newly-created accounts include the
    // full imported history. Existing opening balances and cutoffs stay intact.
    server.registerHandler("cashAccounts.syncMarket", [ctx](const ipc::Request& request) {
        ctx->requirePermission("cash.accounts");
        db::Transaction txn(ctx->db());
        bool changed = false;
        auto move = [&](const std::string& id, const std::string& account, Money amount,
                        const std::string& kind, const std::string& ref, const std::string& note,
                        std::int64_t at) {
            if (amount == 0 && kind != "opening") return;
            auto seen = ctx->db().prepare("SELECT account_id, amount_minor FROM cash_account_moves WHERE id=:id");
            seen.bind(":id", id);
            if (seen.step()) {
                require(seen.columnInt(1) == amount, "Kassa hərəkəti uyğun gəlmir");
                return;
            }
            auto insert = ctx->db().prepare(
                "INSERT INTO cash_account_moves(id,account_id,amount_minor,kind,ref_type,ref_id,note,actor_user_id,created_at) "
                "VALUES(:id,:account,:amount,:kind,'market_cash',:ref,:note,:actor,:at)");
            insert.bind(":id", id).bind(":account", account).bind(":amount", amount).bind(":kind", kind)
                .bind(":ref", ref).bind(":note", note).bindOptional(":actor", ctx->session().userId).bind(":at", at);
            insert.exec();
            changed = true;
        };
        for (const auto& r : request.payload.value("registers", Json::array())) {
            const auto id = r.value("id", std::string{});
            const auto name = r.value("name", std::string{});
            require(!id.empty() && !name.empty(), "Kassa məlumatı natamamdır");
            const auto terminal = "market-" + id;
            auto found = ctx->db().prepare(
                "SELECT id, name, created_at FROM cash_accounts WHERE kind='till' AND terminal_id=:terminal ORDER BY active DESC LIMIT 1");
            found.bind(":terminal", terminal);
            std::string account;
            bool fresh = false;
            if (found.step()) {
                account = found.columnText(0);
                fresh = found.columnInt(2) == 0;
                auto revive = ctx->db().prepare("UPDATE cash_accounts SET active=1 WHERE id=:id AND active=0");
                revive.bind(":id", account); revive.exec();
                if (ctx->db().changes() > 0) changed = true;
                if (found.columnText(1) != name) {
                    auto update = ctx->db().prepare("UPDATE cash_accounts SET name=:name WHERE id=:id");
                    update.bind(":name", name).bind(":id", account); update.exec(); changed = true;
                }
            } else {
                account = r.value("accountId", std::string{});
                if (!account.empty()) {
                    auto old = ctx->db().prepare(
                        "SELECT terminal_id FROM cash_accounts WHERE id=:id AND kind='till' AND active=1");
                    old.bind(":id", account);
                    require(old.step() && old.columnText(0).empty(), "Kassa artıq başqa satış nöqtəsinə bağlıdır");
                    auto link = ctx->db().prepare("UPDATE cash_accounts SET terminal_id=:terminal WHERE id=:id");
                    link.bind(":terminal", terminal).bind(":id", account); link.exec();
                } else {
                    account = "kas-" + crypto::uuid4().substr(0, 8);
                    auto insert = ctx->db().prepare(
                        "INSERT INTO cash_accounts(id,name,kind,terminal_id,created_at) VALUES(:id,:name,'till',:terminal,0)");
                    insert.bind(":id", account).bind(":name", name).bind(":terminal", terminal); insert.exec();
                    fresh = true;
                }
                changed = true;
            }
            auto terminalRow = ctx->db().prepare(
                "INSERT INTO pos_terminals(id,name,last_seen_at) VALUES(:id,:name,0) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE name != excluded.name");
            terminalRow.bind(":id", terminal).bind(":name", name); terminalRow.exec();
            if (fresh) {
                const auto opening = r.value("firstOpeningMinor", Money{0});
                require(opening >= 0, "İlkin qalıq mənfi ola bilməz");
                auto seeded = ctx->db().prepare("SELECT 1 FROM cash_account_moves WHERE id=:id");
                seeded.bind(":id", "market-opening-" + id);
                if (!seeded.step()) move("market-opening-" + id, account, opening, "opening", id, "Market ilkin qalıq", 0);
            }
        }
        // Card takings need a bank ledger too. Do not duplicate an existing bank.
        auto bank = ctx->db().prepare("SELECT id FROM cash_accounts WHERE active=1 AND kind='bank' LIMIT 1");
        if (!bank.step()) {
            auto insert = ctx->db().prepare(
                "INSERT INTO cash_accounts(id,name,kind,terminal_id,created_at) VALUES(:id,'Market · Bank','bank','',0)");
            insert.bind(":id", "kas-" + crypto::uuid4().substr(0, 8)); insert.exec(); changed = true;
        }
        for (const auto& m : request.payload.value("movements", Json::array())) {
            const auto id = m.value("id", std::string{});
            const auto registerId = m.value("registerId", std::string{});
            const auto kind = m.value("kind", std::string{});
            const auto amount = m.value("amountMinor", Money{0});
            require(!id.empty() && amount > 0 && (kind == "cash_in" || kind == "cash_out" || kind == "safe_drop"), "Kassa hərəkəti düzgün deyil");
            auto booked = ctx->db().prepare("SELECT amount_minor FROM cash_account_moves WHERE id=:id");
            booked.bind(":id", "market-cash-" + id);
            if (booked.step()) {
                require(booked.columnInt(0) == (kind == "cash_in" ? amount : -amount), "Kassa hərəkəti uyğun gəlmir");
                continue;
            }
            auto account = ctx->db().prepare(
                "SELECT id, COALESCE(object_id,''), created_at FROM cash_accounts "
                "WHERE active=1 AND kind='till' AND terminal_id=:terminal");
            account.bind(":terminal", "market-" + registerId);
            require(account.step(), "Satış kassası anbara bağlanmayıb");
            const auto at = m.value("createdAt", std::int64_t{0});
            if (at < account.columnInt(2)) continue; // included in this existing account's opening balance
            const auto accountId = account.columnText(0);
            const auto objectId = account.columnText(1);
            const auto note = m.value("reason", std::string{});
            move("market-cash-" + id, accountId, kind == "cash_in" ? amount : -amount, kind, id, note, at);
            if (kind == "safe_drop") {
                auto safe = ctx->db().prepare(
                    "SELECT id FROM cash_accounts WHERE active=1 AND kind='treasury' AND COALESCE(object_id,'')=:object ORDER BY id LIMIT 1");
                safe.bind(":object", objectId);
                std::string safeId;
                if (safe.step()) safeId = safe.columnText(0);
                else {
                    safeId = "kas-" + crypto::uuid4().substr(0, 8);
                    auto insert = ctx->db().prepare(
                        "INSERT INTO cash_accounts(id,name,kind,object_id,terminal_id,created_at) VALUES(:id,'Market · Seyf','treasury',:object,'',0)");
                    insert.bind(":id", safeId).bindOptional(":object", objectId); insert.exec(); changed = true;
                }
                move("market-safe-" + id, safeId, amount, "transfer_in", id, note, at);
            }
        }
        if (changed) ctx->auditRequired("market.cash.sync", "cash_account", "market", Json::object());
        auto external = ctx->db().prepare(
            "SELECT m.id, substr(a.terminal_id,8) AS registerId, m.amount_minor AS amountMinor, "
            "COALESCE(m.note,'') AS reason, m.created_at AS createdAt FROM cash_account_moves m "
            "JOIN cash_accounts a ON a.id=m.account_id WHERE a.active=1 AND a.kind='till' "
            "AND a.terminal_id GLOB 'market-*' AND m.ref_type!='market_cash' AND m.kind!='opening' "
            "ORDER BY m.created_at,m.id");
        auto movements = external.rows();
        auto linked = ctx->db().prepare(
            "SELECT id AS accountId, substr(terminal_id,8) AS registerId FROM cash_accounts "
            "WHERE active=1 AND kind='till' AND terminal_id GLOB 'market-*' ORDER BY terminal_id,id");
        auto balances = linked.rows();
        services::CashService cash(*ctx);
        for (auto& row : balances) row["balanceMinor"] = cash.accountBalance(row.value("accountId", std::string{}));
        txn.commit();
        return Json{{"ok", true}, {"movements", movements}, {"balances", balances}};
    });

    server.registerHandler(
        std::string(protocol::method::kCashAccountsList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.manage");
            ctx->touchTerminal();
            // The day the screen asks about (local midnight to midnight).
            const auto from = getOr<std::int64_t>(request.payload, "from", 0);
            const auto to = getOr<std::int64_t>(request.payload, "to", nowMs() + 1);
            services::CashService cash(*ctx);

            auto stmt = ctx->db().prepare(
                "SELECT a.id, a.name, a.kind, COALESCE(a.object_id, '') AS objectId, "
                "       COALESCE(o.name, '') AS objectName, a.terminal_id AS terminalId, "
                "       COALESCE(t.name, '') AS terminalName, a.created_at AS createdAt "
                "FROM cash_accounts a "
                "LEFT JOIN cash_objects o ON o.id = a.object_id "
                "LEFT JOIN pos_terminals t ON t.id = a.terminal_id "
                "WHERE a.active = 1 "
                "ORDER BY COALESCE(o.name, ''), CASE a.kind WHEN 'till' THEN 0 WHEN 'bank' THEN 1 ELSE 2 END, a.name");
            auto accounts = stmt.rows();
            for (auto& row : accounts) {
                const auto id = row.value("id", std::string{});
                const auto kind = row.value("kind", std::string{});
                const auto terminal = row.value("terminalId", std::string{});
                row["balanceMinor"] = cash.accountBalance(id);
                Money todayCash = 0;
                Money todayCard = 0;
                if (kind == "till" && !terminal.empty()) {
                    todayCash = cash.takingsFor("cash", "p.terminal_id = :terminal", terminal, from, to);
                    todayCard = cash.takingsFor("card", "p.terminal_id = :terminal", terminal, from, to);
                } else if (kind == "bank") {
                    const auto object = row.value("objectId", std::string{});
                    todayCard = cash.takingsFor("card", services::CashService::bankScope(object), object, from, to);
                }
                row["todayCashMinor"] = todayCash;
                row["todayCardMinor"] = todayCard;
            }

            {
                // Branches made before 1.7.26 get their store room here.
                auto bare = ctx->db().prepare(
                    "SELECT id FROM cash_objects WHERE active = 1 AND warehouse_id IS NULL");
                std::vector<std::string> ids;
                while (bare.step()) ids.push_back(bare.columnText(0));
                for (const auto& objectId : ids) ensureObjectWarehouse(*ctx, objectId);
            }
            auto objects = ctx->db().prepare(
                "SELECT id, name, COALESCE(warehouse_id, '') AS warehouseId FROM cash_objects "
                "WHERE active = 1 ORDER BY name");
            auto terminals = ctx->db().prepare(
                "SELECT id, name, last_seen_at AS lastSeenAt FROM pos_terminals ORDER BY name");
            auto terminalRows = terminals.rows();
            const auto current = ctx->saleTerminalId();
            for (auto& t : terminalRows) t["current"] = t.value("id", std::string{}) == current;

            // Sales points that took money today but feed no till: the owner
            // would otherwise never see that money in any kassa.
            auto loose = ctx->db().prepare(
                "SELECT p.terminal_id AS terminalId, COALESCE(t.name, p.terminal_id) AS name, "
                "  COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount_minor ELSE 0 END), 0) AS cashMinor, "
                "  COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_minor ELSE 0 END), 0) AS cardMinor "
                "FROM payments p LEFT JOIN pos_terminals t ON t.id = p.terminal_id "
                "WHERE p.status = 'approved' AND p.created_at >= :from AND p.created_at < :to "
                "  AND p.terminal_id != '' AND p.terminal_id NOT IN (SELECT terminal_id FROM cash_accounts "
                "                            WHERE active = 1 AND kind = 'till') "
                "GROUP BY p.terminal_id");
            loose.bind(":from", from).bind(":to", to);

            return Json{{"accounts", accounts},
                        {"objects", objects.rows()},
                        {"terminals", terminalRows},
                        {"currentTerminalId", current},
                        {"unassigned", loose.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kCashAccountsSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.accounts");
            auto id = getOr<std::string>(request.payload, "id", "");
            const auto name = getOr<std::string>(request.payload, "name", "");
            const auto kind = getOr<std::string>(request.payload, "kind", "till");
            const auto objectId = getOr<std::string>(request.payload, "objectId", "");
            const auto terminalId = kind == "till" ? getOr<std::string>(request.payload, "terminalId", "") : std::string{};
            const auto opening = getOr<Money>(request.payload, "openingMinor", 0);
            require(!name.empty(), "Kassanın adını yazın");
            require(kind == "till" || kind == "treasury" || kind == "bank", "Kassanın növü tanınmadı");
            require(opening >= 0, "İlkin qalıq mənfi ola bilməz");

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            if (auto replay = idem.begin(request.idempotencyKey, "cashAccounts.save", request.payload)) return *replay;
            if (!objectId.empty()) {
                auto object = ctx->db().prepare("SELECT 1 FROM cash_objects WHERE id = :id AND active = 1");
                object.bind(":id", objectId);
                require(object.step(), "Obyekt tapılmadı");
            }
            if (!id.empty()) {
                auto old = ctx->db().prepare("SELECT terminal_id FROM cash_accounts WHERE id=:id AND active=1");
                old.bind(":id", id);
                if (old.step() && old.columnText(0).rfind("market-", 0) == 0)
                    require(terminalId == old.columnText(0), "Satış kassasının əlaqəsini dəyişmək olmaz; adını və filialını dəyişə bilərsiniz");
            }
            if (!terminalId.empty()) {
                auto taken = ctx->db().prepare(
                    "SELECT name FROM cash_accounts WHERE terminal_id = :terminal AND kind = 'till' "
                    "AND active = 1 AND id != :id");
                taken.bind(":terminal", terminalId).bind(":id", id);
                if (taken.step()) {
                    throw PosError(std::string(protocol::err::kValidation),
                                   "Bu satış nöqtəsi artıq \"" + taken.columnText(0) + "\" kassasına bağlıdır");
                }
            }
            const auto now = nowMs();
            if (id.empty()) {
                id = "kas-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO cash_accounts (id, name, kind, object_id, terminal_id, created_at) "
                    "VALUES (:id, :name, :kind, :object, :terminal, :now)");
                insert.bind(":id", id).bind(":name", name).bind(":kind", kind)
                    .bindOptional(":object", objectId).bind(":terminal", terminalId).bind(":now", now);
                insert.exec();
                // What was in the drawer the day the program went in.
                services::CashService(*ctx).accountMove(id, opening, "opening", "", "", "İlkin qalıq");
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE cash_accounts SET name = :name, object_id = :object, terminal_id = :terminal "
                    "WHERE id = :id AND active = 1");
                update.bind(":name", name).bindOptional(":object", objectId).bind(":terminal", terminalId)
                    .bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Kassa tapılmadı");
            }
            ctx->auditRequired("cash.account.save", "cash_account", id,
                               Json{{"name", name}, {"kind", kind}, {"terminalId", terminalId}});
            Json response{{"id", id}, {"name", name}, {"kind", kind}};
            idem.complete(request.idempotencyKey, response, "cash_account", id);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kCashAccountsDeactivate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.accounts");
            const auto id = getOr<std::string>(request.payload, "accountId", "");
            require(!id.empty(), "accountId is required");
            db::Transaction txn(ctx->db());
            auto linked = ctx->db().prepare("SELECT terminal_id FROM cash_accounts WHERE id=:id");
            linked.bind(":id", id);
            require(!linked.step() || linked.columnText(0).rfind("market-", 0) != 0,
                    "Bu hesab satış kassasına bağlıdır; onu ayrıca silmək olmaz");
            const Money balance = services::CashService(*ctx).accountBalance(id);
            require(balance == 0, "Kassada pul var — əvvəlcə transfer edin");
            auto update = ctx->db().prepare("UPDATE cash_accounts SET active = 0 WHERE id = :id AND active = 1");
            update.bind(":id", id);
            update.exec();
            require(ctx->db().changes() == 1, "Kassa tapılmadı");
            ctx->auditRequired("cash.account.deactivate", "cash_account", id, Json::object());
            txn.commit();
            return Json{{"ok", true}};
        });

    server.registerHandler(
        std::string(protocol::method::kCashAccountsMoves), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.manage");
            const auto id = getOr<std::string>(request.payload, "accountId", "");
            require(!id.empty(), "accountId is required");
            auto stmt = ctx->db().prepare(
                "SELECT m.id, m.amount_minor AS amountMinor, m.kind, m.ref_type AS refType, m.note, "
                "       u.full_name AS actorName, m.created_at AS createdAt "
                "FROM cash_account_moves m LEFT JOIN users u ON u.id = m.actor_user_id "
                "WHERE m.account_id = :id AND m.created_at >= :from AND m.created_at < :to "
                "  AND (:kind = '' OR m.kind = :kind) AND (:q = '' OR m.note LIKE :like OR m.kind LIKE :like) "
                "ORDER BY m.created_at DESC LIMIT 5000");
            const auto q = getOr<std::string>(request.payload, "search", "");
            stmt.bind(":id", id).bind(":from", getOr<std::int64_t>(request.payload, "from", 0))
                .bind(":to", getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000LL))
                .bind(":kind", getOr<std::string>(request.payload, "kind", "")).bind(":q", q).bind(":like", "%" + q + "%");
            return Json{{"accountId", id},
                        {"balanceMinor", services::CashService(*ctx).accountBalance(id)},
                        {"moves", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kCashAccountsTransfer), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.accounts");
            const auto fromId = getOr<std::string>(request.payload, "fromId", "");
            const auto toId = getOr<std::string>(request.payload, "toId", "");
            const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
            const auto note = getOr<std::string>(request.payload, "note", "");
            require(!fromId.empty() && !toId.empty() && fromId != toId, "İki fərqli kassa seçin");
            require(amount > 0, "Məbləğ sıfırdan böyük olmalıdır");

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            if (auto replay = idem.begin(request.idempotencyKey, "cashAccounts.transfer", request.payload)) return *replay;
            services::CashService cash(*ctx);
            require(cash.accountBalance(fromId) >= amount, "Kassada bu qədər pul yoxdur");
            const auto ref = crypto::uuid4();
            cash.accountMove(fromId, -amount, "transfer", "transfer", ref, note);
            cash.accountMove(toId, amount, "transfer", "transfer", ref, note);
            ctx->auditRequired("cash.account.transfer", "cash_account", fromId,
                               Json{{"toId", toId}, {"amountMinor", amount}});
            Json response{{"ok", true}, {"transferId", ref},
                          {"fromBalanceMinor", cash.accountBalance(fromId)},
                          {"toBalanceMinor", cash.accountBalance(toId)}};
            idem.complete(request.idempotencyKey, response, "cash_account", fromId);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kCashObjectsSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("cash.accounts");
            auto id = getOr<std::string>(request.payload, "id", "");
            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Obyektin adını yazın");
            if (id.empty()) {
                id = "obj-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO cash_objects (id, name, created_at) VALUES (:id, :name, :now)");
                insert.bind(":id", id).bind(":name", name).bind(":now", nowMs());
                insert.exec();
                ensureObjectWarehouse(*ctx, id);
            } else {
                auto update = ctx->db().prepare("UPDATE cash_objects SET name = :name WHERE id = :id");
                update.bind(":name", name).bind(":id", id);
                update.exec();
            }
            ctx->audit("cash.object.save", "cash_object", id, Json{{"name", name}});
            auto wh = ctx->db().prepare("SELECT COALESCE(warehouse_id, '') FROM cash_objects WHERE id = :id");
            wh.bind(":id", id);
            return Json{{"id", id}, {"name", name}, {"warehouseId", wh.step() ? wh.columnText(0) : std::string{}}};
        });
}

}  // namespace pos::handlers
