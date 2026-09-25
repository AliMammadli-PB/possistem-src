#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/CatalogAdminService.hpp"
#include "pos/services/Idempotency.hpp"

namespace pos::handlers {
namespace {

/** Localised menu rows carry az/tr/en columns; the UI picks its language. */
constexpr const char* kItemColumns =
    "i.id, i.category_id AS categoryId, i.sku, "
    "i.name_az AS nameAz, i.name_tr AS nameTr, i.name_en AS nameEn, "
    "i.description_az AS descriptionAz, i.description_tr AS descriptionTr, "
    "i.description_en AS descriptionEn, "
    "i.price_minor AS priceMinor, i.image, i.prep_minutes AS prepMinutes, "
    "i.station, i.course, i.allergens, i.calories, i.popular, i.available, "
    "i.sold_out AS soldOut, i.image_hidden AS imageHidden, "
    "i.sort_order AS sortOrder, i.active, i.archived";

/** allergens is stored as a JSON array string; hand it back as a real array. */
void expandAllergens(Json& row) {
    if (!row.contains("allergens") || !row["allergens"].is_string()) return;
    try {
        row["allergens"] = Json::parse(row["allergens"].get<std::string>());
    } catch (...) {
        row["allergens"] = Json::array();
    }
}

Json attachModifiers(Context& ctx, Json groups, bool availableOnly) {
    for (auto& group : groups) {
        std::string sql =
            "SELECT id, group_id AS groupId, name_az AS nameAz, name_tr AS nameTr, "
            "       name_en AS nameEn, price_delta_minor AS priceDeltaMinor, "
            "       is_default AS isDefault, available "
            "FROM modifiers WHERE group_id = :groupId";
        if (availableOnly) sql += " AND available = 1";
        sql += " ORDER BY sort_order";
        auto options = ctx.db().prepare(sql);
        options.bind(":groupId", group["id"].get<std::string>());
        group["modifiers"] = options.rows();
    }
    return groups;
}

Json loadModifierGroups(Context& ctx, const std::string& productId) {
    auto stmt = ctx.db().prepare(
        "SELECT g.id, g.name_az AS nameAz, g.name_tr AS nameTr, g.name_en AS nameEn, "
        "       g.min_select AS minSelect, g.max_select AS maxSelect, "
        "       g.required, g.multi_select AS multiSelect, l.sort_order AS sortOrder "
        "FROM modifier_groups g "
        "JOIN menu_item_modifier_groups l ON l.group_id = g.id "
        "WHERE l.item_id = :productId "
        "ORDER BY l.sort_order");
    stmt.bind(":productId", productId);
    return attachModifiers(ctx, stmt.rows(), true);
}

/** Admin list: every modifier group with nested options (incl. unavailable). */
Json loadAllModifierGroups(Context& ctx) {
    auto stmt = ctx.db().prepare(
        "SELECT g.id, g.name_az AS nameAz, g.name_tr AS nameTr, g.name_en AS nameEn, "
        "       g.min_select AS minSelect, g.max_select AS maxSelect, "
        "       g.required, g.multi_select AS multiSelect, g.sort_order AS sortOrder "
        "FROM modifier_groups g "
        "ORDER BY g.sort_order, g.name_az");
    return attachModifiers(ctx, stmt.rows(), true);
}

}  // namespace

void registerCatalog(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(std::string(protocol::method::kCatalogCategories),
                           [ctx](const ipc::Request&) {
                               ctx->requireAuth();
                               auto stmt = ctx->db().prepare(
                                   "SELECT id, name_az AS nameAz, name_tr AS nameTr, "
                                   "       name_en AS nameEn, icon, accent, image, "
                                   "       sort_order AS sortOrder, "
                                   "       (SELECT COUNT(*) FROM menu_items m "
                                   "        WHERE m.category_id = c.id AND m.active = 1) AS itemCount "
                                   "FROM menu_categories c WHERE active = 1 ORDER BY sort_order");
                               return Json{{"categories", stmt.rows()}};
                           });

    server.registerHandler(
        std::string(protocol::method::kCatalogProducts), [ctx](const ipc::Request& request) {
            ctx->requireAuth();

            const auto categoryId = getOr<std::string>(request.payload, "categoryId", "");
            const auto search = getOr<std::string>(request.payload, "search", "");
            const bool popularOnly = getOr<bool>(request.payload, "popularOnly", false);
            const bool includeDrafts = getOr<bool>(request.payload, "includeDrafts", false);
            if (includeDrafts) ctx->requirePermission("catalog.manage");

            std::string sql = std::string("SELECT ") + kItemColumns +
                              (includeDrafts
                                   ? " FROM menu_items i WHERE i.archived = 0"
                                   : " FROM menu_items i WHERE i.active = 1 AND i.archived = 0");
            if (!categoryId.empty()) sql += " AND i.category_id = :categoryId";
            if (!search.empty()) {
                // Parameterised LIKE - never string concatenation into SQL.
                sql +=
                    " AND (i.name_az LIKE :search OR i.name_en LIKE :search "
                    "      OR i.name_tr LIKE :search OR i.sku LIKE :search)";
            }
            if (popularOnly) sql += " AND i.popular = 1";
            sql += " ORDER BY i.sort_order, i.name_az";

            auto stmt = ctx->db().prepare(sql);
            if (!categoryId.empty()) stmt.bind(":categoryId", categoryId);
            if (!search.empty()) stmt.bind(":search", "%" + search + "%");

            Json products = stmt.rows();
            for (auto& product : products) expandAllergens(product);

            return Json{{"products", products}};
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogProduct), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto productId = getOr<std::string>(request.payload, "productId", "");
            const bool includeDrafts = getOr<bool>(request.payload, "includeDrafts", false);
            if (includeDrafts) ctx->requirePermission("catalog.manage");
            require(!productId.empty(), "productId is required");

            auto stmt =
                ctx->db().prepare(std::string("SELECT ") + kItemColumns +
                                  (includeDrafts
                                       ? " FROM menu_items i WHERE i.id = :productId AND i.archived = 0"
                                       : " FROM menu_items i WHERE i.id = :productId AND i.active = 1 AND i.archived = 0"));
            stmt.bind(":productId", productId);

            if (!stmt.step()) {
                throw PosError(std::string(protocol::err::kNotFound), "Product was not found");
            }

            Json product = stmt.row();
            expandAllergens(product);
            product["modifierGroups"] = loadModifierGroups(*ctx, productId);

            return product;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogModifierGroups), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto productId = getOr<std::string>(request.payload, "productId", "");
            if (productId.empty()) {
                return Json{{"groups", loadAllModifierGroups(*ctx)}};
            }
            return Json{{"groups", loadModifierGroups(*ctx, productId)}};
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogSetAvailability),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");

            const auto productId = getOr<std::string>(request.payload, "productId", "");
            const bool available = getOr<bool>(request.payload, "available", true);
            require(!productId.empty(), "productId is required");

            auto stmt = ctx->db().prepare(
                "UPDATE menu_items SET sold_out = :soldOut, updated_at = :now "
                "WHERE id = :productId");
            stmt.bind(":soldOut", !available).bind(":now", nowMs()).bind(":productId", productId);
            stmt.exec();

            if (ctx->db().changes() == 0) {
                throw PosError(std::string(protocol::err::kNotFound), "Product was not found");
            }

            ctx->audit("catalog.availability", "menu_item", productId,
                       Json{{"available", available}});

            return Json{{"productId", productId}, {"available", available}};
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogSetSoldOut), [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            const auto productId = getOr<std::string>(request.payload, "productId", "");
            const bool soldOut = getOr<bool>(request.payload, "soldOut", true);
            require(!productId.empty(), "productId is required");
            return services::CatalogAdminService(*ctx).setSoldOut(productId, soldOut);
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogSetImageHidden), [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            const auto productId = getOr<std::string>(request.payload, "productId", "");
            const bool hidden = getOr<bool>(request.payload, "imageHidden", true);
            require(!productId.empty(), "productId is required");
            return services::CatalogAdminService(*ctx).setImageHidden(productId, hidden);
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogSetAllImagesHidden),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            const bool hidden = getOr<bool>(request.payload, "imageHidden", true);
            db::Transaction txn(ctx->db());
            const auto result = services::CatalogAdminService(*ctx).setAllImagesHidden(hidden);
            txn.commit();
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogUpsertCategory),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            services::Idempotency idempotency(*ctx);
            const auto key = request.idempotencyKey.empty()
                                 ? getOr<std::string>(request.payload, "idempotencyKey", "")
                                 : request.idempotencyKey;
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(key,
                                                    std::string(protocol::method::kCatalogUpsertCategory),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }
                result = services::CatalogAdminService(*ctx).upsertCategory(request.payload);
                idempotency.complete(key, result, "menu_category",
                                     result.value("id", ""));
                txn.commit();
            }
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogUpsertProduct),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            services::Idempotency idempotency(*ctx);
            const auto key = request.idempotencyKey.empty()
                                 ? getOr<std::string>(request.payload, "idempotencyKey", "")
                                 : request.idempotencyKey;
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(key,
                                                    std::string(protocol::method::kCatalogUpsertProduct),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }
                result = services::CatalogAdminService(*ctx).upsertProduct(request.payload);
                idempotency.complete(key, result, "menu_item",
                                     result.value("id", ""));
                txn.commit();
            }
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogArchiveCategory),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            return services::CatalogAdminService(*ctx).archiveCategory(
                getOr<std::string>(request.payload, "categoryId", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogArchiveProduct),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            return services::CatalogAdminService(*ctx).archiveProduct(
                getOr<std::string>(request.payload, "productId", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogUpsertModifierGroup),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            services::Idempotency idempotency(*ctx);
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(
                        request.idempotencyKey,
                        std::string(protocol::method::kCatalogUpsertModifierGroup),
                        request.payload)) {
                    txn.commit();
                    return *replay;
                }
                result = services::CatalogAdminService(*ctx).upsertModifierGroup(request.payload);
                idempotency.complete(request.idempotencyKey, result, "modifier_group",
                                     result.value("id", ""));
                txn.commit();
            }
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogUpsertModifier),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            services::Idempotency idempotency(*ctx);
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(
                        request.idempotencyKey, std::string(protocol::method::kCatalogUpsertModifier),
                        request.payload)) {
                    txn.commit();
                    return *replay;
                }
                result = services::CatalogAdminService(*ctx).upsertModifier(request.payload);
                idempotency.complete(request.idempotencyKey, result, "modifier",
                                     result.value("id", ""));
                txn.commit();
            }
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogArchiveModifier),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            return services::CatalogAdminService(*ctx).archiveModifier(
                getOr<std::string>(request.payload, "modifierId", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogSetProductModifierGroups),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            services::Idempotency idempotency(*ctx);
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(
                        request.idempotencyKey,
                        std::string(protocol::method::kCatalogSetProductModifierGroups),
                        request.payload)) {
                    txn.commit();
                    return *replay;
                }
                const auto productId = getOr<std::string>(request.payload, "productId", "");
                require(!productId.empty(), "productId is required");
                const Json groups = request.payload.contains("groupIds")
                                        ? request.payload["groupIds"]
                                        : Json::array();
                result = services::CatalogAdminService(*ctx).setProductModifierGroups(productId,
                                                                                      groups);
                idempotency.complete(request.idempotencyKey, result, "menu_item", productId);
                txn.commit();
            }
            return result;
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogPriceHistory),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.manage");
            return services::CatalogAdminService(*ctx).priceHistory(
                getOr<std::string>(request.payload, "productId", ""));
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogImportPreview),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.import");
            return services::CatalogAdminService(*ctx).importPreview(
                getOr<std::string>(request.payload, "csvText", ""),
                getOr<std::string>(request.payload, "filename", "import.csv"));
        });

    server.registerHandler(
        std::string(protocol::method::kCatalogImportCommit),
        [ctx](const ipc::Request& request) {
            ctx->requirePermission("catalog.import");
            services::Idempotency idempotency(*ctx);
            Json result;
            {
                db::Transaction txn(ctx->db());
                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kCatalogImportCommit),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }
                result = services::CatalogAdminService(*ctx).importCommit(
                    getOr<std::string>(request.payload, "batchId", ""));
                idempotency.complete(request.idempotencyKey, result, "catalog_import",
                                     result.value("batchId", ""));
                txn.commit();
            }
            return result;
        });

    server.registerHandler(std::string(protocol::method::kCatalogExport),
                           [ctx](const ipc::Request&) {
                               ctx->requirePermission("catalog.import");
                               return services::CatalogAdminService(*ctx).exportCatalog();
                           });
}

}  // namespace pos::handlers
