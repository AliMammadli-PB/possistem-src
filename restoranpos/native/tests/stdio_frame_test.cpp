#include "catch_amalgamated.hpp"

#include <nlohmann/json.hpp>
#include <string>

/**
 * Mirrors the production serialize contract: compact ASCII JSON with a trailing
 * newline, and every stdout byte must parse as a protocol frame.
 */
static std::string serializeFrame(const nlohmann::json& doc) {
    return doc.dump(-1, ' ', true, nlohmann::json::error_handler_t::replace) + "\n";
}

TEST_CASE("NDJSON frames are single-line ASCII with trailing newline", "[ipc]") {
    nlohmann::json response = {
        {"requestId", "req-1"},
        {"success", true},
        {"data", {{"pong", true}, {"note", "café — ₼"}}},
        {"error", nullptr},
    };

    const std::string frame = serializeFrame(response);
    REQUIRE(frame.back() == '\n');
    REQUIRE(frame.find('\n') == frame.size() - 1);

    for (unsigned char c : frame) {
        if (c == '\n') continue;
        REQUIRE(c < 0x80);
    }

    auto parsed = nlohmann::json::parse(frame);
    REQUIRE(parsed["success"] == true);
    REQUIRE(parsed["data"]["pong"] == true);
}

TEST_CASE("unparseable lines are distinguishable from valid frames", "[ipc]") {
    const std::string garbage = "not-json\n";
    bool ok = true;
    try {
        (void)nlohmann::json::parse(garbage);
    } catch (...) {
        ok = false;
    }
    REQUIRE_FALSE(ok);
}
