#include "pos/services/GiftCampaignService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {

Money GiftCampaignService::payableSubtotal(const std::string& orderId) {
    // Gift lines are excluded from the threshold calculation.
    auto stmt = ctx_.db().prepare(
        "SELECT COALESCE(SUM(line_total_minor), 0) FROM order_items "
        "WHERE order_id = :order AND status != 'voided' "
        "  AND COALESCE(is_gift, 0) = 0 AND complimentary = 0");
    stmt.bind(":order", orderId);
    stmt.step();
    return stmt.columnInt(0);
}

Json GiftCampaignService::listCampaigns(bool activeOnly) {
    std::string sql =
        "SELECT id, name_az AS nameAz, name_tr AS nameTr, name_en AS nameEn, active, "
        "       starts_at AS startsAt, ends_at AS endsAt, min_order_minor AS minOrderMinor, "
        "       review_required AS reviewRequired, stackable, "
        "       max_gifts_per_order AS maxGiftsPerOrder, note "
        "FROM gift_campaigns";
    if (activeOnly) sql += " WHERE active = 1";
    sql += " ORDER BY name_az";
    auto stmt = ctx_.db().prepare(sql);
    Json campaigns = stmt.rows();
    for (auto& campaign : campaigns) {
        auto tiers = ctx_.db().prepare(
            "SELECT id, threshold_minor AS thresholdMinor, gift_item_id AS giftItemId, "
            "       quantity, sort_order AS sortOrder "
            "FROM gift_campaign_tiers WHERE campaign_id = :id ORDER BY threshold_minor");
        tiers.bind(":id", campaign.at("id").get<std::string>());
        campaign["tiers"] = tiers.rows();
    }
    return Json{{"campaigns", campaigns}};
}

Json GiftCampaignService::upsertCampaign(const Json& payload) {
    const std::string nameAz = getOr<std::string>(payload, "nameAz", "");
    if (nameAz.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "Campaign name is required");
    }
    std::string id = getOr<std::string>(payload, "id", "");
    const auto now = nowMs();
    const bool isNew = id.empty();
    if (isNew) id = crypto::uuid4();

    if (isNew) {
        auto insert = ctx_.db().prepare(
            "INSERT INTO gift_campaigns ("
            "  id, name_az, name_tr, name_en, active, starts_at, ends_at, min_order_minor,"
            "  review_required, stackable, max_gifts_per_order, note, created_at, updated_at"
            ") VALUES ("
            "  :id, :az, :tr, :en, :active, :starts, :ends, :min,"
            "  :review, :stack, :max, :note, :now, :now)");
        insert.bind(":id", id)
            .bind(":az", nameAz)
            .bind(":tr", getOr<std::string>(payload, "nameTr", ""))
            .bind(":en", getOr<std::string>(payload, "nameEn", ""))
            .bind(":active", getOr<std::int64_t>(payload, "active", 1))
            .bind(":starts", getOr<std::int64_t>(payload, "startsAt", 0))
            .bind(":ends", getOr<std::int64_t>(payload, "endsAt", 0))
            .bind(":min", getOr<Money>(payload, "minOrderMinor", 0))
            .bind(":review", getOr<std::int64_t>(payload, "reviewRequired", 0))
            .bind(":stack", getOr<std::int64_t>(payload, "stackable", 0))
            .bind(":max", getOr<std::int64_t>(payload, "maxGiftsPerOrder", 1))
            .bind(":note", getOr<std::string>(payload, "note", ""))
            .bind(":now", now);
        insert.exec();
    } else {
        auto update = ctx_.db().prepare(
            "UPDATE gift_campaigns SET name_az = :az, name_tr = :tr, name_en = :en, "
            "  active = :active, starts_at = :starts, ends_at = :ends, "
            "  min_order_minor = :min, review_required = :review, stackable = :stack, "
            "  max_gifts_per_order = :max, note = :note, updated_at = :now WHERE id = :id");
        update.bind(":id", id)
            .bind(":az", nameAz)
            .bind(":tr", getOr<std::string>(payload, "nameTr", ""))
            .bind(":en", getOr<std::string>(payload, "nameEn", ""))
            .bind(":active", getOr<std::int64_t>(payload, "active", 1))
            .bind(":starts", getOr<std::int64_t>(payload, "startsAt", 0))
            .bind(":ends", getOr<std::int64_t>(payload, "endsAt", 0))
            .bind(":min", getOr<Money>(payload, "minOrderMinor", 0))
            .bind(":review", getOr<std::int64_t>(payload, "reviewRequired", 0))
            .bind(":stack", getOr<std::int64_t>(payload, "stackable", 0))
            .bind(":max", getOr<std::int64_t>(payload, "maxGiftsPerOrder", 1))
            .bind(":note", getOr<std::string>(payload, "note", ""))
            .bind(":now", now);
        update.exec();
    }

    if (payload.contains("tiers") && payload.at("tiers").is_array()) {
        auto clear = ctx_.db().prepare("DELETE FROM gift_campaign_tiers WHERE campaign_id = :id");
        clear.bind(":id", id);
        clear.exec();
        int sort = 0;
        for (const auto& tier : payload.at("tiers")) {
            auto insertTier = ctx_.db().prepare(
                "INSERT INTO gift_campaign_tiers ("
                "  id, campaign_id, threshold_minor, gift_item_id, quantity, sort_order"
                ") VALUES (:id, :campaign, :threshold, :item, :qty, :sort)");
            insertTier.bind(":id", crypto::uuid4())
                .bind(":campaign", id)
                .bind(":threshold", getOr<Money>(tier, "thresholdMinor", 0))
                .bind(":item", getOr<std::string>(tier, "giftItemId", ""))
                .bind(":qty", getOr<std::int64_t>(tier, "quantity", 1))
                .bind(":sort", static_cast<std::int64_t>(sort++));
            insertTier.exec();
        }
    }

    ctx_.auditRequired("gifts.upsert", "gift_campaign", id, payload);
    return listCampaigns(false);
}

Json GiftCampaignService::evaluateOrder(const std::string& orderId) {
    const Money subtotal = payableSubtotal(orderId);
    Json eligible = Json::array();

    auto campaigns = ctx_.db().prepare(
        "SELECT id, name_az, review_required, max_gifts_per_order, min_order_minor "
        "FROM gift_campaigns WHERE active = 1");
    while (campaigns.step()) {
        const std::string campaignId = campaigns.columnText(0);
        if (subtotal < campaigns.columnInt(4)) continue;

        auto tiers = ctx_.db().prepare(
            "SELECT t.id, t.threshold_minor, t.gift_item_id, t.quantity, "
            "       m.name_az, m.price_minor "
            "FROM gift_campaign_tiers t "
            "JOIN menu_items m ON m.id = t.gift_item_id "
            "WHERE t.campaign_id = :id AND t.threshold_minor <= :sub "
            "ORDER BY t.threshold_minor DESC");
        tiers.bind(":id", campaignId).bind(":sub", subtotal);
        Json tierList = Json::array();
        while (tiers.step()) {
            tierList.push_back(Json{{"tierId", tiers.columnText(0)},
                                    {"thresholdMinor", tiers.columnInt(1)},
                                    {"giftItemId", tiers.columnText(2)},
                                    {"quantity", tiers.columnInt(3)},
                                    {"nameAz", tiers.columnText(4)},
                                    {"originalPriceMinor", tiers.columnInt(5)}});
        }
        if (!tierList.empty()) {
            eligible.push_back(Json{{"campaignId", campaignId},
                                    {"nameAz", campaigns.columnText(1)},
                                    {"reviewRequired", campaigns.columnInt(2) != 0},
                                    {"maxGiftsPerOrder", campaigns.columnInt(3)},
                                    {"payableSubtotalMinor", subtotal},
                                    {"tiers", tierList}});
        }
    }

    return Json{{"orderId", orderId},
                {"payableSubtotalMinor", subtotal},
                {"eligible", eligible}};
}

Json GiftCampaignService::applyGift(const std::string& orderId, const std::string& campaignId,
                                    const std::string& tierId) {
    auto tier = ctx_.db().prepare(
        "SELECT t.id, t.gift_item_id, t.quantity, t.threshold_minor, "
        "       c.review_required, m.name_az, m.price_minor, m.station, m.course "
        "FROM gift_campaign_tiers t "
        "JOIN gift_campaigns c ON c.id = t.campaign_id "
        "JOIN menu_items m ON m.id = t.gift_item_id "
        "WHERE t.id = :tier AND t.campaign_id = :campaign AND c.active = 1");
    tier.bind(":tier", tierId).bind(":campaign", campaignId);
    if (!tier.step()) {
        throw PosError(std::string(protocol::err::kNotFound), "Gift tier not found");
    }

    const Money subtotal = payableSubtotal(orderId);
    if (subtotal < tier.columnInt(3)) {
        throw PosError(std::string(protocol::err::kValidation),
                       "Order does not meet the gift threshold");
    }

    const bool reviewRequired = tier.columnInt(4) != 0;
    const Money originalPrice = tier.columnInt(6);
    const std::string productId = tier.columnText(1);
    const auto quantity = tier.columnInt(2);
    const auto now = nowMs();

    auto seq = ctx_.db().prepare(
        "SELECT COALESCE(MAX(line_seq), 0) + 1 FROM order_items WHERE order_id = :order");
    seq.bind(":order", orderId);
    seq.step();
    const auto lineSeq = seq.columnInt(0);
    const std::string itemId = crypto::uuid4();

    auto insertItem = ctx_.db().prepare(
        "INSERT INTO order_items ("
        "  id, order_id, product_id, line_seq, name_snapshot, unit_price_minor, quantity,"
        "  modifier_total_minor, line_total_minor, status, course, complimentary, is_gift,"
        "  gift_campaign_id, original_price_minor, created_at, updated_at, row_version"
        ") VALUES ("
        "  :id, :order, :product, :seq, :name, 0, :qty, 0, 0, 'draft', :course, 1, 1,"
        "  :campaign, :original, :now, :now, 1)");
    insertItem.bind(":id", itemId)
        .bind(":order", orderId)
        .bind(":product", productId)
        .bind(":seq", lineSeq)
        .bind(":name", tier.columnText(5) + " (Hədiyyə)")
        .bind(":qty", quantity)
        .bind(":course", tier.columnIsNull(8) ? "dessert" : tier.columnText(8))
        .bind(":campaign", campaignId)
        .bind(":original", originalPrice)
        .bind(":now", now);
    insertItem.exec();

    const std::string giftId = crypto::uuid4();
    const std::string giftStatus = reviewRequired ? "review_required" : "applied";
    auto insertGift = ctx_.db().prepare(
        "INSERT INTO order_gifts ("
        "  id, order_id, campaign_id, tier_id, gift_item_id, order_item_id,"
        "  original_price_minor, charged_price_minor, status, created_at, updated_at"
        ") VALUES ("
        "  :id, :order, :campaign, :tier, :item, :orderItem, :original, 0, :status, :now, :now)");
    insertGift.bind(":id", giftId)
        .bind(":order", orderId)
        .bind(":campaign", campaignId)
        .bind(":tier", tierId)
        .bind(":item", productId)
        .bind(":orderItem", itemId)
        .bind(":original", originalPrice)
        .bind(":status", giftStatus)
        .bind(":now", now);
    insertGift.exec();

    if (reviewRequired) {
        auto mark = ctx_.db().prepare(
            "UPDATE orders SET gift_review_status = 'required', updated_at = :now, "
            "row_version = row_version + 1 WHERE id = :id");
        mark.bind(":now", now).bind(":id", orderId);
        mark.exec();
    }

    ctx_.auditRequired("gifts.apply", "order", orderId,
                       Json{{"giftId", giftId},
                            {"campaignId", campaignId},
                            {"tierId", tierId},
                            {"chargedPriceMinor", 0},
                            {"originalPriceMinor", originalPrice}});

    return Json{{"giftId", giftId},
                {"orderItemId", itemId},
                {"chargedPriceMinor", 0},
                {"originalPriceMinor", originalPrice},
                {"reviewRequired", reviewRequired},
                {"status", giftStatus}};
}

Json GiftCampaignService::approveReview(const std::string& orderId, const std::string& approvedBy) {
    const auto now = nowMs();
    auto gifts = ctx_.db().prepare(
        "UPDATE order_gifts SET status = 'approved', reviewed_by = :user, reviewed_at = :now, "
        "updated_at = :now WHERE order_id = :order AND status = 'review_required'");
    gifts.bindOptional(":user", approvedBy).bind(":now", now).bind(":order", orderId);
    gifts.exec();

    auto order = ctx_.db().prepare(
        "UPDATE orders SET gift_review_status = 'approved', updated_at = :now, "
        "row_version = row_version + 1 WHERE id = :id");
    order.bind(":now", now).bind(":id", orderId);
    order.exec();

    ctx_.auditRequired("gifts.approve", "order", orderId, Json{{"approvedBy", approvedBy}});
    return Json{{"orderId", orderId}, {"giftReviewStatus", "approved"}};
}

}  // namespace pos::services
