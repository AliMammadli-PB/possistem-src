#include "catch_amalgamated.hpp"

#include <filesystem>
#include <fstream>

#include "ServiceFixture.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"

namespace {
pos::Json call(ServiceFixture& f, const std::string& method, pos::Json payload) {
    pos::ipc::Request request;
    request.requestId = "backup-import-test";
    request.method = method;
    request.payload = std::move(payload);
    return f.server().callHandler(request);
}
}  // namespace

TEST_CASE("a backup copied back from USB is registered only from the backups folder", "[backup]") {
    ServiceFixture f;
    pos::handlers::registerSystem(f.contextPtr());
    const auto created = call(f, "backup.create", {{"note", "usb"}});
    const std::filesystem::path original = created["path"].get<std::string>();
    const auto dir = original.parent_path();

    // A copy, as Electron main leaves it after the operator picks it on the stick.
    const auto copy = dir / "pos-usb-copy.db";
    std::filesystem::copy_file(original, copy);
    const auto imported = call(f, "backup.import", {{"path", copy.string()}});
    REQUIRE(imported["sizeBytes"].get<std::int64_t>() > 0);
    REQUIRE(call(f, "backup.restorePreview", {{"backupId", imported["id"]}})["fileExists"] == true);

    // Outside the backups folder, or not a restaurant database: refused.
    const auto outside = dir.parent_path() / "outside.db";
    std::filesystem::copy_file(original, outside);
    REQUIRE_THROWS_AS(call(f, "backup.import", {{"path", outside.string()}}), pos::PosError);
    REQUIRE_THROWS_AS(call(f, "backup.import", {{"path", (dir / ".." / "outside.db").string()}}), pos::PosError);
    const auto junk = dir / "junk.db";
    std::ofstream(junk) << "not a database";
    REQUIRE_THROWS_AS(call(f, "backup.import", {{"path", junk.string()}}), pos::PosError);
}

TEST_CASE("a backup from a dead computer restores its data but not that computer's licence", "[backup][cloud_backup]") {
    ServiceFixture f;
    pos::handlers::registerSystem(f.contextPtr());
    f.db().exec("INSERT OR REPLACE INTO license_state (id, status, device_id, updated_at) VALUES ('local', 'active', 'dead-pc', 1)");
    f.db().exec("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('device.installationId', 'dead-pc', 1)");
    f.db().exec("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('sales-fixture', 'from-backup', 1)");
    const auto created = call(f, "backup.create", {{"note", "cloud"}});
    f.db().exec("UPDATE license_state SET device_id = 'new-pc' WHERE id = 'local'");
    f.db().exec("UPDATE app_settings SET value = 'new-pc' WHERE key = 'device.installationId'");
    f.db().exec("DELETE FROM app_settings WHERE key = 'sales-fixture'");

    const auto done = call(f, "backup.restore", {{"backupId", created["id"]}, {"adminPin", "1234"}});
    REQUIRE(done["restored"] == true);
    const auto one = [&f](const std::string& sql) {
        auto q = f.db().prepare(sql);
        REQUIRE(q.step());
        return q.columnText(0);
    };
    REQUIRE(one("SELECT value FROM app_settings WHERE key = 'sales-fixture'") == "from-backup");
    REQUIRE(one("SELECT device_id FROM license_state WHERE id = 'local'") == "new-pc");
    REQUIRE(one("SELECT value FROM app_settings WHERE key = 'device.installationId'") == "new-pc");
    // Nothing is left beside the live database.
    for (const auto& e : std::filesystem::directory_iterator(std::filesystem::path(f.db().path()).parent_path()))
        REQUIRE(e.path().filename().string().find("-restore-") == std::string::npos);
}

TEST_CASE("a backup that cannot be read leaves the till as it was", "[backup][cloud_backup]") {
    ServiceFixture f;
    pos::handlers::registerSystem(f.contextPtr());
    f.db().exec("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('live-fixture', 'kept', 1)");
    const auto created = call(f, "backup.create", {{"note", "bad"}});
    std::ofstream(created["path"].get<std::string>(), std::ios::trunc) << "not a database";
    REQUIRE_THROWS(call(f, "backup.restore", {{"backupId", created["id"]}, {"adminPin", "1234"}}));
    auto q = f.db().prepare("SELECT value FROM app_settings WHERE key = 'live-fixture'");
    REQUIRE(q.step());
    REQUIRE(q.columnText(0) == "kept");
}

TEST_CASE("cloud snapshots are complete consistent databases and do not clutter manual history", "[backup][cloud_backup]") {
    ServiceFixture f;
    pos::handlers::registerSystem(f.contextPtr());
    f.db().exec("INSERT INTO app_settings(key,value,updated_at) VALUES('cloud-fixture','kept',1)");
    const auto before=call(f,"backup.list",pos::Json::object()).at("backups").size();
    const auto snapshot=call(f,"backup.cloudSnapshot",pos::Json::object());
    REQUIRE(snapshot.at("temporary")==true);
    REQUIRE(std::filesystem::exists(snapshot.at("path").get<std::string>()));
    REQUIRE(call(f,"backup.list",pos::Json::object()).at("backups").size()==before);
    pos::db::Database copy;copy.open(snapshot.at("path").get<std::string>());
    auto saved=copy.prepare("SELECT value FROM app_settings WHERE key='cloud-fixture'");REQUIRE(saved.step());REQUIRE(saved.columnText(0)=="kept");
    auto staff=copy.prepare("SELECT COUNT(*) FROM users WHERE id='usr-admin'");REQUIRE(staff.step());REQUIRE(staff.columnInt(0)==1);
    f.ctx().session().permissions.clear();
    REQUIRE_THROWS_AS(call(f,"backup.cloudSnapshot",pos::Json::object()),pos::PosError);
}
