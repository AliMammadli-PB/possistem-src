/**
 * The restaurant core compiled to WebAssembly for the possistem.az live demo.
 *
 * The site runs the real till UI against this build, so every screen and every
 * rule is the product's own. There are no threads in the browser: the server
 * runs inline and each call returns the frames it produced, newline-joined.
 *
 *   pos_boot(dbPath)  -> startup frames (core.stage…, core.ready)
 *   pos_call(frame)   -> the response frame plus any events it emitted
 */
#include <clocale>
#include <exception>
#include <memory>
#include <string>
#include <vector>

#include <emscripten/emscripten.h>

#include "pos/Application.hpp"
#include "pos/Logging.hpp"

namespace {

std::unique_ptr<pos::Application> g_app;
std::string g_out;

const char* joined(const std::vector<std::string>& frames) {
    g_out.clear();
    for (const auto& frame : frames) {
        g_out += frame;
        g_out += '\n';
    }
    return g_out.c_str();
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char* pos_boot(const char* dbPath) {
    std::setlocale(LC_ALL, "C.UTF-8");
    try {
        pos::AppConfig config;
        config.dbPath = dbPath;
        config.logDir = "/tmp/logs";
        config.logLevel = "warn";
        pos::logging::init(config.logDir, config.logLevel);
        g_app = std::make_unique<pos::Application>(config);
        g_app->server().useInlineMode();
        g_app->bootstrap();
        g_app->server().emitReady(POS_CORE_VERSION);
        return joined(g_app->server().drainOutbound());
    } catch (const std::exception& err) {
        g_out = std::string("{\"type\":\"event\",\"event\":\"core.fatal\",\"payload\":{\"message\":\"") +
                err.what() + "\"}}\n";
        return g_out.c_str();
    }
}

EMSCRIPTEN_KEEPALIVE const char* pos_call(const char* frame) {
    if (!g_app) return "";
    return joined(g_app->server().processFrame(frame));
}

}  // extern "C"
