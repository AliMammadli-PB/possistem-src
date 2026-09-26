#pragma once
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>

namespace market {

class PosError : public std::runtime_error {
 public:
  PosError(std::string code, std::string message, bool retryable = false)
      : std::runtime_error(message), code_(std::move(code)), message_(std::move(message)), retryable_(retryable) {}

  PosError(std::string code, std::string message, bool retryable, nlohmann::json details)
      : std::runtime_error(message),
        code_(std::move(code)),
        message_(std::move(message)),
        retryable_(retryable),
        details_(std::move(details)) {}

  const std::string& code() const { return code_; }
  const std::string& message() const { return message_; }
  bool retryable() const { return retryable_; }
  const nlohmann::json& details() const { return details_; }

 private:
  std::string code_;
  std::string message_;
  bool retryable_;
  nlohmann::json details_ = nullptr;
};

}  // namespace market
