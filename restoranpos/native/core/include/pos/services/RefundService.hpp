#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

/**
 * Marks the `cash_out` movement a cash refund writes.
 *
 * `cash_movements.kind` has no 'refund' value, and widening a CHECK constraint
 * means rebuilding the table. The reason string does the job: the drawer log
 * shows when the money left, and the expected-cash sum skips these rows so the
 * refunds ledger stays the single place refunds are subtracted.
 */
inline constexpr std::string_view kRefundMovementReason = "refund";

class RefundService {
public:
    explicit RefundService(handlers::Context& ctx) : ctx_(ctx) {}

    Money totalRefunded(const std::string& paymentId);
    Money remainingRefundable(const std::string& paymentId);
    /**
     * One line of a bill the guest disputes.
     *
     * `orderItemId` is the line, `quantity` how many of it go back. The money is
     * derived from the stored line snapshot, never from the caller.
     */
    struct RefundLine {
        std::string orderItemId;
        std::int64_t quantity = 1;
    };

    /**
     * Reverses money the guest already paid.
     *
     * `lines` empty refunds `amountMinor` (or the whole remainder when that is
     * zero). Naming lines instead prices them from the order and records which
     * dish was sent back, which is what a dispute after the receipt is about.
     */
    Json createRefund(const std::string& paymentId, Money amountMinor, std::string_view reason,
                      const std::string& approvedBy, const std::string& idempotencyKey = "",
                      const std::vector<RefundLine>& lines = {});
    Json listForPayment(const std::string& paymentId);

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
