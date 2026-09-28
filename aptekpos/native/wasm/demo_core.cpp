/**
 * The market core compiled to WebAssembly for the possistem.az live demo.
 *
 * The site can run the real Aptek POS UI against this build. There is no stdin in
 * a browser: each call hands one request frame to the server and returns what
 * it wrote (the response, then any events), newline-terminated.
 *
 *   market_boot(dbPath)  -> "" on success, an error message otherwise
 *   market_call(frame)   -> the frames the request produced
 */
#include <clocale>
#include <exception>
#include <memory>
#include <string>

#include <emscripten/emscripten.h>

#include "market/AppConfig.hpp"
#include "market/Application.hpp"
#include "market/Logging.hpp"
#include "market/ipc/StdioServer.hpp"

namespace {

std::unique_ptr<market::Application> g_app;
std::unique_ptr<market::ipc::StdioServer> g_server;
std::string g_out;

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char* market_boot(const char* dbPath) {
  std::setlocale(LC_ALL, "C.UTF-8");
  try {
    market::AppConfig config;
    config.dbPath = dbPath;
    config.logDir = "/tmp/logs";
    config.logLevel = "warn";
    market::logging::init(config.logDir, config.logLevel);
    g_app = std::make_unique<market::Application>(config);
    g_app->bootstrap();
    g_server = std::make_unique<market::ipc::StdioServer>();
    g_app->registerHandlers(*g_server);
    g_out.clear();
  } catch (const std::exception& err) {
    g_out = err.what();
  }
  return g_out.c_str();
}

EMSCRIPTEN_KEEPALIVE const char* market_call(const char* frame) {
  if (!g_server) return "";
  g_out = g_server->processLine(frame);
  return g_out.c_str();
}

}  // extern "C"
