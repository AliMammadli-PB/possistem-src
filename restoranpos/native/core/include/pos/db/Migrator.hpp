#pragma once

#include <functional>
#include <string>
#include <vector>

namespace pos::db {

class Database;

/** Reports migration/seed progress so the splash screen can show real stages. */
using ProgressFn = std::function<void(const std::string& key, const std::string& message, int progress)>;

/**
 * True when `pinHash` still verifies against the PIN this build seeds for
 * `userId`. That PIN is public (it ships in the source), so such an account must
 * pick a new PIN before signing in and can never approve anything.
 */
bool isShippedDefaultPin(const std::string& userId, const std::string& pinHash);

/** True only when an existing schema will advance to a newer version. */
bool shouldBackupBeforeMigration(int currentVersion, int targetVersion) noexcept;

/** Owned migration metadata used by production embedding and focused test harnesses. */
struct MigrationDefinition {
    int version;
    std::string name;
    std::string checksum;
    std::string sql;
};

/**
 * Applies embedded migrations and seed data.
 *
 * Schema version is tracked with PRAGMA user_version (cheap, atomic, stored in
 * the file header) and mirrored into database_migrations for auditability.
 */
class Migrator {
public:
    explicit Migrator(Database& db);
    Migrator(Database& db, std::vector<MigrationDefinition> migrations);

    /** Brings the schema up to date. Returns the number of migrations applied. */
    int migrate(const ProgressFn& progress);

    /** Inserts reference data and demo users when the database is empty. */
    bool seedIfEmpty(const ProgressFn& progress);

    int currentVersion() const;

private:
    void ensureMigrationTable();
    bool migrationTableExists();
    bool validateAppliedMigrations(int currentVersion, bool tableExists);
    void backfillLegacyMigration();
    void applyMigration(const MigrationDefinition& migration);
    int targetVersion() const noexcept;
    const MigrationDefinition* migrationForVersion(int version) const noexcept;
    void ensurePermissionGrants();
    void seedDemoUsers();
    void ensurePrinterSettings();
    bool referenceDataPresent();

    Database& db_;
    std::vector<MigrationDefinition> migrations_;
};

}  // namespace pos::db
