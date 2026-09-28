#include "market/AppConfig.hpp"
#include "market/Error.hpp"
#include <cstring>
#include <filesystem>

namespace market {

AppConfig AppConfig::fromArgs(int argc, char** argv) {
  AppConfig cfg;
  for (int i = 1; i < argc; ++i) {
    const char* a = argv[i];
    auto next = [&](const char* flag) -> std::string {
      if (i + 1 >= argc) throw PosError("E_VALIDATION", std::string("missing value for ") + flag);
      return argv[++i];
    };
    if (std::strcmp(a, "--db") == 0) cfg.dbPath = next("--db");
    else if (std::strcmp(a, "--log-dir") == 0) cfg.logDir = next("--log-dir");
    else if (std::strcmp(a, "--log-level") == 0) cfg.logLevel = next("--log-level");
    else if (std::strcmp(a, "--protocol") == 0) cfg.protocolVersion = std::stoi(next("--protocol"));
  }
  if (cfg.dbPath.empty()) {
    throw PosError("E_VALIDATION", "--db is required");
  }
  if (cfg.logDir.empty()) {
    cfg.logDir = (std::filesystem::path(cfg.dbPath).parent_path() / "logs").string();
  }
  return cfg;
}

}  // namespace market
