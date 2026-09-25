#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "pos/Common.hpp"

struct sqlite3;
struct sqlite3_stmt;

namespace pos::db {

class Database;

/**
 * RAII wrapper over a cached prepared statement.
 *
 * Statements are cached by SQL text and reused, so the destructor resets and
 * clears bindings rather than finalising. Every value is bound as a parameter -
 * there is no string concatenation into SQL anywhere in this codebase.
 */
class Statement {
public:
    Statement(Database& db, sqlite3_stmt* stmt);
    ~Statement();

    Statement(const Statement&) = delete;
    Statement& operator=(const Statement&) = delete;
    Statement(Statement&& other) noexcept;

    Statement& bind(std::string_view name, std::int64_t value);
    Statement& bind(std::string_view name, int value);
    Statement& bind(std::string_view name, const std::string& value);
    Statement& bind(std::string_view name, const char* value);
    Statement& bind(std::string_view name, bool value);
    Statement& bind(std::string_view name, double value);
    Statement& bind(std::string_view name, std::nullptr_t);
    /** Binds null when the optional string is empty. */
    Statement& bindOptional(std::string_view name, const std::string& value);

    /** Advances to the next row; false when the result set is exhausted. */
    bool step();

    /** Runs a statement that returns no rows. */
    void exec();

    std::int64_t columnInt(int index) const;
    double columnDouble(int index) const;
    std::string columnText(int index) const;
    bool columnIsNull(int index) const;
    int columnCount() const;
    std::string columnName(int index) const;

    /** Current row as a JSON object keyed by column name. */
    Json row() const;

    /** Every remaining row as a JSON array. */
    Json rows();

private:
    Database& db_;
    sqlite3_stmt* stmt_;
    bool moved_ = false;

    int parameterIndex(std::string_view name) const;
};

/**
 * BEGIN IMMEDIATE transaction guard.
 *
 * Immediate rather than deferred: a deferred transaction acquires the write
 * lock lazily and can fail with SQLITE_BUSY_SNAPSHOT partway through, leaving
 * exactly the half-applied state this exists to prevent. Rolls back unless
 * commit() was called; nesting uses SAVEPOINTs.
 */
class Transaction {
public:
    explicit Transaction(Database& db);
    ~Transaction();

    Transaction(const Transaction&) = delete;
    Transaction& operator=(const Transaction&) = delete;

    void commit();

private:
    Database& db_;
    bool active_ = true;
    bool nested_ = false;
    std::string savepoint_;
};

/**
 * Owns the single SQLite connection.
 *
 * Thread-confined to the worker thread by design. A POS does single-digit
 * operations per second, so a connection pool buys nothing while costing
 * SQLITE_BUSY handling, lock-ordering bugs, and per-thread statement caches.
 */
class Database {
public:
    Database();
    ~Database();

    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

    /**
     * Opens the database and applies the connection pragmas.
     *
     * Throws E_DB_UNSUITABLE_LOCATION when WAL cannot be enabled - which happens
     * on network shares and inside folder-sync directories, where SQLite
     * locking is unreliable and real corruption follows.
     */
    void open(const std::string& path);
    void close();

    bool isOpen() const { return handle_ != nullptr; }
    sqlite3* handle() { return handle_; }
    const std::string& path() const { return path_; }

    Statement prepare(std::string_view sql);

    /** Executes one or more statements with no result handling. */
    void exec(std::string_view sql);

    std::int64_t lastInsertRowId() const;
    int changes() const;

    /** True when no transaction is open - useful as a post-commit assertion. */
    bool inAutocommit() const;

    /** Runs `fn` inside a transaction, rolling back if it throws. */
    void withTransaction(const std::function<void()>& fn);

    /** PRAGMA quick_check; throws E_DB_CORRUPT on failure. */
    void verifyIntegrity();

    /**
     * Creates a consistent online backup and atomically replaces destinationPath.
     *
     * The backup is assembled and integrity-checked in a temporary file in the
     * destination directory, so an interrupted or failed backup never damages
     * an existing destination.
     */
    void backupTo(const std::string& destinationPath);

    /**
     * Overwrites the live database with the contents of a backup file.
     *
     * Uses the SQLite online backup API in reverse, so the connection handle
     * stays valid and no file swapping is needed - swapping the file out from
     * under an open connection is how a restore turns into a corrupt till.
     *
     * The caller must have no open transaction and no live Statement objects;
     * the statement cache is cleared here because every cached plan refers to
     * the schema that is about to be replaced.
     */
    void restoreFrom(const std::string& sourcePath);

    /** Free space in bytes on the volume holding the database, or -1. */
    std::int64_t freeDiskBytes() const;

    int transactionDepth = 0;

    /** Translates a SQLite result code into a protocol error and throws it. */
    [[noreturn]] void throwSqliteError(int code, std::string_view context) const;

    void releaseStatement(sqlite3_stmt* stmt);

private:
    sqlite3* handle_ = nullptr;
    std::string path_;
    /** Primary prepared statement per SQL text. */
    std::unordered_map<std::string, sqlite3_stmt*> cache_;
    /** Statements currently wrapped by a live Statement RAII object. */
    std::unordered_set<sqlite3_stmt*> borrowed_;
    /**
     * Overflow prepares: same SQL text was requested while the cached stmt was
     * still borrowed. These are finalised on release instead of returned to the
     * cache, so two live wrappers never share one sqlite3_stmt*.
     */
    std::unordered_set<sqlite3_stmt*> overflow_;
};

}  // namespace pos::db
