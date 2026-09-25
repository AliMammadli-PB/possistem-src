#include "pos/payments/TerminalAdapter.hpp"

#include <chrono>
#include <mutex>
#include <thread>

#include "pos/Crypto.hpp"
#include "pos/Logging.hpp"

namespace pos::payments {
namespace {

std::mutex g_mutex;

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("payment");
    return log;
}

/**
 * Simulated round-trip time.
 *
 * Kept short on purpose. The real design calls for the terminal round trip to
 * run off the database thread; this build performs it inline (holding no
 * transaction), so a realistic 30-second wait would stall other requests.
 * Wiring a genuine terminal means moving this call onto a worker and having it
 * post the result back - the state machine already supports that, because the
 * payment row is committed as `waiting_for_terminal` before the call starts.
 */
constexpr int kApprovalDelayMs = 700;
constexpr int kTimeoutProbeMs = 1500;

std::int64_t randomIn(std::int64_t lo, std::int64_t hi) {
    const auto bytes = crypto::randomBytes(4);
    std::uint32_t value = 0;
    for (auto b : bytes) value = (value << 8) | b;
    return lo + static_cast<std::int64_t>(value % static_cast<std::uint32_t>(hi - lo + 1));
}

}  // namespace

MockTerminal& MockTerminal::instance() {
    static MockTerminal terminal;
    return terminal;
}

void MockTerminal::setForcedMode(const std::string& mode) {
    std::lock_guard<std::mutex> lock(g_mutex);
    forcedMode_ = mode;
    logger()->info("mock terminal mode set to {}", mode);
}

std::string MockTerminal::forcedMode() const {
    std::lock_guard<std::mutex> lock(g_mutex);
    return forcedMode_;
}

TerminalResult MockTerminal::authorize(Money amountMinor, Money tipMinor,
                                       const std::string& reference, int timeoutMs) {
    const std::string mode = forcedMode();

    TerminalResult result;
    result.reference = reference;

    if (mode == "timeout") {
        // Sleep past the caller's deadline so the timeout branch is genuinely
        // exercised rather than simulated by a flag.
        std::this_thread::sleep_for(std::chrono::milliseconds(std::min(timeoutMs + 200, kTimeoutProbeMs)));
        result.outcome = TerminalOutcome::Timeout;
        result.message = "The terminal did not respond";
        logger()->warn("mock terminal forced timeout for {}", reference);
        return result;
    }

    if (mode == "unreachable") {
        result.outcome = TerminalOutcome::Unreachable;
        result.message = "The terminal is not reachable";
        return result;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(randomIn(300, kApprovalDelayMs)));

    if (mode == "decline") {
        result.outcome = TerminalOutcome::Declined;
        result.message = "Card declined by issuer";
        result.raw = R"({"code":"51","reason":"insufficient_funds"})";
        return result;
    }

    if (mode == "cancel") {
        result.outcome = TerminalOutcome::Canceled;
        result.message = "Canceled on the PIN pad";
        return result;
    }

    result.outcome = TerminalOutcome::Approved;
    result.cardLast4 = std::to_string(randomIn(1000, 9999));
    result.message = "Approved";
    result.raw = R"({"code":"00","auth":")" + crypto::shortCode(6) + R"("})";

    logger()->info("mock terminal approved {} ({} minor units, tip {})", reference, amountMinor,
                   tipMinor);
    return result;
}

TerminalResult MockTerminal::queryStatus(const std::string& reference) {
    // A real driver would ask the terminal for the last transaction matching
    // this reference. The mock follows the forced mode so reconciliation can be
    // exercised for every answer, not just "yes it went through" - a query that
    // can only ever confirm a charge is not a query worth testing against.
    TerminalResult result;
    result.reference = reference;

    const std::string mode = forcedMode();
    if (mode == "unreachable" || mode == "timeout") {
        result.outcome = TerminalOutcome::Unreachable;
        result.message = "Terminal still unreachable";
        return result;
    }
    if (mode == "decline") {
        result.outcome = TerminalOutcome::Declined;
        result.message = "Terminal reports the transaction was declined";
        result.raw = R"({"code":"51","reason":"insufficient_funds"})";
        return result;
    }
    if (mode == "cancel") {
        result.outcome = TerminalOutcome::Canceled;
        result.message = "Terminal reports the transaction was canceled";
        return result;
    }

    result.outcome = TerminalOutcome::Approved;
    result.message = "Terminal reports the transaction was approved";
    return result;
}

TerminalResult MockTerminal::refund(Money amountMinor, const std::string& originalReference) {
    std::this_thread::sleep_for(std::chrono::milliseconds(randomIn(200, 500)));

    TerminalResult result;
    result.reference = "RF-" + crypto::shortCode(8);
    result.outcome = TerminalOutcome::Approved;
    result.message = "Refund approved";
    result.raw = R"({"original":")" + originalReference + R"(","amount":)" +
                 std::to_string(amountMinor) + "}";
    return result;
}

}  // namespace pos::payments
