#include "pos/services/CatalogAdminService.hpp"

#include <sstream>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {
namespace {

std::string requireNonEmpty(const Json& payload, const char* key) {
    const auto value = payload.value(key, "");
    if (value.empty()) {
        throw PosError(std::string(protocol::err::kValidation),
                       std::string(key) + " is required");
    }
    return value;
}

std::vector<std::string> splitCsvLine(const std::string& line) {
    std::vector<std::string> cells;
    std::string cur;
    bool inQuotes = false;
    for (std::size_t i = 0; i < line.size(); ++i) {
        const char c = line[i];
        if (c == '"') {
            if (inQuotes && i + 1 < line.size() && line[i + 1] == '"') {
                cur.push_back('"');
                ++i;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c == ',' && !inQuotes) {
            cells.push_back(cur);
            cur.clear();
        } else {
            cur.push_back(c);
        }
    }
    cells.push_back(cur);
    return cells;
}

}  // namespace

Json CatalogAdminService::upsertCategory(const Json& payload) {
    const auto nameAz = requireNonEmpty(payload, "nameAz");
    const auto now = nowMs();
    std::string id = payload.value("id", "");
    if (id.empty()) id = crypto::uuid4();

    auto existing = ctx_.db().prepare("SELECT id FROM menu_categories WHERE id = :id");
    existing.bind(":id", id);
    if (existing.step()) {
        auto upd = ctx_.db().prepare(
            "UPDATE menu_categories SET name_az = :nameAz, name_tr = :nameTr, name_en = :nameEn, "
            "icon = :icon, accent = :accent, image = :image, sort_order = :sort "
            "WHERE id = :id");
        upd.bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", ""))
            .bind(":nameEn", payload.value("nameEn", ""))
            .bind(":icon", payload.value("icon", ""))
            .bind(":accent", payload.value("accent", ""))
            .bind(":image", payload.value("image", ""))
            .bind(":sort", payload.value("sortOrder", 0))
            .bind(":id", id);
        upd.exec();
    } else {
        auto ins = ctx_.db().prepare(
            "INSERT INTO menu_categories (id, name_az, name_tr, name_en, icon, accent, image, "
            "sort_order, active) "
            "VALUES (:id, :nameAz, :nameTr, :nameEn, :icon, :accent, :image, :sort, 1)");
        ins.bind(":id", id)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", ""))
            .bind(":nameEn", payload.value("nameEn", ""))
            .bind(":icon", payload.value("icon", ""))
            .bind(":accent", payload.value("accent", ""))
            .bind(":image", payload.value("image", ""))
            .bind(":sort", payload.value("sortOrder", 0));
        ins.exec();
        (void)now;
    }

    ctx_.auditRequired("catalog.upsertCategory", "menu_category", id, payload);
    auto load = ctx_.db().prepare(
        "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, icon, accent, image, "
        "sort_order AS sortOrder, active FROM menu_categories WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

Json CatalogAdminService::upsertProduct(const Json& payload) {
    const auto nameAz = requireNonEmpty(payload, "nameAz");
    const auto categoryId = requireNonEmpty(payload, "categoryId");
    const auto now = nowMs();
    std::string id = payload.value("id", "");
    if (id.empty()) id = crypto::uuid4();

    auto existing = ctx_.db().prepare(
        "SELECT price_minor AS priceMinor, sold_out AS soldOut, available, active, sku, barcode, "
        "name_tr AS nameTr, name_en AS nameEn, description_az AS descriptionAz, "
        "description_tr AS descriptionTr, description_en AS descriptionEn, image, "
        "prep_minutes AS prepMinutes, station, course, allergens, calories, popular, "
        "sort_order AS sortOrder, kitchen_route AS kitchenRoute, tags_json AS tagsJson "
        "FROM menu_items WHERE id = :id");
    existing.bind(":id", id);
    const bool isUpdate = existing.step();
    const Json current = isUpdate ? existing.row() : Json::object();

    const auto textValue = [&](const char* input, const char* stored,
                               const std::string& fallback = "") {
        const Json& source = payload.contains(input) ? payload : current;
        const char* key = payload.contains(input) ? input : stored;
        if (!source.contains(key) || source[key].is_null() || !source[key].is_string()) {
            return fallback;
        }
        return source[key].get<std::string>();
    };
    const auto intValue = [&](const char* input, const char* stored, std::int64_t fallback = 0) {
        const Json& source = payload.contains(input) ? payload : current;
        const char* key = payload.contains(input) ? input : stored;
        if (!source.contains(key) || source[key].is_null() || !source[key].is_number_integer()) {
            return fallback;
        }
        return source[key].get<std::int64_t>();
    };

    const Money price = intValue("priceMinor", "priceMinor", 0);
    if (price < 0) {
        throw PosError(std::string(protocol::err::kValidation), "priceMinor must be >= 0");
    }
    const int activeValue = payload.contains("active")
                                ? (payload.value("active", false) ? 1 : 0)
                                : static_cast<int>(current.value("active", isUpdate ? 1 : 0));
    if (activeValue != 0 && price <= 0) {
        throw PosError(std::string(protocol::err::kValidation),
                       "A published product must have a price greater than zero");
    }

    std::string sku = textValue("sku", "sku", "");
    if (sku.empty()) sku = "SKU-" + crypto::shortCode(8);
    const auto barcode = textValue("barcode", "barcode", "");
    const auto nameTr = textValue("nameTr", "nameTr", nameAz);
    const auto nameEn = textValue("nameEn", "nameEn", nameAz);
    const auto descAz = textValue("descriptionAz", "descriptionAz", "");
    const auto descTr = textValue("descriptionTr", "descriptionTr", "");
    const auto descEn = textValue("descriptionEn", "descriptionEn", "");
    const auto image = textValue("image", "image", "");
    const auto prep = intValue("prepMinutes", "prepMinutes", 0);
    const auto station = textValue("station", "station", "kitchen");
    const auto course = textValue("course", "course", "main");
    const auto calories = intValue("calories", "calories", 0);
    const auto popular = intValue("popular", "popular", 0);
    const auto sort = intValue("sortOrder", "sortOrder", 0);
    const auto route = textValue("kitchenRoute", "kitchenRoute", "");
    const std::string allergens = payload.contains("allergens")
                                      ? payload["allergens"].dump()
                                      : textValue("allergens", "allergens", "[]");
    const std::string tags = payload.contains("tags")
                                ? payload["tags"].dump()
                                : textValue("tags", "tagsJson", "[]");
    const int soldOutValue = payload.contains("soldOut")
                                 ? (payload.value("soldOut", false) ? 1 : 0)
                                 : static_cast<int>(current.value("soldOut", 0));
    const int availableValue = payload.contains("available")
                                   ? (payload.value("available", true) ? 1 : 0)
                                   : static_cast<int>(current.value("available", 1));

    if (!sku.empty()) {
        auto dup = ctx_.db().prepare(
            "SELECT id FROM menu_items WHERE sku = :sku AND id != :id AND archived = 0");
        dup.bind(":sku", sku).bind(":id", id);
        if (dup.step()) {
            throw PosError(std::string(protocol::err::kConflict), "SKU already exists");
        }
    }
    if (!barcode.empty()) {
        auto dup = ctx_.db().prepare(
            "SELECT id FROM menu_items WHERE barcode = :barcode AND id != :id");
        dup.bind(":barcode", barcode).bind(":id", id);
        if (dup.step()) {
            throw PosError(std::string(protocol::err::kConflict), "Barcode already exists");
        }
    }

    const Money oldPrice = current.value("priceMinor", Money{0});

    if (isUpdate) {
        auto upd = ctx_.db().prepare(
            "UPDATE menu_items SET category_id = :cat, sku = :sku, barcode = :barcode, "
            "name_az = :nameAz, name_tr = :nameTr, name_en = :nameEn, "
            "description_az = :descAz, description_tr = :descTr, description_en = :descEn, "
            "price_minor = :price, image = :image, prep_minutes = :prep, station = :station, "
            "course = :course, allergens = :allergens, calories = :calories, popular = :popular, "
            "available = :available, sold_out = :soldOut, sort_order = :sort, active = :active, "
            "archived = 0, kitchen_route = :route, tags_json = :tags, updated_at = :now "
            "WHERE id = :id");
        upd.bind(":cat", categoryId)
            .bind(":sku", sku)
            .bind(":barcode", barcode)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", nameTr)
            .bind(":nameEn", nameEn)
            .bind(":descAz", descAz)
            .bind(":descTr", descTr)
            .bind(":descEn", descEn)
            .bind(":price", price)
            .bind(":image", image)
            .bind(":prep", prep)
            .bind(":station", station)
            .bind(":course", course)
            .bind(":allergens", allergens)
            .bind(":calories", calories)
            .bind(":popular", popular)
            .bind(":available", availableValue)
            .bind(":soldOut", soldOutValue)
            .bind(":sort", sort)
            .bind(":active", activeValue)
            .bind(":route", route)
            .bind(":tags", tags)
            .bind(":now", now)
            .bind(":id", id);
        upd.exec();

        if (oldPrice != price) {
            auto hist = ctx_.db().prepare(
                "INSERT INTO menu_item_price_history "
                "(id, item_id, old_price_minor, new_price_minor, changed_by, reason, created_at) "
                "VALUES (:id, :item, :old, :new, :by, :reason, :now)");
            hist.bind(":id", crypto::uuid4())
                .bind(":item", id)
                .bind(":old", oldPrice)
                .bind(":new", price)
                .bindOptional(":by", ctx_.session().userId)
                .bind(":reason", payload.value("priceReason", "admin update"))
                .bind(":now", now);
            hist.exec();
        }
    } else {
        auto ins = ctx_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, barcode, name_az, name_tr, name_en, "
            "description_az, description_tr, description_en, price_minor, image, prep_minutes, "
            "station, course, allergens, calories, popular, available, sold_out, sort_order, "
            "active, kitchen_route, tags_json, created_at, updated_at) VALUES ("
            ":id, :cat, :sku, :barcode, :nameAz, :nameTr, :nameEn, :descAz, :descTr, :descEn, "
            ":price, :image, :prep, :station, :course, :allergens, :calories, :popular, "
            ":available, :soldOut, :sort, :active, :route, :tags, :now, :now)");
        ins.bind(":id", id)
            .bind(":cat", categoryId)
            .bind(":sku", sku)
            .bind(":barcode", barcode)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", nameTr)
            .bind(":nameEn", nameEn)
            .bind(":descAz", descAz)
            .bind(":descTr", descTr)
            .bind(":descEn", descEn)
            .bind(":price", price)
            .bind(":image", image)
            .bind(":prep", prep)
            .bind(":station", station)
            .bind(":course", course)
            .bind(":allergens", allergens)
            .bind(":calories", calories)
            .bind(":popular", popular)
            .bind(":available", availableValue)
            .bind(":soldOut", soldOutValue)
            .bind(":sort", sort)
            .bind(":active", activeValue)
            .bind(":route", route)
            .bind(":tags", tags)
            .bind(":now", now);
        ins.exec();
    }

    ctx_.auditRequired("catalog.upsertProduct", "menu_item", id,
                       Json{{"priceMinor", price}, {"sku", sku}});
    auto load = ctx_.db().prepare(
        "SELECT id, category_id AS categoryId, sku, barcode, name_az AS nameAz, "
        "name_tr AS nameTr, name_en AS nameEn, description_az AS descriptionAz, "
        "description_tr AS descriptionTr, description_en AS descriptionEn, "
        "price_minor AS priceMinor, image, prep_minutes AS prepMinutes, station, course, "
        "sold_out AS soldOut, image_hidden AS imageHidden, available, active, archived, "
        "sort_order AS sortOrder "
        "FROM menu_items WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

Json CatalogAdminService::archiveCategory(const std::string& categoryId) {
    auto open = ctx_.db().prepare(
        "SELECT COUNT(*) FROM menu_items WHERE category_id = :id AND active = 1");
    open.bind(":id", categoryId);
    if (open.step() && open.columnInt(0) > 0) {
        throw PosError(std::string(protocol::err::kConflict),
                       "Category still has active products; archive them first");
    }
    auto stmt = ctx_.db().prepare("UPDATE menu_categories SET active = 0 WHERE id = :id");
    stmt.bind(":id", categoryId);
    stmt.exec();
    if (ctx_.db().changes() == 0) throw PosError::of(protocol::err::kNotFound);
    ctx_.auditRequired("catalog.archiveCategory", "menu_category", categoryId, Json::object());
    return Json{{"categoryId", categoryId}, {"archived", true}};
}

Json CatalogAdminService::archiveProduct(const std::string& productId) {
    auto stmt = ctx_.db().prepare(
        "UPDATE menu_items SET archived = 1, active = 0, available = 0, sold_out = 1, "
        "updated_at = :now WHERE id = :id");
    stmt.bind(":now", nowMs()).bind(":id", productId);
    stmt.exec();
    if (ctx_.db().changes() == 0) throw PosError::of(protocol::err::kNotFound);
    ctx_.auditRequired("catalog.archiveProduct", "menu_item", productId, Json::object());
    return Json{{"productId", productId}, {"archived", true}};
}

Json CatalogAdminService::upsertModifierGroup(const Json& payload) {
    const auto nameAz = requireNonEmpty(payload, "nameAz");
    std::string id = payload.value("id", "");
    if (id.empty()) id = crypto::uuid4();

    auto existing = ctx_.db().prepare("SELECT id FROM modifier_groups WHERE id = :id");
    existing.bind(":id", id);
    if (existing.step()) {
        auto upd = ctx_.db().prepare(
            "UPDATE modifier_groups SET name_az = :nameAz, name_tr = :nameTr, name_en = :nameEn, "
            "min_select = :minSel, max_select = :maxSel, required = :req, multi_select = :multi, "
            "sort_order = :sort WHERE id = :id");
        upd.bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", nameAz))
            .bind(":nameEn", payload.value("nameEn", nameAz))
            .bind(":minSel", payload.value("minSelect", 0))
            .bind(":maxSel", payload.value("maxSelect", 1))
            .bind(":req", payload.value("required", 0) ? 1 : 0)
            .bind(":multi", payload.value("multiSelect", 0) ? 1 : 0)
            .bind(":sort", payload.value("sortOrder", 0))
            .bind(":id", id);
        upd.exec();
    } else {
        auto ins = ctx_.db().prepare(
            "INSERT INTO modifier_groups "
            "(id, name_az, name_tr, name_en, min_select, max_select, required, multi_select, "
            "sort_order) VALUES (:id, :nameAz, :nameTr, :nameEn, :minSel, :maxSel, :req, :multi, "
            ":sort)");
        ins.bind(":id", id)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", nameAz))
            .bind(":nameEn", payload.value("nameEn", nameAz))
            .bind(":minSel", payload.value("minSelect", 0))
            .bind(":maxSel", payload.value("maxSelect", 1))
            .bind(":req", payload.value("required", 0) ? 1 : 0)
            .bind(":multi", payload.value("multiSelect", 0) ? 1 : 0)
            .bind(":sort", payload.value("sortOrder", 0));
        ins.exec();
    }
    ctx_.auditRequired("catalog.upsertModifierGroup", "modifier_group", id, payload);
    auto load = ctx_.db().prepare(
        "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, "
        "min_select AS minSelect, max_select AS maxSelect, required, "
        "multi_select AS multiSelect, sort_order AS sortOrder FROM modifier_groups WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

Json CatalogAdminService::upsertModifier(const Json& payload) {
    const auto nameAz = requireNonEmpty(payload, "nameAz");
    const auto groupId = requireNonEmpty(payload, "groupId");
    std::string id = payload.value("id", "");
    if (id.empty()) id = crypto::uuid4();
    const Money delta = payload.value("priceDeltaMinor", 0);

    auto existing = ctx_.db().prepare("SELECT id FROM modifiers WHERE id = :id");
    existing.bind(":id", id);
    if (existing.step()) {
        auto upd = ctx_.db().prepare(
            "UPDATE modifiers SET group_id = :groupId, name_az = :nameAz, name_tr = :nameTr, "
            "name_en = :nameEn, price_delta_minor = :delta, is_default = :def, available = 1, "
            "sort_order = :sort WHERE id = :id");
        upd.bind(":groupId", groupId)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", nameAz))
            .bind(":nameEn", payload.value("nameEn", nameAz))
            .bind(":delta", delta)
            .bind(":def", payload.value("isDefault", 0) ? 1 : 0)
            .bind(":sort", payload.value("sortOrder", 0))
            .bind(":id", id);
        upd.exec();
    } else {
        auto ins = ctx_.db().prepare(
            "INSERT INTO modifiers "
            "(id, group_id, name_az, name_tr, name_en, price_delta_minor, is_default, available, "
            "sort_order) VALUES (:id, :groupId, :nameAz, :nameTr, :nameEn, :delta, :def, 1, :sort)");
        ins.bind(":id", id)
            .bind(":groupId", groupId)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", nameAz))
            .bind(":nameEn", payload.value("nameEn", nameAz))
            .bind(":delta", delta)
            .bind(":def", payload.value("isDefault", 0) ? 1 : 0)
            .bind(":sort", payload.value("sortOrder", 0));
        ins.exec();
    }
    ctx_.auditRequired("catalog.upsertModifier", "modifier", id, payload);
    auto load = ctx_.db().prepare(
        "SELECT id, group_id AS groupId, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, "
        "price_delta_minor AS priceDeltaMinor, is_default AS isDefault, available, "
        "sort_order AS sortOrder FROM modifiers WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

Json CatalogAdminService::archiveModifier(const std::string& modifierId) {
    auto stmt = ctx_.db().prepare("UPDATE modifiers SET available = 0 WHERE id = :id");
    stmt.bind(":id", modifierId);
    stmt.exec();
    if (ctx_.db().changes() == 0) throw PosError::of(protocol::err::kNotFound);
    ctx_.auditRequired("catalog.archiveModifier", "modifier", modifierId, Json::object());
    return Json{{"modifierId", modifierId}, {"archived", true}};
}

Json CatalogAdminService::setProductModifierGroups(const std::string& productId,
                                                   const Json& groupIds) {
    if (!groupIds.is_array()) {
        throw PosError(std::string(protocol::err::kValidation), "groupIds must be an array");
    }
    auto exists = ctx_.db().prepare("SELECT id FROM menu_items WHERE id = :id AND archived = 0");
    exists.bind(":id", productId);
    if (!exists.step()) throw PosError::of(protocol::err::kNotFound);

    auto clear = ctx_.db().prepare("DELETE FROM menu_item_modifier_groups WHERE item_id = :id");
    clear.bind(":id", productId);
    clear.exec();

    int sort = 0;
    for (const auto& entry : groupIds) {
        const std::string groupId = entry.is_string() ? entry.get<std::string>() : entry.value("id", "");
        if (groupId.empty()) continue;
        auto link = ctx_.db().prepare(
            "INSERT INTO menu_item_modifier_groups (item_id, group_id, sort_order) "
            "VALUES (:item, :group, :sort)");
        link.bind(":item", productId).bind(":group", groupId).bind(":sort", sort++);
        link.exec();
    }
    ctx_.auditRequired("catalog.setProductModifierGroups", "menu_item", productId,
                       Json{{"groupIds", groupIds}});
    return Json{{"productId", productId}, {"groupCount", sort}};
}

Json CatalogAdminService::setSoldOut(const std::string& productId, bool soldOut) {
    auto stmt = ctx_.db().prepare(
        "UPDATE menu_items SET sold_out = :sold, updated_at = :now WHERE id = :id");
    stmt.bind(":sold", soldOut ? 1 : 0).bind(":now", nowMs()).bind(":id", productId);
    stmt.exec();
    if (ctx_.db().changes() == 0) throw PosError::of(protocol::err::kNotFound);
    ctx_.audit("catalog.setSoldOut", "menu_item", productId, Json{{"soldOut", soldOut}});
    return Json{{"productId", productId}, {"soldOut", soldOut}};
}

Json CatalogAdminService::setImageHidden(const std::string& productId, bool hidden) {
    auto stmt = ctx_.db().prepare(
        "UPDATE menu_items SET image_hidden = :hidden, updated_at = :now WHERE id = :id");
    stmt.bind(":hidden", hidden ? 1 : 0).bind(":now", nowMs()).bind(":id", productId);
    stmt.exec();
    if (ctx_.db().changes() == 0) throw PosError::of(protocol::err::kNotFound);
    ctx_.audit("catalog.setImageHidden", "menu_item", productId, Json{{"imageHidden", hidden}});
    return Json{{"productId", productId}, {"imageHidden", hidden}};
}

/**
 * Turns every dish's photo off (or back on) in one statement.
 *
 * Scoped to active items so archived rows are not resurrected into the audit
 * trail, and reported with a count because "did that do anything?" is the first
 * question after pressing a button that changes 118 products at once.
 */
Json CatalogAdminService::setAllImagesHidden(bool hidden) {
    auto stmt = ctx_.db().prepare(
        "UPDATE menu_items SET image_hidden = :hidden, updated_at = :now "
        "WHERE active = 1 AND image_hidden != :hidden");
    stmt.bind(":hidden", hidden ? 1 : 0).bind(":now", nowMs());
    stmt.exec();
    const int changed = ctx_.db().changes();
    ctx_.audit("catalog.setAllImagesHidden", "menu_item", "",
               Json{{"imageHidden", hidden}, {"changed", changed}});
    return Json{{"imageHidden", hidden}, {"changed", changed}};
}

Json CatalogAdminService::priceHistory(const std::string& productId) {
    auto stmt = ctx_.db().prepare(
        "SELECT id, item_id AS itemId, old_price_minor AS oldPriceMinor, "
        "new_price_minor AS newPriceMinor, changed_by AS changedBy, reason, created_at AS createdAt "
        "FROM menu_item_price_history WHERE item_id = :id ORDER BY created_at DESC");
    stmt.bind(":id", productId);
    return Json{{"history", stmt.rows()}};
}

Json CatalogAdminService::importPreview(std::string_view csvText, std::string_view filename) {
    std::istringstream in{std::string(csvText)};
    std::string line;
    Json rows = Json::array();
    int lineNo = 0;
    bool headerSkipped = false;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        ++lineNo;
        auto cells = splitCsvLine(line);
        if (!headerSkipped) {
            headerSkipped = true;
            continue;
        }
        if (cells.size() < 3) {
            rows.push_back(Json{{"line", lineNo}, {"ok", false}, {"error", "Need sku,nameAz,priceMinor"}});
            continue;
        }
        Money price = 0;
        try {
            price = static_cast<Money>(std::stoll(cells[2]));
        } catch (...) {
            rows.push_back(Json{{"line", lineNo}, {"ok", false}, {"error", "Invalid price"}});
            continue;
        }
        rows.push_back(Json{{"line", lineNo},
                            {"ok", true},
                            {"sku", cells[0]},
                            {"nameAz", cells[1]},
                            {"priceMinor", price},
                            {"categoryId", cells.size() > 3 ? cells[3] : ""}});
    }

    const std::string batchId = crypto::uuid4();
    const auto now = nowMs();
    auto ins = ctx_.db().prepare(
        "INSERT INTO catalog_import_batches "
        "(id, filename, status, preview_json, created_by, created_at) "
        "VALUES (:id, :file, 'preview', :preview, :by, :now)");
    ins.bind(":id", batchId)
        .bind(":file", std::string(filename))
        .bind(":preview", Json{{"rows", rows}}.dump())
        .bindOptional(":by", ctx_.session().userId)
        .bind(":now", now);
    ins.exec();

    return Json{{"batchId", batchId}, {"rows", rows}};
}

Json CatalogAdminService::importCommit(const std::string& batchId) {
    auto batch = ctx_.db().prepare(
        "SELECT preview_json, status FROM catalog_import_batches WHERE id = :id");
    batch.bind(":id", batchId);
    if (!batch.step()) throw PosError::of(protocol::err::kNotFound);
    if (batch.columnText(1) != "preview") {
        throw PosError(std::string(protocol::err::kConflict), "Batch is not in preview state");
    }

    Json preview = Json::parse(batch.columnText(0));
    int applied = 0;
    for (const auto& row : preview.value("rows", Json::array())) {
        if (!row.value("ok", false)) continue;
        const auto sku = row.value("sku", "");
        auto find = ctx_.db().prepare("SELECT id, category_id FROM menu_items WHERE sku = :sku");
        find.bind(":sku", sku);
        Json payload = Json{{"nameAz", row.value("nameAz", "")},
                            {"priceMinor", row.value("priceMinor", 0)},
                            {"sku", sku}};
        if (find.step()) {
            payload["id"] = find.columnText(0);
            payload["categoryId"] = find.columnText(1);
        } else {
            auto cat = row.value("categoryId", "");
            if (cat.empty()) {
                auto first = ctx_.db().prepare(
                    "SELECT id FROM menu_categories WHERE active = 1 ORDER BY sort_order LIMIT 1");
                if (!first.step()) continue;
                cat = first.columnText(0);
            }
            payload["categoryId"] = cat;
        }
        upsertProduct(payload);
        ++applied;
    }

    auto upd = ctx_.db().prepare(
        "UPDATE catalog_import_batches SET status = 'committed', result_json = :res, "
        "committed_at = :now WHERE id = :id");
    upd.bind(":res", Json{{"applied", applied}}.dump())
        .bind(":now", nowMs())
        .bind(":id", batchId);
    upd.exec();
    ctx_.auditRequired("catalog.importCommit", "catalog_import", batchId,
                       Json{{"applied", applied}});
    return Json{{"batchId", batchId}, {"applied", applied}};
}

Json CatalogAdminService::exportCatalog() {
    auto cats = ctx_.db().prepare(
        "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, sort_order AS sortOrder "
        "FROM menu_categories WHERE active = 1 ORDER BY sort_order");
    auto items = ctx_.db().prepare(
        "SELECT id, category_id AS categoryId, sku, barcode, name_az AS nameAz, "
        "price_minor AS priceMinor, sold_out AS soldOut, available "
        "FROM menu_items WHERE active = 1 AND archived = 0 ORDER BY sort_order, name_az");
    return Json{{"categories", cats.rows()}, {"products", items.rows()}};
}

}  // namespace pos::services
