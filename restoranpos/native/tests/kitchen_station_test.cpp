#include <cstdint>
#include "catch_amalgamated.hpp"

#include "ServiceFixture.hpp"
#include "pos/Common.hpp"
#include "pos/Crypto.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/printing/KitchenStations.hpp"
#include "pos/printing/ReceiptBuilder.hpp"
#include "pos/protocol_generated.hpp"

/**
 * Extra kitchen printers: a venue adds "Kababçı" with its own printer and the
 * kebab category, and from then on kebabs print there - only there - while the
 * rest of the order stays on the main kitchen printer.
 */
namespace {

class StationFixture {
public:
    StationFixture() {
        pos::handlers::registerOrders(fixture_.contextPtr());
        pos::handlers::registerTables(fixture_.contextPtr());
    }

    pos::Json call(std::string_view method, pos::Json payload) {
        pos::ipc::Request request;
        request.requestId = pos::crypto::uuid4();
        request.method = std::string(method);
        request.payload = std::move(payload);
        request.idempotencyKey = pos::crypto::uuid4();
        return fixture_.server().callHandler(request);
    }

    /** A category with one dish in it; returns {categoryId, dishId}. */
    std::pair<std::string, std::string> dish(const std::string& name) {
        const auto now = pos::nowMs();
        const std::string category = "cat-" + pos::crypto::uuid4().substr(0, 8);
        auto cat = fixture_.db().prepare(
            "INSERT INTO menu_categories (id, name_az, sort_order, active) VALUES (:id, :name, 99, 1)");
        cat.bind(":id", category).bind(":name", name);
        cat.exec();
        const std::string id = pos::crypto::uuid4();
        auto item = fixture_.db().prepare(
            "INSERT INTO menu_items (id, category_id, sku, name_az, price_minor, active, created_at, updated_at) "
            "VALUES (:id, :cat, :sku, :name, 900, 1, :now, :now)");
        item.bind(":id", id).bind(":cat", category).bind(":sku", "S-" + id.substr(0, 8))
            .bind(":name", name).bind(":now", now);
        item.exec();
        return {category, id};
    }

    void setting(const std::string& key, const std::string& value) {
        auto upsert = fixture_.db().prepare(
            "INSERT INTO app_settings (key, value, value_type, updated_at) VALUES (:k, :v, 'string', 0) "
            "ON CONFLICT(key) DO UPDATE SET value = :v");
        upsert.bind(":k", key).bind(":v", value);
        upsert.exec();
    }

    ServiceFixture& fixture() { return fixture_; }

private:
    ServiceFixture fixture_;
};

struct Job {
    std::string printer;
    pos::Json options;
    std::string status;
};

std::vector<Job> kitchenJobs(ServiceFixture& fixture, const std::string& orderId) {
    std::vector<Job> jobs;
    auto rows = fixture.db().prepare(
        "SELECT target_printer, COALESCE(payload, ''), status FROM print_jobs "
        "WHERE order_id = :o AND kind = 'kitchen_ticket' ORDER BY target_printer");
    rows.bind(":o", orderId);
    while (rows.step()) {
        const std::string payload = rows.columnText(1);
        jobs.push_back({rows.columnText(0), payload.empty() ? pos::Json::object() : pos::Json::parse(payload),
                        rows.columnText(2)});
    }
    return jobs;
}

}  // namespace

TEST_CASE("station config skips incomplete rows", "[printing][stations]") {
    const auto stations = pos::printing::parseKitchenStations(
        R"([{"id":"st-1","name":"Kababçı","printer":"tcp:127.0.0.1:1","categoryIds":["cat-k"]},
            {"id":"st-2","name":"Boş","printer":"","categoryIds":["cat-x"]},
            "junk"])");
    REQUIRE(stations.size() == 1);
    REQUIRE(pos::printing::stationForCategory(stations, "cat-k") == &stations[0]);
    REQUIRE(pos::printing::stationForCategory(stations, "cat-other") == nullptr);
    REQUIRE(pos::printing::parseKitchenStations("not json").empty());
}

TEST_CASE("kebabs print on the kebab printer, the rest in the kitchen", "[printing][stations]") {
    StationFixture f;
    const auto [kebabCategory, kebab] = f.dish("Lülə kabab");
    const auto [saladCategory, salad] = f.dish("Çoban salatı");
    (void)saladCategory;
    f.setting("printer.kitchen", "virtual");
    f.setting("kitchen.stations",
              pos::Json::array({{{"id", "st-kabab"}, {"name", "KABABÇI"},
                                 {"printer", "tcp:127.0.0.1:1"}, {"categoryIds", {kebabCategory}}}})
                  .dump());

    const auto order = f.call(pos::protocol::method::kOrdersCreate, {{"tableId", "tbl-01"}, {"guestCount", 2}});
    const std::string orderId = order["id"];
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", kebab}, {"quantity", 2}});
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", salad}, {"quantity", 1}});
    f.call(pos::protocol::method::kOrdersSubmit, {{"orderId", orderId}});

    auto jobs = kitchenJobs(f.fixture(), orderId);
    REQUIRE(jobs.size() == 2);
    const auto& kebabJob = jobs[0].printer == "virtual" ? jobs[1] : jobs[0];
    const auto& mainJob = jobs[0].printer == "virtual" ? jobs[0] : jobs[1];
    REQUIRE(mainJob.printer == "virtual");  // main kitchen
    REQUIRE_FALSE(mainJob.options.contains("station"));
    // Sending to the kitchen prints at once, not when the next bill is paid.
    REQUIRE(mainJob.status == "completed");
    REQUIRE(kebabJob.printer == "tcp:127.0.0.1:1");  // kebab station
    REQUIRE(kebabJob.options.value("station", "") == "st-kabab");
    REQUIRE(kebabJob.options["itemIds"].size() == 1);
    REQUIRE(kebabJob.status != "queued");  // tried already (no printer listens there)

    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    const auto kitchen = builder.kitchenTicket(orderId);
    REQUIRE(kitchen.text.find("Çoban salatı") != std::string::npos);
    REQUIRE(kitchen.text.find("Lülə kabab") == std::string::npos);

    const auto kebabTicket = builder.kitchenTicket(orderId, kebabJob.options);
    REQUIRE(kebabTicket.text.find("KABABÇI") != std::string::npos);
    REQUIRE(kebabTicket.text.find("Lülə kabab") != std::string::npos);
    REQUIRE(kebabTicket.text.find("Çoban salatı") == std::string::npos);
}

TEST_CASE("a round of kebabs only queues no main kitchen ticket", "[printing][stations]") {
    StationFixture f;
    const auto [kebabCategory, kebab] = f.dish("Tikə kabab");
    f.setting("kitchen.stations",
              pos::Json::array({{{"id", "st-kabab"}, {"name", "KABABÇI"},
                                 {"printer", "tcp:127.0.0.1:1"}, {"categoryIds", {kebabCategory}}}})
                  .dump());
    const auto order = f.call(pos::protocol::method::kOrdersCreate, {{"tableId", "tbl-02"}, {"guestCount", 1}});
    const std::string orderId = order["id"];
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", kebab}, {"quantity", 1}});
    f.call(pos::protocol::method::kOrdersSubmit, {{"orderId", orderId}});

    const auto jobs = kitchenJobs(f.fixture(), orderId);
    REQUIRE(jobs.size() == 1);
    REQUIRE(jobs[0].printer == "tcp:127.0.0.1:1");
}

TEST_CASE("without extra printers the kitchen ticket is unchanged", "[printing][stations]") {
    StationFixture f;
    const auto [category, dish] = f.dish("Dolma");
    (void)category;
    const auto order = f.call(pos::protocol::method::kOrdersCreate, {{"tableId", "tbl-03"}, {"guestCount", 1}});
    const std::string orderId = order["id"];
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", dish}, {"quantity", 1}});
    f.call(pos::protocol::method::kOrdersSubmit, {{"orderId", orderId}});

    const auto jobs = kitchenJobs(f.fixture(), orderId);
    REQUIRE(jobs.size() == 1);
    REQUIRE_FALSE(jobs[0].options.contains("station"));
    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    REQUIRE(builder.kitchenTicket(orderId).text.find("Dolma") != std::string::npos);
}

TEST_CASE("a dish picked for the kebab printer prints there, whatever its category", "[printing][stations]") {
    StationFixture f;
    const auto [category, adana] = f.dish("Adana kabab");
    (void)category;
    const auto [category2, soup] = f.dish("Mərci şorbası");
    (void)category2;
    f.setting("printer.kitchen", "virtual");
    // The settings screen saved the printer; the dish editor then moved one dish to it.
    std::string stations = pos::Json::array({{{"id", "st-kabab"}, {"name", "KABABÇI"}, {"printer", "tcp:127.0.0.1:1"},
                                             {"roles", pos::Json::array()}}}).dump();
    stations = pos::printing::assignItemToStation(stations, adana, "st-kabab");
    REQUIRE(pos::printing::parseKitchenStations(stations).at(0).itemIds == std::vector<std::string>{adana});
    f.setting("kitchen.stations", stations);

    const auto order = f.call(pos::protocol::method::kOrdersCreate, {{"tableId", "tbl-04"}, {"guestCount", 2}});
    const std::string orderId = order["id"];
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", adana}, {"quantity", 1}});
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", soup}, {"quantity", 1}});
    f.call(pos::protocol::method::kOrdersSubmit, {{"orderId", orderId}});

    const auto jobs = kitchenJobs(f.fixture(), orderId);
    REQUIRE(jobs.size() == 2);
    pos::printing::ReceiptBuilder builder(f.fixture().ctx());
    const auto main = builder.kitchenTicket(orderId);
    REQUIRE(main.text.find("Mərci şorbası") != std::string::npos);
    REQUIRE(main.text.find("Adana kabab") == std::string::npos);

    // Moving it back to the main kitchen keeps the printer and drops the dish.
    const auto back = pos::printing::assignItemToStation(stations, adana, "");
    REQUIRE(pos::Json::parse(back).at(0).value("name", "") == "KABABÇI");
    REQUIRE(pos::printing::parseKitchenStations(back).empty());
}

TEST_CASE("the live floor sync can carry what is on each table", "[tables][live]") {
    StationFixture f;
    const auto [category, dish] = f.dish("Toyuq şiş");
    (void)category;
    const auto order = f.call(pos::protocol::method::kOrdersCreate, {{"tableId", "tbl-05"}, {"guestCount", 3}});
    const std::string orderId = order["id"];
    f.call(pos::protocol::method::kOrdersAddItem, {{"orderId", orderId}, {"productId", dish}, {"quantity", 2}});

    const auto find = [](const pos::Json& list, const std::string& id) {
        for (const auto& row : list["tables"]) if (row.value("id", "") == id) return row;
        return pos::Json();
    };
    // The floor map's own call stays lean.
    REQUIRE_FALSE(find(f.call(pos::protocol::method::kTablesList, pos::Json::object()), "tbl-05").contains("items"));
    const auto row = find(f.call(pos::protocol::method::kTablesList, {{"includeItems", true}}), "tbl-05");
    REQUIRE(row["items"].size() == 1);
    REQUIRE(row["items"][0].value("name", "") == "Toyuq şiş");
    REQUIRE(row["items"][0].value("quantity", 0) == 2);
    // Each line carries its total, so the owner sees what the table costs line by line.
    REQUIRE(row["items"][0]["totalMinor"].get<std::int64_t>() == 2 * 900);  // fixture price 900
    REQUIRE_FALSE(find(f.call(pos::protocol::method::kTablesList, {{"includeItems", true}}), "tbl-06").contains("items"));
}
