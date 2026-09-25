#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "pos/printing/ReceiptDocument.hpp"

namespace pos::printing {

/**
 * Column and wrapping primitives for a fixed-width character grid.
 *
 * Every function counts UTF-8 code points, not bytes: "Ə" is two bytes but one
 * printer column, and measuring bytes is what makes Azerbaijani receipts drift
 * out of alignment.
 */
namespace layout {

int visibleWidth(const std::string& text);

/** Code-point-safe substring. */
std::string slice(const std::string& text, int startCp, int lengthCp);

std::string padLeft(const std::string& text, int width);
std::string padRight(const std::string& text, int width);
std::string truncateWithEllipsis(const std::string& text, int width);

std::string leftColumn(const std::string& text, int width);
std::string centerColumn(const std::string& text, int width);
std::string rightColumn(const std::string& text, int width);

/** Greedy word wrap; words longer than the width are hard-split. */
std::vector<std::string> wrapText(const std::string& text, int width);

std::string renderSeparator(char fill, int width);

/** "Label" left, "value" right on one line, never overlapping. */
std::string renderKeyValue(const std::string& label, const std::string& value, int width);

}  // namespace layout

/** Emphasis carried alongside the text so text and raster output stay in step. */
enum class LineAlign { Left, Center, Right };

struct ReceiptLine {
    std::string text;
    LineAlign align = LineAlign::Left;
    bool bold = false;
    bool doubleWidth = false;
    /** Emit the QR block here instead of text. */
    bool qr = false;
};

std::string formatMoney(Money minor, const std::string& currencyCode, CurrencyDisplay display);

/** Convenience overload using the document's own currency configuration. */
std::string formatMoney(Money minor, const ReceiptDocument& doc);

/**
 * Turns a ReceiptDocument into positioned lines.
 *
 * This is the single layout authority: the HTML preview, the PDF preview, the
 * ESC/POS text stream and the raster bitmap all render the same line list, so
 * what the cashier sees on screen is what the guest gets on paper.
 */
std::vector<ReceiptLine> formatReceipt(const ReceiptDocument& doc);

/** Flattens the line list into a monospaced block at charsPerLine columns. */
std::string renderPlainText(const ReceiptDocument& doc);
std::string renderPlainText(const std::vector<ReceiptLine>& lines, int charsPerLine);

/**
 * Paper-accurate HTML for the on-screen and PDF previews.
 *
 * Built from the same line list as the printer stream, at the same column count,
 * so nothing can drift between what the cashier sees and what the guest gets.
 */
/**
 * Screen preview of a receipt.
 *
 * `logoPngBase64` is the venue's own mark (base64 PNG, no `data:` prefix);
 * empty renders no logo. It is a parameter rather than part of the document
 * because a stored receipt is replayed for years and must not carry a copy of
 * the brand image in every row.
 */
std::string renderHtml(const ReceiptDocument& doc, std::string_view logoPngBase64 = {});

}  // namespace pos::printing
