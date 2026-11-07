#pragma once
#include <string>

namespace pos::services {
// A refunded receipt remains in gross takings. Refunds are subtracted separately
// on their own clock. Expand mixed receipts once, so cash/card fields reconcile
// with the till and bank ledgers without counting the parent payment again.
// This is static SQL, never interpolated from a caller's input.
inline const std::string kSettledTenderRows = R"SQL((
 SELECT p.id, p.order_id, p.business_day_id, p.shift_id, p.terminal_id,
        p.user_id, p.created_at, p.method, p.amount_minor, p.tip_minor
 FROM payments p
 WHERE p.status IN ('approved','refunded') AND p.method != 'mixed'
 UNION ALL
 SELECT p.id, p.order_id, p.business_day_id, p.shift_id, p.terminal_id,
        p.user_id, p.created_at, t.method, t.amount_minor, t.tip_minor
 FROM payments p JOIN payment_tenders t ON t.payment_id=p.id
 WHERE p.status IN ('approved','refunded') AND p.method='mixed'
))SQL";
}
