#pragma once

#include <string>
#include <vector>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"
#include "pos/printing/RasterRenderer.hpp"
#include "pos/printing/ReceiptDocument.hpp"
#include "pos/printing/ReceiptFormatter.hpp"

namespace pos::printing {

struct RenderedReceipt {
    std::string number;
    /** Monospaced text at the configured charsPerLine, ready for a thermal printer. */
    std::string text;
    /** Structured lines for ESC/POS / raster (preferred over plain text). */
    std::vector<ReceiptLine> lines;
    /** QR payload (phone / verify URL). Empty means no QR block. */
    std::string qrPayload;
    /** Structured form, used by the on-screen preview and the snapshot tests. */
    Json data;
    Money totalMinor = 0;
};

/** Printer-facing configuration resolved from app_settings. */
struct ReceiptSettings {
    PaperWidth paperWidth = PaperWidth::Mm80;
    /** Configured paper width in millimetres (may be custom, e.g. 72). */
    double paperWidthMm = 80;
    int charsPerLine = 48;
    /** 0 = derive from column grid; otherwise force glyph height in dots/px. */
    int fontHeightPx = 0;
    /** 0 = derive from column grid; otherwise force glyph width in dots/px. */
    int fontWidthPx = 0;
    /** 0 = default side margin for paper size. */
    int sideMarginPx = 0;
    RenderMode renderMode = RenderMode::Auto;
    CurrencyDisplay currencyDisplay = CurrencyDisplay::Code;
    std::string currencyCode = "AZN";
    bool printQr = true;
    bool printItemUnitPrice = true;
    bool printModifierPrice = true;
    bool cutAfterPrint = true;
    bool openCashDrawer = false;
    int density = 5;
    int bottomFeedLines = 4;
    int codePage = 13;  // ESC t n — 13 == CP857 (Turkish) on Epson-compatible firmware
};

/**
 * Renders receipts and kitchen tickets.
 *
 * Values come from the order's stored snapshots rather than the live menu, so a
 * reprinted bill always matches what the guest was originally charged even if
 * prices changed in between.
 */
class ReceiptBuilder {
public:
    explicit ReceiptBuilder(handlers::Context& ctx) : ctx_(ctx) {}

    ReceiptSettings settings();
    ReceiptSettings settings(PaperWidth width);

    /** The canonical document. Every renderer starts here. */
    ReceiptDocument customerDocument(const std::string& orderId, const ReceiptSettings& config,
                                     bool isReprint = false, bool preliminaryBill = false);

    RenderedReceipt customerReceipt(const std::string& orderId);
    RenderedReceipt customerReceipt(const std::string& orderId, const ReceiptSettings& config,
                                    bool isReprint);
    RenderedReceipt kitchenTicket(const std::string& orderId);
    RenderedReceipt shiftReport(const std::string& shiftId);

    /**
     * The slip handed to a guest when money goes back.
     *
     * Names the original receipt code, so the guest's copy and this one can be
     * matched by eye when the refund is questioned later.
     */
    RenderedReceipt refundReceipt(const std::string& refundId);

    /**
     * The goods-receipt note, printed where the goods are.
     *
     * Carries a line to sign: a delivery nobody signed for settles no argument
     * with a supplier a month later.
     */
    RenderedReceipt warehouseSlip(const std::string& purchaseId);
    /** X / Z fiscal report from a canonical snapshot JSON. */
    RenderedReceipt xzReport(const Json& canonical, const std::string& kind);

    /**
     * Takings between two instants, printed on demand.
     *
     * Reads the figures itself rather than accepting them from the caller, so
     * the paper and the screen cannot drift apart. Deliberately does not look
     * like an X or Z: no sequence number, and it says on its face that it is
     * informational, because a slice of a day is not a fiscal document.
     */
    RenderedReceipt periodReport(Timestamp from, Timestamp to);

    /** Formats minor units using the configured currency, e.g. "145.00 AZN". */
    std::string formatMoney(Money minor);

    /**
     * The venue's brand mark for the screen preview: base64 PNG without the
     * `data:` prefix. Empty when the operator has not uploaded one.
     */
    std::string logoPngBase64();

    /**
     * The same mark as a 1 bpp raster for the thermal head, decoded from
     * `printer.logoRaster`. Invalid/empty when none is configured.
     */
    MonoBitmap logoBitmap();

private:
    /** Reuses the number already issued for this order so reprints stay stable. */
    std::string receiptNumberFor(const std::string& orderId, const std::string& kind);

    handlers::Context& ctx_;
};

/**
 * Builds the QR payload for a receipt. Never carries secrets.
 *
 * `placeUrl` (e.g. the venue's map listing) wins outright and is encoded as-is;
 * `verifyUrl` is the receipt-verification portal and gets the receipt query
 * params appended. With neither set it falls back to a WhatsApp deep link and
 * then to an offline pipe-delimited form.
 */
std::string buildQrPayload(const ReceiptDocument& doc, const std::string& verifyUrl,
                           const std::string& placeUrl = "");

/**
 * Diagnostic page: Azerbaijani glyphs, money formatting, column alignment and a
 * QR sample, so a new printer can be verified without ringing up an order.
 */
std::vector<ReceiptLine> buildTestPage(const ReceiptSettings& config,
                                       const std::string& restaurantName);

/** Persists a rendered receipt and returns its id. */
std::string storeReceipt(handlers::Context& ctx, const std::string& orderId,
                         const std::string& kind, const RenderedReceipt& receipt);

}  // namespace pos::printing
