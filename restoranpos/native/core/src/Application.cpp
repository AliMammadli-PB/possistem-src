#include "pos/Application.hpp"

#include <cstring>
#include <string>

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/db/Database.hpp"
#include "pos/db/Migrator.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/AuditArchive.hpp"
#include "pos/services/Idempotency.hpp"

namespace pos {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

}  // namespace

AppConfig AppConfig::fromArgs(int argc, char** argv) {
    AppConfig config;

    for (int i = 1; i < argc; ++i) {
        const std::string flag = argv[i];
        const bool hasValue = (i + 1) < argc;

        if (flag == "--db" && hasValue) {
            config.dbPath = argv[++i];
        } else if (flag == "--log-dir" && hasValue) {
            config.logDir = argv[++i];
        } else if (flag == "--log-level" && hasValue) {
            config.logLevel = argv[++i];
        } else if (flag == "--protocol" && hasValue) {
            config.protocolVersion = std::atoi(argv[++i]);
        }
    }

    if (const char* level = std::getenv("POS_LOG_LEVEL"); level && *level) {
        config.logLevel = level;
    }
    if (config.dbPath.empty()) config.dbPath = "pos.db";

    return config;
}

Application::Application(AppConfig config)
    : config_(std::move(config)), database_(std::make_unique<db::Database>()) {
    startedAt_ = nowMs();
}

Application::~Application() = default;

db::Database& Application::database() { return *database_; }

void Application::reportStage(std::string_view key, std::string_view message, int progress) {
    logger()->info("stage: {} ({}%)", message, progress);
    server_.emitEvent(protocol::event::kCoreStage,
                      Json{{"key", std::string(key)},
                           {"message", std::string(message)},
                           {"progress", progress}});
}

void Application::bootstrap() {
    // Background threads first: startup events must reach the splash screen as
    // they happen, not all at once after bootstrap finishes.
    server_.start();

    if (config_.protocolVersion != protocol::kProtocolVersion) {
        logger()->warn("parent requested protocol {} but this core speaks {}",
                       config_.protocolVersion, protocol::kProtocolVersion);
    }

    reportStage("db.open", "Connecting to local database…", 20);
    database_->open(config_.dbPath);

    reportStage("db.check", "Verifying database integrity…", 32);
    database_->verifyIntegrity();

    db::Migrator migrator(*database_);
    const auto progress = [this](const std::string& key, const std::string& message, int pct) {
        reportStage(key, message, pct);
    };

    migrator.migrate(progress);
    migrator.seedIfEmpty(progress);

    const int purged = pos::services::Idempotency::purgeExpired(*database_);
    if (purged > 0) {
        logger()->info("purged {} expired idempotency claim(s)", purged);
    }

    // Bounded and non-fatal by construction: the trail is written out to the
    // data directory before anything is removed, and a failure here must never
    // stop the till from opening.
    pos::services::AuditArchive::run(*database_, config_.dbPath);

    reportStage("handlers", "Preparing menu…", 82);
    registerCoreHandlers();
    handlers::registerAll(server_, *database_);

    // Any payment left mid-flight by a crash is resolved before the UI opens,
    // so an unknown card result can never be silently forgotten.
    reportStage("reconcile", "Checking pending payments…", 92);
    handlers::sweepPendingPayments(server_, *database_);

    ready_ = true;
    reportStage("ready", "System ready", 100);
}

void Application::registerCoreHandlers() {
    server_.registerHandler(std::string(protocol::method::kCorePing), [](const ipc::Request&) {
        return Json{{"pong", true}, {"coreTime", nowMs()}};
    });

    server_.registerHandler(std::string(protocol::method::kCoreInfo), [this](const ipc::Request&) {
        return Json{
            {"version", POS_CORE_VERSION},
            {"protocolVersion", protocol::kProtocolVersion},
            {"dbPath", database_->path()},
            {"uptimeMs", nowMs() - startedAt_},
            {"ready", ready_},
        };
    });

    server_.registerHandler(std::string(protocol::method::kCoreStats), [this](const ipc::Request&) {
        const auto freeBytes = database_->freeDiskBytes();
        return Json{
            {"handledRequests", static_cast<std::int64_t>(server_.handledCount())},
            {"uptimeMs", nowMs() - startedAt_},
            {"freeDiskBytes", freeBytes},
            {"schemaVersion", db::Migrator(*database_).currentVersion()},
        };
    });
}

int Application::run() {
    server_.onShutdown([this] {
        logger()->info("closing database");
        database_->close();
    });

    server_.emitReady(POS_CORE_VERSION);
    logger()->info("core {} ready in {} ms", POS_CORE_VERSION, nowMs() - startedAt_);

    server_.run();

    logger()->info("core stopped");
    return 0;
}

}  // namespace pos
