#pragma once

#include <atomic>
#include <chrono>
#include <filesystem>
#include <memory>

#include "catch_amalgamated.hpp"

#include "pos/db/Database.hpp"
#include "pos/db/Migrator.hpp"
#include "pos/db/migrations_generated.hpp"
#include "pos/handlers/Context.hpp"
#include "pos/ipc/StdioServer.hpp"

class ServiceFixture {
public:
    ServiceFixture() {
        static std::atomic<unsigned long long> sequence{0};
        const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
        directory_ = std::filesystem::temp_directory_path() /
                     ("maison-pos-service-" + std::to_string(tick) + "-" +
                      std::to_string(sequence.fetch_add(1)));
        std::filesystem::create_directories(directory_);
        databasePath_ = directory_ / "pos.db";
        database_.open(databasePath_.string());
        pos::db::Migrator migrator(database_);
        REQUIRE(migrator.migrate({}) == static_cast<int>(pos::db::kMigrations.size()));
        migrator.seedIfEmpty({});

        server_ = std::make_unique<pos::ipc::StdioServer>();
        context_ = std::make_shared<pos::handlers::Context>(*server_, database_);
        context_->session().authenticated = true;
        context_->session().userId = "usr-admin";
        context_->session().fullName = "System Administrator";
        context_->session().role = "administrator";
        context_->loadPermissions(context_->session(), "role-administrator");
        seedFloor();
    }

    ~ServiceFixture() {
        database_.close();
        std::error_code ec;
        std::filesystem::remove_all(directory_, ec);
    }

    pos::handlers::Context& ctx() { return *context_; }
    std::shared_ptr<pos::handlers::Context> contextPtr() { return context_; }
    pos::db::Database& db() { return database_; }
    pos::ipc::StdioServer& server() { return *server_; }

private:
    /**
     * A floor to put orders on.
     *
     * The reference seed deliberately ships no areas or tables - a venue draws
     * its own plan on first run - but the table and business-day tests need
     * somewhere for a bill to sit, and without it every insert trips
     * `orders.table_id`'s foreign key.
     */
    void seedFloor() {
        pos::db::Transaction txn(database_);
        database_.exec(
            "INSERT INTO restaurant_areas (id, name_az, name_tr, name_en, sort_order, active) "
            "VALUES ('area-salon', 'Zal', 'Salon', 'Hall', 1, 1), "
            "       ('area-vip', 'Kabinet', 'Kabinet', 'Private Room', 2, 1)");
        for (int seq = 1; seq <= 24; ++seq) {
            const std::string id = seq < 10 ? "tbl-0" + std::to_string(seq)
                                            : "tbl-" + std::to_string(seq);
            // Prepared per row: statements are cached by SQL text and only the
            // destructor clears the bindings.
            pos::db::Statement table = database_.prepare(
                "INSERT INTO restaurant_tables (id, area_id, label, seats, pos_x, pos_y, "
                "                               sort_order, updated_at) "
                "VALUES (:id, :area, :label, 4, :x, :y, :seq, 0)");
            table.bind(":id", id)
                .bind(":area", seq <= 16 ? "area-salon" : "area-vip")
                .bind(":label", std::to_string(seq))
                .bind(":x", static_cast<std::int64_t>((seq - 1) % 4))
                .bind(":y", static_cast<std::int64_t>((seq - 1) / 4))
                .bind(":seq", static_cast<std::int64_t>(seq));
            table.exec();
        }
        txn.commit();
    }

    std::filesystem::path directory_;
    std::filesystem::path databasePath_;
    pos::db::Database database_;
    std::unique_ptr<pos::ipc::StdioServer> server_;
    std::shared_ptr<pos::handlers::Context> context_;
};
