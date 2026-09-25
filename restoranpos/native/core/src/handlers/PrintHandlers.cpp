#include "pos/printing/ReceiptFormatter.hpp"
#include "pos/printing/ReceiptGraphics.hpp"
#include <cmath>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <vector>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/DeviceDiscovery.hpp"
#include "pos/printing/EscPos.hpp"
#include "pos/printing/RasterRenderer.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/RefundService.hpp"
#include <cctype>
#include <utility>

namespace pos::handlers {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("printer");
    return log;
}

/**
 * A receipt code as the guest reads it out, in the shape the column stores.
 *
 * People type what they see and what they hear: lower case, with or without the
 * `R-`, sometimes with a space in the middle. The stored alphabet has no I, O,
 * 0 or 1, so nothing here has to guess between them - only strip what is not a
 * letter or digit and raise the case. Matching then compares against the same
 * transformation of the column.
 */
std::pair<std::string, std::string> normaliseReceiptCode(std::string_view raw) {
    std::string compact;
    compact.reserve(raw.size());
    for (unsigned char c : raw) {
        if (std::isalnum(c)) compact.push_back(static_cast<char>(std::toupper(c)));
    }

    // Two candidates rather than a guess about the prefix. The stored alphabet
    // includes R, so about one code in thirty-two reads `R-RBC…`; deciding that
    // a leading R must be the prefix would make exactly those codes unfindable
    // for any guest who left the prefix off, and nobody would ever work out why.
    const std::string withPrefix = compact.empty() || compact.front() != 'R' ? "R" + compact : compact;
    const std::string asTyped = compact;
    return {withPrefix, asTyped};
}

/**
 * Which physical printer a document belongs on.
 *
 * A restaurant runs more than one: a ticket printer in the kitchen so the line
 * sees the order, a receipt printer at the till for the guest, and - where
 * goods are taken in - one in the store room. Until now there were two roles,
 * and everything that was not a kitchen ticket went to the till, so a third
 * printer could be plugged in and cabled and still had nothing addressed to it.
 *
 * Kept as one function rather than a ternary at each call site: there were two
 * of those and they had already drifted into different shapes, which is how a
 * new kind ends up routed correctly in one place and not the other.
 */
std::string printerRoleFor(std::string_view kind) {
    if (kind == "kitchen_ticket") return "printer.kitchen";
    if (kind == "warehouse_slip") return "printer.warehouse";
    return "printer.receipt";
}

/** The setting key behind a role name the settings screen sends. */
std::string printerRoleKey(std::string_view target) {
    if (target == "kitchen") return "printer.kitchen";
    if (target == "warehouse") return "printer.warehouse";
    return "printer.receipt";
}

/** Exponential backoff between print attempts. */
Timestamp backoffFor(int attempts) {
    static constexpr Timestamp kDelays[] = {2000, 5000, 15000, 60000, 300000};
    const int index = std::min(attempts, 4);
    return kDelays[index];
}

std::filesystem::path spoolDirectory(Context& ctx) {
    auto directory = std::filesystem::path(ctx.db().path()).parent_path() / "receipts";
    std::error_code ec;
    std::filesystem::create_directories(directory, ec);
    return directory;
}

/** Everything a printer needs, produced once by the renderer. */
struct RenderedPayload {
    /** Positioned lines. Empty for kinds that only have plain text. */
    std::vector<printing::ReceiptLine> lines;
    /** Character-grid form: spool file, preview and audit all read this. */
    std::string text;
    std::string qrPayload;
    printing::PaperWidth paperWidth = printing::PaperWidth::Mm80;
    int charsPerLine = 48;
    int fontHeightPx = 32, fontWidthPx = 14, sideMarginPx = 2;
    printing::RenderMode renderMode = printing::RenderMode::Auto;
    int itemCount = 0;
    Money subtotalMinor = 0;
    Money taxMinor = 0;
    Money totalMinor = 0;
};

/** Outcome of one delivery attempt, for the job log. */
struct DeliveryReport {
    bool ok = false;
    /**
     * True only when bytes reached a physical device.
     *
     * The spool path succeeds at what it does - writing the bill to disk - so it
     * still reports `ok`. Without this second flag the operator is told the
     * receipt printed when it only ever became a text file, which is exactly how
     * a till can appear to work for weeks while no guest gets a bill.
     */
    bool physical = false;
    std::string errorCode;
    std::string errorMessage;
    printing::RenderMode usedMode = printing::RenderMode::Text;
    std::size_t payloadBytes = 0;
    std::int64_t durationMs = 0;
    std::string note;
    /** The device that actually took the page, which auto-detection may change. */
    std::string usedTarget;
};

printing::EscPosOptions escPosOptionsFor(Context& ctx, const RenderedPayload& payload) {
    printing::EscPosOptions opts;
    opts.density = static_cast<int>(ctx.settingInt("printer.density", 5));
    opts.cut = ctx.settingInt("printer.cut", 1) != 0;
    opts.beep = ctx.settingInt("printer.beep", 0) != 0;
    opts.openCashDrawer = ctx.settingInt("printer.openCashDrawer", 0) != 0;
    opts.feedLines = static_cast<int>(ctx.settingInt("printer.bottomFeedLines", 4));
    opts.codePage = static_cast<int>(ctx.settingInt("printer.codePage", 13));
    opts.renderMode = payload.renderMode;
    opts.paperWidth = payload.paperWidth;
    opts.charsPerLine = payload.charsPerLine;
    opts.fontHeightPx = payload.fontHeightPx;
    opts.fontWidthPx = payload.fontWidthPx;
    opts.sideMarginPx = payload.sideMarginPx;
    opts.qr = !payload.qrPayload.empty();
    opts.qrPayload = payload.qrPayload;
    opts.logo = printing::ReceiptBuilder(ctx).logoBitmap();
    return opts;
}

void writeSpoolCopy(Context& ctx, const std::string& jobId, const std::string& content) {
    try {
        const auto file = spoolDirectory(ctx) / (jobId + ".txt");
        std::ofstream out(file, std::ios::binary | std::ios::trunc);
        if (out) out << content;
    } catch (...) {
        // A missing local copy must never stop a receipt reaching the guest.
    }
}

/** True for the targets that mean "no device", handled by the spool file. */
bool isSpoolTarget(const std::string& target) {
    return target.empty() || target == "virtual";
}

/** True for a target the operator has not actually chosen yet. */
bool isAutoTarget(const std::string& target) { return target == "auto"; }

/**
 * One delivery attempt against one concrete target.
 *
 * - `tcp:HOST:PORT` / bare IP → raw ESC/POS over TCP (port 9100 default)
 * - `usbraw:<devicePath>`     → straight to the USB device, no driver needed
 * - `serial:COM3[@baud]`      → serial port
 * - `win:NAME` / `usb:NAME` / bare queue name → RAW via the Windows spooler
 */
bool sendOnce(const std::string& target, const std::vector<std::uint8_t>& bytes,
              std::string& errorOut) {
    std::string host;
    int port = 9100;
    if (printing::parseNetworkPrinter(target, host, port)) {
        return printing::sendRawTcp(host, port, bytes, errorOut);
    }

    std::string devicePath;
    if (printing::parseUsbRawPrinter(target, devicePath)) {
        return printing::sendRawUsbDevice(devicePath, bytes, errorOut);
    }

    std::string serialPort;
    int baud = 9600;
    if (printing::parseSerialPrinter(target, serialPort, baud)) {
        return printing::sendRawSerial(serialPort, baud, bytes, errorOut);
    }

    std::string windowsName;
    if (printing::parseWindowsPrinter(target, windowsName)) {
        return printing::sendRawWindowsPrinter(windowsName, bytes, errorOut);
    }

    errorOut = "Naməlum printer hədəfi: " + target;
    return false;
}

void rememberPrinter(Context& ctx, const std::string& settingKey, const std::string& target) {
    auto upsert = ctx.db().prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'string', :now) "
        "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
    upsert.bind(":key", settingKey).bind(":value", target).bind(":now", nowMs());
    upsert.exec();
}

/**
 * Fall-back targets, best first, for when the configured one did not answer.
 *
 * Auto-detection is what makes a freshly plugged-in USB printer work with no
 * setup at all, what recovers when the same printer comes back on a different
 * USB port (device path and spooler queue both change), and - since the LAN
 * sweep was added - what finds a receipt printer that is only reachable over
 * the switch.
 *
 * This is deliberately *not* called before the configured target is tried: the
 * sweep costs seconds, and a till that is already configured must never pay for
 * it on the happy path.
 */
std::vector<std::string> discoveredTargets(Context& ctx, const std::string& configured,
                                           const std::vector<std::string>& alreadyTried) {
    std::vector<std::string> targets;
    if (ctx.settingInt("printer.autoDetect", 1) == 0) return targets;

    // The address this till last printed to. One connect is far cheaper than a
    // sweep and covers the common case where the printer simply rebooted.
    const std::string lastKnownIp = ctx.setting("printer.lastKnownIp", "");
    if (!lastKnownIp.empty()) {
        const std::string target = "tcp:" + lastKnownIp + ":9100";
        if (std::find(alreadyTried.begin(), alreadyTried.end(), target) == alreadyTried.end()) {
            targets.push_back(target);
        }
    }

    for (const auto& candidate : printing::rankPrinterCandidates(configured)) {
        if (candidate.link == printing::PrinterLink::Virtual) continue;
        if (candidate.score <= 0) continue;
        if (std::find(alreadyTried.begin(), alreadyTried.end(), candidate.target) !=
            alreadyTried.end()) {
            continue;
        }
        if (std::find(targets.begin(), targets.end(), candidate.target) != targets.end()) continue;
        targets.push_back(candidate.target);
    }
    return targets;
}

/** Remembers the address a network printer was reached at, plus its MAC. */
void rememberNetworkPrinter(Context& ctx, const std::string& target) {
    std::string host;
    int port = 9100;
    if (!printing::parseNetworkPrinter(target, host, port)) return;

    auto upsert = ctx.db().prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'string', :now) "
        "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
    upsert.bind(":key", "printer.lastKnownIp").bind(":value", host).bind(":now", nowMs());
    upsert.exec();

    // The MAC survives a DHCP lease change, so the next sweep can re-find the
    // same printer even though its address moved.
    const std::string mac = printing::macForAddress(host);
    if (mac.empty()) return;
    auto upsertMac = ctx.db().prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES (:key, :value, 'string', :now) "
        "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
    upsertMac.bind(":key", "printer.lastKnownMac").bind(":value", mac).bind(":now", nowMs());
    upsertMac.exec();
}

/**
 * Delivers a rendered document, falling back to the spool file.
 *
 * `settingKey` is the `app_settings` row to update when auto-detection lands on
 * a different printer than the one that was configured, so the next receipt
 * goes straight there.
 */
DeliveryReport deliver(Context& ctx, const std::string& printerName, const std::string& jobId,
                       const RenderedPayload& payload, const std::string& settingKey) {
    DeliveryReport report;
    const auto started = monotonicMs();

    if (printerName == "offline") {
        report.errorCode = "E_PRINTER_OFFLINE";
        report.errorMessage = "Printer offline-dır";
        return report;
    }

    const auto opts = escPosOptionsFor(ctx, payload);
    printing::EscPosResult built;
    try {
        built = payload.lines.empty() ? printing::buildEscPosText(payload.text, opts)
                                      : printing::buildEscPos(payload.lines, opts);
    } catch (const std::exception& error) {
        report.errorCode = "E_PRINT_LAYOUT"; report.errorMessage = error.what(); return report;
    }

    if (!isSpoolTarget(printerName)) {
        report.usedMode = built.usedMode;
        report.payloadBytes = built.bytes.size();
        report.note = built.note;

        std::vector<std::string> tried;
        std::string lastError;

        const auto attempt = [&](const std::string& target) {
            std::string error;
            if (!sendOnce(target, built.bytes, error)) {
                lastError = target + ": " + error;
                logger()->warn("print job {} could not reach {}: {}", jobId, target, error);
                tried.push_back(target);
                return false;
            }

            writeSpoolCopy(ctx, jobId, payload.text);
            report.ok = true;
            report.physical = true;
            report.usedTarget = target;
            report.durationMs = monotonicMs() - started;

            if (target != printerName && !settingKey.empty()) {
                rememberPrinter(ctx, settingKey, target);
                report.note = report.note.empty()
                                  ? "auto-selected " + target
                                  : report.note + "; auto-selected " + target;
                logger()->info("print target auto-selected: {} = {}", settingKey, target);
            }
            rememberNetworkPrinter(ctx, target);

            logger()->info(
                "print job {} sent: printer={} paper={}mm cols={} mode={} bytes={} items={} "
                "subtotalMinor={} taxMinor={} totalMinor={} durationMs={} result=ok",
                jobId, target, printing::paperWidthMm(payload.paperWidth), payload.charsPerLine,
                printing::renderModeToString(built.usedMode), built.bytes.size(),
                payload.itemCount, payload.subtotalMinor, payload.taxMinor, payload.totalMinor,
                report.durationMs);
            if (!built.note.empty()) logger()->info("print job {} note: {}", jobId, built.note);
            return true;
        };

        // Fast path: the printer the till is configured for. Discovery - which
        // now includes a LAN sweep - only runs when this does not answer, so a
        // working till never pays for a scan.
        if (!isAutoTarget(printerName) && attempt(printerName)) return report;

        for (const auto& target : discoveredTargets(ctx, printerName, tried)) {
            if (attempt(target)) return report;
        }

        if (lastError.empty()) lastError = "Heç bir printer tapılmadı";

        // Nothing answered. Keep the paper copy on disk so the bill is not lost
        // and the job can be retried once the printer is back.
        writeSpoolCopy(ctx, jobId, payload.text);
        report.errorCode = "E_PRINTER_SEND";
        report.errorMessage = lastError;
        report.durationMs = monotonicMs() - started;
        return report;
    }

    try {
        const auto file = spoolDirectory(ctx) / (jobId + ".txt");
        std::ofstream out(file, std::ios::binary | std::ios::trunc);
        if (!out) {
            report.errorCode = "E_PRINTER_SPOOL";
            report.errorMessage = "Çap faylı açıla bilmədi";
            return report;
        }
        out << payload.text;
        out.close();
        report.ok = true;
        report.physical = false;
        report.usedTarget = "virtual";
        report.payloadBytes = payload.text.size();
        report.durationMs = monotonicMs() - started;
        report.note = report.note.empty()
                          ? "yalnız fayla yazıldı - fiziki çap olmadı"
                          : report.note + "; yalnız fayla yazıldı - fiziki çap olmadı";
        logger()->warn(
            "print job {} written to {} ({} bytes) result=spool-only - NO PAPER, target is "
            "'{}'",
            jobId, file.string(), payload.text.size(), printerName.empty() ? "virtual" : printerName);
        return report;
    } catch (const std::exception& err) {
        report.errorCode = "E_PRINTER_SPOOL";
        report.errorMessage = err.what();
        return report;
    }
}

/** Loads settings, honouring a per-job paper width and render-mode override. */
printing::ReceiptSettings settingsForJob(Context& ctx, const Json& overrides) {
    printing::ReceiptBuilder builder(ctx);
    const auto stored = builder.settings();
    auto config = overrides.contains("paperWidth")
        ? builder.settings(printing::paperWidthFromMm(overrides.at("paperWidth").get<double>())) : stored;
    if (overrides.contains("dpi")) config.paperWidth.dpi = overrides.at("dpi").get<int>();
    if (overrides.contains("printableDots")) config.paperWidth.printableDots = overrides.at("printableDots").get<int>();
    const int dots = printing::printableDotWidth(config.paperWidth);
    config.paperWidthMm = config.paperWidth.mm;
    const std::string mode = overrides.value("renderMode", "");
    if (!mode.empty()) config.renderMode = printing::renderModeFromString(mode);
    if (overrides.contains("charsPerLine")) config.charsPerLine = overrides.at("charsPerLine").get<int>();
    if (overrides.contains("fontHeightPx")) config.fontHeightPx = overrides.at("fontHeightPx").get<int>();
    if (overrides.contains("fontWidthPx")) config.fontWidthPx = overrides.at("fontWidthPx").get<int>();
    if (overrides.contains("sideMarginPx")) config.sideMarginPx = overrides.at("sideMarginPx").get<int>();
    if (overrides.contains("qrOn")) config.printQr = overrides.at("qrOn").get<bool>();
    if (overrides.contains("currencyDisplay")) config.currencyDisplay = printing::currencyDisplayFromString(overrides.at("currencyDisplay").get<std::string>());
    require(config.charsPerLine >= 16 && config.charsPerLine <= 96, "Invalid columns");
    require(config.fontHeightPx >= 0 && config.fontHeightPx <= 96 && config.fontWidthPx >= 0 && config.fontWidthPx <= 64, "Invalid font size");
    require(config.sideMarginPx >= 0 && config.sideMarginPx <= 80 && dots - 2 * config.sideMarginPx >= config.charsPerLine * 6, "Columns or margins do not fit printable width");
    return config;
}

/**
 * Drains the print queue.
 *
 * Pull-driven rather than a background thread: the database connection is
 * confined to the worker thread, and the UI polls print state anyway. Called
 * whenever a job is queued or the job list is read.
 */
printing::ReceiptDocument sampleDocument(Context& ctx, const printing::ReceiptSettings& config, const Json& overrides) {
    const auto name = ctx.setting("restaurant.name", "");
    printing::ReceiptDocument doc;
    doc.restaurant.name = name;
    doc.restaurant.tagline = ctx.setting("restaurant.tagline", "");
    doc.restaurant.address = ctx.setting("restaurant.address", "");
    doc.restaurant.phone = ctx.setting("restaurant.phone", "");
    doc.restaurant.hours = ctx.setting("restaurant.hours", "");
    doc.restaurant.taxId = ctx.setting("restaurant.taxId", "");
    std::string branch = ctx.setting("branch.name", "");
    const auto brand = overrides.value("brand", Json::object());
    if (brand.is_object()) {
        auto field = [&](const char* key, std::string& target) {
            if (brand.contains(key)) { target = brand.at(key).get<std::string>(); require(target.size() <= 2048, "Header too long"); }
        };
        field("name", doc.restaurant.name); field("tagline", doc.restaurant.tagline);
        field("address", doc.restaurant.address); field("phone", doc.restaurant.phone);
        field("hours", doc.restaurant.hours); field("taxId", doc.restaurant.taxId); field("branch", branch);
    }
    if (!branch.empty()) { if (!doc.restaurant.tagline.empty()) doc.restaurant.tagline += " · "; doc.restaurant.tagline += branch; }
    doc.receiptNumber = "R-PREVIEW";
    doc.orderNumber = "A-PREVIEW";
    doc.tableName = "3";
    doc.areaName = "Əsas Zal";
    doc.waiterName = "Admin";
    doc.guestCount = 4;
    doc.openedAt = nowMs();
    doc.paidAt = nowMs();
    doc.paperWidth = config.paperWidth;
    doc.charsPerLine = config.charsPerLine;
    doc.currencyCode = config.currencyCode;
    doc.currencyDisplay = config.currencyDisplay;

    printing::ReceiptItem burger;
    burger.name = "Burger Ət";
    burger.quantity = 1;
    burger.unitBasePrice = 900;
    burger.baseLineTotal = 900;
    burger.itemLineTotal = 900;
    doc.items.push_back(burger);

    printing::ReceiptItem fries;
    fries.name = "Kartof fri";
    fries.quantity = 2;
    fries.unitBasePrice = 400;
    fries.baseLineTotal = 800;
    fries.itemLineTotal = 800;
    doc.items.push_back(fries);

    doc.subtotal = 1700;
    doc.grandTotal = 1700;
    doc.amountPaid = 1700;
    printing::ReceiptPayment cash;
    cash.method = "cash";
    cash.label = "Nağd";
    cash.amount = 1700;
    doc.payments.push_back(cash);
    doc.footer = {"Təşəkkür edirik!", "Sizi yenidən gözləyirik.", doc.restaurant.name};
    doc.printQr = config.printQr;
    doc.qrPayload =
        printing::buildQrPayload(doc, ctx.setting("receipt.verifyUrl", ""),
                 overrides.value("qrUrl", ctx.setting("receipt.qrUrl", "")));

    if (!doc.printQr) doc.qrPayload.clear();
    return doc;
}

int drainQueue(Context& ctx) {
    const auto now = nowMs();

    auto due = ctx.db().prepare(
        "SELECT id, order_id, kind, target_printer, attempts, max_attempts, receipt_id, payload "
        "FROM print_jobs "
        "WHERE status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= :now) "
        "ORDER BY created_at LIMIT 20");
    due.bind(":now", now);

    struct Pending {
        std::string id, orderId, kind, printer, receiptId, options;
        int attempts, maxAttempts;
    };
    std::vector<Pending> jobs;
    while (due.step()) {
        jobs.push_back({due.columnText(0), due.columnText(1), due.columnText(2), due.columnText(3),
                        due.columnText(6), due.columnText(7), static_cast<int>(due.columnInt(4)),
                        static_cast<int>(due.columnInt(5))});
    }

    int processed = 0;

    for (const auto& job : jobs) {
        printing::ReceiptBuilder builder(ctx);
        RenderedPayload payload;
        std::string receiptId = job.receiptId;

        Json overrides = Json::object();
        try {
            if (!job.options.empty()) overrides = Json::parse(job.options);
        } catch (...) {
            overrides = Json::object();
        }
        if (!overrides.is_object()) overrides = Json::object();

        const bool isReprint = overrides.value("reprint", false);

        try {
            const auto config = settingsForJob(ctx, overrides);
            db::Transaction txn(ctx.db());

            auto mark = ctx.db().prepare(
                "UPDATE print_jobs SET status = 'processing', updated_at = :now WHERE id = :jobId");
            mark.bind(":now", nowMs()).bind(":jobId", job.id);
            mark.exec();

            payload.paperWidth = config.paperWidth;
            payload.charsPerLine = config.charsPerLine;
            payload.renderMode = config.renderMode;
            payload.fontHeightPx = config.fontHeightPx;
            payload.fontWidthPx = config.fontWidthPx;
            payload.sideMarginPx = config.sideMarginPx;

            if (job.kind == "test_page") {
                const auto doc = sampleDocument(ctx, config, overrides);
                payload.lines = printing::formatReceipt(doc);
                payload.text = printing::renderPlainText(payload.lines, config.charsPerLine);
                payload.qrPayload = doc.printQr ? doc.qrPayload : "";
            } else if (job.kind == "x_report" || job.kind == "z_report") {
                Json canonical = overrides.contains("canonical") && overrides["canonical"].is_object()
                                     ? overrides["canonical"]
                                     : overrides;
                if (overrides.contains("sequenceNo")) {
                    canonical["sequenceNo"] = overrides["sequenceNo"];
                }
                printing::ReceiptBuilder reportBuilder(ctx);
                const auto rendered = reportBuilder.xzReport(canonical, job.kind);
                // Structured lines + raster so Azerbaijani glyphs and ₼ survive.
                payload.lines = rendered.lines;
                payload.text = rendered.text;
                payload.qrPayload = rendered.qrPayload;
                payload.totalMinor = rendered.totalMinor;
                payload.renderMode = printing::RenderMode::Raster;
                receiptId = printing::storeReceipt(ctx, "", job.kind, rendered);
            } else if (job.kind == "period_report") {
                printing::ReceiptBuilder periodBuilder(ctx);
                const auto rendered = periodBuilder.periodReport(
                    getOr<Timestamp>(overrides, "from", 0),
                    getOr<Timestamp>(overrides, "to", nowMs()));
                payload.lines = rendered.lines;
                payload.text = rendered.text;
                payload.totalMinor = rendered.totalMinor;
                // Raster for the same reason X/Z uses it: Azerbaijani glyphs and
                // the manat sign exist in no thermal code page.
                payload.renderMode = printing::RenderMode::Raster;
                receiptId = printing::storeReceipt(ctx, "", job.kind, rendered);
            } else if (job.kind == "warehouse_slip") {
                // Addressed by the purchase it documents, like the refund slip
                // is by its refund: one delivery, one note, reprintable.
                const auto purchaseId = getOr<std::string>(overrides, "purchaseId", "");
                require(!purchaseId.empty(), "purchaseId is required for a warehouse slip");
                const auto rendered = builder.warehouseSlip(purchaseId);
                payload.lines = rendered.lines;
                payload.text = rendered.text;
                payload.totalMinor = rendered.totalMinor;
                // Raster for the same reason the reports use it: Azerbaijani
                // glyphs and the manat sign exist in no thermal code page.
                payload.renderMode = printing::RenderMode::Raster;
                receiptId = printing::storeReceipt(ctx, "", job.kind, rendered);
            } else if (job.kind == "refund_receipt") {
                // The refund it documents is named in the job's options, not by
                // its order: one sale can be refunded more than once, and each
                // refund gets its own slip.
                const auto refundId = getOr<std::string>(overrides, "refundId", "");
                require(!refundId.empty(), "refundId is required for a refund receipt");
                const auto rendered = builder.refundReceipt(refundId);
                payload.lines = rendered.lines;
                payload.text = rendered.text;
                payload.totalMinor = rendered.totalMinor;
                // Raster for the same reason X/Z uses it: Azerbaijani glyphs
                // and the manat sign exist in no thermal code page.
                payload.renderMode = printing::RenderMode::Raster;
                receiptId = printing::storeReceipt(ctx, job.orderId, job.kind, rendered);
            } else if (job.kind == "kitchen_ticket") {
                const auto rendered = builder.kitchenTicket(job.orderId);
                payload.text = rendered.text;
                receiptId = printing::storeReceipt(ctx, job.orderId, job.kind, rendered);
            } else if (!receiptId.empty()) {
                // A retry or reprint replays the stored snapshot, so the guest
                // never sees a different bill than the one they paid.
                auto stored = ctx.db().prepare(
                    "SELECT content_json FROM receipts WHERE id = :receiptId");
                stored.bind(":receiptId", receiptId);
                if (!stored.step()) throw PosError::of(protocol::err::kNotFound);

                printing::ReceiptDocument doc =
                    printing::documentFromJson(Json::parse(stored.columnText(0)));
                doc.paperWidth = config.paperWidth;
                doc.charsPerLine = config.charsPerLine;
                doc.isReprint = doc.isReprint || isReprint;
                doc.printQr = config.printQr;
                doc.qrPayload = config.printQr ? ctx.setting("receipt.qrUrl", "") : "";

                payload.lines = printing::formatReceipt(doc);
                payload.text = printing::renderPlainText(payload.lines, doc.charsPerLine);
                payload.qrPayload = doc.printQr ? doc.qrPayload : "";
                payload.itemCount = static_cast<int>(doc.items.size());
                payload.subtotalMinor = doc.subtotal;
                payload.taxMinor = doc.taxTotal;
                payload.totalMinor = doc.grandTotal;
            } else {
                const bool preliminaryBill = job.kind == "customer_bill";
                const printing::ReceiptDocument doc =
                    builder.customerDocument(job.orderId, config, isReprint, preliminaryBill);
                payload.lines = printing::formatReceipt(doc);
                payload.text = printing::renderPlainText(payload.lines, doc.charsPerLine);
                payload.qrPayload = doc.printQr ? doc.qrPayload : "";
                payload.itemCount = static_cast<int>(doc.items.size());
                payload.subtotalMinor = doc.subtotal;
                payload.taxMinor = doc.taxTotal;
                payload.totalMinor = doc.grandTotal;

                printing::RenderedReceipt rendered;
                rendered.number = doc.receiptNumber;
                rendered.text = payload.text;
                rendered.data = doc.toJson();
                rendered.totalMinor = doc.grandTotal;
                receiptId = printing::storeReceipt(ctx, job.orderId, job.kind, rendered);
            }

            if (!receiptId.empty()) {
                auto link = ctx.db().prepare(
                    "UPDATE print_jobs SET receipt_id = :receiptId WHERE id = :jobId");
                link.bind(":receiptId", receiptId).bind(":jobId", job.id);
                link.exec();
            }

            txn.commit();
        } catch (const std::exception& err) {
            logger()->error("could not render print job {}: {}", job.id, err.what());
            auto fail = ctx.db().prepare(
                "UPDATE print_jobs SET status = 'failed', last_error = :error, updated_at = :now "
                "WHERE id = :jobId");
            fail.bind(":error", std::string(err.what())).bind(":now", nowMs()).bind(":jobId", job.id);
            fail.exec();
            continue;
        }

        const std::string settingKey = printerRoleFor(job.kind);
        const DeliveryReport report = deliver(ctx, job.printer, job.id, payload, settingKey);
        const std::string error =
            report.errorMessage.empty() ? report.note
                                        : report.errorCode + ": " + report.errorMessage;
        const int attempts = job.attempts + 1;

        db::Transaction txn(ctx.db());

        if (report.ok) {
            // Record where it really printed: with auto-detection that is not
            // always the target the job was queued against.
            //
            // A spool-only job is `completed` because nothing failed, but the
            // note is kept so the jobs list can say so out loud instead of
            // showing a clean success for a receipt no guest ever received.
            auto update = ctx.db().prepare(
                "UPDATE print_jobs SET status = 'completed', attempts = :attempts, "
                "       target_printer = COALESCE(NULLIF(:used, ''), target_printer), "
                "       last_error = :note, updated_at = :now WHERE id = :jobId");
            update.bind(":attempts", attempts)
                .bind(":used", report.usedTarget)
                .bind(":note", report.physical ? std::string() : report.note)
                .bind(":now", nowMs())
                .bind(":jobId", job.id);
            update.exec();

            if (!report.physical) {
                logger()->warn("print job {} completed WITHOUT paper: {}", job.id, report.note);
            }
        } else {
            // Exhausted retries become `failed`, which surfaces in the UI. The
            // order itself is never lost - the job row keeps everything needed
            // to reprint once the printer is back.
            const bool giveUp = attempts >= job.maxAttempts;
            auto update = ctx.db().prepare(
                "UPDATE print_jobs SET status = :status, attempts = :attempts, "
                "       last_error = :error, next_attempt_at = :next, updated_at = :now "
                "WHERE id = :jobId");
            update.bind(":status", giveUp ? "failed" : "retrying")
                .bind(":attempts", attempts)
                .bind(":error", error)
                .bind(":next", nowMs() + backoffFor(attempts))
                .bind(":now", nowMs())
                .bind(":jobId", job.id);
            update.exec();

            logger()->warn("print job {} attempt {} failed: {}", job.id, attempts, error);
        }

        txn.commit();
        processed++;
    }

    return processed;
}

/** A discovered candidate in the shape the settings screen consumes. */
Json candidateToJson(const printing::PrinterCandidate& candidate) {
    std::string model = candidate.model;
    if (!candidate.manufacturer.empty()) {
        model = model.empty() ? candidate.manufacturer : candidate.manufacturer + " " + model;
    }

    const auto status = printing::decodeEscPosStatus(candidate.statusByte);
    const bool offline = candidate.escposConfirmed && !status.online;

    return Json{{"name", candidate.target},
                {"displayName", candidate.displayName},
                {"connection", std::string(printing::linkToString(candidate.link))},
                {"model", model},
                {"commandSet", candidate.commandSet},
                {"vendorId", candidate.vendorId},
                {"productId", candidate.productId},
                {"port", candidate.port},
                {"driver", candidate.driver},
                {"ipAddress", candidate.ipAddress},
                {"macAddress", candidate.macAddress},
                {"escposConfirmed", candidate.escposConfirmed},
                {"score", candidate.score},
                {"isDefault", candidate.isCurrent},
                {"description", candidate.link == printing::PrinterLink::UsbRaw
                                    ? "USB termal printer (driver tələb etmir)"
                                : candidate.link == printing::PrinterLink::UsbQueue
                                    ? "USB printer növbəsi"
                                : candidate.link == printing::PrinterLink::Serial
                                    ? "Serial printer"
                                : candidate.link == printing::PrinterLink::Network
                                    ? (candidate.escposConfirmed
                                           ? "Şəbəkə ESC/POS printeri (təsdiqlənib)"
                                           : "Şəbəkə cihazı (ESC/POS cavab vermədi)")
                                : candidate.link == printing::PrinterLink::Virtual
                                    ? "Virtual printer (fayla yazır)"
                                    : "Printer"},
                {"status", offline ? "offline" : "ready"}};
}

Json listPrinters(Context& ctx) {
    Json printers = Json::array();
    const std::string receiptTarget = ctx.setting("printer.receipt", "auto");
    // Local links only: this runs every time the settings screen opens, and a
    // LAN sweep there would cost seconds on each visit. `print.detect` is the
    // explicit "look for it" action and does include the network.
    for (const auto& candidate : printing::rankPrinterCandidates(receiptTarget, false)) {
        printers.push_back(candidateToJson(candidate));
    }
    return printers;
}

/**
 * A two-line page that proves the paper path works.
 *
 * Kept deliberately short: auto-detection may try several devices, and a
 * full-length test page on each would waste a metre of paper.
 */
std::vector<std::uint8_t> buildProbePage(Context& ctx, const std::string& label) {
    printing::ReceiptBuilder builder(ctx);
    const auto config = builder.settings();

    std::string text = "AVTOMATIK ASKARLAMA\n";
    text += ctx.setting("restaurant.name", "Milioner") + "\n";
    text += label + "\n";

    printing::EscPosOptions opts;
    opts.density = static_cast<int>(ctx.settingInt("printer.density", 5));
    opts.cut = ctx.settingInt("printer.cut", 1) != 0;
    opts.beep = false;  // probing several devices should not sound like an alarm
    opts.openCashDrawer = false;
    opts.feedLines = 3;
    opts.codePage = config.codePage;
    opts.renderMode = printing::RenderMode::Text;
    opts.paperWidth = config.paperWidth;
    opts.charsPerLine = config.charsPerLine;
    opts.qr = false;
    return printing::buildEscPosText(text, opts).bytes;
}

}  // namespace

void registerPrinting(const ContextPtr& ctx) {
    auto& server = ctx->server();

    server.registerHandler(
        std::string(protocol::method::kReceiptsPreview), [ctx](const ipc::Request& request) {
            ctx->requireAuth();

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto kind = getOr<std::string>(request.payload, "kind", "customer_receipt");
            require(!orderId.empty(), "orderId is required");

            printing::ReceiptBuilder builder(*ctx);

            if (kind == "kitchen_ticket") {
                const auto rendered = builder.kitchenTicket(orderId);
                return Json{{"kind", kind},
                            {"number", rendered.number},
                            {"text", rendered.text},
                            {"data", rendered.data},
                            {"totalMinor", rendered.totalMinor}};
            }

            // The preview renders both paper widths from the same document, which
            // is what guarantees the on-screen bill and the paper bill agree.
            const auto config = settingsForJob(*ctx, request.payload);
            const bool preliminaryBill = kind == "customer_bill";
            const printing::ReceiptDocument doc =
                builder.customerDocument(orderId, config,
                                         getOr<bool>(request.payload, "reprint", false),
                                         preliminaryBill);

            printing::ReceiptDocument doc58 = doc;
            doc58.paperWidth = builder.settings(printing::PaperWidth::Mm58).paperWidth;
            doc58.charsPerLine = builder.settings(printing::PaperWidth::Mm58).charsPerLine;

            printing::ReceiptDocument doc80 = doc;
            doc80.paperWidth = builder.settings(printing::PaperWidth::Mm80).paperWidth;
            doc80.charsPerLine = builder.settings(printing::PaperWidth::Mm80).charsPerLine;

            const std::string brandLogo = builder.logoPngBase64();

            const std::string text = printing::renderPlainText(doc);
            const std::string missing = printing::unsupportedCharacters(text);

            return Json{
                {"kind", kind},
                {"number", doc.receiptNumber},
                {"text", text},
                {"text58", printing::renderPlainText(doc58)},
                {"text80", printing::renderPlainText(doc80)},
                {"html", printing::renderHtml(doc, brandLogo)},
                {"html58", doc.paperWidth.mm == 58 ? printing::renderHtml(doc58, brandLogo) : ""},
                {"html80", doc.paperWidth.mm == 80 ? printing::renderHtml(doc80, brandLogo) : ""},
                {"htmlRaster", printing::receiptPreviewHtml(doc, config, builder.logoBitmap())},
                {"charsPerLine", doc.charsPerLine},
                {"dpi", doc.paperWidth.dpi}, {"printableDots", printing::printableDotWidth(doc.paperWidth)},
                {"charsPerLine58", doc58.charsPerLine},
                {"charsPerLine80", doc80.charsPerLine},
                {"paperWidth", printing::paperWidthMm(doc.paperWidth)},
                {"renderMode", printing::renderModeToString(config.renderMode)},
                {"effectiveRenderMode",
                 config.renderMode == printing::RenderMode::Auto
                     ? (missing.empty() ? "text" : "raster")
                     : printing::renderModeToString(config.renderMode)},
                {"rasterAvailable", printing::rasterAvailable()},
                {"unsupportedCharacters", missing},
                {"document", doc.toJson()},
                {"data", doc.toJson()},
                {"totalMinor", doc.grandTotal}};
        });

    server.registerHandler(
        std::string(protocol::method::kReceiptsGet), [ctx](const ipc::Request& request) {
            ctx->requireAuth();
            const auto receiptId = getOr<std::string>(request.payload, "receiptId", "");

            auto stmt = ctx->db().prepare(
                "SELECT id, order_id AS orderId, kind, number, content_text AS text, "
                "       content_json AS data, total_minor AS totalMinor, created_at AS createdAt "
                "FROM receipts WHERE id = :receiptId");
            stmt.bind(":receiptId", receiptId);
            if (!stmt.step()) throw PosError::of(protocol::err::kNotFound);

            Json receipt = stmt.row();
            try {
                receipt["data"] = Json::parse(receipt.value("data", "{}"));
            } catch (...) {
                receipt["data"] = Json::object();
            }
            return receipt;
        });

    // ------------------------------------------------- refund from the paper
    server.registerHandler(
        std::string(protocol::method::kReceiptsLookupByCode), [ctx](const ipc::Request& request) {
            ctx->requirePermission("payment.refund");

            const auto [codeWithPrefix, codeAsTyped] = normaliseReceiptCode(
                getOr<std::string>(request.payload, "code", ""));
            require(codeAsTyped.size() >= 4, "Qəbz kodu ən azı 4 simvoldur");

            // Only a paid receipt. A preliminary bill carries a number too, and
            // refunding against one would return money that never arrived.
            auto stmt = ctx->db().prepare(
                "SELECT id, order_id, number, total_minor, created_at "
                "FROM receipts "
                "WHERE kind = 'customer_receipt' "
                "  AND UPPER(REPLACE(number, '-', '')) IN (:codeA, :codeB) "
                "ORDER BY created_at DESC LIMIT 1");
            stmt.bind(":codeA", codeWithPrefix).bind(":codeB", codeAsTyped);
            if (!stmt.step()) {
                throw PosError(std::string(protocol::err::kNotFound),
                               "Bu kodla ödənilmiş çek tapılmadı");
            }

            const std::string receiptId = stmt.columnText(0);
            const std::string orderId = stmt.columnText(1);
            const std::string number = stmt.columnText(2);
            const Money receiptTotal = stmt.columnInt(3);
            const Timestamp printedAt = stmt.columnInt(4);

            Json order = Json::object();
            if (!orderId.empty()) {
                auto head = ctx->db().prepare(
                    "SELECT o.id, o.order_number AS orderNumber, o.status, "
                    "       o.closed_at AS closedAt, t.label AS tableLabel, "
                    "       u.full_name AS waiterName "
                    "FROM orders o "
                    "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
                    "LEFT JOIN users u ON u.id = o.user_id "
                    "WHERE o.id = :orderId");
                head.bind(":orderId", orderId);
                if (head.step()) order = head.row();
            }

            // Every payment on that order with what is still returnable on it.
            // The cashier is choosing which tender to give back, and a split
            // bill has more than one - card and cash can differ in what is left.
            services::RefundService refunds(*ctx);
            Json payments = Json::array();
            Money refundableTotal = 0;
            {
                auto stmt2 = ctx->db().prepare(
                    "SELECT id, method, amount_minor AS amountMinor, tip_minor AS tipMinor, "
                    "       status, created_at AS createdAt "
                    "FROM payments WHERE order_id = :orderId AND status IN ('approved','refunded') "
                    "ORDER BY created_at");
                stmt2.bind(":orderId", orderId);
                for (auto& row : stmt2.rows()) {
                    const std::string paymentId = getOr<std::string>(row, "id", "");
                    Money remaining = 0;
                    try {
                        remaining = refunds.remainingRefundable(paymentId);
                    } catch (const PosError&) {
                        remaining = 0;  // a state that cannot be refunded reads as nothing left
                    }
                    row["refundedMinor"] = refunds.totalRefunded(paymentId);
                    row["remainingRefundableMinor"] = remaining;
                    refundableTotal += remaining;
                    payments.push_back(row);
                }
            }

            // Lines, each with what is left of it. A guest disputing one dish
            // is the common case, and the amount must come from the order's own
            // snapshot rather than today's menu price.
            Json items = Json::array();
            {
                auto stmt3 = ctx->db().prepare(
                    "SELECT oi.id, oi.name_snapshot AS name, oi.quantity, "
                    "       oi.line_total_minor AS lineTotalMinor, oi.status, "
                    "       COALESCE((SELECT SUM(ri.quantity) FROM refund_items ri "
                    "                 JOIN refunds r ON r.id = ri.refund_id "
                    "                 WHERE ri.order_item_id = oi.id AND r.status = 'completed'), 0) "
                    "         AS refundedQuantity "
                    "FROM order_items oi WHERE oi.order_id = :orderId "
                    "ORDER BY oi.created_at");
                stmt3.bind(":orderId", orderId);
                for (auto& row : stmt3.rows()) {
                    const auto sold = row.value("quantity", std::int64_t{0});
                    const auto back = row.value("refundedQuantity", std::int64_t{0});
                    row["refundableQuantity"] =
                        row.value("status", std::string{}) == "voided" ? 0 : std::max<std::int64_t>(0, sold - back);
                    items.push_back(row);
                }
            }

            // What already went back, so the cashier can see a guest who has
            // been refunded once before they hand over money a second time.
            Json history = Json::array();
            {
                auto stmt4 = ctx->db().prepare(
                    "SELECT r.id, r.amount_minor AS amountMinor, r.reason, r.method, "
                    "       r.created_at AS createdAt, u.full_name AS actorName "
                    "FROM refunds r LEFT JOIN users u ON u.id = r.actor_user_id "
                    "WHERE r.order_id = :orderId AND r.status = 'completed' "
                    "ORDER BY r.created_at");
                stmt4.bind(":orderId", orderId);
                history = stmt4.rows();
            }

            return Json{{"receiptId", receiptId},
                        {"number", number},
                        {"printedAt", printedAt},
                        {"totalMinor", receiptTotal},
                        {"orderId", orderId},
                        {"order", order},
                        {"payments", payments},
                        {"items", items},
                        {"refunds", history},
                        {"refundableTotalMinor", refundableTotal}};
        });

    server.registerHandler(
        std::string(protocol::method::kPrintEnqueue), [ctx](const ipc::Request& request) {
            ctx->requirePermission("receipt.print");

            const auto orderId = getOr<std::string>(request.payload, "orderId", "");
            const auto kind = getOr<std::string>(request.payload, "kind", "customer_receipt");
            const bool reportKind = kind == "test_page" || kind == "x_report" || kind == "z_report" ||
                                    kind == "shift_report" || kind == "period_report";
            // A refund slip is addressed by the refund it documents. Requiring
            // an orderId too would be one more thing for the caller to get
            // wrong, and the refund already knows which order it came off.
            const bool refundKind = kind == "refund_receipt";
            const bool warehouseKind = kind == "warehouse_slip";
            require(reportKind || refundKind || warehouseKind || !orderId.empty(),
                    "orderId is required");
            if (warehouseKind) {
                const auto options = request.payload.contains("options") ? request.payload["options"]
                                                                        : Json::object();
                require(!getOr<std::string>(options, "purchaseId", "").empty(),
                        "options.purchaseId is required for a warehouse slip");
            }
            if (refundKind) {
                const auto options = request.payload.contains("options") ? request.payload["options"]
                                                                        : Json::object();
                require(!getOr<std::string>(options, "refundId", "").empty(),
                        "options.refundId is required for a refund receipt");
            }

            protocol::PrintJobKind parsed{};
            if (!protocol::parsePrintJobKind(kind, parsed)) {
                throw PosError(std::string(protocol::err::kValidation),
                               "Unknown print job kind: " + kind);
            }

            services::Idempotency idempotency(*ctx);
            std::string jobId;

            {
                db::Transaction txn(ctx->db());

                if (auto replay = idempotency.begin(request.idempotencyKey,
                                                    std::string(protocol::method::kPrintEnqueue),
                                                    request.payload)) {
                    txn.commit();
                    return *replay;
                }

                // A double-tap on the print button must not produce two receipts.
                // The idempotency key only helps when the caller sends the same
                // one, so also collapse onto any job for this order still in
                // flight, or completed within the last few seconds.
                if (!orderId.empty()) {
                    auto existing = ctx->db().prepare(
                        "SELECT id FROM print_jobs WHERE order_id = :orderId AND kind = :kind "
                        "  AND (status IN ('queued','retrying','processing') "
                        "       OR (status = 'completed' AND updated_at >= :recent)) "
                        "ORDER BY created_at DESC LIMIT 1");
                    existing.bind(":orderId", orderId)
                        .bind(":kind", kind)
                        .bind(":recent", nowMs() - 5000);
                    if (existing.step()) {
                        const std::string duplicate = existing.columnText(0);
                        idempotency.complete(request.idempotencyKey,
                                             Json{{"jobId", duplicate}, {"duplicate", true}},
                                             "print_job", duplicate);
                        txn.commit();

                        auto stmt = ctx->db().prepare(
                            "SELECT id, status, attempts, last_error AS lastError, target_printer AS printer "
                            "FROM print_jobs WHERE id = :jobId");
                        stmt.bind(":jobId", duplicate);
                        stmt.step();
                        Json job = stmt.row();
                        job["duplicate"] = true;
                        return job;
                    }
                }

                // Any further print of a receipt that already reached a printer
                // is a reprint: mark the paper and leave an audit trail.
                bool isReprint = getOr<bool>(request.payload, "reprint", false);
                if (!isReprint && !orderId.empty() && kind == "customer_receipt") {
                    auto prior = ctx->db().prepare(
                        "SELECT COUNT(*) FROM print_jobs WHERE order_id = :orderId "
                        "  AND kind = :kind AND status = 'completed'");
                    prior.bind(":orderId", orderId).bind(":kind", kind);
                    isReprint = prior.step() && prior.columnInt(0) > 0;
                }

                jobId = crypto::uuid4();
                const auto now = nowMs();
                const std::string printer =
                    getOr<std::string>(request.payload, "printer",
                                       ctx->setting(printerRoleFor(kind), "auto"));

                const auto profile = settingsForJob(*ctx, request.payload);
                Json options{{"reprint", isReprint}, {"paperWidth", profile.paperWidth.mm},
                    {"dpi", profile.paperWidth.dpi}, {"printableDots", profile.paperWidth.printableDots},
                    {"charsPerLine", profile.charsPerLine}, {"renderMode", printing::renderModeToString(profile.renderMode)},
                    {"fontHeightPx", profile.fontHeightPx}, {"fontWidthPx", profile.fontWidthPx},
                    {"sideMarginPx", profile.sideMarginPx}, {"qrOn", profile.printQr}};
                if (kind == "test_page") {
                    for (const char* key : {"qrUrl", "brand", "currencyDisplay"})
                        if (request.payload.contains(key)) options[key] = request.payload[key];
                }
                if (profile.printQr) {
                    const auto link = kind == "test_page" ? options.value("qrUrl", ctx->setting("receipt.qrUrl", "")) : ctx->setting("receipt.qrUrl", "");
                    (void)printing::qrBitmap(link, profile.paperWidth);
                }
                // The job's options are rebuilt here from the printer profile,
                // so anything the caller sent has to be carried across
                // explicitly. The refund slip is addressed by its refund id and
                // renders from nothing else, so losing it here would fail the
                // job at render time with the money already returned.
                if (kind == "warehouse_slip") {
                    const auto sent = request.payload.contains("options")
                                          ? request.payload["options"] : Json::object();
                    options["purchaseId"] = getOr<std::string>(sent, "purchaseId", "");
                }

                if (kind == "refund_receipt") {
                    const auto sent = request.payload.contains("options")
                                          ? request.payload["options"] : Json::object();
                    options["refundId"] = getOr<std::string>(sent, "refundId", "");
                }

                if (hasField(request.payload, "canonical") &&
                    request.payload["canonical"].is_object()) {
                    options["canonical"] = request.payload["canonical"];
                }
                if (hasField(request.payload, "sequenceNo")) {
                    options["sequenceNo"] = request.payload["sequenceNo"];
                }
                // The period receipt is drawn from the range alone; the figures
                // are read at print time so paper and screen cannot disagree.
                if (request.payload.contains("from") && request.payload.contains("to")) {
                    options["from"] = request.payload["from"];
                    options["to"] = request.payload["to"];
                }

                auto insert = ctx->db().prepare(
                    "INSERT INTO print_jobs (id, order_id, kind, target_printer, status, "
                    "        payload, idempotency_key, next_attempt_at, created_at, updated_at) "
                    "VALUES (:id, :orderId, :kind, :printer, 'queued', :options, :key, :now, "
                    "        :now, :now)");
                insert.bind(":id", jobId)
                    .bindOptional(":orderId", orderId)
                    .bind(":kind", kind)
                    .bind(":printer", printer)
                    .bind(":options", serialize(options))
                    .bindOptional(":key", request.idempotencyKey)
                    .bind(":now", now);
                insert.exec();

                // A reprint keeps its own louder action name - it is the one a
                // manager looks for - but a first print is recorded too, so the
                // history can answer "was this bill ever printed, and by whom".
                ctx->audit(isReprint ? "print.reprint" : "print.enqueue", "print_job", jobId,
                           Json{{"orderId", orderId}, {"kind", kind}, {"printer", printer}});

                idempotency.complete(request.idempotencyKey, Json{{"jobId", jobId}}, "print_job",
                                     jobId);
                txn.commit();
            }

            drainQueue(*ctx);

            auto stmt = ctx->db().prepare(
                "SELECT id, status, attempts, last_error AS lastError, target_printer AS printer FROM print_jobs "
                "WHERE id = :jobId");
            stmt.bind(":jobId", jobId);
            stmt.step();
            Json job = stmt.row();

            ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"jobId", jobId}});
            return job;
        });

    server.registerHandler(
        std::string(protocol::method::kPrintJobs), [ctx](const ipc::Request& request) {
            ctx->requireAuth();

            // Reading the queue also advances it - retries land without needing
            // a separate background worker.
            drainQueue(*ctx);

            const auto status = getOr<std::string>(request.payload, "status", "");
            const auto limit =
                std::min<std::int64_t>(getOr<std::int64_t>(request.payload, "limit", 50), 200);

            std::string sql =
                "SELECT j.id, j.order_id AS orderId, o.order_number AS orderNumber, j.kind, "
                "       j.target_printer AS printer, j.status, j.attempts, j.max_attempts AS maxAttempts, "
                "       j.last_error AS lastError, j.receipt_id AS receiptId, "
                "       j.next_attempt_at AS nextAttemptAt, j.created_at AS createdAt "
                "FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id WHERE 1=1";
            if (!status.empty()) sql += " AND j.status = :status";
            sql += " ORDER BY j.created_at DESC LIMIT :limit";

            auto stmt = ctx->db().prepare(sql);
            if (!status.empty()) stmt.bind(":status", status);
            stmt.bind(":limit", limit);

            auto pending = ctx->db().prepare(
                "SELECT COUNT(*) FROM print_jobs WHERE status IN ('queued','retrying','processing')");
            const std::int64_t pendingCount = pending.step() ? pending.columnInt(0) : 0;

            auto failed = ctx->db().prepare(
                "SELECT COUNT(*) FROM print_jobs WHERE status = 'failed'");
            const std::int64_t failedCount = failed.step() ? failed.columnInt(0) : 0;

            return Json{{"jobs", stmt.rows()},
                        {"pendingCount", pendingCount},
                        {"failedCount", failedCount}};
        });

    server.registerHandler(
        std::string(protocol::method::kPrintRetry), [ctx](const ipc::Request& request) {
            ctx->requirePermission("printer.manage");
            const auto jobId = getOr<std::string>(request.payload, "jobId", "");

            {
                db::Transaction txn(ctx->db());
                auto update = ctx->db().prepare(
                    "UPDATE print_jobs SET status = 'queued', attempts = 0, last_error = '', "
                    "       next_attempt_at = :now, updated_at = :now WHERE id = :jobId");
                update.bind(":now", nowMs()).bind(":jobId", jobId);
                update.exec();

                if (ctx->db().changes() == 0) {
                    throw PosError::of(protocol::err::kPrintJobNotFound);
                }
                txn.commit();
            }

            drainQueue(*ctx);

            auto stmt = ctx->db().prepare(
                "SELECT id, status, attempts, last_error AS lastError, target_printer AS printer FROM print_jobs "
                "WHERE id = :jobId");
            stmt.bind(":jobId", jobId);
            stmt.step();
            Json job = stmt.row();

            ctx->server().emitEvent(protocol::event::kPrintUpdated, Json{{"jobId", jobId}});
            return job;
        });

    server.registerHandler(
        std::string(protocol::method::kPrintCancel), [ctx](const ipc::Request& request) {
            ctx->requirePermission("printer.manage");
            const auto jobId = getOr<std::string>(request.payload, "jobId", "");

            db::Transaction txn(ctx->db());
            auto update = ctx->db().prepare(
                "UPDATE print_jobs SET status = 'failed', last_error = 'Canceled by operator', "
                "       updated_at = :now WHERE id = :jobId AND status != 'completed'");
            update.bind(":now", nowMs()).bind(":jobId", jobId);
            update.exec();
            ctx->audit("print.cancel", "print_job", jobId);
            txn.commit();

            return Json{{"jobId", jobId}, {"status", "failed"}};
        });

    server.registerHandler(
        std::string(protocol::method::kPrintPrinters), [ctx](const ipc::Request&) {
            ctx->requirePermission("printer.manage");

            printing::ReceiptBuilder builder(*ctx);
            const auto config = builder.settings();

            return Json{
                {"printers", listPrinters(*ctx)},
                {"receipt", ctx->setting("printer.receipt", "auto")},
                {"kitchen", ctx->setting("printer.kitchen", "auto")},
                {"warehouse", ctx->setting("printer.warehouse", "auto")},
                {"profile",
                 Json{{"autoDetect", ctx->settingInt("printer.autoDetect", 1) != 0},
                      {"paperWidth", config.paperWidthMm},
                      {"charsPerLine", config.charsPerLine},
                        {"dpi", config.paperWidth.dpi}, {"printableDots", printing::printableDotWidth(config.paperWidth)},
                      {"charsPerLine58",
                       builder.settings(printing::PaperWidth::Mm58).charsPerLine},
                      {"charsPerLine80",
                       builder.settings(printing::PaperWidth::Mm80).charsPerLine},
                      {"fontHeightPx", config.fontHeightPx},
                      {"fontWidthPx", config.fontWidthPx},
                      {"sideMarginPx", config.sideMarginPx},
                      {"renderMode", printing::renderModeToString(config.renderMode)},
                      {"rasterAvailable", printing::rasterAvailable()},
                      {"codePage", config.codePage},
                      {"characterSet", "CP857 (PC Turkish)"},
                      {"density", config.density},
                      {"bottomFeedLines", config.bottomFeedLines},
                      {"cut", config.cutAfterPrint},
                      {"openCashDrawer", config.openCashDrawer},
                      {"qr", config.printQr},
                      {"printItemUnitPrice", config.printItemUnitPrice},
                      {"printModifierPrice", config.printModifierPrice},
                      {"currency", config.currencyCode},
                      {"currencyDisplay",
                       ctx->setting("locale.currencyDisplay", "code")}}}};
        });

    server.registerHandler(
        std::string(protocol::method::kPrintDetect), [ctx](const ipc::Request& request) {
            ctx->requirePermission("settings.manage");

            const auto target = getOr<std::string>(request.payload, "target", "receipt");
            const std::string settingKey = printerRoleKey(target);
            const bool probe = getOr<bool>(request.payload, "probe", true);
            const auto current = ctx->setting(settingKey, "auto");

            const auto candidates = printing::rankPrinterCandidates(current);

            Json listed = Json::array();
            for (const auto& candidate : candidates) listed.push_back(candidateToJson(candidate));

            if (!probe) {
                return Json{{"target", target},
                            {"candidates", listed},
                            {"current", current},
                            {"chosen", nullptr},
                            {"probed", Json::array()}};
            }

            // Probe in rank order and stop at the first device that takes the
            // page: the operator wants a printer that works, not a report.
            Json probed = Json::array();
            std::string chosen;

            for (const auto& candidate : candidates) {
                if (candidate.link == printing::PrinterLink::Virtual) continue;
                if (candidate.score <= 0) continue;

                const auto bytes = buildProbePage(*ctx, candidate.displayName.empty()
                                                            ? candidate.target
                                                            : candidate.displayName);
                const auto started = monotonicMs();
                std::string error;
                const bool ok = sendOnce(candidate.target, bytes, error);

                probed.push_back(Json{{"target", candidate.target},
                                      {"displayName", candidate.displayName},
                                      {"ok", ok},
                                      {"error", error},
                                      {"durationMs", monotonicMs() - started}});

                if (ok) {
                    chosen = candidate.target;
                    break;
                }
            }

            if (!chosen.empty()) {
                db::Transaction txn(ctx->db());
                rememberPrinter(*ctx, settingKey, chosen);
                ctx->audit("printer.autodetect", "settings", settingKey,
                           Json{{"chosen", chosen}, {"previous", current}});
                txn.commit();

                for (auto& candidate : listed) {
                    candidate["isDefault"] = candidate.value("name", "") == chosen;
                }
            }

            return Json{{"target", target},
                        {"candidates", listed},
                        {"current", chosen.empty() ? current : chosen},
                        {"chosen", chosen.empty() ? Json(nullptr) : Json(chosen)},
                        {"probed", probed}};
        });

    server.registerHandler(
        std::string(protocol::method::kPrintPreviewTest), [ctx](const ipc::Request& request) {
            ctx->requireAuth();

            auto config = settingsForJob(*ctx, request.payload);
            printing::ReceiptBuilder builder(*ctx);
            // Whatever this venue has configured, with no fallback: the preview
            // exists to show the operator their own header, and the old defaults
            // printed the first customer's name, address and phone.
            const auto name = ctx->setting("restaurant.name", "");

            const auto doc = sampleDocument(*ctx, config, request.payload);

            const auto lines = printing::formatReceipt(doc);
            const std::string brandLogo = builder.logoPngBase64();
            return Json{{"kind", "preview_test"},
                        {"paperWidth", printing::paperWidthMm(config.paperWidth)},
                        {"charsPerLine", config.charsPerLine},
                        {"dpi", config.paperWidth.dpi}, {"printableDots", printing::printableDotWidth(config.paperWidth)},
                        {"renderMode", printing::renderModeToString(config.renderMode)},
                        {"text", printing::renderPlainText(lines, config.charsPerLine)},
                        {"html", printing::renderHtml(doc, brandLogo)},
                        {"htmlRaster", printing::receiptPreviewHtml(doc, config, builder.logoBitmap())},
                        {"document", doc.toJson()}};
        });

    server.registerHandler(
        std::string(protocol::method::kPrintSetPrinter), [ctx](const ipc::Request& request) {
            ctx->requirePermission("settings.manage");

            const auto target = getOr<std::string>(request.payload, "target", "");

            // Keys the printer settings screen is allowed to write. Anything else
            // is ignored rather than trusted, so the UI cannot rewrite finance or
            // security settings through the printer endpoint.
            static const std::vector<std::string> kProfileKeys{
                "printer.paperWidth", "printer.dpi", "printer.printableDots", "printer.charsPerLine", "printer.charsPerLine58", "printer.charsPerLine80",
                "printer.fontHeightPx", "printer.fontWidthPx",    "printer.sideMarginPx",
                "printer.renderMode",   "printer.codePage",       "printer.density",
                "printer.autoDetect",
                "printer.bottomFeedLines", "printer.cut",         "printer.beep",
                "printer.qr",           "printer.openCashDrawer", "printer.printItemUnitPrice",
                "printer.printModifierPrice", "locale.currencyDisplay"};

            db::Transaction txn(ctx->db());

            const auto write = [&](const std::string& key, const std::string& value) {
                auto upsert = ctx->db().prepare(
                    "INSERT INTO app_settings (key, value, value_type, updated_at) "
                    "VALUES (:key, :value, 'string', :now) "
                    "ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :now");
                upsert.bind(":key", key).bind(":value", value).bind(":now", nowMs());
                upsert.exec();
            };

            Json applied = Json::object();

            if (target == "receipt" || target == "kitchen" || target == "warehouse") {
                // Falling back to `virtual` here meant a setPrinter call that
                // omitted the name quietly parked the till on the spool file.
                const auto printerName =
                    getOr<std::string>(request.payload, "printerName", "auto");
                write("printer." + target, printerName);
                applied["printer." + target] = printerName;
                ctx->audit("printer.change", "settings", "printer." + target,
                           Json{{"printerName", printerName}});
            }

            if (hasField(request.payload, "settings") && request.payload["settings"].is_object()) {
                for (const auto& [key, value] : request.payload["settings"].items()) {
                    if (std::find(kProfileKeys.begin(), kProfileKeys.end(), key) ==
                        kProfileKeys.end()) {
                        continue;
                    }
                    std::string text;
                    if (value.is_string()) text = value.get<std::string>();
                    else if (value.is_boolean()) text = value.get<bool>() ? "1" : "0";
                    else if (value.is_number()) text = value.dump();
                    else continue;

                    write(key, text);
                    applied[key] = text;
                }
                if (!applied.empty()) {
                    ctx->audit("printer.profile", "settings", "printer", applied);
                }
            }

            (void)settingsForJob(*ctx, Json::object());
            require(!applied.empty(), "nothing to update");
            txn.commit();

            return Json{{"target", target}, {"applied", applied}};
        });
}

int drainPrintQueue(Context& ctx) { return drainQueue(ctx); }

}  // namespace pos::handlers
