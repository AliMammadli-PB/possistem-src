#pragma once

#include <string>
#include <string_view>

#include "pos/Common.hpp"
#include "pos/handlers/Context.hpp"

namespace pos::services {

class CashService {
public:
    explicit CashService(handlers::Context& ctx) : ctx_(ctx) {}

    Json recordMovement(std::string_view kind, Money amountMinor, std::string_view reason,
                        std::string_view note = "", const std::string& businessDayId = "",
                        const std::string& shiftId = "");
    Json listMovements(const std::string& businessDayId);
    Money expectedCash(const std::string& businessDayId);

    // ------------------------------------------------------------- kassalar
    /**
     * Writes one signed move on a kassa (till, treasury or bank). An empty
     * accountId does nothing, so every money screen can pass its choice
     * through unconditionally. Throws when the kassa is unknown or closed.
     */
    void accountMove(const std::string& accountId, Money amountMinor, std::string_view kind,
                     std::string_view refType = "", std::string_view refId = "",
                     std::string_view note = "");
    /** Opening + moves + (till) its PC's cash sales or (bank) card sales, now. */
    Money accountBalance(const std::string& accountId);
    /** SQL scope (over payments `p`) of the PCs a bank receives card money from; binds :terminal. */
    static std::string bankScope(const std::string& objectId);
    /** Net takings by method on the PCs in `terminalsSql` (binds :terminal = bindValue) in [from, to). */
    Money takingsFor(const std::string& method, const std::string& terminalsSql,
                     const std::string& bindValue, std::int64_t from, std::int64_t to);

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
