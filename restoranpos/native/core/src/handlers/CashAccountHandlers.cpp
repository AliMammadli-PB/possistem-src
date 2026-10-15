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
