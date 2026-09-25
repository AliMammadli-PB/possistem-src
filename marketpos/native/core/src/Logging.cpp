#include "market/Logging.hpp"
#include <spdlog/spdlog.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/sinks/stdout_color_sinks.h>
#include <filesystem>
#include <iostream>
#include <memory>

namespace market::logging {

namespace {
std::shared_ptr<spdlog::logger> g_logger;
}

void init(const std::string& logDir, const std::string& level) {
  std::filesystem::create_directories(logDir);
  auto file = std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
      (std::filesystem::path(logDir) / "market-core.log").string(), 5 * 1024 * 1024, 3);
  auto err = std::make_shared<spdlog::sinks::stderr_color_sink_mt>();
  g_logger = std::make_shared<spdlog::logger>("market", spdlog::sinks_init_list{file, err});
  spdlog::set_default_logger(g_logger);
  if (level == "debug") spdlog::set_level(spdlog::level::debug);
  else if (level == "warn") spdlog::set_level(spdlog::level::warn);
  else if (level == "error") spdlog::set_level(spdlog::level::err);
  else spdlog::set_level(spdlog::level::info);
  spdlog::flush_on(spdlog::level::warn);
  info("logging initialized");
}

void shutdown() {
  if (g_logger) {
    g_logger->flush();
    spdlog::shutdown();
    g_logger.reset();
  }
}

void info(const std::string& msg) {
  if (g_logger) g_logger->info(msg);
  else std::cerr << "[info] " << msg << "\n";
}

void warn(const std::string& msg) {
  if (g_logger) g_logger->warn(msg);
  else std::cerr << "[warn] " << msg << "\n";
}

void error(const std::string& msg) {
  if (g_logger) g_logger->error(msg);
  else std::cerr << "[error] " << msg << "\n";
}

}  // namespace market::logging
