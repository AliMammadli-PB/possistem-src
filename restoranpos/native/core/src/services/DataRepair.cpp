#include "pos/services/DataRepair.hpp"

#include <string>

#include "pos/Crypto.hpp"
#include "pos/db/Database.hpp"
#include "pos/services/CatalogAdminService.hpp"

namespace pos::services {
namespace {

/** A recipe line on the card of an archived dish moves to the one live dish of that name. */
std::int64_t repointArchivedCards(db::Database& db) {
    auto stale = db.prepare(
        "SELECT r.menu_item_id AS menu, r.ingredient_id AS oldCard, r.qty_milli AS qty, live.card AS newCard "
        "FROM menu_item_ingredients r "
        "JOIN catalog_goods_links l ON l.ingredient_id = r.ingredient_id "
        "JOIN ingredients i ON i.id = r.ingredient_id AND i.sku LIKE 'MENU-%' "
        "JOIN menu_items dead ON dead.id = l.menu_id AND dead.archived = 1 "
        "JOIN menu_items owner ON owner.id = r.menu_item_id AND owner.archived = 0 "
        "JOIN (SELECT m.name_az, MIN(m.id) AS id, MIN(g.ingredient_id) AS card, COUNT(*) AS n "
        "      FROM menu_items m JOIN catalog_goods_links g ON g.menu_id = m.id "
        "      WHERE m.archived = 0 GROUP BY m.name_az) live "
        "  ON live.name_az = dead.name_az AND live.n = 1 AND live.id <> r.menu_item_id");
    std::int64_t moved = 0;
    for (const auto& row : stale.rows()) {
        auto add = db.prepare(
            "INSERT OR IGNORE INTO menu_item_ingredients(menu_item_id, ingredient_id, qty_milli) "
            "VALUES (:menu, :card, :qty)");
        add.bind(":menu", row.at("menu").get<std::string>())
            .bind(":card", row.at("newCard").get<std::string>())
            .bind(":qty", row.at("qty").get<std::int64_t>())
            .exec();
        auto drop = db.prepare("DELETE FROM menu_item_ingredients WHERE menu_item_id = :menu AND ingredient_id = :card");
        drop.bind(":menu", row.at("menu").get<std::string>()).bind(":card", row.at("oldCard").get<std::string>()).exec();
        moved += 1;
    }
    return moved;
}

/** The recipe screen before 1.10.3 switched off the card of any dish it saved, hiding it from pickers. */
std::int64_t reactivatePreparedCards(db::Database& db) {
    auto stmt = db.prepare(
        "UPDATE ingredients SET active = 1, updated_at = :now WHERE active = 0 AND sku LIKE 'MENU-%' AND id IN ("
        "  SELECT l.ingredient_id FROM catalog_goods_links l JOIN menu_items m ON m.id = l.menu_id "
        "  WHERE m.archived = 0 AND (EXISTS(SELECT 1 FROM menu_item_components c WHERE c.menu_item_id = l.menu_id) "
        "    OR EXISTS(SELECT 1 FROM menu_item_ingredients r WHERE r.menu_item_id = l.menu_id AND r.ingredient_id <> l.ingredient_id)))");
    stmt.bind(":now", nowMs()).exec();
    return db.changes();
}

std::int64_t scalar(db::Database& db, const char* sql) {
    auto stmt = db.prepare(sql);
    stmt.step();
    return stmt.columnInt(0);
}

/** Card lines of dishes that have their own recipe become recipe parts. */
std::int64_t adoptPreparedDishes(handlers::Context& ctx) {
    const auto before = scalar(ctx.db(), "SELECT COUNT(*) FROM menu_item_ingredients");
    auto parts = ctx.db().prepare(
        "SELECT DISTINCT l.menu_id AS id FROM menu_item_ingredients r "
        "JOIN catalog_goods_links l ON l.ingredient_id = r.ingredient_id WHERE r.menu_item_id <> l.menu_id");
    for (const auto& row : parts.rows()) adoptPreparedRecipe(ctx, row.at("id").get<std::string>());
    return before - scalar(ctx.db(), "SELECT COUNT(*) FROM menu_item_ingredients");
}

}  // namespace

/** Takes the card of an archived dish off the stock lists, unless it holds goods or a recipe still uses it. */
std::int64_t retireArchivedCards(db::Database& db) {
    auto stmt = db.prepare(
        "UPDATE ingredients SET active = 0, updated_at = :now WHERE active = 1 AND sku LIKE 'MENU-%' "
        "AND id IN (SELECT l.ingredient_id FROM catalog_goods_links l JOIN menu_items m ON m.id = l.menu_id WHERE m.archived = 1) "
        "AND NOT EXISTS(SELECT 1 FROM stock_levels s WHERE s.ingredient_id = ingredients.id AND s.qty_milli > 0) "
        "AND NOT EXISTS(SELECT 1 FROM menu_item_ingredients r JOIN menu_items m ON m.id = r.menu_item_id "
        "  JOIN catalog_goods_links l ON l.ingredient_id = r.ingredient_id "
        "  WHERE r.ingredient_id = ingredients.id AND m.archived = 0 AND m.id <> l.menu_id)");
    stmt.bind(":now", nowMs()).exec();
    return db.changes();
}

namespace {

/**
 * A till with one branch has one store room: the seeded main warehouse folds into the branch's.
 * Everything moves with it, history included, so an old sale can still be corrected. Stays apart
 * when a transfer document involves the main one, or the till has several branches.
 */
std::string mergeMainWarehouse(db::Database& db) {
    auto branch = db.prepare(
        "SELECT MIN(o.warehouse_id), COUNT(*) FROM cash_objects o "
        "JOIN warehouses w ON w.id = o.warehouse_id AND w.active = 1 WHERE o.active = 1");
    branch.step();
    if (branch.columnInt(1) != 1) return {};
    const auto target = branch.columnText(0);
    if (target == "wh-main") return {};
    if (scalar(db, "SELECT COUNT(*) FROM warehouses WHERE id = 'wh-main' AND active = 1") == 0) return {};
    if (scalar(db, "SELECT COUNT(*) FROM cash_objects WHERE active = 1") != 1) return {};
    if (scalar(db, "SELECT COUNT(*) FROM transfer_docs WHERE 'wh-main' IN (from_warehouse_id, to_warehouse_id)") != 0) return {};

    auto levels = db.prepare(
        "INSERT INTO stock_levels(ingredient_id, warehouse_id, qty_milli, updated_at) "
        "SELECT ingredient_id, :target, qty_milli, :now FROM stock_levels WHERE warehouse_id = 'wh-main' "
        "ON CONFLICT(ingredient_id, warehouse_id) DO UPDATE SET "
        "  qty_milli = stock_levels.qty_milli + excluded.qty_milli, updated_at = excluded.updated_at");
    levels.bind(":target", target).bind(":now", nowMs()).exec();
    db.exec("DELETE FROM stock_levels WHERE warehouse_id = 'wh-main'");
    for (const char* table : {"stock_movements", "stock_lots", "stock_rules", "stock_locations", "stocktakes",
                              "purchase_orders", "purchase_receipts", "purchase_returns", "waste_documents",
                              "user_warehouse_access"}) {
        auto update = db.prepare(std::string("UPDATE OR IGNORE ") + table +
                                 " SET warehouse_id = :target WHERE warehouse_id = 'wh-main'");
        update.bind(":target", target).exec();
    }
    db.exec("DELETE FROM stock_rules WHERE warehouse_id = 'wh-main'");
    db.exec("DELETE FROM user_warehouse_access WHERE warehouse_id = 'wh-main'");
    auto retire = db.prepare("UPDATE warehouses SET active = 0, updated_at = :now WHERE id = 'wh-main'");
    retire.bind(":now", nowMs()).exec();
    return target;
}

}  // namespace

Json repairStockData(handlers::Context& ctx) {
    auto& db = ctx.db();
    db::Transaction txn(db);
    Json done = Json::object();
    const auto note = [&](const char* key, std::int64_t count) { if (count != 0) done[key] = count; };
    note("linesMovedToLiveDish", repointArchivedCards(db));
    note("cardsSwitchedBackOn", reactivatePreparedCards(db));
    note("linesMadeRecipeParts", adoptPreparedDishes(ctx));
    note("archivedCardsRetired", retireArchivedCards(db));
    const auto merged = mergeMainWarehouse(db);
    if (!merged.empty()) done["mainWarehouseMergedInto"] = merged;
    if (!done.empty()) {
        auto log = db.prepare("INSERT INTO data_repairs(id, detail, created_at) VALUES (:id, :detail, :now)");
        log.bind(":id", crypto::uuid4()).bind(":detail", done.dump()).bind(":now", nowMs()).exec();
        ctx.audit("data.repair", "stock", "startup", done);
    }
    txn.commit();
    return done;
}

}  // namespace pos::services
