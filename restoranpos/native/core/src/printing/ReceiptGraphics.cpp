#include "pos/printing/ReceiptGraphics.hpp"
#include "qrcodegen.hpp"
#include <algorithm>
#include <sstream>
#include <stdexcept>

namespace pos::printing {
namespace {
bool pixel(const MonoBitmap& b, int x, int y) {
    return (b.bits.at(static_cast<std::size_t>(y * b.stride + x / 8)) & (0x80 >> (x % 8))) != 0;
}
void dot(MonoBitmap& b, int x, int y) {
    b.bits[static_cast<std::size_t>(y * b.stride + x / 8)] |= static_cast<std::uint8_t>(0x80 >> (x % 8));
}
MonoBitmap blank(int w, int h) {
    MonoBitmap b; b.width = w; b.height = h; b.stride = (w + 7) / 8;
    b.bits.assign(static_cast<std::size_t>(b.stride) * h, 0); return b;
}
}
MonoBitmap fitLogo(const MonoBitmap& src, PaperWidth paper) {
    if (!src.valid()) return {};
    const int w = rasterDotWidth(paper);
    // Never crop a tall or wide mark. Limit height to half the head width.
    const double scale = std::min({1.0, double(w) / src.width, (w / 2.0) / src.height});
    const int dw = std::max(1, static_cast<int>(src.width * scale));
    const int dh = std::max(1, static_cast<int>(src.height * scale));
    auto out = blank(w, dh);
    for (int y = 0; y < dh; ++y)
        for (int x = 0; x < dw; ++x)
            if (pixel(src, std::min(src.width - 1, x * src.width / dw), std::min(src.height - 1, y * src.height / dh)))
                dot(out, x + (w - dw) / 2, y);
    return out;
}
MonoBitmap qrBitmap(const std::string& payload, PaperWidth paper) {
    if (payload.empty()) return {};
    // Byte-mode UTF-8: never truncate, normalize or append receipt data.
    const std::vector<std::uint8_t> bytes(payload.begin(), payload.end());
    const auto qr = qrcodegen::QrCode::encodeBinary(bytes, qrcodegen::QrCode::Ecc::MEDIUM);
    const int head = rasterDotWidth(paper), modules = qr.getSize() + 8;
    const int scale = std::min(std::max(3, paper.dpi / 40), head / modules);
    if (scale < 3) throw std::invalid_argument("QR link is too long for this printable width; use a shorter link");
    const int side = modules * scale;
    auto out = blank(head, side);
    const int offset = (head - side) / 2 + 4 * scale;
    for (int y = 0; y < qr.getSize(); ++y)
        for (int x = 0; x < qr.getSize(); ++x)
            if (qr.getModule(x, y))
                for (int dy = 0; dy < scale; ++dy)
                    for (int dx = 0; dx < scale; ++dx)
                        dot(out, offset + x * scale + dx, (y + 4) * scale + dy);
    return out;
}
std::string bitmapSvg(const MonoBitmap& bitmap) {
    if (!bitmap.valid()) return {};
    std::ostringstream out;
    out << "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " << bitmap.width << ' ' << bitmap.height
        << "\" role=\"img\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"white\"/><path fill=\"black\" d=\"";
    // Horizontal runs keep large raster receipts compact.
    for (int y = 0; y < bitmap.height; ++y) {
        for (int x = 0; x < bitmap.width;) {
            if (!pixel(bitmap, x, y)) { ++x; continue; }
            const int start = x;
            while (x < bitmap.width && pixel(bitmap, x, y)) ++x;
            out << 'M' << start << ' ' << y << 'h' << x-start << "v1h-" << x-start << 'z';
        }
    }
    out << "\"/></svg>"; return out.str();
}
std::string qrPreviewSvg(const std::string& payload, PaperWidth paper) {
    const auto full = qrBitmap(payload, paper);
    if (!full.valid()) return {};
    const int side = full.height;
    const int left = (full.width - side) / 2;
    auto square = blank(side, side);
    for (int y = 0; y < side; ++y)
        for (int x = 0; x < side; ++x)
            if (pixel(full, left + x, y)) dot(square, x, y);
    return bitmapSvg(square);
}
std::string receiptPreviewHtml(const ReceiptDocument& doc, const ReceiptSettings& config, const MonoBitmap& logo) {
    std::string error;
    const auto body = renderLinesToBitmap(formatReceipt(doc), doc.paperWidth,
        RasterOptions{doc.charsPerLine, config.fontHeightPx, config.fontWidthPx, config.sideMarginPx}, error);
    // This app prints on Windows. An unavailable raster must never produce a fake preview.
    if (!body.valid()) throw std::runtime_error("Receipt raster unavailable: " + error);
    std::ostringstream out;
    const double printableMm = rasterDotWidth(doc.paperWidth) * 25.4 / doc.paperWidth.dpi;
    const auto mark = fitLogo(logo, doc.paperWidth);
    out << "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
        << "*{box-sizing:border-box}body{margin:0;padding:16px 0;background:#e9edf3;display:flex;justify-content:center}"
        << ".paper{background:white;padding:12px 0;width:" << doc.paperWidth.mm << "mm;max-width:100%;}"
        << ".ink{width:" << printableMm / doc.paperWidth.mm * 100 << "%;margin:auto}"
        << "svg{display:block;width:100%;height:auto}.logo{margin-bottom:8px}"
        << "</style></head><body><div class=\"paper\"><div class=\"ink\">";
    if (mark.valid()) out << "<div class=\"logo\">" << bitmapSvg(mark) << "</div>";
    out << bitmapSvg(body);
    if (doc.printQr && !doc.qrPayload.empty()) out << bitmapSvg(qrBitmap(doc.qrPayload, doc.paperWidth));
    out << "</div></div></body></html>";
    return out.str();
}
}
