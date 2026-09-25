#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/printing/ReceiptFormatter.hpp"
#include "pos/db/Migrator.hpp"

/**
 * The venue's own receipt logo.
 *
 * It used to be a constant compiled into the core, so every customer printed the
 * first venue's mark. Now the settings screen thresholds the image on a canvas
 * and stores the result; these check the core reads it back safely and never
 * prints a mark the operator did not choose.
 */
namespace {

void setSetting(ServiceFixture& fixture, const char* key, const std::string& value) {
    auto stmt = fixture.db().prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'string', 0) "
        "ON CONFLICT(key) DO UPDATE SET value = :value");
    stmt.bind(":key", std::string(key)).bind(":value", value);
    stmt.exec();
}

}  // namespace

TEST_CASE("no logo is configured, so none is printed", "[receipt][logo]") {
    ServiceFixture fixture;
    pos::printing::ReceiptBuilder builder(fixture.ctx());

    REQUIRE(builder.logoPngBase64().empty());
    REQUIRE_FALSE(builder.logoBitmap().valid());
}

TEST_CASE("the stored raster decodes to the bitmap the till prints", "[receipt][logo]") {
    ServiceFixture fixture;
    // 16 dots wide, 2 rows: stride 2, so 4 bytes and 8 hex characters.
    setSetting(fixture, "printer.logoRaster", R"({"w":16,"h":2,"hex":"ff00807f"})");

    pos::printing::ReceiptBuilder builder(fixture.ctx());
    const auto bitmap = builder.logoBitmap();

    REQUIRE(bitmap.valid());
    REQUIRE(bitmap.width == 16);
    REQUIRE(bitmap.height == 2);
    REQUIRE(bitmap.stride == 2);
    REQUIRE(bitmap.bits.size() == 4);
    REQUIRE(bitmap.bits[0] == 0xff);
    REQUIRE(bitmap.bits[1] == 0x00);
    REQUIRE(bitmap.bits[2] == 0x80);
    REQUIRE(bitmap.bits[3] == 0x7f);
}

TEST_CASE("a raster that does not match its own dimensions is ignored", "[receipt][logo]") {
    ServiceFixture fixture;
    pos::printing::ReceiptBuilder builder(fixture.ctx());

    // Short, long, non-hex and unparseable all mean "print no logo" rather than
    // a torn bitmap on a guest's receipt.
    for (const char* bad : {R"({"w":16,"h":2,"hex":"ff00"})",
                            R"({"w":16,"h":2,"hex":"ff00807fff00"})",
                            R"({"w":16,"h":2,"hex":"ff00zz7f"})",
                            R"({"w":0,"h":2,"hex":"ff00807f"})",
                            "not json at all"}) {
        setSetting(fixture, "printer.logoRaster", bad);
        REQUIRE_FALSE(builder.logoBitmap().valid());
    }
}

TEST_CASE("the data URL prefix is stripped for the screen preview", "[receipt][logo]") {
    ServiceFixture fixture;
    setSetting(fixture, "printer.logoDataUrl", "data:image/png;base64,QUJD");

    pos::printing::ReceiptBuilder builder(fixture.ctx());
    REQUIRE(builder.logoPngBase64() == "QUJD");

    // Anything that is not a data URL is not a logo.
    setSetting(fixture, "printer.logoDataUrl", "https://example.com/logo.png");
    REQUIRE(builder.logoPngBase64().empty());
}

TEST_CASE("the preview shows the venue's mark, and nothing when there is none",
          "[receipt][logo]") {
    pos::printing::ReceiptDocument doc;
    doc.restaurant.name = "Araz Restoran";
    doc.charsPerLine = 40;

    const auto without = pos::printing::renderHtml(doc);
    REQUIRE(without.find("<img class=\"logo\"") == std::string::npos);

    const auto with = pos::printing::renderHtml(doc, "QUJD");
    REQUIRE(with.find("data:image/png;base64,QUJD") != std::string::npos);
    // The alt text is the venue's own name, not a hardcoded brand.
    REQUIRE(with.find("alt=\"Araz Restoran\"") != std::string::npos);
}

/**
 * The receipt QR must not point at a stranger.
 *
 * `receipt.qrUrl` shipped seeded with one particular 2gis pin in Baku, and
 * `printer.qr` defaults to on, so every till that installed this printed a QR
 * sending its guests to an address that was not the restaurant they were
 * standing in.
 */
TEST_CASE("a fresh till ships no receipt QR address", "[receipt][qr]") {
    ServiceFixture fixture;
    auto stmt = fixture.db().prepare(
        "SELECT value FROM app_settings WHERE key = 'receipt.qrUrl'");
    REQUIRE(stmt.step());
    REQUIRE(stmt.columnText(0).empty());
}

TEST_CASE("the seeded demo pin is cleared off a till that already has it",
          "[receipt][qr]") {
    ServiceFixture fixture;

    // Put it back the way an already-installed till would carry it, then let
    // the converge step run again.
    auto plant = fixture.db().prepare(
        "UPDATE app_settings SET value = 'https://2gis.az/baku/geo/70030076175156383' "
        "WHERE key = 'receipt.qrUrl'");
    plant.exec();

    // seedIfEmpty is what Application.cpp runs on every boot; the converge
    // steps hang off it, not off migrate().
    pos::db::Migrator migrator(fixture.db());
    migrator.seedIfEmpty({});

    auto stmt = fixture.db().prepare(
        "SELECT value FROM app_settings WHERE key = 'receipt.qrUrl'");
    REQUIRE(stmt.step());
    REQUIRE(stmt.columnText(0).empty());
}

TEST_CASE("an address the operator typed is left alone", "[receipt][qr]") {
    ServiceFixture fixture;
    auto mine = fixture.db().prepare(
        "UPDATE app_settings SET value = 'https://mycafe.az' WHERE key = 'receipt.qrUrl'");
    mine.exec();

    // seedIfEmpty is what Application.cpp runs on every boot; the converge
    // steps hang off it, not off migrate().
    pos::db::Migrator migrator(fixture.db());
    migrator.seedIfEmpty({});

    auto stmt = fixture.db().prepare(
        "SELECT value FROM app_settings WHERE key = 'receipt.qrUrl'");
    REQUIRE(stmt.step());
    REQUIRE(stmt.columnText(0) == "https://mycafe.az");
}
