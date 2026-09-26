#pragma once
#include <nlohmann/json.hpp>
#include <functional>
#include <string>
#include <unordered_map>

namespace market::ipc {

using Handler = std::function<nlohmann::json(const nlohmann::json& payload)>;

class StdioServer {
 public:
  static void configureBinaryStdio();

  void on(const std::string& method, Handler handler);

  /**
   * Runs one registered method. Throws PosError("E_UNKNOWN_METHOD") when the
   * method is not registered - the same error the read loop reports, because
   * the read loop calls this.
   */
  nlohmann::json dispatch(const std::string& method, const nlohmann::json& payload);
  void emitEvent(const std::string& event, const nlohmann::json& payload);
  /**
   * After a successful call to `method`, the loop emits `state.changed` with
   * this reason, so every open screen - and, through sync, every other till -
   * re-reads instead of showing a price or a stock count from before the edit.
   */
  void markMutating(const std::string& method, const std::string& reason);
  /** Blocking read-eval loop. Returns process exit code. */
  int run();

  /**
   * Handles one request frame on the caller's thread and returns what it
   * wrote (the response, then any events), newline-terminated. Used by the
   * WebAssembly build behind the possistem.az demo, which has no stdin.
   */
  std::string processLine(const std::string& line);

 private:
  void writeFrame(const nlohmann::json& doc);
  void handleLine(std::string line);
  std::string* capture_ = nullptr;
  std::unordered_map<std::string, Handler> handlers_;
  std::unordered_map<std::string, std::string> mutating_;
};

}  // namespace market::ipc
