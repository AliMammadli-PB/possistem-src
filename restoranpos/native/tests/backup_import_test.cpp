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
