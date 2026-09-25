#include "pos/printing/RasterRenderer.hpp"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <memory>

#include "pos/Logging.hpp"

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

namespace pos::printing {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("printer");
    return log;
}

/** Splits UTF-8 into code points so each one can be placed in its own cell. */
std::vector<std::uint32_t> codepoints(const std::string& text) {
    std::vector<std::uint32_t> out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size();) {
        const auto c0 = static_cast<unsigned char>(text[i]);
        if (c0 < 0x80) {
            out.push_back(c0);
            i += 1;
        } else if ((c0 & 0xE0) == 0xC0 && i + 1 < text.size()) {
            out.push_back(((c0 & 0x1Fu) << 6) | (static_cast<unsigned char>(text[i + 1]) & 0x3Fu));
            i += 2;
        } else if ((c0 & 0xF0) == 0xE0 && i + 2 < text.size()) {
            out.push_back(((c0 & 0x0Fu) << 12) |
                          ((static_cast<unsigned char>(text[i + 1]) & 0x3Fu) << 6) |
                          (static_cast<unsigned char>(text[i + 2]) & 0x3Fu));
            i += 3;
        } else if ((c0 & 0xF8) == 0xF0 && i + 3 < text.size()) {
            out.push_back(((c0 & 0x07u) << 18) |
                          ((static_cast<unsigned char>(text[i + 1]) & 0x3Fu) << 12) |
                          ((static_cast<unsigned char>(text[i + 2]) & 0x3Fu) << 6) |
                          ((static_cast<unsigned char>(text[i + 3]) & 0x3Fu)));
            i += 4;
        } else {
            out.push_back('?');
            i += 1;
        }
    }
    return out;
}

#ifdef _WIN32

/** UTF-16 for GDI, with surrogate pairs for anything outside the BMP. */
std::vector<wchar_t> toUtf16(const std::vector<std::uint32_t>& cps) {
    std::vector<wchar_t> out;
    out.reserve(cps.size());
    for (auto cp : cps) {
        if (cp <= 0xFFFF) {
            out.push_back(static_cast<wchar_t>(cp));
        } else {
            const std::uint32_t v = cp - 0x10000;
            out.push_back(static_cast<wchar_t>(0xD800 + (v >> 10)));
            out.push_back(static_cast<wchar_t>(0xDC00 + (v & 0x3FF)));
        }
    }
    return out;
}

/**
 * Fixed-cell thermal font. lfWidth is forced so glyphs fit the column grid —
 * never enlarge the grid to match a proportional face (that stretched receipts).
 */
HFONT makeFont(int cellWidth, int cellHeight, bool bold) {
    LOGFONTW lf{};
    lf.lfHeight = -cellHeight;
    // Fill most of the cell so thermal glyphs stay bold and readable.
    lf.lfWidth = std::max(4, (cellWidth * 92) / 100);
    lf.lfWeight = bold ? FW_BOLD : FW_NORMAL;
    lf.lfCharSet = DEFAULT_CHARSET;
    lf.lfOutPrecision = OUT_TT_PRECIS;
    lf.lfClipPrecision = CLIP_DEFAULT_PRECIS;
    lf.lfQuality = NONANTIALIASED_QUALITY;
    lf.lfPitchAndFamily = FIXED_PITCH | FF_MODERN;

    for (const wchar_t* face :
         {L"Consolas", L"Cascadia Mono", L"Lucida Console", L"Courier New", L"Segoe UI",
          L"Arial", L"Tahoma"}) {
        wcscpy_s(lf.lfFaceName, LF_FACESIZE, face);
        HFONT font = CreateFontIndirectW(&lf);
        if (font) return font;
    }
    return nullptr;
}

int sideMarginDots(PaperWidth paper) { return paper == PaperWidth::Mm58 ? 16 : 24; }

#endif  // _WIN32

}  // namespace

int rasterDotWidth(PaperWidth paper) { return printableDotWidth(paper); }

bool rasterAvailable() {
#ifdef _WIN32
    return true;
#else
    return false;
#endif
}

#ifdef _WIN32

MonoBitmap renderLinesToBitmap(const std::vector<ReceiptLine>& lines, PaperWidth paper,
                               const RasterOptions& options, std::string& errorOut) {
    MonoBitmap image;
    if (options.charsPerLine <= 0) {
        errorOut = "charsPerLine must be positive";
        return image;
    }

    const int dotWidth = rasterDotWidth(paper);
    const int margin = options.sideMarginPx > 0 ? options.sideMarginPx : sideMarginDots(paper);
    const int usableWidth = std::max(64, dotWidth - margin * 2);

    // Fewer columns → larger cells. Prefer readable strokes over cramming.
    const int cols = std::clamp(options.charsPerLine, 16, std::max(16, usableWidth / 8));
    int cellWidth = std::max(8, usableWidth / cols);
    int cellHeight = std::max(16, (cellWidth * 2));  // ~2:1 tall glyphs, easy to read
    if (options.fontWidthPx > 0) cellWidth = std::clamp(options.fontWidthPx, 1, usableWidth / cols);
    if (options.fontHeightPx > 0) cellHeight = std::clamp(options.fontHeightPx, 12, 96);

    struct Row {
        const ReceiptLine* line;
        int height;
    };
    std::vector<Row> rows;
    rows.reserve(lines.size());
    int totalHeight = 0;
    for (const auto& line : lines) {
        if (line.qr) continue;
        const int height = line.doubleWidth ? cellHeight * 2 : cellHeight;
        rows.push_back({&line, height});
        totalHeight += height;
    }
    if (rows.empty()) {
        errorOut = "nothing to rasterise";
        return image;
    }

    const int padY = std::max(2, cellHeight / 6);
    totalHeight += padY * 2;

    const int stride = (dotWidth + 7) / 8;

    BITMAPINFO* info = static_cast<BITMAPINFO*>(
        std::calloc(1, sizeof(BITMAPINFOHEADER) + 2 * sizeof(RGBQUAD)));
    if (!info) {
        errorOut = "out of memory";
        return image;
    }
    info->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info->bmiHeader.biWidth = dotWidth;
    info->bmiHeader.biHeight = -totalHeight;
    info->bmiHeader.biPlanes = 1;
    info->bmiHeader.biBitCount = 1;
    info->bmiHeader.biCompression = BI_RGB;
    info->bmiColors[0] = RGBQUAD{0xFF, 0xFF, 0xFF, 0};
    info->bmiColors[1] = RGBQUAD{0x00, 0x00, 0x00, 0};

    HDC screen = GetDC(nullptr);
    HDC dc = CreateCompatibleDC(screen);
    ReleaseDC(nullptr, screen);
    if (!dc) {
        std::free(info);
        errorOut = "CreateCompatibleDC failed";
        return image;
    }

    void* pixels = nullptr;
    HBITMAP bitmap = CreateDIBSection(dc, info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap || !pixels) {
        DeleteDC(dc);
        std::free(info);
        errorOut = "CreateDIBSection failed";
        return image;
    }

    HGDIOBJ oldBitmap = SelectObject(dc, bitmap);

    RECT all{0, 0, dotWidth, totalHeight};
    HBRUSH white = CreateSolidBrush(RGB(255, 255, 255));
    FillRect(dc, &all, white);
    DeleteObject(white);

    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, RGB(0, 0, 0));
    SetTextAlign(dc, TA_LEFT | TA_TOP);

    HFONT fonts[4] = {
        makeFont(cellWidth, cellHeight, false),
        makeFont(cellWidth, cellHeight, true),
        makeFont(cellWidth * 2, cellHeight * 2, false),
        makeFont(cellWidth * 2, cellHeight * 2, true),
    };
    if (!fonts[0]) {
        SelectObject(dc, oldBitmap);
        DeleteObject(bitmap);
        DeleteDC(dc);
        std::free(info);
        errorOut = "no fixed-pitch system font available";
        return image;
    }

    int y = padY;
    for (const auto& row : rows) {
        const ReceiptLine& line = *row.line;
        if (!line.text.empty()) {
            const int advance = line.doubleWidth ? cellWidth * 2 : cellWidth;
            const int columns = line.doubleWidth ? cols / 2 : cols;

            const auto cps = codepoints(line.text);
            int startColumn = 0;
            if (line.align == LineAlign::Center) {
                startColumn = std::max(0, (columns - static_cast<int>(cps.size())) / 2);
            } else if (line.align == LineAlign::Right) {
                startColumn = std::max(0, columns - static_cast<int>(cps.size()));
            }

            const int index = (line.doubleWidth ? 2 : 0) + (line.bold ? 1 : 0);
            HFONT font = fonts[index] ? fonts[index] : fonts[0];
            HGDIOBJ oldFont = SelectObject(dc, font);

            const auto wide = toUtf16(cps);
            std::vector<INT> dx(wide.size(), advance);
            for (std::size_t i = 0; i + 1 < wide.size(); ++i) {
                if (wide[i] >= 0xD800 && wide[i] <= 0xDBFF) {
                    dx[i] = advance;
                    dx[i + 1] = 0;
                }
            }

            const int x = margin + startColumn * advance;
            RECT clip{margin, y, margin + usableWidth, y + row.height};
            ExtTextOutW(dc, x, y, ETO_CLIPPED, &clip, wide.data(),
                        static_cast<UINT>(wide.size()), dx.data());
            SelectObject(dc, oldFont);
        }
        y += row.height;
    }

    GdiFlush();

    image.width = dotWidth;
    image.height = totalHeight;
    image.stride = stride;
    image.bits.assign(static_cast<std::size_t>(stride) * totalHeight, 0);

    const int dibStride = ((dotWidth + 31) / 32) * 4;
    const auto* src = static_cast<const std::uint8_t*>(pixels);
    for (int r = 0; r < totalHeight; ++r) {
        std::memcpy(image.bits.data() + static_cast<std::size_t>(r) * stride,
                    src + static_cast<std::size_t>(r) * dibStride, static_cast<std::size_t>(stride));
    }

    for (HFONT font : fonts) {
        if (font) DeleteObject(font);
    }
    SelectObject(dc, oldBitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
    std::free(info);

    logger()->debug("rasterised receipt {}x{} dots ({} bytes, cell {}x{}, cols {})", image.width,
                    image.height, image.bits.size(), cellWidth, cellHeight, cols);
    return image;
}

#else  // !_WIN32

MonoBitmap renderLinesToBitmap(const std::vector<ReceiptLine>&, PaperWidth, const RasterOptions&,
                               std::string& errorOut) {
    errorOut = "raster rendering is only implemented on Windows";
    return {};
}

#endif  // _WIN32

std::vector<std::uint8_t> encodeRaster(const MonoBitmap& bitmap, int bandRows) {
    std::vector<std::uint8_t> out;
    if (!bitmap.valid()) return out;

    const int band = std::clamp(bandRows, 8, 255);
    out.reserve(bitmap.bits.size() + static_cast<std::size_t>(bitmap.height / band + 1) * 8);

    out.insert(out.end(), {0x1B, 0x61, 0x00});

    for (int row = 0; row < bitmap.height; row += band) {
        const int rows = std::min(band, bitmap.height - row);
        const int widthBytes = bitmap.stride;

        out.insert(out.end(), {0x1D, 0x76, 0x30, 0x00});
        out.push_back(static_cast<std::uint8_t>(widthBytes & 0xFF));
        out.push_back(static_cast<std::uint8_t>((widthBytes >> 8) & 0xFF));
        out.push_back(static_cast<std::uint8_t>(rows & 0xFF));
        out.push_back(static_cast<std::uint8_t>((rows >> 8) & 0xFF));

        const auto begin = bitmap.bits.begin() + static_cast<std::size_t>(row) * widthBytes;
        out.insert(out.end(), begin, begin + static_cast<std::size_t>(rows) * widthBytes);
    }

    return out;
}

}  // namespace pos::printing
