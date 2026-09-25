#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {

using PaymentStatus = protocol::PaymentStatus;

/**
 * Legal payment state transitions.
 *
 * Deliberately explicit rather than implied by control flow, so the rules can
 * be exhaustively tested and so an illegal move (Declined -> Approved, say)
 * fails loudly instead of quietly corrupting the till.
 *
 * Notable rules:
 *  - Nothing returns to Created.
 *  - Approved and Declined never swap; a retry is a NEW payment row.
 *  - Unknown must be resolved to a real outcome before anything else.
 *  - Canceled and Refunded are terminal.
 */
bool isLegalPaymentTransition(PaymentStatus from, PaymentStatus to);

/** True for states where money may or may not have moved. */
inline bool isUnresolved(PaymentStatus status) {
    return status == PaymentStatus::Unknown;
}

class PaymentService {
public:
    explicit PaymentService(handlers::Context& ctx) : ctx_(ctx) {}

    /**
     * The single choke point for every payment state change.
     *
     * Validates the transition, updates the row and appends a payment_events
     * record in one step, so the audit trail can never drift from the state.
     * Must be called inside a transaction.
     */
    void applyTransition(const std::string& paymentId, PaymentStatus to, std::string_view reason,
                         std::string_view terminalRef = "", std::string_view rawResponse = "");

    Json load(const std::string& paymentId);

    PaymentStatus statusOf(const std::string& paymentId);

    /**
     * Money actually collected on an order, net of completed refunds.
     *
     * A payment refunded in full keeps `status = 'refunded'` yet still has a
     * matching row in `refunds`, so the approved pot has to include both states
     * and subtract the refund ledger exactly once. `orders.paid_minor` and
     * `outstanding()` both read this, which is what keeps "Paid" and
     * "Remaining" adding up to the order total on screen.
     */
    Money netCollected(const std::string& orderId);

    /** total - netCollected, floored at zero. */
    Money outstanding(const std::string& orderId);

    /** Number of payments on an order still sitting in `unknown`. */
    int unresolvedCount(const std::string& orderId);

    /**
     * Moves the order between open / partially_paid / closed as money lands.
     * Fully settled orders close automatically and free the table (no cleaning).
     */
    void refreshOrderPaymentStatus(const std::string& orderId);

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
