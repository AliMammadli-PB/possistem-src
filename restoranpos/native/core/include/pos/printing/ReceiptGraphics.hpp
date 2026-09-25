#pragma once
#include "pos/printing/ReceiptBuilder.hpp"

namespace pos::printing {
// The same bitmaps are embedded in the preview and sent to the printer.
MonoBitmap fitLogo(const MonoBitmap& source, PaperWidth paper);
MonoBitmap qrBitmap(const std::string& payload, PaperWidth paper);
std::string bitmapSvg(const MonoBitmap& bitmap);
// Crop the printer bitmap to its square quiet zone for the readable HTML preview.
std::string qrPreviewSvg(const std::string& payload, PaperWidth paper);
std::string receiptPreviewHtml(const ReceiptDocument& doc, const ReceiptSettings& config,
                               const MonoBitmap& logo);
}
