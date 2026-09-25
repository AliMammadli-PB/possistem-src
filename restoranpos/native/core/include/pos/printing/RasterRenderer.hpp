#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "pos/printing/ReceiptFormatter.hpp"

namespace pos::printing {

/**
 * A 1-bit-per-pixel image, top-down, one set bit per fired dot.
 *
 * Row stride is exactly (width + 7) / 8 bytes, which is the layout ESC/POS
 * `GS v 0` expects, so no repacking happens at send time.
 */
struct MonoBitmap {
    int width = 0;
    int height = 0;
    int stride = 0;
    std::vector<std::uint8_t> bits;

    bool valid() const { return width > 0 && height > 0 && !bits.empty(); }
};

/** Printable dot width for a paper size, at the usual 203 dpi head. */
int rasterDotWidth(PaperWidth paper);

/** True when this build can rasterise text at all. */
bool rasterAvailable();

/** Optional overrides for cell / glyph sizing (0 = auto). */
struct RasterOptions {
    int charsPerLine = 40;
    int fontHeightPx = 0;
    int fontWidthPx = 0;
    int sideMarginPx = 0;
};

/**
 * Draws the formatted lines onto a monochrome bitmap.
 *
 * Uses a fixed-pitch system font (Consolas, then Courier New) rendered with
 * antialiasing disabled, so every glyph lands on the dot grid and stays sharp on
 * a 203 dpi thermal head. No font file is loaded from disk or the network.
 *
 * Characters are placed on an explicit cell grid rather than by font advance, so
 * the raster output aligns column for column with the text output.
 */
MonoBitmap renderLinesToBitmap(const std::vector<ReceiptLine>& lines, PaperWidth paper,
                               const RasterOptions& options, std::string& errorOut);

inline MonoBitmap renderLinesToBitmap(const std::vector<ReceiptLine>& lines, PaperWidth paper,
                                      int charsPerLine, std::string& errorOut) {
    return renderLinesToBitmap(lines, paper, RasterOptions{charsPerLine, 0, 0, 0}, errorOut);
}

/** ESC/POS `GS v 0` blocks for a bitmap, banded so cheap firmware keeps up. */
std::vector<std::uint8_t> encodeRaster(const MonoBitmap& bitmap, int bandRows = 128);

}  // namespace pos::printing
