#pragma once

#include <algorithm>
#include <string>
#include <vector>

#include "pos/Common.hpp"

namespace pos::printing {

/**
 * An extra kitchen printer ("Kababçı", "Bar") the venue added in Settings →
 * Printer. Dishes assigned to it - one by one in the dish editor (itemIds) or
 * by whole category - print on its own ticket; every other dish stays on the
 * main kitchen printer (`printer.kitchen`).
 *
 * Stored by the settings screen as JSON in the `kitchen.stations` setting:
 *   [{"id":"st-1","name":"Kababçı","printer":"tcp:192.168.0.50:9100","itemIds":["…"],"categoryIds":["cat-kebab"]}]
 * Entries for the till's own roles (receipt, warehouse) share the list and
 * have nothing assigned, so they never route a dish.
 */
struct KitchenStation {
    std::string id;
    std::string name;
    std::string printer;
    std::vector<std::string> categoryIds;
    std::vector<std::string> itemIds;
};

/** Malformed or incomplete entries are skipped: a bad row must never stop the kitchen. */
inline std::vector<KitchenStation> parseKitchenStations(const std::string& raw) {
    std::vector<KitchenStation> stations;
    Json list;
    try {
        list = Json::parse(raw.empty() ? "[]" : raw);
    } catch (...) {
        return stations;
    }
    if (!list.is_array()) return stations;
    for (const auto& row : list) {
        if (!row.is_object()) continue;
        // Shared devices may print till receipts AND selected kitchen dishes.
        // Main kitchen entries use printer.kitchen; a receipt-only entry must
        // not retain an old dish route when its purpose changes.
        bool main=row.value("main",false),kitchen=row.value("kind",std::string())=="kitchen";
        if(row.contains("roles")&&row["roles"].is_array())for(const auto& role:row["roles"])if(role=="kitchen"){main=true;kitchen=true;}
        if(main||(row.contains("kind")&&!kitchen))continue;
        KitchenStation station;
        station.id = row.value("id", "");
        station.name = row.value("name", "");
        station.printer = row.value("printer", "");
        const auto ids = [&](const char* key, std::vector<std::string>& into) {
            if (!row.contains(key) || !row[key].is_array()) return;
            for (const auto& id : row[key]) {
                if (id.is_string() && !id.get<std::string>().empty()) into.push_back(id);
            }
        };
        ids("categoryIds", station.categoryIds);
        ids("itemIds", station.itemIds);
        if (station.id.empty() || station.printer.empty()) continue;
        if (station.categoryIds.empty() && station.itemIds.empty()) continue;
        stations.push_back(std::move(station));
    }
    return stations;
}

/** The station a dish prints on - its own choice first, then its category's - or nullptr for the main kitchen. */
inline const KitchenStation* stationFor(const std::vector<KitchenStation>& stations,
                                        const std::string& productId, const std::string& categoryId) {
    for (const auto& station : stations) {
        if (std::find(station.itemIds.begin(), station.itemIds.end(), productId) != station.itemIds.end()) {
            return &station;
        }
    }
    for (const auto& station : stations) {
        if (std::find(station.categoryIds.begin(), station.categoryIds.end(), categoryId) !=
            station.categoryIds.end()) {
            return &station;
        }
    }
    return nullptr;
}

/**
 * The `kitchen.stations` JSON with one dish moved to `stationId` ("" = the main
 * kitchen). Everything else in the list - names, roles, other dishes - is kept.
 */
inline std::string assignItemToStation(const std::string& raw, const std::string& itemId,
                                       const std::string& stationId) {
    Json list;
    try {
        list = Json::parse(raw.empty() ? "[]" : raw);
    } catch (...) {
        list = Json::array();
    }
    if (!list.is_array()) list = Json::array();
    for (auto& row : list) {
        if (!row.is_object()) continue;
        Json items = Json::array();
        if (row.contains("itemIds") && row["itemIds"].is_array()) {
            for (const auto& id : row["itemIds"]) {
                if (!(id.is_string() && id.get<std::string>() == itemId)) items.push_back(id);
            }
        }
        if (!stationId.empty() && row.value("id", "") == stationId) items.push_back(itemId);
        row["itemIds"] = items;
    }
    return list.dump();
}

/** The station a category prints on, or nullptr for the main kitchen printer. */
inline const KitchenStation* stationForCategory(const std::vector<KitchenStation>& stations,
                                                const std::string& categoryId) {
    for (const auto& station : stations) {
        if (std::find(station.categoryIds.begin(), station.categoryIds.end(), categoryId) !=
            station.categoryIds.end()) {
            return &station;
        }
    }
    return nullptr;
}

}  // namespace pos::printing
