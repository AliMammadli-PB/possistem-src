#include "pos/handlers/Handlers.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/db/Database.hpp"
#include "pos/ipc/StdioServer.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

}  // namespace

void installRequestScope(const std::shared_ptr<Context>& ctx) {
    // A LAN terminal's call runs as the terminal's own staff member, and leaves
    // whoever is signed in on this (host) PC exactly as they were.
    ctx->server().setRequestScope([ctx](const ipc::Request& request) -> std::function<void()> {
        Session saved = ctx->session();
        Session actor;
        if (!request.actorUserId.empty()) {
            auto user = ctx->db().prepare(
                "SELECT u.code, u.full_name, u.primary_role_id, r.name FROM users u "
                "JOIN roles r ON r.id = u.primary_role_id WHERE u.id = :id AND u.active = 1");
            user.bind(":id", request.actorUserId);
            if (!user.step()) {
                throw PosError(std::string(protocol::err::kUnauthorized),
                               "Terminal işçisi tapılmadı və ya deaktivdir");
            }
            actor.userId = request.actorUserId;
            actor.code = user.columnText(0);
            actor.fullName = user.columnText(1);
            actor.role = user.columnText(3);
            actor.authenticated = true;
            actor.loginAt = nowMs();
            ctx->loadPermissions(actor, user.columnText(2));
            // One shared drawer: terminals ring up on the host's open shift.
            auto shift = ctx->db().prepare(
                "SELECT id FROM shifts WHERE status = 'open' AND terminal_id = :terminal "
                "ORDER BY opened_at DESC LIMIT 1");
            shift.bind(":terminal", ctx->terminalId());
            if (shift.step()) actor.shiftId = shift.columnText(0);
        }
        ctx->session() = actor;
        return [ctx, saved]() { ctx->session() = saved; };
    });
}

void registerAll(ipc::StdioServer& server, db::Database& database) {
    // The context is owned by the handler closures, so it outlives this call
    // and lives exactly as long as the server does.
    auto ctx = std::make_shared<Context>(server, database);

    installRequestScope(ctx);

    registerAuth(ctx);
    registerCatalog(ctx);
    registerTables(ctx);
    registerOrders(ctx);
    registerKitchen(ctx);
    registerPayments(ctx);
    registerPrinting(ctx);
    registerInventory(ctx);
    registerGuests(ctx);
    registerDelivery(ctx);
    registerExport(ctx);
    registerSystem(ctx);
}

void sweepPendingPayments(ipc::StdioServer& server, db::Database& database) {
    const auto now = nowMs();

    // Anything still mid-flight past its deadline becomes `unknown`, never
    // `declined`: the card may genuinely have been charged, and only a human
    // with the terminal in front of them can say for sure.
    auto stale = database.prepare(
        "SELECT id, status FROM payments "
        "WHERE status IN ('waiting_for_terminal','processing') "
        "  AND (expires_at IS NULL OR expires_at < :now)");
    stale.bind(":now", now);

    struct Stranded {
        std::string id;
        std::string status;
    };
    std::vector<Stranded> stranded;
    while (stale.step()) stranded.push_back({stale.columnText(0), stale.columnText(1)});

    if (stranded.empty()) return;

    logger()->warn("promoting {} stranded payment(s) to unknown", stranded.size());

    db::Transaction txn(database);
    for (const auto& payment : stranded) {
        auto update = database.prepare(
            "UPDATE payments SET status = 'unknown', updated_at = :now WHERE id = :id");
        update.bind(":now", now).bind(":id", payment.id);
        update.exec();

        auto event = database.prepare(
            "INSERT INTO payment_events (id, payment_id, from_state, to_state, reason, created_at) "
            "VALUES (:id, :paymentId, :from, 'unknown', :reason, :now)");
        event.bind(":id", crypto::uuid4())
            .bind(":paymentId", payment.id)
            .bind(":from", payment.status)
            .bind(":reason", "Core restarted while the payment was in flight")
            .bind(":now", now);
        event.exec();
    }
    txn.commit();

    server.emitEvent(protocol::event::kPaymentNeedsReconciliation,
                     Json{{"count", static_cast<std::int64_t>(stranded.size())},
                          {"reason", "startup_sweep"}});
}

}  // namespace pos::handlers
