#pragma once
#include <string>

namespace market::logging {

void init(const std::string& logDir, const std::string& level);
void shutdown();
void info(const std::string& msg);
void warn(const std::string& msg);
void error(const std::string& msg);

}  // namespace market::logging
