#pragma once

#include <exception>
#include <string>
#include <utility>

#include "pos/Common.hpp"
#include "pos/protocol_generated.hpp"

namespace pos {

/**
 * The single error type crossing the protocol boundary.
 *
 * Every handler runs inside a try/catch at the dispatch layer, so throwing here
 * produces a well-formed error envelope rather than taking the process down.
 */
class PosError : public std::exception {
public:
    PosError(std::string code, std::string message, Json details = Json())
        : code_(std::move(code)), message_(std::move(message)), details_(std::move(details)) {
        const auto* meta = protocol::findError(code_);
        retryable_ = meta && meta->retryable;
        fatal_ = meta && meta->fatal;
    }

    /** Builds an error using the canonical message from the protocol table. */
    static PosError of(std::string_view code, Json details = Json()) {
        const auto* meta = protocol::findError(code);
        return PosError(std::string(code),
                        meta ? std::string(meta->message) : "Unknown error",
                        std::move(details));
    }

    static PosError of(std::string_view code, std::string message, Json details = Json()) {
        return PosError(std::string(code), std::move(message), std::move(details));
    }

    const char* what() const noexcept override { return message_.c_str(); }

    const std::string& code() const noexcept { return code_; }
    const std::string& message() const noexcept { return message_; }
    const Json& details() const noexcept { return details_; }
    bool retryable() const noexcept { return retryable_; }
    bool fatal() const noexcept { return fatal_; }

    Json toJson() const {
        Json body{{"code", code_}, {"message", message_}, {"retryable", retryable_}};
        if (!details_.is_null()) body["details"] = details_;
        return body;
    }

private:
    std::string code_;
    std::string message_;
    Json details_;
    bool retryable_ = false;
    bool fatal_ = false;
};

/** Throws E_VALIDATION unless the condition holds. */
inline void require(bool condition, std::string message) {
    if (!condition) {
        throw PosError(std::string(protocol::err::kValidation), std::move(message));
    }
}

}  // namespace pos
