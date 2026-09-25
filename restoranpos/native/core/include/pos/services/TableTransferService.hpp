#pragma once

#include <string>
#include <string_view>
#include <vector>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

struct TransferItemSpec {
    std::string itemId;
    std::int64_t quantity = 0;  // 0 = move entire line
    std::int64_t expectedVersion = -1;
};

class TableTransferService {
public:
    explicit TableTransferService(handlers::Context& ctx) : ctx_(ctx) {}

    Json transferItems(const std::string& fromTableId, const std::string& toTableId,
                       const std::vector<TransferItemSpec>& items,
                       std::int64_t expectedFromVersion = -1,
                       std::int64_t expectedToVersion = -1,
                       const std::string& idempotencyKey = "");

    /**
     * Folds whole bills from one or more tables into the destination's bill.
     *
     * Used when a party splits across tables and one table settles for
     * everyone. Everything attached to the source order moves - lines, kitchen
     * tickets, gifts, and crucially any money already taken - so the merged
     * bill owes exactly what the two bills owed together, and the emptied
     * source is recalculated to zero rather than left holding stale totals
     * that reports would count a second time.
     */
    Json mergeTables(const std::string& targetTableId,
                     const std::vector<std::string>& sourceTableIds,
                     std::int64_t expectedFromVersion = -1,
                     std::int64_t expectedToVersion = -1,
                     const std::string& idempotencyKey = "");

private:
    handlers::Context& ctx_;
    void bumpTable(const std::string& tableId, std::int64_t now);
    std::int64_t tableVersion(const std::string& tableId);
};

}  // namespace pos::services
