#include "pos/printing/ReceiptFormatter.hpp"
#include "pos/printing/ReceiptGraphics.hpp"

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <sstream>


namespace pos::printing {
namespace layout {
namespace {

bool isContinuation(unsigned char c) { return (c & 0xC0) == 0x80; }

}  // namespace

int visibleWidth(const std::string& text) {
    int width = 0;
    for (unsigned char c : text) {
        if (!isContinuation(c)) width++;
    }
    return width;
}

std::string slice(const std::string& text, int startCp, int lengthCp) {
    if (lengthCp <= 0) return {};

    int cp = -1;
    std::size_t begin = std::string::npos;
    std::size_t end = text.size();

    for (std::size_t i = 0; i < text.size(); ++i) {
        if (isContinuation(static_cast<unsigned char>(text[i]))) continue;
        cp++;
        if (cp == startCp) begin = i;
        if (cp == startCp + lengthCp) {
            end = i;
            break;
        }
    }

    if (begin == std::string::npos) return {};
    return text.substr(begin, end - begin);
}

std::string padLeft(const std::string& text, int width) {
    const int pad = width - visibleWidth(text);
    return pad > 0 ? std::string(static_cast<std::size_t>(pad), ' ') + text : text;
}

std::string padRight(const std::string& text, int width) {
    const int pad = width - visibleWidth(text);
    return pad > 0 ? text + std::string(static_cast<std::size_t>(pad), ' ') : text;
}

std::string truncateWithEllipsis(const std::string& text, int width) {
    if (width <= 0) return {};
    if (visibleWidth(text) <= width) return text;
    if (width == 1) return ".";
    return slice(text, 0, width - 1) + "…";
}

std::string leftColumn(const std::string& text, int width) {
    return padRight(truncateWithEllipsis(text, width), width);
}

std::string centerColumn(const std::string& text, int width) {
    const std::string clipped = truncateWithEllipsis(text, width);
    const int pad = (width - visibleWidth(clipped)) / 2;
    return pad > 0 ? std::string(static_cast<std::size_t>(pad), ' ') + clipped : clipped;
}

std::string rightColumn(const std::string& text, int width) {
    return padLeft(truncateWithEllipsis(text, width), width);
}

std::vector<std::string> wrapText(const std::string& text, int width) {
    std::vector<std::string> lines;
    if (width <= 0) return lines;

    std::istringstream words(text);
    std::string word;
    std::string current;

    const auto flush = [&]() {
        if (!current.empty()) {
            lines.push_back(current);
            current.clear();
        }
    };

    while (words >> word) {
        // A single word wider than the column has to be broken, otherwise it
        // would push the money column off the paper.
        while (visibleWidth(word) > width) {
            flush();
            lines.push_back(slice(word, 0, width));
            word = slice(word, width, visibleWidth(word) - width);
        }
        if (word.empty()) continue;

        if (current.empty()) {
            current = word;
        } else if (visibleWidth(current) + 1 + visibleWidth(word) <= width) {
            current += " " + word;
        } else {
            flush();
            current = word;
        }
    }
    flush();

    if (lines.empty()) lines.push_back("");
    return lines;
}

std::string renderSeparator(char fill, int width) {
    return std::string(static_cast<std::size_t>(std::max(0, width)), fill);
}

std::string renderKeyValue(const std::string& label, const std::string& value, int width) {
    const int labelWidth = visibleWidth(label);
    const int valueWidth = visibleWidth(value);
    const int gap = width - labelWidth - valueWidth;
    if (gap < 1) return label + " " + value;
    return label + std::string(static_cast<std::size_t>(gap), ' ') + value;
}

}  // namespace layout

namespace {

using layout::centerColumn;
using layout::padLeft;
using layout::renderKeyValue;
using layout::renderSeparator;
using layout::visibleWidth;
using layout::wrapText;

std::string formatTimestamp(Timestamp ms) {
    if (ms <= 0) return "-";
    const std::time_t seconds = static_cast<std::time_t>(ms / 1000);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &seconds);
#else
    localtime_r(&seconds, &tm);
#endif
    char buffer[32];
    std::snprintf(buffer, sizeof(buffer), "%02d.%02d.%04d %02d:%02d", tm.tm_mday, tm.tm_mon + 1,
                  tm.tm_year + 1900, tm.tm_hour, tm.tm_min);
    return buffer;
}

/** Adds a metadata row, moving an over-long value onto its own indented line. */
void pushKeyValue(std::vector<ReceiptLine>& out, const std::string& label, const std::string& value,
                  int width) {
    const std::string shown = value.empty() ? "-" : value;

    if (visibleWidth(label) + 1 + visibleWidth(shown) <= width) {
        out.push_back({renderKeyValue(label, shown, width)});
        return;
    }

    out.push_back({label});
    for (const auto& line : wrapText(shown, width - 2)) {
        out.push_back({"  " + line});
    }
}

/**
 * Renders one item block: the base price on the item row, then one row per
 * modifier, then notes.
 *
 * The money column only ever carries base line totals and modifier surcharges
 * that are *not* already inside the parent price, which is what keeps the visible
 * column adding up to the printed subtotal.
 */
void pushItem(std::vector<ReceiptLine>& out, const ReceiptItem& item, const ReceiptDocument& doc) {
    const int width = doc.charsPerLine;

    const std::string prefix = std::to_string(item.quantity) + " x ";
    // A complimentary line must not contribute to the money column, or the
    // visible column would stop matching the printed subtotal.
    const std::string money =
        item.complimentary ? std::string("HƏDİYYƏ") : formatMoney(item.baseLineTotal, doc);
    const int moneyWidth = visibleWidth(money);
    const int indent = std::max<int>(4, visibleWidth(prefix));
    const int nameWidth = std::max(8, width - moneyWidth - 1 - indent);

    auto nameLines = wrapText(item.name, nameWidth);

    for (std::size_t i = 0; i < nameLines.size(); ++i) {
        const std::string lead =
            i == 0 ? prefix : std::string(static_cast<std::size_t>(indent), ' ');
        const std::string body = lead + nameLines[i];
        const bool last = i + 1 == nameLines.size();
        out.push_back({last ? renderKeyValue(body, money, width) : body});
    }

    // Unit-price sublines ("2 × 4.00") confuse cashiers; quantity × name + line total is enough.
    (void)doc.printItemUnitPrice;

    for (const auto& modifier : item.modifiers) {
        const bool priced = doc.printModifierPrice && !item.complimentary && !modifier.isFree &&
                            !modifier.isIncludedInParentPrice && modifier.lineTotal != 0;
        const std::string modMoney = priced ? formatMoney(modifier.lineTotal, doc) : std::string();
        const int modMoneyWidth = priced ? visibleWidth(modMoney) + 1 : 0;
        const int modNameWidth = std::max(6, width - modMoneyWidth - indent - 2);

        auto modLines = wrapText(modifier.name, modNameWidth);
        for (std::size_t i = 0; i < modLines.size(); ++i) {
            const std::string lead = std::string(static_cast<std::size_t>(indent), ' ') +
                                     (i == 0 ? "+ " : "  ");
            const std::string body = lead + modLines[i];
            const bool last = i + 1 == modLines.size();
            out.push_back({last && priced ? renderKeyValue(body, modMoney, width) : body});
        }
    }

    if (!item.notes.empty()) {
        auto noteLines = wrapText("Qeyd: " + item.notes, width - indent);
        for (const auto& line : noteLines) {
            out.push_back({std::string(static_cast<std::size_t>(indent), ' ') + line});
        }
    }
}

}  // namespace

std::string formatMoney(Money minor, const std::string& currencyCode, CurrencyDisplay display) {
    const bool negative = minor < 0;
    const Money absolute = negative ? -minor : minor;

    char buffer[48];
    std::snprintf(buffer, sizeof(buffer), "%s%lld.%02lld", negative ? "-" : "",
                  static_cast<long long>(absolute / 100),
                  static_cast<long long>(absolute % 100));

    std::string out(buffer);
    switch (display) {
        case CurrencyDisplay::Code:
            out += " " + (currencyCode.empty() ? std::string("AZN") : currencyCode);
            break;
        case CurrencyDisplay::Symbol:
            out += " \xE2\x82\xBC";  // U+20BC MANAT SIGN
            break;
        case CurrencyDisplay::None:
            break;
    }
    return out;
}

std::string formatMoney(Money minor, const ReceiptDocument& doc) {
    return formatMoney(minor, doc.currencyCode, doc.currencyDisplay);
}

std::vector<ReceiptLine> formatReceipt(const ReceiptDocument& doc) {
    const int width = doc.charsPerLine;
    std::vector<ReceiptLine> out;

    // ---------------------------------------------------------------- header
    if (!doc.restaurant.name.empty()) {
        // Never double-width brand lines: "Milioner Pub" becomes sparse
        // letter-spaced gibberish on 80mm paper when each glyph takes two cells.
        out.push_back({doc.restaurant.name, LineAlign::Center, true, false});
    }
    if (!doc.restaurant.tagline.empty()) {
        out.push_back({doc.restaurant.tagline, LineAlign::Center, true, false});
    }
    if (!doc.restaurant.address.empty()) {
        for (const auto& line : wrapText(doc.restaurant.address, width)) {
            out.push_back({line, LineAlign::Center});
        }
    }
    if (!doc.restaurant.phone.empty()) {
        out.push_back({doc.restaurant.phone, LineAlign::Center});
    }
    if (!doc.restaurant.hours.empty()) {
        out.push_back({"İş saatı: " + doc.restaurant.hours, LineAlign::Center});
    }
    if (!doc.restaurant.taxId.empty()) {
        out.push_back({"VÖEN: " + doc.restaurant.taxId, LineAlign::Center});
    }

    if (doc.isReprint) {
        out.push_back({"", LineAlign::Left});
        out.push_back({"*** TƏKRAR ÇAP ***", LineAlign::Center, true});
    }

    out.push_back({renderSeparator('=', width)});

    if (doc.kind == ReceiptKind::CustomerBill) {
        out.push_back({"*** MÜŞTƏRİ ÇEKİ ***", LineAlign::Center, true});
        out.push_back({"Ödəniş qəbzi deyil", LineAlign::Center});
        out.push_back({renderSeparator('=', width)});
    }

    // ------------------------------------------------------------- metadata
    pushKeyValue(out, "Sifariş:", doc.orderNumber, width);

    if (!doc.tableName.empty()) {
        const std::string table =
            doc.areaName.empty() ? doc.tableName : doc.areaName + " / " + doc.tableName;
        pushKeyValue(out, "Masa:", table, width);
    } else if (doc.orderType == "delivery") {
        pushKeyValue(out, "Sifariş növü:", "Çatdırılma", width);
    } else if (doc.orderType == "takeaway") {
        pushKeyValue(out, "Sifariş növü:", "Paket sifarişi", width);
    } else {
        pushKeyValue(out, "Masa:", "Paket sifarişi", width);
    }

    pushKeyValue(out, "Ofisiant:", doc.waiterName, width);
    if (doc.guestCount > 0) {
        pushKeyValue(out, "Qonaq:", std::to_string(doc.guestCount), width);
    }
    pushKeyValue(out, "Tarix:", formatTimestamp(doc.paidAt > 0 ? doc.paidAt : doc.openedAt), width);
    pushKeyValue(out, "Qəbz:", doc.receiptNumber, width);

    out.push_back({renderSeparator('-', width)});

    // ---------------------------------------------------------------- items
    for (const auto& item : doc.items) {
        if (item.voided) continue;
        pushItem(out, item, doc);
    }

    out.push_back({renderSeparator('-', width)});

    // --------------------------------------------------------------- totals
    // Defensive: legacy orders written before the pricing model was unified can
    // carry a stored subtotal that does not match their line snapshots. Show the
    // difference rather than printing a column that silently fails to add up.
    const Money visible = doc.visibleItemTotal();
    if (visible != doc.subtotal) {
        out.push_back({renderKeyValue("Düzəliş", formatMoney(doc.subtotal - visible, doc), width)});
    }

    // Skip Ara cəm when it equals YEKUN and there are no adjustments — avoids
    // printing the same amount three times (Ara cəm / YEKUN / Nağd|Kart).
    const bool hasAdjustments = doc.discountTotal > 0 || doc.serviceCharge > 0 ||
                                doc.depositTotal > 0 ||
                                std::any_of(doc.taxes.begin(), doc.taxes.end(),
                                            [](const ReceiptTaxLine& tax) { return tax.amount != 0; });
    const bool showSubtotal = hasAdjustments || doc.subtotal != doc.grandTotal;
    if (showSubtotal) {
        out.push_back({renderKeyValue("Ara cəm", formatMoney(doc.subtotal, doc), width)});
    }

    if (doc.discountTotal > 0) {
        out.push_back({renderKeyValue(doc.discountLabel.empty() ? "Endirim" : doc.discountLabel,
                                      "-" + formatMoney(doc.discountTotal, doc), width)});
    }
    if (doc.serviceCharge > 0) {
        out.push_back({renderKeyValue(doc.serviceLabel.empty() ? "Servis haqqı" : doc.serviceLabel,
                                      formatMoney(doc.serviceCharge, doc), width)});
    }
    for (const auto& tax : doc.taxes) {
        if (tax.amount == 0) continue;
        const std::string label = tax.included ? tax.label + " (daxildir)" : tax.label;
        out.push_back({renderKeyValue(label, formatMoney(tax.amount, doc), width)});
    }
    if (doc.depositTotal > 0) {
        out.push_back({renderKeyValue(doc.depositLabel.empty() ? "Depozit" : doc.depositLabel,
                                      formatMoney(doc.depositTotal, doc), width)});
    }

    out.push_back({renderSeparator('=', width)});
    out.push_back({renderKeyValue("YEKUN", formatMoney(doc.grandTotal, doc), width), LineAlign::Left,
                   true});
    out.push_back({renderSeparator('=', width)});

    // ------------------------------------------------------------- payments
    for (const auto& payment : doc.payments) {
        out.push_back({renderKeyValue(payment.label, formatMoney(payment.amount, doc), width)});
    }
    if (doc.tipTotal > 0) {
        out.push_back({renderKeyValue("Bəxşiş", formatMoney(doc.tipTotal, doc), width)});
    }
    if (doc.changeAmount > 0) {
        out.push_back(
            {renderKeyValue("Qaytarılan məbləğ", formatMoney(doc.changeAmount, doc), width)});
    }
    if (doc.remainingAmount > 0) {
        out.push_back({renderKeyValue("Qalıq", formatMoney(doc.remainingAmount, doc), width)});
    }

    // ------------------------------------------------- how to get money back
    //
    // Printed only on a paid receipt, never on a preliminary bill: a bill is
    // not proof of anything yet. The number is the same one shown as "Qəbz:"
    // above - repeated here under a label that says what it is for, because a
    // guest who does not know the paper matters throws it away on the way out,
    // and then there is nothing to look the sale up by.
    if (doc.kind == ReceiptKind::PaymentReceipt && !doc.receiptNumber.empty()) {
        out.push_back({""});
        out.push_back({renderSeparator('-', width)});
        out.push_back({"GERİ QAYTARMA KODU", LineAlign::Center});
        out.push_back({doc.receiptNumber, LineAlign::Center, true});
        for (const auto& wrapped :
             wrapText("Qaytarma üçün bu çeki və kodu kassaya təqdim edin.", width)) {
            out.push_back({wrapped, LineAlign::Center});
        }
    }

    // --------------------------------------------------------------- footer
    out.push_back({""});
    for (const auto& line : doc.footer) {
        for (const auto& wrapped : wrapText(line, width)) {
            out.push_back({wrapped, LineAlign::Center});
        }
    }

    if (doc.printQr && !doc.qrPayload.empty()) {
        out.push_back({""});
        out.push_back({"", LineAlign::Center, false, false, true});
    }

    // Headers, totals and payment labels must obey the same width as item rows.
    // Retain every character: a thermal head clips overlong lines silently.
    std::vector<ReceiptLine> fitted;
    for (const auto& line : out) {
        const int columns = line.doubleWidth ? std::max(1, width / 2) : width;
        if (line.qr || layout::visibleWidth(line.text) <= columns) fitted.push_back(line);
        else for (const auto& text : wrapText(line.text, columns)) {
            auto part = line; part.text = text; fitted.push_back(std::move(part));
        }
    }
    return fitted;
}

std::string renderPlainText(const std::vector<ReceiptLine>& lines, int charsPerLine) {
    std::ostringstream out;
    for (const auto& line : lines) {
        if (line.qr) {
            out << centerColumn("[ QR ]", charsPerLine) << "\n";
            continue;
        }
        switch (line.align) {
            case LineAlign::Center: out << centerColumn(line.text, charsPerLine); break;
            case LineAlign::Right: out << padLeft(line.text, charsPerLine); break;
            default: out << line.text; break;
        }
        out << "\n";
    }
    return out.str();
}

std::string renderPlainText(const ReceiptDocument& doc) {
    return renderPlainText(formatReceipt(doc), doc.charsPerLine);
}

namespace {

std::string escapeHtml(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (char c : raw) {
        switch (c) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            default: out += c; break;
        }
    }
    return out;
}

}  // namespace

std::string renderHtml(const ReceiptDocument& doc, std::string_view logoPngBase64) {
    const double mm = paperWidthMm(doc.paperWidth);
    const auto money = [&](Money m) { return escapeHtml(formatMoney(m, doc)); };
    const auto row = [&](const std::string& label, const std::string& value) {
        return std::string("<div class=\"kv\"><span>") + escapeHtml(label) + "</span><span>" +
               escapeHtml(value) + "</span></div>";
    };
    const auto moneyRow = [&](const std::string& label, const std::string& valueHtml, const char* cls) {
        return std::string("<div class=\"") + cls + "\"><span>" + escapeHtml(label) +
               "</span><span>" + valueHtml + "</span></div>";
    };

    std::ostringstream out;
    out << "<!DOCTYPE html><html lang=\"az\"><head><meta charset=\"utf-8\">"
        << "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        << "<title>" << escapeHtml(doc.receiptNumber.empty() ? "Çek" : doc.receiptNumber)
        << "</title><style>"
        << ":root{--ink:#12141a;--muted:#6b7280;--line:#e8eaef;--paper:#ffffff;--soft:#f4f6f9;"
           "--accent:#0f766e;--shadow:0 18px 40px rgba(15,23,42,.12)}"
        << "*{box-sizing:border-box}body{margin:0;padding:20px 14px;background:linear-gradient(180deg,#dfe6f0,#edf1f6);"
           "min-height:100vh;display:flex;flex-direction:column;align-items:center;gap:10px;"
           "font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink)}"
        << ".meta{font-size:11px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}"
        << ".ticket{width:min(100%,360px);background:var(--paper);border-radius:16px;overflow:hidden;"
           "box-shadow:var(--shadow);border:1px solid rgba(15,23,42,.06)}"
        << ".head{padding:22px 22px 16px;text-align:center;background:linear-gradient(180deg,#fbfcfe,#f3f5f8)}"
        << ".logo{display:block;margin:0 auto 12px;max-width:160px;max-height:72px;width:auto;height:auto;"
           "object-fit:contain}"
        << ".brand{margin:0;font-size:20px;font-weight:700;letter-spacing:-.02em;line-height:1.2}"
        << ".tag{margin:6px 0 0;font-size:12px;color:var(--muted);line-height:1.4}"
        << ".contact{margin:8px 0 0;font-size:11.5px;color:#4b5563;line-height:1.45}"
        << ".badge{display:inline-block;margin-top:12px;padding:4px 10px;border-radius:999px;"
           "background:#ecfdf5;color:var(--accent);font-size:11px;font-weight:600}"
        << ".badge.warn{background:#fff7ed;color:#c2410c}"
        << ".body{padding:4px 22px 8px}"
        << ".kv,.line,.total,.pay{display:flex;justify-content:space-between;gap:12px;align-items:baseline}"
        << ".kv{padding:5px 0;font-size:12.5px;border-bottom:1px dashed var(--line)}"
        << ".kv span:first-child{color:var(--muted);flex:0 0 auto}"
        << ".kv span:last-child{font-weight:600;text-align:right;word-break:break-word}"
        << ".section{margin:14px 0 6px;font-size:10.5px;font-weight:700;letter-spacing:.08em;"
           "text-transform:uppercase;color:var(--muted)}"
        << ".items{margin:0;padding:0;list-style:none}"
        << ".item{padding:10px 0;border-bottom:1px solid var(--line)}"
        << ".item:last-child{border-bottom:0}"
        << ".line{font-size:13.5px;font-weight:600}"
        << ".line .qty{color:var(--muted);font-weight:500;margin-right:4px}"
        << ".line .amt{font-variant-numeric:tabular-nums;white-space:nowrap}"
        << ".mods{margin:4px 0 0;padding:0;list-style:none}"
        << ".mods li{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:#4b5563;"
           "padding:2px 0 2px 14px}"
        << ".note{margin:4px 0 0;padding-left:14px;font-size:11.5px;color:var(--muted)}"
        << ".totals{margin-top:8px;padding-top:4px}"
        << ".total{padding:6px 0;font-size:13px}"
        << ".total.grand{margin-top:6px;padding:12px 0;border-top:2px solid var(--ink);"
           "border-bottom:1px solid var(--line);font-size:16px;font-weight:700}"
        << ".total.grand .amt,.pay .amt,.line .amt{font-variant-numeric:tabular-nums}"
        << ".pay{padding:5px 0;font-size:13px}"
        << ".refund{margin:16px 0 8px;padding:14px;border-radius:12px;background:var(--soft);text-align:center}"
        << ".refund .label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;"
           "color:var(--muted)}"
        << ".refund .code{margin:6px 0 4px;font-size:18px;font-weight:700;letter-spacing:.04em}"
        << ".refund .hint{margin:0;font-size:11.5px;color:#4b5563;line-height:1.4}"
        << ".foot{padding:8px 22px 20px;text-align:center}"
        << ".foot p{margin:0 0 4px;font-size:12.5px;color:#374151;line-height:1.4}"
        << ".qr{display:flex;justify-content:center;padding:6px 22px 18px}"
        << ".qr .code{width:148px;padding:10px;background:#fff;border:1px solid var(--line);border-radius:12px}"
        << ".qr .code svg{display:block;width:100%;height:auto;image-rendering:pixelated}"
        << "</style></head><body>"
        << "<div class=\"meta\">" << mm << " mm önizləmə</div>"
        << "<article class=\"ticket\">"
        << "<header class=\"head\">";

    if (!logoPngBase64.empty()) {
        out << "<img class=\"logo\" alt=\"" << escapeHtml(doc.restaurant.name)
            << "\" src=\"data:image/png;base64," << logoPngBase64 << "\"/>";
    }
    if (!doc.restaurant.name.empty())
        out << "<h1 class=\"brand\">" << escapeHtml(doc.restaurant.name) << "</h1>";
    if (!doc.restaurant.tagline.empty())
        out << "<p class=\"tag\">" << escapeHtml(doc.restaurant.tagline) << "</p>";

    std::ostringstream contact;
    if (!doc.restaurant.address.empty()) contact << escapeHtml(doc.restaurant.address);
    if (!doc.restaurant.phone.empty()) {
        if (contact.tellp() > 0) contact << "<br>";
        contact << escapeHtml(doc.restaurant.phone);
    }
    if (!doc.restaurant.hours.empty()) {
        if (contact.tellp() > 0) contact << "<br>";
        contact << "İş saatı: " << escapeHtml(doc.restaurant.hours);
    }
    if (!doc.restaurant.taxId.empty()) {
        if (contact.tellp() > 0) contact << "<br>";
        contact << "VÖEN: " << escapeHtml(doc.restaurant.taxId);
    }
    if (contact.tellp() > 0) out << "<p class=\"contact\">" << contact.str() << "</p>";

    if (doc.isReprint) out << "<div class=\"badge warn\">Təkrar çap</div>";
    else if (doc.kind == ReceiptKind::CustomerBill)
        out << "<div class=\"badge warn\">Müştəri çeki · ödəniş qəbzi deyil</div>";
    else if (!doc.receiptNumber.empty())
        out << "<div class=\"badge\">Ödəniş qəbzi</div>";

    out << "</header><div class=\"body\">";

    if (!doc.orderNumber.empty()) out << row("Sifariş", doc.orderNumber);
    if (!doc.tableName.empty()) {
        const std::string table =
            doc.areaName.empty() ? doc.tableName : doc.areaName + " / " + doc.tableName;
        out << row("Masa", table);
    } else if (doc.orderType == "delivery") {
        out << row("Növ", "Çatdırılma");
    } else if (doc.orderType == "takeaway") {
        out << row("Növ", "Paket");
    }
    if (!doc.waiterName.empty()) out << row("Ofisiant", doc.waiterName);
    if (doc.guestCount > 0) out << row("Qonaq", std::to_string(doc.guestCount));
    const auto when = formatTimestamp(doc.paidAt > 0 ? doc.paidAt : doc.openedAt);
    if (when != "-") out << row("Tarix", when);
    if (!doc.receiptNumber.empty()) out << row("Qəbz", doc.receiptNumber);

    out << "<div class=\"section\">Sifariş</div><ul class=\"items\">";
    for (const auto& item : doc.items) {
        if (item.voided) continue;
        out << "<li class=\"item\"><div class=\"line\"><span><span class=\"qty\">"
            << item.quantity << "×</span>" << escapeHtml(item.name)
            << "</span><span class=\"amt\">"
            << (item.complimentary ? "HƏDİYYƏ" : money(item.baseLineTotal)) << "</span></div>";
        if (!item.modifiers.empty()) {
            out << "<ul class=\"mods\">";
            for (const auto& mod : item.modifiers) {
                const bool priced = doc.printModifierPrice && !item.complimentary && !mod.isFree &&
                                    !mod.isIncludedInParentPrice && mod.lineTotal != 0;
                out << "<li><span>+ " << escapeHtml(mod.name) << "</span><span>"
                    << (priced ? money(mod.lineTotal) : "") << "</span></li>";
            }
            out << "</ul>";
        }
        if (!item.notes.empty())
            out << "<div class=\"note\">Qeyd: " << escapeHtml(item.notes) << "</div>";
        out << "</li>";
    }
    out << "</ul><div class=\"totals\">";

    const Money visible = doc.visibleItemTotal();
    if (visible != doc.subtotal)
        out << moneyRow("Düzəliş", money(doc.subtotal - visible), "total");
    const bool hasAdjustments = doc.discountTotal > 0 || doc.serviceCharge > 0 ||
                                doc.depositTotal > 0 ||
                                std::any_of(doc.taxes.begin(), doc.taxes.end(),
                                            [](const ReceiptTaxLine& tax) { return tax.amount != 0; });
    if (hasAdjustments || doc.subtotal != doc.grandTotal)
        out << moneyRow("Ara cəm", money(doc.subtotal), "total");
    if (doc.discountTotal > 0)
        out << moneyRow(doc.discountLabel.empty() ? "Endirim" : doc.discountLabel,
                        "-" + money(doc.discountTotal), "total");
    if (doc.serviceCharge > 0)
        out << moneyRow(doc.serviceLabel.empty() ? "Servis haqqı" : doc.serviceLabel,
                        money(doc.serviceCharge), "total");
    for (const auto& tax : doc.taxes) {
        if (tax.amount == 0) continue;
        out << moneyRow(tax.label.empty() ? "Vergi" : tax.label, money(tax.amount), "total");
    }
    if (doc.depositTotal > 0)
        out << moneyRow(doc.depositLabel.empty() ? "Depozit" : doc.depositLabel,
                        money(doc.depositTotal), "total");

    out << moneyRow("Yekun", money(doc.grandTotal), "total grand");
    for (const auto& payment : doc.payments)
        out << moneyRow(payment.label, money(payment.amount), "pay");
    if (doc.tipTotal > 0) out << moneyRow("Bəxşiş", money(doc.tipTotal), "pay");
    if (doc.changeAmount > 0) out << moneyRow("Qaytarılan", money(doc.changeAmount), "pay");
    if (doc.remainingAmount > 0) out << moneyRow("Qalıq", money(doc.remainingAmount), "pay");
    out << "</div>";

    if (doc.kind == ReceiptKind::PaymentReceipt && !doc.receiptNumber.empty()) {
        out << "<div class=\"refund\"><div class=\"label\">Geri qaytarma kodu</div>"
            << "<div class=\"code\">" << escapeHtml(doc.receiptNumber) << "</div>"
            << "<p class=\"hint\">Qaytarma üçün bu çeki və kodu kassaya təqdim edin.</p></div>";
    }
    out << "</div>";

    if (!doc.footer.empty()) {
        out << "<footer class=\"foot\">";
        for (const auto& line : doc.footer) {
            if (!line.empty()) out << "<p>" << escapeHtml(line) << "</p>";
        }
        out << "</footer>";
    }

    if (doc.printQr && !doc.qrPayload.empty()) {
        out << "<div class=\"qr\"><div class=\"code\">"
            << qrPreviewSvg(doc.qrPayload, doc.paperWidth) << "</div></div>";
    }

    out << "</article></body></html>";
    return out.str();
}

}  // namespace pos::printing
