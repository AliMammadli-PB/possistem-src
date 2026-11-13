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
HFONT makeFontFace(int cellWidth, int cellHeight, bool bold, const wchar_t* face) {
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
    wcscpy_s(lf.lfFaceName, LF_FACESIZE, face);
    return CreateFontIndirectW(&lf);
}

/** True when the font selected into dc has a real glyph for each UTF-16 unit (surrogates count as present). */
bool hasGlyphs(HDC dc, const std::wstring& text, std::vector<bool>* present = nullptr) {
    std::vector<WORD> glyphs(text.size(), 0);
    if (text.empty()) return true;
    if (GetGlyphIndicesW(dc, text.data(), static_cast<int>(text.size()), glyphs.data(),
                         GGI_MARK_NONEXISTING_GLYPHS) == GDI_ERROR) {
        return true;
    }
    bool all = true;
    if (present) present->assign(text.size(), true);
    for (std::size_t i = 0; i < text.size(); ++i) {
        const bool surrogate = text[i] >= 0xD800 && text[i] <= 0xDFFF;
        if (!surrogate && glyphs[i] == 0xFFFF) {
            all = false;
            if (present) (*present)[i] = false;
        }
    }
    return all;
}

// Letters a receipt cannot do without. Windows (and Wine) quietly substitute a missing face,
// so a face counts only when it is really installed and draws these itself.
const wchar_t* const kNeeded = L"\u018F\u0259\u015E\u015F\u011E\u011F\u00C7\u00E7\u00D6\u00F6\u00DC\u00FC\u0130\u0131";

/**
 * Fixed-cell thermal font. lfWidth is forced so glyphs fit the column grid —
 * never enlarge the grid to match a proportional face (that stretched receipts).
 * The first installed face that has every Azerbaijani letter wins; otherwise the first installed face.
 */
HFONT makeFont(int cellWidth, int cellHeight, bool bold) {
    HDC probe = CreateCompatibleDC(nullptr);
    HFONT fallback = nullptr;
    for (const wchar_t* face :
         {L"Consolas", L"Cascadia Mono", L"Lucida Console", L"Courier New", L"Segoe UI",
          L"Arial", L"Tahoma"}) {
        HFONT font = makeFontFace(cellWidth, cellHeight, bold, face);
        if (!font) continue;
        if (!probe) return font;
        HGDIOBJ old = SelectObject(probe, font);
        wchar_t actual[LF_FACESIZE] = {};
        GetTextFaceW(probe, LF_FACESIZE, actual);
        const bool installed = _wcsicmp(actual, face) == 0;
        const bool complete = installed && hasGlyphs(probe, kNeeded);
        SelectObject(probe, old);
        if (complete) {
            if (fallback) DeleteObject(fallback);
            DeleteDC(probe);
            return font;
        }
        if (!fallback) fallback = font;
        else DeleteObject(font);
    }
    if (probe) DeleteDC(probe);
    return fallback;
}

/** A font for one character the receipt font lacks, or nullptr. */
HFONT makeFallbackFor(HDC dc, wchar_t ch, int cellWidth, int cellHeight, bool bold) {
    const std::wstring one(1, ch);
    for (const wchar_t* face : {L"Segoe UI", L"Arial", L"Tahoma", L"Courier New", L"Consolas",
                                L"Lucida Console", L"Cascadia Mono", L"DejaVu Sans Mono", L"DejaVu Sans"}) {
        HFONT font = makeFontFace(cellWidth, cellHeight, bold, face);
        if (!font) continue;
        HGDIOBJ old = SelectObject(dc, font);
        const bool ok = hasGlyphs(dc, one);
        SelectObject(dc, old);
        if (ok) return font;
        DeleteObject(font);
    }
    return nullptr;
}

/** ₼ drawn with lines when no installed font has it: an arch over a vertical stroke, like the printed sign. */
void drawManat(HDC dc, int x, int y, int cellWidth, int cellHeight, bool bold) {
    const int pen = std::max(1, cellWidth / (bold ? 5 : 7));
    HPEN line = CreatePen(PS_SOLID, pen, RGB(0, 0, 0));
    HGDIOBJ old = SelectObject(dc, line);
    const int left = x + cellWidth / 8, right = x + cellWidth - cellWidth / 8;
    const int top = y + cellHeight * 3 / 10, bottom = y + cellHeight * 8 / 10;
    const int mid = x + cellWidth / 2;
    // Arch: the top half of an ellipse spanning the cell, legs down to the baseline.
    Arc(dc, left, top, right, bottom + (bottom - top), right, top + (bottom - top), left, top + (bottom - top));
    MoveToEx(dc, left, top + (bottom - top), nullptr);
    LineTo(dc, left, bottom);
    MoveToEx(dc, right - 1, top + (bottom - top), nullptr);
    LineTo(dc, right - 1, bottom);
    MoveToEx(dc, mid, y + cellHeight * 2 / 10, nullptr);
    LineTo(dc, mid, bottom);
    SelectObject(dc, old);
    DeleteObject(line);
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
            std::vector<bool> present;
            if (hasGlyphs(dc, std::wstring(wide.begin(), wide.end()), &present)) {
                ExtTextOutW(dc, x, y, ETO_CLIPPED, &clip, wide.data(),
                            static_cast<UINT>(wide.size()), dx.data());
            } else {
                // The receipt font lacks some letters (₼, Ə…): those cells are drawn from another font, or by hand.
                std::wstring gaps(wide.begin(), wide.end());
                for (std::size_t i = 0; i < gaps.size(); ++i) if (!present[i]) gaps[i] = L' ';
                ExtTextOutW(dc, x, y, ETO_CLIPPED, &clip, gaps.data(), static_cast<UINT>(gaps.size()), dx.data());
                int cellX = x;
                for (std::size_t i = 0; i < wide.size(); cellX += dx[i], ++i) {
                    if (present[i]) continue;
                    const int glyphHeight = line.doubleWidth ? cellHeight * 2 : cellHeight;
                    if (HFONT spare = makeFallbackFor(dc, wide[i], advance, glyphHeight, line.bold)) {
                        HGDIOBJ previous = SelectObject(dc, spare);
                        INT one = advance;
                        ExtTextOutW(dc, cellX, y, ETO_CLIPPED, &clip, &wide[i], 1, &one);
                        SelectObject(dc, previous);
                        DeleteObject(spare);
                    } else if (wide[i] == 0x20BC) {
                        drawManat(dc, cellX, y, advance, glyphHeight, line.bold);
                    } else {
                        logger()->warn("raster: no installed font draws U+{:04X}", static_cast<unsigned>(wide[i]));
                    }
                }
            }
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
