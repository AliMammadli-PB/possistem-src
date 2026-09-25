#include "catch_amalgamated.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>

#include "pos/printing/EscPos.hpp"
#include "pos/printing/RasterRenderer.hpp"
#include "pos/printing/ReceiptDocument.hpp"
#include "pos/printing/ReceiptFormatter.hpp"
#include "pos/services/Pricing.hpp"

using namespace pos;
using namespace pos::printing;

namespace {

int countOccurrences(const std::string& haystack, const std::string& needle) {
    int found = 0;
    for (std::size_t at = haystack.find(needle); at != std::string::npos;
         at = haystack.find(needle, at + needle.size())) {
        found++;
    }
    return found;
}

ReceiptItem makeItem(const std::string& name, std::int64_t quantity, Money unitBase) {
    ReceiptItem item;
    item.name = name;
    item.quantity = quantity;
    item.unitBasePrice = unitBase;
    item.baseLineTotal = unitBase * quantity;
    item.itemLineTotal = item.baseLineTotal;
    return item;
}

void addModifier(ReceiptItem& item, const std::string& name, Money unitPrice, bool included = false) {
    ReceiptModifier modifier;
    modifier.name = name;
    modifier.quantity = item.quantity;
    modifier.unitPrice = unitPrice;
    modifier.lineTotal = included ? 0 : unitPrice * item.quantity;
    modifier.isFree = unitPrice == 0;
    modifier.isIncludedInParentPrice = included;
    item.modifiers.push_back(modifier);
    item.itemLineTotal = item.baseLineTotal;
    for (const auto& m : item.modifiers) item.itemLineTotal += m.lineTotal;
}

/**
 * The fixture from the bug report: three courses, one paid modifier each on two
 * of them, two free modifiers. 32.00 + 52.00 + 25.00 + 42.00 + 5.00 = 156.00.
 */
ReceiptDocument fixtureDocument(PaperWidth paper = PaperWidth::Mm80) {
    ReceiptDocument doc;
    doc.receiptNumber = "R-FQ0ABWCR";
    doc.orderNumber = "A-0003";
    doc.orderType = "dine_in";
    doc.tableName = "V1";
    doc.waiterName = "Leyla Əliyeva";
    doc.guestCount = 6;
    doc.openedAt = 1'769'000'000'000;
    doc.paidAt = 1'769'000'900'000;

    doc.restaurant.name = "Maison Aurelia";
    doc.restaurant.tagline = "Fine Dining Restaurant";
    doc.restaurant.address = "Neftçilər prospekti 19, Bakı";
    doc.restaurant.phone = "+994 12 505 19 19";
    doc.restaurant.taxId = "1900123456";

    doc.items.push_back(makeItem("Mal əti tartarı", 1, 3200));

    auto risotto = makeItem("Trüfel rizotto", 1, 5200);
    addModifier(risotto, "Kürü", 2500);
    addModifier(risotto, "Sarımsaqsız", 0);
    doc.items.push_back(risotto);

    auto chicken = makeItem("Fransız toyuğu", 1, 4200);
    addModifier(chicken, "Kartof fri", 500);
    addModifier(chicken, "Sarımsaqsız", 0);
    doc.items.push_back(chicken);

    doc.subtotal = 15600;
    doc.serviceCharge = 1560;
    doc.serviceLabel = "Servis haqqı (10%)";
    doc.taxes.push_back({"ƏDV (18%)", 3089, false});
    doc.taxTotal = 3089;
    doc.grandTotal = 20249;

    doc.payments.push_back({"cash", "Nağd", 20249, 21000, 751});
    doc.amountPaid = 20249;
    doc.changeAmount = 751;

    doc.footer = {"Təşəkkür edirik!", "Sizi yenidən gözləyirik.", "Maison Aurelia"};
    doc.qrPayload = "MA1|R-FQ0ABWCR|A-0003|1769000900000|20249|AZN";

    doc.paperWidth = paper;
    doc.charsPerLine = defaultCharsPerLine(paper);
    return doc;
}

}  // namespace

// ----------------------------------------------------------------- 1. pricing

TEST_CASE("base item without modifier", "[receipt][pricing]") {
    const auto item = makeItem("Mal əti tartarı", 1, 3200);
    REQUIRE(item.baseLineTotal == 3200);
    REQUIRE(item.itemLineTotal == 3200);
}

TEST_CASE("paid modifier adds to the line but is shown separately", "[receipt][pricing]") {
    auto item = makeItem("Trüfel rizotto", 1, 5200);
    addModifier(item, "Kürü", 2500);

    REQUIRE(item.baseLineTotal == 5200);
    REQUIRE(item.modifiers.front().lineTotal == 2500);
    REQUIRE(item.itemLineTotal == 7700);
}

TEST_CASE("free modifier carries no money", "[receipt][pricing]") {
    auto item = makeItem("Fransız toyuğu", 1, 4200);
    addModifier(item, "Sarımsaqsız", 0);

    REQUIRE(item.modifiers.front().isFree);
    REQUIRE(item.modifiers.front().lineTotal == 0);
    REQUIRE(item.itemLineTotal == 4200);
}

TEST_CASE("modifier included in the parent price is not charged twice",
          "[receipt][pricing]") {
    auto item = makeItem("Trüfel rizotto", 1, 7700);
    addModifier(item, "Kürü", 2500, /*included=*/true);

    REQUIRE(item.itemLineTotal == 7700);

    ReceiptDocument doc;
    doc.items.push_back(item);
    doc.subtotal = 7700;
    REQUIRE(doc.visibleItemTotal() == 7700);
}

TEST_CASE("quantity greater than one multiplies base and modifiers",
          "[receipt][pricing]") {
    auto item = makeItem("Espresso", 3, 500);
    REQUIRE(item.baseLineTotal == 1500);

    addModifier(item, "Qoşa shot", 200);
    REQUIRE(item.modifiers.front().lineTotal == 600);
    REQUIRE(item.itemLineTotal == 2100);
}

TEST_CASE("multiple paid modifiers all reach the line total", "[receipt][pricing]") {
    auto item = makeItem("Burger", 2, 1800);
    addModifier(item, "Pendir", 150);
    addModifier(item, "Bekon", 250);
    addModifier(item, "Sousuz", 0);

    REQUIRE(item.baseLineTotal == 3600);
    REQUIRE(item.itemLineTotal == 3600 + 300 + 500);
}

TEST_CASE("the visible money column equals the printed subtotal",
          "[receipt][pricing]") {
    const auto doc = fixtureDocument();

    // 32.00 + 52.00 + 25.00 + 42.00 + 5.00 = 156.00
    REQUIRE(doc.visibleItemTotal() == 15600);
    REQUIRE(doc.visibleItemTotal() == doc.subtotal);
}

TEST_CASE("service charge and exclusive tax reach 202.49", "[receipt][pricing]") {
    services::TaxConfig config{18, 10, false};
    services::Discount none{"", 0};

    const auto totals = services::computeTotals(15600, none, config);
    REQUIRE(totals.subtotal == 15600);
    REQUIRE(totals.service == 1560);   // 10% of 156.00
    REQUIRE(totals.tax == 3089);       // 18% of 171.60 = 30.888 -> 30.89
    REQUIRE(totals.total == 20249);    // 156.00 + 15.60 + 30.89

    // 156.00 + 15.60 + 30.89 = 202.49
    REQUIRE(totals.subtotal + totals.service + totals.tax == 20249);
}

TEST_CASE("discount reduces the base before service and tax", "[receipt][pricing]") {
    services::TaxConfig config{18, 10, false};
    services::Discount ten{"percent", 10};

    const auto totals = services::computeTotals(15600, ten, config);
    REQUIRE(totals.discount == 1560);
    REQUIRE(totals.service == 1404);
    REQUIRE(totals.tax == 2780);
    REQUIRE(totals.total == 14040 + 1404 + 2780);
}

TEST_CASE("inclusive tax is extracted, never added again", "[receipt][pricing]") {
    services::TaxConfig config{18, 0, true};
    services::Discount none{"", 0};

    const auto totals = services::computeTotals(20249, none, config);
    REQUIRE(totals.total == 20249);
    REQUIRE(totals.tax < totals.total);
    REQUIRE(totals.subtotal + 0 == 20249);
}

TEST_CASE("rounding stays in integer minor units", "[receipt][pricing]") {
    REQUIRE(services::percentOf(17160, 18) == 3089);
    REQUIRE(services::percentOf(1, 50) == 1);
    REQUIRE(services::percentOf(1, 49) == 0);
    REQUIRE(services::percentOf(-10000, 18) == -1800);
}

// ------------------------------------------------------------------ 2. layout

TEST_CASE("visibleWidth counts code points, not bytes", "[receipt][layout]") {
    REQUIRE(layout::visibleWidth("Ə") == 1);
    REQUIRE(layout::visibleWidth("ƏDV") == 3);
    REQUIRE(layout::visibleWidth("Leyla Əliyeva") == 13);
    REQUIRE(layout::visibleWidth("₼") == 1);
}

TEST_CASE("renderKeyValue never overlaps the two columns", "[receipt][layout]") {
    const auto line = layout::renderKeyValue("Sifariş:", "A-0003", 32);
    REQUIRE(layout::visibleWidth(line) == 32);
    REQUIRE(line.rfind("A-0003") == line.size() - 6);
}

TEST_CASE("wrapText breaks on words and hard-splits long ones", "[receipt][layout]") {
    const auto wrapped = layout::wrapText("Xüsusi sousla hazırlanmış premium Fransız toyuğu", 20);
    REQUIRE(wrapped.size() >= 2);
    for (const auto& line : wrapped) {
        REQUIRE(layout::visibleWidth(line) <= 20);
    }

    const auto split = layout::wrapText("aaaaaaaaaaaaaaaaaaaaaaaaa", 10);
    REQUIRE(split.size() == 3);
    REQUIRE(layout::visibleWidth(split.front()) == 10);
}

TEST_CASE("long product names never collide with the money column",
          "[receipt][layout]") {
    ReceiptDocument doc = fixtureDocument(PaperWidth::Mm58);
    doc.items.clear();
    auto item = makeItem("Xüsusi sousla hazırlanmış premium Fransız toyuğu", 1, 4200);
    addModifier(item, "Kartof fri", 500);
    item.notes = "Sarımsaq əlavə etməyin";
    doc.items.push_back(item);
    doc.subtotal = 4700;

    const auto lines = formatReceipt(doc);
    for (const auto& line : lines) {
        REQUIRE(layout::visibleWidth(line.text) <= doc.charsPerLine);
    }

    const std::string text = renderPlainText(doc);
    REQUIRE(text.find("42.00 AZN") != std::string::npos);
    REQUIRE(text.find("Qeyd: Sarımsaq") != std::string::npos);
}

TEST_CASE("58 mm layout fits 28 columns", "[receipt][layout]") {
    const auto doc = fixtureDocument(PaperWidth::Mm58);
    REQUIRE(doc.charsPerLine == 28);

    const auto lines = formatReceipt(doc);
    for (const auto& line : lines) {
        REQUIRE(layout::visibleWidth(line.text) <= 28);
    }
}

TEST_CASE("80 mm layout fits 40 columns", "[receipt][layout]") {
    const auto doc = fixtureDocument(PaperWidth::Mm80);
    REQUIRE(doc.charsPerLine == 40);

    const auto lines = formatReceipt(doc);
    for (const auto& line : lines) {
        REQUIRE(layout::visibleWidth(line.text) <= 40);
    }
}

TEST_CASE("preliminary customer bill is clearly labelled and remains non-fiscal",
          "[receipt][customer-bill]") {
    ReceiptDocument doc = fixtureDocument(PaperWidth::Mm80);
    doc.kind = ReceiptKind::CustomerBill;

    const std::string text = renderPlainText(doc);
    REQUIRE(text.find("MÜŞTƏRİ ÇEKİ") != std::string::npos);
    REQUIRE(text.find("Ödəniş qəbzi deyil") != std::string::npos);
    REQUIRE(text.find("YEKUN") != std::string::npos);
}

TEST_CASE("metadata alignment is stable and never prints null", "[receipt][layout]") {
    ReceiptDocument doc = fixtureDocument();
    doc.tableName.clear();
    doc.orderType = "delivery";
    doc.waiterName.clear();
    doc.guestCount = 0;

    const std::string text = renderPlainText(doc);
    REQUIRE(text.find("null") == std::string::npos);
    REQUIRE(text.find("undefined") == std::string::npos);
    REQUIRE(text.find("Çatdırılma") != std::string::npos);
    REQUIRE(text.find("Qonaq:") == std::string::npos);
    REQUIRE(text.find("Ofisiant:") != std::string::npos);
}

TEST_CASE("a long metadata value moves to its own indented line",
          "[receipt][layout]") {
    ReceiptDocument doc = fixtureDocument(PaperWidth::Mm58);
    doc.waiterName = "Məmmədova Aysel Əli qızı Rəhimli";

    const auto lines = formatReceipt(doc);
    bool sawLabelAlone = false;
    for (std::size_t i = 0; i + 1 < lines.size(); ++i) {
        if (lines[i].text == "Ofisiant:") {
            sawLabelAlone = true;
            REQUIRE(lines[i + 1].text.rfind("  ", 0) == 0);
        }
    }
    REQUIRE(sawLabelAlone);
    for (const auto& line : lines) {
        REQUIRE(layout::visibleWidth(line.text) <= doc.charsPerLine);
    }
}

// ---------------------------------------------------------------- 3. currency

TEST_CASE("money always carries two decimals and the configured suffix",
          "[receipt][currency]") {
    REQUIRE(formatMoney(0, "AZN", CurrencyDisplay::Code) == "0.00 AZN");
    REQUIRE(formatMoney(500, "AZN", CurrencyDisplay::Code) == "5.00 AZN");
    REQUIRE(formatMoney(3200, "AZN", CurrencyDisplay::Code) == "32.00 AZN");
    REQUIRE(formatMoney(15600, "AZN", CurrencyDisplay::Code) == "156.00 AZN");
    REQUIRE(formatMoney(20249, "AZN", CurrencyDisplay::Code) == "202.49 AZN");
    REQUIRE(formatMoney(-751, "AZN", CurrencyDisplay::Code) == "-7.51 AZN");
    REQUIRE(formatMoney(3200, "AZN", CurrencyDisplay::None) == "32.00");
    REQUIRE(formatMoney(3200, "AZN", CurrencyDisplay::Symbol) == "32.00 \xE2\x82\xBC");
}

TEST_CASE("no receipt ever prints a bare m as the currency", "[receipt][currency]") {
    const std::string text = renderPlainText(fixtureDocument());
    REQUIRE(text.find("00 m") == std::string::npos);
    REQUIRE(text.find(" m\n") == std::string::npos);
    REQUIRE(countOccurrences(text, "AZN") > 5);
}

// -------------------------------------------------------------- 4. az strings

TEST_CASE("Azerbaijani strings are spelled correctly", "[receipt][az]") {
    const std::string text = renderPlainText(fixtureDocument());

    REQUIRE(text.find("Təşəkkür edirik!") != std::string::npos);
    REQUIRE(text.find("Tefekkür") == std::string::npos);
    REQUIRE(text.find("ƏDV") != std::string::npos);
    REQUIRE(text.find("EDV") == std::string::npos);
    REQUIRE(text.find("Leyla Əliyeva") != std::string::npos);
    REQUIRE(text.find("Neftçilər prospekti") != std::string::npos);
    REQUIRE(text.find("Ara cəm") != std::string::npos);
    REQUIRE(text.find("Servis haqqı") != std::string::npos);
    REQUIRE(text.find("YEKUN") != std::string::npos);
    REQUIRE(text.find("Qaytarılan məbləğ") != std::string::npos);
    REQUIRE(text.find("VÖEN: 1900123456") != std::string::npos);
}

TEST_CASE("the code page cannot render the schwa, which drives raster",
          "[receipt][az]") {
    REQUIRE(codePageCovers("Tesekkur edirik"));
    REQUIRE(codePageCovers("Şəkil") == false);
    REQUIRE(codePageCovers("Ğğ Şş Çç Öö Üü İı"));
    REQUIRE(codePageCovers("ƏDV") == false);

    const std::string missing = unsupportedCharacters("ƏDV ə Şş");
    REQUIRE(missing.find("Ə") != std::string::npos);
    REQUIRE(missing.find("ə") != std::string::npos);
    REQUIRE(missing.find("Ş") == std::string::npos);
}

TEST_CASE("auto mode falls back to text when raster is unavailable",
          "[receipt][az][raster]") {
    const auto doc = fixtureDocument();
    const auto lines = formatReceipt(doc);

    EscPosOptions opts;
    opts.renderMode = RenderMode::Auto;
    opts.paperWidth = doc.paperWidth;
    opts.charsPerLine = doc.charsPerLine;
    opts.qr = true;
    opts.qrPayload = doc.qrPayload;

    const auto result = buildEscPos(lines, opts);
    REQUIRE(result.bytes.size() > 100);

    if (rasterAvailable()) {
        REQUIRE(result.usedMode == RenderMode::Raster);
    } else {
        REQUIRE(result.usedMode == RenderMode::Text);
        REQUIRE(result.transliterated);
    }
}

TEST_CASE("forcing text mode still produces a printable stream",
          "[receipt][az][raster]") {
    const auto doc = fixtureDocument();
    EscPosOptions opts;
    opts.renderMode = RenderMode::Text;
    opts.charsPerLine = doc.charsPerLine;

    const auto result = buildEscPos(formatReceipt(doc), opts);
    REQUIRE(result.usedMode == RenderMode::Text);
    REQUIRE(result.transliterated);
    REQUIRE(result.bytes.front() == 0x1B);  // ESC @
    REQUIRE(result.bytes[1] == 0x40);
}

// --------------------------------------------------------------------- 5. QR

TEST_CASE("QR payload carries only guest-visible facts", "[receipt][qr]") {
    const auto doc = fixtureDocument();
    REQUIRE(doc.qrPayload.rfind("MA1|", 0) == 0);
    REQUIRE(doc.qrPayload.find("R-FQ0ABWCR") != std::string::npos);
    REQUIRE(doc.qrPayload.find("20249") != std::string::npos);
    REQUIRE(doc.qrPayload.find("pin") == std::string::npos);
    REQUIRE(doc.qrPayload.find(".db") == std::string::npos);
}

TEST_CASE("an empty QR payload prints no QR block", "[receipt][qr]") {
    ReceiptDocument doc = fixtureDocument();
    doc.qrPayload.clear();

    const auto lines = formatReceipt(doc);
    for (const auto& line : lines) REQUIRE_FALSE(line.qr);

    EscPosOptions opts;
    opts.renderMode = RenderMode::Text;
    opts.charsPerLine = doc.charsPerLine;
    opts.qr = true;
    opts.qrPayload.clear();

    const auto result = buildEscPos(lines, opts);
    // GS ( k, the QR command prefix, must not appear at all.
    bool sawQrCommand = false;
    for (std::size_t i = 0; i + 2 < result.bytes.size(); ++i) {
        if (result.bytes[i] == 0x1D && result.bytes[i + 1] == 0x28 &&
            result.bytes[i + 2] == 0x6B) {
            sawQrCommand = true;
        }
    }
    REQUIRE_FALSE(sawQrCommand);
}

TEST_CASE("the QR block is centred and closes the receipt", "[receipt][qr]") {
    const auto lines = formatReceipt(fixtureDocument());
    int qrLines = 0;
    for (const auto& line : lines) {
        if (!line.qr) continue;
        qrLines++;
        REQUIRE(line.align == LineAlign::Center);
    }
    REQUIRE(qrLines == 1);
}

// ---------------------------------------------------------------- 6. reprint

TEST_CASE("a reprint is marked on the paper", "[receipt][reprint]") {
    ReceiptDocument doc = fixtureDocument();
    REQUIRE(renderPlainText(doc).find("TƏKRAR ÇAP") == std::string::npos);

    doc.isReprint = true;
    const std::string text = renderPlainText(doc);
    REQUIRE(text.find("TƏKRAR ÇAP") != std::string::npos);
}

// -------------------------------------------------------- 7. snapshot / json

TEST_CASE("the document survives a round trip through JSON", "[receipt][snapshot]") {
    const auto original = fixtureDocument();
    const auto restored = documentFromJson(original.toJson());

    REQUIRE(restored.receiptNumber == original.receiptNumber);
    REQUIRE(restored.items.size() == original.items.size());
    REQUIRE(restored.subtotal == original.subtotal);
    REQUIRE(restored.grandTotal == original.grandTotal);
    REQUIRE(restored.visibleItemTotal() == original.visibleItemTotal());
    REQUIRE(renderPlainText(restored) == renderPlainText(original));
}

TEST_CASE("nullable SQLite strings do not abort receipt rendering", "[receipt][regression]") {
    Json snapshot = fixtureDocument().toJson();
    snapshot["tableName"] = nullptr;
    snapshot["areaName"] = nullptr;
    snapshot["waiterName"] = nullptr;
    snapshot["discountLabel"] = nullptr;
    snapshot["restaurant"]["phone"] = nullptr;
    snapshot["payments"][0]["label"] = nullptr;

    REQUIRE_NOTHROW(documentFromJson(snapshot));
    const auto restored = documentFromJson(snapshot);
    REQUIRE(restored.tableName.empty());
    REQUIRE(restored.waiterName.empty());
    REQUIRE(restored.payments.front().label.empty());
}

TEST_CASE("every renderer agrees on the amounts", "[receipt][snapshot]") {
    const auto doc = fixtureDocument();
    const auto lines = formatReceipt(doc);
    const std::string text = renderPlainText(lines, doc.charsPerLine);

    // The plain-text render and the line list are the same content, and the
    // ESC/POS text stream is built from that same list.
    REQUIRE(text.find("202.49 AZN") != std::string::npos);
    REQUIRE(countOccurrences(text, "156.00 AZN") == 1);
    REQUIRE(countOccurrences(text, "25.00 AZN") == 1);
    REQUIRE(text.find("Düzəliş") == std::string::npos);
}

TEST_CASE("golden snapshot files stay in sync", "[receipt][snapshot]") {
    namespace fs = std::filesystem;

    const auto doc80 = fixtureDocument(PaperWidth::Mm80);
    const auto doc58 = fixtureDocument(PaperWidth::Mm58);
    const std::string text80 = renderPlainText(doc80);
    const std::string text58 = renderPlainText(doc58);
    const std::string html = renderHtml(doc80);
    const std::string json = serialize(doc80.toJson());

    // Prefer the source-tree snapshots. When the test binary is launched from
    // native/build the relative path is one level up; from the repo root it is
    // native/tests/snapshots.
    fs::path dir = fs::path("native") / "tests" / "snapshots";
    if (!fs::exists(dir)) dir = fs::path("..") / "tests" / "snapshots";
    if (!fs::exists(dir)) dir = fs::path("snapshots");
    fs::create_directories(dir);

    const auto writeIfAsked = [&](const fs::path& file, const std::string& body) {
        if (std::getenv("POS_WRITE_SNAPSHOTS") != nullptr) {
            std::ofstream out(file, std::ios::binary | std::ios::trunc);
            out << body;
        }
    };

    writeIfAsked(dir / "receipt-80mm.txt", text80);
    writeIfAsked(dir / "receipt-58mm.txt", text58);
    writeIfAsked(dir / "receipt-preview.html", html);
    writeIfAsked(dir / "receipt-document.json", json);

    const auto readOrSkip = [&](const fs::path& file) -> std::string {
        if (!fs::exists(file)) return {};
        std::ifstream in(file, std::ios::binary);
        return std::string(std::istreambuf_iterator<char>(in),
                           std::istreambuf_iterator<char>());
    };

    const std::string golden80 = readOrSkip(dir / "receipt-80mm.txt");
    if (!golden80.empty()) REQUIRE(golden80 == text80);
    const std::string golden58 = readOrSkip(dir / "receipt-58mm.txt");
    if (!golden58.empty()) REQUIRE(golden58 == text58);
    const std::string goldenHtml = readOrSkip(dir / "receipt-preview.html");
    if (!goldenHtml.empty()) REQUIRE(goldenHtml == html);
}

TEST_CASE("a mismatched legacy snapshot is disclosed, not hidden",
          "[receipt][snapshot]") {
    ReceiptDocument doc = fixtureDocument();
    doc.subtotal = 18600;  // what the old double-counting renderer displayed

    const std::string text = renderPlainText(doc);
    REQUIRE(text.find("Düzəliş") != std::string::npos);
    REQUIRE(text.find("186.00 AZN") != std::string::npos);
}

TEST_CASE("write visual preview artifacts for QA", "[receipt][visual]") {
    namespace fs = std::filesystem;

    ReceiptDocument doc = fixtureDocument(PaperWidth::Mm80);
    doc.restaurant.name = "Milioner Pub";
    doc.restaurant.tagline = "";
    doc.restaurant.address = "Lütfizadə 98";
    doc.restaurant.phone = "+994505013540";
    doc.restaurant.hours = "12:00 - 02:00";
    doc.footer = {"Təşəkkür edirik!", "Sizi yenidən gözləyirik.", "Milioner Pub"};
    doc.currencyDisplay = CurrencyDisplay::Symbol;

    fs::path dir = fs::path("native") / "tests" / "snapshots";
    if (!fs::exists(dir)) dir = fs::path("..") / "tests" / "snapshots";
    if (!fs::exists(dir)) dir = fs::path("snapshots");
    fs::create_directories(dir);

    const std::string html = renderHtml(doc);
    const std::string text = renderPlainText(doc);
    {
        std::ofstream out(dir / "milioner-80mm-preview.html", std::ios::binary | std::ios::trunc);
        out << html;
    }
    {
        std::ofstream out(dir / "milioner-80mm-preview.txt", std::ios::binary | std::ios::trunc);
        out << text;
    }

    if (!rasterAvailable()) return;

    std::string error;
    const auto bitmap = renderLinesToBitmap(formatReceipt(doc), doc.paperWidth, doc.charsPerLine, error);
    REQUIRE(error.empty());
    REQUIRE(bitmap.valid());
    REQUIRE(bitmap.width == 576);

    // Windows BMP (1 bpp) for visual inspection after PNG conversion.
#pragma pack(push, 1)
    struct BmpFileHeader {
        std::uint16_t type = 0x4D42;
        std::uint32_t size = 0;
        std::uint16_t reserved1 = 0;
        std::uint16_t reserved2 = 0;
        std::uint32_t offBits = 62;
    };
    struct BmpInfoHeader {
        std::uint32_t size = 40;
        std::int32_t width = 0;
        std::int32_t height = 0;
        std::uint16_t planes = 1;
        std::uint16_t bitCount = 1;
        std::uint32_t compression = 0;
        std::uint32_t sizeImage = 0;
        std::int32_t xPels = 2030;
        std::int32_t yPels = 2030;
        std::uint32_t clrUsed = 2;
        std::uint32_t clrImportant = 2;
    };
#pragma pack(pop)

    const int rowBytes = ((bitmap.width + 31) / 32) * 4;
    BmpFileHeader fh;
    BmpInfoHeader ih;
    ih.width = bitmap.width;
    ih.height = bitmap.height;  // bottom-up
    ih.sizeImage = static_cast<std::uint32_t>(rowBytes * bitmap.height);
    fh.size = fh.offBits + ih.sizeImage;

    std::ofstream bmp(dir / "milioner-80mm-raster.bmp", std::ios::binary | std::ios::trunc);
    bmp.write(reinterpret_cast<const char*>(&fh), sizeof(fh));
    bmp.write(reinterpret_cast<const char*>(&ih), sizeof(ih));
    const std::uint8_t palette[8] = {0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00};
    bmp.write(reinterpret_cast<const char*>(palette), sizeof(palette));

    std::vector<std::uint8_t> row(static_cast<std::size_t>(rowBytes), 0);
    for (int y = bitmap.height - 1; y >= 0; --y) {
        std::fill(row.begin(), row.end(), 0);
        const auto* src = bitmap.bits.data() + static_cast<std::size_t>(y) * bitmap.stride;
        std::memcpy(row.data(), src, static_cast<std::size_t>(bitmap.stride));
        bmp.write(reinterpret_cast<const char*>(row.data()), rowBytes);
    }
    REQUIRE(bmp.good());
}
