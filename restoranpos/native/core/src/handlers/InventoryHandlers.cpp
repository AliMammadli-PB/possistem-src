/**
 * Stock, recipes, suppliers and purchasing.
 *
 * A restaurant buys ingredients and sells dishes, so stock lives on its own
 * catalogue and a recipe is what joins the two. Everything that changes a
 * balance goes through InventoryService::move, which writes the ledger row and
 * the projection together - so a discrepancy can always be traced to a cause.
 */
#include <algorithm>
#include <cstdio>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/Idempotency.hpp"

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

/** Where stock moves by default when a caller does not say. */
std::string defaultWarehouse(Context& ctx) {
    auto stmt = ctx.db().prepare(
        "SELECT id FROM warehouses WHERE active = 1 ORDER BY sort_order, id LIMIT 1");
    if (!stmt.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Anbar yoxdur");
    }
    return stmt.columnText(0);
}

std::string warehouseFrom(Context& ctx, const Json& payload, const char* key = "warehouseId") {
    const auto given = getOr<std::string>(payload, key, "");
    return given.empty() ? defaultWarehouse(ctx) : given;
}

}  // namespace

void registerInventory(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // ------------------------------------------------------------- warehouses
    server.registerHandler(
        std::string(protocol::method::kWarehousesList), [ctx](const ipc::Request&) {
            ctx->requirePermission("inventory.view");
            auto stmt = ctx->db().prepare(
                "SELECT id, name, kind, active, sort_order AS sortOrder FROM warehouses "
                "ORDER BY sort_order, name");
            return Json{{"warehouses", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kWarehousesSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.manage");

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Anbar adı tələb olunur");
            auto id = getOr<std::string>(request.payload, "id", "");
            const auto kind = getOr<std::string>(request.payload, "kind", "store");
            const auto sortOrder = getOr<std::int64_t>(request.payload, "sortOrder", 0);
            const bool active = getOr<bool>(request.payload, "active", true);
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "warehouses.save", request.payload)) return *replay;
            if (id.empty()) {
                require(active, "Yeni anbar aktiv olmalıdır");
                id = "wh-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO warehouses (id, name, kind, sort_order, created_at, updated_at) "
                    "VALUES (:id, :name, :kind, :sort, :now, :now)");
                insert.bind(":id", id).bind(":name", name).bind(":kind", kind)
                    .bind(":sort", sortOrder).bind(":now", now);
                insert.exec();
            } else {
                if (!active) {
                    auto stock = ctx->db().prepare(
                        "SELECT COALESCE(SUM(qty_milli), 0) FROM stock_levels WHERE warehouse_id = :id");
                    stock.bind(":id", id);
                    stock.step();
                    require(stock.columnInt(0) == 0, "Qalıq olan anbar bağlana bilməz");
                }
                auto update = ctx->db().prepare(
                    "UPDATE warehouses SET name = :name, kind = :kind, sort_order = :sort, "
                    "                      active = :active, updated_at = :now WHERE id = :id");
                update.bind(":name", name).bind(":kind", kind).bind(":sort", sortOrder)
                    .bind(":active", active ? 1 : 0).bind(":now", now).bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Anbar tapılmadı");
            }
            ctx->audit("warehouse.save", "warehouse", id, Json{{"name", name}});
            Json response{{"id", id}, {"name", name}, {"kind", kind}, {"active", active}};
            idem.complete(key, response, "warehouse", id);
            txn.commit();
            return response;
        });

    // ------------------------------------------------------------ ingredients
    server.registerHandler(
        std::string(protocol::method::kIngredientsList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            const auto search = getOr<std::string>(request.payload, "search", "");
            auto stmt = ctx->db().prepare(
                "SELECT i.id, i.sku, i.name, i.unit, i.cost_minor AS costMinor, "
                "       i.min_qty_milli AS minQtyMilli, i.barcode, i.active, "
                "       COALESCE((SELECT SUM(qty_milli) FROM stock_levels s "
                "                  WHERE s.ingredient_id = i.id), 0) AS qtyMilli "
                "FROM ingredients i "
                // Parenthesised: without it the AND binds tighter and an empty
                // search would return every row twice over.
                "WHERE i.active = 1 AND (:search = '' OR i.name LIKE :like OR i.sku LIKE :like) "
                "ORDER BY i.name");
            stmt.bind(":search", search).bind(":like", "%" + search + "%");
            return Json{{"ingredients", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kIngredientsSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.manage");

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Ad tələb olunur");
            const auto unit = getOr<std::string>(request.payload, "unit", "kg");
            require(unit == "kg" || unit == "l" || unit == "ədəd" || unit == "qab" || unit == "q",
                    "Ölçü vahidi tanınmadı");

            auto id = getOr<std::string>(request.payload, "id", "");
            auto sku = getOr<std::string>(request.payload, "sku", "");
            const auto costMinor = getOr<std::int64_t>(request.payload, "costMinor", 0);
            const auto minQty = getOr<std::int64_t>(request.payload, "minQtyMilli", 0);
            const auto barcode = getOr<std::string>(request.payload, "barcode", "");
            require(costMinor >= 0, "Maya dəyəri mənfi ola bilməz");
            require(minQty >= 0, "Minimum miqdar mənfi ola bilməz");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "ingredients.save", request.payload)) return *replay;
            if (id.empty()) {
                id = "ing-" + crypto::uuid4().substr(0, 8);
                if (sku.empty()) sku = "ING-" + id.substr(4);
                auto insert = ctx->db().prepare(
                    "INSERT INTO ingredients (id, sku, name, unit, cost_minor, min_qty_milli, "
                    "                         barcode, created_at, updated_at) "
                    "VALUES (:id, :sku, :name, :unit, :cost, :min, :barcode, :now, :now)");
                insert.bind(":id", id).bind(":sku", sku).bind(":name", name).bind(":unit", unit)
                    .bind(":cost", costMinor).bind(":min", minQty).bind(":barcode", barcode)
                    .bind(":now", now);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE ingredients SET name = :name, unit = :unit, cost_minor = :cost, "
                    "                       min_qty_milli = :min, barcode = :barcode, "
                    "                       updated_at = :now WHERE id = :id");
                update.bind(":name", name).bind(":unit", unit).bind(":cost", costMinor)
                    .bind(":min", minQty).bind(":barcode", barcode).bind(":now", now)
                    .bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "İnqrediyent tapılmadı");
            }
            ctx->audit("ingredient.save", "ingredient", id, Json{{"name", name}});
            Json response{{"id", id}, {"sku", sku}, {"name", name}, {"unit", unit}};
            idem.complete(key, response, "ingredient", id);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kIngredientsDeactivate),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.manage");
            const auto id = getOr<std::string>(request.payload, "ingredientId", "");
            require(!id.empty(), "ingredientId is required");

            // Deactivated rather than deleted: past movements and recipes still
            // reference it, and a stock report for last month must still read.
            auto stmt = ctx->db().prepare(
                "UPDATE ingredients SET active = 0, updated_at = :now WHERE id = :id AND active = 1");
            stmt.bind(":now", nowMs()).bind(":id", id);
            stmt.exec();
            require(ctx->db().changes() == 1, "İnqrediyent tapılmadı");
            ctx->auditRequired("ingredient.deactivate", "ingredient", id, Json::object());
            return Json{{"ok", true}, {"ingredientId", id}};
        });

    // ------------------------------------------------------------------ stock
    server.registerHandler(
        std::string(protocol::method::kInventoryLevels), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            return services::InventoryService(*ctx).levels(warehouseFrom(*ctx, request.payload));
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryLowStock), [ctx](const ipc::Request&) {
            ctx->requirePermission("inventory.view");
            return services::InventoryService(*ctx).lowStock();
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryValuation), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            return services::InventoryService(*ctx).valuation(
                getOr<std::string>(request.payload, "warehouseId", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryMovements), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
            const auto limit =
                std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 100), 500);

            auto stmt = ctx->db().prepare(
                "SELECT m.id, m.ingredient_id AS ingredientId, i.name AS ingredientName, "
                "       m.warehouse_id AS warehouseId, w.name AS warehouseName, m.kind, "
                "       m.qty_delta_milli AS qtyDeltaMilli, m.reference_id AS referenceId, "
                "       m.reason, u.full_name AS actorName, m.created_at AS createdAt "
                "FROM stock_movements m "
                "JOIN ingredients i ON i.id = m.ingredient_id "
                "JOIN warehouses w ON w.id = m.warehouse_id "
                "LEFT JOIN users u ON u.id = m.actor_user_id "
                "WHERE (:ingredient = '' OR m.ingredient_id = :ingredient) "
                "ORDER BY m.created_at DESC LIMIT :limit");
            stmt.bind(":ingredient", ingredientId).bind(":limit", limit);
            return Json{{"movements", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryAdjust), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.adjust");

            const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
            const auto delta = getOr<std::int64_t>(request.payload, "qtyDeltaMilli", 0);
            const auto reason = getOr<std::string>(request.payload, "reason", "");
            require(!ingredientId.empty(), "ingredientId is required");
            require(!reason.empty(), "Düzəliş üçün səbəb tələb olunur");

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "inventory.adjust", request.payload)) return *replay;
            auto result = services::InventoryService(*ctx).move(
                ingredientId, warehouseFrom(*ctx, request.payload), delta, "adjustment", "", reason);
            ctx->auditRequired("inventory.adjust", "ingredient", ingredientId,
                               Json{{"qtyDeltaMilli", delta}, {"reason", reason}});
            idem.complete(key, result, "ingredient", ingredientId);
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryWaste), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.adjust");

            const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
            const auto qty = getOr<std::int64_t>(request.payload, "qtyMilli", 0);
            const auto reason = getOr<std::string>(request.payload, "reason", "");
            require(!ingredientId.empty(), "ingredientId is required");
            require(qty > 0, "Miqdar sıfırdan böyük olmalıdır");
            require(!reason.empty(), "İtki üçün səbəb tələb olunur");

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "inventory.waste", request.payload)) return *replay;
            // Waste is its own kind, not a negative adjustment: "what did we
            // throw away this month" is a question an owner actually asks.
            auto result = services::InventoryService(*ctx).move(
                ingredientId, warehouseFrom(*ctx, request.payload), -qty, "waste", "", reason);
            ctx->auditRequired("inventory.waste", "ingredient", ingredientId,
                               Json{{"qtyMilli", qty}, {"reason", reason}});
            idem.complete(key, result, "ingredient", ingredientId);
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryTransfer), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.transfer");

            const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
            const auto fromId = getOr<std::string>(request.payload, "fromWarehouseId", "");
            const auto toId = getOr<std::string>(request.payload, "toWarehouseId", "");
            const auto qty = getOr<std::int64_t>(request.payload, "qtyMilli", 0);
            require(!ingredientId.empty(), "ingredientId is required");
            require(!fromId.empty() && !toId.empty(), "İki anbar seçilməlidir");
            require(fromId != toId, "Eyni anbara transfer edilə bilməz");
            require(qty > 0, "Miqdar sıfırdan böyük olmalıdır");

            // Both legs in one transaction, so stock can never be in neither
            // place: a transfer that half-applied would be invisible loss.
            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "inventory.transfer", request.payload)) return *replay;
            services::InventoryService inventory(*ctx);
            const std::string reference = crypto::uuid4();
            auto out = inventory.move(ingredientId, fromId, -qty, "transfer_out", reference,
                                      "transfer");
            auto in = inventory.move(ingredientId, toId, qty, "transfer_in", reference, "transfer");
            ctx->auditRequired("inventory.transfer", "ingredient", ingredientId,
                               Json{{"from", fromId}, {"to", toId}, {"qtyMilli", qty}});
            Json response{{"out", out}, {"in", in}, {"referenceId", reference}};
            idem.complete(key, response, "ingredient", ingredientId);
            txn.commit();

            return response;
        });

    // ------------------------------------------------------------- stocktake
    server.registerHandler(
        std::string(protocol::method::kStocktakeCreate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");

            const auto warehouseId = warehouseFrom(*ctx, request.payload);
            const auto note = getOr<std::string>(request.payload, "note", "");
            const std::string id = "st-" + crypto::uuid4().substr(0, 8);
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            auto insert = ctx->db().prepare(
                "INSERT INTO stocktakes (id, warehouse_id, note, actor_user_id, created_at) "
                "VALUES (:id, :warehouse, :note, :actor, :now)");
            insert.bind(":id", id).bind(":warehouse", warehouseId).bind(":note", note)
                .bindOptional(":actor", ctx->session().userId).bind(":now", now);
            insert.exec();

            // Every active ingredient gets a line with what the system believes
            // is there. Counting is then a matter of typing what is actually on
            // the shelf, and the difference is the whole point of the exercise.
            auto lines = ctx->db().prepare(
                "INSERT INTO stocktake_lines (id, stocktake_id, ingredient_id, expected_milli) "
                "SELECT lower(hex(randomblob(16))), :id, i.id, "
                "       COALESCE((SELECT qty_milli FROM stock_levels s "
                "                  WHERE s.ingredient_id = i.id AND s.warehouse_id = :warehouse), 0) "
                "FROM ingredients i WHERE i.active = 1");
            lines.bind(":id", id).bind(":warehouse", warehouseId);
            lines.exec();

            ctx->auditRequired("stocktake.create", "stocktake", id,
                               Json{{"warehouseId", warehouseId}});
            txn.commit();
            return Json{{"id", id}, {"warehouseId", warehouseId}, {"status", "open"}};
        });

    server.registerHandler(
        std::string(protocol::method::kStocktakeList), [ctx](const ipc::Request&) {
            ctx->requirePermission("inventory.count");
            auto stmt = ctx->db().prepare(
                "SELECT s.id, s.warehouse_id AS warehouseId, w.name AS warehouseName, s.status, "
                "       s.note, u.full_name AS actorName, s.created_at AS createdAt, "
                "       s.posted_at AS postedAt "
                "FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id "
                "LEFT JOIN users u ON u.id = s.actor_user_id "
                "ORDER BY s.created_at DESC LIMIT 50");
            return Json{{"stocktakes", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kStocktakeGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");
            const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
            require(!id.empty(), "stocktakeId is required");

            auto head = ctx->db().prepare(
                "SELECT id, warehouse_id AS warehouseId, status, note, created_at AS createdAt, "
                "       posted_at AS postedAt FROM stocktakes WHERE id = :id");
            head.bind(":id", id);
            if (!head.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "İnventarizasiya tapılmadı");
            }
            Json result = head.row();

            auto lines = ctx->db().prepare(
                "SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, "
                "       l.expected_milli AS expectedMilli, l.counted_milli AS countedMilli "
                "FROM stocktake_lines l JOIN ingredients i ON i.id = l.ingredient_id "
                "WHERE l.stocktake_id = :id ORDER BY i.name");
            lines.bind(":id", id);
            result["lines"] = lines.rows();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kStocktakeCount), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");

            const auto lineId = getOr<std::string>(request.payload, "lineId", "");
            require(!lineId.empty(), "lineId is required");
            require(request.payload.contains("countedMilli"), "countedMilli is required");
            const auto counted = getOr<std::int64_t>(request.payload, "countedMilli", 0);
            require(counted >= 0, "Sayılan miqdar mənfi ola bilməz");

            auto stmt = ctx->db().prepare(
                "UPDATE stocktake_lines SET counted_milli = :counted WHERE id = :id "
                "  AND stocktake_id IN (SELECT id FROM stocktakes WHERE status = 'open')");
            stmt.bind(":counted", counted).bind(":id", lineId);
            stmt.exec();
            require(ctx->db().changes() == 1, "Sətir tapılmadı və ya inventarizasiya bağlıdır");

            return Json{{"lineId", lineId}, {"countedMilli", counted}};
        });

    server.registerHandler(
        std::string(protocol::method::kStocktakePost), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");

            const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
            require(!id.empty(), "stocktakeId is required");

            auto head = ctx->db().prepare(
                "SELECT warehouse_id, status FROM stocktakes WHERE id = :id");
            head.bind(":id", id);
            require(head.step(), "İnventarizasiya tapılmadı");
            const std::string warehouseId = head.columnText(0);
            require(head.columnText(1) == "open", "Bu inventarizasiya artıq bağlanıb");

            // Only counted lines move stock. An uncounted line means "we did not
            // get to that shelf", which must not be read as "there is none".
            auto lines = ctx->db().prepare(
                "SELECT ingredient_id, expected_milli, counted_milli FROM stocktake_lines "
                "WHERE stocktake_id = :id AND counted_milli IS NOT NULL");
            lines.bind(":id", id);

            struct Diff {
                std::string ingredientId;
                std::int64_t delta;
            };
            std::vector<Diff> diffs;
            while (lines.step()) {
                const auto delta = lines.columnInt(2) - lines.columnInt(1);
                if (delta != 0) diffs.push_back({lines.columnText(0), delta});
            }

            db::Transaction txn(ctx->db());
            services::InventoryService inventory(*ctx);
            for (const auto& diff : diffs) {
                inventory.move(diff.ingredientId, warehouseId, diff.delta, "stocktake", id,
                               "inventarizasiya fərqi");
            }

            auto close = ctx->db().prepare(
                "UPDATE stocktakes SET status = 'posted', posted_at = :now WHERE id = :id");
            close.bind(":now", nowMs()).bind(":id", id);
            close.exec();

            ctx->auditRequired("stocktake.post", "stocktake", id,
                               Json{{"adjusted", static_cast<std::int64_t>(diffs.size())}});
            txn.commit();
            logger()->info("stocktake {} posted with {} adjustment(s)", id, diffs.size());

            return Json{{"id", id}, {"status", "posted"},
                        {"adjusted", static_cast<std::int64_t>(diffs.size())}};
        });

    // -------------------------------------------------------------- suppliers
    server.registerHandler(
        std::string(protocol::method::kSuppliersList), [ctx](const ipc::Request&) {
            ctx->requirePermission("suppliers.view");
            auto stmt = ctx->db().prepare(
                "SELECT s.id, s.name, s.contact, s.phone, s.tax_id AS taxId, s.note, s.active, "
                "       COALESCE((SELECT SUM(CASE WHEN l.kind = 'charge' THEN l.amount_minor "
                "                                 ELSE -l.amount_minor END) "
                "                 FROM supplier_ledger l WHERE l.supplier_id = s.id), 0) AS dueMinor "
                "FROM suppliers s WHERE s.active = 1 ORDER BY s.name");
            return Json{{"suppliers", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kSuppliersSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("suppliers.manage");

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Təchizatçı adı tələb olunur");
            auto id = getOr<std::string>(request.payload, "id", "");
            const auto contact = getOr<std::string>(request.payload, "contact", "");
            const auto phone = getOr<std::string>(request.payload, "phone", "");
            const auto taxId = getOr<std::string>(request.payload, "taxId", "");
            const auto note = getOr<std::string>(request.payload, "note", "");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            if (id.empty()) {
                id = "sup-" + crypto::uuid4().substr(0, 8);
                auto insert = ctx->db().prepare(
                    "INSERT INTO suppliers (id, name, contact, phone, tax_id, note, "
                    "                       created_at, updated_at) "
                    "VALUES (:id, :name, :contact, :phone, :tax, :note, :now, :now)");
                insert.bind(":id", id).bind(":name", name).bind(":contact", contact)
                    .bind(":phone", phone).bind(":tax", taxId).bind(":note", note)
                    .bind(":now", now);
                insert.exec();
            } else {
                auto update = ctx->db().prepare(
                    "UPDATE suppliers SET name = :name, contact = :contact, phone = :phone, "
                    "                     tax_id = :tax, note = :note, updated_at = :now "
                    "WHERE id = :id");
                update.bind(":name", name).bind(":contact", contact).bind(":phone", phone)
                    .bind(":tax", taxId).bind(":note", note).bind(":now", now).bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "Təchizatçı tapılmadı");
            }
            ctx->audit("supplier.save", "supplier", id, Json{{"name", name}});
            txn.commit();
            return Json{{"id", id}, {"name", name}};
        });

    server.registerHandler(
        std::string(protocol::method::kSuppliersLedger), [ctx](const ipc::Request& request) {
            ctx->requirePermission("suppliers.view");
            const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
            require(!supplierId.empty(), "supplierId is required");

            auto entries = ctx->db().prepare(
                "SELECT l.id, l.purchase_id AS purchaseId, l.amount_minor AS amountMinor, "
                "       l.kind, l.note, u.full_name AS actorName, l.created_at AS createdAt "
                "FROM supplier_ledger l LEFT JOIN users u ON u.id = l.actor_user_id "
                "WHERE l.supplier_id = :id ORDER BY l.created_at DESC LIMIT 200");
            entries.bind(":id", supplierId);

            auto due = ctx->db().prepare(
                "SELECT COALESCE(SUM(CASE WHEN kind = 'charge' THEN amount_minor "
                "                         ELSE -amount_minor END), 0) "
                "FROM supplier_ledger WHERE supplier_id = :id");
            due.bind(":id", supplierId);
            due.step();

            return Json{{"supplierId", supplierId},
                        {"dueMinor", due.columnInt(0)},
                        {"entries", entries.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kSuppliersPay), [ctx](const ipc::Request& request) {
            ctx->requirePermission("suppliers.pay");

            const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
            const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
            require(!supplierId.empty(), "supplierId is required");
            require(amount > 0, "Məbləğ sıfırdan böyük olmalıdır");

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "suppliers.pay", request.payload)) return *replay;
            if (key.rfind("portal-", 0) == 0) {
                auto due = ctx->db().prepare(
                    "SELECT COALESCE(SUM(CASE WHEN kind = 'charge' THEN amount_minor "
                    "                         ELSE -amount_minor END), 0) "
                    "FROM supplier_ledger WHERE supplier_id = :id");
                due.bind(":id", supplierId);
                due.step();
                require(due.columnInt(0) >= amount, "Ödəniş təchizatçı borcunu aşa bilməz");
            }
            auto insert = ctx->db().prepare(
                "INSERT INTO supplier_ledger (id, supplier_id, purchase_id, amount_minor, kind, "
                "                             note, actor_user_id, created_at) "
                "VALUES (:id, :supplier, :purchase, :amount, 'payment', :note, :actor, :now)");
            insert.bind(":id", crypto::uuid4()).bind(":supplier", supplierId)
                .bindOptional(":purchase", getOr<std::string>(request.payload, "purchaseId", ""))
                .bind(":amount", amount)
                .bind(":note", getOr<std::string>(request.payload, "note", ""))
                .bindOptional(":actor", ctx->session().userId).bind(":now", nowMs());
            insert.exec();

            ctx->auditRequired("supplier.pay", "supplier", supplierId,
                               Json{{"amountMinor", amount}});
            Json response{{"ok", true}, {"supplierId", supplierId}, {"amountMinor", amount}};
            idem.complete(key, response, "supplier", supplierId);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kSuppliersPayments), [ctx](const ipc::Request&) {
            ctx->requirePermission("suppliers.view");
            auto stmt = ctx->db().prepare(
                "SELECT l.id, 'supplier' AS partyType, l.supplier_id AS partyId, "
                "       s.name AS partyName, l.amount_minor AS amountMinor, "
                "       l.note, l.created_at AS createdAt "
                "FROM supplier_ledger l JOIN suppliers s ON s.id = l.supplier_id "
                "WHERE l.kind = 'payment' ORDER BY l.created_at DESC LIMIT 5000");
            return Json{{"payments", stmt.rows()}};
        });

    // -------------------------------------------------------------- purchases
    server.registerHandler(
        std::string(protocol::method::kPurchasesList), [ctx](const ipc::Request&) {
            ctx->requirePermission("suppliers.view");
            auto stmt = ctx->db().prepare(
                "SELECT p.id, p.number, p.supplier_id AS supplierId, s.name AS supplierName, "
                "       p.warehouse_id AS warehouseId, p.status, p.total_minor AS totalMinor, "
                "       p.due_minor AS dueMinor, p.created_at AS createdAt, "
                "       p.received_at AS receivedAt "
                "FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id "
                "ORDER BY p.created_at DESC LIMIT 5000");
            return Json{{"purchases", stmt.rows()}};
        });

    server.registerHandler(
        std::string(protocol::method::kPurchasesGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("suppliers.view");
            const auto id = getOr<std::string>(request.payload, "purchaseId", "");
            require(!id.empty(), "purchaseId is required");

            auto head = ctx->db().prepare(
                "SELECT p.id, p.number, p.supplier_id AS supplierId, s.name AS supplierName, "
                "       p.warehouse_id AS warehouseId, p.status, p.total_minor AS totalMinor, "
                "       p.due_minor AS dueMinor, p.note, p.created_at AS createdAt, "
                "       p.received_at AS receivedAt "
                "FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id "
                "WHERE p.id = :id");
            head.bind(":id", id);
            if (!head.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "Alış tapılmadı");
            }
            Json result = head.row();

            auto lines = ctx->db().prepare(
                "SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, "
                "       l.qty_milli AS qtyMilli, l.unit_cost_minor AS unitCostMinor, "
                "       l.line_total_minor AS lineTotalMinor "
                "FROM purchase_order_items l JOIN ingredients i ON i.id = l.ingredient_id "
                "WHERE l.purchase_id = :id");
            lines.bind(":id", id);
            result["lines"] = lines.rows();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kPurchasesSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("suppliers.manage");

            const auto supplierId = getOr<std::string>(request.payload, "supplierId", "");
            require(!supplierId.empty(), "supplierId is required");
            require(request.payload.contains("lines") && request.payload["lines"].is_array(),
                    "lines is required");

            auto id = getOr<std::string>(request.payload, "id", "");
            const auto warehouseId = warehouseFrom(*ctx, request.payload);
            const auto note = getOr<std::string>(request.payload, "note", "");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "purchases.save", request.payload)) return *replay;
            if (!id.empty()) {
                auto status = ctx->db().prepare(
                    "SELECT status FROM purchase_orders WHERE id = :id");
                status.bind(":id", id);
                require(status.step(), "Alış tapılmadı");
                // Editing a received order would move stock a second time.
                require(status.columnText(0) != "received",
                        "Qəbul edilmiş alış dəyişdirilə bilməz");
                auto clear = ctx->db().prepare(
                    "DELETE FROM purchase_order_items WHERE purchase_id = :id");
                clear.bind(":id", id);
                clear.exec();
            } else {
                id = "po-" + crypto::uuid4().substr(0, 8);
                auto seq = ctx->db().prepare("SELECT COUNT(*) + 1 FROM purchase_orders");
                seq.step();
                char number[32];
                std::snprintf(number, sizeof(number), "A-%05lld",
                              static_cast<long long>(seq.columnInt(0)));
                auto insert = ctx->db().prepare(
                    "INSERT INTO purchase_orders (id, number, supplier_id, warehouse_id, note, "
                    "                             actor_user_id, created_at) "
                    "VALUES (:id, :number, :supplier, :warehouse, :note, :actor, :now)");
                insert.bind(":id", id).bind(":number", std::string(number))
                    .bind(":supplier", supplierId).bind(":warehouse", warehouseId)
                    .bind(":note", note).bindOptional(":actor", ctx->session().userId)
                    .bind(":now", now);
                insert.exec();
            }

            Money total = 0;
            for (const auto& line : request.payload["lines"]) {
                if (!line.is_object()) continue;
                const auto ingredientId = getOr<std::string>(line, "ingredientId", "");
                const auto qty = getOr<std::int64_t>(line, "qtyMilli", 0);
                const auto unitCost = getOr<Money>(line, "unitCostMinor", 0);
                if (ingredientId.empty() || qty <= 0) continue;

                // Cost is per whole unit and quantity is thousandths, so the
                // division is explicit rather than a silent 1000x inflation.
                const Money lineTotal = qty * unitCost / 1000;
                total += lineTotal;

                auto insert = ctx->db().prepare(
                    "INSERT INTO purchase_order_items (id, purchase_id, ingredient_id, qty_milli, "
                    "                                  unit_cost_minor, line_total_minor) "
                    "VALUES (:id, :purchase, :ingredient, :qty, :cost, :total)");
                insert.bind(":id", crypto::uuid4()).bind(":purchase", id)
                    .bind(":ingredient", ingredientId).bind(":qty", qty).bind(":cost", unitCost)
                    .bind(":total", lineTotal);
                insert.exec();
            }

            auto totals = ctx->db().prepare(
                "UPDATE purchase_orders SET supplier_id = :supplier, warehouse_id = :warehouse, "
                "  note = :note, total_minor = :total, status = 'ordered' WHERE id = :id");
            totals.bind(":supplier", supplierId).bind(":warehouse", warehouseId)
                .bind(":note", note).bind(":total", total).bind(":id", id);
            totals.exec();

            ctx->audit("purchase.save", "purchase", id, Json{{"totalMinor", total}});
            Json response{{"id", id}, {"totalMinor", total}, {"status", "ordered"}};
            idem.complete(key, response, "purchase", id);
            txn.commit();
            return response;
        });

    server.registerHandler(
        std::string(protocol::method::kPurchasesReceive), [ctx](const ipc::Request& request) {
            ctx->requirePermission("suppliers.receive");

            const auto id = getOr<std::string>(request.payload, "purchaseId", "");
            require(!id.empty(), "purchaseId is required");
            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "purchases.receive", request.payload)) return *replay;

            auto head = ctx->db().prepare(
                "SELECT supplier_id, warehouse_id, status, total_minor FROM purchase_orders "
                "WHERE id = :id");
            head.bind(":id", id);
            require(head.step(), "Alış tapılmadı");
            const std::string supplierId = head.columnText(0);
            const std::string warehouseId = head.columnText(1);
            // Receiving twice would double the stock and the invoice.
            require(head.columnText(2) != "received", "Bu alış artıq qəbul edilib");
            const Money total = head.columnInt(3);

            auto lines = ctx->db().prepare(
                "SELECT ingredient_id, qty_milli, unit_cost_minor FROM purchase_order_items "
                "WHERE purchase_id = :id");
            lines.bind(":id", id);

            struct Line {
                std::string ingredientId;
                std::int64_t qty;
                Money unitCost;
            };
            std::vector<Line> received;
            while (lines.step()) {
                received.push_back({lines.columnText(0), lines.columnInt(1), lines.columnInt(2)});
            }
            require(!received.empty(), "Alışda sətir yoxdur");

            services::InventoryService inventory(*ctx);
            const auto now = nowMs();

            for (const auto& line : received) {
                inventory.move(line.ingredientId, warehouseId, line.qty, "receipt", id,
                               "mal qəbulu");
                // The last price paid becomes the ingredient's cost, which is
                // what valuation and recipe costing then read.
                if (line.unitCost > 0) {
                    auto cost = ctx->db().prepare(
                        "UPDATE ingredients SET cost_minor = :cost, updated_at = :now "
                        "WHERE id = :id");
                    cost.bind(":cost", line.unitCost).bind(":now", now)
                        .bind(":id", line.ingredientId);
                    cost.exec();
                }
            }

            auto mark = ctx->db().prepare(
                "UPDATE purchase_orders SET status = 'received', received_at = :now, "
                "  due_minor = :total WHERE id = :id");
            mark.bind(":now", now).bind(":total", total).bind(":id", id);
            mark.exec();

            // Receiving is what creates the debt: an order that was never
            // delivered is not money owed.
            auto charge = ctx->db().prepare(
                "INSERT INTO supplier_ledger (id, supplier_id, purchase_id, amount_minor, kind, "
                "                             note, actor_user_id, created_at) "
                "VALUES (:id, :supplier, :purchase, :amount, 'charge', 'mal qəbulu', :actor, :now)");
            charge.bind(":id", crypto::uuid4()).bind(":supplier", supplierId)
                .bind(":purchase", id).bind(":amount", total)
                .bindOptional(":actor", ctx->session().userId).bind(":now", now);
            charge.exec();

            ctx->auditRequired("purchase.receive", "purchase", id,
                               Json{{"lines", static_cast<std::int64_t>(received.size())},
                                    {"totalMinor", total}});
            Json response{{"id", id}, {"status", "received"}, {"totalMinor", total},
                          {"lines", static_cast<std::int64_t>(received.size())}};
            idem.complete(key, response, "purchase", id);
            txn.commit();

            return response;
        });

    // ---------------------------------------------------------------- recipes
    server.registerHandler(
        std::string(protocol::method::kRecipesGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            const auto menuItemId = getOr<std::string>(request.payload, "menuItemId", "");
            require(!menuItemId.empty(), "menuItemId is required");

            auto stmt = ctx->db().prepare(
                "SELECT r.ingredient_id AS ingredientId, i.name, i.unit, "
                "       r.qty_milli AS qtyMilli, i.cost_minor AS costMinor "
                "FROM menu_item_ingredients r JOIN ingredients i ON i.id = r.ingredient_id "
                "WHERE r.menu_item_id = :item ORDER BY i.name");
            stmt.bind(":item", menuItemId);
            const auto lines = stmt.rows();

            // What the dish costs to make, which is the number a price is set
            // against. Cost is per whole unit; quantities are thousandths.
            Money cost = 0;
            for (const auto& line : lines) {
                cost += getOr<std::int64_t>(line, "qtyMilli", 0) *
                        getOr<Money>(line, "costMinor", 0) / 1000;
            }
            return Json{{"menuItemId", menuItemId}, {"lines", lines}, {"costMinor", cost}};
        });

    // ------------------------------------------------------------ kalkulyasiya
    server.registerHandler(
        std::string(protocol::method::kReportsCosting), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");

            // One row per dish, costed from its recipe at today's ingredient
            // prices. The per-dish figure already existed in recipes.get, but
            // one dish at a time: nobody could see which dishes lose money, and
            // a dish with no recipe at all was simply absent from the question.
            //
            // Cost is the gross quantity the store actually gives up. Trimming
            // loss is not deducted anywhere: you paid for the whole kilo, and a
            // costing that prices only what reached the plate reads low by
            // exactly the amount that went in the bin.
            auto stmt = ctx->db().prepare(
                "SELECT m.id, m.name_az AS name, c.name_az AS category, "
                "       m.price_minor AS priceMinor, "
                "       COALESCE(SUM(r.qty_milli * i.cost_minor / 1000), 0) AS costMinor, "
                "       COUNT(r.ingredient_id) AS lineCount, "
                "       COUNT(CASE WHEN i.cost_minor = 0 THEN 1 END) AS unpricedCount, "
                "       COALESCE(s.soldQty, 0) AS soldQty, "
                "       COALESCE(s.revenueMinor, 0) AS revenueMinor "
                "FROM menu_items m "
                "LEFT JOIN menu_categories c ON c.id = m.category_id "
                "LEFT JOIN menu_item_ingredients r ON r.menu_item_id = m.id "
                "LEFT JOIN ingredients i ON i.id = r.ingredient_id "
                "LEFT JOIN ("
                "  SELECT oi.product_id AS productId, "
                "         SUM(oi.quantity) AS soldQty, "
                "         SUM(CASE WHEN oi.complimentary = 0 THEN oi.line_total_minor ELSE 0 END) "
                "           AS revenueMinor "
                "  FROM order_items oi "
                "  JOIN orders o ON o.id = oi.order_id "
                "  WHERE oi.status != 'voided' "
                "    AND o.status NOT IN ('voided', 'draft') "
                "  GROUP BY oi.product_id"
                ") s ON s.productId = m.id "
                "WHERE m.active = 1 "
                "GROUP BY m.id ORDER BY c.name_az, m.name_az");
            auto rows = stmt.rows();

            Money soldValue = 0;
            Money costValue = 0;
            std::int64_t missingRecipes = 0;
            std::int64_t unpriced = 0;
            std::int64_t losing = 0;

            for (auto& row : rows) {
                const Money price = row.value("priceMinor", Money{0});
                const Money cost = row.value("costMinor", Money{0});
                const auto lineCount = row.value("lineCount", std::int64_t{0});
                const auto unpricedLines = row.value("unpricedCount", std::int64_t{0});
                const auto soldQty = row.value("soldQty", std::int64_t{0});
                const Money revenue = row.value("revenueMinor", Money{0});

                row["hasRecipe"] = lineCount > 0;
                row["marginMinor"] = price - cost;
                // Food cost as a percentage of the price, which is the number a
                // restaurant actually manages by. Ten thousandths of a percent
                // so the caller can format without a float ever crossing IPC.
                row["foodCostBp"] = price > 0 ? (cost * 10000) / price : 0;
                // A recipe priced from ingredients that cost zero is not a
                // cheap dish, it is an unanswered question - and it drags the
                // whole average down silently.
                row["unpriced"] = unpricedLines > 0;
                // Lifetime realised profit at today's recipe cost: revenue
                // actually taken minus (portions sold × current maya). Without
                // a recipe the maya is unknown, so totalProfit stays null-ish
                // (we still expose soldQty / revenue for the screen).
                if (lineCount > 0) {
                    row["totalProfitMinor"] = revenue - soldQty * cost;
                } else {
                    row["totalProfitMinor"] = nullptr;
                }

                if (lineCount == 0) {
                    missingRecipes += 1;
                    continue;  // an unknown cost must not pretend to be zero
                }
                if (unpricedLines > 0) unpriced += 1;
                if (cost > price) losing += 1;
                soldValue += price;
                costValue += cost;
            }

            return Json{{"items", rows},
                        {"summary",
                         Json{{"dishes", static_cast<std::int64_t>(rows.size())},
                              {"withRecipe", static_cast<std::int64_t>(rows.size()) - missingRecipes},
                              {"missingRecipes", missingRecipes},
                              {"unpricedIngredients", unpriced},
                              {"losingMoney", losing},
                              // The menu-wide food cost, weighted by nothing but
                              // the menu itself: it answers "if every dish sold
                              // once", which is the only honest answer without
                              // sales mixed in.
                              {"foodCostBp", soldValue > 0 ? (costValue * 10000) / soldValue : 0}}}};
        });

    server.registerHandler(
        std::string(protocol::method::kRecipesSave), [ctx](const ipc::Request& request) {
            ctx->requirePermission("recipes.manage");

            const auto menuItemId = getOr<std::string>(request.payload, "menuItemId", "");
            require(!menuItemId.empty(), "menuItemId is required");
            require(request.payload.contains("lines") && request.payload["lines"].is_array(),
                    "lines is required");

            auto dish = ctx->db().prepare("SELECT 1 FROM menu_items WHERE id = :id");
            dish.bind(":id", menuItemId);
            require(dish.step(), "Məhsul tapılmadı");

            db::Transaction txn(ctx->db());
            // Replace rather than diff: the screen sends the whole recipe, and a
            // removed line has to actually stop consuming stock.
            auto clear = ctx->db().prepare(
                "DELETE FROM menu_item_ingredients WHERE menu_item_id = :item");
            clear.bind(":item", menuItemId);
            clear.exec();

            int saved = 0;
            for (const auto& line : request.payload["lines"]) {
                if (!line.is_object()) continue;
                const auto ingredientId = getOr<std::string>(line, "ingredientId", "");
                const auto qty = getOr<std::int64_t>(line, "qtyMilli", 0);
                if (ingredientId.empty() || qty <= 0) continue;

                auto insert = ctx->db().prepare(
                    "INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, qty_milli) "
                    "VALUES (:item, :ingredient, :qty)");
                insert.bind(":item", menuItemId).bind(":ingredient", ingredientId).bind(":qty", qty);
                insert.exec();
                saved += 1;
            }
            ctx->audit("recipe.save", "menu_item", menuItemId, Json{{"lines", saved}});
            txn.commit();

            return Json{{"menuItemId", menuItemId}, {"lines", saved}};
        });
}

void registerExport(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // Reports as CSV, because that is what a spreadsheet opens without asking
    // anyone to install anything. A PDF is the print path's job - the receipt
    // renderer already produces one - so this side only produces the data.
    server.registerHandler(
        std::string(protocol::method::kReportsExport), [ctx](const ipc::Request& request) {
            ctx->requirePermission("reports.export");

            const auto kind = getOr<std::string>(request.payload, "kind", "sales");
            const auto from = getOr<Timestamp>(request.payload, "from", nowMs() - 30 * 86400000LL);
            const auto to = getOr<Timestamp>(request.payload, "to", nowMs());

            std::string sql;
            if (kind == "sales") {
                sql =
                    "SELECT o.order_number AS 'Hesab', t.label AS 'Masa', "
                    "       u.full_name AS 'Ofisiant', o.status AS 'Status', "
                    "       o.guest_count AS 'Qonaq', "
                    "       o.total_minor / 100.0 AS 'Cəm', "
                    "       datetime(o.opened_at / 1000, 'unixepoch', 'localtime') AS 'Açılış', "
                    "       datetime(o.closed_at / 1000, 'unixepoch', 'localtime') AS 'Bağlanış' "
                    "FROM orders o "
                    "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
                    "LEFT JOIN users u ON u.id = o.user_id "
                    "WHERE o.opened_at BETWEEN :from AND :to AND o.status != 'voided' "
                    "ORDER BY o.opened_at";
            } else if (kind == "products") {
                sql =
                    "SELECT i.name_snapshot AS 'Məhsul', SUM(i.quantity) AS 'Say', "
                    "       SUM(i.line_total_minor) / 100.0 AS 'Məbləğ' "
                    "FROM order_items i JOIN orders o ON o.id = i.order_id "
                    "WHERE o.opened_at BETWEEN :from AND :to "
                    "  AND i.status != 'voided' AND o.status != 'voided' "
                    "GROUP BY i.name_snapshot ORDER BY SUM(i.line_total_minor) DESC";
            } else if (kind == "payments") {
                sql =
                    "SELECT p.method AS 'Üsul', p.status AS 'Status', COUNT(*) AS 'Say', "
                    "       SUM(p.amount_minor) / 100.0 AS 'Məbləğ', "
                    "       SUM(p.tip_minor) / 100.0 AS 'Bəxşiş' "
                    "FROM payments p WHERE p.created_at BETWEEN :from AND :to "
                    "GROUP BY p.method, p.status ORDER BY p.method";
            } else if (kind == "refunds") {
                sql =
                    "SELECT o.order_number AS 'Hesab', r.method AS 'Üsul', "
                    "       r.amount_minor / 100.0 AS 'Məbləğ', r.reason AS 'Səbəb', "
                    "       u.full_name AS 'Kassir', "
                    "       datetime(r.created_at / 1000, 'unixepoch', 'localtime') AS 'Vaxt' "
                    "FROM refunds r "
                    "LEFT JOIN orders o ON o.id = r.order_id "
                    "LEFT JOIN users u ON u.id = r.actor_user_id "
                    "WHERE r.created_at BETWEEN :from AND :to ORDER BY r.created_at";
            } else if (kind == "stock") {
                sql =
                    "SELECT i.name AS 'İnqrediyent', i.unit AS 'Vahid', "
                    "       COALESCE(SUM(s.qty_milli), 0) / 1000.0 AS 'Qalıq', "
                    "       i.min_qty_milli / 1000.0 AS 'Minimum', "
                    "       i.cost_minor / 100.0 AS 'Maya' "
                    "FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id "
                    "WHERE i.active = 1 AND :from <= :to "
                    "GROUP BY i.id ORDER BY i.name";
            } else if (kind == "waste") {
                sql =
                    "SELECT i.name AS 'İnqrediyent', "
                    "       -m.qty_delta_milli / 1000.0 AS 'Miqdar', m.reason AS 'Səbəb', "
                    "       u.full_name AS 'İşçi', "
                    "       datetime(m.created_at / 1000, 'unixepoch', 'localtime') AS 'Vaxt' "
                    "FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id "
                    "LEFT JOIN users u ON u.id = m.actor_user_id "
                    "WHERE m.kind = 'waste' AND m.created_at BETWEEN :from AND :to "
                    "ORDER BY m.created_at";
            } else if (kind == "purchases") {
                sql =
                    "SELECT p.number AS 'Sənəd', s.name AS 'Təchizatçı', p.status AS 'Status', "
                    "       p.total_minor / 100.0 AS 'Məbləğ', "
                    "       datetime(p.created_at / 1000, 'unixepoch', 'localtime') AS 'Tarix' "
                    "FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id "
                    "WHERE p.created_at BETWEEN :from AND :to ORDER BY p.created_at";
            } else if (kind == "attendance") {
                sql =
                    "SELECT u.full_name AS 'İşçi', "
                    "       datetime(a.clock_in_at / 1000, 'unixepoch', 'localtime') AS 'Giriş', "
                    "       datetime(a.clock_out_at / 1000, 'unixepoch', 'localtime') AS 'Çıxış', "
                    "       (a.clock_out_at - a.clock_in_at) / 60000 AS 'Dəqiqə' "
                    "FROM attendance a JOIN users u ON u.id = a.user_id "
                    "WHERE a.clock_in_at BETWEEN :from AND :to ORDER BY a.clock_in_at";
            } else {
                throw PosError(std::string(protocol::err::kValidation),
                               "Bu hesabat növü tanınmadı: " + kind);
            }

            auto stmt = ctx->db().prepare(sql);
            stmt.bind(":from", from).bind(":to", to);

            // Quote every field and double any quote inside it: a dish called
            // 5" Pizza, or any Azerbaijani name with a comma, must not shift the
            // columns of the row it is in.
            const auto quote = [](const std::string& value) {
                std::string out = "\"";
                for (char c : value) {
                    if (c == '"') out += '"';
                    out += c;
                }
                out += '"';
                return out;
            };

            std::string csv;
            bool header = false;
            int rows = 0;
            while (stmt.step()) {
                if (!header) {
                    for (int i = 0; i < stmt.columnCount(); ++i) {
                        if (i > 0) csv += ',';
                        csv += quote(stmt.columnName(i));
                    }
                    csv += "\r\n";
                    header = true;
                }
                for (int i = 0; i < stmt.columnCount(); ++i) {
                    if (i > 0) csv += ',';
                    csv += quote(stmt.columnIsNull(i) ? "" : stmt.columnText(i));
                }
                csv += "\r\n";
                rows += 1;
            }
            if (!header) {
                // An empty result still needs its header row, or the file looks
                // broken rather than simply empty.
                auto empty = ctx->db().prepare(sql);
                empty.bind(":from", from).bind(":to", to);
                empty.step();
                for (int i = 0; i < empty.columnCount(); ++i) {
                    if (i > 0) csv += ',';
                    csv += quote(empty.columnName(i));
                }
                csv += "\r\n";
            }

            // Stamped with the branch, so a file that reaches head office says
            // which shop it came from without anyone having to remember.
            const std::string branch = ctx->setting("branch.name", "");
            const std::string branchCode = ctx->setting("branch.code", "");
            std::string prefix;
            if (!branch.empty() || !branchCode.empty()) {
                prefix = "\"" + (branchCode.empty() ? branch : branchCode + " - " + branch) +
                         "\"\r\n\r\n";
            }

            ctx->audit("reports.export", "report", kind, Json{{"rows", rows}});
            const std::string slug = branchCode.empty() ? kind : branchCode + "-" + kind;
            return Json{{"kind", kind}, {"rows", rows}, {"csv", prefix + csv},
                        {"branch", branch},
                        {"filename", "possistem-" + slug + ".csv"}};
        });
}

}  // namespace pos::handlers
