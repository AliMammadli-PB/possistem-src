#include "pos/printing/ReceiptDocument.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace pos::printing {

int printableDotWidth(PaperWidth width) {
    if (!std::isfinite(width.mm) || width.mm < 40 || width.mm > 120 || width.dpi < 180 || width.dpi > 600)
        throw std::invalid_argument("Invalid paper width or DPI");
    const int maximum = static_cast<int>(std::floor(width.mm * width.dpi / 25.4 / 8)) * 8;
    if (width.printableDots != 0) {
        if (width.printableDots < 128 || width.printableDots > maximum || width.printableDots % 8 != 0)
            throw std::invalid_argument("Printable dots must fit the paper and be a multiple of 8");
        return width.printableDots;
    }
    const double usableMm = width.mm >= 79.5 && width.mm <= 80 ? 72 : width.mm - 10;
    if (width.dpi == 203 && width.mm >= 57.5 && width.mm <= 58) return 384;
    if (width.dpi == 203 && width.mm >= 79.5 && width.mm <= 80) return 576;
    return std::max(128, static_cast<int>(std::floor(usableMm * width.dpi / 25.4 / 8)) * 8);
}
int defaultCharsPerLine(PaperWidth width) {
    if (width.mm == 58) return 28;
    if (width.mm == 80) return 40;
    return std::clamp((printableDotWidth(width) - 4) / 14, 16, 96);
}
PaperWidth paperWidthFromMm(double mm) {
    PaperWidth width{mm, 0, 203};
    (void)printableDotWidth(width);
    return width;
}
double paperWidthMm(PaperWidth width) { return width.mm; }

RenderMode renderModeFromString(const std::string& value) {
    if (value == "text") return RenderMode::Text;
    if (value == "raster") return RenderMode::Raster;
    return RenderMode::Auto;
}

std::string renderModeToString(RenderMode mode) {
    switch (mode) {
        case RenderMode::Text: return "text";
        case RenderMode::Raster: return "raster";
        default: return "auto";
    }
}

CurrencyDisplay currencyDisplayFromString(const std::string& value) {
    if (value == "symbol") return CurrencyDisplay::Symbol;
    if (value == "none") return CurrencyDisplay::None;
    return CurrencyDisplay::Code;
}

Money ReceiptDocument::visibleItemTotal() const {
    Money sum = 0;
    for (const auto& item : items) {
        if (item.voided || item.complimentary) continue;

        // Mirrors exactly what the renderers put in the money column: the base
        // line total on the item row plus every modifier row that carries a
        // price of its own.
        sum += item.baseLineTotal;
        for (const auto& modifier : item.modifiers) {
            if (modifier.isIncludedInParentPrice || modifier.isFree) continue;
            sum += modifier.lineTotal;
        }
    }
    return sum;
}

ReceiptDocument documentFromJson(const Json& json) {
    ReceiptDocument doc;
    if (!json.is_object()) return doc;

    const std::string kindName = json.value("kind", "payment_receipt");
    if (kindName == "customer_bill") doc.kind = ReceiptKind::CustomerBill;
    else if (kindName == "kitchen_ticket") doc.kind = ReceiptKind::KitchenTicket;
    else if (kindName == "shift_report") doc.kind = ReceiptKind::ShiftReport;

    doc.receiptId = getOr<std::string>(json, "receiptId", "");
    doc.receiptNumber = getOr<std::string>(json, "receiptNumber", "");
    doc.orderNumber = getOr<std::string>(json, "orderNumber", "");
    doc.orderType = getOr<std::string>(json, "orderType", "");
    doc.tableName = getOr<std::string>(json, "tableName", "");
    doc.areaName = getOr<std::string>(json, "areaName", "");
    doc.waiterName = getOr<std::string>(json, "waiterName", "");
    // Typed defaults matter: nlohmann infers the return type from the fallback,
    // and an `int` fallback silently truncates a millisecond timestamp.
    doc.guestCount = json.value("guestCount", std::int64_t{0});
    doc.openedAt = json.value("openedAt", Timestamp{0});
    doc.paidAt = json.value("paidAt", Timestamp{0});
    doc.terminalName = getOr<std::string>(json, "terminalName", "");

    if (json.contains("restaurant") && json["restaurant"].is_object()) {
        const auto& r = json["restaurant"];
        doc.restaurant.name = getOr<std::string>(r, "name", "");
        doc.restaurant.tagline = getOr<std::string>(r, "tagline", "");
        doc.restaurant.address = getOr<std::string>(r, "address", "");
        doc.restaurant.phone = getOr<std::string>(r, "phone", "");
        doc.restaurant.hours = getOr<std::string>(r, "hours", "");
        doc.restaurant.taxId = getOr<std::string>(r, "taxId", "");
    }

    if (json.contains("items") && json["items"].is_array()) {
        for (const auto& raw : json["items"]) {
            ReceiptItem item;
            item.id = getOr<std::string>(raw, "id", "");
            item.name = getOr<std::string>(raw, "name", "");
            item.quantity = raw.value("quantity", std::int64_t{1});
            item.unitBasePrice = raw.value("unitBasePriceMinor", Money{0});
            item.baseLineTotal = raw.value("baseLineTotalMinor", Money{0});
            item.notes = getOr<std::string>(raw, "notes", "");
            item.itemLineTotal = raw.value("itemLineTotalMinor", Money{0});
            item.voided = raw.value("voided", false);
            item.complimentary = raw.value("complimentary", false);

            if (raw.contains("modifiers") && raw["modifiers"].is_array()) {
                for (const auto& rawMod : raw["modifiers"]) {
                    ReceiptModifier modifier;
                    modifier.name = getOr<std::string>(rawMod, "name", "");
                    modifier.quantity = rawMod.value("quantity", std::int64_t{1});
                    modifier.unitPrice = rawMod.value("unitPriceMinor", Money{0});
                    modifier.lineTotal = rawMod.value("lineTotalMinor", Money{0});
                    modifier.isFree = rawMod.value("isFree", false);
                    modifier.isIncludedInParentPrice =
                        rawMod.value("isIncludedInParentPrice", false);
                    item.modifiers.push_back(std::move(modifier));
                }
            }
            doc.items.push_back(std::move(item));
        }
    }

    doc.subtotal = json.value("subtotalMinor", Money{0});
    doc.discountTotal = json.value("discountTotalMinor", Money{0});
    doc.discountLabel = getOr<std::string>(json, "discountLabel", "");
    doc.serviceCharge = json.value("serviceChargeMinor", Money{0});
    doc.serviceLabel = getOr<std::string>(json, "serviceLabel", "");
    doc.depositTotal = json.value("depositTotalMinor", Money{0});
    doc.depositLabel = getOr<std::string>(json, "depositLabel", "");
    doc.taxTotal = json.value("taxTotalMinor", Money{0});
    doc.grandTotal = json.value("grandTotalMinor", Money{0});
    doc.amountPaid = json.value("amountPaidMinor", Money{0});
    doc.remainingAmount = json.value("remainingAmountMinor", Money{0});
    doc.changeAmount = json.value("changeAmountMinor", Money{0});
    doc.tipTotal = json.value("tipTotalMinor", Money{0});

    if (json.contains("taxes") && json["taxes"].is_array()) {
        for (const auto& raw : json["taxes"]) {
            ReceiptTaxLine line;
            line.label = getOr<std::string>(raw, "label", "");
            line.amount = raw.value("amountMinor", Money{0});
            line.included = raw.value("included", false);
            doc.taxes.push_back(std::move(line));
        }
    }

    if (json.contains("payments") && json["payments"].is_array()) {
        for (const auto& raw : json["payments"]) {
            ReceiptPayment payment;
            payment.method = getOr<std::string>(raw, "method", "");
            payment.label = getOr<std::string>(raw, "label", "");
            payment.amount = raw.value("amountMinor", Money{0});
            payment.tendered = raw.value("tenderedMinor", Money{0});
            payment.change = raw.value("changeMinor", Money{0});
            doc.payments.push_back(std::move(payment));
        }
    }

    doc.qrPayload = getOr<std::string>(json, "qrPayload", "");
    if (json.contains("footer") && json["footer"].is_array()) {
        for (const auto& line : json["footer"]) {
            if (line.is_string()) doc.footer.push_back(line.get<std::string>());
        }
    }

    doc.locale = json.value("locale", "az-AZ");
    doc.currencyCode = json.value("currency", "AZN");
    doc.currencyDisplay = currencyDisplayFromString(json.value("currencyDisplay", "code"));
    doc.paperWidth = paperWidthFromMm(json.value("paperWidth", 80.0));
    doc.paperWidth.dpi = json.value("dpi", 203);
    doc.paperWidth.printableDots = json.value("printableDots", 0);
    (void)printableDotWidth(doc.paperWidth);
    doc.charsPerLine = json.value("charsPerLine", defaultCharsPerLine(doc.paperWidth));
    doc.isReprint = json.value("isReprint", false);
    doc.printQr = json.value("printQr", !doc.qrPayload.empty());
    return doc;
}

Json ReceiptDocument::toJson() const {
    Json itemsJson = Json::array();
    for (const auto& item : items) {
        Json modifiersJson = Json::array();
        for (const auto& modifier : item.modifiers) {
            modifiersJson.push_back(Json{
                {"name", modifier.name},
                {"quantity", modifier.quantity},
                {"unitPriceMinor", modifier.unitPrice},
                {"lineTotalMinor", modifier.lineTotal},
                {"isFree", modifier.isFree},
                {"isIncludedInParentPrice", modifier.isIncludedInParentPrice},
            });
        }
        itemsJson.push_back(Json{
            {"id", item.id},
            {"name", item.name},
            {"quantity", item.quantity},
            {"unitBasePriceMinor", item.unitBasePrice},
            {"baseLineTotalMinor", item.baseLineTotal},
            {"modifiers", modifiersJson},
            {"notes", item.notes},
            {"itemLineTotalMinor", item.itemLineTotal},
            {"voided", item.voided},
            {"complimentary", item.complimentary},
        });
    }

    Json paymentsJson = Json::array();
    for (const auto& payment : payments) {
        paymentsJson.push_back(Json{
            {"method", payment.method},
            {"label", payment.label},
            {"amountMinor", payment.amount},
            {"tenderedMinor", payment.tendered},
            {"changeMinor", payment.change},
        });
    }

    Json taxesJson = Json::array();
    for (const auto& tax : taxes) {
        taxesJson.push_back(
            Json{{"label", tax.label}, {"amountMinor", tax.amount}, {"included", tax.included}});
    }

    const char* kindName = "payment_receipt";
    switch (kind) {
        case ReceiptKind::CustomerBill: kindName = "customer_bill"; break;
        case ReceiptKind::KitchenTicket: kindName = "kitchen_ticket"; break;
        case ReceiptKind::ShiftReport: kindName = "shift_report"; break;
        default: break;
    }

    return Json{
        {"kind", kindName},
        {"receiptId", receiptId},
        {"receiptNumber", receiptNumber},
        {"orderNumber", orderNumber},
        {"orderType", orderType},
        {"tableName", tableName},
        {"areaName", areaName},
        {"waiterName", waiterName},
        {"guestCount", guestCount},
        {"openedAt", openedAt},
        {"paidAt", paidAt},
        {"terminalName", terminalName},
        {"restaurant",
         Json{{"name", restaurant.name},
              {"tagline", restaurant.tagline},
              {"address", restaurant.address},
              {"phone", restaurant.phone},
              {"hours", restaurant.hours},
              {"taxId", restaurant.taxId}}},
        {"items", itemsJson},
        {"subtotalMinor", subtotal},
        {"visibleItemTotalMinor", visibleItemTotal()},
        {"discountTotalMinor", discountTotal},
        {"discountLabel", discountLabel},
        {"serviceChargeMinor", serviceCharge},
        {"serviceLabel", serviceLabel},
        {"depositTotalMinor", depositTotal},
        {"depositLabel", depositLabel},
        {"taxes", taxesJson},
        {"taxTotalMinor", taxTotal},
        {"grandTotalMinor", grandTotal},
        {"payments", paymentsJson},
        {"amountPaidMinor", amountPaid},
        {"remainingAmountMinor", remainingAmount},
        {"changeAmountMinor", changeAmount},
        {"tipTotalMinor", tipTotal},
        {"qrPayload", qrPayload},
        {"footer", footer},
        {"locale", locale},
        {"currency", currencyCode},
        {"currencyDisplay", currencyDisplay == CurrencyDisplay::Symbol
                                ? "symbol"
                                : currencyDisplay == CurrencyDisplay::None ? "none" : "code"},
        {"paperWidth", paperWidthMm(paperWidth)},
        {"dpi", paperWidth.dpi}, {"printableDots", paperWidth.printableDots},
        {"printQr", printQr},
        {"charsPerLine", charsPerLine},
        {"isReprint", isReprint},
    };
}

}  // namespace pos::printing
