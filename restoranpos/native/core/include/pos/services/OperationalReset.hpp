#pragma once
#include "pos/db/Database.hpp"
namespace pos::services {
/** Explicit test-data maintenance. Catalog, recipes, prices, identity and settings survive. */
class OperationalReset {
public:
    static Json preview(db::Database& database);
    static Json run(db::Database& database, const std::string& commandId,
                    const std::string& expectedCatalogHash, const std::string& reason);
};
}
