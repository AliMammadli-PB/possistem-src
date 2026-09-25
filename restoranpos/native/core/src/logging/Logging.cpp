#include "pos/Logging.hpp"

#include <filesystem>
#include <mutex>
#include <unordered_map>
#include <vector>

#include <spdlog/sinks/rotating_file_sink.h>
// stderr_sink_mt lives in stdout_sinks.h - there is no stderr_sinks.h.
#include <spdlog/sinks/stdout_sinks.h>

namespace pos::logging {
namespace {

std::mutex g_mutex;
std::unordered_map<std::string, std::shared_ptr<spdlog::logger>> g_loggers;
std::string g_logDir;
spdlog::level::level_enum g_level = spdlog::level::info;
std::shared_ptr<spdlog::sinks::sink> g_stderrSink;

constexpr std::size_t kMaxFileBytes = 5 * 1024 * 1024;
constexpr std::size_t kMaxFiles = 3;

spdlog::level::level_enum parseLevel(const std::string& level) {
    if (level == "trace") return spdlog::level::trace;
    if (level == "debug") return spdlog::level::debug;
    if (level == "warn") return spdlog::level::warn;
    if (level == "error") return spdlog::level::err;
    return spdlog::level::info;
}

}  // namespace

void init(const std::string& logDir, const std::string& level) {
    std::lock_guard<std::mutex> lock(g_mutex);

    g_logDir = logDir;
    g_level = parseLevel(level);

    std::error_code ec;
    std::filesystem::create_directories(logDir, ec);

    // stderr, never stdout. The Electron supervisor drains this pipe; leaving it
    // unread would fill the 64 KB buffer and block this process on its next log
    // write, which looks exactly like a deadlock.
    g_stderrSink = std::make_shared<spdlog::sinks::stderr_sink_mt>();
    g_stderrSink->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%^%l%$] [%n] %v");

    // Replacing the default logger is what stops spdlog's built-in stdout
    // logger from ever corrupting the protocol stream.
    auto defaultLogger = get("core");
    spdlog::set_default_logger(defaultLogger);
    spdlog::set_level(g_level);
    spdlog::flush_on(spdlog::level::warn);
}

std::shared_ptr<spdlog::logger> get(const std::string& name) {
    auto it = g_loggers.find(name);
    if (it != g_loggers.end()) return it->second;

    std::vector<spdlog::sink_ptr> sinks;
    if (g_stderrSink) sinks.push_back(g_stderrSink);

    if (!g_logDir.empty()) {
        try {
            auto path = (std::filesystem::path(g_logDir) / (name + ".log")).string();
            auto fileSink = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
                path, kMaxFileBytes, kMaxFiles);
            fileSink->set_pattern("[%Y-%m-%d %H:%M:%S.%e] [%l] [%n] %v");
            sinks.push_back(fileSink);
        } catch (const std::exception&) {
            // A log file we cannot open (disk full, permissions) must not stop
            // the POS from taking orders.
        }
    }

    auto logger = std::make_shared<spdlog::logger>(name, sinks.begin(), sinks.end());
    logger->set_level(g_level);
    logger->flush_on(spdlog::level::warn);

    g_loggers[name] = logger;
    spdlog::register_logger(logger);
    return logger;
}

void shutdown() {
    std::lock_guard<std::mutex> lock(g_mutex);
    for (auto& [name, logger] : g_loggers) {
        logger->flush();
    }
    g_loggers.clear();
    spdlog::shutdown();
}

}  // namespace pos::logging
