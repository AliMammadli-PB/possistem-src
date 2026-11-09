#include "pos/services/AssistantQuery.hpp"

#include <sqlite3.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <set>
#include <string_view>

#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::services {
namespace {

constexpr int kMaxRows = 200;
constexpr std::size_t kMaxSql = 4000;
constexpr std::size_t kMaxText = 500;
constexpr auto kMaxTime = std::chrono::milliseconds(2000);

// Business data the owner may ask about. Anything not listed (settings, licence,
// sync queues, print and receipt payloads, idempotency, audit) stays closed.
const std::set<std::string, std::less<>> kTables = {
    "attendance", "bill_split_parts", "bill_splits", "business_days", "cash_account_moves", "cash_accounts",
    "cash_movements", "cash_objects", "couriers", "customer_ledger", "customers", "delivery_events",
    "delivery_orders", "discount_rules", "gift_campaigns", "income_docs", "ingredients", "item_prices",
    "menu_categories", "menu_item_components", "menu_item_ingredients", "menu_item_price_history", "menu_items",
    "modifier_groups", "modifiers", "order_events", "order_item_modifiers", "order_items", "orders",
    "payment_tenders", "payments", "purchase_order_items", "purchase_orders", "purchase_receipt_lines",
    "purchase_receipts", "purchase_return_items", "purchase_returns", "refund_items", "refunds", "reservations",
    "restaurant_areas", "restaurant_tables", "roles", "salary_payments", "shifts", "staff_schedules",
    "stock_categories", "stock_levels", "stock_lots", "stock_movements", "stocktake_lines", "stocktakes",
    "supplier_ledger", "suppliers", "transfer_docs", "transfer_lines", "user_roles", "users", "warehouses",
    "waste_document_items", "waste_documents", "x_reports", "z_reports"};

// Secrets inside allowed tables. "table.column".
const std::set<std::string, std::less<>> kColumns = {
    "users.pin_hash", "users.failed_attempts", "users.locked_until", "payments.card_last4", "payments.bank_rrn",
    "payments.terminal_ref", "payments.idempotency_key", "orders.idempotency_key", "refunds.idempotency_key"};

const std::set<std::string, std::less<>> kFunctions = {"load_extension", "readfile", "writefile", "edit",
                                                       "fts3_tokenizer", "sqlite_compileoption_get"};

struct Guard {
    std::string refused;
};

int authorize(void* data, int action, const char* first, const char* second, const char* database, const char*) {
    auto* guard = static_cast<Guard*>(data);
    const std::string a = first ? first : "", b = second ? second : "";
    switch (action) {
        case SQLITE_SELECT:
        case SQLITE_RECURSIVE:
            return SQLITE_OK;
        case SQLITE_READ:
            // A WITH helper table belongs to no database; every real table is in "main".
            if (!database || !*database) return SQLITE_OK;
            if (!kTables.count(a)) { guard->refused = a; return SQLITE_DENY; }
            if (!b.empty() && kColumns.count(a + "." + b)) { guard->refused = a + "." + b; return SQLITE_DENY; }
            return SQLITE_OK;
        case SQLITE_FUNCTION: {
            std::string name = b;
            std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return std::tolower(c); });
            if (kFunctions.count(name)) { guard->refused = name; return SQLITE_DENY; }
            return SQLITE_OK;
        }
        default:
            guard->refused = "yazma və ya sistem əməliyyatı";
            return SQLITE_DENY;
    }
}

int stopLate(void* data) {
    return std::chrono::steady_clock::now() > *static_cast<std::chrono::steady_clock::time_point*>(data) ? 1 : 0;
}

[[noreturn]] void refuse(const std::string& message) {
    throw PosError(std::string(protocol::err::kValidation), message);
}

}  // namespace

Json runAssistantQuery(const std::string& databasePath, const std::string& sql) {
    std::string_view text = sql;
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front()))) text.remove_prefix(1);
    if (text.empty() || sql.size() > kMaxSql) refuse("Sorğu boşdur və ya çox uzundur.");
    std::string head(text.substr(0, 6));
    std::transform(head.begin(), head.end(), head.begin(), [](unsigned char c) { return std::tolower(c); });
    if (head.rfind("select", 0) != 0 && head.rfind("with", 0) != 0) refuse("Yalnız SELECT sorğusu icra olunur.");

    sqlite3* db = nullptr;
    if (sqlite3_open_v2(databasePath.c_str(), &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nullptr) != SQLITE_OK) {
        const std::string why = db ? sqlite3_errmsg(db) : "open failed";
        sqlite3_close_v2(db);
        refuse("Məlumat bazası oxunmadı: " + why);
    }
    struct Closer { sqlite3* db; ~Closer() { sqlite3_close_v2(db); } } closer{db};
    sqlite3_busy_timeout(db, 1000);
    Guard guard;
    sqlite3_set_authorizer(db, authorize, &guard);
    auto deadline = std::chrono::steady_clock::now() + kMaxTime;
    sqlite3_progress_handler(db, 1000, stopLate, &deadline);

    sqlite3_stmt* stmt = nullptr;
    const char* tail = nullptr;
    if (sqlite3_prepare_v2(db, sql.c_str(), static_cast<int>(sql.size()), &stmt, &tail) != SQLITE_OK || !stmt) {
        const std::string why = sqlite3_errmsg(db);
        sqlite3_finalize(stmt);
        if (!guard.refused.empty()) refuse("Bu məlumat köməkçiyə bağlıdır: " + guard.refused + ".");
        refuse("Sorğu düzgün deyil: " + why);
    }
    struct Finalizer { sqlite3_stmt* stmt; ~Finalizer() { sqlite3_finalize(stmt); } } finalizer{stmt};
    for (const char* p = tail; p && *p; ++p)
        if (!std::isspace(static_cast<unsigned char>(*p)) && *p != ';') refuse("Bir dəfəyə yalnız bir sorğu icra olunur.");
    if (!sqlite3_stmt_readonly(stmt)) refuse("Yalnız oxuyan sorğu icra olunur.");

    Json columns = Json::array();
    const int count = sqlite3_column_count(stmt);
    for (int i = 0; i < count; ++i) columns.push_back(sqlite3_column_name(stmt, i));
    Json rows = Json::array();
    bool truncated = false;
    for (;;) {
        const int rc = sqlite3_step(stmt);
        if (rc == SQLITE_DONE) break;
        if (rc == SQLITE_INTERRUPT || sqlite3_extended_errcode(db) == SQLITE_INTERRUPT || std::chrono::steady_clock::now() > deadline)
            refuse("Sorğu çox uzun çəkdi; daha dar sual verin.");
        if (rc != SQLITE_ROW) refuse(std::string("Sorğu icra olunmadı: ") + sqlite3_errmsg(db));
        if (static_cast<int>(rows.size()) == kMaxRows) { truncated = true; break; }
        Json row = Json::array();
        for (int i = 0; i < count; ++i) {
            switch (sqlite3_column_type(stmt, i)) {
                case SQLITE_INTEGER: row.push_back(static_cast<std::int64_t>(sqlite3_column_int64(stmt, i))); break;
                case SQLITE_FLOAT: row.push_back(sqlite3_column_double(stmt, i)); break;
                case SQLITE_NULL: row.push_back(nullptr); break;
                case SQLITE_BLOB: row.push_back("<blob>"); break;
                default: {
                    std::string value(reinterpret_cast<const char*>(sqlite3_column_text(stmt, i)));
                    if (value.size() > kMaxText) value = value.substr(0, kMaxText) + "…";
                    row.push_back(value);
                }
            }
        }
        rows.push_back(std::move(row));
    }
    return Json{{"columns", columns}, {"rows", rows}, {"truncated", truncated}};
}

}  // namespace pos::services
