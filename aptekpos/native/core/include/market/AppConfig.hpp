#pragma once
#include <string>

namespace market {

struct AppConfig {
  std::string dbPath;
  std::string logDir;
  std::string logLevel{"info"};
  int protocolVersion{1};

  static AppConfig fromArgs(int argc, char** argv);
};

}  // namespace market
