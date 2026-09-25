#pragma once

#include <string>
#include <vector>

#include "pos/Common.hpp"

namespace pos::printing {

/** How the money column is decorated. */
enum class CurrencyDisplay {
    Code,    // 32.00 AZN
    Symbol,  // 32.00 ₼
    None,    // 32.00
};

/** Which renderer the printer pipeline should use. */
enum class RenderMode {
    Auto,    // text when the code page covers the document, raster otherwise
    Text,    // always ESC/POS text
    Raster,  // always a monochrome bitmap
};

/** Physical paper, which decides the character grid and the raster dot width. */
struct PaperWidth {
    double mm = 80;
    int printableDots = 0; // 0 = conservative automatic head width
    int dpi = 203;
    static const PaperWidth Mm58;
    static const PaperWidth Mm80;
    bool operator==(const PaperWidth& other) const { return mm == other.mm; }
};
inline const PaperWidth PaperWidth::Mm58{58, 0, 203};
inline const PaperWidth PaperWidth::Mm80{80, 0, 203};

/** What the document represents. Never claim fiscal status we do not have. */
enum class ReceiptKind { CustomerBill, PaymentReceipt, KitchenTicket, ShiftReport };

struct ReceiptModifier {
    std::string name;
    std::int64_t quantity = 1;
    /** Per-unit surcharge in minor units. Zero for a free choice. */
    Money unitPrice = 0;
    /** unitPrice * quantity * parentQuantity. Zero when included in the parent. */
    Money lineTotal = 0;
    bool isFree = false;
    /**
     * True when the parent item line already shows a price that contains this
     * modifier. Set by the pricing model, never guessed by a renderer.
     */
    bool isIncludedInParentPrice = false;
};

struct ReceiptItem {
    std::string id;
    std::string name;
    std::int64_t quantity = 1;
    /** Menu price of one unit, excluding modifiers. */
    Money unitBasePrice = 0;
    /** unitBasePrice * quantity. */
    Money baseLineTotal = 0;
    std::vector<ReceiptModifier> modifiers;
    std::string notes;
    /** baseLineTotal + sum(modifier.lineTotal). What the guest pays for the line. */
    Money itemLineTotal = 0;
    bool voided = false;
    bool complimentary = false;
};

struct ReceiptPayment {
    std::string method;  // cash | card | ...
    std::string label;   // localised, already includes any masked card tail
    Money amount = 0;
    Money tendered = 0;
    Money change = 0;
};

struct ReceiptTaxLine {
    std::string label;  // e.g. "ƏDV (18%)"
    Money amount = 0;
    /** True when the amount is already inside grandTotal rather than added to it. */
    bool included = false;
};

struct ReceiptRestaurant {
    std::string name;
    std::string tagline;
    std::string address;
    std::string phone;
    std::string hours;
    std::string taxId;
};

/**
 * The canonical receipt.
 *
 * Every renderer — screen preview, PDF, ESC/POS text, ESC/POS raster — consumes
 * this and nothing else. It is built once from the order's pricing snapshot, so
 * a reprint months later reproduces the original bill byte for byte.
 *
 * Invariant enforced at build time and asserted by the tests:
 *   subtotal == sum(items[i].itemLineTotal for non-voided, non-complimentary)
 * and the amounts a renderer prints on item and modifier lines sum to exactly
 * that same subtotal. No renderer may recompute a total.
 */
struct ReceiptDocument {
    ReceiptKind kind = ReceiptKind::PaymentReceipt;

    std::string receiptId;
    std::string receiptNumber;
    std::string orderNumber;
    std::string orderType;  // dine_in | takeaway | delivery
    std::string tableName;
    std::string areaName;
    std::string waiterName;
    std::int64_t guestCount = 0;
    Timestamp openedAt = 0;
    Timestamp paidAt = 0;
    std::string terminalName;

    ReceiptRestaurant restaurant;
    std::vector<ReceiptItem> items;

    Money subtotal = 0;
    Money discountTotal = 0;
    std::string discountLabel;
    Money serviceCharge = 0;
    std::string serviceLabel;
    /** Manually entered additive deposit/surcharge. It is not taxed. */
    Money depositTotal = 0;
    std::string depositLabel;
    std::vector<ReceiptTaxLine> taxes;
    Money taxTotal = 0;
    Money grandTotal = 0;

    std::vector<ReceiptPayment> payments;
    Money amountPaid = 0;
    Money remainingAmount = 0;
    Money changeAmount = 0;
    Money tipTotal = 0;

    std::string qrPayload;
    std::vector<std::string> footer;

    std::string locale = "az-AZ";
    std::string currencyCode = "AZN";
    CurrencyDisplay currencyDisplay = CurrencyDisplay::Code;
    PaperWidth paperWidth = PaperWidth::Mm80;
    int charsPerLine = 48;

    /** Prints a "TƏKRAR ÇAP" marker when the same receipt is issued again. */
    bool isReprint = false;
    /** Whether the renderer should emit the QR block at all. */
    bool printQr = true;
    /** Show "3 × 5.00 AZN" under lines whose quantity is above one. */
    bool printItemUnitPrice = true;
    /** Show a money column next to paid modifiers. */
    bool printModifierPrice = true;

    /** Sum of what the item and modifier lines display. Must equal subtotal. */
    Money visibleItemTotal() const;

    Json toJson() const;
};

/** Rebuilds a document from a stored snapshot so reprints are byte-identical. */
ReceiptDocument documentFromJson(const Json& json);

int defaultCharsPerLine(PaperWidth width);
PaperWidth paperWidthFromMm(double mm);
double paperWidthMm(PaperWidth width);
int printableDotWidth(PaperWidth width);
RenderMode renderModeFromString(const std::string& value);
std::string renderModeToString(RenderMode mode);
CurrencyDisplay currencyDisplayFromString(const std::string& value);

}  // namespace pos::printing
