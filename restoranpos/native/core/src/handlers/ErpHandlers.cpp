/**
 * Mallar, Kateqoriyalar, İnventarizasiya and Qazanc (1.9.0).
 *
 * Goods are the store's ingredients/stock cards (ingredients). This file adds
 * what a shop needs around them: a category tree, one list with search and
 * totals, a price per branch (obyekt), an Excel import, stocktake documents
 * that can be filled from a terminal file, and income documents - money that
 * came into a kassa from outside sales (the mirror of Xərclər).
 */
#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/db/Database.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CashService.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/InventoryService.hpp"
#include "pos/services/ReplenishService.hpp"

namespace pos::handlers {
namespace {

std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

/** The category and every category under it. */
std::vector<std::string> categoryWithChildren(Context& ctx, const std::string& root) {
    std::vector<std::string> out{root};
    for (std::size_t i = 0; i < out.size() && out.size() < 5000; ++i) {
        auto kids = ctx.db().prepare("SELECT id FROM stock_categories WHERE parent_id = :p AND active = 1");
        kids.bind(":p", out[i]);
        while (kids.step()) out.push_back(kids.columnText(0));
    }
    return out;
}

/** "Ana / Alt" path of a category. */
std::map<std::string, std::string> categoryPaths(Context& ctx) {
    std::map<std::string, std::pair<std::string, std::string>> raw;
    auto rows = ctx.db().prepare("SELECT id, COALESCE(parent_id, ''), name FROM stock_categories WHERE active = 1");
    while (rows.step()) raw[rows.columnText(0)] = {rows.columnText(1), rows.columnText(2)};
    std::map<std::string, std::string> paths;
    for (const auto& [id, entry] : raw) {
        std::string path = entry.second;
        std::string parent = entry.first;
        for (int depth = 0; !parent.empty() && depth < 20; ++depth) {
            auto it = raw.find(parent);
            if (it == raw.end()) break;
            path = it->second.second + " / " + path;
            parent = it->second.first;
        }
        paths[id] = path;
    }
    return paths;
}

/** Finds or makes the category for a path like "İçkilər / Sular". */
std::string categoryForPath(Context& ctx, const std::string& path) {
    std::string parent;
    std::size_t start = 0;
    while (start <= path.size()) {
        auto end = path.find('/', start);
        if (end == std::string::npos) end = path.size();
        std::string part = path.substr(start, end - start);
        part.erase(0, part.find_first_not_of(' '));
        part.erase(part.find_last_not_of(' ') + 1);
        start = end + 1;
        if (part.empty()) continue;
        auto find = ctx.db().prepare(
            "SELECT id FROM stock_categories WHERE active = 1 AND lower(name) = lower(:n) "
            "AND COALESCE(parent_id, '') = :p LIMIT 1");
        find.bind(":n", part).bind(":p", parent);
        if (find.step()) {
            parent = find.columnText(0);
            continue;
        }
        const std::string id = "cat-" + crypto::uuid4().substr(0, 8);
        auto insert = ctx.db().prepare(
            "INSERT INTO stock_categories (id, parent_id, name, created_at) VALUES (:id, :p, :n, :now)");
        insert.bind(":id", id).bindOptional(":p", parent).bind(":n", part).bind(":now", nowMs());
        insert.exec();
        parent = id;
    }
    return parent;
}

std::string nextNumber(Context& ctx, const std::string& table, const std::string& prefix) {
    auto seq = ctx.db().prepare("SELECT COALESCE(MAX(CAST(SUBSTR(number, " + std::to_string(prefix.size() + 1) +
                                ") AS INTEGER)), 0) + 1 FROM " + table + " WHERE number LIKE :p");
    seq.bind(":p", prefix + "%");
    seq.step();
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%s%05lld", prefix.c_str(), static_cast<long long>(seq.columnInt(0)));
    return buf;
}

Json incomeRow(Context& ctx, const std::string& id) {
    auto row = ctx.db().prepare(
        "SELECT d.id, d.number, d.object_id AS objectId, COALESCE(o.name, '') AS objectName, d.account_id AS accountId, "
        "       COALESCE(a.name, '') AS accountName, d.kind, d.reason, d.note, d.amount_minor AS amountMinor, "
        "       d.doc_at AS docAt, d.created_at AS createdAt, d.updated_at AS updatedAt, COALESCE(u.full_name, '') AS actorName "
        "FROM income_docs d LEFT JOIN cash_objects o ON o.id = d.object_id LEFT JOIN cash_accounts a ON a.id = d.account_id "
        "LEFT JOIN users u ON u.id = d.actor_user_id WHERE d.id = :id");
    row.bind(":id", id);
    return row.step() ? row.row() : Json();
}

}  // namespace

void registerErp(const ContextPtr& ctx) {
    auto& server = ctx->server();

    // ------------------------------------------------------------ categories
    server.registerHandler(std::string(protocol::method::kCategoriesList), [ctx](const ipc::Request&) {
        ctx->requirePermission("inventory.view");
        auto stmt = ctx->db().prepare(
            "SELECT c.id, COALESCE(c.parent_id, '') AS parentId, c.name, c.sort_order AS sortOrder, "
            "       (SELECT COUNT(*) FROM ingredients i WHERE i.category_id = c.id AND i.active = 1) AS goods "
            "FROM stock_categories c WHERE c.active = 1 ORDER BY c.sort_order, c.name");
        Json rows = stmt.rows();
        const auto paths = categoryPaths(*ctx);
        for (auto& row : rows) {
            const auto it = paths.find(row.value("id", std::string{}));
            row["path"] = it == paths.end() ? row.value("name", std::string{}) : it->second;
        }
        auto loose = ctx->db().prepare("SELECT COUNT(*) FROM ingredients WHERE active = 1 AND category_id IS NULL");
        loose.step();
        return Json{{"categories", rows}, {"uncategorized", loose.columnInt(0)}};
    });

    server.registerHandler(std::string(protocol::method::kCategoriesSave), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.manage");
        const auto name = getOr<std::string>(request.payload, "name", "");
        auto id = getOr<std::string>(request.payload, "id", "");
        const auto parent = getOr<std::string>(request.payload, "parentId", "");
        require(!name.empty(), "Kateqoriyanın adını yazın");
        db::Transaction txn(ctx->db());
        if (!parent.empty()) {
            auto exists = ctx->db().prepare("SELECT 1 FROM stock_categories WHERE id = :id AND active = 1");
            exists.bind(":id", parent);
            require(exists.step(), "Ana kateqoriya tapılmadı");
            if (!id.empty()) {
                const auto below = categoryWithChildren(*ctx, id);
                require(std::find(below.begin(), below.end(), parent) == below.end(),
                        "Kateqoriya öz alt kateqoriyasının içinə qoyula bilməz");
            }
        }
        const auto now = nowMs();
        if (id.empty()) {
            id = "cat-" + crypto::uuid4().substr(0, 8);
            auto insert = ctx->db().prepare(
                "INSERT INTO stock_categories (id, parent_id, name, sort_order, created_at) "
                "VALUES (:id, :p, :n, (SELECT COUNT(*) FROM stock_categories), :now)");
            insert.bind(":id", id).bindOptional(":p", parent).bind(":n", name).bind(":now", now);
            insert.exec();
        } else {
            auto upd = ctx->db().prepare("UPDATE stock_categories SET name = :n, parent_id = :p WHERE id = :id AND active = 1");
            upd.bind(":n", name).bindOptional(":p", parent).bind(":id", id);
            upd.exec();
            require(ctx->db().changes() == 1, "Kateqoriya tapılmadı");
        }
        ctx->audit("category.save", "stock_category", id, Json{{"name", name}, {"parentId", parent}});
        txn.commit();
        return Json{{"id", id}};
    });

    // Deleting a category keeps what was in it: sub-categories and goods move up a level.
    server.registerHandler(std::string(protocol::method::kCategoriesDelete), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.manage");
        const auto id = getOr<std::string>(request.payload, "categoryId", "");
        db::Transaction txn(ctx->db());
        auto head = ctx->db().prepare("SELECT COALESCE(parent_id, '') FROM stock_categories WHERE id = :id AND active = 1");
        head.bind(":id", id);
        require(head.step(), "Kateqoriya tapılmadı");
        const std::string parent = head.columnText(0);
        auto kids = ctx->db().prepare("UPDATE stock_categories SET parent_id = :p WHERE parent_id = :id");
        kids.bindOptional(":p", parent).bind(":id", id);
        kids.exec();
        auto goods = ctx->db().prepare("UPDATE ingredients SET category_id = :p WHERE category_id = :id");
        goods.bindOptional(":p", parent).bind(":id", id);
        goods.exec();
        auto drop = ctx->db().prepare("UPDATE stock_categories SET active = 0 WHERE id = :id");
        drop.bind(":id", id);
        drop.exec();
        ctx->audit("category.delete", "stock_category", id, Json::object());
        txn.commit();
        return Json{{"id", id}};
    });

    // ------------------------------------------------------------------ goods
    // One list for Mallar and Anbar: search by name, barcode, code or price;
    // the price in a chosen branch; quantity in one store or all; and the
    // totals at cost, at sale price and the profit between them.
    server.registerHandler(std::string(protocol::method::kGoodsList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.view");
        const auto search = getOr<std::string>(request.payload, "search", "");
        const auto categoryId = getOr<std::string>(request.payload, "categoryId", "");
        const auto warehouseId = getOr<std::string>(request.payload, "warehouseId", "");
        const auto objectId = getOr<std::string>(request.payload, "objectId", "");
        const bool withStockOnly = getOr<bool>(request.payload, "inStockOnly", false);
        services::InventoryService inventory(*ctx);
        const auto method = inventory.costingMethod();
        auto stmt = ctx->db().prepare(
            "SELECT i.id, i.sku, i.name, i.unit, i.barcode, COALESCE(i.category_id, '') AS categoryId, i.plu, i.weighted, "
            "       i.cost_minor AS lastCostMinor, " + services::InventoryService::unitCostSql(method) + " AS costMinor, "
            "       i.min_qty_milli AS minQtyMilli, "
            "       CASE WHEN i.sku LIKE 'MENU-%' THEN COALESCE((SELECT m.price_minor FROM menu_items m "
            "         WHERE m.id = substr(i.sku, 6)), i.sale_price_minor) ELSE i.sale_price_minor END AS basePriceMinor, "
            "       (SELECT p.sale_price_minor FROM item_prices p WHERE p.ingredient_id = i.id AND p.object_id = :object) AS objectPriceMinor, "
            "       COALESCE((SELECT SUM(s.qty_milli) FROM stock_levels s WHERE s.ingredient_id = i.id "
            "                  AND (:warehouse = '' OR s.warehouse_id = :warehouse)), 0) AS qtyMilli, "
            "       i.updated_at AS updatedAt "
            "FROM ingredients i WHERE i.active = 1 ORDER BY i.name");
        stmt.bind(":object", objectId).bind(":warehouse", warehouseId);
        Json rows = stmt.rows();

        std::set<std::string> allowed;
        if (!categoryId.empty()) {
            if (categoryId == "none") allowed.insert("");
            else for (const auto& id : categoryWithChildren(*ctx, categoryId)) allowed.insert(id);
        }
        const auto paths = categoryPaths(*ctx);
        // Prices per branch, for the editor and the list.
        std::map<std::string, Json> prices;
        {
            auto all = ctx->db().prepare(
                "SELECT p.ingredient_id, p.object_id, o.name, p.sale_price_minor FROM item_prices p "
                "JOIN cash_objects o ON o.id = p.object_id AND o.active = 1");
            while (all.step()) {
                auto& list = prices[all.columnText(0)];
                if (!list.is_array()) list = Json::array();
                list.push_back(Json{{"objectId", all.columnText(1)}, {"objectName", all.columnText(2)},
                                    {"salePriceMinor", all.columnInt(3)}});
            }
        }
        const std::string needle = lower(search);
        // A number searches prices too: "6" or "6.50" finds goods selling or bought at that.
        double asNumber = -1;
        try {
            std::size_t used = 0;
            std::string normalized = search;
            std::replace(normalized.begin(), normalized.end(), ',', '.');
            if (!normalized.empty()) asNumber = std::stod(normalized, &used);
            if (used != normalized.size()) asNumber = -1;
        } catch (...) {
            asNumber = -1;
        }
        const Money asMinor = asNumber >= 0 ? static_cast<Money>(std::llround(asNumber * 100)) : -1;

        // 1.5.61: what was actually sold (Market sales booked here, net of returns). The stock
        // figures above shrink as goods leave; this profit grows with every sale. Revenue is the
        // receipt line after the receipt's own discount; the cost is today's unit cost.
        std::map<std::string, std::pair<std::int64_t, Money>> sold;  // good -> (qtyMilli, revenueMinor)
        {
            auto s = ctx->db().prepare(
                "WITH m AS (SELECT reference_id AS o, ingredient_id AS g, "
                "    -SUM(CASE WHEN qty_delta_milli < 0 THEN qty_delta_milli ELSE 0 END) AS outq, "
                "    SUM(CASE WHEN qty_delta_milli > 0 THEN qty_delta_milli ELSE 0 END) AS backq "
                "  FROM stock_movements WHERE kind = 'sale' AND (:warehouse = '' OR warehouse_id = :warehouse) "
                "  GROUP BY reference_id, ingredient_id) "
                "SELECT m.g, SUM(m.outq - m.backq), "
                "  SUM(CASE WHEN m.outq > 0 THEN CAST(ROUND(COALESCE(li.total, 0) * 1.0 * (m.outq - m.backq) / m.outq "
                "      * CASE WHEN COALESCE(o.subtotal_minor, 0) > 0 THEN o.total_minor * 1.0 / o.subtotal_minor ELSE 1 END) AS INTEGER) ELSE 0 END) "
                "FROM m JOIN external_sales e ON e.order_id = m.o AND e.kind = 'sale' "
                "JOIN orders o ON o.id = m.o "
                "LEFT JOIN (SELECT order_id, substr(product_id, 5) AS g, SUM(line_total_minor) AS total FROM order_items "
                "  WHERE product_id LIKE 'ext-%' GROUP BY order_id, product_id) li ON li.order_id = m.o AND li.g = m.g "
                "GROUP BY m.g");
            s.bind(":warehouse", warehouseId);
            while (s.step()) sold[s.columnText(0)] = {s.columnInt(1), s.columnInt(2)};
        }

        Json out = Json::array();
        Money costTotal = 0, saleTotal = 0, soldTotal = 0, soldCostTotal = 0;
        std::int64_t qtyTotal = 0, soldQtyTotal = 0;
        for (auto& row : rows) {
            const auto cat = row.value("categoryId", std::string{});
            if (!categoryId.empty() && !allowed.count(cat)) continue;
            const auto qty = row.value("qtyMilli", std::int64_t{0});
            if (withStockOnly && qty <= 0) continue;
            const Money price = row["objectPriceMinor"].is_number() ? row["objectPriceMinor"].get<Money>()
                                                                     : row.value("basePriceMinor", Money{0});
            const Money cost = row.value("costMinor", Money{0});
            if (!needle.empty()) {
                const bool text = lower(row.value("name", std::string{})).find(needle) != std::string::npos ||
                                  lower(row.value("barcode", std::string{})).find(needle) != std::string::npos ||
                                  lower(row.value("sku", std::string{})).find(needle) != std::string::npos;
                const bool money = asMinor >= 0 && (price == asMinor || cost == asMinor);
                const bool plu = asNumber >= 0 && std::floor(asNumber) == asNumber &&
                                 row.value("plu", std::int64_t{0}) == static_cast<std::int64_t>(asNumber) && asNumber > 0;
                if (!text && !money && !plu) continue;
            }
            const auto path = paths.find(cat);
            row["categoryPath"] = path == paths.end() ? std::string{} : path->second;
            row["salePriceMinor"] = price;
            row["prices"] = prices.count(row.value("id", std::string{})) ? prices[row.value("id", std::string{})] : Json::array();
            const Money positive = std::max<std::int64_t>(0, qty);
            row["costValueMinor"] = positive * cost / 1000;
            row["saleValueMinor"] = positive * price / 1000;
            row["profitMinor"] = positive * (price - cost) / 1000;
            const auto soldIt = sold.find(row.value("id", std::string{}));
            const std::int64_t soldQty = soldIt == sold.end() ? 0 : std::max<std::int64_t>(0, soldIt->second.first);
            const Money soldMinor = soldIt == sold.end() ? 0 : std::max<Money>(0, soldIt->second.second);
            const Money soldCost = soldQty * cost / 1000;
            row["soldQtyMilli"] = soldQty;
            row["soldMinor"] = soldMinor;
            row["soldCostMinor"] = soldCost;
            row["soldProfitMinor"] = soldMinor - soldCost;
            costTotal += positive * cost / 1000;
            saleTotal += positive * price / 1000;
            qtyTotal += qty;
            soldQtyTotal += soldQty;
            soldTotal += soldMinor;
            soldCostTotal += soldCost;
            out.push_back(row);
        }
        return Json{{"goods", out}, {"method", method},
                    {"totals", Json{{"count", out.size()}, {"qtyMilli", qtyTotal}, {"costMinor", costTotal},
                                    {"saleMinor", saleTotal}, {"profitMinor", saleTotal - costTotal},
                                    {"soldQtyMilli", soldQtyTotal}, {"soldMinor", soldTotal},
                                    {"soldCostMinor", soldCostTotal}, {"soldProfitMinor", soldTotal - soldCostTotal}}}};
    });

    // A good's own price, plus a price in each branch where it differs.
    server.registerHandler(std::string(protocol::method::kGoodsPrices), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.manage");
        const auto id = getOr<std::string>(request.payload, "ingredientId", "");
        require(request.payload.contains("prices") && request.payload["prices"].is_array(), "prices tələb olunur");
        db::Transaction txn(ctx->db());
        auto exists = ctx->db().prepare("SELECT 1 FROM ingredients WHERE id = :id AND active = 1");
        exists.bind(":id", id);
        require(exists.step(), "Mal tapılmadı");
        const auto now = nowMs();
        for (const auto& raw : request.payload["prices"]) {
            if (!raw.is_object()) continue;
            const auto objectId = getOr<std::string>(raw, "objectId", "");
            if (objectId.empty()) continue;
            if (!raw.contains("salePriceMinor") || raw["salePriceMinor"].is_null()) {
                auto drop = ctx->db().prepare("DELETE FROM item_prices WHERE ingredient_id = :i AND object_id = :o");
                drop.bind(":i", id).bind(":o", objectId);
                drop.exec();
                continue;
            }
            const auto price = getOr<Money>(raw, "salePriceMinor", 0);
            require(price >= 0, "Qiymət mənfi ola bilməz");
            auto upsert = ctx->db().prepare(
                "INSERT INTO item_prices (ingredient_id, object_id, sale_price_minor, updated_at) VALUES (:i, :o, :p, :now) "
                "ON CONFLICT(ingredient_id, object_id) DO UPDATE SET sale_price_minor = :p, updated_at = :now");
            upsert.bind(":i", id).bind(":o", objectId).bind(":p", price).bind(":now", now);
            upsert.exec();
        }
        ctx->audit("goods.prices", "ingredient", id, Json::object());
        txn.commit();
        return Json{{"ingredientId", id}};
    });

    // Excel/CSV rows: a known barcode is updated, anything else becomes a new good.
    server.registerHandler(std::string(protocol::method::kGoodsImport), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.manage");
        require(request.payload.contains("rows") && request.payload["rows"].is_array(), "Sətir yoxdur");
        const bool update = getOr<bool>(request.payload, "updateExisting", true);
        db::Transaction txn(ctx->db());
        const auto now = nowMs();
        std::int64_t created = 0, updated = 0, skipped = 0;
        Json problems = Json::array();
        std::set<std::string> seen;
        std::int64_t line = 0;
        for (const auto& raw : request.payload["rows"]) {
            ++line;
            if (!raw.is_object()) continue;
            std::string name = getOr<std::string>(raw, "name", "");
            const auto barcode = getOr<std::string>(raw, "barcode", "");
            std::string unit = getOr<std::string>(raw, "unit", "ədəd");
            if (unit != "kg" && unit != "l" && unit != "ədəd" && unit != "qab" && unit != "q") unit = "ədəd";
            const auto cost = getOr<Money>(raw, "costMinor", -1);
            const auto sale = getOr<Money>(raw, "salePriceMinor", -1);
            const auto category = getOr<std::string>(raw, "category", "");
            if (name.empty() && barcode.empty()) { ++skipped; continue; }
            if (!barcode.empty() && seen.count(barcode)) {
                problems.push_back(Json{{"line", line}, {"error", "Faylda eyni barkod təkrarlanır: " + barcode}});
                ++skipped;
                continue;
            }
            if (!barcode.empty()) seen.insert(barcode);
            const std::string categoryId = category.empty() ? std::string{} : categoryForPath(*ctx, category);
            std::string existing;
            if (!barcode.empty()) {
                auto find = ctx->db().prepare("SELECT id FROM ingredients WHERE active = 1 AND barcode = :b LIMIT 1");
                find.bind(":b", barcode);
                if (find.step()) existing = find.columnText(0);
            }
            if (!existing.empty()) {
                if (!update) { ++skipped; continue; }
                auto upd = ctx->db().prepare(
                    "UPDATE ingredients SET name = CASE WHEN :n = '' THEN name ELSE :n END, "
                    "  cost_minor = CASE WHEN :c >= 0 THEN :c ELSE cost_minor END, "
                    "  avg_cost_minor = CASE WHEN :c >= 0 AND avg_cost_minor = 0 THEN :c ELSE avg_cost_minor END, "
                    "  sale_price_minor = CASE WHEN :s >= 0 THEN :s ELSE sale_price_minor END, "
                    "  category_id = CASE WHEN :cat = '' THEN category_id ELSE :cat END, updated_at = :now WHERE id = :id");
                upd.bind(":n", name).bind(":c", cost).bind(":s", sale).bind(":cat", categoryId).bind(":now", now).bind(":id", existing);
                upd.exec();
                ++updated;
                continue;
            }
            if (name.empty()) {
                problems.push_back(Json{{"line", line}, {"error", "Adı yoxdur"}});
                ++skipped;
                continue;
            }
            const std::string id = "ing-" + crypto::uuid4().substr(0, 8);
            auto insert = ctx->db().prepare(
                "INSERT INTO ingredients (id, sku, name, unit, cost_minor, avg_cost_minor, min_qty_milli, barcode, "
                "  sale_price_minor, category_id, weighted, created_at, updated_at) "
                "VALUES (:id, :sku, :n, :u, :c, :c, 0, :b, :s, :cat, :w, :now, :now)");
            insert.bind(":id", id).bind(":sku", "ING-" + id.substr(4)).bind(":n", name).bind(":u", unit)
                .bind(":c", std::max<Money>(0, cost)).bind(":b", barcode).bind(":s", std::max<Money>(0, sale))
                .bindOptional(":cat", categoryId).bind(":w", unit == "kg" || unit == "l" || unit == "q" ? 1 : 0).bind(":now", now);
            insert.exec();
            ++created;
        }
        ctx->auditRequired("goods.import", "ingredient", "", Json{{"created", created}, {"updated", updated}});
        txn.commit();
        return Json{{"created", created}, {"updated", updated}, {"skipped", skipped}, {"problems", problems}};
    });

    // ------------------------------------------------------------- stocktake
    // A terminal's file: barcode (or code) and quantity per line.
    server.registerHandler(std::string(protocol::method::kStocktakeImport), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.count");
        const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
        const auto mode = getOr<std::string>(request.payload, "mode", "set");
        require(mode == "set" || mode == "add", "mode: set və ya add");
        require(request.payload.contains("lines") && request.payload["lines"].is_array(), "Sətir yoxdur");
        db::Transaction txn(ctx->db());
        auto head = ctx->db().prepare("SELECT warehouse_id, status FROM stocktakes WHERE id = :id");
        head.bind(":id", id);
        require(head.step(), "İnventarizasiya tapılmadı");
        require(head.columnText(1) == "open", "Bu inventarizasiya bağlanıb");
        const std::string warehouseId = head.columnText(0);
        services::InventoryService inventory(*ctx);
        const auto now = nowMs();
        std::int64_t matched = 0;
        Json unmatched = Json::array();
        for (const auto& raw : request.payload["lines"]) {
            if (!raw.is_object()) continue;
            const auto code = getOr<std::string>(raw, "barcode", getOr<std::string>(raw, "code", ""));
            const auto qty = getOr<std::int64_t>(raw, "qtyMilli", 0);
            if (code.empty()) continue;
            auto find = ctx->db().prepare(
                "SELECT id FROM ingredients WHERE active = 1 AND (barcode = :c OR sku = :c OR id = :c) LIMIT 1");
            find.bind(":c", code);
            if (!find.step()) {
                unmatched.push_back(Json{{"code", code}, {"qtyMilli", qty}});
                continue;
            }
            const std::string ingredient = find.columnText(0);
            auto line = ctx->db().prepare(
                "INSERT INTO stocktake_lines (id, stocktake_id, ingredient_id, expected_milli, counted_milli, counted_at) "
                "VALUES (:lid, :st, :i, :expected, :qty, :now) "
                "ON CONFLICT(stocktake_id, ingredient_id) DO UPDATE SET "
                "  counted_milli = CASE WHEN :mode = 'add' THEN COALESCE(counted_milli, 0) + :qty ELSE :qty END, counted_at = :now");
            line.bind(":lid", crypto::uuid4()).bind(":st", id).bind(":i", ingredient)
                .bind(":expected", inventory.levelOf(ingredient, warehouseId)).bind(":qty", std::max<std::int64_t>(0, qty))
                .bind(":mode", mode).bind(":now", now);
            line.exec();
            ++matched;
        }
        txn.commit();
        return Json{{"matched", matched}, {"unmatched", unmatched}};
    });

    server.registerHandler(std::string(protocol::method::kStocktakeUpdate), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.count");
        const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
        auto upd = ctx->db().prepare(
            "UPDATE stocktakes SET note = COALESCE(:note, note), zero_uncounted = COALESCE(:zero, zero_uncounted) "
            "WHERE id = :id AND status = 'open'");
        if (request.payload.contains("note")) upd.bind(":note", getOr<std::string>(request.payload, "note", ""));
        else upd.bind(":note", nullptr);
        if (request.payload.contains("zeroUncounted")) upd.bind(":zero", getOr<bool>(request.payload, "zeroUncounted", true) ? 1 : 0);
        else upd.bind(":zero", nullptr);
        upd.bind(":id", id);
        upd.exec();
        require(ctx->db().changes() == 1, "İnventarizasiya tapılmadı və ya bağlanıb");
        return Json{{"id", id}};
    });

    server.registerHandler(std::string(protocol::method::kStocktakeCancel), [ctx](const ipc::Request& request) {
        ctx->requirePermission("inventory.count");
        const auto id = getOr<std::string>(request.payload, "stocktakeId", "");
        auto upd = ctx->db().prepare("UPDATE stocktakes SET status = 'cancelled' WHERE id = :id AND status = 'open'");
        upd.bind(":id", id);
        upd.exec();
        require(ctx->db().changes() == 1, "İnventarizasiya tapılmadı və ya bağlanıb");
        ctx->audit("stocktake.cancel", "stocktake", id, Json::object());
        return Json{{"id", id}, {"status", "cancelled"}};
    });

    // ----------------------------------------------------------------- income
    server.registerHandler(std::string(protocol::method::kIncomeList), [ctx](const ipc::Request& request) {
        ctx->requirePermission("cash.manage");
        const auto from = getOr<std::int64_t>(request.payload, "from", 0);
        const auto to = getOr<std::int64_t>(request.payload, "to", nowMs() + 86400000LL);
        auto stmt = ctx->db().prepare(
            "SELECT d.id FROM income_docs d WHERE d.deleted_at IS NULL AND d.doc_at >= :from AND d.doc_at < :to "
            "  AND (:object = '' OR d.object_id = :object) AND (:account = '' OR d.account_id = :account) "
            "  AND (:kind = '' OR d.kind = :kind) "
            "  AND (:q = '' OR lower(d.reason) LIKE :like OR lower(d.note) LIKE :like OR lower(d.number) LIKE :like OR lower(d.kind) LIKE :like) "
            "ORDER BY d.doc_at DESC LIMIT 3000");
        const auto q = lower(getOr<std::string>(request.payload, "search", ""));
        stmt.bind(":from", from).bind(":to", to).bind(":object", getOr<std::string>(request.payload, "objectId", ""))
            .bind(":account", getOr<std::string>(request.payload, "accountId", ""))
            .bind(":kind", getOr<std::string>(request.payload, "kind", "")).bind(":q", q).bind(":like", "%" + q + "%");
        Json rows = Json::array();
        Money total = 0;
        std::vector<std::string> ids;
        while (stmt.step()) ids.push_back(stmt.columnText(0));
        for (const auto& id : ids) {
            Json row = incomeRow(*ctx, id);
            total += row.value("amountMinor", Money{0});
            rows.push_back(row);
        }
        auto kinds = ctx->db().prepare("SELECT DISTINCT kind FROM income_docs WHERE deleted_at IS NULL AND kind != '' ORDER BY kind");
        Json kindList = Json::array();
        while (kinds.step()) kindList.push_back(kinds.columnText(0));
        return Json{{"docs", rows}, {"totalMinor", total}, {"kinds", kindList}};
    });

    // Save = new or corrected: a correction takes the old money back out and puts the new in.
    server.registerHandler(std::string(protocol::method::kIncomeSave), [ctx](const ipc::Request& request) {
        ctx->requirePermission("cash.manage");
        auto id = getOr<std::string>(request.payload, "id", "");
        const auto accountId = getOr<std::string>(request.payload, "accountId", "");
        const auto amount = getOr<Money>(request.payload, "amountMinor", 0);
        const auto kind = getOr<std::string>(request.payload, "kind", "");
        const auto reason = getOr<std::string>(request.payload, "reason", "");
        const auto note = getOr<std::string>(request.payload, "note", "");
        const auto docAt = getOr<std::int64_t>(request.payload, "docAt", nowMs());
        require(!accountId.empty(), "Pulun girdiyi kassanı seçin");
        require(amount > 0, "Məbləğ sıfırdan böyük olmalıdır");
        db::Transaction txn(ctx->db());
        services::Idempotency idem(*ctx);
        const auto key = getOr<std::string>(request.payload, "idempotencyKey", request.idempotencyKey);
        if (auto replay = idem.begin(key, "income.save", request.payload)) return *replay;
        auto account = ctx->db().prepare("SELECT COALESCE(object_id, ''), name FROM cash_accounts WHERE id = :id AND active = 1");
        account.bind(":id", accountId);
        require(account.step(), "Kassa tapılmadı");
        const std::string objectId = getOr<std::string>(request.payload, "objectId", account.columnText(0));
        const auto now = nowMs();
        services::CashService cash(*ctx);
        std::string number;
        if (id.empty()) {
            id = "inc-" + crypto::uuid4().substr(0, 10);
            number = nextNumber(*ctx, "income_docs", "GL-");
            auto insert = ctx->db().prepare(
                "INSERT INTO income_docs (id, number, object_id, account_id, kind, reason, note, amount_minor, doc_at, "
                "  actor_user_id, created_at, updated_at) VALUES (:id, :no, :o, :a, :k, :r, :n, :amount, :at, :actor, :now, :now)");
            insert.bind(":id", id).bind(":no", number).bind(":o", objectId).bind(":a", accountId).bind(":k", kind).bind(":r", reason)
                .bind(":n", note).bind(":amount", amount).bind(":at", docAt).bindOptional(":actor", ctx->session().userId).bind(":now", now);
            insert.exec();
        } else {
            auto old = ctx->db().prepare("SELECT account_id, amount_minor, number FROM income_docs WHERE id = :id AND deleted_at IS NULL");
            old.bind(":id", id);
            require(old.step(), "Qaimə tapılmadı");
            number = old.columnText(2);
            cash.accountMove(old.columnText(0), -old.columnInt(1), "income", "income", id, "Düzəliş " + number);
            auto upd = ctx->db().prepare(
                "UPDATE income_docs SET object_id = :o, account_id = :a, kind = :k, reason = :r, note = :n, amount_minor = :amount, "
                "  doc_at = :at, updated_at = :now WHERE id = :id");
            upd.bind(":o", objectId).bind(":a", accountId).bind(":k", kind).bind(":r", reason).bind(":n", note)
                .bind(":amount", amount).bind(":at", docAt).bind(":now", now).bind(":id", id);
            upd.exec();
        }
        cash.accountMove(accountId, amount, "income", "income", id,
                         "Qazanc " + number + (reason.empty() ? std::string{} : " · " + reason));
        ctx->auditRequired("income.save", "income", id, Json{{"amountMinor", amount}, {"accountId", accountId}});
        Json response = incomeRow(*ctx, id);
        idem.complete(key, response, "income", id);
        txn.commit();
        return response;
    });

    server.registerHandler(std::string(protocol::method::kIncomeDelete), [ctx](const ipc::Request& request) {
        ctx->requirePermission("cash.manage");
        const auto id = getOr<std::string>(request.payload, "id", "");
        db::Transaction txn(ctx->db());
        auto old = ctx->db().prepare("SELECT account_id, amount_minor, number FROM income_docs WHERE id = :id AND deleted_at IS NULL");
        old.bind(":id", id);
        require(old.step(), "Qaimə tapılmadı");
        services::CashService(*ctx).accountMove(old.columnText(0), -old.columnInt(1), "income", "income", id,
                                                "Silindi " + old.columnText(2));
        auto drop = ctx->db().prepare("UPDATE income_docs SET deleted_at = :now WHERE id = :id");
        drop.bind(":now", nowMs()).bind(":id", id);
        drop.exec();
        ctx->auditRequired("income.delete", "income", id, Json::object());
        txn.commit();
        return Json{{"id", id}};
    });
}

}  // namespace pos::handlers
