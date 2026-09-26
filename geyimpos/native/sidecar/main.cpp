/**
 * geyim-pos-core - Geyim POS engine sidecar.
 * NDJSON over stdin/stdout. stderr = logs only.
 */
#include <clocale>
#include <cstdio>
#include <cstdlib>
#include <exception>

#include "market/Application.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include "market/ipc/StdioServer.hpp"

#ifdef _WIN32
#include <windows.h>
#endif

namespace {
[[noreturn]] void onTerminate() {
  std::fputs("[market-core] FATAL: unhandled exception, terminating\n", stderr);
  std::fflush(stderr);
  std::_Exit(3);
}
}  // namespace

int main(int argc, char** argv) {
  market::ipc::StdioServer::configureBinaryStdio();
  std::set_terminate(onTerminate);
#ifdef _WIN32
  SetConsoleOutputCP(CP_UTF8);
#endif
  std::setlocale(LC_ALL, "C.UTF-8");

  try {
    auto config = market::AppConfig::fromArgs(argc, argv);
    market::logging::init(config.logDir, config.logLevel);
    market::Application app(std::move(config));
    app.bootstrap();
    const int code = app.run();
    market::logging::shutdown();
    return code;
  } catch (const market::PosError& err) {
    std::fprintf(stderr, "[market-core] FATAL %s: %s\n", err.code().c_str(), err.message().c_str());
    std::fflush(stderr);
    market::logging::shutdown();
    return 2;
  } catch (const std::exception& err) {
    std::fprintf(stderr, "[market-core] FATAL: %s\n", err.what());
    std::fflush(stderr);
    market::logging::shutdown();
    return 2;
  }
}
