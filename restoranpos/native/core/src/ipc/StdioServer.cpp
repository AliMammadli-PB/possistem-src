#include "pos/ipc/StdioServer.hpp"

#include <cstdio>
#include <string>
#include <vector>

#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/protocol_generated.hpp"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <process.h>
#define POS_FILENO _fileno
#define POS_READ(fd, buf, n) _read((fd), (buf), static_cast<unsigned int>(n))
#else
#include <unistd.h>
#define POS_FILENO fileno
#define POS_READ(fd, buf, n) ::read((fd), (buf), (n))
#endif

namespace pos::ipc {
namespace {

constexpr std::size_t kReadChunk = 16 * 1024;

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("ipc");
    return log;
}

}  // namespace

void StdioServer::configureBinaryStdio() {
#ifdef _WIN32
    // Without this the CRT rewrites every \n as \r\n on the way out, which
    // breaks NDJSON framing, and mangles \r\n on the way in.
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
#endif
    // Full buffering plus an explicit flush per message: fewer syscalls than
    // line buffering, with none of the latency risk, because the writer thread
    // always flushes after each frame.
    static std::vector<char> stdoutBuffer(64 * 1024);
    std::setvbuf(stdout, stdoutBuffer.data(), _IOFBF, stdoutBuffer.size());
}

StdioServer::StdioServer()
    : inbound_(static_cast<std::size_t>(protocol::limits::kMaxInboundQueue)),
      outbound_(static_cast<std::size_t>(protocol::limits::kMaxInboundQueue) * 2) {}

StdioServer::~StdioServer() {
    requestStop();
    if (workerThread_.joinable()) workerThread_.join();
    if (writerThread_.joinable()) writerThread_.join();
}

void StdioServer::registerHandler(std::string method, Handler handler) {
    handlers_.emplace(std::move(method), std::move(handler));
}

Json StdioServer::callHandler(const Request& request) {
    const auto it = handlers_.find(request.method);
    if (it == handlers_.end()) {
        throw PosError(std::string(protocol::err::kUnknownMethod),
                       "Unknown method: " + request.method);
    }
    return invoke(it->second, request);
}

Json StdioServer::invoke(const Handler& handler, const Request& request) {
    if (!request.scoped || !scope_) return handler(request);
    // The worker is the only thread running handlers, so swapping the session
    // for exactly one call cannot leak into another. The guard restores it
    // however the handler leaves.
    struct Restore {
        std::function<void()> fn;
        ~Restore() { if (fn) fn(); }
    } restore{scope_(request)};
    return handler(request);
}

void StdioServer::enqueueOutbound(std::string frame) {
    if (!outbound_.tryPush(std::move(frame))) {
        // Dropping a frame is bad, but blocking the worker on a full outbound
        // queue would wedge the whole core. The caller's request timeout covers it.
        logger()->error("outbound queue full - frame dropped");
    }
}

void StdioServer::emitEvent(std::string_view event, Json payload) {
    Json frame{
        {"type", "event"},
        {"event", std::string(event)},
        {"payload", std::move(payload)},
        {"timestamp", nowMs()},
    };
    enqueueOutbound(serialize(frame));
}

void StdioServer::emitReady(const std::string& version) {
    emitEvent(protocol::event::kCoreReady,
              Json{{"protocolVersion", protocol::kProtocolVersion},
                   {"version", version},
                   {"pid", static_cast<std::int64_t>(
#ifdef _WIN32
                       _getpid()
#else
                       getpid()
#endif
                       )}});
}

void StdioServer::respondError(const std::string& requestId, const std::string& code,
                               const std::string& message, bool retryable, const Json& details) {
    Json error{{"code", code}, {"message", message}, {"retryable", retryable}};
    if (!details.is_null()) error["details"] = details;

    enqueueOutbound(serialize(Json{
        {"requestId", requestId},
        {"success", false},
        {"data", nullptr},
        {"error", std::move(error)},
    }));
}

void StdioServer::writerLoop() {
    while (true) {
        auto frame = outbound_.pop();
        if (!frame) break;

        frame->push_back('\n');
        std::fwrite(frame->data(), 1, frame->size(), stdout);

        // The flush is load-bearing. When stdout is a pipe the CRT full-buffers
        // it, so without this a small response simply sits in the buffer and the
        // Electron side times out - a failure that looks exactly like a deadlock.
        std::fflush(stdout);
    }
}

void StdioServer::workerLoop() {
    while (true) {
        auto request = inbound_.pop();
        if (!request) break;
        dispatch(*request);
    }
}

void StdioServer::dispatch(const Request& request) {
    const auto it = handlers_.find(request.method);
    if (it == handlers_.end()) {
        logger()->warn("unknown method: {}", request.method);
        respondError(request.requestId, std::string(protocol::err::kUnknownMethod),
                     "Unknown method: " + request.method, false);
        return;
    }

    const auto started = monotonicMs();

    try {
        Json data = invoke(it->second, request);
        enqueueOutbound(serialize(Json{
            {"requestId", request.requestId},
            {"success", true},
            {"data", std::move(data)},
            {"error", nullptr},
        }));
    } catch (const PosError& err) {
        logger()->warn("{} failed [{}]: {}", request.method, err.code(), err.message());
        respondError(request.requestId, err.code(), err.message(), err.retryable(), err.details());

        if (err.fatal()) {
            emitEvent(protocol::event::kCoreFatal,
                      Json{{"code", err.code()}, {"message", err.message()}});
        }
    } catch (const std::exception& err) {
        // A bad request must never take the process down: the exception boundary
        // is here, at dispatch, so every handler is implicitly protected.
        logger()->error("{} threw: {}", request.method, err.what());
        respondError(request.requestId, std::string(protocol::err::kInternal), err.what(), false);
    } catch (...) {
        logger()->error("{} threw a non-standard exception", request.method);
        respondError(request.requestId, std::string(protocol::err::kInternal),
                     "Unhandled internal error", false);
    }

    handled_.fetch_add(1);

    const auto elapsed = monotonicMs() - started;
    if (elapsed > 500) {
        logger()->warn("slow handler {} took {}ms", request.method, elapsed);
    }
}

void StdioServer::handleLine(const std::string& line) {
    Json envelope;
    try {
        envelope = Json::parse(line);
    } catch (const std::exception& err) {
        logger()->error("malformed JSON frame ({} bytes): {}", line.size(), err.what());
        return;  // cannot respond: the requestId is unknown
    }

    Request request;
    request.requestId = getOr<std::string>(envelope, "requestId", "");
    request.method = getOr<std::string>(envelope, "method", "");
    request.protocolVersion = getOr<int>(envelope, "protocolVersion", 0);
    request.timestamp = getOr<Timestamp>(envelope, "timestamp", 0);

    if (envelope.contains("actor") && envelope["actor"].is_object()) {
        request.scoped = true;
        request.actorUserId = getOr<std::string>(envelope["actor"], "userId", "");
    }

    if (envelope.contains("payload") && envelope["payload"].is_object()) {
        request.payload = envelope["payload"];
        request.idempotencyKey = getOr<std::string>(request.payload, "idempotencyKey", "");
    }

    if (request.requestId.empty() || request.method.empty()) {
        logger()->error("frame missing requestId or method");
        respondError(request.requestId, std::string(protocol::err::kInvalidRequest),
                     "Frame is missing requestId or method", false);
        return;
    }

    if (request.protocolVersion != protocol::kProtocolVersion) {
        respondError(request.requestId, std::string(protocol::err::kProtocolVersion),
                     "Expected protocol version " + std::to_string(protocol::kProtocolVersion),
                     false);
        return;
    }

    if (!inbound_.tryPush(std::move(request))) {
        // Reject rather than grow without bound; the client sees a retryable error.
        respondError(envelope.value("requestId", ""), std::string(protocol::err::kQueueFull),
                     "Core request queue is full", true);
    }
}

void StdioServer::start() {
    if (started_.exchange(true)) return;
    writerThread_ = std::thread([this] { writerLoop(); });
    workerThread_ = std::thread([this] { workerLoop(); });
}

void StdioServer::run() {
    start();

    std::string buffer;
    std::vector<char> chunk(kReadChunk);

    // A low-level read, not fread: fread on a pipe blocks until the whole
    // buffer is filled or the stream ends, so a single short request line would
    // sit unread forever. read() returns as soon as any bytes are available.
    const int fd = POS_FILENO(stdin);

    while (!stopping_.load()) {
        const int got = POS_READ(fd, chunk.data(), chunk.size());
        if (got <= 0) break;  // EOF or error: the parent closed our stdin

        buffer.append(chunk.data(), static_cast<std::size_t>(got));

        if (buffer.size() > static_cast<std::size_t>(protocol::limits::kMaxMessageBytes)) {
            logger()->error("inbound frame exceeded {} bytes - dropping buffer",
                            protocol::limits::kMaxMessageBytes);
            buffer.clear();
            continue;
        }

        std::size_t start = 0;
        while (true) {
            const std::size_t newline = buffer.find('\n', start);
            if (newline == std::string::npos) break;

            std::string line = buffer.substr(start, newline - start);
            start = newline + 1;

            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty()) handleLine(line);
        }
        if (start > 0) buffer.erase(0, start);
    }

    logger()->info("stdin closed - draining");

    // Ordered shutdown: stop accepting work, let the worker finish what it has,
    // then let the writer flush every remaining response.
    inbound_.close();
    if (workerThread_.joinable()) workerThread_.join();

    if (shutdownHook_) shutdownHook_();

    outbound_.close();
    if (writerThread_.joinable()) writerThread_.join();

    std::fflush(stdout);
}

std::vector<std::string> StdioServer::processFrame(const std::string& line) {
    handleLine(line);
    while (auto request = inbound_.tryPop()) dispatch(*request);
    return drainOutbound();
}

std::vector<std::string> StdioServer::drainOutbound() {
    std::vector<std::string> frames;
    while (auto frame = outbound_.tryPop()) frames.push_back(std::move(*frame));
    return frames;
}

void StdioServer::requestStop() {
    stopping_.store(true);
    inbound_.close();
    outbound_.close();
}

}  // namespace pos::ipc
