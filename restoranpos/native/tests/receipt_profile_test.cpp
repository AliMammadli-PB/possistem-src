#include "catch_amalgamated.hpp"
#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/ReceiptGraphics.hpp"
#include "pos/printing/EscPos.hpp"
#include <fstream>
#include <cstdlib>
using namespace pos;
using namespace pos::printing;
namespace {
Json invoke(ServiceFixture& f, const char* method, Json payload) {
    ipc::Request r; r.requestId=crypto::uuid4();r.idempotencyKey=crypto::uuid4();r.method=method;r.payload=std::move(payload);
    return f.server().callHandler(r);
}
std::int64_t count(ServiceFixture& f,const char* table) {
    auto s=f.db().prepare(std::string("SELECT count(*) FROM ")+table);s.step();return s.columnInt(0);
}
void artifact(const std::string& name,const std::string& text) {
    if(const char* dir=std::getenv("POS_RECEIPT_ARTIFACTS")) { std::filesystem::create_directories(dir);std::ofstream(std::filesystem::path(dir)/name)<<text; }
}
}
TEST_CASE("all paper widths round trip without being coerced into 58 or 80", "[receipt][profile]") {
    for(double mm : {40.,44.5,57.5,58.,69.5,76.,79.5,80.,82.5,112.,120.,63.7}) {
        auto paper=paperWidthFromMm(mm);
        ReceiptDocument doc;doc.paperWidth=paper;
        REQUIRE(documentFromJson(doc.toJson()).paperWidth.mm == mm);
        REQUIRE(rasterDotWidth(paper)%8==0);
        REQUIRE(rasterDotWidth(paper)*25.4/paper.dpi <= mm);
        paper.dpi=300;paper.printableDots=320;doc.paperWidth=paper;
        const auto restored=documentFromJson(doc.toJson());
        REQUIRE(restored.paperWidth.dpi==300);REQUIRE(rasterDotWidth(restored.paperWidth)==320);
    }
    REQUIRE(rasterDotWidth(PaperWidth::Mm58)==384);REQUIRE(rasterDotWidth(PaperWidth::Mm80)==576);
    REQUIRE_THROWS(paperWidthFromMm(39));REQUIRE_THROWS(paperWidthFromMm(121));
    auto invalid=PaperWidth::Mm58;invalid.printableDots=640;REQUIRE_THROWS(rasterDotWidth(invalid));
}
TEST_CASE("QR is only the configured link with no phone or verification fallback", "[receipt][profile]") {
    ReceiptDocument doc;doc.restaurant.phone="+994501234567";doc.grandTotal=1200;doc.receiptNumber="R-test";
    REQUIRE(buildQrPayload(doc,"https://verify.example","").empty());
    const std::string link="https://example.com/menyu?masa=Əli&x="+std::string(180,'a')+"#son";
    REQUIRE(buildQrPayload(doc,"https://verify.example",link)==link);
    auto bitmap=qrBitmap(link,PaperWidth::Mm58);REQUIRE(bitmap.valid());
    auto changed=qrBitmap(link+"b",PaperWidth::Mm58);REQUIRE(bitmap.bits!=changed.bits);
    REQUIRE_THROWS(qrBitmap(std::string(4000,'a'),PaperWidth::Mm58));
    artifact("native-qr.json",Json{{"payload",link},{"width",bitmap.width},{"height",bitmap.height},{"stride",bitmap.stride},{"bits",bitmap.bits}}.dump());
}
TEST_CASE("oversized and tall logos fit instead of being cropped", "[receipt][profile]") {
    for(const auto dims : {std::pair{1024,64},std::pair{64,1024},std::pair{300,300}}) {
        MonoBitmap logo;logo.width=dims.first;logo.height=dims.second;logo.stride=(logo.width+7)/8;logo.bits.assign(logo.stride*logo.height,255);
        const auto fitted=fitLogo(logo,PaperWidth::Mm58);
        REQUIRE(fitted.width==384);REQUIRE(fitted.height<=192);REQUIRE(fitted.valid());
    }
    REQUIRE_FALSE(fitLogo({},PaperWidth::Mm58).valid());
}
TEST_CASE("draft preview is read-only and the saved decimal profile is restored", "[receipt][profile]") {
    ServiceFixture f;handlers::registerPrinting(f.contextPtr());
    const auto settingsBefore=count(f,"app_settings"),jobsBefore=count(f,"print_jobs"),receiptsBefore=count(f,"receipts"),auditBefore=count(f,"audit_logs");
    for(double mm : {44.5,57.5,58.,69.5,76.,79.5,80.,82.5,112.,63.7}) {
        const auto paper=paperWidthFromMm(mm);
        Json request{{"paperWidth",mm},{"dpi",203},{"printableDots",0},{"charsPerLine",defaultCharsPerLine(paper)},{"qrOn",true},{"qrUrl","https://possistem.az"},{"brand",{{"name","Draft Əla restoran"},{"taxId","12345"},{"branch","Bakı"}}}};
        const auto preview=invoke(f,"print.previewTest",request);
        REQUIRE(preview["paperWidth"]==mm);REQUIRE(preview["document"]["qrPayload"]=="https://possistem.az");
        REQUIRE(preview["document"]["grandTotalMinor"]==1700);
        REQUIRE(preview["text"].get<std::string>().find("Draft Əla restoran")!=std::string::npos);
        const auto html=preview["html"].get<std::string>();
        REQUIRE(html.find("<div class=\"qr\"><div class=\"code\"><svg")!=std::string::npos);
        REQUIRE(html.find("<div class=\"box\">QR</div>")==std::string::npos);
        REQUIRE(html.find("Club Sandwich")==std::string::npos);
        artifact("receipt-"+std::to_string(mm)+".html",html);
    }
    REQUIRE(count(f,"app_settings")==settingsBefore);REQUIRE(count(f,"print_jobs")==jobsBefore);REQUIRE(count(f,"receipts")==receiptsBefore);REQUIRE(count(f,"audit_logs")==auditBefore);
    const auto qrOff=invoke(f,"print.previewTest",{{"qrOn",false},{"qrUrl","https://example.com"}});
    REQUIRE(qrOff["document"]["qrPayload"]=="");
    REQUIRE(qrOff["html"].get<std::string>().find("class=\"qr\"")==std::string::npos);
    REQUIRE(invoke(f,"print.previewTest",{{"qrOn",true},{"qrUrl",""}})["document"]["qrPayload"]=="");
    REQUIRE_THROWS(invoke(f,"print.previewTest",{{"qrOn",true},{"qrUrl",std::string(4000,'a')}}));
    invoke(f,"print.setPrinter",{{"settings",{{"printer.paperWidth",69.5},{"printer.dpi",300},{"printer.printableDots",640},{"printer.charsPerLine",42}}}});
    ReceiptBuilder restored(f.ctx());const auto profile=restored.settings();
    REQUIRE(profile.paperWidthMm==69.5);REQUIRE(profile.paperWidth.dpi==300);REQUIRE(rasterDotWidth(profile.paperWidth)==640);REQUIRE(profile.charsPerLine==42);
    REQUIRE_THROWS(invoke(f,"print.setPrinter",{{"settings",{{"printer.printableDots",2000}}}}));
    REQUIRE(rasterDotWidth(restored.settings().paperWidth)==640);
    REQUIRE_THROWS(invoke(f,"print.previewTest",{{"paperWidth",12}}));
    REQUIRE_THROWS(invoke(f,"print.previewTest",{{"paperWidth",44.5},{"charsPerLine",96}}));
}
