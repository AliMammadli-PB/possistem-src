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
#include "pos/services/CashService.hpp"
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
                "       CASE WHEN i.sku LIKE 'MENU-%' THEN COALESCE((SELECT m.price_minor FROM menu_items m "
                "         WHERE m.id = substr(i.sku, 6)), i.sale_price_minor) "
                "         ELSE i.sale_price_minor END AS salePriceMinor, "
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

            // A label may need a code without editing the good's stock, prices,
            // category or minimum. The transaction also serializes concurrent requests.
            if (getOr<bool>(request.payload, "generateBarcodeOnly", false)) {
                const auto goodId = getOr<std::string>(request.payload, "id", "");
                db::Transaction txn(ctx->db());
                auto current = ctx->db().prepare("SELECT barcode FROM ingredients WHERE id = :id AND active = 1");
                current.bind(":id", goodId);
                require(current.step(), "Mal tapılmadı və ya silinib");
                auto code = current.columnText(0);
                const auto requested = getOr<std::string>(request.payload, "barcode", "");
                const auto previous = getOr<std::string>(request.payload, "previousBarcode", "");
                const bool replace = getOr<bool>(request.payload, "replaceBarcode", false);
                const auto valid13 = [](const std::string& value) {
                    if (value.size() != 13 || !std::all_of(value.begin(), value.end(), [](char c) { return c >= '0' && c <= '9'; })) return false;
                    int sum = 0;
                    for (int i = 0; i < 12; ++i) sum += (value[i] - '0') * (i % 2 ? 3 : 1);
                    return (10 - sum % 10) % 10 == value[12] - '0';
                };
                require(requested.empty() || valid13(requested), "Barkod 13 rəqəmli olmalıdır və yoxlama rəqəmi düzgün olmalıdır");
                // A repeated automatic request after replacement returns the committed code.
                const bool replay = replace && requested.empty() && code != previous && valid13(code);
                if (!replay && (code.empty() || (replace && (requested.empty() || requested != code)))) {
                    require(code.empty() || code == previous, "Malın barkodu dəyişib. Siyahını yeniləyin");
                    const auto oldCode = code;
                    bool found = false;
                    for (int attempt = 0; attempt < 32; ++attempt) {
                        if (!requested.empty()) code = requested;
                        else {
                            // Internal numeric identifier. This is not a GS1 company registration.
                            auto random = ctx->db().prepare("SELECT '200' || printf('%09d', abs(random() % 1000000000))");
                            random.step(); code = random.columnText(0);
                            int sum = 0;
                            for (int i = 0; i < 12; ++i) sum += (code[i] - '0') * (i % 2 ? 3 : 1);
                            code += static_cast<char>('0' + (10 - sum % 10) % 10);
                        }
                        auto used = ctx->db().prepare("SELECT 1 FROM ingredients WHERE active = 1 AND id != :id AND (barcode = :code OR sku = :code) LIMIT 1");
                        used.bind(":code", code).bind(":id", goodId);
                        if (!used.step()) { found = true; break; }
                        if (!requested.empty()) break;
                    }
                    require(found, "Bu barkod başqa mala aiddir və ya yeni barkod yaradıla bilmədi");
                    auto update = ctx->db().prepare("UPDATE ingredients SET barcode = :code, updated_at = :now WHERE id = :id AND active = 1");
                    update.bind(":code", code).bind(":now", nowMs()).bind(":id", goodId); update.exec();
                    ctx->audit("ingredient.barcode", "ingredient", goodId, Json{{"barcode", code}, {"previousBarcode", oldCode}});
                }
                txn.commit();
                return Json{{"id", goodId}, {"barcode", code}};
            }

            const auto name = getOr<std::string>(request.payload, "name", "");
            require(!name.empty(), "Ad tələb olunur");
            const auto unit = getOr<std::string>(request.payload, "unit", "kg");
            require(unit == "kg" || unit == "l" || unit == "ədəd" || unit == "qab" || unit == "q",
                    "Ölçü vahidi tanınmadı");

            auto id = getOr<std::string>(request.payload, "id", "");
            auto sku = getOr<std::string>(request.payload, "sku", "");
            if(sku.empty() && !id.empty()) {auto stored=ctx->db().prepare("SELECT sku FROM ingredients WHERE id=:id");stored.bind(":id",id);if(stored.step())sku=stored.columnText(0);}
            const auto costMinor = getOr<std::int64_t>(request.payload, "costMinor", 0);
            const auto minQty = getOr<std::int64_t>(request.payload, "minQtyMilli", 0);
            const auto barcode = getOr<std::string>(request.payload, "barcode", "");
            // Optional: an edit that does not send it keeps what was there.
            const bool hasSalePrice = request.payload.contains("salePriceMinor");
            const auto salePrice = getOr<std::int64_t>(request.payload, "salePriceMinor", 0);
            require(costMinor >= 0, "Maya dəyəri mənfi ola bilməz");
            require(salePrice >= 0, "Satış qiyməti mənfi ola bilməz");
            require(minQty >= 0, "Minimum miqdar mənfi ola bilməz");
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            services::Idempotency idem(*ctx);
            const auto key = getOr<std::string>(request.payload, "idempotencyKey", "");
            if (auto replay = idem.begin(key, "ingredients.save", request.payload)) return *replay;
            // One barcode, one good: a copy must get its own barcode.
            if (!barcode.empty()) {
                auto other = ctx->db().prepare(
                    "SELECT name FROM ingredients WHERE active = 1 AND barcode = :b AND id != :self LIMIT 1");
                other.bind(":b", barcode).bind(":self", id);
                if (other.step()) {
                    throw PosError(std::string(protocol::err::kValidation),
                                   "Bu barkod artıq \"" + other.columnText(0) + "\" malındadır");
                }
            }
            if (id.empty()) {
                id = "ing-" + crypto::uuid4().substr(0, 8);
                if (sku.empty()) sku = "ING-" + id.substr(4);
                auto insert = ctx->db().prepare(
                    "INSERT INTO ingredients (id, sku, name, unit, cost_minor, avg_cost_minor, min_qty_milli, "
                    "                         barcode, sale_price_minor, created_at, updated_at) "
                    "VALUES (:id, :sku, :name, :unit, :cost, :cost, :min, :barcode, :sale, :now, :now)");
                insert.bind(":id", id).bind(":sku", sku).bind(":name", name).bind(":unit", unit)
                    .bind(":cost", costMinor).bind(":min", minQty).bind(":barcode", barcode)
                    .bind(":sale", salePrice).bind(":now", now);
                insert.exec();
            } else {
                auto current = ctx->db().prepare("SELECT sku FROM ingredients WHERE id = :id");
                current.bind(":id", id);
                if (current.step()) sku = current.columnText(0);
                auto update = ctx->db().prepare(
                    "UPDATE ingredients SET name = :name, unit = :unit, cost_minor = :cost, "
                    "                       min_qty_milli = :min, barcode = :barcode, "
                    // A price typed by hand is the average too while nothing is in stock.
                    "                       avg_cost_minor = CASE WHEN avg_cost_minor = 0 OR (SELECT COALESCE(SUM(qty_milli), 0) "
                    "                         FROM stock_levels WHERE ingredient_id = :id) <= 0 THEN :cost ELSE avg_cost_minor END, "
                    "                       updated_at = :now WHERE id = :id");
                update.bind(":name", name).bind(":unit", unit).bind(":cost", costMinor)
                    .bind(":min", minQty).bind(":barcode", barcode).bind(":now", now)
                    .bind(":id", id);
                update.exec();
                require(ctx->db().changes() == 1, "İnqrediyent tapılmadı");
                if (hasSalePrice) {
                    auto sale = ctx->db().prepare(
                        "UPDATE ingredients SET sale_price_minor = :sale WHERE id = :id");
                    sale.bind(":sale", salePrice).bind(":id", id);
                    sale.exec();
                }
            }
            // A stock item made for a catalog product (sku MENU-<id>) sells at the
            // menu price: changing it here changes the menu, with its history.
            if (hasSalePrice && sku.rfind("MENU-", 0) == 0) {
                const auto itemId = sku.substr(5);
                auto old = ctx->db().prepare("SELECT price_minor FROM menu_items WHERE id = :id");
                old.bind(":id", itemId);
                if (old.step() && old.columnInt(0) != salePrice) {
                    const auto oldPrice = old.columnInt(0);
                    auto menu = ctx->db().prepare(
                        "UPDATE menu_items SET price_minor = :price, updated_at = :now WHERE id = :id");
                    menu.bind(":price", salePrice).bind(":now", now).bind(":id", itemId);
                    menu.exec();
                    auto hist = ctx->db().prepare(
                        "INSERT INTO menu_item_price_history "
                        "(id, item_id, old_price_minor, new_price_minor, changed_by, reason, created_at) "
                        "VALUES (:id, :item, :old, :new, :by, 'anbar', :now)");
                    hist.bind(":id", crypto::uuid4()).bind(":item", itemId).bind(":old", oldPrice)
                        .bind(":new", salePrice).bindOptional(":by", ctx->session().userId)
                        .bind(":now", now);
                    hist.exec();
                }
            }
            // Kateqoriya, tərəzi (PLU / çəkili) and branch prices: each only when sent.
            if (request.payload.contains("categoryId")) {
                const auto category = getOr<std::string>(request.payload, "categoryId", "");
                if (!category.empty()) {
                    auto known = ctx->db().prepare("SELECT 1 FROM stock_categories WHERE id = :c AND active = 1");
                    known.bind(":c", category);
                    require(known.step(), "Kateqoriya tapılmadı");
                }
                auto set = ctx->db().prepare("UPDATE ingredients SET category_id = :c WHERE id = :id");
                set.bindOptional(":c", category).bind(":id", id);
                set.exec();
            }
            if (request.payload.contains("weighted")) {
                auto set = ctx->db().prepare("UPDATE ingredients SET weighted = :w WHERE id = :id");
                set.bind(":w", getOr<bool>(request.payload, "weighted", false) ? 1 : 0).bind(":id", id);
                set.exec();
            }
            if (request.payload.contains("plu")) {
                auto plu = getOr<std::int64_t>(request.payload, "plu", 0);
                require(plu >= 0 && plu <= 99999, "PLU 0-99999 arasında olmalıdır");
                auto weighted = ctx->db().prepare("SELECT weighted FROM ingredients WHERE id = :id");
                weighted.bind(":id", id);
                weighted.step();
                if (plu == 0 && weighted.columnInt(0) != 0) {
                    auto next = ctx->db().prepare("SELECT COALESCE(MAX(plu), 0) + 1 FROM ingredients WHERE active = 1");
                    next.step();
                    plu = next.columnInt(0);
                }
                if (plu > 0) {
                    auto taken = ctx->db().prepare(
                        "SELECT name FROM ingredients WHERE active = 1 AND plu = :p AND id != :id LIMIT 1");
                    taken.bind(":p", plu).bind(":id", id);
                    if (taken.step()) {
                        throw PosError(std::string(protocol::err::kValidation),
                                       "Bu PLU artıq \"" + taken.columnText(0) + "\" malındadır");
                    }
                }
                auto set = ctx->db().prepare("UPDATE ingredients SET plu = :p WHERE id = :id");
                set.bind(":p", plu).bind(":id", id);
                set.exec();
            }
            if (request.payload.contains("prices") && request.payload["prices"].is_array()) {
                auto wipe = ctx->db().prepare("DELETE FROM item_prices WHERE ingredient_id = :id");
                wipe.bind(":id", id);
                wipe.exec();
                for (const auto& price : request.payload["prices"]) {
                    const auto objectId = getOr<std::string>(price, "objectId", "");
                    if (objectId.empty() || !price.contains("salePriceMinor") || price["salePriceMinor"].is_null()) continue;
                    const auto value = getOr<std::int64_t>(price, "salePriceMinor", 0);
                    require(value >= 0, "Qiymət mənfi ola bilməz");
                    auto put = ctx->db().prepare(
                        "INSERT OR REPLACE INTO item_prices (ingredient_id, object_id, sale_price_minor, updated_at) "
                        "VALUES (:i, :o, :p, :now)");
                    put.bind(":i", id).bind(":o", objectId).bind(":p", value).bind(":now", now);
                    put.exec();
                }
            }
            // A goods card can receive real stock. Keep the card, movement,
            // lot and idempotency receipt in the same transaction: retries
            // cannot create the item without stock or add that stock twice.
            const auto stockDelta = getOr<std::int64_t>(request.payload, "stockDeltaMilli", 0);
            if (request.payload.contains("stockDeltaMilli")) {
                require(request.payload["stockDeltaMilli"].is_number_integer(), "Qalıq düzgün rəqəm olmalıdır");
                require(stockDelta >= 0 && stockDelta <= 1000000000000LL, "Əlavə qalıq 0–1000000000 aralığında olmalıdır");
            }
            if (stockDelta > 0) {
                ctx->requirePermission("inventory.adjust");
                require(!key.empty(), "Qalıq əlavə etmək üçün əməliyyat açarı tələb olunur");
                const auto warehouseId = warehouseFrom(*ctx, request.payload);
                services::InventoryService(*ctx).move(id, warehouseId, stockDelta, "adjustment", id,
                                                     "Mal kartından qalıq əlavə edilməsi");
                ctx->auditRequired("inventory.adjust", "ingredient", id,
                                   Json{{"qtyDeltaMilli", stockDelta}, {"warehouseId", warehouseId}});
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
            const auto warehouseId = warehouseFrom(*ctx, request.payload);
            {
                // A lot that expired overnight is out of usable stock before anyone reads it.
                db::Transaction txn(ctx->db());
                services::InventoryService(*ctx).blockExpired("", warehouseId);
                txn.commit();
            }
            return services::InventoryService(*ctx).levels(warehouseId);
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
                getOr<std::string>(request.payload, "warehouseId", ""), getOr<std::string>(request.payload, "method", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kInventoryMovements), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            const auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
            const auto limit =
                std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 100), 5000);
            const auto search = getOr<std::string>(request.payload, "search", "");

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
                "  AND m.created_at >= :from AND m.created_at < :to "
                "  AND (:warehouse = '' OR m.warehouse_id = :warehouse) AND (:kind = '' OR m.kind = :kind) "
                "  AND (:q = '' OR i.name LIKE :like OR i.barcode LIKE :like OR m.reason LIKE :like) "
                "ORDER BY m.created_at DESC LIMIT :limit");
            stmt.bind(":ingredient", ingredientId).bind(":limit", limit)
                .bind(":from", getOr<std::int64_t>(request.payload, "from", 0))
                .bind(":to", getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000LL))
                .bind(":warehouse", getOr<std::string>(request.payload, "warehouseId", ""))
                .bind(":kind", getOr<std::string>(request.payload, "kind", ""))
                .bind(":q", search).bind(":like", "%" + search + "%");
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
            // Lots travel with their dates, number and cost.
            auto moved = inventory.transfer(ingredientId, fromId, toId, qty, reference);
            auto out = moved["out"];
            auto in = moved["in"];
            ctx->auditRequired("inventory.transfer", "ingredient", ingredientId,
                               Json{{"from", fromId}, {"to", toId}, {"qtyMilli", qty}});
            Json response{{"out", out}, {"in", in}, {"referenceId", reference}};
            idem.complete(key, response, "ingredient", ingredientId);
            txn.commit();

            return response;
        });

    // ------------------------------------------------------------- stocktake
    // İnventarizasiya: the "before" document is the snapshot taken when it is
    // opened (expected_milli), the "after" one is what was counted. Posting
    // makes the store hold exactly the counted amounts; with zero_uncounted a
    // good nobody counted is taken as gone. Both stay on the document.
    server.registerHandler(
        std::string(protocol::method::kStocktakeCreate), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");

            const auto warehouseId = warehouseFrom(*ctx, request.payload);
            const auto note = getOr<std::string>(request.payload, "note", "");
            const bool zero = getOr<bool>(request.payload, "zeroUncounted", true);
            const std::string id = "st-" + crypto::uuid4().substr(0, 8);
            const auto now = nowMs();

            db::Transaction txn(ctx->db());
            auto seq = ctx->db().prepare(
                "SELECT COALESCE(MAX(CAST(SUBSTR(number, 3) AS INTEGER)), 0) + 1 FROM stocktakes WHERE number LIKE 'S-%'");
            seq.step();
            char number[24];
            std::snprintf(number, sizeof(number), "S-%05lld", static_cast<long long>(seq.columnInt(0)));
            auto insert = ctx->db().prepare(
                "INSERT INTO stocktakes (id, warehouse_id, note, actor_user_id, created_at, number, zero_uncounted) "
                "VALUES (:id, :warehouse, :note, :actor, :now, :number, :zero)");
            insert.bind(":id", id).bind(":warehouse", warehouseId).bind(":note", note)
                .bindOptional(":actor", ctx->session().userId).bind(":now", now)
                .bind(":number", std::string(number)).bind(":zero", zero ? 1 : 0);
            insert.exec();

            auto lines = ctx->db().prepare(
                "INSERT INTO stocktake_lines (id, stocktake_id, ingredient_id, expected_milli) "
                "SELECT lower(hex(randomblob(16))), :id, i.id, "
                "       COALESCE((SELECT qty_milli FROM stock_levels s "
                "                  WHERE s.ingredient_id = i.id AND s.warehouse_id = :warehouse), 0) "
                "FROM ingredients i WHERE i.active = 1");
            lines.bind(":id", id).bind(":warehouse", warehouseId);
            lines.exec();

            ctx->auditRequired("stocktake.create", "stocktake", id,
                               Json{{"warehouseId", warehouseId}, {"number", number}});
            txn.commit();
            return Json{{"id", id}, {"number", number}, {"warehouseId", warehouseId}, {"status", "open"}};
        });

    server.registerHandler(
        std::string(protocol::method::kStocktakeList), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");
            const auto q = getOr<std::string>(request.payload, "search", "");
            auto stmt = ctx->db().prepare(
                "SELECT s.id, COALESCE(s.number, '') AS number, s.warehouse_id AS warehouseId, w.name AS warehouseName, "
                "       s.status, s.note, s.zero_uncounted AS zeroUncounted, u.full_name AS actorName, "
                "       s.created_at AS createdAt, s.posted_at AS postedAt, "
                "       (SELECT COUNT(*) FROM stocktake_lines l WHERE l.stocktake_id = s.id) AS lineCount, "
                "       (SELECT COUNT(*) FROM stocktake_lines l WHERE l.stocktake_id = s.id AND l.counted_milli IS NOT NULL) AS countedCount "
                "FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id "
                "LEFT JOIN users u ON u.id = s.actor_user_id "
                "WHERE s.created_at >= :from AND s.created_at < :to "
                "  AND (:warehouse = '' OR s.warehouse_id = :warehouse) AND (:status = '' OR s.status = :status) "
                "  AND (:q = '' OR s.number LIKE :like OR s.note LIKE :like OR w.name LIKE :like) "
                "ORDER BY s.created_at DESC LIMIT 500");
            stmt.bind(":from", getOr<std::int64_t>(request.payload, "from", 0))
                .bind(":to", getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000LL))
                .bind(":warehouse", getOr<std::string>(request.payload, "warehouseId", ""))
                .bind(":status", getOr<std::string>(request.payload, "status", ""))
                .bind(":q", q).bind(":like", "%" + q + "%");
            return Json{{"stocktakes", stmt.rows()}};
        });

    // The two documents side by side: before, counted, difference, at cost and at sale price.
    server.registerHandler(
        std::string(protocol::method::kStocktakeGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");
            const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
            require(!id.empty(), "stocktakeId is required");

            auto head = ctx->db().prepare(
                "SELECT s.id, COALESCE(s.number, '') AS number, s.warehouse_id AS warehouseId, w.name AS warehouseName, "
                "       s.status, s.note, s.zero_uncounted AS zeroUncounted, s.created_at AS createdAt, "
                "       s.posted_at AS postedAt FROM stocktakes s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.id = :id");
            head.bind(":id", id);
            if (!head.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "İnventarizasiya tapılmadı");
            }
            Json result = head.row();
            const bool zero = result.value("zeroUncounted", std::int64_t{1}) != 0;

            services::InventoryService inventory(*ctx);
            auto lines = ctx->db().prepare(
                "SELECT l.id, l.ingredient_id AS ingredientId, i.name, i.unit, i.barcode, i.sku, "
                "       l.expected_milli AS expectedMilli, l.counted_milli AS countedMilli, l.counted_at AS countedAt, "
                "       l.posted_before_milli AS postedBeforeMilli, "
                "       " + services::InventoryService::unitCostSql(inventory.costingMethod()) + " AS costMinor, "
                "       CASE WHEN i.sku LIKE 'MENU-%' THEN COALESCE((SELECT m.price_minor FROM menu_items m "
                "         WHERE m.id = substr(i.sku, 6)), i.sale_price_minor) ELSE i.sale_price_minor END AS salePriceMinor "
                "FROM stocktake_lines l JOIN ingredients i ON i.id = l.ingredient_id "
                "WHERE l.stocktake_id = :id ORDER BY i.name");
            lines.bind(":id", id);
            Json rows = lines.rows();
            Money expectedCost = 0, countedCost = 0, expectedSale = 0, countedSale = 0;
            std::int64_t counted = 0, short_ = 0, over = 0;
            for (auto& row : rows) {
                const auto expected = row.value("expectedMilli", std::int64_t{0});
                const bool has = row["countedMilli"].is_number();
                const std::int64_t target = has ? row["countedMilli"].get<std::int64_t>() : (zero ? 0 : expected);
                const auto diff = target - expected;
                const Money cost = row.value("costMinor", Money{0});
                const Money sale = row.value("salePriceMinor", Money{0});
                row["targetMilli"] = target;
                row["diffMilli"] = diff;
                row["diffCostMinor"] = diff * cost / 1000;
                row["diffSaleMinor"] = diff * sale / 1000;
                expectedCost += expected * cost / 1000;
                countedCost += target * cost / 1000;
                expectedSale += expected * sale / 1000;
                countedSale += target * sale / 1000;
                if (has) ++counted;
                if (diff < 0) ++short_;
                if (diff > 0) ++over;
            }
            result["lines"] = rows;
            result["totals"] = Json{{"lines", rows.size()}, {"counted", counted}, {"short", short_}, {"over", over},
                                    {"expectedCostMinor", expectedCost}, {"countedCostMinor", countedCost},
                                    {"diffCostMinor", countedCost - expectedCost},
                                    {"expectedSaleMinor", expectedSale}, {"countedSaleMinor", countedSale},
                                    {"diffSaleMinor", countedSale - expectedSale}};
            return result;
        });

    // One count: by line, by good or by barcode (scanner); set the amount or add to it.
    server.registerHandler(
        std::string(protocol::method::kStocktakeCount), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");

            auto lineId = getOr<std::string>(request.payload, "lineId", "");
            const auto mode = getOr<std::string>(request.payload, "mode", "set");
            const bool clear = request.payload.contains("countedMilli") && request.payload["countedMilli"].is_null();
            require(request.payload.contains("countedMilli"), "countedMilli is required");
            const auto counted = clear ? 0 : getOr<std::int64_t>(request.payload, "countedMilli", 0);
            require(mode == "add" || counted >= 0, "Sayılan miqdar mənfi ola bilməz");

            db::Transaction txn(ctx->db());
            if (lineId.empty()) {
                const auto stocktakeId = getOr<std::string>(request.payload, "stocktakeId", "");
                auto ingredientId = getOr<std::string>(request.payload, "ingredientId", "");
                const auto barcode = getOr<std::string>(request.payload, "barcode", "");
                require(!stocktakeId.empty(), "stocktakeId is required");
                auto head = ctx->db().prepare("SELECT warehouse_id FROM stocktakes WHERE id = :id AND status = 'open'");
                head.bind(":id", stocktakeId);
                require(head.step(), "İnventarizasiya tapılmadı və ya bağlıdır");
                const std::string warehouseId = head.columnText(0);
                if (ingredientId.empty()) {
                    require(!barcode.empty(), "Mal və ya barkod tələb olunur");
                    auto find = ctx->db().prepare(
                        "SELECT id FROM ingredients WHERE active = 1 AND (barcode = :c OR sku = :c) LIMIT 1");
                    find.bind(":c", barcode);
                    if (!find.step()) throw PosError(std::string(protocol::err::kNotFound), "Bu barkodla mal tapılmadı: " + barcode);
                    ingredientId = find.columnText(0);
                }
                auto line = ctx->db().prepare(
                    "INSERT INTO stocktake_lines (id, stocktake_id, ingredient_id, expected_milli) "
                    "VALUES (lower(hex(randomblob(16))), :st, :i, :expected) ON CONFLICT(stocktake_id, ingredient_id) DO NOTHING");
                line.bind(":st", stocktakeId).bind(":i", ingredientId)
                    .bind(":expected", services::InventoryService(*ctx).levelOf(ingredientId, warehouseId));
                line.exec();
                auto pick = ctx->db().prepare("SELECT id FROM stocktake_lines WHERE stocktake_id = :st AND ingredient_id = :i");
                pick.bind(":st", stocktakeId).bind(":i", ingredientId);
                pick.step();
                lineId = pick.columnText(0);
            }

            auto stmt = ctx->db().prepare(
                "UPDATE stocktake_lines SET counted_milli = CASE WHEN :clear = 1 THEN NULL "
                "  WHEN :mode = 'add' THEN MAX(0, COALESCE(counted_milli, 0) + :counted) ELSE :counted END, "
                "  counted_at = :now WHERE id = :id "
                "  AND stocktake_id IN (SELECT id FROM stocktakes WHERE status = 'open')");
            stmt.bind(":clear", clear ? 1 : 0).bind(":mode", mode).bind(":counted", counted)
                .bind(":now", nowMs()).bind(":id", lineId);
            stmt.exec();
            require(ctx->db().changes() == 1, "Sətir tapılmadı və ya inventarizasiya bağlıdır");
            auto back = ctx->db().prepare(
                "SELECT l.id AS lineId, l.ingredient_id AS ingredientId, i.name, i.unit, l.expected_milli AS expectedMilli, "
                "       l.counted_milli AS countedMilli FROM stocktake_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.id = :id");
            back.bind(":id", lineId);
            back.step();
            Json result = back.row();
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kStocktakePost), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.count");

            const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
            require(!id.empty(), "stocktakeId is required");

            db::Transaction txn(ctx->db());
            auto head = ctx->db().prepare(
                "SELECT warehouse_id, status, zero_uncounted FROM stocktakes WHERE id = :id");
            head.bind(":id", id);
            require(head.step(), "İnventarizasiya tapılmadı");
            const std::string warehouseId = head.columnText(0);
            require(head.columnText(1) == "open", "Bu inventarizasiya artıq bağlanıb");
            const bool zero = head.columnInt(2) != 0;

            // The store ends up holding what was counted. Sales made while
            // counting are already in the level, so the move is target − now.
            auto lines = ctx->db().prepare(
                "SELECT id, ingredient_id, counted_milli FROM stocktake_lines "
                "WHERE stocktake_id = :id AND (counted_milli IS NOT NULL OR :zero = 1)");
            lines.bind(":id", id).bind(":zero", zero ? 1 : 0);
            struct Target {
                std::string lineId, ingredientId;
                std::int64_t qty;
            };
            std::vector<Target> targets;
            while (lines.step()) {
                targets.push_back({lines.columnText(0), lines.columnText(1), lines.columnIsNull(2) ? 0 : lines.columnInt(2)});
            }

            services::InventoryService inventory(*ctx);
            std::int64_t adjusted = 0;
            for (const auto& t : targets) {
                const auto before = inventory.levelOf(t.ingredientId, warehouseId);
                auto mark = ctx->db().prepare("UPDATE stocktake_lines SET posted_before_milli = :b WHERE id = :id");
                mark.bind(":b", before).bind(":id", t.lineId);
                mark.exec();
                const auto delta = t.qty - before;
                if (delta == 0) continue;
                inventory.move(t.ingredientId, warehouseId, delta, "stocktake", id, "inventarizasiya fərqi");
                ++adjusted;
            }

            auto close = ctx->db().prepare(
                "UPDATE stocktakes SET status = 'posted', posted_at = :now WHERE id = :id");
            close.bind(":now", nowMs()).bind(":id", id);
            close.exec();

            ctx->auditRequired("stocktake.post", "stocktake", id, Json{{"adjusted", adjusted}});
            txn.commit();
            logger()->info("stocktake {} posted with {} adjustment(s)", id, adjusted);

            return Json{{"id", id}, {"status", "posted"}, {"adjusted", adjusted}};
        });

    // -------------------------------------------------------------- suppliers
    server.registerHandler(
        std::string(protocol::method::kSuppliersList), [ctx](const ipc::Request&) {
            ctx->requirePermission("suppliers.view");
            auto stmt = ctx->db().prepare(
                "SELECT s.id, s.name, s.contact, s.phone, s.tax_id AS taxId, s.note, s.active, s.company_name AS companyName, s.address, "
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
            for(const auto& field: {std::pair{"companyName","company_name"},std::pair{"address","address"}}) {
                if(request.payload.contains(field.first)) {
                    auto extra=ctx->db().prepare(std::string("UPDATE suppliers SET ")+field.second+"=:v WHERE id=:id");
                    extra.bind(":v",getOr<std::string>(request.payload,field.first,"")).bind(":id",id);extra.exec();
                }
            }
            if (request.payload.contains("active")) {
                // Partnyorlar → Sil: hidden from lists, its history kept.
                auto active = ctx->db().prepare("UPDATE suppliers SET active = :a WHERE id = :id");
                active.bind(":a", getOr<bool>(request.payload, "active", true) ? 1 : 0).bind(":id", id);
                active.exec();
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
            const auto paymentId = crypto::uuid4();
            auto insert = ctx->db().prepare(
                "INSERT INTO supplier_ledger (id, supplier_id, purchase_id, amount_minor, kind, "
                "                             note, actor_user_id, created_at) "
                "VALUES (:id, :supplier, :purchase, :amount, 'payment', :note, :actor, :now)");
            insert.bind(":id", paymentId).bind(":supplier", supplierId)
                .bindOptional(":purchase", getOr<std::string>(request.payload, "purchaseId", ""))
                .bind(":amount", amount)
                .bind(":note", getOr<std::string>(request.payload, "note", ""))
                .bindOptional(":actor", ctx->session().userId).bind(":now", nowMs());
            insert.exec();
            auto link = ctx->db().prepare("INSERT INTO document_cash_links(doc_type,doc_id,account_id) VALUES('supplier',:id,:a)");
            link.bind(":id",paymentId).bind(":a",services::CashService(*ctx).resolveAccount(getOr<std::string>(request.payload,"accountId","")));link.exec();
            if (const auto paidFor = getOr<std::string>(request.payload, "purchaseId", ""); !paidFor.empty())
                refreshPurchase(*ctx, paidFor);

            {
                auto who = ctx->db().prepare("SELECT name FROM suppliers WHERE id = :id");
                who.bind(":id", supplierId);
                services::CashService(*ctx).accountMove(
                    getOr<std::string>(request.payload, "accountId", ""), -amount, "supplier", "supplier",
                    supplierId, "Təchizatçı: " + (who.step() ? who.columnText(0) : std::string{}));
            }
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

    // ---------------------------------------------------------------- recipes
    server.registerHandler(
        std::string(protocol::method::kRecipesGet), [ctx](const ipc::Request& request) {
            ctx->requirePermission("inventory.view");
            const auto menuItemId = getOr<std::string>(request.payload, "menuItemId", "");
            require(!menuItemId.empty(), "menuItemId is required");

            services::InventoryService inventory(*ctx);
            auto stmt = ctx->db().prepare(
                "SELECT r.ingredient_id AS ingredientId, i.name, i.unit, "
                "       r.qty_milli AS qtyMilli, " + services::InventoryService::unitCostSql(inventory.costingMethod()) +
                "       AS costMinor "
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
            // Unit cost by the chosen method: weighted average (default), FIFO
            // (oldest lot still in the store, per obyekt store if given) or the
            // last price paid.
            services::InventoryService inventory(*ctx);
            std::string method = getOr<std::string>(request.payload, "method", "");
            if (method != "average" && method != "fifo" && method != "last") method = inventory.costingMethod();
            auto stmt = ctx->db().prepare(
                "SELECT m.id, m.name_az AS name, c.name_az AS category, m.active, "
                "       m.price_minor AS priceMinor, "
                "       COALESCE(SUM(r.qty_milli * " + services::InventoryService::unitCostSql(method, ":warehouse") +
                "       / 1000), 0) AS costMinor, "
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
                // Kalkulyasiya's period (today, this week, since the last reset).
                "    AND (:since = 0 OR COALESCE(o.closed_at, o.updated_at) >= :since) "
                "  GROUP BY oi.product_id"
                ") s ON s.productId = m.id "
                // Drafts too: a dish is usually costed before it goes on the
                // menu, and a new dish is saved as a draft. Archived ones are gone.
                "WHERE m.archived = 0 "
                "GROUP BY m.id ORDER BY c.name_az, m.name_az");
            stmt.bind(":since", getOr<std::int64_t>(request.payload, "since", 0));
            if (method == "fifo") stmt.bind(":warehouse", getOr<std::string>(request.payload, "warehouseId", ""));
            auto rows = stmt.rows();

            Money soldValue = 0;
            Money costValue = 0;
            std::int64_t missingRecipes = 0;
            std::int64_t unpriced = 0;
            std::int64_t losing = 0;
            std::int64_t dishes = 0;

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

                row["active"] = row.value("active", std::int64_t{0}) != 0;
                // The menu-wide figures describe what is on the menu: drafts are
                // listed so they can be costed, but not counted.
                if (!row["active"].get<bool>()) continue;
                dishes += 1;
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
                        {"method", method},
                        {"summary",
                         Json{{"dishes", dishes},
                              {"withRecipe", dishes - missingRecipes},
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

    registerPurchases(ctx);
    registerStockControl(ctx);
    registerErp(ctx);
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
