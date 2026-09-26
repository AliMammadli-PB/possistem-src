#include "catch_amalgamated.hpp"

#include <string>

#include "pos/Common.hpp"
#include "pos/ipc/StdioServer.hpp"

/**
 * Inline mode: the WebAssembly build behind the possistem.az demo has no
 * threads, so frames are handled on the caller's thread and returned in order -
 * events the handler emitted first, then the response.
 */
TEST_CASE("an inline server answers a frame on the calling thread", "[ipc][inline]") {
    pos::ipc::StdioServer server;
    server.useInlineMode();
    server.start();  // must not spawn anything in inline mode
    server.registerHandler("demo.echo", [&server](const pos::ipc::Request& request) {
        server.emitEvent("demo.seen", pos::Json{{"method", request.method}});
        return pos::Json{{"echo", request.payload.value("text", "")}};
    });

    const auto frames = server.processFrame(
        R"({"requestId":"r1","method":"demo.echo","protocolVersion":1,"timestamp":1,"payload":{"text":"salam"}})");
    REQUIRE(frames.size() == 2);
    REQUIRE(pos::Json::parse(frames[0])["event"] == "demo.seen");
    const auto response = pos::Json::parse(frames[1]);
    REQUIRE(response["requestId"] == "r1");
    REQUIRE(response["success"] == true);
    REQUIRE(response["data"]["echo"] == "salam");

    const auto unknown = server.processFrame(
        R"({"requestId":"r2","method":"demo.nope","protocolVersion":1,"timestamp":1,"payload":{}})");
    REQUIRE(unknown.size() == 1);
    REQUIRE(pos::Json::parse(unknown[0])["error"]["code"] == "E_UNKNOWN_METHOD");
    REQUIRE(server.drainOutbound().empty());
}
