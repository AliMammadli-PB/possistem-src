#include "market/ipc/StdioServer.hpp"
#include "market/Error.hpp"
#include "market/Logging.hpp"
#include <cstdio>
#include <iostream>
#include <string>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace market::ipc {

void StdioServer::configureBinaryStdio() {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);
}

void StdioServer::on(const std::string& method, Handler handler) {
  // Fail loudly instead of silently replacing: a duplicate registration used to
  // let whichever module registered last win, which is how the sync-emitting
  // purchase handlers became dead code.
  if (handlers_.find(method) != handlers_.end()) {
    throw PosError("E_INTERNAL", "duplicate handler registration for method " + method);
  }
  handlers_[method] = std::move(handler);
}

nlohmann::json StdioServer::dispatch(const std::string& method, const nlohmann::json& payload) {
  auto it = handlers_.find(method);
  if (it == handlers_.end()) {
    throw PosError("E_UNKNOWN_METHOD", "Unknown method: " + method);
  }
  return it->second(payload);
}

void StdioServer::markMutating(const std::string& method, const std::string& reason) {
  mutating_[method] = reason;
}

void StdioServer::writeFrame(const nlohmann::json& doc) {
  const std::string line = doc.dump(-1, ' ', true, nlohmann::json::error_handler_t::replace) + "\n";
  std::fwrite(line.data(), 1, line.size(), stdout);
  std::fflush(stdout);
}

void StdioServer::emitEvent(const std::string& event, const nlohmann::json& payload) {
  writeFrame({{"type", "event"}, {"event", event}, {"payload", payload}});
}

int StdioServer::run() {
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    nlohmann::json req;
    try {
      req = nlohmann::json::parse(line);
    } catch (const std::exception& ex) {
      logging::warn(std::string("bad json frame: ") + ex.what());
      continue;
    }
    const std::string requestId = req.value("requestId", "");
    const std::string method = req.value("method", "");
    nlohmann::json payload = req.contains("payload") && !req["payload"].is_null() ? req["payload"] : nlohmann::json::object();

    nlohmann::json resp = {{"requestId", requestId}, {"success", false}, {"data", nullptr}, {"error", nullptr}};
    try {
      resp["data"] = dispatch(method, payload);
      resp["success"] = true;
    } catch (const PosError& err) {
      nlohmann::json error = {{"code", err.code()}, {"message", err.message()}, {"retryable", err.retryable()}};
      if (!err.details().is_null()) error["details"] = err.details();
      resp["error"] = error;
    } catch (const std::exception& ex) {
      resp["error"] = {{"code", "E_INTERNAL"}, {"message", ex.what()}, {"retryable", true}};
    }
    writeFrame(resp);
    // Announced after the response so the caller's await resolves before the
    // refresh it triggers, otherwise every mutation races its own re-read.
    if (resp.value("success", false)) {
      const auto mutation = mutating_.find(method);
      if (mutation != mutating_.end()) {
        emitEvent("state.changed", {{"reason", mutation->second}});
      }
    }
  }
  logging::info("stdin EOF — shutting down");
  return 0;
}

}  // namespace market::ipc
