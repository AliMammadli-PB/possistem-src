#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "pos/printing/RasterRenderer.hpp"
#include "pos/printing/ReceiptFormatter.hpp"

namespace pos::printing {

struct EscPosOptions {
    int density = 5;       // 0–8 (printer max 8)
    bool cut = true;       // full cut after receipt
    bool beep = false;     // silent by default; ESC B is noisy on the floor
    bool openCashDrawer = false;
    int feedLines = 4;
    int codePage = 13;     // ESC t n — 13 == CP857 (PC Turkish)
    RenderMode renderMode = RenderMode::Auto;
    PaperWidth paperWidth = PaperWidth::Mm80;
    int charsPerLine = 40;
    int fontHeightPx = 0;
    int fontWidthPx = 0;
    int sideMarginPx = 0;
    bool qr = true;        // print QR of the receipt payload
    std::string qrPayload;
    /**
     * The venue's own brand mark, 1 bpp, already scaled to the head width.
     *
     * Empty prints no logo. It used to be a constant compiled into the binary,
     * which meant every customer's receipt carried the first venue's mark and
     * changing it needed a rebuild.
     */
    MonoBitmap logo;
};

struct EscPosResult {
    std::vector<std::uint8_t> bytes;
    /** The mode actually used, which may differ from the request under Auto. */
    RenderMode usedMode = RenderMode::Text;
    /** True when characters had to be approximated because nothing else worked. */
    bool transliterated = false;
    /** Human-readable note for the print job log, e.g. why raster was chosen. */
    std::string note;
};

/**
 * True when every character in the text has a faithful glyph in the code page.
 *
 * Azerbaijani "Ə"/"ə" exist in no single-byte thermal code page, so a document
 * containing them always answers false and drives the raster path.
 */
bool codePageCovers(std::string_view utf8Text);

/** Characters the selected code page cannot represent, for diagnostics. */
std::string unsupportedCharacters(std::string_view utf8Text);

/** Builds the byte stream for a formatted receipt, choosing text or raster. */
EscPosResult buildEscPos(const std::vector<ReceiptLine>& lines, const EscPosOptions& options);

/** Plain-text convenience path used by kitchen tickets and the test page. */
EscPosResult buildEscPosText(std::string_view utf8Text, const EscPosOptions& options);

/** Legacy entry point: returns only the bytes of the plain-text path. */
std::vector<std::uint8_t> buildEscPosReceipt(std::string_view utf8Text,
                                             const EscPosOptions& options);

bool isNetworkPrinter(std::string_view printerName);
bool parseNetworkPrinter(std::string_view printerName, std::string& host, int& port);

/** `win:PrinterName` or a bare Windows queue name (not tcp/virtual/offline). */
bool parseWindowsPrinter(std::string_view printerName, std::string& windowsName);

bool sendRawTcp(const std::string& host, int port, const std::vector<std::uint8_t>& payload,
                std::string& errorOut, int timeoutMs = 8000);

/** RAW ESC/POS via the Windows spooler (USB / shared / local queues). */
bool sendRawWindowsPrinter(const std::string& printerName, const std::vector<std::uint8_t>& payload,
                           std::string& errorOut);

/** `usbraw:\\?\usb#vid_xxxx&pid_xxxx#...` - a USB device path, no driver needed. */
bool parseUsbRawPrinter(std::string_view printerName, std::string& devicePath);

/** Writes straight to a USB printer-class device, bypassing the spooler. */
bool sendRawUsbDevice(const std::string& devicePath, const std::vector<std::uint8_t>& payload,
                      std::string& errorOut);

/** `serial:COM3` or `serial:COM3@19200`; baud defaults to 9600, framing 8N1. */
bool parseSerialPrinter(std::string_view printerName, std::string& port, int& baud);

bool sendRawSerial(const std::string& port, int baud, const std::vector<std::uint8_t>& payload,
                   std::string& errorOut);

}  // namespace pos::printing
