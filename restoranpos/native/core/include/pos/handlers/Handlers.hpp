#pragma once

#include "pos/handlers/Context.hpp"

namespace pos::db {
class Database;
}

namespace pos::ipc {
class StdioServer;
}

namespace pos::handlers {

/** Wires every request handler onto the server. */
/** Lets a LAN terminal's call run as its own staff member (see Request::scoped). */
void installRequestScope(const std::shared_ptr<Context>& ctx);

void registerAll(ipc::StdioServer& server, db::Database& database);

/**
 * Resolves payments left mid-flight by a crash or power loss.
 *
 * Anything still in waiting_for_terminal/processing past its deadline is
 * promoted to `unknown` - never auto-declined, because the card may well have
 * been charged. Runs before the UI opens.
 */
void sweepPendingPayments(ipc::StdioServer& server, db::Database& database);

// Per-domain registration, called by registerAll.
void registerAuth(const ContextPtr& ctx);
void registerCatalog(const ContextPtr& ctx);
void registerTables(const ContextPtr& ctx);
void registerOrders(const ContextPtr& ctx);
void registerKitchen(const ContextPtr& ctx);
void registerPayments(const ContextPtr& ctx);
void registerPrinting(const ContextPtr& ctx);
/** Stock, recipes, suppliers and purchasing. */
void registerInventory(const ContextPtr& ctx);
/** Customers, house accounts, loyalty and table bookings. */
void registerGuests(const ContextPtr& ctx);
/** Deliveries, couriers, the staff rota and attendance. */
void registerDelivery(const ContextPtr& ctx);
/** Reports as CSV, which is what a spreadsheet opens. */
void registerExport(const ContextPtr& ctx);
void registerSystem(const ContextPtr& ctx);

/** Advances queued/retrying print jobs (TCP ESC/POS or virtual spool). */
int drainPrintQueue(Context& ctx);

}  // namespace pos::handlers
