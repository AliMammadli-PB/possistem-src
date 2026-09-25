#pragma once

#include <string>

#include "pos/Common.hpp"

namespace pos::payments {

enum class TerminalOutcome {
    Approved,
    Declined,
    Canceled,
    /** No answer within the deadline - the card may or may not have been charged. */
    Timeout,
    /** Transport failure; same uncertainty as a timeout. */
    Unreachable,
};

struct TerminalResult {
    TerminalOutcome outcome = TerminalOutcome::Declined;
    std::string reference;
    std::string cardLast4;
    std::string message;
    std::string raw;
};

/**
 * Interface a real card terminal driver would implement.
 *
 * Kept deliberately narrow: authorize, void, refund, status. Swapping in a
 * genuine driver means implementing this and changing one factory call.
 */
class TerminalAdapter {
public:
    virtual ~TerminalAdapter() = default;

    virtual TerminalResult authorize(Money amountMinor, Money tipMinor,
                                     const std::string& reference, int timeoutMs) = 0;

    /** Used by reconciliation to ask the terminal what actually happened. */
    virtual TerminalResult queryStatus(const std::string& reference) = 0;

    virtual TerminalResult refund(Money amountMinor, const std::string& originalReference) = 0;

    virtual std::string name() const = 0;
};

/**
 * Simulated terminal.
 *
 * MOCK - there is no payment provider integration in this build. It models the
 * behaviour that matters for correctness: a variable delay, approvals,
 * declines, and crucially timeouts that must surface as `unknown` rather than a
 * false failure.
 *
 * `setForcedMode` backs the developer control used to exercise those paths on
 * demand: auto | approve | decline | timeout | unreachable.
 */
class MockTerminal : public TerminalAdapter {
public:
    static MockTerminal& instance();

    TerminalResult authorize(Money amountMinor, Money tipMinor, const std::string& reference,
                             int timeoutMs) override;
    TerminalResult queryStatus(const std::string& reference) override;
    TerminalResult refund(Money amountMinor, const std::string& originalReference) override;

    std::string name() const override { return "mock-terminal"; }

    void setForcedMode(const std::string& mode);
    std::string forcedMode() const;

private:
    MockTerminal() = default;
    std::string forcedMode_ = "auto";
};

}  // namespace pos::payments
