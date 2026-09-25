#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

class GiftCampaignService {
public:
    explicit GiftCampaignService(handlers::Context& ctx) : ctx_(ctx) {}

    Json listCampaigns(bool activeOnly = true);
    Json upsertCampaign(const Json& payload);
    Json evaluateOrder(const std::string& orderId);
    Json applyGift(const std::string& orderId, const std::string& campaignId,
                   const std::string& tierId);
    Json approveReview(const std::string& orderId, const std::string& approvedBy);

private:
    handlers::Context& ctx_;
    Money payableSubtotal(const std::string& orderId);
};

}  // namespace pos::services
