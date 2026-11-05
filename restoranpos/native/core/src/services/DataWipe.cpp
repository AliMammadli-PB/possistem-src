#include "pos/services/DataWipe.hpp"

#include <filesystem>
#include <system_error>

#include "pos/Logging.hpp"
#include "pos/db/Migrator.hpp"

namespace pos::services {
namespace {

namespace fs = std::filesystem;

constexpr std::int64_t kKeepMs = 30LL * 86'400'000LL;
constexpr const char* kCopyMarker = "-before-wipe-";

std::shared_ptr<spdlog::logger> logger() {
    static auto log = logging::get("core");
    return log;
}

void removeWithSidecars(const fs::path& file) {
    std::error_code ec;
    for (const char* suffix : {"", "-wal", "-shm"}) fs::remove(fs::path(file.string() + suffix), ec);
}

}  // namespace

void DataWipe::carryIdentity(db::Database& target, const std::string& fromPath) {
    {
        auto attach = target.prepare("ATTACH DATABASE :path AS old");
        attach.bind(":path", fromPath);
        attach.exec();
    }
    target.exec("INSERT OR REPLACE INTO license_state SELECT * FROM old.license_state");
    target.exec(
        "INSERT OR REPLACE INTO app_settings (key, value, value_type, updated_at) "
        "SELECT key, value, value_type, updated_at FROM old.app_settings "
        "WHERE key IN ('device.installationId', 'license.controlUrl', 'sync.serverUrl', "
        "'terminal.id', 'branch.cloudName', 'branch.code', 'branch.name')");
    target.exec("DETACH DATABASE old");
}

std::string DataWipe::run(db::Database& db) {
    const auto source = fs::path(db.path());
    const auto dir = source.parent_path() / "backups";
    const auto stamp = std::to_string(nowMs());
    const auto copy = dir / (source.stem().string() + kCopyMarker + stamp + ".db");
    const auto fresh = source.parent_path() / (source.stem().string() + "-wipe-fresh-" + stamp + ".db");

    // Nothing is touched until the copy exists; a failed copy throws and the till carries on.
    db.backupTo(copy.string());

    try {
        db::Database target;
        target.open(fresh.string());
        db::Migrator migrator(target);
        migrator.migrate({});
        migrator.seedIfEmpty({});

        carryIdentity(target, copy.string());
        target.close();

        db.restoreFrom(fresh.string());
    } catch (...) {
        removeWithSidecars(fresh);
        throw;
    }
    removeWithSidecars(fresh);

    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        if (entry.path() != copy && entry.is_regular_file(ec)) fs::remove(entry.path(), ec);
    }
    fs::remove_all(source.parent_path() / "audit-archive", ec);

    logger()->warn("all data wiped; previous database kept as {}", copy.filename().string());
    return copy.filename().string();
}

void DataWipe::purgeExpiredCopies(const std::string& dbPath, std::int64_t now) {
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(fs::path(dbPath).parent_path() / "backups", ec)) {
        const auto stem = entry.path().stem().string();
        const auto at = stem.rfind(kCopyMarker);
        if (at == std::string::npos) continue;
        const auto stamp = stem.substr(at + std::char_traits<char>::length(kCopyMarker));
        if (stamp.empty() || stamp.find_first_not_of("0123456789") != std::string::npos) continue;
        if (now - std::stoll(stamp) >= kKeepMs) fs::remove(entry.path(), ec);
    }
}

}  // namespace pos::services
