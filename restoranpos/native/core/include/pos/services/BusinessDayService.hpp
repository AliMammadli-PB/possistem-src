#pragma once

#include <optional>
#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

struct BusinessDayReadiness {
    bool ready = false;
    int openOrders = 0;
    int unresolvedPayments = 0;
    int pendingKitchen = 0;
    Json blockers = Json::array();
};

class BusinessDayService {
public:
    explicit BusinessDayService(handlers::Context& ctx) : ctx_(ctx) {}

    Json current();
    Json open(Money openingFloatMinor, std::string_view note = "");
    BusinessDayReadiness readiness(const std::string& businessDayId);

    /**
     * Closes the day and produces the Z report.
     *
     * Takes no counted-cash figure: the till is never counted into the system,
     * so the Z states what the drawer *should* hold and nothing is reconciled
     * against a typed number.
     */
    Json closeZ(const std::string& businessDayId, std::string_view note = "");

    std::optional<std::string> openBusinessDayId();

    /**
     * Id of the open business day, opening a fresh one if none exists.
     *
     * Staff never open a till by hand: the first order or payment after a Z
     * silently starts the next day. Opens with a zero float so the first X
     * after a reopen reads exactly zero.
     *
     * Deliberately starts no transaction of its own - every caller is already
     * inside one, and the new day must commit atomically with whatever
     * triggered it.
     */
    std::string ensureOpenBusinessDayId();

    /**
     * Re-points an order that is orphaned, or stuck on an already-closed day,
     * onto the given day.
     *
     * Rescues bills that were left open across a Z close - which is possible on
     * databases upgraded from before business_day_id was stamped, because the
     * readiness check could not see them.
     */
    void adoptOrderIntoDay(const std::string& orderId, const std::string& dayId);

    void assertMutableBusinessDay(const std::string& businessDayId);

private:
    handlers::Context& ctx_;
    std::string todayDateLocal() const;
};

}  // namespace pos::services
