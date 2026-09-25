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

private:
    handlers::Context& ctx_;
};

}  // namespace pos::services
