#pragma once
#include "market/AppConfig.hpp"
#include "market/db/Database.hpp"
#include "market/ipc/StdioServer.hpp"
#include <memory>

namespace market {

class Application {
 public:
  explicit Application(AppConfig config);
  void bootstrap();
  int run();

  db::Database& database() { return db_; }
  const AppConfig& config() const { return config_; }

  /**
   * Registers every RPC on a server. Public so the permission gates can be
   * tested without `run()`, which blocks on stdin.
   */
  void registerHandlers(ipc::StdioServer& server);

 private:

  AppConfig config_;
  db::Database db_;
  std::unique_ptr<ipc::StdioServer> server_;
};

}  // namespace market
