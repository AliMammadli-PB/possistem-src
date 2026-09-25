#pragma once

#include <memory>
#include <string>

#include <spdlog/spdlog.h>

namespace pos::logging {

/**
 * Initialises logging.
 *
 * CRITICAL: no sink may ever write to stdout. stdout carries the NDJSON
 * protocol frames and nothing else - a single stray line there desynchronises
 * the Electron side and shows up as random request timeouts. spdlog's default
 * logger writes to stdout, so this must run before any log call.
 *
 * Sinks: stderr (picked up and forwarded by the Electron supervisor) plus a
 * rotating file per component.
 */
void init(const std::string& logDir, const std::string& level);

/** Named logger writing to <logDir>/<name>.log as well as stderr. */
std::shared_ptr<spdlog::logger> get(const std::string& name);

void shutdown();

}  // namespace pos::logging
