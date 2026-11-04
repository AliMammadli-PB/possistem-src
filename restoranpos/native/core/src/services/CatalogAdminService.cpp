#include "pos/services/CatalogAdminService.hpp"

#include <sstream>
#include <cmath>
#include <set>
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

// A newly created sale product owns a stock card immediately. This runs in
// the caller's catalog transaction, before success is acknowledged. Recipes
// already using real ingredients remain authoritative and are never replaced.
void ensureCatalogStock(handlers::Context& ctx,const std::string& menuId,const std::string& name,
                        const std::string& barcode,Money price,Timestamp now,const std::string& stockIngredientId) {
    std::string ingredient;bool active=true;
    {auto link=ctx.db().prepare("SELECT i.id,i.active FROM catalog_goods_links l JOIN ingredients i ON i.id=l.ingredient_id WHERE l.menu_id=:id");link.bind(":id",menuId);if(link.step()){ingredient=link.columnText(0);active=link.columnInt(1)!=0;}}
    auto recipes=ctx.db().prepare("SELECT (SELECT COUNT(*) FROM menu_item_ingredients WHERE menu_item_id=:id)+(SELECT COUNT(*) FROM menu_item_components WHERE menu_item_id=:id)");recipes.bind(":id",menuId);recipes.step();const bool hasRecipe=recipes.columnInt(0)>0;
    if(ingredient.empty()){
        auto owned=ctx.db().prepare("SELECT id,active FROM ingredients WHERE sku=:sku");owned.bind(":sku","MENU-"+menuId);if(owned.step()){ingredient=owned.columnText(0);active=owned.columnInt(1)!=0;}
    }
    if(!stockIngredientId.empty()){
        require(ingredient.empty()||ingredient==stockIngredientId,"Məhsul başqa anbar kartına bağlıdır");
        auto stock=ctx.db().prepare("SELECT id,active FROM ingredients WHERE id=:id");stock.bind(":id",stockIngredientId);require(stock.step(),"Anbar kartı tapılmadı");
        ingredient=stock.columnText(0);active=stock.columnInt(1)!=0;
    }
    if(hasRecipe&&ingredient.empty())return;
    if(ingredient.empty()&&!barcode.empty()){
        auto existing=ctx.db().prepare("SELECT i.id,i.unit FROM ingredients i WHERE i.barcode=:barcode AND i.active=1");existing.bind(":barcode",barcode);
        if(existing.step()){
            ingredient=existing.columnText(0);
            require(existing.columnText(1)=="ədəd","Bu barkod fərqli ölçü vahidi ilə anbarda var");
            auto linked=ctx.db().prepare("SELECT menu_id FROM catalog_goods_links WHERE ingredient_id=:id AND menu_id!=:menu");linked.bind(":id",ingredient).bind(":menu",menuId);
            require(!linked.step(),"Bu barkod başqa kataloq məhsuluna bağlıdır");
        }
    }
    if(ingredient.empty()){
        ingredient="ing-menu-"+menuId;
        auto insert=ctx.db().prepare("INSERT INTO ingredients(id,sku,name,unit,cost_minor,avg_cost_minor,min_qty_milli,barcode,sale_price_minor,created_at,updated_at) VALUES(:id,:sku,:name,'ədəd',0,0,0,:barcode,:price,:now,:now)");
        insert.bind(":id",ingredient).bind(":sku","MENU-"+menuId).bind(":name",name).bind(":barcode",barcode).bind(":price",price).bind(":now",now).exec();
    }
    auto link=ctx.db().prepare("INSERT INTO catalog_goods_links(menu_id,ingredient_id) VALUES(:menu,:ingredient) ON CONFLICT(menu_id) DO NOTHING");link.bind(":menu",menuId).bind(":ingredient",ingredient).exec();
    auto metadata=ctx.db().prepare("UPDATE ingredients SET name=:name,sale_price_minor=:price,barcode=:barcode,updated_at=:now WHERE id=:id");metadata.bind(":name",name).bind(":price",price).bind(":barcode",barcode).bind(":now",now).bind(":id",ingredient).exec();
    if(active&&!hasRecipe){auto recipe=ctx.db().prepare("INSERT INTO menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) VALUES(:menu,:ingredient,1000)");recipe.bind(":menu",menuId).bind(":ingredient",ingredient).exec();}
}

// A set menu's parts. The parts' own recipes are what stock gives up when the menu is sold.
void saveComponents(handlers::Context& ctx,const std::string& menuId,const Json& components) {
    require(components.is_array()&&!components.empty()&&components.size()<=40,"Menyuya ən azı bir məhsul əlavə edin");
    auto drop=ctx.db().prepare("DELETE FROM menu_item_components WHERE menu_item_id=:id");drop.bind(":id",menuId);drop.exec();
    for(const auto& part:components){
        require(part.is_object()&&part.contains("menuItemId")&&part["menuItemId"].is_string()&&part.contains("qtyMilli")&&part["qtyMilli"].is_number_integer(),"Menyu məhsulunu düzgün seçin");
        const auto partId=part["menuItemId"].get<std::string>();const auto qty=part["qtyMilli"].get<std::int64_t>();
        require(partId!=menuId,"Menyu öz içində ola bilməz");
        require(qty>0&&qty<=100000,"Menyu məhsulunun sayı düzgün deyil");
        auto exists=ctx.db().prepare("SELECT 1 FROM menu_items WHERE id=:id AND active=1 AND archived=0");exists.bind(":id",partId);require(exists.step(),"Menyu məhsulu tapılmadı");
        auto loop=ctx.db().prepare(
            "WITH RECURSIVE down(item,depth) AS (SELECT :part,0 UNION "
            "SELECT c.component_menu_item_id,d.depth+1 FROM down d JOIN menu_item_components c ON c.menu_item_id=d.item WHERE d.depth<16) "
            "SELECT 1 FROM down WHERE item=:menu LIMIT 1");
        loop.bind(":part",partId).bind(":menu",menuId);require(!loop.step(),"Bu məhsul artıq həmin menyunun içindədir");
        auto insert=ctx.db().prepare(
            "INSERT INTO menu_item_components(menu_item_id,component_menu_item_id,qty_milli) VALUES(:menu,:part,:qty) "
            "ON CONFLICT(menu_item_id,component_menu_item_id) DO UPDATE SET qty_milli=excluded.qty_milli");
        insert.bind(":menu",menuId).bind(":part",partId).bind(":qty",qty);insert.exec();
    }
}

// Sizes live in the name ("Pizza · 28 sm"). The other sizes of a moved dish follow it, so one
// pizza never sits in two categories.
void moveSizeSiblings(handlers::Context& ctx,const std::string& id,const std::string& name,const std::string& fromCategory,const std::string& toCategory,Timestamp now) {
    const std::string separator=" · ";
    const auto at=name.rfind(separator);if(at==std::string::npos||at==0)return;
    const auto rest=name.substr(at+separator.size());if(rest.empty()||rest[0]<'0'||rest[0]>'9')return;
    const auto prefix=name.substr(0,at+separator.size());
    auto rows=ctx.db().prepare("SELECT id,name_az FROM menu_items WHERE category_id=:cat AND id!=:id AND archived=0");rows.bind(":cat",fromCategory).bind(":id",id);
    std::vector<std::string> siblings;
    while(rows.step()){const auto other=rows.columnText(1);if(other.size()>prefix.size()&&other.compare(0,prefix.size(),prefix)==0&&other[prefix.size()]>='0'&&other[prefix.size()]<='9')siblings.push_back(rows.columnText(0));}
    for(const auto& sibling:siblings){auto move=ctx.db().prepare("UPDATE menu_items SET category_id=:cat,updated_at=:now WHERE id=:id");move.bind(":cat",toCategory).bind(":now",now).bind(":id",sibling);move.exec();}
}

}  // namespace

Json CatalogAdminService::upsertCategory(const Json& payload) {
    const auto nameAz = requireNonEmpty(payload, "nameAz");
    const auto now = nowMs();
    std::string id = payload.value("id", "");
    if (id.empty()) id = crypto::uuid4();

    auto existing = ctx_.db().prepare("SELECT id FROM menu_categories WHERE id = :id");
    existing.bind(":id", id);
    const bool exists = existing.step();
    // One level of sub-categories. parentId missing keeps it, null / "" makes it top level.
    const bool hasParent = payload.contains("parentId");
    const auto parentId = hasParent && payload["parentId"].is_string() ? payload["parentId"].get<std::string>() : std::string();
    if (!parentId.empty()) {
        require(parentId != id, "Kateqoriya öz içinə qoyula bilməz");
        auto parent = ctx_.db().prepare("SELECT COALESCE(parent_id, '') FROM menu_categories WHERE id = :id AND active = 1");
        parent.bind(":id", parentId);
        require(parent.step(), "Ana kateqoriya tapılmadı");
        require(parent.columnText(0).empty(), "Alt kateqoriyanın içinə kateqoriya qoyula bilməz");
        auto children = ctx_.db().prepare("SELECT 1 FROM menu_categories WHERE parent_id = :id AND active = 1");
        children.bind(":id", id);
        require(!children.step(), "Alt kateqoriyası olan kateqoriya başqasının içinə qoyula bilməz");
    }
    if (exists) {
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
        if (hasParent) {
            auto parent = ctx_.db().prepare("UPDATE menu_categories SET parent_id = NULLIF(:parent, '') WHERE id = :id");
            parent.bind(":parent", parentId).bind(":id", id).exec();
        }
    } else {
        auto ins = ctx_.db().prepare(
            "INSERT INTO menu_categories (id, name_az, name_tr, name_en, icon, accent, image, "
            "sort_order, active, parent_id) "
            "VALUES (:id, :nameAz, :nameTr, :nameEn, :icon, :accent, :image, :sort, 1, NULLIF(:parent, ''))");
        ins.bind(":id", id)
            .bind(":nameAz", nameAz)
            .bind(":nameTr", payload.value("nameTr", ""))
            .bind(":nameEn", payload.value("nameEn", ""))
            .bind(":icon", payload.value("icon", ""))
            .bind(":accent", payload.value("accent", ""))
            .bind(":image", payload.value("image", ""))
            .bind(":sort", payload.value("sortOrder", 0))
            .bind(":parent", parentId);
        ins.exec();
        (void)now;
    }

    ctx_.auditRequired("catalog.upsertCategory", "menu_category", id, payload);
    auto load = ctx_.db().prepare(
        "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, icon, accent, image, "
        "sort_order AS sortOrder, active, parent_id AS parentId FROM menu_categories WHERE id = :id");
    load.bind(":id", id);
    load.step();
    return load.row();
}

// Each size is an ordinary product identity: its price, recipe, sales and stock
// stay independent everywhere, including QR ordering and the owner portal.
Json CatalogAdminService::upsertSizedProducts(const Json& payload) {
    require(payload.value("id",std::string()).empty(),"Mövcud variantı ayrıca redaktə edin");
    const auto& variants=payload.at("sizeVariants");
    require(variants.is_array()&&!variants.empty()&&variants.size()<=24,"1–24 ölçü variantı daxil edin");
    // 300 is for centimetres; grams and millilitres are ordinary portions in the thousands.
    const auto unit=payload.value("sizeUnit",std::string("sm"));
    require(unit=="sm"||unit=="qr"||unit=="kq"||unit=="ml"||unit=="l","Ölçü vahidi düzgün deyil");
    const double maxSize=unit=="sm"?300:100000;
    const bool existing = variants.front().is_object() && variants.front().contains("productId");
    require(!existing || variants.size() >= 2, "Birləşdirmək üçün ən azı iki məhsul seçin");
    std::set<std::string> productIds;
    std::set<long long> seen;
    Json normalized=Json::array();
    for(const auto& row:variants){
        require(row.is_object() && row.contains("sizeCm") && row["sizeCm"].is_number() &&
                row.contains("productId") == existing, "Ölçünü düzgün yazın");
        require(existing ? row["productId"].is_string() : row.contains("priceMinor") && row["priceMinor"].is_number_integer(),
                "Ölçünü və məhsulu düzgün seçin");
        const double cm=row["sizeCm"].get<double>();
        require(std::isfinite(cm)&&cm>0&&cm<=maxSize,"Ölçü 0-dan böyük, ən çox "+std::to_string(static_cast<int>(maxSize))+" "+unit+" olmalıdır");
        const auto hundredths=std::llround(cm*100);
        require(std::abs(cm*100-hundredths)<0.000001&&seen.insert(hundredths).second,"Ölçülər təkrarlanmamalı, ən çox iki onluq rəqəm olmalıdır");
        const auto price=existing ? Money{0} : row["priceMinor"].get<Money>();
        require(existing || (price>=0&&price<=100000000&&(!payload.value("active",false)||price>0)),"Variantın qiyməti düzgün deyil");
        std::string label=std::to_string(hundredths/100);
        if(hundredths%100){label+="."+std::to_string(100+hundredths%100).substr(1);while(label.back()=='0')label.pop_back();}
        const auto productId = existing ? row["productId"].get<std::string>() : std::string{};
        require(!existing || (!productId.empty() && productIds.insert(productId).second),
                "Eyni məhsulu iki dəfə seçmək olmaz");
        normalized.push_back(Json{{"label",label},{"sizeCm",cm},{"priceMinor",price},{"productId",productId}});
    }
    if (existing) {
        const auto base = requireNonEmpty(payload, "nameAz");
        const auto category = requireNonEmpty(payload, "categoryId");
        require(base.size() <= 160, "Qrupun adı çox uzundur");
        auto items = Json::array();
        for (const auto& row : normalized) {
            const auto id = row.at("productId").get<std::string>();
            auto current = ctx_.db().prepare(
                "SELECT price_minor FROM menu_items WHERE id=:id AND archived=0 AND category_id=:category");
            current.bind(":id", id).bind(":category", category);
            require(current.step(), "Məhsullar eyni kateqoriyada olmalıdır");
            const auto suffix = " · " + row.at("label").get<std::string>() + " ";
            const auto name = base + suffix + unit;
            auto conflict = ctx_.db().prepare(
                "SELECT id FROM menu_items WHERE category_id=:category AND archived=0 AND lower(name_az)=lower(:name)");
            conflict.bind(":category", category).bind(":name", name);
            while (conflict.step()) {
                require(productIds.contains(conflict.columnText(0)), "Bu qrupda həmin ölçü artıq mövcuddur");
            }
            items.push_back(Json{{"id", id}, {"nameAz", name}, {"nameOther", base + suffix + (unit == "sm" ? "cm" : unit)},
                                 {"priceMinor", current.columnInt(0)}, {"sizeCm", row.at("sizeCm")}});
        }
        for (const auto& item : items) {
            const auto id = item.at("id").get<std::string>();
            const auto name = item.at("nameAz").get<std::string>();
            auto rename = ctx_.db().prepare(
                "UPDATE menu_items SET name_az=:name,name_tr=:other,name_en=:other,updated_at=:now WHERE id=:id");
            rename.bind(":name", name).bind(":other", item.at("nameOther").get<std::string>())
                .bind(":now", nowMs()).bind(":id", id).exec();
            auto stock = ctx_.db().prepare(
                "UPDATE ingredients SET name=:name,updated_at=:now WHERE id="
                "(SELECT ingredient_id FROM catalog_goods_links WHERE menu_id=:id)");
            stock.bind(":name", name).bind(":now", nowMs()).bind(":id", id).exec();
        }
        ctx_.auditRequired("catalog.groupSizes", "menu_category", category, payload);
        return Json{{"id", items.front().at("id")}, {"variants", items}};
    }
    Json result,rows=Json::array();int index=0;
    for(const auto& row:normalized){
        auto item=payload;item.erase("sizeVariants");item.erase("sizeUnit");item.erase("sku");item.erase("barcode");
        for(const auto key:{"nameAz","nameTr","nameEn"}){const auto name=payload.value(key,payload.value("nameAz",std::string()));item[key]=name+" · "+row["label"].get<std::string>()+" "+(unit=="sm"&&std::string(key)!="nameAz"?std::string("cm"):unit);}
        item["priceMinor"]=row["priceMinor"];item["sortOrder"]=payload.value("sortOrder",0)+index++;
        const auto saved=upsertProduct(item);if(result.is_null())result=saved;
        rows.push_back(Json{{"id",saved.at("id")},{"nameAz",item.at("nameAz")},{"priceMinor",row["priceMinor"]},{"sizeCm",row["sizeCm"]}});
    }
    result["variants"]=rows;return result;
}

Json CatalogAdminService::upsertProduct(const Json& payload, const std::string& stockIngredientId) {
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
        "sort_order AS sortOrder, kitchen_route AS kitchenRoute, tags_json AS tagsJson, "
        "category_id AS categoryId, name_az AS previousName "
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
        if (current.value("categoryId", categoryId) != categoryId) {
            moveSizeSiblings(ctx_, id, current.value("previousName", nameAz), current.value("categoryId", categoryId), categoryId, now);
        }

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

    if(payload.contains("components"))saveComponents(ctx_,id,payload["components"]);
    ensureCatalogStock(ctx_,id,nameAz,barcode,price,now,stockIngredientId);
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
    auto children = ctx_.db().prepare("SELECT 1 FROM menu_categories WHERE parent_id = :id AND active = 1");
    children.bind(":id", categoryId);
    if (children.step())
        throw PosError(std::string(protocol::err::kConflict), "Əvvəl alt kateqoriyaları silin və ya başqa yerə köçürün");
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
