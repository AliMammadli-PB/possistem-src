#include "pos/printing/ReceiptGraphics.hpp"
#include "pos/printing/EscPos.hpp"

#include <algorithm>
#include <cstring>
#include <string>

#include "pos/Logging.hpp"
#include "pos/printing/RasterRenderer.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winspool.h>
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winspool.lib")
#else
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace pos::printing {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("printer");
    return log;
}

void append(std::vector<std::uint8_t>& out, std::initializer_list<std::uint8_t> bytes) {
    out.insert(out.end(), bytes.begin(), bytes.end());
}

void appendRaw(std::vector<std::uint8_t>& out, const void* data, std::size_t len) {
    const auto* p = static_cast<const std::uint8_t*>(data);
    out.insert(out.end(), p, p + len);
}

/** Decode one UTF-8 code point; advances index. Returns 0 on invalid. */
std::uint32_t nextCodepoint(std::string_view text, std::size_t& i) {
    if (i >= text.size()) return 0;
    const auto c0 = static_cast<unsigned char>(text[i++]);
    if (c0 < 0x80) return c0;
    if ((c0 & 0xE0) == 0xC0 && i < text.size()) {
        const auto c1 = static_cast<unsigned char>(text[i++]);
        return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
    }
    if ((c0 & 0xF0) == 0xE0 && i + 1 < text.size()) {
        const auto c1 = static_cast<unsigned char>(text[i++]);
        const auto c2 = static_cast<unsigned char>(text[i++]);
        return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
    }
    if ((c0 & 0xF8) == 0xF0 && i + 2 < text.size()) {
        const auto c1 = static_cast<unsigned char>(text[i++]);
        const auto c2 = static_cast<unsigned char>(text[i++]);
        const auto c3 = static_cast<unsigned char>(text[i++]);
        return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
    }
    return '?';
}

/**
 * Map Unicode → CP857 (PC Turkish). Covers Azerbaijani letters that share
 * Turkish glyphs; Ə/ə fall back to E/e which is common on 72 mm POS printers.
 */
std::uint8_t toCp857(std::uint32_t cp) {
    if (cp < 0x80) return static_cast<std::uint8_t>(cp);
    switch (cp) {
        case 0x00C7:
            return 0x80;  // Ç
        case 0x00FC:
            return 0x81;  // ü
        case 0x00E9:
            return 0x82;  // é
        case 0x00E2:
            return 0x83;  // â
        case 0x00E4:
            return 0x84;  // ä
        case 0x00E0:
            return 0x85;  // à
        case 0x00E5:
            return 0x86;  // å
        case 0x00E7:
            return 0x87;  // ç
        case 0x00EA:
            return 0x88;  // ê
        case 0x00EB:
            return 0x89;  // ë
        case 0x00E8:
            return 0x8A;  // è
        case 0x00EF:
            return 0x8B;  // ï
        case 0x00EE:
            return 0x8C;  // î
        case 0x00EC:
            return 0x8D;  // ì
        case 0x00C4:
            return 0x8E;  // Ä
        case 0x00C5:
            return 0x8F;  // Å
        case 0x00C9:
            return 0x90;  // É
        case 0x00E6:
            return 0x91;  // æ
        case 0x00C6:
            return 0x92;  // Æ
        case 0x00F6:
            return 0x93;  // ö
        case 0x00F4:
            return 0x94;  // ô
        case 0x00F2:
            return 0x95;  // ò
        case 0x00FB:
            return 0x96;  // û
        case 0x00F9:
            return 0x97;  // ù
        case 0x00D6:
            return 0x99;  // Ö
        case 0x00DC:
            return 0x9A;  // Ü
        case 0x00F8:
            return 0x9B;  // ø
        case 0x00A3:
            return 0x9C;  // £
        case 0x00D8:
            return 0x9D;  // Ø
        case 0x0130:
            return 0x98;  // İ (CP857)
        case 0x0131:
            return 0x8D;  // ı (CP857)
        case 0x015E:
            return 0x9E;  // Ş
        case 0x015F:
            return 0x9F;  // ş
        case 0x00E1:
            return 0xA0;  // á
        case 0x00ED:
            return 0xA1;  // í
        case 0x00F3:
            return 0xA2;  // ó
        case 0x00FA:
            return 0xA3;  // ú
        case 0x00F1:
            return 0xA4;  // ñ
        case 0x00D1:
            return 0xA5;  // Ñ
        case 0x011E:
            return 0xA6;  // Ğ
        case 0x011F:
            return 0xA7;  // ğ
        case 0x00BF:
            return 0xA8;  // ¿
        case 0x00AE:
            return 0xA9;  // ®
        case 0x00AC:
            return 0xAA;  // ¬
        case 0x00BD:
            return 0xAB;  // ½
        case 0x00BC:
            return 0xAC;  // ¼
        case 0x00A1:
            return 0xAD;  // ¡
        case 0x00AB:
            return 0xAE;  // «
        case 0x00BB:
            return 0xAF;  // »
        case 0x018F:
            return 'E';  // Ə → E: transliteration, only as a last resort
        case 0x0259:
            return 'e';  // ə → e
        case 0x20BC:      // ₼
        case 0x20BA:      // ₺
            return '?';
        default:
            return cp > 0x7F ? static_cast<std::uint8_t>('?') : static_cast<std::uint8_t>(cp);
    }
}

/**
 * Code points the code page can only approximate.
 *
 * The Azerbaijani schwa has no home in any single-byte thermal code page, and the
 * manat sign is equally absent, so their presence is what makes Auto pick raster.
 * Characters we emit ourselves purely for decoration (× and …) are expanded to
 * ASCII instead and do not count as loss.
 */
bool isLossyInCodePage(std::uint32_t cp) {
    switch (cp) {
        case 0x018F:  // Ə
        case 0x0259:  // ə
        case 0x20BC:  // ₼
        case 0x20BA:  // ₺
            return true;
        case 0x00D7:  // ×  → x
        case 0x2026:  // …  → ...
            return false;
        default:
            return cp > 0x7F && toCp857(cp) == '?';
    }
}

void appendCp857Text(std::vector<std::uint8_t>& out, std::string_view utf8) {
    for (std::size_t i = 0; i < utf8.size();) {
        const auto cp = nextCodepoint(utf8, i);
        if (cp == 0) break;
        if (cp == '\n') {
            out.push_back('\n');
            continue;
        }
        if (cp == '\r') continue;
        if (cp == 0x00D7) {
            out.push_back('x');
            continue;
        }
        if (cp == 0x2026) {
            append(out, {'.', '.', '.'});
            continue;
        }
        out.push_back(toCp857(cp));
    }
}

/**
 * Emits a QR block.
 *
 * Module size 6 on 80 mm and 5 on 58 mm keeps the symbol inside the printable
 * width with its quiet zone intact; error correction M survives the smudging a
 * thermal head produces on textured paper better than L does.
 */
void appendQr(std::vector<std::uint8_t>& out, const std::string& payload, PaperWidth paper) {
    const auto bitmap = qrBitmap(payload, paper);
    if (!bitmap.valid()) return;
    const auto bytes = encodeRaster(bitmap);
    out.insert(out.end(), bytes.begin(), bytes.end());
    out.push_back('\n');
}

/** Shared preamble: reset, alignment, code page, font and density. */
void appendHeader(std::vector<std::uint8_t>& out, const EscPosOptions& options) {
    append(out, {0x1B, 0x40});  // ESC @ — initialize
    append(out, {0x1B, 0x61, 0x00});  // ESC a 0 — left align
    append(out, {0x1B, 0x74, static_cast<std::uint8_t>(std::clamp(options.codePage, 0, 255))});
    append(out, {0x1B, 0x4D, 0x00});  // ESC M 0 — Font A
    const int density = std::clamp(options.density, 0, 8);
    append(out, {0x1B, 0x37, static_cast<std::uint8_t>(density)});
}

/** Center the MR brand mark on the paper width and emit GS v 0. */
void appendBrandLogo(std::vector<std::uint8_t>& out, const EscPosOptions& options) {
    const auto centered = fitLogo(options.logo, options.paperWidth);
    if (!centered.valid()) return;
    const auto raster = encodeRaster(centered);
    out.insert(out.end(), raster.begin(), raster.end());
    out.push_back('\n');
}

/** Shared epilogue: QR, feed, drawer pulse, beep, cut. */
void appendFooter(std::vector<std::uint8_t>& out, const EscPosOptions& options) {
    if (options.qr && !options.qrPayload.empty()) {
        append(out, {0x1B, 0x61, 0x01});  // center
        appendQr(out, options.qrPayload, options.paperWidth);
        append(out, {0x1B, 0x61, 0x00});
    }

    append(out, {0x1B, 0x64, static_cast<std::uint8_t>(std::clamp(options.feedLines, 0, 16))});

    if (options.openCashDrawer) {
        append(out, {0x1B, 0x70, 0x00, 0x19, 0xFA});  // ESC p 0 25 250
    }
    if (options.beep) {
        append(out, {0x1B, 0x42, 0x03, 0x02});  // ESC B 3 2
    }
    if (options.cut) {
        append(out, {0x1D, 0x56, 0x00});  // GS V 0 — full cut
    }
}

#ifdef _WIN32
struct WinsockOnce {
    WinsockOnce() {
        WSADATA data{};
        const int rc = WSAStartup(MAKEWORD(2, 2), &data);
        ok = (rc == 0);
        if (!ok) logger()->error("WSAStartup failed: {}", rc);
    }
    ~WinsockOnce() {
        if (ok) WSACleanup();
    }
    bool ok = false;
};

bool ensureWinsock() {
    static WinsockOnce once;
    return once.ok;
}
#endif

}  // namespace

bool codePageCovers(std::string_view utf8Text) {
    for (std::size_t i = 0; i < utf8Text.size();) {
        const auto cp = nextCodepoint(utf8Text, i);
        if (cp == 0) break;
        if (isLossyInCodePage(cp)) return false;
    }
    return true;
}

std::string unsupportedCharacters(std::string_view utf8Text) {
    std::string found;
    for (std::size_t i = 0; i < utf8Text.size();) {
        const std::size_t start = i;
        const auto cp = nextCodepoint(utf8Text, i);
        if (cp == 0) break;
        if (!isLossyInCodePage(cp)) continue;

        const std::string glyph(utf8Text.substr(start, i - start));
        if (found.find(glyph) == std::string::npos) {
            if (!found.empty()) found += " ";
            found += glyph;
        }
    }
    return found;
}

EscPosResult buildEscPosText(std::string_view utf8Text, const EscPosOptions& options) {
    EscPosResult result;
    result.usedMode = RenderMode::Text;
    result.transliterated = !codePageCovers(utf8Text);

    auto& out = result.bytes;
    out.reserve(utf8Text.size() + 256);

    appendHeader(out, options);
    appendBrandLogo(out, options);
    appendCp857Text(out, utf8Text);
    if (out.empty() || out.back() != '\n') out.push_back('\n');
    appendFooter(out, options);

    if (result.transliterated) {
        result.note = "code page cannot render: " + unsupportedCharacters(utf8Text);
    }
    return result;
}

EscPosResult buildEscPos(const std::vector<ReceiptLine>& lines, const EscPosOptions& options) {
    EscPosResult result;

    std::string joined;
    for (const auto& line : lines) joined += line.text;

    const bool covered = codePageCovers(joined);
    bool wantRaster = options.renderMode == RenderMode::Raster ||
                      (options.renderMode == RenderMode::Auto && !covered);

    if (wantRaster) {
        std::string error;
        const MonoBitmap bitmap = renderLinesToBitmap(
            lines, options.paperWidth,
            RasterOptions{options.charsPerLine, options.fontHeightPx, options.fontWidthPx,
                          options.sideMarginPx},
            error);
        if (bitmap.valid()) {
            auto& out = result.bytes;
            out.reserve(bitmap.bits.size() + 512);
            appendHeader(out, options);
            appendBrandLogo(out, options);
            const auto raster = encodeRaster(bitmap);
            out.insert(out.end(), raster.begin(), raster.end());
            appendFooter(out, options);

            result.usedMode = RenderMode::Raster;
            result.note = covered ? "raster requested"
                                  : "raster: code page cannot render " +
                                        unsupportedCharacters(joined);
            return result;
        }

        // Raster is the correct answer for Azerbaijani but must never be the
        // reason a paid order fails to produce a receipt; fall through to text.
        logger()->warn("raster render failed ({}), falling back to text", error);
        result.note = "raster unavailable (" + error + "), text fallback";
    }

    auto& out = result.bytes;
    out.reserve(joined.size() + 512);
    appendHeader(out, options);
    appendBrandLogo(out, options);

    for (const auto& line : lines) {
        if (line.qr) continue;  // handled in the footer, centred by the printer

        if (line.align == LineAlign::Center) append(out, {0x1B, 0x61, 0x01});
        else if (line.align == LineAlign::Right) append(out, {0x1B, 0x61, 0x02});

        if (line.doubleWidth) append(out, {0x1D, 0x21, 0x11});  // GS ! — 2x width & height
        if (line.bold) append(out, {0x1B, 0x45, 0x01});

        appendCp857Text(out, line.text);
        out.push_back('\n');

        if (line.bold) append(out, {0x1B, 0x45, 0x00});
        if (line.doubleWidth) append(out, {0x1D, 0x21, 0x00});
        if (line.align != LineAlign::Left) append(out, {0x1B, 0x61, 0x00});
    }

    appendFooter(out, options);

    result.usedMode = RenderMode::Text;
    result.transliterated = !covered;
    if (!covered && result.note.empty()) {
        result.note = "transliterated: " + unsupportedCharacters(joined);
    }
    return result;
}

std::vector<std::uint8_t> buildEscPosReceipt(std::string_view utf8Text,
                                             const EscPosOptions& options) {
    return buildEscPosText(utf8Text, options).bytes;
}

bool isNetworkPrinter(std::string_view printerName) {
    std::string host;
    int port = 0;
    return parseNetworkPrinter(printerName, host, port);
}

bool parseNetworkPrinter(std::string_view printerName, std::string& host, int& port) {
    host.clear();
    port = 9100;
    if (printerName.empty() || printerName == "virtual" || printerName == "offline" ||
        printerName == "auto") {
        return false;
    }
    if (printerName.rfind("usbraw:", 0) == 0 || printerName.rfind("serial:", 0) == 0) return false;

    std::string name(printerName);
    if (name.rfind("tcp:", 0) == 0) name = name.substr(4);
    else if (name.rfind("tcp://", 0) == 0) name = name.substr(6);

    const auto colon = name.rfind(':');
    if (colon != std::string::npos && colon + 1 < name.size()) {
        const std::string portStr = name.substr(colon + 1);
        bool digits = !portStr.empty();
        for (char c : portStr) {
            if (c < '0' || c > '9') {
                digits = false;
                break;
            }
        }
        if (digits) {
            host = name.substr(0, colon);
            port = std::stoi(portStr);
            return !host.empty() && port > 0 && port < 65536;
        }
    }

    // Bare IPv4
    int dots = 0;
    for (char c : name) {
        if (c == '.') dots++;
        else if (c < '0' || c > '9') return false;
    }
    if (dots == 3) {
        host = name;
        port = 9100;
        return true;
    }
    return false;
}

bool sendRawTcp(const std::string& host, int port, const std::vector<std::uint8_t>& payload,
                std::string& errorOut, int timeoutMs) {
#ifdef _WIN32
    if (!ensureWinsock()) {
        errorOut = "Winsock init failed";
        return false;
    }

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        errorOut = "socket() failed";
        return false;
    }

    DWORD tv = static_cast<DWORD>(timeoutMs);
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&tv), sizeof(tv));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<u_short>(port));
    if (InetPtonA(AF_INET, host.c_str(), &addr.sin_addr) != 1) {
        // try getaddrinfo
        addrinfo hints{};
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;
        addrinfo* result = nullptr;
        if (getaddrinfo(host.c_str(), nullptr, &hints, &result) != 0 || !result) {
            closesocket(sock);
            errorOut = "Invalid printer host: " + host;
            return false;
        }
        addr.sin_addr = reinterpret_cast<sockaddr_in*>(result->ai_addr)->sin_addr;
        freeaddrinfo(result);
    }

    if (connect(sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        errorOut = "Cannot connect to printer " + host + ":" + std::to_string(port);
        closesocket(sock);
        return false;
    }

    std::size_t sent = 0;
    while (sent < payload.size()) {
        const int n = send(sock, reinterpret_cast<const char*>(payload.data() + sent),
                           static_cast<int>(payload.size() - sent), 0);
        if (n <= 0) {
            errorOut = "Send to printer failed";
            closesocket(sock);
            return false;
        }
        sent += static_cast<std::size_t>(n);
    }

    closesocket(sock);
    logger()->info("ESC/POS sent {} bytes to {}:{}", payload.size(), host, port);
    return true;
#else
    (void)timeoutMs;
    errorOut = "Network printing is only implemented on Windows";
    (void)host;
    (void)port;
    (void)payload;
    return false;
#endif
}

bool parseWindowsPrinter(std::string_view printerName, std::string& windowsName) {
    windowsName.clear();
    if (printerName.empty() || printerName == "virtual" || printerName == "offline" ||
        printerName == "auto") {
        return false;
    }
    if (isNetworkPrinter(printerName)) return false;
    // The direct-device schemes are handled by their own senders; without this
    // guard the spooler would be asked to open a device path as a queue name.
    if (printerName.rfind("usbraw:", 0) == 0 || printerName.rfind("serial:", 0) == 0) return false;

    std::string name(printerName);
    if (name.rfind("win:", 0) == 0) {
        name = name.substr(4);
    } else if (name.rfind("usb:", 0) == 0) {
        name = name.substr(4);
    }

    // Trim
    while (!name.empty() && (name.front() == ' ' || name.front() == '\t')) name.erase(name.begin());
    while (!name.empty() && (name.back() == ' ' || name.back() == '\t')) name.pop_back();
    if (name.empty()) return false;

    windowsName = name;
    return true;
}

bool sendRawWindowsPrinter(const std::string& printerName, const std::vector<std::uint8_t>& payload,
                           std::string& errorOut) {
#ifdef _WIN32
    if (printerName.empty()) {
        errorOut = "Printer adı boşdur";
        return false;
    }
    if (payload.empty()) {
        errorOut = "Çap məlumatı boşdur";
        return false;
    }

    const int wideLen =
        MultiByteToWideChar(CP_UTF8, 0, printerName.c_str(), -1, nullptr, 0);
    if (wideLen <= 1) {
        errorOut = "Printer adı keçərsizdir";
        return false;
    }
    std::wstring wide(static_cast<std::size_t>(wideLen - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, printerName.c_str(), -1, wide.data(), wideLen);

    HANDLE printer = nullptr;
    if (!OpenPrinterW(wide.data(), &printer, nullptr) || !printer) {
        errorOut = "Printer açıla bilmədi: " + printerName + " (OpenPrinter)";
        return false;
    }

    DOC_INFO_1W doc{};
    doc.pDocName = const_cast<LPWSTR>(L"Milioner POS");
    doc.pOutputFile = nullptr;
    doc.pDatatype = const_cast<LPWSTR>(L"RAW");

    const DWORD jobId = StartDocPrinterW(printer, 1, reinterpret_cast<LPBYTE>(&doc));
    if (jobId == 0) {
        errorOut = "StartDocPrinter uğursuz oldu";
        ClosePrinter(printer);
        return false;
    }

    if (!StartPagePrinter(printer)) {
        errorOut = "StartPagePrinter uğursuz oldu";
        EndDocPrinter(printer);
        ClosePrinter(printer);
        return false;
    }

    DWORD written = 0;
    const BOOL ok = WritePrinter(printer, const_cast<std::uint8_t*>(payload.data()),
                                 static_cast<DWORD>(payload.size()), &written);
    EndPagePrinter(printer);
    EndDocPrinter(printer);
    ClosePrinter(printer);

    if (!ok || written != payload.size()) {
        errorOut = "WritePrinter uğursuz oldu (" + std::to_string(written) + "/" +
                   std::to_string(payload.size()) + ")";
        return false;
    }

    logger()->info("ESC/POS sent {} bytes to Windows printer '{}'", payload.size(), printerName);
    return true;
#else
    errorOut = "USB/Windows printing is only implemented on Windows";
    (void)printerName;
    (void)payload;
    return false;
#endif
}

bool parseUsbRawPrinter(std::string_view printerName, std::string& devicePath) {
    devicePath.clear();
    if (printerName.rfind("usbraw:", 0) != 0) return false;

    devicePath.assign(printerName.substr(7));
    while (!devicePath.empty() && (devicePath.front() == ' ' || devicePath.front() == '\t')) {
        devicePath.erase(devicePath.begin());
    }
    while (!devicePath.empty() && (devicePath.back() == ' ' || devicePath.back() == '\t')) {
        devicePath.pop_back();
    }
    return !devicePath.empty();
}

bool sendRawUsbDevice(const std::string& devicePath, const std::vector<std::uint8_t>& payload,
                      std::string& errorOut) {
#ifdef _WIN32
    if (devicePath.empty()) {
        errorOut = "USB cihaz yolu boşdur";
        return false;
    }
    if (payload.empty()) {
        errorOut = "Çap məlumatı boşdur";
        return false;
    }

    const int wideLen = MultiByteToWideChar(CP_UTF8, 0, devicePath.c_str(), -1, nullptr, 0);
    if (wideLen <= 1) {
        errorOut = "USB cihaz yolu keçərsizdir";
        return false;
    }
    std::wstring wide(static_cast<std::size_t>(wideLen - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, devicePath.c_str(), -1, wide.data(), wideLen);

    // FILE_SHARE_READ only: two concurrent writers would interleave ESC/POS
    // frames and produce one unreadable receipt instead of two readable ones.
    HANDLE device = CreateFileW(wide.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                                OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (device == INVALID_HANDLE_VALUE) {
        errorOut = "USB printer açıla bilmədi (kod " + std::to_string(GetLastError()) + ")";
        return false;
    }

    std::size_t sent = 0;
    while (sent < payload.size()) {
        // 4 KiB at a time: usbprint.sys rejects oversized single transfers on
        // some low-cost bridges, and a short write is retried rather than lost.
        const DWORD chunk =
            static_cast<DWORD>(std::min<std::size_t>(4096, payload.size() - sent));
        DWORD written = 0;
        if (!WriteFile(device, payload.data() + sent, chunk, &written, nullptr) || written == 0) {
            errorOut = "USB printerə yazıla bilmədi (kod " + std::to_string(GetLastError()) + ")";
            CloseHandle(device);
            return false;
        }
        sent += written;
    }

    FlushFileBuffers(device);
    CloseHandle(device);
    logger()->info("ESC/POS sent {} bytes to USB device '{}'", payload.size(), devicePath);
    return true;
#else
    errorOut = "USB printing is only implemented on Windows";
    (void)devicePath;
    (void)payload;
    return false;
#endif
}

bool parseSerialPrinter(std::string_view printerName, std::string& port, int& baud) {
    port.clear();
    baud = 9600;
    if (printerName.rfind("serial:", 0) != 0) return false;

    std::string rest(printerName.substr(7));
    const auto at = rest.rfind('@');
    if (at != std::string::npos && at + 1 < rest.size()) {
        const std::string baudStr = rest.substr(at + 1);
        bool digits = !baudStr.empty();
        for (char c : baudStr) {
            if (c < '0' || c > '9') {
                digits = false;
                break;
            }
        }
        if (digits) {
            baud = std::stoi(baudStr);
            rest = rest.substr(0, at);
        }
    }

    while (!rest.empty() && (rest.front() == ' ' || rest.front() == '\t')) rest.erase(rest.begin());
    while (!rest.empty() && (rest.back() == ' ' || rest.back() == '\t')) rest.pop_back();

    port = rest;
    return !port.empty() && baud > 0;
}

bool sendRawSerial(const std::string& port, int baud, const std::vector<std::uint8_t>& payload,
                   std::string& errorOut) {
#ifdef _WIN32
    if (port.empty()) {
        errorOut = "Serial port boşdur";
        return false;
    }

    // COM10 and above only resolve through the \\.\ device namespace.
    const std::string path = "\\\\.\\" + port;
    const int wideLen = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, nullptr, 0);
    std::wstring wide(static_cast<std::size_t>(wideLen - 1), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, wide.data(), wideLen);

    HANDLE device = CreateFileW(wide.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
                                FILE_ATTRIBUTE_NORMAL, nullptr);
    if (device == INVALID_HANDLE_VALUE) {
        errorOut = port + " açıla bilmədi (kod " + std::to_string(GetLastError()) + ")";
        return false;
    }

    DCB dcb{};
    dcb.DCBlength = sizeof(dcb);
    if (!GetCommState(device, &dcb)) {
        errorOut = "GetCommState uğursuz oldu";
        CloseHandle(device);
        return false;
    }
    dcb.BaudRate = static_cast<DWORD>(baud);
    dcb.ByteSize = 8;
    dcb.Parity = NOPARITY;
    dcb.StopBits = ONESTOPBIT;
    // Hardware flow control: thermal heads stall mid-receipt while the buffer
    // drains, and without RTS/CTS those bytes are silently dropped.
    dcb.fOutxCtsFlow = TRUE;
    dcb.fRtsControl = RTS_CONTROL_HANDSHAKE;
    if (!SetCommState(device, &dcb)) {
        errorOut = "SetCommState uğursuz oldu";
        CloseHandle(device);
        return false;
    }

    COMMTIMEOUTS timeouts{};
    timeouts.WriteTotalTimeoutConstant = 8000;
    timeouts.WriteTotalTimeoutMultiplier = 1;
    SetCommTimeouts(device, &timeouts);

    std::size_t sent = 0;
    while (sent < payload.size()) {
        DWORD written = 0;
        const DWORD chunk =
            static_cast<DWORD>(std::min<std::size_t>(1024, payload.size() - sent));
        if (!WriteFile(device, payload.data() + sent, chunk, &written, nullptr) || written == 0) {
            errorOut = port + " portuna yazıla bilmədi (kod " + std::to_string(GetLastError()) + ")";
            CloseHandle(device);
            return false;
        }
        sent += written;
    }

    FlushFileBuffers(device);
    CloseHandle(device);
    logger()->info("ESC/POS sent {} bytes to {} @ {} baud", payload.size(), port, baud);
    return true;
#else
    errorOut = "Serial printing is only implemented on Windows";
    (void)port;
    (void)baud;
    (void)payload;
    return false;
#endif
}

}  // namespace pos::printing
