#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

class ReportService {
public:
    explicit ReportService(handlers::Context& ctx) : ctx_(ctx) {}

    Json buildCanonicalSnapshot(const std::string& businessDayId, std::string_view kind);
    Json persistSnapshot(const std::string& businessDayId, std::string_view kind,
                         const Json& canonical);
    Json createXReport(const std::string& businessDayId);
    Json listReports(const std::string& businessDayId);
    Json getSnapshot(const std::string& snapshotId);

    /**
     * Takings between two instants, on the payment clock.
     *
     * Answers "how much did we make between 08:00 and 09:00" - so the question
     * is when the money arrived, not when the table was opened. An order opened
     * at 07:50 and settled at 08:10 belongs to this hour, which is also how a
     * handover between two shifts has to add up.
     *
     * Shaped like `buildCanonicalSnapshot` so the same receipt renderer can draw
     * it, but deliberately carries no sequence number: this is an informational
     * slice, not a fiscal document.
     */
    Json periodSummary(Timestamp from, Timestamp to);

    /**
     * The same range split into local-time buckets - `hour` or `day`.
     *
     * Local, not UTC: "which hour did we earn it in" is a question about the
     * clock on the wall.
     */
    Json periodBuckets(Timestamp from, Timestamp to, std::string_view bucket);

private:
    handlers::Context& ctx_;
    int nextSequence(const std::string& businessDayId, std::string_view kind);
};

}  // namespace pos::services
