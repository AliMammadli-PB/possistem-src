#include "pos/printing/ReceiptBuilder.hpp"
#include <cmath>

#include <algorithm>
#include <ctime>
#include <iomanip>
#include <sstream>

#include "pos/Crypto.hpp"
#include "pos/Logging.hpp"
#include "pos/Error.hpp"
#include "pos/printing/ReceiptFormatter.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/ReportService.hpp"

namespace pos::printing {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("printer");
    return log;
}

std::string formatTimestamp(Timestamp ms) {
    const std::time_t seconds = static_cast<std::time_t>(ms / 1000);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &seconds);
#else
    localtime_r(&seconds, &tm);
#endif
    std::ostringstream out;
    out << std::put_time(&tm, "%d.%m.%Y  %H:%M");
    return out.str();
}

std::string paymentLabel(const Json& payment) {
    const std::string method = getOr<std::string>(payment, "method", "");
    if (method == "cash") return "Nağd";
    if (method == "card") return "Kart";
    return "Ödəniş";
}

std::string digitsOnly(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (unsigned char c : raw) {
        if (c >= '0' && c <= '9') out.push_back(static_cast<char>(c));
    }
    return out;
}

std::string urlEncode(const std::string& value) {
    static constexpr char kHex[] = "0123456789ABCDEF";
    std::string out;
    out.reserve(value.size() * 3);
    for (unsigned char c : value) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ||
            c == '_' || c == '.' || c == '~') {
            out.push_back(static_cast<char>(c));
        } else if (c == ' ') {
            out += "%20";
        } else {
            out.push_back('%');
            out.push_back(kHex[c >> 4]);
            out.push_back(kHex[c & 0x0F]);
        }
    }
    return out;
}

}  // namespace

std::string buildQrPayload(const ReceiptDocument& doc, const std::string& verifyUrl,
                           const std::string& placeUrl) {
    // Only the configured guest-facing link is encoded, byte for byte.
    return placeUrl;
}

std::vector<ReceiptLine> buildTestPage(const ReceiptSettings& config,
                                       const std::string& restaurantName) {
    const int width = config.charsPerLine;
    const auto money = [&](Money minor) {
        return printing::formatMoney(minor, config.currencyCode, config.currencyDisplay);
    };

    std::vector<ReceiptLine> lines;
    lines.push_back({restaurantName, LineAlign::Center, true, false});
    lines.push_back({"PRINTER TEST", LineAlign::Center, true});
    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue(
        "Kağız:", std::to_string(paperWidthMm(config.paperWidth)) + " mm", width)});
    lines.push_back({layout::renderKeyValue("Sütun:", std::to_string(width), width)});
    lines.push_back({layout::renderKeyValue("Rejim:", renderModeToString(config.renderMode), width)});
    lines.push_back({layout::renderKeyValue("Kod səhifəsi:", std::to_string(config.codePage), width)});
    lines.push_back({layout::renderSeparator('-', width)});

    lines.push_back({"Azərbaycan hərfləri", LineAlign::Center});
    lines.push_back({"Ə ə  Ş ş  Ğ ğ  Ç ç", LineAlign::Center});
    lines.push_back({"Ö ö  Ü ü  İ ı", LineAlign::Center});
    lines.push_back({"Təşəkkür edirik!", LineAlign::Center});
    lines.push_back({"ƏDV", LineAlign::Center});
    lines.push_back({"Neftçilər prospekti", LineAlign::Center});
    lines.push_back({"Leyla Əliyeva", LineAlign::Center});
    lines.push_back({layout::renderSeparator('-', width)});

    lines.push_back({"Qiymət formatı", LineAlign::Center});
    for (Money amount : {Money{0}, Money{500}, Money{3200}, Money{15600}, Money{20249}}) {
        lines.push_back({layout::renderKeyValue("", money(amount), width), LineAlign::Right});
    }
    lines.push_back({layout::renderSeparator('-', width)});

    lines.push_back({"Hizalanma", LineAlign::Center});
    lines.push_back({layout::renderKeyValue("Sol", "Sağ", width)});
    for (const auto& wrapped :
         layout::wrapText("Uzun məhsul adı və wrap testi üçün nümunə sətir",
                          width - 10)) {
        lines.push_back({"    " + wrapped});
    }
    lines.push_back({layout::renderKeyValue("    davamı", money(99999), width)});
    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue("YEKUN", money(20249), width), LineAlign::Left, true});
    lines.push_back({layout::renderSeparator('=', width)});

    if (config.printQr) {
        lines.push_back({""});
        lines.push_back({"QR test", LineAlign::Center});
        lines.push_back({"", LineAlign::Center, false, false, true});
    }
    return lines;
}

ReceiptSettings ReceiptBuilder::settings() {
    double mm = 80;
    try { mm = std::stod(ctx_.setting("printer.paperWidth", "80")); } catch (...) {}
    if (!std::isfinite(mm) || mm < 40 || mm > 120) mm = 80;
    return settings(paperWidthFromMm(mm));
}

ReceiptSettings ReceiptBuilder::settings(PaperWidth width) {
    ReceiptSettings config;
    config.paperWidth = width;
    config.paperWidthMm = paperWidthMm(width);
    config.paperWidth.dpi = static_cast<int>(ctx_.settingInt("printer.dpi", 203));
    // Stored calibration belongs to the selected paper only.
    double storedMm = 80;
    try { storedMm = std::stod(ctx_.setting("printer.paperWidth", "80")); } catch (...) {}
    if (std::abs(storedMm - width.mm) < 0.01)
        config.paperWidth.printableDots = static_cast<int>(ctx_.settingInt("printer.printableDots", 0));
    (void)printableDotWidth(config.paperWidth);

    const std::string columnKey =
        width == PaperWidth::Mm58 ? "printer.charsPerLine58" : width == PaperWidth::Mm80 ? "printer.charsPerLine80" : "printer.charsPerLine";
    config.charsPerLine = static_cast<int>(
        ctx_.settingInt(columnKey, defaultCharsPerLine(width)));
    if (config.charsPerLine < 16 || config.charsPerLine > 96) {
        config.charsPerLine = defaultCharsPerLine(width);
    }

    config.fontHeightPx = static_cast<int>(ctx_.settingInt("printer.fontHeightPx", 32));
    config.fontWidthPx = static_cast<int>(ctx_.settingInt("printer.fontWidthPx", 14));
    config.sideMarginPx = static_cast<int>(ctx_.settingInt("printer.sideMarginPx", 2));
    if (config.fontHeightPx < 0 || config.fontHeightPx > 96) config.fontHeightPx = 32;
    if (config.fontWidthPx < 0 || config.fontWidthPx > 64) config.fontWidthPx = 14;
    if (config.sideMarginPx < 0 || config.sideMarginPx > 80) config.sideMarginPx = 2;

    config.renderMode = renderModeFromString(ctx_.setting("printer.renderMode", "auto"));
    config.currencyDisplay =
        currencyDisplayFromString(ctx_.setting("locale.currencyDisplay", "symbol"));
    config.currencyCode = ctx_.setting("locale.currency", "AZN");
    config.printQr = ctx_.settingInt("printer.qr", 1) != 0;
    config.printItemUnitPrice = ctx_.settingInt("printer.printItemUnitPrice", 0) != 0;
    config.printModifierPrice = ctx_.settingInt("printer.printModifierPrice", 1) != 0;
    config.cutAfterPrint = ctx_.settingInt("printer.cut", 1) != 0;
    config.openCashDrawer = ctx_.settingInt("printer.openCashDrawer", 0) != 0;
    config.density = static_cast<int>(ctx_.settingInt("printer.density", 5));
    config.bottomFeedLines = static_cast<int>(ctx_.settingInt("printer.bottomFeedLines", 4));
    config.codePage = static_cast<int>(ctx_.settingInt("printer.codePage", 13));
    return config;
}

std::string ReceiptBuilder::receiptNumberFor(const std::string& orderId, const std::string& kind) {
    auto stmt = ctx_.db().prepare(
        "SELECT number FROM receipts WHERE order_id = :orderId AND kind = :kind "
        "ORDER BY created_at LIMIT 1");
    stmt.bind(":orderId", orderId).bind(":kind", kind);
    if (stmt.step()) {
        const std::string existing = stmt.columnText(0);
        if (!existing.empty()) return existing;
    }

    // The number on a paid receipt is how a guest who has left the building
    // gets their money back, so it has to identify exactly one sale. Eight
    // characters of a 32-letter alphabet collide about once in a trillion, but
    // "about" is not a thing to tell a guest holding a receipt: check.
    for (int attempt = 0; attempt < 8; ++attempt) {
        const std::string candidate = "R-" + crypto::shortCode(8);
        auto taken = ctx_.db().prepare("SELECT 1 FROM receipts WHERE number = :number LIMIT 1");
        taken.bind(":number", candidate);
        if (!taken.step()) return candidate;
    }
    // Eight collisions in a row is not chance; fall back to something that
    // cannot collide rather than looping forever at the counter.
    return "R-" + crypto::shortCode(8) + crypto::shortCode(4);
}

ReceiptDocument ReceiptBuilder::customerDocument(const std::string& orderId,
                                                 const ReceiptSettings& config, bool isReprint,
                                                 bool preliminaryBill) {
    services::OrderService orders(ctx_);
    const Json order = orders.load(orderId);

    ReceiptDocument doc;
    doc.kind = preliminaryBill ? ReceiptKind::CustomerBill : ReceiptKind::PaymentReceipt;
    doc.receiptNumber = receiptNumberFor(
        orderId, preliminaryBill ? "customer_bill" : "customer_receipt");
    doc.orderNumber = getOr<std::string>(order, "orderNumber", "");
    doc.tableName = getOr<std::string>(order, "tableLabel", "");
    doc.waiterName = getOr<std::string>(order, "waiterName", "");
    doc.guestCount = order.value("guestCount", std::int64_t{0});
    doc.openedAt = order.value("openedAt", nowMs());
    doc.terminalName = ctx_.terminalId();
    doc.isReprint = isReprint;

    doc.orderType = doc.tableName.empty() ? "takeaway" : "dine_in";

    const std::string tableId = getOr<std::string>(order, "tableId", "");
    if (!tableId.empty()) {
        auto area = ctx_.db().prepare(
            "SELECT a.name_az FROM restaurant_areas a "
            "JOIN restaurant_tables t ON t.area_id = a.id WHERE t.id = :tableId");
        area.bind(":tableId", tableId);
        if (area.step()) doc.areaName = area.columnText(0);
    }

    doc.restaurant.name = ctx_.setting("restaurant.name", "");
    doc.restaurant.tagline = ctx_.setting("restaurant.tagline", "");
    doc.restaurant.address = ctx_.setting("restaurant.address", "");
    doc.restaurant.phone = ctx_.setting("restaurant.phone", "");
    doc.restaurant.hours = ctx_.setting("restaurant.hours", "");
    doc.restaurant.taxId = ctx_.setting("restaurant.taxId", "");
    // A chain prints the same name on every receipt, so the branch is what tells
    // a guest - and a head office reading a returned receipt - which shop it is.
    // Folded into the tagline because the receipt header has no line of its own
    // and adding one would change every stored document's shape.
    {
        const std::string branch = ctx_.setting("branch.name", "");
        if (!branch.empty()) {
            doc.restaurant.tagline =
                doc.restaurant.tagline.empty() ? branch : doc.restaurant.tagline + " · " + branch;
        }
    }

    doc.locale = ctx_.setting("locale.default", "az-AZ");
    doc.currencyCode = config.currencyCode;
    doc.currencyDisplay = config.currencyDisplay;
    doc.paperWidth = config.paperWidth;
    doc.charsPerLine = config.charsPerLine;
    doc.printQr = config.printQr;
    doc.printItemUnitPrice = config.printItemUnitPrice;
    doc.printModifierPrice = config.printModifierPrice;

    // ------------------------------------------------------------------ items
    //
    // The stored pricing model is: line_total_minor = (unit_price_minor +
    // sum(price_delta_minor)) * quantity. The receipt therefore shows the base
    // price on the item row and each surcharge on its own row; adding those rows
    // reproduces line_total_minor exactly, and summing the lines reproduces the
    // stored subtotal. No amount is displayed twice.
    for (const auto& line : order["items"]) {
        ReceiptItem item;
        item.id = getOr<std::string>(line, "id", "");
        item.name = getOr<std::string>(line, "name", "");
        item.quantity = line.value("quantity", std::int64_t{1});
        item.unitBasePrice = line.value("unitPriceMinor", Money{0});
        item.baseLineTotal = item.unitBasePrice * item.quantity;
        item.notes = getOr<std::string>(line, "note", "");
        item.voided = getOr<std::string>(line, "status", "") == "voided";
        item.complimentary = line.value("complimentary", std::int64_t{0}) != 0;
        item.itemLineTotal = line.value("lineTotalMinor", Money{0});

        if (line.contains("modifiers")) {
            for (const auto& raw : line["modifiers"]) {
                ReceiptModifier modifier;
                modifier.name = getOr<std::string>(raw, "name", "");
                modifier.quantity = item.quantity;
                modifier.unitPrice = raw.value("priceDeltaMinor", Money{0});
                modifier.lineTotal = modifier.unitPrice * item.quantity;
                modifier.isFree = modifier.unitPrice == 0;
                modifier.isIncludedInParentPrice = false;
                item.modifiers.push_back(std::move(modifier));
            }
        }

        doc.items.push_back(std::move(item));
    }

    // ----------------------------------------------------------------- totals
    doc.subtotal = order.value("subtotalMinor", Money{0});
    doc.discountTotal = order.value("discountMinor", Money{0});
    doc.serviceCharge = order.value("serviceMinor", Money{0});
    doc.depositTotal = order.value("depositMinor", Money{0});
    doc.depositLabel = "Depozit";
    doc.grandTotal = order.value("totalMinor", Money{0});
    doc.amountPaid = order.value("paidMinor", Money{0});
    doc.tipTotal = order.value("tipMinor", Money{0});
    doc.remainingAmount = std::max<Money>(0, doc.grandTotal - doc.amountPaid);

    const auto servicePercent = ctx_.settingInt("finance.servicePercent", 10);
    if (doc.serviceCharge > 0) {
        doc.serviceLabel = "Servis haqqı (" + std::to_string(servicePercent) + "%)";
    }
    const std::string discountType = getOr<std::string>(order, "discountType", "");
    if (doc.discountTotal > 0) {
        doc.discountLabel =
            discountType == "percent"
                ? "Endirim (" + std::to_string(order.value("discountValue", std::int64_t{0})) + "%)"
                : "Endirim";
    }

    const Money tax = order.value("taxMinor", Money{0});
    doc.taxTotal = tax;
    if (tax > 0) {
        ReceiptTaxLine line;
        line.label = "ƏDV (" + std::to_string(ctx_.settingInt("finance.taxPercent", 18)) + "%)";
        line.amount = tax;
        line.included = ctx_.settingInt("finance.taxIncluded", 0) != 0;
        doc.taxes.push_back(std::move(line));
    }

    // --------------------------------------------------------------- payments
    for (const auto& payment : order["payments"]) {
        if (getOr<std::string>(payment, "status", "") != "approved") continue;

        ReceiptPayment entry;
        entry.method = getOr<std::string>(payment, "method", "");
        entry.label = paymentLabel(payment);
        entry.amount = payment.value("amountMinor", Money{0});
        entry.tendered = payment.value("tenderedMinor", Money{0});
        entry.change = payment.value("changeMinor", Money{0});
        doc.changeAmount += entry.change;
        // The receipt is dated by the payment that settled it.
        doc.paidAt = std::max(doc.paidAt, payment.value("createdAt", Timestamp{0}));
        doc.payments.push_back(std::move(entry));
    }

    doc.footer = {"Təşəkkür edirik!", "Sizi yenidən gözləyirik.", doc.restaurant.name};
    doc.qrPayload = config.printQr ? buildQrPayload(doc, ctx_.setting("receipt.verifyUrl", ""),
                                                    ctx_.setting("receipt.qrUrl", ""))
                                   : "";

    return doc;
}

std::string ReceiptBuilder::logoPngBase64() {
    const std::string dataUrl = ctx_.setting("printer.logoDataUrl", "");
    const auto comma = dataUrl.find(',');
    if (dataUrl.rfind("data:image/", 0) != 0 || comma == std::string::npos) return {};
    return dataUrl.substr(comma + 1);
}

MonoBitmap ReceiptBuilder::logoBitmap() {
    const std::string raw = ctx_.setting("printer.logoRaster", "");
    if (raw.empty()) return {};

    // Written by the settings screen, which already knows the head width and
    // does the thresholding on a canvas - the core has no image decoder and
    // does not need one.
    Json spec;
    try {
        spec = Json::parse(raw);
    } catch (const std::exception&) {
        logger()->warn("printer.logoRaster is not valid JSON; printing without a logo");
        return {};
    }
    if (!spec.is_object()) return {};

    MonoBitmap bitmap;
    bitmap.width = getOr<int>(spec, "w", 0);
    bitmap.height = getOr<int>(spec, "h", 0);
    const std::string hex = getOr<std::string>(spec, "hex", "");
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width > 2048 || bitmap.height > 2048 || hex.empty()) return {};

    bitmap.stride = (bitmap.width + 7) / 8;
    const std::size_t expected = static_cast<std::size_t>(bitmap.stride) *
                                 static_cast<std::size_t>(bitmap.height);
    if (hex.size() != expected * 2) {
        logger()->warn("printer.logoRaster is {} hex chars, expected {}", hex.size(),
                       expected * 2);
        return {};
    }

    const auto nibble = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    bitmap.bits.resize(expected);
    for (std::size_t i = 0; i < expected; ++i) {
        const int hi = nibble(hex[i * 2]);
        const int lo = nibble(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) {
            logger()->warn("printer.logoRaster contains a non-hex character");
            return {};
        }
        bitmap.bits[i] = static_cast<std::uint8_t>((hi << 4) | lo);
    }
    return bitmap;
}

std::string ReceiptBuilder::formatMoney(Money minor) {
    const auto config = settings();
    return printing::formatMoney(minor, config.currencyCode, config.currencyDisplay);
}

RenderedReceipt ReceiptBuilder::customerReceipt(const std::string& orderId) {
    return customerReceipt(orderId, settings(), false);
}

RenderedReceipt ReceiptBuilder::customerReceipt(const std::string& orderId,
                                                const ReceiptSettings& config, bool isReprint) {
    const ReceiptDocument doc = customerDocument(orderId, config, isReprint);

    RenderedReceipt receipt;
    receipt.number = doc.receiptNumber;
    receipt.totalMinor = doc.grandTotal;
    receipt.text = renderPlainText(doc);
    receipt.data = doc.toJson();
    receipt.data["renderMode"] = renderModeToString(config.renderMode);
    receipt.data["printedAt"] = nowMs();
    return receipt;
}

RenderedReceipt ReceiptBuilder::kitchenTicket(const std::string& orderId) {
    services::OrderService orders(ctx_);
    Json order = orders.load(orderId);

    const auto config = settings();
    const int width = config.charsPerLine;

    RenderedReceipt receipt;
    receipt.number = "K-" + crypto::shortCode(6);

    std::ostringstream out;
    out << layout::centerColumn("*** MƏTBƏX ***", width) << "\n";
    out << layout::renderSeparator('=', width) << "\n";
    out << layout::renderKeyValue(
               "Masa: " + getOr<std::string>(order, "tableLabel", "-"),
               getOr<std::string>(order, "orderNumber", ""), width)
        << "\n";
    out << layout::renderKeyValue(
               "Ofisiant: " + getOr<std::string>(order, "waiterName", "-"),
                                  formatTimestamp(nowMs()), width)
        << "\n";
    out << layout::renderSeparator('=', width) << "\n";

    for (const auto& item : order["items"]) {
        const auto status = getOr<std::string>(item, "status", "");
        // Only lines that have actually been sent belong on the pass.
        if (status == "voided" || status == "draft" || status == "held") continue;

        out << "\n";
        for (const auto& line :
             layout::wrapText(std::to_string(item.value("quantity", 1)) + " x " +
                                  getOr<std::string>(item, "name", ""),
                              width)) {
            out << line << "\n";
        }

        for (const auto& modifier : item["modifiers"]) {
            out << "     > " << getOr<std::string>(modifier, "name", "") << "\n";
        }

        const std::string note = getOr<std::string>(item, "note", "");
        if (!note.empty()) out << "     ! " << note << "\n";

        if (!item.value("seat", Json()).is_null()) {
            out << "     Yer: " << item.value("seat", 0) << "\n";
        }
        const std::string course = getOr<std::string>(item, "course", "");
        if (!course.empty()) out << "     Kurs: " << course << "\n";
    }

    out << "\n" << layout::renderSeparator('=', width) << "\n";
    out << layout::centerColumn(receipt.number, width) << "\n";

    receipt.text = out.str();
    receipt.data = Json{{"kind", "kitchen_ticket"},
                        {"number", receipt.number},
                        {"charsPerLine", width},
                        {"order", order}};
    return receipt;
}

RenderedReceipt ReceiptBuilder::shiftReport(const std::string& shiftId) {
    const auto config = settings();
    const int width = config.charsPerLine;
    const auto money = [&](Money minor) {
        return printing::formatMoney(minor, config.currencyCode, config.currencyDisplay);
    };

    RenderedReceipt receipt;
    receipt.number = "S-" + crypto::shortCode(6);

    auto shift = ctx_.db().prepare(
        "SELECT s.opened_at, s.closed_at, s.opening_float_minor, s.closing_cash_minor, "
        "       u.full_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = :shiftId");
    shift.bind(":shiftId", shiftId);
    if (!shift.step()) throw PosError::of(protocol::err::kNotFound);

    auto totals = ctx_.db().prepare(
        "SELECT COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount_minor ELSE 0 END), 0), "
        "       COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_minor ELSE 0 END), 0), "
        "       COALESCE(SUM(p.tip_minor), 0), COUNT(*) "
        "FROM payments p WHERE p.shift_id = :shiftId AND p.status = 'approved'");
    totals.bind(":shiftId", shiftId);
    totals.step();

    const Money cash = totals.columnInt(0);
    const Money card = totals.columnInt(1);
    const Money tips = totals.columnInt(2);
    const auto count = totals.columnInt(3);

    std::ostringstream out;
    out << layout::centerColumn(ctx_.setting("restaurant.name", ""), width)
        << "\n";
    out << layout::centerColumn("NÖVBƏ HESABATI", width) << "\n";
    out << layout::renderSeparator('=', width) << "\n";
    out << layout::renderKeyValue("İşçi:", shift.columnText(4), width) << "\n";
    out << layout::renderKeyValue("Açılış:", formatTimestamp(shift.columnInt(0)), width) << "\n";
    if (!shift.columnIsNull(1)) {
        out << layout::renderKeyValue("Bağlanış:", formatTimestamp(shift.columnInt(1)), width)
            << "\n";
    }
    out << layout::renderSeparator('-', width) << "\n";
    out << layout::renderKeyValue("Nağd satış", money(cash), width) << "\n";
    out << layout::renderKeyValue("Kart satış", money(card), width) << "\n";
    out << layout::renderKeyValue("Bəxşiş", money(tips), width) << "\n";
    out << layout::renderKeyValue("Əməliyyat sayı", std::to_string(count), width) << "\n";
    out << layout::renderSeparator('=', width) << "\n";
    out << layout::renderKeyValue("CƏMİ", money(cash + card), width) << "\n";

    receipt.text = out.str();
    receipt.totalMinor = cash + card;
    receipt.data = Json{{"kind", "shift_report"},
                        {"number", receipt.number},
                        {"charsPerLine", width},
                        {"cashMinor", cash},
                        {"cardMinor", card},
                        {"tipsMinor", tips},
                        {"transactionCount", count}};
    return receipt;
}

/**
 * What came in the door, printed where the goods are.
 *
 * A restaurant with a store room has a printer in it, and until now nothing
 * was addressed to that printer - every document that was not a kitchen ticket
 * went to the till. So the person checking a delivery against the invoice had
 * to walk to the till, or work from the supplier's own paper and trust it.
 *
 * Printed on receipt, and reprintable: the copy that matters is the one that
 * gets signed and filed, and those go missing.
 */
RenderedReceipt ReceiptBuilder::warehouseSlip(const std::string& purchaseId) {
    const auto config = settings();
    const int width = config.charsPerLine;
    const auto money = [&](Money minor) {
        return printing::formatMoney(minor, config.currencyCode, config.currencyDisplay);
    };

    auto head = ctx_.db().prepare(
        "SELECT p.number, p.status, p.total_minor, p.received_at, p.created_at, "
        "       s.name, w.name, u.full_name "
        "FROM purchase_orders p "
        "LEFT JOIN suppliers s ON s.id = p.supplier_id "
        "LEFT JOIN warehouses w ON w.id = p.warehouse_id "
        "LEFT JOIN users u ON u.id = p.actor_user_id "
        "WHERE p.id = :id");
    head.bind(":id", purchaseId);
    if (!head.step()) throw PosError::of(protocol::err::kNotFound);

    const std::string reference = head.columnText(0);
    const std::string status = head.columnText(1);
    const Money total = head.columnInt(2);
    const Timestamp receivedAt = head.columnIsNull(3) ? head.columnInt(4) : head.columnInt(3);
    const std::string supplierName = head.columnText(5);
    const std::string warehouseName = head.columnText(6);
    const std::string actorName = head.columnText(7);

    RenderedReceipt receipt;
    receipt.number = "M-" + crypto::shortCode(6);
    receipt.totalMinor = total;

    std::vector<ReceiptLine> lines;
    const std::string venue = ctx_.setting("restaurant.name", "");
    if (!venue.empty()) lines.push_back({venue, LineAlign::Center, true});
    lines.push_back({"MAL QƏBULU", LineAlign::Center, true});
    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue("Tarix:", formatTimestamp(receivedAt), width)});
    lines.push_back({layout::renderKeyValue("Sənəd №:", receipt.number, width)});
    if (!reference.empty()) {
        lines.push_back({layout::renderKeyValue("Alış:", reference, width)});
    }
    if (!supplierName.empty()) {
        lines.push_back({layout::renderKeyValue("Təchizatçı:", supplierName, width)});
    }
    if (!warehouseName.empty()) {
        lines.push_back({layout::renderKeyValue("Anbar:", warehouseName, width)});
    }
    if (!actorName.empty()) {
        lines.push_back({layout::renderKeyValue("Qəbul edən:", actorName, width)});
    }
    lines.push_back({layout::renderSeparator('-', width)});

    Json items = Json::array();
    {
        auto rows = ctx_.db().prepare(
            "SELECT i.name, i.unit, oi.qty_milli, oi.line_total_minor "
            "FROM purchase_order_items oi "
            "LEFT JOIN ingredients i ON i.id = oi.ingredient_id "
            "WHERE oi.purchase_id = :id ORDER BY oi.rowid");
        rows.bind(":id", purchaseId);
        while (rows.step()) {
            const std::string name = rows.columnText(0);
            const std::string unit = rows.columnText(1);
            const auto qtyMilli = rows.columnInt(2);
            const Money lineTotal = rows.columnInt(3);
            // Quantities are stored in thousandths; a store room counts in the
            // unit written on the box, so it is printed that way.
            const auto whole = qtyMilli / 1000;
            const auto frac = (qtyMilli % 1000) / 100;
            const std::string qty =
                std::to_string(whole) + (frac > 0 ? "." + std::to_string(frac) : "") +
                (unit.empty() ? "" : " " + unit);

            lines.push_back({name});
            lines.push_back({layout::renderKeyValue("  " + qty, money(lineTotal), width)});
            items.push_back(Json{{"name", name}, {"qtyMilli", qtyMilli}, {"unit", unit},
                                 {"lineTotalMinor", lineTotal}});
        }
    }

    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue("CƏMİ", money(total), width), LineAlign::Left, true});
    lines.push_back({""});
    // Somewhere to sign. A delivery note that nobody signed settles no argument
    // with a supplier later.
    lines.push_back({layout::renderKeyValue("Təhvil verdi:", "____________", width)});
    lines.push_back({layout::renderKeyValue("Təhvil aldı:", "____________", width)});

    receipt.lines = lines;
    receipt.text = renderPlainText(lines, width);
    receipt.data = Json{{"kind", "warehouse_slip"},
                        {"number", receipt.number},
                        {"charsPerLine", width},
                        {"purchaseId", purchaseId},
                        {"reference", reference},
                        {"status", status},
                        {"supplier", supplierName},
                        {"warehouse", warehouseName},
                        {"totalMinor", total},
                        {"items", items},
                        {"receivedAt", receivedAt}};
    return receipt;
}

/**
 * The slip a guest is handed when money goes back.
 *
 * `refund_receipt` has been a valid print kind since the refund schema landed
 * and nothing ever rendered one, so a refund left the guest with nothing but
 * the original receipt - which still says they paid. This is the paper that
 * says otherwise: what went back, off which sale, why, and who approved it.
 *
 * It names the original receipt code on purpose. That is the number on the
 * paper in the guest's hand, and it is how a dispute a week later is settled
 * without anyone searching a database.
 */
RenderedReceipt ReceiptBuilder::refundReceipt(const std::string& refundId) {
    const auto config = settings();
    const int width = config.charsPerLine;
    const auto money = [&](Money minor) {
        return printing::formatMoney(minor, config.currencyCode, config.currencyDisplay);
    };

    auto refund = ctx_.db().prepare(
        "SELECT r.order_id, r.payment_id, r.amount_minor, r.reason, r.method, r.created_at, "
        "       u.full_name, a.full_name, o.order_number "
        "FROM refunds r "
        "LEFT JOIN users u ON u.id = r.actor_user_id "
        "LEFT JOIN users a ON a.id = r.approved_by "
        "LEFT JOIN orders o ON o.id = r.order_id "
        "WHERE r.id = :refundId");
    refund.bind(":refundId", refundId);
    if (!refund.step()) throw PosError::of(protocol::err::kNotFound);

    const std::string orderId = refund.columnText(0);
    const Money amount = refund.columnInt(2);
    const std::string reason = refund.columnText(3);
    const std::string method = refund.columnText(4);
    const Timestamp createdAt = refund.columnInt(5);
    const std::string actorName = refund.columnText(6);
    const std::string approverName = refund.columnText(7);
    const std::string orderNumber = refund.columnText(8);

    // The code printed on the guest's own copy, so the two pieces of paper can
    // be matched by eye.
    std::string originalCode;
    {
        auto original = ctx_.db().prepare(
            "SELECT number FROM receipts WHERE order_id = :orderId AND kind = 'customer_receipt' "
            "ORDER BY created_at LIMIT 1");
        original.bind(":orderId", orderId);
        if (original.step()) originalCode = original.columnText(0);
    }

    RenderedReceipt receipt;
    receipt.number = "Q-" + crypto::shortCode(6);
    receipt.totalMinor = amount;

    std::vector<ReceiptLine> lines;
    const std::string venue = ctx_.setting("restaurant.name", "");
    if (!venue.empty()) lines.push_back({venue, LineAlign::Center, true});
    lines.push_back({"GERİ QAYTARMA", LineAlign::Center, true});
    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue("Tarix:", formatTimestamp(createdAt), width)});
    lines.push_back({layout::renderKeyValue("Qaytarma №:", receipt.number, width)});
    if (!orderNumber.empty()) {
        lines.push_back({layout::renderKeyValue("Sifariş:", orderNumber, width)});
    }
    if (!originalCode.empty()) {
        lines.push_back({layout::renderKeyValue("Əsas çek:", originalCode, width)});
    }
    if (!actorName.empty()) {
        lines.push_back({layout::renderKeyValue("Kassir:", actorName, width)});
    }
    if (!approverName.empty()) {
        lines.push_back({layout::renderKeyValue("Təsdiq:", approverName, width)});
    }
    lines.push_back({layout::renderSeparator('-', width)});

    // Which dishes went back, when the refund named lines rather than a sum.
    Json returned = Json::array();
    {
        auto items = ctx_.db().prepare(
            "SELECT name_snapshot, quantity, amount_minor FROM refund_items "
            "WHERE refund_id = :refundId ORDER BY rowid");
        items.bind(":refundId", refundId);
        while (items.step()) {
            const std::string name = items.columnText(0);
            const auto quantity = items.columnInt(1);
            const Money lineAmount = items.columnInt(2);
            lines.push_back({layout::renderKeyValue(
                std::to_string(quantity) + " x " + name, money(lineAmount), width)});
            returned.push_back(Json{{"name", name},
                                    {"quantity", quantity},
                                    {"amountMinor", lineAmount}});
        }
    }
    if (returned.empty()) {
        lines.push_back({layout::renderKeyValue("Məbləğ üzrə qaytarma", money(amount), width)});
    }

    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue("QAYTARILAN", money(amount), width), LineAlign::Left, true});
    lines.push_back({layout::renderKeyValue(
        "Üsul:", method == "cash" ? "Nağd" : (method == "card" ? "Kart" : method), width)});
    if (!reason.empty()) {
        lines.push_back({layout::renderSeparator('-', width)});
        for (const auto& wrapped : layout::wrapText("Səbəb: " + reason, width)) {
            lines.push_back({wrapped});
        }
    }
    lines.push_back({""});
    for (const auto& wrapped : layout::wrapText(
             "Bu qəbz geri qaytarmanın sənədidir. Zəhmət olmasa saxlayın.", width)) {
        lines.push_back({wrapped, LineAlign::Center});
    }

    receipt.lines = lines;
    receipt.text = renderPlainText(lines, width);
    receipt.data = Json{{"kind", "refund_receipt"},
                        {"number", receipt.number},
                        {"charsPerLine", width},
                        {"refundId", refundId},
                        {"orderId", orderId},
                        {"originalReceiptNumber", originalCode},
                        {"amountMinor", amount},
                        {"method", method},
                        {"reason", reason},
                        {"items", returned},
                        {"createdAt", createdAt}};
    return receipt;
}

/** "07.08.2026 08:00 – 09:00" — the range, in the words the operator typed. */
namespace {
std::string formatRange(Timestamp from, Timestamp to) {
    const auto part = [](Timestamp ms, const char* fmt) {
        const std::time_t seconds = static_cast<std::time_t>(ms / 1000);
        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &seconds);
#else
        localtime_r(&seconds, &tm);
#endif
        std::ostringstream out;
        out << std::put_time(&tm, fmt);
        return out.str();
    };
    const std::string fromDay = part(from, "%d.%m.%Y");
    const std::string toDay = part(to, "%d.%m.%Y");
    // Same day is the common case and reads better without repeating the date.
    if (fromDay == toDay) {
        return fromDay + "  " + part(from, "%H:%M") + " - " + part(to, "%H:%M");
    }
    return part(from, "%d.%m.%Y %H:%M") + " - " + part(to, "%d.%m.%Y %H:%M");
}
}  // namespace

RenderedReceipt ReceiptBuilder::periodReport(Timestamp from, Timestamp to) {
    const auto config = settings();
    const int width = config.charsPerLine;
    const auto money = [&](Money minor) {
        return printing::formatMoney(minor, config.currencyCode, CurrencyDisplay::Symbol);
    };

    const Json canonical = services::ReportService(ctx_).periodSummary(from, to);
    const Json& sales = canonical["sales"];

    Money cash = 0;
    Money card = 0;
    Money other = 0;
    for (const auto& row : sales["byMethod"]) {
        const auto method = getOr<std::string>(row, "method", "");
        const Money total = getOr<Money>(row, "totalMinor", 0);
        if (method == "cash") cash += total;
        else if (method == "card") card += total;
        else other += total;
    }

    const Money gross = getOr<Money>(sales, "grossMinor", 0);
    const Money refunds = getOr<Money>(sales, "refundMinor", 0);
    const Money net = getOr<Money>(sales, "netMinor", gross - refunds);
    const Money tips = getOr<Money>(sales, "tipsMinor", 0);
    const auto orderCount = getOr<std::int64_t>(canonical["orders"], "count", 0);
    const Money average = getOr<Money>(canonical["orders"], "averageMinor", 0);

    const std::string name = ctx_.setting("restaurant.name", "");
    const std::string phone = ctx_.setting("restaurant.phone", "");
    const std::string address = ctx_.setting("restaurant.address", "");

    std::vector<ReceiptLine> lines;
    lines.push_back({name, LineAlign::Center, true, true});
    if (!phone.empty()) lines.push_back({phone, LineAlign::Center});
    if (!address.empty()) lines.push_back({address, LineAlign::Center});
    lines.push_back({"ARALIQ HESABAT", LineAlign::Center, true});
    lines.push_back({formatRange(from, to), LineAlign::Center});
    lines.push_back({layout::renderSeparator('=', width)});
    lines.push_back({layout::renderKeyValue("Çap:", formatTimestamp(nowMs()), width)});
    lines.push_back({layout::renderSeparator('-', width)});
    lines.push_back({layout::renderKeyValue("Nağd", money(cash), width)});
    lines.push_back({layout::renderKeyValue("Kart", money(card), width)});
    if (other > 0) lines.push_back({layout::renderKeyValue("Digər", money(other), width)});
    lines.push_back({layout::renderSeparator('-', width)});
    lines.push_back({layout::renderKeyValue("Ümumi satış", money(gross), width)});
    if (refunds > 0) {
        lines.push_back({layout::renderKeyValue("Geri ödəniş", money(refunds), width)});
        lines.push_back({layout::renderKeyValue("Xalis", money(net), width)});
    }
    if (tips > 0) lines.push_back({layout::renderKeyValue("Bəxşiş", money(tips), width)});
    lines.push_back({layout::renderKeyValue("Ödənişli sifariş", std::to_string(orderCount), width)});
    if (orderCount > 0) {
        lines.push_back({layout::renderKeyValue("Orta çek", money(average), width)});
    }

    const Json& categories = canonical["byCategory"];
    if (categories.is_array() && !categories.empty()) {
        lines.push_back({layout::renderSeparator('-', width)});
        lines.push_back({"Kateqoriyalar", LineAlign::Left, true});
        for (const auto& row : categories) {
            const auto label = getOr<std::string>(row, "category", "-");
            lines.push_back({layout::renderKeyValue(
                label, money(getOr<Money>(row, "revenueMinor", 0)), width)});
        }
    }

    lines.push_back({layout::renderSeparator('=', width)});
    // Says what it is. An operator handed a slip full of totals will otherwise
    // file it as an X report, and it is not one.
    lines.push_back({"Bu sənəd məlumat üçündür.", LineAlign::Center});
    lines.push_back({"Rəsmi X/Z hesabat deyil.", LineAlign::Center});

    RenderedReceipt receipt;
    receipt.number = "P-" + crypto::uuid4().substr(0, 8);
    receipt.lines = std::move(lines);
    receipt.text = renderPlainText(receipt.lines, width);
    receipt.qrPayload = "";
    receipt.totalMinor = gross;
    receipt.data = Json{{"kind", "period_report"},
                        {"number", receipt.number},
                        {"charsPerLine", width},
                        {"from", from},
                        {"to", to},
                        {"cashMinor", cash},
                        {"cardMinor", card},
                        {"otherMinor", other},
                        {"grossMinor", gross},
                        {"netMinor", net},
                        {"canonical", canonical}};
    return receipt;
}

RenderedReceipt ReceiptBuilder::xzReport(const Json& canonical, const std::string& kind) {
    const auto config = settings();
    const int width = config.charsPerLine;
    // Reports always show the manat sign so thermal raster never prints "?".
    const auto money = [&](Money minor) {
        return printing::formatMoney(minor, config.currencyCode, CurrencyDisplay::Symbol);
    };

    Money cash = 0;
    Money card = 0;
    Money other = 0;
    if (canonical.contains("sales") && canonical["sales"].contains("byMethod") &&
        canonical["sales"]["byMethod"].is_array()) {
        for (const auto& row : canonical["sales"]["byMethod"]) {
            const auto method = getOr<std::string>(row, "method", "");
            const Money total = getOr<Money>(row, "totalMinor", 0);
            if (method == "cash") cash += total;
            else if (method == "card") card += total;
            else other += total;
        }
    }

    const Money gross = getOr<Money>(canonical["sales"], "grossMinor", cash + card + other);
    const Money refunds = getOr<Money>(canonical["sales"], "refundMinor", 0);
    const Money net = getOr<Money>(canonical["sales"], "netMinor", gross - refunds);
    const Money openTablesTotal = getOr<Money>(canonical, "openTablesTotalMinor", 0);
    const auto openTableCount = getOr<std::int64_t>(canonical, "openTableCount", 0);
    const auto businessDate = getOr<std::string>(canonical, "businessDate", "");
    const auto seq = getOr<std::int64_t>(canonical, "sequenceNo", 0);
    const bool isZ = kind == "z" || kind == "z_report";

    const std::string name = ctx_.setting("restaurant.name", "");
    const std::string phone = ctx_.setting("restaurant.phone", "");
    const std::string address = ctx_.setting("restaurant.address", "");
    const std::string hours = ctx_.setting("restaurant.hours", "");
    const Money expectedTotal = gross + openTablesTotal;

    std::vector<ReceiptLine> lines;
    lines.push_back({name, LineAlign::Center, true, true});
    if (!phone.empty()) lines.push_back({phone, LineAlign::Center});
    if (!address.empty()) lines.push_back({address, LineAlign::Center});
    if (!hours.empty()) lines.push_back({"İş saatı: " + hours, LineAlign::Center});
    lines.push_back({isZ ? "Z HESABAT (GÜN SONU)" : "X HESABAT", LineAlign::Center, true});
    lines.push_back({layout::renderSeparator('=', width)});
    // No business-date row: "Vaxt" already carries the date, and the moment the
    // report was taken is what the operator actually needs.
    lines.push_back({layout::renderKeyValue("Vaxt:", formatTimestamp(nowMs()), width)});
    if (seq > 0) {
        lines.push_back({layout::renderKeyValue("Sıra:", std::to_string(seq), width)});
    }
    lines.push_back({layout::renderSeparator('-', width)});
    lines.push_back({layout::renderKeyValue("Nağd", money(cash), width)});
    lines.push_back({layout::renderKeyValue("Kart", money(card), width)});
    if (other > 0) {
        lines.push_back({layout::renderKeyValue("Digər", money(other), width)});
    }
    lines.push_back({layout::renderSeparator('-', width)});
    lines.push_back({layout::renderKeyValue("Ümumi satış", money(gross), width)});
    if (refunds > 0) {
        lines.push_back({layout::renderKeyValue("Geri ödəniş", money(refunds), width)});
        lines.push_back({layout::renderKeyValue("Xalis", money(net), width)});
    }
    if (!isZ) {
        lines.push_back({layout::renderKeyValue(
            "Açıq masalar (" + std::to_string(openTableCount) + ")",
            money(openTablesTotal), width)});
        lines.push_back({layout::renderSeparator('-', width)});
        lines.push_back({layout::renderKeyValue("Gözlənilən ümumi məbləğ",
                                                money(expectedTotal), width)});
    }
    lines.push_back({layout::renderSeparator('=', width)});
    if (isZ) {
        lines.push_back({"Gün bağlandı", LineAlign::Center, true});
        lines.push_back({"Məlumat saxlanıldı", LineAlign::Center});
    }
    // Scanning takes the guest to the venue on the map. Falls back to the phone
    // number only if no place URL is configured.
    const std::string placeUrl = ctx_.setting("receipt.qrUrl", "");
    const std::string qrPayload = placeUrl;

    if (config.printQr && !qrPayload.empty()) {
        lines.push_back({"", LineAlign::Left});
        if (!address.empty()) lines.push_back({address, LineAlign::Center});
        lines.push_back({"", LineAlign::Center, false, false, true});  // QR marker
    }

    RenderedReceipt receipt;
    receipt.number = (isZ ? "Z-" : "X-") + crypto::uuid4().substr(0, 8);
    receipt.lines = std::move(lines);
    receipt.text = renderPlainText(receipt.lines, width);
    receipt.qrPayload = config.printQr ? qrPayload : "";
    receipt.totalMinor = gross;
    receipt.data = Json{{"kind", isZ ? "z_report" : "x_report"},
                        {"number", receipt.number},
                        {"charsPerLine", width},
                        {"cashMinor", cash},
                        {"cardMinor", card},
                        {"otherMinor", other},
                        {"grossMinor", gross},
                        {"netMinor", net},
                        {"openTableCount", openTableCount},
                        {"openTablesTotalMinor", openTablesTotal},
                        {"expectedTotalMinor", expectedTotal},
                        {"phone", phone},
                        {"canonical", canonical}};
    return receipt;
}

std::string storeReceipt(handlers::Context& ctx, const std::string& orderId,
                         const std::string& kind, const RenderedReceipt& receipt) {
    const std::string receiptId = crypto::uuid4();

    auto stmt = ctx.db().prepare(
        "INSERT INTO receipts (id, order_id, kind, number, content_text, content_json, "
        "        total_minor, created_at) "
        "VALUES (:id, :orderId, :kind, :number, :text, :json, :total, :now)");
    stmt.bind(":id", receiptId)
        .bindOptional(":orderId", orderId)
        .bind(":kind", kind)
        .bind(":number", receipt.number)
        .bind(":text", receipt.text)
        .bind(":json", serialize(receipt.data))
        .bind(":total", receipt.totalMinor)
        .bind(":now", nowMs());
    stmt.exec();

    return receiptId;
}

}  // namespace pos::printing
