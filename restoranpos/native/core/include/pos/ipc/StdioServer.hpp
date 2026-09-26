#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "pos/Common.hpp"
#include "pos/ipc/BoundedQueue.hpp"

namespace pos::ipc {

/** A decoded request envelope. */
struct Request {
    std::string requestId;
    std::string method;
    int protocolVersion = 0;
    Timestamp timestamp = 0;
    Json payload = Json::object();

    /** Present when the caller supplied one; enables replay of the original result. */
    std::string idempotencyKey;

    /**
     * Set when the frame carries an `actor` envelope field: the call is made on
     * behalf of a staff member signed in on another PC (a LAN terminal), not by
     * whoever is signed in on this one. Only Electron main builds envelopes, so
     * a screen cannot claim to be someone else. Empty userId = nobody yet
     * (the terminal's own PIN login).
     */
    bool scoped = false;
    std::string actorUserId;
};

using Handler = std::function<Json(const Request&)>;

/** Swaps in a scoped request's own session; returns what puts the old one back. */
using RequestScope = std::function<std::function<void()>(const Request&)>;

/**
 * Newline-delimited JSON server over stdin/stdout.
 *
 * Thread layout:
 *   - reader  : owns stdin, splits frames, enqueues work (the run() thread)
 *   - worker  : executes handlers; sole owner of the database connection
 *   - writer  : owns stdout, one fwrite + fflush per message
 *
 * A single writer thread means responses can never interleave, so no output
 * mutex is needed and partial frames are impossible.
 */
class StdioServer {
public:
    StdioServer();
    ~StdioServer();

    StdioServer(const StdioServer&) = delete;
    StdioServer& operator=(const StdioServer&) = delete;

    /**
     * Switches stdin/stdout/stderr to binary mode and enlarges the stdout buffer.
     *
     * Must be the very first thing main() does. Without O_BINARY the Windows CRT
     * translates every \n into \r\n, which corrupts NDJSON framing.
     */
    static void configureBinaryStdio();

    void registerHandler(std::string method, Handler handler);

    void setRequestScope(RequestScope scope) { scope_ = std::move(scope); }

    /**
     * Runs a registered handler synchronously and returns its payload.
     * Intended for unit tests; production traffic goes through the worker queue.
     */
    Json callHandler(const Request& request);

    /** Queues an unsolicited event frame (no requestId). Thread-safe. */
    void emitEvent(std::string_view event, Json payload);

    /** Announces readiness. Always the first frame written to stdout. */
    void emitReady(const std::string& version);

    /**
     * Starts the writer and worker threads. Idempotent.
     *
     * Called before bootstrap so startup progress events reach the splash
     * screen as they happen rather than arriving in one burst at the end.
     */
    void start();

    /** Runs the read loop until stdin reaches EOF. Blocks. */
    void run();

    void requestStop();

    /**
     * Inline mode for embedders without threads (the WebAssembly build behind
     * the possistem.az demo): start() spawns nothing and every frame is handled
     * on the caller's thread by processFrame().
     */
    void useInlineMode() { started_.store(true); }

    /**
     * Handles one request frame synchronously and returns every frame produced
     * since the last call - events first queued (e.g. startup stages), then the
     * response - in order, without trailing newlines.
     */
    std::vector<std::string> processFrame(const std::string& line);

    /** Frames queued outside a request (startup stages, core.ready). */
    std::vector<std::string> drainOutbound();

    /** Invoked after the queues drain, before the process exits. */
    void onShutdown(std::function<void()> hook) { shutdownHook_ = std::move(hook); }

    std::size_t handledCount() const { return handled_.load(); }

private:
    void writerLoop();
    void workerLoop();
    void handleLine(const std::string& line);
    void dispatch(const Request& request);
    Json invoke(const Handler& handler, const Request& request);
    void enqueueOutbound(std::string frame);
    void respondError(const std::string& requestId, const std::string& code,
                      const std::string& message, bool retryable, const Json& details = Json());

    std::unordered_map<std::string, Handler> handlers_;

    BoundedQueue<Request> inbound_;
    BoundedQueue<std::string> outbound_;

    std::thread writerThread_;
    std::thread workerThread_;

    std::atomic<bool> stopping_{false};
    std::atomic<bool> started_{false};
    std::atomic<std::size_t> handled_{0};
    std::function<void()> shutdownHook_;
    RequestScope scope_;
};

}  // namespace pos::ipc
