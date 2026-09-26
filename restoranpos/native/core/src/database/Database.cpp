#include "pos/db/Database.hpp"

#include <atomic>
#include <filesystem>
#include <stdexcept>
#include <system_error>

#include <sqlite3.h>

#include "pos/Error.hpp"
#include "pos/Logging.hpp"
#include "pos/protocol_generated.hpp"

#ifdef _WIN32
#include <windows.h>
#endif

namespace pos::db {
namespace {

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("database");
    return log;
}

constexpr std::int64_t kLowDiskWarnBytes = 200LL * 1024 * 1024;

std::filesystem::path temporaryBackupPath(const std::filesystem::path& destination) {
    static std::atomic<std::uint64_t> sequence{0};
    auto temporary = destination;
    temporary += ".tmp-" + std::to_string(nowMs()) + "-" +
                 std::to_string(sequence.fetch_add(1, std::memory_order_relaxed));
    return temporary;
}

std::filesystem::path replacementRecoveryPath(const std::filesystem::path& destination) {
    static std::atomic<std::uint64_t> sequence{0};
    auto recovery = destination;
    recovery += ".previous-" + std::to_string(nowMs()) + "-" +
                std::to_string(sequence.fetch_add(1, std::memory_order_relaxed));
    return recovery;
}

void removeBackupSidecars(const std::filesystem::path& databasePath) {
    std::error_code ignored;
    std::filesystem::remove(databasePath.string() + "-wal", ignored);
    std::filesystem::remove(databasePath.string() + "-shm", ignored);
    std::filesystem::remove(databasePath.string() + "-journal", ignored);
}

void removeBackupArtifacts(const std::filesystem::path& databasePath) {
    std::error_code ignored;
    std::filesystem::remove(databasePath, ignored);
    removeBackupSidecars(databasePath);
}

void atomicReplace(const std::filesystem::path& temporary,
                   const std::filesystem::path& destination) {
#ifdef _WIN32
    std::error_code existsError;
    const bool destinationExists = std::filesystem::exists(destination, existsError);
    if (existsError) {
        throw PosError(std::string(protocol::err::kInternal),
                       "Could not inspect database backup destination: " +
                           existsError.message());
    }

    if (!destinationExists) {
        // No overwrite flag: a racing creator is preserved and this move fails.
        // The temporary file is in the same directory, so COPY_ALLOWED is
        // intentionally omitted and the operation cannot degrade into a copy.
        if (!MoveFileExW(temporary.c_str(), destination.c_str(), MOVEFILE_WRITE_THROUGH)) {
            throw PosError(std::string(protocol::err::kInternal),
                           "Could not install new database backup (system error " +
                               std::to_string(GetLastError()) + ")");
        }
        return;
    }

    const auto recovery = replacementRecoveryPath(destination);
    std::error_code ignored;
    std::filesystem::remove(recovery, ignored);

    // ReplaceFile is the Windows primitive that preserves the replaced file's
    // identity and can retain its prior contents for recovery. Microsoft marks
    // REPLACEFILE_WRITE_THROUGH unsupported, so the SQLite file is fully closed
    // before this call and the old destination is retained in `recovery` until
    // replacement has succeeded.
    if (ReplaceFileW(destination.c_str(), temporary.c_str(), recovery.c_str(), 0, nullptr,
                     nullptr)) {
        if (!std::filesystem::remove(recovery, ignored) && !ignored) {
            logger()->warn("database backup replacement recovery file was already absent");
        } else if (ignored) {
            logger()->warn("could not remove database backup replacement recovery file: {}",
                           ignored.message());
        }
        return;
    }

    const DWORD replacementError = GetLastError();
    const bool recoveryExists = std::filesystem::exists(recovery, ignored);
    if (ignored) {
        throw PosError(std::string(protocol::err::kInternal),
                       "Database backup replacement failed (system error " +
                           std::to_string(replacementError) +
                           ") and recovery state could not be inspected");
    }

    if (recoveryExists) {
        bool restored = false;
        if (std::filesystem::exists(destination, ignored) && !ignored) {
            restored =
                ReplaceFileW(destination.c_str(), recovery.c_str(), nullptr, 0, nullptr, nullptr);
        } else if (!ignored) {
            restored =
                MoveFileExW(recovery.c_str(), destination.c_str(), MOVEFILE_WRITE_THROUGH);
        }
        if (!restored) {
            throw PosError(std::string(protocol::err::kInternal),
                           "Database backup replacement failed (system error " +
                               std::to_string(replacementError) +
                               "); original destination recovery also failed (system error " +
                               std::to_string(GetLastError()) + ")");
        }
    }

    throw PosError(std::string(protocol::err::kInternal),
                   "Database backup replacement failed (system error " +
                       std::to_string(replacementError) +
                       "); original destination was preserved");
#else
    std::error_code ec;
    std::filesystem::rename(temporary, destination, ec);
    if (ec) {
        throw PosError(std::string(protocol::err::kInternal),
                       "Could not finalize database backup: " + ec.message());
    }
#endif
}

}  // namespace

// ------------------------------------------------------------------ Statement

Statement::Statement(Database& db, sqlite3_stmt* stmt) : db_(db), stmt_(stmt) {}

Statement::Statement(Statement&& other) noexcept
    : db_(other.db_), stmt_(other.stmt_), moved_(other.moved_) {
    other.moved_ = true;
}

Statement::~Statement() {
    if (!moved_ && stmt_) db_.releaseStatement(stmt_);
}

int Statement::parameterIndex(std::string_view name) const {
    const std::string parameter = name.front() == ':' ? std::string(name) : ":" + std::string(name);
    const int index = sqlite3_bind_parameter_index(stmt_, parameter.c_str());
    if (index == 0) {
        throw PosError(std::string(protocol::err::kInternal),
                       "Unknown SQL parameter: " + parameter);
    }
    return index;
}

Statement& Statement::bind(std::string_view name, std::int64_t value) {
    sqlite3_bind_int64(stmt_, parameterIndex(name), value);
    return *this;
}

Statement& Statement::bind(std::string_view name, int value) {
    return bind(name, static_cast<std::int64_t>(value));
}

Statement& Statement::bind(std::string_view name, const std::string& value) {
    // SQLITE_TRANSIENT: SQLite copies the buffer, so callers may pass temporaries.
    sqlite3_bind_text(stmt_, parameterIndex(name), value.data(),
                      static_cast<int>(value.size()), SQLITE_TRANSIENT);
    return *this;
}

Statement& Statement::bind(std::string_view name, const char* value) {
    if (!value) return bind(name, nullptr);
    sqlite3_bind_text(stmt_, parameterIndex(name), value, -1, SQLITE_TRANSIENT);
    return *this;
}

Statement& Statement::bind(std::string_view name, bool value) {
    return bind(name, static_cast<std::int64_t>(value ? 1 : 0));
}

Statement& Statement::bind(std::string_view name, double value) {
    sqlite3_bind_double(stmt_, parameterIndex(name), value);
    return *this;
}

Statement& Statement::bind(std::string_view name, std::nullptr_t) {
    sqlite3_bind_null(stmt_, parameterIndex(name));
    return *this;
}

Statement& Statement::bindOptional(std::string_view name, const std::string& value) {
    return value.empty() ? bind(name, nullptr) : bind(name, value);
}

bool Statement::step() {
    const int rc = sqlite3_step(stmt_);
    if (rc == SQLITE_ROW) return true;
    if (rc == SQLITE_DONE) return false;
    db_.throwSqliteError(rc, "step");
}

void Statement::exec() {
    while (step()) {
        // Drain any rows a write statement produced (e.g. RETURNING).
    }
}

std::int64_t Statement::columnInt(int index) const { return sqlite3_column_int64(stmt_, index); }
double Statement::columnDouble(int index) const { return sqlite3_column_double(stmt_, index); }

std::string Statement::columnText(int index) const {
    const auto* text = reinterpret_cast<const char*>(sqlite3_column_text(stmt_, index));
    if (!text) return {};
    return std::string(text, static_cast<std::size_t>(sqlite3_column_bytes(stmt_, index)));
}

bool Statement::columnIsNull(int index) const {
    return sqlite3_column_type(stmt_, index) == SQLITE_NULL;
}

int Statement::columnCount() const { return sqlite3_column_count(stmt_); }

std::string Statement::columnName(int index) const {
    const char* name = sqlite3_column_name(stmt_, index);
    return name ? name : "";
}

Json Statement::row() const {
    Json object = Json::object();
    const int count = columnCount();
    for (int i = 0; i < count; ++i) {
        const std::string name = columnName(i);
        switch (sqlite3_column_type(stmt_, i)) {
            case SQLITE_NULL:
                object[name] = nullptr;
                break;
            case SQLITE_INTEGER:
                object[name] = columnInt(i);
                break;
            case SQLITE_FLOAT:
                object[name] = columnDouble(i);
                break;
            default:
                object[name] = columnText(i);
                break;
        }
    }
    return object;
}

Json Statement::rows() {
    Json array = Json::array();
    while (step()) array.push_back(row());
    return array;
}

// ---------------------------------------------------------------- Transaction

Transaction::Transaction(Database& db) : db_(db) {
    if (db_.transactionDepth > 0) {
        nested_ = true;
        savepoint_ = "sp_" + std::to_string(db_.transactionDepth);
        db_.exec("SAVEPOINT " + savepoint_);
    } else {
        db_.exec("BEGIN IMMEDIATE");
    }
    db_.transactionDepth++;
}

Transaction::~Transaction() {
    if (!active_) return;
    // Destructor runs during stack unwinding when a handler throws; rolling
    // back here is what guarantees no half-applied order ever survives.
    try {
        if (nested_) {
            db_.exec("ROLLBACK TO " + savepoint_);
            db_.exec("RELEASE " + savepoint_);
        } else {
            db_.exec("ROLLBACK");
        }
    } catch (const std::exception& err) {
        logger()->error("rollback failed: {}", err.what());
    }
    db_.transactionDepth--;
}

void Transaction::commit() {
    if (!active_) return;
    if (nested_) {
        db_.exec("RELEASE " + savepoint_);
    } else {
        db_.exec("COMMIT");
    }
    active_ = false;
    db_.transactionDepth--;
}

// ------------------------------------------------------------------- Database

Database::Database() = default;

Database::~Database() { close(); }

void Database::open(const std::string& path) {
    path_ = path;

    std::error_code ec;
    std::filesystem::create_directories(std::filesystem::path(path).parent_path(), ec);

    const int flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX |
                      SQLITE_OPEN_URI;

    const int rc = sqlite3_open_v2(path.c_str(), &handle_, flags, nullptr);
    if (rc != SQLITE_OK) {
        const std::string message = handle_ ? sqlite3_errmsg(handle_) : sqlite3_errstr(rc);
        if (handle_) {
            sqlite3_close_v2(handle_);
            handle_ = nullptr;
        }
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Could not open database at " + path + ": " + message);
    }

    // Waits instead of failing instantly when another writer holds the lock.
    sqlite3_busy_timeout(handle_, 5000);

    // WAL gives concurrent readers alongside a single writer. Crucially the
    // result is read back: on a network share or inside a sync folder the
    // pragma silently stays in "delete" mode, and running there leads to real
    // corruption, so refusing to start is the safe answer.
    {
        Statement stmt = prepare("PRAGMA journal_mode=WAL");
        std::string mode;
        if (stmt.step()) mode = stmt.columnText(0);
        if (mode != "wal") {
            close();
            throw PosError(std::string(protocol::err::kDbUnsuitableLocation),
                           "The database location does not support WAL journaling (got '" + mode +
                               "'). Move the database off a network share or synced folder.");
        }
    }

    // foreign_keys is per-connection and is NOT persisted in the file - easy to
    // forget, and silently disables every FK constraint if missed.
    exec("PRAGMA foreign_keys=ON");
    exec("PRAGMA synchronous=NORMAL");
    exec("PRAGMA wal_autocheckpoint=1000");
    exec("PRAGMA temp_store=MEMORY");
    exec("PRAGMA cache_size=-16000");

    logger()->info("database opened: {}", path);

    const auto freeBytes = freeDiskBytes();
    if (freeBytes >= 0 && freeBytes < kLowDiskWarnBytes) {
        logger()->warn("low disk space on the database volume: {} MB", freeBytes / (1024 * 1024));
    }
}

void Database::close() {
    if (!handle_) return;
    for (auto& [sql, stmt] : cache_) sqlite3_finalize(stmt);
    cache_.clear();
    for (sqlite3_stmt* stmt : overflow_) sqlite3_finalize(stmt);
    overflow_.clear();
    borrowed_.clear();

    // Truncating the WAL on shutdown keeps the next start fast and leaves a
    // single self-contained file behind for backups.
    sqlite3_exec(handle_, "PRAGMA wal_checkpoint(TRUNCATE)", nullptr, nullptr, nullptr);
    sqlite3_close_v2(handle_);
    handle_ = nullptr;
}

Statement Database::prepare(std::string_view sql) {
    const std::string key(sql);

    if (const auto it = cache_.find(key); it != cache_.end()) {
        // Only reuse the cached handle when no Statement still wraps it.
        // Handing out the same sqlite3_stmt* to two live wrappers made the
        // second bind/exec silently overwrite the first (tables.swap ghosts).
        if (borrowed_.find(it->second) == borrowed_.end()) {
            borrowed_.insert(it->second);
            return Statement(*this, it->second);
        }
    }

    sqlite3_stmt* stmt = nullptr;
    const int rc = sqlite3_prepare_v3(handle_, sql.data(), static_cast<int>(sql.size()),
                                      SQLITE_PREPARE_PERSISTENT, &stmt, nullptr);
    if (rc != SQLITE_OK) {
        logger()->error("prepare failed: {} | SQL: {}", sqlite3_errmsg(handle_), key);
        throwSqliteError(rc, "prepare");
    }

    if (cache_.find(key) == cache_.end()) {
        cache_.emplace(key, stmt);
    } else {
        overflow_.insert(stmt);
    }
    borrowed_.insert(stmt);
    return Statement(*this, stmt);
}

void Database::releaseStatement(sqlite3_stmt* stmt) {
    sqlite3_reset(stmt);
    sqlite3_clear_bindings(stmt);
    borrowed_.erase(stmt);
    if (const auto it = overflow_.find(stmt); it != overflow_.end()) {
        overflow_.erase(it);
        sqlite3_finalize(stmt);
    }
}

void Database::exec(std::string_view sql) {
    char* error = nullptr;
    const std::string statement(sql);
    const int rc = sqlite3_exec(handle_, statement.c_str(), nullptr, nullptr, &error);
    if (rc != SQLITE_OK) {
        const std::string message = error ? error : sqlite3_errstr(rc);
        if (error) sqlite3_free(error);
        logger()->error("exec failed: {} | SQL: {}", message, statement);
        throwSqliteError(rc, message);
    }
}

std::int64_t Database::lastInsertRowId() const { return sqlite3_last_insert_rowid(handle_); }

int Database::changes() const { return sqlite3_changes(handle_); }

bool Database::inAutocommit() const { return sqlite3_get_autocommit(handle_) != 0; }

void Database::withTransaction(const std::function<void()>& fn) {
    Transaction txn(*this);
    fn();
    txn.commit();
}

void Database::verifyIntegrity() {
    Statement stmt = prepare("PRAGMA quick_check");
    std::string result;
    if (stmt.step()) result = stmt.columnText(0);
    if (result != "ok") {
        throw PosError(std::string(protocol::err::kDbCorrupt),
                       "Database integrity check failed: " + result);
    }
}

void Database::backupTo(const std::string& destinationPath) {
    if (!handle_) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Cannot back up a database that is not open");
    }
    if (destinationPath.empty()) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Database backup destination is empty");
    }

    std::error_code sourcePathError;
    const auto source =
        std::filesystem::absolute(std::filesystem::path(path_), sourcePathError).lexically_normal();
    if (sourcePathError) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Could not resolve source database path: " + sourcePathError.message());
    }

    std::error_code pathError;
    const auto destination =
        std::filesystem::absolute(std::filesystem::path(destinationPath), pathError)
            .lexically_normal();
    if (pathError) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Could not resolve database backup destination: " + pathError.message());
    }
    if (source == destination) {
        throw PosError(std::string(protocol::err::kInternal),
                       "Database backup destination must differ from the source");
    }
    // Windows refuses to replace a directory with the finished file, but some
    // file systems (and Wine) let the rename swallow an empty one: refuse up front.
    std::error_code kindError;
    if (std::filesystem::is_directory(destination, kindError)) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Database backup destination is a directory");
    }

    const auto parent = destination.parent_path();
    std::filesystem::create_directories(parent, pathError);
    if (pathError) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Could not create database backup directory: " + pathError.message());
    }

    const auto temporary = temporaryBackupPath(destination);
    removeBackupArtifacts(temporary);

    sqlite3* output = nullptr;
    sqlite3_backup* backup = nullptr;
    sqlite3_stmt* integrity = nullptr;

    const auto cleanup = [&] {
        if (integrity) {
            sqlite3_finalize(integrity);
            integrity = nullptr;
        }
        if (backup) {
            sqlite3_backup_finish(backup);
            backup = nullptr;
        }
        if (output) {
            sqlite3_close_v2(output);
            output = nullptr;
        }
        removeBackupArtifacts(temporary);
    };

    try {
        int rc = sqlite3_open_v2(temporary.string().c_str(), &output,
                                 SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE |
                                     SQLITE_OPEN_FULLMUTEX,
                                 nullptr);
        if (rc != SQLITE_OK) {
            const std::string message = output ? sqlite3_errmsg(output) : sqlite3_errstr(rc);
            throw PosError(std::string(protocol::err::kDbOpen),
                           "Could not open temporary database backup: " + message);
        }
        sqlite3_busy_timeout(output, 5000);

        backup = sqlite3_backup_init(output, "main", handle_, "main");
        if (!backup) {
            throw PosError(std::string(protocol::err::kInternal),
                           "Could not initialize online database backup: " +
                               std::string(sqlite3_errmsg(output)));
        }

        int stepResult = SQLITE_OK;
        int busyRetries = 0;
        for (;;) {
            stepResult = sqlite3_backup_step(backup, 128);
            if (stepResult == SQLITE_DONE) break;
            if (stepResult == SQLITE_OK) {
                busyRetries = 0;
                continue;
            }
            if ((stepResult == SQLITE_BUSY || stepResult == SQLITE_LOCKED) &&
                busyRetries++ < 500) {
                sqlite3_sleep(10);
                continue;
            }
            break;
        }

        const int finishResult = sqlite3_backup_finish(backup);
        backup = nullptr;
        if (stepResult != SQLITE_DONE || finishResult != SQLITE_OK) {
            const int failure = finishResult != SQLITE_OK ? finishResult : stepResult;
            throw PosError(std::string(protocol::err::kInternal),
                           "Online database backup failed (" + std::to_string(failure) + "): " +
                               sqlite3_errmsg(output));
        }

        char* pragmaError = nullptr;
        rc = sqlite3_exec(output, "PRAGMA journal_mode=DELETE", nullptr, nullptr, &pragmaError);
        if (rc != SQLITE_OK) {
            const std::string message = pragmaError ? pragmaError : sqlite3_errmsg(output);
            if (pragmaError) sqlite3_free(pragmaError);
            throw PosError(std::string(protocol::err::kInternal),
                           "Could not finalize temporary database backup: " + message);
        }

        rc = sqlite3_prepare_v2(output, "PRAGMA quick_check", -1, &integrity, nullptr);
        if (rc != SQLITE_OK) {
            throw PosError(std::string(protocol::err::kDbCorrupt),
                           "Could not verify temporary database backup: " +
                               std::string(sqlite3_errmsg(output)));
        }

        rc = sqlite3_step(integrity);
        const auto* checkText =
            rc == SQLITE_ROW ? reinterpret_cast<const char*>(sqlite3_column_text(integrity, 0))
                             : nullptr;
        const bool integrityOk = checkText && std::string(checkText) == "ok";
        const int completion = integrityOk ? sqlite3_step(integrity) : rc;
        sqlite3_finalize(integrity);
        integrity = nullptr;
        if (!integrityOk || completion != SQLITE_DONE) {
            throw PosError(std::string(protocol::err::kDbCorrupt),
                           "Temporary database backup failed its integrity check");
        }

        rc = sqlite3_close(output);
        if (rc != SQLITE_OK) {
            const std::string message = sqlite3_errmsg(output);
            throw PosError(std::string(protocol::err::kInternal),
                           "Could not close temporary database backup: " + message);
        }
        output = nullptr;

        removeBackupSidecars(temporary);
        atomicReplace(temporary, destination);
        logger()->info("database backup created: {}", destination.string());
    } catch (...) {
        cleanup();
        throw;
    }
}

void Database::restoreFrom(const std::string& sourcePath) {
    if (!handle_) {
        throw PosError(std::string(protocol::err::kDbOpen),
                       "Cannot restore into a database that is not open");
    }
    if (transactionDepth != 0) {
        throw PosError(std::string(protocol::err::kInternal),
                       "A restore cannot run inside a transaction");
    }
    if (!borrowed_.empty()) {
        throw PosError(std::string(protocol::err::kInternal),
                       "A restore cannot run while statements are in flight");
    }

    std::error_code pathError;
    const auto source =
        std::filesystem::absolute(std::filesystem::path(sourcePath), pathError).lexically_normal();
    if (pathError || !std::filesystem::exists(source)) {
        throw PosError(std::string(protocol::err::kNotFound),
                       "Backup file was not found: " + sourcePath);
    }

    sqlite3* input = nullptr;
    sqlite3_backup* backup = nullptr;

    const auto cleanup = [&] {
        if (backup) {
            sqlite3_backup_finish(backup);
            backup = nullptr;
        }
        if (input) {
            sqlite3_close_v2(input);
            input = nullptr;
        }
    };

    try {
        int rc = sqlite3_open_v2(source.string().c_str(), &input,
                                 SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nullptr);
        if (rc != SQLITE_OK) {
            const std::string message = input ? sqlite3_errmsg(input) : sqlite3_errstr(rc);
            throw PosError(std::string(protocol::err::kDbOpen),
                           "Could not open the backup file: " + message);
        }
        sqlite3_busy_timeout(input, 5000);

        // Verify the source before touching the live database: restoring a
        // corrupt file would replace a working till with a broken one.
        sqlite3_stmt* check = nullptr;
        rc = sqlite3_prepare_v2(input, "PRAGMA quick_check", -1, &check, nullptr);
        if (rc != SQLITE_OK) {
            throw PosError(std::string(protocol::err::kDbCorrupt),
                           "Could not verify the backup file: " + std::string(sqlite3_errmsg(input)));
        }
        const int checkStep = sqlite3_step(check);
        const auto* checkText =
            checkStep == SQLITE_ROW ? reinterpret_cast<const char*>(sqlite3_column_text(check, 0))
                                    : nullptr;
        const bool integrityOk = checkText && std::string(checkText) == "ok";
        sqlite3_finalize(check);
        if (!integrityOk) {
            throw PosError(std::string(protocol::err::kDbCorrupt),
                           "The backup file failed its integrity check");
        }

        // Cached plans belong to the schema being replaced.
        for (auto& [sql, stmt] : cache_) sqlite3_finalize(stmt);
        cache_.clear();
        for (sqlite3_stmt* stmt : overflow_) sqlite3_finalize(stmt);
        overflow_.clear();

        backup = sqlite3_backup_init(handle_, "main", input, "main");
        if (!backup) {
            throw PosError(std::string(protocol::err::kInternal),
                           "Could not initialize the restore: " +
                               std::string(sqlite3_errmsg(handle_)));
        }

        int stepResult = SQLITE_OK;
        int busyRetries = 0;
        for (;;) {
            stepResult = sqlite3_backup_step(backup, 128);
            if (stepResult == SQLITE_DONE) break;
            if (stepResult == SQLITE_OK) {
                busyRetries = 0;
                continue;
            }
            if ((stepResult == SQLITE_BUSY || stepResult == SQLITE_LOCKED) && busyRetries++ < 500) {
                sqlite3_sleep(10);
                continue;
            }
            break;
        }

        const int finishResult = sqlite3_backup_finish(backup);
        backup = nullptr;
        if (stepResult != SQLITE_DONE || finishResult != SQLITE_OK) {
            const int failure = finishResult != SQLITE_OK ? finishResult : stepResult;
            throw PosError(std::string(protocol::err::kInternal),
                           "Database restore failed (" + std::to_string(failure) + "): " +
                               sqlite3_errmsg(handle_));
        }

        cleanup();
    } catch (...) {
        cleanup();
        throw;
    }

    verifyIntegrity();
}

std::int64_t Database::freeDiskBytes() const {
#ifdef _WIN32
    ULARGE_INTEGER available{};
    const auto directory = std::filesystem::path(path_).parent_path().wstring();
    if (GetDiskFreeSpaceExW(directory.c_str(), &available, nullptr, nullptr)) {
        return static_cast<std::int64_t>(available.QuadPart);
    }
    return -1;
#else
    std::error_code ec;
    const auto info = std::filesystem::space(std::filesystem::path(path_).parent_path(), ec);
    return ec ? -1 : static_cast<std::int64_t>(info.available);
#endif
}

void Database::throwSqliteError(int code, std::string_view context) const {
    const int extended = handle_ ? sqlite3_extended_errcode(handle_) : code;
    const std::string message = handle_ ? sqlite3_errmsg(handle_) : sqlite3_errstr(code);
    const std::string detail = std::string(context) + ": " + message;

    switch (code) {
        case SQLITE_BUSY:
        case SQLITE_LOCKED:
            throw PosError(std::string(protocol::err::kDbBusy), detail);
        case SQLITE_FULL:
            throw PosError(std::string(protocol::err::kDiskFull), detail);
        case SQLITE_CORRUPT:
        case SQLITE_NOTADB:
            throw PosError(std::string(protocol::err::kDbCorrupt), detail);
        case SQLITE_READONLY:
            throw PosError(std::string(protocol::err::kDbReadonly), detail);
        case SQLITE_CANTOPEN:
            throw PosError(std::string(protocol::err::kDbOpen), detail);
        case SQLITE_CONSTRAINT:
            throw PosError(std::string(protocol::err::kConstraint), detail,
                           Json{{"extended", extended}});
        case SQLITE_IOERR:
            // A write or fsync failure almost always means the volume filled up.
            if (extended == SQLITE_IOERR_WRITE || extended == SQLITE_IOERR_FSYNC) {
                throw PosError(std::string(protocol::err::kDiskFull), detail);
            }
            throw PosError(std::string(protocol::err::kInternal), detail);
        default:
            throw PosError(std::string(protocol::err::kInternal), detail,
                           Json{{"sqliteCode", code}, {"extended", extended}});
    }
}

}  // namespace pos::db
