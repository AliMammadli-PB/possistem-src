#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

class CatalogAdminService {
public:
    explicit CatalogAdminService(handlers::Context& ctx) : ctx_(ctx) {}

    Json upsertCategory(const Json& payload);
    Json archiveCategory(const std::string& categoryId);
    Json upsertProduct(const Json& payload);
    Json archiveProduct(const std::string& productId);
    Json setSoldOut(const std::string& productId, bool soldOut);
    /** Hides one dish's photo on the order screen; the picture itself is kept. */
    Json setImageHidden(const std::string& productId, bool hidden);
    /** Same, for the whole active menu. Returns how many rows moved. */
    Json setAllImagesHidden(bool hidden);
    Json priceHistory(const std::string& productId);
    Json upsertModifierGroup(const Json& payload);
    Json upsertModifier(const Json& payload);
    Json archiveModifier(const std::string& modifierId);
    Json setProductModifierGroups(const std::string& productId, const Json& groupIds);
    Json importPreview(std::string_view csvText, std::string_view filename);
    Json importCommit(const std::string& batchId);
    Json exportCatalog();

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
