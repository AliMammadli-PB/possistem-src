/**
 * restaurant-pos-core - the POS engine.
 *
 * Runs as a sidecar process spawned by Electron, speaking newline-delimited
 * JSON over stdin/stdout. Deliberately NOT a native Node addon: a crash in the
 * engine must never take the cashier's UI down with it.
 *
 * Contract with the parent process:
 *   stdout - protocol frames, and nothing else, ever
 *   stderr - human-readable logs
 *   stdin  - protocol frames; EOF means "shut down cleanly"
 */
#include <clocale>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <string>

#include "pos/Application.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/ipc/StdioServer.hpp"

#ifdef _WIN32
#include <windows.h>
#endif

namespace {

/**
 * Last-resort handler.
 *
 * Writes a marker to stderr and exits with a distinct code so the Electron
 * supervisor can tell a crash from a clean shutdown. Nothing goes to stdout:
 * a half-written frame would desynchronise the protocol.
 */
[[noreturn]] void onTerminate() {
    std::fputs("[core] FATAL: unhandled exception, terminating\n", stderr);
    std::fflush(stderr);
    std::_Exit(3);
}

}  // namespace

int main(int argc, char** argv) {
    // Must happen before any output: without binary mode the CRT rewrites \n as
    // \r\n and every protocol frame arrives corrupted.
    pos::ipc::StdioServer::configureBinaryStdio();

    std::set_terminate(onTerminate);

#ifdef _WIN32
    // Emit UTF-8 for the Azerbaijani/Turkish menu text rather than the OEM codepage.
    SetConsoleOutputCP(CP_UTF8);
#endif
    std::setlocale(LC_ALL, "C.UTF-8");

    try {
        auto config = pos::AppConfig::fromArgs(argc, argv);
        pos::logging::init(config.logDir, config.logLevel);

        pos::Application app(std::move(config));
        app.bootstrap();
        const int code = app.run();

        pos::logging::shutdown();
        return code;
    } catch (const pos::PosError& err) {
        std::fprintf(stderr, "[core] FATAL %s: %s\n", err.code().c_str(), err.message().c_str());
        std::fflush(stderr);
        pos::logging::shutdown();
        return 2;
    } catch (const std::exception& err) {
        std::fprintf(stderr, "[core] FATAL: %s\n", err.what());
        std::fflush(stderr);
        pos::logging::shutdown();
        return 2;
    }
}
