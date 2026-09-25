#include "pos/db/Migrator.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

#include <sqlite3.h>

#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/db/Database.hpp"
#include "pos/db/migrations_generated.hpp"
#include "pos/protocol_generated.hpp"

namespace pos::db {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("database");
    return log;
}

struct DemoUser {
    const char* id;
    const char* code;
    const char* name;
    const char* roleId;
    const char* pin;
    const char* color;
};

// Demo credentials. README documents these and states they must be changed
// before the system handles real money.
// Only the local administrator is seeded. Waiters are created by admin in-app.
constexpr DemoUser kDemoUsers[] = {
    {"usr-admin", "9001", "Admin", "role-administrator", "9001", "#B07FC7"},
};

using SchemaDefinition = std::map<std::string, std::string>;

std::string canonicalSchemaSql(std::string_view sql) {
    std::string canonical;
    canonical.reserve(sql.size());

    char closingQuote = '\0';
    for (std::size_t i = 0; i < sql.size(); ++i) {
        const char character = sql[i];
        if (closingQuote != '\0') {
            canonical.push_back(character);
            if (character == closingQuote) {
                if (closingQuote != ']' && i + 1 < sql.size() && sql[i + 1] == closingQuote) {
                    canonical.push_back(sql[++i]);
                } else {
                    closingQuote = '\0';
                }
            }
            continue;
        }

        if (character == '\'' || character == '"' || character == '`') {
            closingQuote = character;
            canonical.push_back(character);
        } else if (character == '[') {
            closingQuote = ']';
            canonical.push_back(character);
        } else if (!std::isspace(static_cast<unsigned char>(character))) {
            canonical.push_back(character);
        }
    }

    return canonical;
}

SchemaDefinition readSchemaDefinition(sqlite3* handle) {
    sqlite3_stmt* rawStatement = nullptr;
    const int prepareResult = sqlite3_prepare_v2(
        handle,
        "SELECT type, name, sql FROM sqlite_schema "
        "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
        "  AND name <> 'database_migrations' "
        "ORDER BY type, name",
        -1, &rawStatement, nullptr);
    if (prepareResult != SQLITE_OK) {
        throw std::runtime_error("could not inspect schema definition");
    }

    std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)> statement(rawStatement,
                                                                        sqlite3_finalize);
    SchemaDefinition definition;
    int stepResult = SQLITE_OK;
    while ((stepResult = sqlite3_step(statement.get())) == SQLITE_ROW) {
        const auto* type =
            reinterpret_cast<const char*>(sqlite3_column_text(statement.get(), 0));
        const auto* name =
            reinterpret_cast<const char*>(sqlite3_column_text(statement.get(), 1));
        const auto* sql = reinterpret_cast<const char*>(sqlite3_column_text(statement.get(), 2));
        if (!type || !name || !sql) {
            throw std::runtime_error("schema definition contains an invalid entry");
        }
        definition.emplace(std::string(type) + "\x1f" + name, canonicalSchemaSql(sql));
    }
    if (stepResult != SQLITE_DONE) {
        throw std::runtime_error("could not read schema definition");
    }
    return definition;
}

bool legacyV1SchemaCompatible(Database& database, const MigrationDefinition& migration) {
    sqlite3* rawExpected = nullptr;
    if (sqlite3_open_v2(":memory:", &rawExpected,
                        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_MEMORY,
                        nullptr) != SQLITE_OK) {
        if (rawExpected) sqlite3_close(rawExpected);
        throw std::runtime_error("could not create legacy schema verifier");
    }
    std::unique_ptr<sqlite3, decltype(&sqlite3_close)> expected(rawExpected, sqlite3_close);

    char* migrationError = nullptr;
    const int migrationResult =
        sqlite3_exec(expected.get(), migration.sql.c_str(), nullptr, nullptr, &migrationError);
    if (migrationResult != SQLITE_OK) {
        const std::string message =
            migrationError ? migrationError : sqlite3_errmsg(expected.get());
        if (migrationError) sqlite3_free(migrationError);
        throw std::runtime_error("could not build expected legacy schema: " + message);
    }

    const auto expectedDefinition = readSchemaDefinition(expected.get());
    const auto actualDefinition = readSchemaDefinition(database.handle());
    return expectedDefinition == actualDefinition;
}

[[noreturn]] void migrationFailure(std::string message) {
    throw PosError(std::string(protocol::err::kMigrationFailed), std::move(message));
}

std::string createPreMigrationBackup(Database& database, int fromVersion, int targetVersion) {
    const auto source = std::filesystem::absolute(std::filesystem::path(database.path()));
    const auto directory = source.parent_path() / "backups";
    const std::string stem = source.stem().empty() ? "pos" : source.stem().string();
    const std::string extension =
        source.extension().empty() ? ".db" : source.extension().string();
    const std::string filename =
        stem + "-pre-migration-v" + std::to_string(fromVersion) + "-to-v" +
        std::to_string(targetVersion) + "-" + std::to_string(nowMs()) + "-" +
        crypto::uuid4() + extension;
    const auto destination = directory / filename;

    database.backupTo(destination.string());
    return destination.string();
}

}  // namespace

bool isShippedDefaultPin(const std::string& userId, const std::string& pinHash) {
    for (const auto& user : kDemoUsers) {
        if (userId == user.id && crypto::verifyPin(user.pin, pinHash)) return true;
    }
    return false;
}

bool shouldBackupBeforeMigration(int currentVersion, int targetVersion) noexcept {
    return currentVersion > 0 && currentVersion < targetVersion;
}

Migrator::Migrator(Database& db) : db_(db) {
    migrations_.reserve(kMigrations.size());
    for (const auto& migration : kMigrations) {
        migrations_.push_back(MigrationDefinition{
            migration.version,
            std::string(migration.name),
            std::string(migration.checksum),
            migration.sql(),
        });
    }
}

Migrator::Migrator(Database& db, std::vector<MigrationDefinition> migrations)
    : db_(db), migrations_(std::move(migrations)) {
    std::sort(migrations_.begin(), migrations_.end(),
              [](const auto& left, const auto& right) { return left.version < right.version; });
}

int Migrator::targetVersion() const noexcept {
    return migrations_.empty() ? 0 : migrations_.back().version;
}

const MigrationDefinition* Migrator::migrationForVersion(int version) const noexcept {
    const auto found = std::find_if(migrations_.begin(), migrations_.end(),
                                    [version](const auto& migration) {
                                        return migration.version == version;
                                    });
    return found == migrations_.end() ? nullptr : &*found;
}

int Migrator::currentVersion() const {
    Statement stmt = db_.prepare("PRAGMA user_version");
    return stmt.step() ? static_cast<int>(stmt.columnInt(0)) : 0;
}

void Migrator::ensureMigrationTable() {
    db_.exec(
        "CREATE TABLE IF NOT EXISTS database_migrations ("
        "  version    INTEGER PRIMARY KEY,"
        "  name       TEXT NOT NULL,"
        "  checksum   TEXT NOT NULL,"
        "  applied_at INTEGER NOT NULL)");
}

bool Migrator::migrationTableExists() {
    Statement table = db_.prepare(
        "SELECT COUNT(*) FROM sqlite_schema "
        "WHERE type = 'table' AND name = 'database_migrations'");
    return table.step() && table.columnInt(0) == 1;
}

bool Migrator::validateAppliedMigrations(int currentVersion, bool tableExists) {
    if (currentVersion > 0 && !migrationForVersion(currentVersion)) {
        migrationFailure("Database schema version " + std::to_string(currentVersion) +
                         " is not represented by the embedded migrations");
    }

    std::unordered_set<int> recordedVersions;
    std::vector<std::pair<int, std::string>> checksumHeals;
    if (tableExists) {
        Statement records = db_.prepare(
            "SELECT version, name, checksum FROM database_migrations ORDER BY version");
        while (records.step()) {
            const int version = static_cast<int>(records.columnInt(0));
            const std::string name = records.columnText(1);
            const std::string checksum = records.columnText(2);
            const auto* embedded = migrationForVersion(version);

            if (version <= 0 || version > currentVersion || !embedded) {
                migrationFailure("Migration history contains an unexpected version " +
                                 std::to_string(version));
            }
            if (name != embedded->name) {
                migrationFailure("Applied migration " + std::to_string(version) +
                                 " has a different name than the embedded migration");
            }
            // Already-applied SQL cannot be rewound; heal history when an older
            // checkout applied the same file with different line endings / edits.
            if (checksum != embedded->checksum) {
                logger()->warn(
                    "migration {} checksum drift (recorded={} embedded={}); healing history",
                    version, checksum, embedded->checksum);
                checksumHeals.emplace_back(version, embedded->checksum);
            }
            recordedVersions.insert(version);
        }
        for (const auto& [version, checksum] : checksumHeals) {
            Statement heal = db_.prepare(
                "UPDATE database_migrations SET checksum = :checksum WHERE version = :version");
            heal.bind(":checksum", checksum)
                .bind(":version", static_cast<std::int64_t>(version))
                .step();
        }
    }

    bool needsLegacyBackfill = false;
    for (const auto& migration : migrations_) {
        if (migration.version > currentVersion ||
            recordedVersions.contains(migration.version)) {
            continue;
        }

        const bool isLegacyV1Gap = currentVersion == 1 && migration.version == 1;
        if (!isLegacyV1Gap) {
            migrationFailure("Applied migration " + std::to_string(migration.version) +
                             " is missing from migration history");
        }
        if (!legacyV1SchemaCompatible(db_, migration)) {
            migrationFailure(
                "Legacy schema v1 does not match the embedded migration and was not backfilled");
        }
        needsLegacyBackfill = true;
    }

    return needsLegacyBackfill;
}

void Migrator::backfillLegacyMigration() {
    const auto* migration = migrationForVersion(1);
    if (!migration) migrationFailure("Embedded migration v1 is unavailable for legacy backfill");

    Transaction transaction(db_);
    Statement backfill = db_.prepare(
        "INSERT INTO database_migrations (version, name, checksum, applied_at) "
        "VALUES (:version, :name, :checksum, :applied_at)");
    backfill.bind(":version", static_cast<std::int64_t>(migration->version))
        .bind(":name", migration->name)
        .bind(":checksum", migration->checksum)
        .bind(":applied_at", nowMs());
    backfill.exec();
    transaction.commit();

    logger()->info("backfilled migration metadata for compatible legacy schema v1");
}

void Migrator::applyMigration(const MigrationDefinition& migration) {
    logger()->info("applying migration {} ({})", migration.version, migration.name);

    // The DDL and the version bump land together: a crash midway leaves the
    // database exactly as it was, never half-migrated.
    Transaction txn(db_);

    db_.exec(migration.sql);

    Statement record = db_.prepare(
        "INSERT INTO database_migrations (version, name, checksum, applied_at) "
        "VALUES (:version, :name, :checksum, :applied_at)");
    record.bind(":version", static_cast<std::int64_t>(migration.version))
        .bind(":name", migration.name)
        .bind(":checksum", migration.checksum)
        .bind(":applied_at", nowMs());
    record.exec();

    // PRAGMA user_version does not accept a bound parameter.
    db_.exec("PRAGMA user_version=" + std::to_string(migration.version));

    txn.commit();
}

int Migrator::migrate(const ProgressFn& progress) {
    const int from = currentVersion();
    const int target = targetVersion();

    if (from < target) {
        logger()->info("migrating schema v{} -> v{}", from, target);
        if (progress) progress("migrations", "Preparing local database…", 45);
    }

    std::string backupPath;
    if (shouldBackupBeforeMigration(from, target)) {
        try {
            // This must remain the first write in an existing upgrade path.
            // Version and target discovery above are read-only.
            backupPath = createPreMigrationBackup(db_, from, target);
            logger()->info("pre-migration backup ready: {}", backupPath);
        } catch (const std::exception& error) {
            migrationFailure("Pre-migration backup failed: " + std::string(error.what()));
        }
    }

    const auto logPreservedBackup = [&] {
        if (!backupPath.empty()) {
            logger()->error("migration failed; pre-migration backup preserved at {}", backupPath);
        }
    };

    bool tableExists = false;
    bool needsLegacyBackfill = false;
    try {
        tableExists = migrationTableExists();
        needsLegacyBackfill = validateAppliedMigrations(from, tableExists);
    } catch (const PosError& error) {
        logPreservedBackup();
        if (error.code() == protocol::err::kMigrationFailed) throw;
        migrationFailure("Migration metadata validation failed: " + error.message());
    } catch (const std::exception& error) {
        logPreservedBackup();
        migrationFailure("Migration metadata validation failed: " + std::string(error.what()));
    }

    try {
        if (!tableExists && target > 0) {
            ensureMigrationTable();
        }
        if (needsLegacyBackfill) backfillLegacyMigration();
    } catch (const std::exception& error) {
        logPreservedBackup();
        migrationFailure("Migration metadata preparation failed: " + std::string(error.what()));
    }

    if (from >= target) {
        logger()->info("schema up to date (v{})", from);
        return 0;
    }

    int applied = 0;
    for (const auto& migration : migrations_) {
        if (migration.version <= from) continue;
        try {
            applyMigration(migration);
            ++applied;
        } catch (const std::exception& err) {
            logPreservedBackup();
            throw PosError(std::string(protocol::err::kMigrationFailed),
                           "Migration " + migration.name + " failed: " + err.what());
        }
    }

    logger()->info("applied {} migration(s), now at v{}", applied, currentVersion());
    return applied;
}

void Migrator::seedDemoUsers() {
    const std::int64_t now = nowMs();

    // An earlier release handed these codes to different user ids, and
    // users.code is UNIQUE. The legacy row has to give the code up before the
    // insert below runs, or opening a database created by that release aborts.
    for (const auto& user : kDemoUsers) {
        Statement park = db_.prepare(
            "UPDATE users SET code = 'legacy-' || id, active = 0, updated_at = :now "
            "WHERE code = :code AND id <> :id");
        park.bind(":now", now)
            .bind(":code", std::string(user.code))
            .bind(":id", std::string(user.id));
        park.exec();
    }

    for (const auto& user : kDemoUsers) {
        Statement exists = db_.prepare("SELECT 1 FROM users WHERE id = :id");
        exists.bind(":id", std::string(user.id));

        if (exists.step()) {
            Statement revive = db_.prepare(
                "UPDATE users SET code = :code, full_name = :name, primary_role_id = :role, "
                "                 color = :color, active = 1, updated_at = :now WHERE id = :id");
            revive.bind(":code", std::string(user.code))
                .bind(":name", std::string(user.name))
                .bind(":role", std::string(user.roleId))
                .bind(":color", std::string(user.color))
                .bind(":now", now)
                .bind(":id", std::string(user.id));
            revive.exec();
        } else {
            // Hashed here rather than in the SQL seed because each user needs a
            // random salt, and a PIN must never exist in plain text on disk.
            const std::string hash = crypto::hashPin(user.pin);

            Statement insert = db_.prepare(
                "INSERT INTO users (id, code, full_name, pin_hash, primary_role_id, color, active,"
                "                   failed_attempts, created_at, updated_at) "
                "VALUES (:id, :code, :name, :hash, :role, :color, 1, 0, :now, :now)");
            insert.bind(":id", std::string(user.id))
                .bind(":code", std::string(user.code))
                .bind(":name", std::string(user.name))
                .bind(":hash", hash)
                .bind(":role", std::string(user.roleId))
                .bind(":color", std::string(user.color))
                .bind(":now", now);
            insert.exec();
        }

        Statement link = db_.prepare(
            "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (:user, :role)");
        link.bind(":user", std::string(user.id)).bind(":role", std::string(user.roleId));
        link.exec();
    }

    // Retire only the known demo waiters. Admin-created staff must stay active.
    Statement retire = db_.prepare(
        "UPDATE users SET active = 0, updated_at = :now "
        "WHERE id IN ('usr-waiter-f', 'usr-waiter-m') AND active = 1");
    retire.bind(":now", now);
    retire.exec();
}

void Migrator::ensurePermissionGrants() {
    // Upgrades keep their original seed data; these grants must land even when
    // seedIfEmpty short-circuits on a non-empty menu.
    static constexpr const char* kPermissionsSql =
        "INSERT OR IGNORE INTO permissions (id, key, description) VALUES "
        "('perm-business-day','businessDay.manage','Open and close business days / Z reports'),"
        "('perm-x-report','reports.x','Generate interim X reports'),"
        "('perm-z-report','reports.z','Generate end-of-day Z reports'),"
        "('perm-cash-manage','cash.manage','Cash in/out and drawer operations'),"
        "('perm-gift-manage','gifts.manage','Configure gift campaigns'),"
        "('perm-gift-override','gifts.override','Approve gift review overrides'),"
        "('perm-catalog-import','catalog.import','Import/export catalog CSV'),"
        "('perm-backup-manage','backup.manage','Create and restore local backups'),"
        "('perm-license-manage','license.manage','Activate and view license status'),"
        "('perm-table-layout','tables.layout','Edit floor plan layout'),"
        "('perm-split-bill','payment.split','Split bills'),"
        "('perm-discount-rules','discount.manage','Manage discount rules'),"
        "('perm-users-manage','users.manage','Create and deactivate local staff accounts')";
    db_.exec(kPermissionsSql);

    static constexpr const char* kRoleGrantsSql =
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES "
        "('role-cashier','perm-x-report'),('role-cashier','perm-cash-manage'),"
        "('role-cashier','perm-split-bill'),"
        "('role-supervisor','perm-x-report'),('role-supervisor','perm-cash-manage'),"
        "('role-supervisor','perm-split-bill'),('role-supervisor','perm-gift-override'),"
        "('role-manager','perm-business-day'),('role-manager','perm-x-report'),"
        "('role-manager','perm-z-report'),('role-manager','perm-cash-manage'),"
        "('role-manager','perm-gift-manage'),('role-manager','perm-gift-override'),"
        "('role-manager','perm-catalog-import'),('role-manager','perm-backup-manage'),"
        "('role-manager','perm-table-layout'),('role-manager','perm-split-bill'),"
        "('role-manager','perm-discount-rules'),('role-manager','perm-users-manage'),"
        "('role-administrator','perm-business-day'),('role-administrator','perm-x-report'),"
        "('role-administrator','perm-z-report'),('role-administrator','perm-cash-manage'),"
        "('role-administrator','perm-gift-manage'),('role-administrator','perm-gift-override'),"
        "('role-administrator','perm-catalog-import'),('role-administrator','perm-backup-manage'),"
        "('role-administrator','perm-license-manage'),('role-administrator','perm-table-layout'),"
        "('role-administrator','perm-split-bill'),('role-administrator','perm-discount-rules'),"
        "('role-administrator','perm-users-manage')";
    db_.exec(kRoleGrantsSql);

    // Keys for actions the app already performed but never checked, so a role
    // can now be told not to do them. Every key here is enforced by a handler;
    // a key with nothing behind it is a switch that lies.
    //
    // Seeded here rather than in a migration because migrations run before the
    // reference seed, when `roles` and `permissions` are still empty and the
    // foreign keys below have nothing to point at.
    db_.exec(
        "INSERT OR IGNORE INTO permissions (id, key, description) VALUES "
        "('perm-roles-manage',   'roles.manage',   'Create roles and grant permissions'),"
        "('perm-order-view',     'order.view',     'View orders and their history'),"
        "('perm-table-status',   'tables.status',  'Change a table''s status'),"
        "('perm-payment-view',   'payment.view',   'View payments taken on a bill'),"
        "('perm-receipt-print',  'receipt.print',  'Print and reprint receipts'),"
        "('perm-printer-manage', 'printer.manage', 'Configure, retry and cancel print jobs'),"
        "('perm-kds-view',       'kds.view',       'View the kitchen screen')");

    db_.exec(
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES "
        "('role-waiter','perm-order-view'),('role-waiter','perm-table-status'),"
        "('role-waiter','perm-receipt-print'),"
        "('role-kitchen','perm-kds-view'),"
        "('role-cashier','perm-order-view'),('role-cashier','perm-table-status'),"
        "('role-cashier','perm-payment-view'),('role-cashier','perm-receipt-print'),"
        "('role-supervisor','perm-order-view'),('role-supervisor','perm-table-status'),"
        "('role-supervisor','perm-payment-view'),('role-supervisor','perm-receipt-print'),"
        "('role-supervisor','perm-kds-view'),"
        "('role-manager','perm-roles-manage'),('role-manager','perm-order-view'),"
        "('role-manager','perm-table-status'),('role-manager','perm-payment-view'),"
        "('role-manager','perm-receipt-print'),('role-manager','perm-printer-manage'),"
        "('role-manager','perm-kds-view')");

    // Stock, recipes, suppliers and purchasing.
    db_.exec(
        "INSERT OR IGNORE INTO permissions (id, key, description) VALUES "
        "('perm-inv-view',     'inventory.view',     'View stock levels and movements'),"
        "('perm-inv-manage',   'inventory.manage',   'Create and edit ingredients and stores'),"
        "('perm-inv-adjust',   'inventory.adjust',   'Adjust stock and record waste'),"
        "('perm-inv-transfer', 'inventory.transfer', 'Move stock between stores'),"
        "('perm-inv-count',    'inventory.count',    'Run and post a stocktake'),"
        "('perm-recipes',      'recipes.manage',     'Edit what a dish consumes'),"
        "('perm-sup-view',     'suppliers.view',     'View suppliers and purchases'),"
        "('perm-sup-manage',   'suppliers.manage',   'Create and edit suppliers and orders'),"
        "('perm-sup-receive',  'suppliers.receive',  'Receive a delivery into stock'),"
        "('perm-sup-pay',      'suppliers.pay',      'Pay a supplier invoice')");

    db_.exec(
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES "
        // A chef needs to see what is in the store and write off what spoiled.
        "('role-kitchen','perm-inv-view'),('role-kitchen','perm-inv-adjust'),"
        "('role-supervisor','perm-inv-view'),('role-supervisor','perm-inv-adjust'),"
        "('role-supervisor','perm-inv-transfer'),('role-supervisor','perm-inv-count'),"
        "('role-supervisor','perm-sup-view'),"
        "('role-manager','perm-inv-view'),('role-manager','perm-inv-manage'),"
        "('role-manager','perm-inv-adjust'),('role-manager','perm-inv-transfer'),"
        "('role-manager','perm-inv-count'),('role-manager','perm-recipes'),"
        "('role-manager','perm-sup-view'),('role-manager','perm-sup-manage'),"
        "('role-manager','perm-sup-receive'),('role-manager','perm-sup-pay')");

    // Guests, deliveries and the rota.
    db_.exec(
        "INSERT OR IGNORE INTO permissions (id, key, description) VALUES "
        "('perm-cus-view',    'customers.view',       'View guests, debt and points'),"
        "('perm-cus-manage',  'customers.manage',     'Create and edit guests'),"
        "('perm-cus-credit',  'customers.credit',     'Charge a house account and take payment'),"
        "('perm-cus-loyalty', 'customers.loyalty',    'Award and redeem loyalty points'),"
        "('perm-res-view',    'reservations.view',    'View table bookings'),"
        "('perm-res-manage',  'reservations.manage',  'Take, move and cancel bookings'),"
        "('perm-del-view',    'delivery.view',        'View deliveries and courier reports'),"
        "('perm-del-manage',  'delivery.manage',      'Create deliveries and manage couriers'),"
        "('perm-del-assign',  'delivery.assign',      'Assign a courier and move a delivery on'),"
        "('perm-sch-view',    'schedule.view',        'View the rota and attendance'),"
        "('perm-sch-manage',  'schedule.manage',      'Plan and change the rota'),"
        "('perm-sch-clock',   'schedule.clock',       'Clock in and out')");

    db_.exec(
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES "
        // A waiter takes bookings, serves house accounts and punches a clock.
        "('role-waiter','perm-cus-view'),('role-waiter','perm-res-view'),"
        "('role-waiter','perm-res-manage'),('role-waiter','perm-sch-view'),"
        "('role-waiter','perm-sch-clock'),"
        "('role-kitchen','perm-sch-view'),('role-kitchen','perm-sch-clock'),"
        "('role-cashier','perm-cus-view'),('role-cashier','perm-cus-credit'),"
        "('role-cashier','perm-cus-loyalty'),('role-cashier','perm-res-view'),"
        "('role-cashier','perm-res-manage'),('role-cashier','perm-del-view'),"
        "('role-cashier','perm-del-assign'),('role-cashier','perm-sch-view'),"
        "('role-cashier','perm-sch-clock'),"
        "('role-supervisor','perm-cus-view'),('role-supervisor','perm-cus-manage'),"
        "('role-supervisor','perm-cus-credit'),('role-supervisor','perm-cus-loyalty'),"
        "('role-supervisor','perm-res-view'),('role-supervisor','perm-res-manage'),"
        "('role-supervisor','perm-del-view'),('role-supervisor','perm-del-manage'),"
        "('role-supervisor','perm-del-assign'),('role-supervisor','perm-sch-view'),"
        "('role-supervisor','perm-sch-clock'),"
        "('role-manager','perm-cus-view'),('role-manager','perm-cus-manage'),"
        "('role-manager','perm-cus-credit'),('role-manager','perm-cus-loyalty'),"
        "('role-manager','perm-res-view'),('role-manager','perm-res-manage'),"
        "('role-manager','perm-del-view'),('role-manager','perm-del-manage'),"
        "('role-manager','perm-del-assign'),('role-manager','perm-sch-view'),"
        "('role-manager','perm-sch-manage'),('role-manager','perm-sch-clock')");

    db_.exec(
        "INSERT OR IGNORE INTO permissions (id, key, description) VALUES "
        "('perm-rep-export', 'reports.export', 'Export reports to a spreadsheet')");
    db_.exec(
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES "
        "('role-supervisor','perm-rep-export'),('role-manager','perm-rep-export')");

    // The administrator holds every permission there is, including any added by
    // a later release. Without this, granting a manager a right the
    // administrator lacked would leave nobody able to take it back.
    // A storekeeper. The floor roles could all see stock but nobody shipped a
    // role whose job IS stock, so "let the anbarçı receive deliveries but not
    // touch a bill" had no answer. Seeded here rather than in the reference
    // seed because that only runs on an empty database - an existing till has
    // to converge on it too.
    db_.exec(
        "INSERT OR IGNORE INTO roles (id, name, description, rank) VALUES "
        "('role-storekeeper', 'storekeeper', 'Stock, deliveries and suppliers', 25)");
    db_.exec(
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
        "SELECT 'role-storekeeper', id FROM permissions WHERE key IN ("
        "'inventory.view','inventory.manage','inventory.adjust','inventory.transfer',"
        "'inventory.count','recipes.manage','suppliers.view','suppliers.receive')");

    db_.exec(
        "INSERT OR IGNORE INTO role_permissions (role_id, permission_id) "
        "SELECT 'role-administrator', id FROM permissions");
}

void Migrator::ensurePrinterSettings() {
    const std::int64_t now = nowMs();

    // `auto` means "find the printer at print time". Only ever inserted, never
    // forced back over a value: an earlier version rewrote this row to a
    // hardcoded LAN address on every startup, which made it impossible to keep
    // a USB printer selected.
    Statement ensureReceipt = db_.prepare(
        "INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at) "
        "VALUES ('printer.receipt', 'auto', 'string', :now)");
    ensureReceipt.bind(":now", now);
    ensureReceipt.exec();

    struct Setting {
        const char* key;
        const char* value;
        const char* type;
    };
    constexpr Setting kExtras[] = {
        {"printer.autoDetect", "1", "string"},
        {"printer.density", "5", "int"},
        {"printer.cut", "1", "string"},
        {"printer.beep", "0", "string"},
        {"printer.qr", "1", "string"},
        {"printer.columns", "48", "int"},
        {"printer.paperWidth", "80", "int"},
        {"printer.charsPerLine58", "28", "int"},
        {"printer.charsPerLine80", "40", "int"},
        {"printer.fontHeightPx", "32", "int"},
        {"printer.fontWidthPx", "14", "int"},
        {"printer.sideMarginPx", "2", "int"},
        {"printer.renderMode", "auto", "string"},
        {"printer.codePage", "13", "int"},
        {"printer.bottomFeedLines", "4", "int"},
        {"printer.openCashDrawer", "0", "string"},
        {"printer.printItemUnitPrice", "1", "string"},
        {"printer.printModifierPrice", "1", "string"},
        {"locale.currencyDisplay", "symbol", "string"},
        {"locale.currency", "AZN", "string"},
        // Blank on purpose: trading hours belong to the venue, and shipping the
        // first customer's value printed somebody else's opening times on every
        // other customer's receipts. The settings screen edits this now.
        {"restaurant.hours", "", "string"},
        // Branch identity, not a partition: each till runs one branch with its
        // own database, so the branch is what a report and a receipt are
        // stamped with rather than something every query filters on.
        {"branch.name", "", "string"},
        {"branch.code", "", "string"},
        {"branch.address", "", "string"},
        {"branch.phone", "", "string"},
        // Where the receipt QR sends the guest. Empty by default: it used to
        // ship pointing at one particular 2gis pin in Baku, so every till that
        // installed this printed a QR sending its guests to an address that was
        // not the restaurant holding the receipt. Parametrlər -> Printer is
        // where an operator sets their own.
        {"receipt.qrUrl", "", "string"},
        {"receipt.verifyUrl", "", "string"},
    };
    // Tills already carrying the seeded demo pin get it cleared - nobody chose
    // that value, so this is undoing a default, not overwriting an operator's
    // setting. Anything else they have typed is left alone.
    {
        Statement stale = db_.prepare(
            "UPDATE app_settings SET value = '', updated_at = :now "
            "WHERE key = 'receipt.qrUrl' "
            "  AND value = 'https://2gis.az/baku/geo/70030076175156383'");
        stale.bind(":now", now);
        stale.exec();
    }

    for (const auto& setting : kExtras) {
        // INSERT OR IGNORE: never overwrite a choice the operator has already made.
        Statement upsert = db_.prepare(
            "INSERT OR IGNORE INTO app_settings (key, value, value_type, updated_at) "
            "VALUES (:key, :value, :type, :now)");
        upsert.bind(":key", std::string(setting.key))
            .bind(":value", std::string(setting.value))
            .bind(":type", std::string(setting.type))
            .bind(":now", now);
        upsert.exec();
    }

    // Strip a legacy "VOEN " / "VÖEN " prefix so the receipt never prints
    // "VÖEN: VÖEN 1900123456".
    Statement taxId = db_.prepare(
        "UPDATE app_settings SET value = REPLACE(REPLACE(value, 'VÖEN ', ''), 'VOEN ', ''), "
        "       updated_at = :now "
        "WHERE key = 'restaurant.taxId' AND (value LIKE 'VOEN %' OR value LIKE 'VÖEN %')");
    taxId.bind(":now", now);
    taxId.exec();

    // Shorten the printed brand on existing installs that still carry the
    // longer default from migration 012.
    Statement brand = db_.prepare(
        "UPDATE app_settings SET value = 'Milioner Pub', updated_at = :now "
        "WHERE key = 'restaurant.name' AND value IN ("
        "  'Milioner Pub & Lounge', 'Maison Aurelia', 'Maison Aurelia POS')");
    brand.bind(":now", now);
    brand.exec();

    Statement tagline = db_.prepare(
        "UPDATE app_settings SET value = '', updated_at = :now "
        "WHERE key = 'restaurant.tagline' AND value = 'Pub & Lounge'");
    tagline.bind(":now", now);
    tagline.exec();

    // Receipts print silently — existing installs still have the old default "1".
    Statement silent = db_.prepare(
        "UPDATE app_settings SET value = '0', updated_at = :now "
        "WHERE key = 'printer.beep' AND value != '0'");
    silent.bind(":now", now);
    silent.exec();
}

/**
 * Whether this database has already been seeded.
 *
 * Used to be "does `menu_categories` have rows", which stopped being an answer
 * once the demo menu became optional: a till seeded without a catalogue has no
 * categories, and would have been re-seeded on every single launch. The marker
 * row settles it. The table counts remain as the fallback for databases created
 * before the marker existed — they have no row but are plainly seeded.
 */
bool Migrator::referenceDataPresent() {
    Statement marker =
        db_.prepare("SELECT 1 FROM app_settings WHERE key = 'seed.referenceAt' LIMIT 1");
    if (marker.step()) return true;

    for (const char* sql : {"SELECT COUNT(*) FROM menu_categories",
                            "SELECT COUNT(*) FROM restaurant_areas"}) {
        Statement count = db_.prepare(sql);
        if (count.step() && count.columnInt(0) > 0) return true;
    }
    return false;
}

namespace {

/** A seed that carries the Milioner catalogue rather than data everyone needs. */
bool isDemoSeed(std::string_view name) {
    return name.find("_demo_") != std::string_view::npos;
}

/**
 * Whether to install the demo catalogue on a fresh database.
 *
 * Defaults to yes, which is what every existing install got. Set
 * `POS_SEED_DEMO_MENU=0` when provisioning for a restaurant that will load its
 * own menu — otherwise its staff start by deleting 118 items belonging to a
 * different venue.
 */
bool wantsDemoMenu() {
    const char* raw = std::getenv("POS_SEED_DEMO_MENU");
    if (!raw) return true;
    const std::string_view value{raw};
    return !(value == "0" || value == "false" || value == "no");
}

}  // namespace

bool Migrator::seedIfEmpty(const ProgressFn& progress) {
    const bool hasData = referenceDataPresent();

    if (hasData) {
        // Users are seeded independently: a database restored from a backup
        // without demo staff should still be usable. Converging staff on an
        // existing database must never keep the POS from opening, so a failure
        // here is logged and the transaction rolls back instead of propagating.
        try {
            Transaction txn(db_);
            seedDemoUsers();
            ensurePrinterSettings();
            ensurePermissionGrants();
            txn.commit();
        } catch (const std::exception& err) {
            logger()->error("demo staff sync skipped: {}", err.what());
        }
        return false;
    }

    logger()->info("empty database - seeding reference data");
    if (progress) progress("seed", "Loading restaurant configuration…", 65);

    Transaction txn(db_);

    const bool demo = wantsDemoMenu();
    if (!demo) logger()->info("demo catalogue skipped (POS_SEED_DEMO_MENU)");

    for (const auto& seed : kSeeds) {
        if (!demo && isDemoSeed(seed.name)) {
            logger()->info("skipping demo seed {}", seed.name);
            continue;
        }
        logger()->info("running seed {}", seed.name);
        db_.exec(seed.sql());
    }

    // Stamp settings rows written by the SQL seed with a real timestamp.
    const std::int64_t seededAt = nowMs();
    Statement touch = db_.prepare("UPDATE app_settings SET updated_at = :now WHERE updated_at = 0");
    touch.bind(":now", seededAt);
    touch.exec();

    // Written last so a seed that threw leaves no marker and is retried.
    Statement marker = db_.prepare(
        "INSERT INTO app_settings (key, value, value_type, updated_at) "
        "VALUES ('seed.referenceAt', :at, 'int', :now) "
        "ON CONFLICT(key) DO NOTHING");
    marker.bind(":at", std::to_string(seededAt)).bind(":now", seededAt);
    marker.exec();

    seedDemoUsers();
    ensurePrinterSettings();
    ensurePermissionGrants();

    txn.commit();

    logger()->info("seed complete");
    return true;
}

}  // namespace pos::db
