#pragma once

#include <string>
#include <vector>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"
#include "pos/services/PaymentService.hpp"

namespace pos::services {

struct MixedTender {
    std::string method;  // cash | card | complimentary
    Money amountMinor = 0;
    Money tipMinor = 0;
    Money tenderedMinor = 0;
};

/** What phase A of a mixed payment produced, for the terminal round trip. */
struct MixedPreparation {
    std::string paymentId;
    /** Zero when no tender needs a card terminal, which settles immediately. */
    Money cardAmountMinor = 0;
    Money cardTipMinor = 0;
    Money changeMinor = 0;
};

class SplitBillService {
public:
    explicit SplitBillService(handlers::Context& ctx) : ctx_(ctx) {}

    /** Deterministic equal split: remainder cents go to the first parts. */
    Json createEqualSplit(const std::string& orderId, int parts);
    /** `kind` is stored as given; empty means "infer from the parts". */
    Json createCustomSplit(const std::string& orderId, const Json& parts,
                           const std::string& kind = "");
    Json loadSplit(const std::string& splitId);

    /** The open split on an order, or null when there is none. */
    Json openSplitForOrder(const std::string& orderId);

    /**
     * Attributes a settled payment to one part of a split.
     *
     * Without this the parts stay at `paid_minor = 0` forever, so a split could
     * be created but never worked through.
     */
    void markPartPaid(const std::string& splitPartId, const std::string& paymentId,
                      Money amountMinor);

    /**
     * Phase A of a mixed payment: durable intent, nothing settled yet.
     *
     * Split from settlement so the card leg can reach a real terminal without a
     * database transaction held open across the round trip.
     */
    MixedPreparation prepareMixedPayment(const std::string& orderId,
                                         const std::vector<MixedTender>& tenders,
                                         const std::string& idempotencyKey = "");

    /** Phase C: records the outcome and returns the payment/tender view. */
    Json settleMixedPayment(const std::string& orderId, const std::string& paymentId,
                            PaymentStatus status, std::string_view reason,
                            std::string_view terminalRef = "", std::string_view raw = "");

    /** Prepare + settle in one step. Only valid when no tender needs a terminal. */
    Json createMixedPayment(const std::string& orderId, const std::vector<MixedTender>& tenders,
                            const std::string& idempotencyKey = "");

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
