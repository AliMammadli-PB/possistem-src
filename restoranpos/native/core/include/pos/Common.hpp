#pragma once

#include <chrono>
#include <cstdint>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace pos {

using Json = nlohmann::json;

/**
 * All monetary values are integer minor units (qəpik) throughout the system.
 *
 * Never a double, never a JSON float, never SQLite REAL. Binary floating point
 * cannot represent 0.10 exactly, and a till that is one qəpik out at the end of
 * a shift is a till nobody trusts. Formatting to "₼" happens only in the UI.
 */
using Money = std::int64_t;

/** Milliseconds since the Unix epoch. */
using Timestamp = std::int64_t;

inline Timestamp nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

inline std::int64_t monotonicMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

/**
 * Serializes a JSON document for the wire.
 *
 *  - indent = -1 guarantees no pretty-print newlines, which is what makes NDJSON
 *    framing safe.
 *  - ensure_ascii escapes every non-ASCII codepoint, so the stream is pure 7-bit
 *    regardless of the console code page. JSON.parse decodes \uXXXX natively.
 *  - the replace error handler stops a non-UTF-8 byte coming out of SQLite from
 *    throwing type_error.316 and killing the request.
 */
inline std::string serialize(const Json& value) {
    return value.dump(-1, ' ', true, Json::error_handler_t::replace);
}

/** Reads an optional field without throwing when it is absent or null. */
template <typename T>
T getOr(const Json& obj, std::string_view key, T fallback) {
    if (!obj.is_object()) return fallback;
    const auto it = obj.find(std::string(key));
    if (it == obj.end() || it->is_null()) return fallback;
    try {
        return it->get<T>();
    } catch (...) {
        return fallback;
    }
}

inline bool hasField(const Json& obj, std::string_view key) {
    return obj.is_object() && obj.contains(std::string(key)) && !obj.at(std::string(key)).is_null();
}

}  // namespace pos
