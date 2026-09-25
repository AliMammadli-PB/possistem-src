#pragma once

#include <memory>
#include <string>

#include "pos/Common.hpp"
#include "pos/ipc/StdioServer.hpp"

namespace pos {

namespace db {
class Database;
}

struct AppConfig {
    std::string dbPath;
    std::string logDir = "logs";
    std::string logLevel = "info";
    int protocolVersion = 1;

    static AppConfig fromArgs(int argc, char** argv);
};

/**
 * Wires the sidecar together: logging, database, request handlers, stdio loop.
 *
 * Startup is reported to the Electron side as it happens (core.stage events) so
 * the splash screen shows genuine progress rather than a fabricated timer.
 */
class Application {
public:
    explicit Application(AppConfig config);
    ~Application();

    Application(const Application&) = delete;
    Application& operator=(const Application&) = delete;

    /** Opens the database, runs migrations and seeds. Throws PosError on failure. */
    void bootstrap();

    /** Runs the request loop until stdin closes. */
    int run();

    ipc::StdioServer& server() { return server_; }
    db::Database& database();

private:
    void reportStage(std::string_view key, std::string_view message, int progress);
    void registerCoreHandlers();

    AppConfig config_;
    ipc::StdioServer server_;
    std::unique_ptr<db::Database> database_;
    Timestamp startedAt_ = 0;
    bool ready_ = false;
};

}  // namespace pos
