#include "pos/services/TableTransferService.hpp"

#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/protocol_generated.hpp"
#include "pos/services/BusinessDayService.hpp"
#include "pos/services/OrderService.hpp"
#include "pos/services/PaymentService.hpp"

namespace pos::services {

std::int64_t TableTransferService::tableVersion(const std::string& tableId) {
    auto stmt = ctx_.db().prepare("SELECT row_version FROM restaurant_tables WHERE id = :id");
    stmt.bind(":id", tableId);
    if (!stmt.step()) throw PosError::of(protocol::err::kTableNotFound);
    return stmt.columnInt(0);
}

void TableTransferService::bumpTable(const std::string& tableId, std::int64_t now) {
    auto bump = ctx_.db().prepare(
        "UPDATE restaurant_tables SET row_version = row_version + 1, updated_at = :now "
        "WHERE id = :id");
    bump.bind(":now", now).bind(":id", tableId);
    bump.exec();
}

Json TableTransferService::transferItems(const std::string& fromTableId,
                                         const std::string& toTableId,
                                         const std::vector<TransferItemSpec>& items,
                                         std::int64_t expectedFromVersion,
                                         std::int64_t expectedToVersion,
                                         const std::string& /*idempotencyKey*/) {
    if (fromTableId == toTableId) {
        throw PosError(std::string(protocol::err::kValidation),
                       "Source and destination tables must differ");
    }
    if (items.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "Select at least one item");
    }

    if (expectedFromVersion >= 0 && tableVersion(fromTableId) != expectedFromVersion) {
        throw PosError(std::string(protocol::err::kStaleVersion),
                       "Source table was modified by another operator");
    }
    if (expectedToVersion >= 0 && tableVersion(toTableId) != expectedToVersion) {
        throw PosError(std::string(protocol::err::kStaleVersion),
                       "Destination table was modified by another operator");
    }

    OrderService orders(ctx_);
    const std::string sourceOrderId = orders.openOrderIdForTable(fromTableId);
    if (sourceOrderId.empty()) throw PosError::of(protocol::err::kOrderNotFound);

    const auto now = nowMs();
    std::string targetOrderId = orders.openOrderIdForTable(toTableId);
    if (targetOrderId.empty()) {
        targetOrderId = crypto::uuid4();
        auto insert = ctx_.db().prepare(
            "INSERT INTO orders (id, order_number, table_id, user_id, shift_id, status, "
            "guest_count, business_day_id, opened_at, updated_at) "
            "VALUES (:id, :number, :tableId, :userId, :shiftId, 'open', 1, :day, :now, :now)");
        insert.bind(":id", targetOrderId)
            .bind(":number", orders.nextOrderNumber())
            .bind(":tableId", toTableId)
            .bind(":userId", ctx_.session().userId)
            .bindOptional(":shiftId", ctx_.session().shiftId)
            .bind(":day", BusinessDayService(ctx_).ensureOpenBusinessDayId())
            .bind(":now", now);
        insert.exec();
    }

    auto seqStmt = ctx_.db().prepare(
        "SELECT COALESCE(MAX(line_seq), 0) FROM order_items WHERE order_id = :orderId");
    seqStmt.bind(":orderId", targetOrderId);
    std::int64_t nextSeq = seqStmt.step() ? seqStmt.columnInt(0) : 0;

    const std::string transferGroup = crypto::uuid4();
    Json moved = Json::array();

    for (const auto& spec : items) {
        auto line = ctx_.db().prepare(
            "SELECT id, quantity, row_version, name_snapshot, unit_price_minor, "
            "product_id, course, note, seat, status, is_gift, gift_campaign_id, "
            "original_price_minor, modifier_total_minor, line_total_minor "
            "FROM order_items WHERE id = :id AND order_id = :orderId");
        line.bind(":id", spec.itemId).bind(":orderId", sourceOrderId);
        if (!line.step()) {
            throw PosError(std::string(protocol::err::kNotFound),
                           "Item does not belong to this table's order");
        }

        const std::int64_t qty = line.columnInt(1);
        const std::int64_t version = line.columnInt(2);
        if (spec.expectedVersion >= 0 && version != spec.expectedVersion) {
            throw PosError(std::string(protocol::err::kStaleVersion),
                           "Order item was modified by another operator");
        }

        const std::int64_t moveQty =
            (spec.quantity <= 0 || spec.quantity >= qty) ? qty : spec.quantity;
        if (moveQty <= 0 || moveQty > qty) {
            throw PosError(std::string(protocol::err::kValidation), "Invalid transfer quantity");
        }

        if (moveQty == qty) {
            auto move = ctx_.db().prepare(
                "UPDATE order_items SET order_id = :target, line_seq = :seq, "
                "transfer_group_id = :tg, updated_at = :now, row_version = row_version + 1 "
                "WHERE id = :id");
            move.bind(":target", targetOrderId)
                .bind(":seq", ++nextSeq)
                .bind(":tg", transferGroup)
                .bind(":now", now)
                .bind(":id", spec.itemId);
            move.exec();

            auto moveJob = ctx_.db().prepare(
                "UPDATE kitchen_jobs SET order_id = :target WHERE order_item_id = :itemId");
            moveJob.bind(":target", targetOrderId).bind(":itemId", spec.itemId);
            moveJob.exec();
            moved.push_back(Json{{"itemId", spec.itemId}, {"quantity", moveQty}, {"mode", "full"}});
        } else {
            // Partial: reduce source qty; clone moved portion with modifiers; do not
            // duplicate kitchen jobs (kitchen already has the original ticket).
            const Money unitPrice = line.columnInt(4);
            const Money modTotal = line.columnInt(13);
            const Money newLineTotal = (unitPrice + modTotal) * moveQty;
            const Money remainQty = qty - moveQty;
            const Money remainLineTotal = (unitPrice + modTotal) * remainQty;

            auto reduce = ctx_.db().prepare(
                "UPDATE order_items SET quantity = :qty, line_total_minor = :lineTotal, "
                "updated_at = :now, row_version = row_version + 1 WHERE id = :id");
            reduce.bind(":qty", remainQty)
                .bind(":lineTotal", remainLineTotal)
                .bind(":now", now)
                .bind(":id", spec.itemId);
            reduce.exec();

            const std::string newId = crypto::uuid4();
            auto clone = ctx_.db().prepare(
                "INSERT INTO order_items ("
                "  id, order_id, product_id, line_seq, name_snapshot, unit_price_minor, quantity, "
                "  modifier_total_minor, line_total_minor, course, note, seat, status, "
                "  origin_item_id, transfer_group_id, is_gift, gift_campaign_id, "
                "  original_price_minor, created_at, updated_at, row_version"
                ") VALUES ("
                "  :id, :orderId, :productId, :seq, :name, :price, :qty, :modTotal, :lineTotal, "
                "  :course, :note, :seat, :status, :origin, :tg, :gift, :campaign, :origPrice, "
                "  :now, :now, 1)");
            clone.bind(":id", newId)
                .bind(":orderId", targetOrderId)
                .bind(":productId", line.columnText(5))
                .bind(":seq", ++nextSeq)
                .bind(":name", line.columnText(3))
                .bind(":price", unitPrice)
                .bind(":qty", moveQty)
                .bind(":modTotal", modTotal)
                .bind(":lineTotal", newLineTotal)
                .bindOptional(":course", line.columnText(6))
                .bind(":note", line.columnText(7))
                .bind(":seat", line.columnInt(8))
                .bind(":status", line.columnText(9))
                .bind(":origin", spec.itemId)
                .bind(":tg", transferGroup)
                .bind(":gift", line.columnInt(10))
                .bindOptional(":campaign", line.columnText(11))
                .bind(":origPrice", line.columnInt(12))
                .bind(":now", now);
            clone.exec();

            auto mods = ctx_.db().prepare(
                "SELECT modifier_id, group_name_snapshot, name_snapshot, price_delta_minor "
                "FROM order_item_modifiers WHERE order_item_id = :id");
            mods.bind(":id", spec.itemId);
            while (mods.step()) {
                auto ins = ctx_.db().prepare(
                    "INSERT INTO order_item_modifiers "
                    "(id, order_item_id, modifier_id, group_name_snapshot, name_snapshot, "
                    "price_delta_minor) "
                    "VALUES (:id, :item, :mod, :group, :name, :delta)");
                ins.bind(":id", crypto::uuid4())
                    .bind(":item", newId)
                    .bind(":mod", mods.columnText(0))
                    .bind(":group", mods.columnText(1))
                    .bind(":name", mods.columnText(2))
                    .bind(":delta", mods.columnInt(3));
                ins.exec();
            }

            moved.push_back(
                Json{{"itemId", spec.itemId}, {"newItemId", newId}, {"quantity", moveQty}, {"mode", "partial"}});
        }
    }

    orders.recalculate(sourceOrderId);
    orders.recalculate(targetOrderId);
    orders.refreshTableStatus(fromTableId);
    orders.refreshTableStatus(toTableId);
    bumpTable(fromTableId, now);
    bumpTable(toTableId, now);

    auto evt = ctx_.db().prepare(
        "INSERT INTO table_transfer_events ("
        "  id, operation, source_table_id, target_table_id, source_order_id, target_order_id, "
        "  actor_user_id, request_json, result_json, source_row_version, target_row_version, "
        "  created_at"
        ") VALUES ("
        "  :id, 'item_transfer', :from, :to, :sord, :tord, :actor, :req, :res, :sv, :tv, :now)");
    evt.bind(":id", crypto::uuid4())
        .bind(":from", fromTableId)
        .bind(":to", toTableId)
        .bind(":sord", sourceOrderId)
        .bind(":tord", targetOrderId)
        .bindOptional(":actor", ctx_.session().userId)
        .bind(":req", Json{{"items", moved}}.dump())
        .bind(":res", Json{{"transferGroupId", transferGroup}}.dump())
        .bind(":sv", expectedFromVersion)
        .bind(":tv", expectedToVersion)
        .bind(":now", now);
    evt.exec();

    ctx_.auditRequired("table.transferItems", "order", sourceOrderId,
                       Json{{"toTable", toTableId}, {"moved", moved}});

    return Json{{"sourceOrder", orders.load(sourceOrderId)},
                {"targetOrder", orders.load(targetOrderId)},
                {"transferGroupId", transferGroup},
                {"moved", moved}};
}

Json TableTransferService::mergeTables(const std::string& targetTableId,
                                       const std::vector<std::string>& sourceTableIds,
                                       std::int64_t expectedFromVersion,
                                       std::int64_t expectedToVersion,
                                       const std::string& idempotencyKey) {
    if (targetTableId.empty()) {
        throw PosError(std::string(protocol::err::kValidation), "targetTableId is required");
    }
    if (sourceTableIds.empty()) {
        throw PosError(std::string(protocol::err::kValidation),
                       "Select at least one table to merge");
    }

    if (expectedToVersion >= 0 && tableVersion(targetTableId) != expectedToVersion) {
        throw PosError(std::string(protocol::err::kStaleVersion),
                       "Destination table was modified by another operator");
    }
    // The floor map only ever drags one table at a time, so a single expected
    // version is unambiguous. With several sources there is nothing to compare
    // it against and the check is skipped rather than applied to the wrong row.
    if (expectedFromVersion >= 0 && sourceTableIds.size() == 1 &&
        tableVersion(sourceTableIds.front()) != expectedFromVersion) {
        throw PosError(std::string(protocol::err::kStaleVersion),
                       "Source table was modified by another operator");
    }

    OrderService orders(ctx_);
    BusinessDayService days(ctx_);

    const std::string targetOrderId = orders.openOrderIdForTable(targetTableId);
    if (targetOrderId.empty()) {
        throw PosError(std::string(protocol::err::kOrderNotFound),
                       "The destination table has no open order");
    }

    {
        auto dayStmt = ctx_.db().prepare("SELECT business_day_id FROM orders WHERE id = :id");
        dayStmt.bind(":id", targetOrderId);
        if (dayStmt.step() && !dayStmt.columnIsNull(0)) {
            days.assertMutableBusinessDay(dayStmt.columnText(0));
        }
    }

    const auto now = nowMs();

    auto seqStmt = ctx_.db().prepare(
        "SELECT COALESCE(MAX(line_seq), 0) FROM order_items WHERE order_id = :orderId");
    seqStmt.bind(":orderId", targetOrderId);
    std::int64_t nextSeq = seqStmt.step() ? seqStmt.columnInt(0) : 0;

    Json mergedFrom = Json::array();
    std::vector<std::string> touched{targetTableId};
    Money movedPaymentsTotal = 0;
    bool firstEvent = true;

    for (const auto& sourceTableId : sourceTableIds) {
        if (sourceTableId == targetTableId) continue;

        const std::string sourceOrderId = orders.openOrderIdForTable(sourceTableId);
        if (sourceOrderId.empty()) continue;

        const std::int64_t sourceVersion = tableVersion(sourceTableId);

        // Snapshot before mutating, for the audit trail and the cover count.
        std::int64_t sourceGuests = 0;
        std::string droppedDiscountType;
        std::int64_t droppedDiscountValue = 0;
        {
            auto snap = ctx_.db().prepare(
                "SELECT guest_count, COALESCE(discount_type, ''), discount_value "
                "FROM orders WHERE id = :id");
            snap.bind(":id", sourceOrderId);
            if (snap.step()) {
                sourceGuests = snap.columnInt(0);
                droppedDiscountType = snap.columnText(1);
                droppedDiscountValue = snap.columnInt(2);
            }
        }

        // Ids are collected before renumbering: rewriting line_seq while walking
        // a live cursor over the same table trips UNIQUE(order_id, line_seq).
        std::vector<std::string> itemIds;
        {
            auto items = ctx_.db().prepare(
                "SELECT id FROM order_items WHERE order_id = :orderId ORDER BY line_seq");
            items.bind(":orderId", sourceOrderId);
            while (items.step()) itemIds.push_back(items.columnText(0));
        }

        for (const auto& itemId : itemIds) {
            auto move = ctx_.db().prepare(
                "UPDATE order_items SET order_id = :target, line_seq = :seq, updated_at = :now, "
                "       row_version = row_version + 1 WHERE id = :itemId");
            move.bind(":target", targetOrderId)
                .bind(":seq", ++nextSeq)
                .bind(":now", now)
                .bind(":itemId", itemId);
            move.exec();
        }

        auto moveJobs = ctx_.db().prepare(
            "UPDATE kitchen_jobs SET order_id = :target WHERE order_id = :source");
        moveJobs.bind(":target", targetOrderId).bind(":source", sourceOrderId);
        moveJobs.exec();

        auto moveGifts = ctx_.db().prepare(
            "UPDATE order_gifts SET order_id = :target, updated_at = :now WHERE order_id = :source");
        moveGifts.bind(":target", targetOrderId).bind(":now", now).bind(":source", sourceOrderId);
        moveGifts.exec();

        // The money follows the bill. Without this the payments stay stranded on
        // the emptied order and the guest is asked to pay twice.
        Money movedPayments = 0;
        {
            auto taken = ctx_.db().prepare(
                "SELECT COALESCE(SUM(amount_minor), 0) FROM payments "
                "WHERE order_id = :source AND status = 'approved'");
            taken.bind(":source", sourceOrderId);
            if (taken.step()) movedPayments = taken.columnInt(0);
        }

        auto movePayments = ctx_.db().prepare(
            "UPDATE payments SET order_id = :target, updated_at = :now WHERE order_id = :source");
        movePayments.bind(":target", targetOrderId).bind(":now", now).bind(":source", sourceOrderId);
        movePayments.exec();

        // Refunds must travel with their payment, or outstanding() credits a
        // reversal to a bill that no longer holds the original charge.
        auto moveRefunds = ctx_.db().prepare(
            "UPDATE refunds SET order_id = :target, updated_at = :now WHERE order_id = :source");
        moveRefunds.bind(":target", targetOrderId).bind(":now", now).bind(":source", sourceOrderId);
        moveRefunds.exec();

        // Any half-finished split on the source now references payments owned by
        // a different order, so it cannot be settled and is cancelled.
        auto cancelSplits = ctx_.db().prepare(
            "UPDATE bill_splits SET status = 'canceled', updated_at = :now "
            "WHERE order_id = :source AND status IN ('open','partial')");
        cancelSplits.bind(":now", now).bind(":source", sourceOrderId);
        cancelSplits.exec();

        // The source keeps no discount: its totals are about to become zero and
        // a percentage against nothing is meaningless. Recorded in the event so
        // staff can re-apply it on the merged bill.
        auto clearDiscount = ctx_.db().prepare(
            "UPDATE orders SET discount_type = NULL, discount_value = 0, discount_reason = '' "
            "WHERE id = :id");
        clearDiscount.bind(":id", sourceOrderId);
        clearDiscount.exec();

        // The call the old merge was missing. Everything has moved away, so this
        // writes zeros - which is what stops reports counting the bill twice.
        orders.recalculate(sourceOrderId);

        {
            auto verify = ctx_.db().prepare(
                "SELECT total_minor, paid_minor FROM orders WHERE id = :id");
            verify.bind(":id", sourceOrderId);
            if (!verify.step()) throw PosError::of(protocol::err::kOrderNotFound);
            if (verify.columnInt(0) != 0 || verify.columnInt(1) != 0) {
                // Something did not move. Closing a bill that still owes money
                // would lose it, so fail and let the transaction roll back.
                throw PosError(std::string(protocol::err::kInternal),
                               "Merge left a balance on the source order");
            }
        }

        auto closeSource = ctx_.db().prepare(
            "UPDATE orders SET status = 'closed', closed_at = :now, updated_at = :now, "
            "       row_version = row_version + 1, "
            "       note = CASE WHEN note = '' THEN :mergedNote "
            "                   ELSE note || ' | ' || :mergedNote END "
            "WHERE id = :id");
        closeSource.bind(":now", now)
            .bind(":mergedNote", "Merged into " + targetTableId)
            .bind(":id", sourceOrderId);
        closeSource.exec();

        // 4 guests + 4 guests is one party of 8 on the surviving bill.
        if (sourceGuests > 0) {
            auto addGuests = ctx_.db().prepare(
                "UPDATE orders SET guest_count = guest_count + :guests WHERE id = :id");
            addGuests.bind(":guests", sourceGuests).bind(":id", targetOrderId);
            addGuests.exec();
        }

        orders.logEvent(sourceOrderId, "order.merged_out",
                        Json{{"toOrder", targetOrderId},
                             {"toTable", targetTableId},
                             {"movedItems", static_cast<std::int64_t>(itemIds.size())},
                             {"movedPaymentsMinor", movedPayments},
                             {"guestCount", sourceGuests}});
        orders.logEvent(targetOrderId, "order.merged_in",
                        Json{{"fromOrder", sourceOrderId},
                             {"fromTable", sourceTableId},
                             {"movedItems", static_cast<std::int64_t>(itemIds.size())},
                             {"movedPaymentsMinor", movedPayments}});

        // A table that was itself a merge target must not leave its own children
        // pointing at a bill that has just been folded away.
        auto reparent = ctx_.db().prepare(
            "UPDATE restaurant_tables SET merged_into_id = :target, updated_at = :now "
            "WHERE merged_into_id = :source");
        reparent.bind(":target", targetTableId).bind(":now", now).bind(":source", sourceTableId);
        reparent.exec();

        // Derive the freed table's status rather than hardcoding 'available',
        // so it goes through the one function that owns table status.
        orders.refreshTableStatus(sourceTableId);

        // Set after the refresh: refreshTableStatus would otherwise clear it.
        auto flag = ctx_.db().prepare(
            "UPDATE restaurant_tables SET merged_into_id = :target, updated_at = :now, "
            "       row_version = row_version + 1 WHERE id = :id");
        flag.bind(":target", targetTableId).bind(":now", now).bind(":id", sourceTableId);
        flag.exec();

        auto evt = ctx_.db().prepare(
            "INSERT INTO table_transfer_events ("
            "  id, operation, source_table_id, target_table_id, source_order_id, target_order_id, "
            "  actor_user_id, idempotency_key, request_json, result_json, "
            "  source_row_version, target_row_version, created_at"
            ") VALUES ("
            "  :id, 'merge', :from, :to, :sord, :tord, :actor, :key, :req, :res, :sv, :tv, :now)");
        evt.bind(":id", crypto::uuid4())
            .bind(":from", sourceTableId)
            .bind(":to", targetTableId)
            .bind(":sord", sourceOrderId)
            .bind(":tord", targetOrderId)
            .bindOptional(":actor", ctx_.session().userId)
            // The column is UNIQUE, so only the first source can carry the key.
            .bindOptional(":key", firstEvent ? idempotencyKey : std::string())
            .bind(":req", serialize(Json{{"sourceTableId", sourceTableId},
                                         {"targetTableId", targetTableId}}))
            .bind(":res", serialize(Json{{"movedItems",
                                          static_cast<std::int64_t>(itemIds.size())},
                                         {"movedPaymentsMinor", movedPayments},
                                         {"guestCount", sourceGuests},
                                         {"droppedDiscountType", droppedDiscountType},
                                         {"droppedDiscountValue", droppedDiscountValue}}))
            .bind(":sv", sourceVersion)
            .bind(":tv", expectedToVersion)
            .bind(":now", now);
        evt.exec();
        firstEvent = false;

        movedPaymentsTotal += movedPayments;
        touched.push_back(sourceTableId);
        mergedFrom.push_back(Json{{"tableId", sourceTableId},
                                  {"orderId", sourceOrderId},
                                  {"movedItems", static_cast<std::int64_t>(itemIds.size())},
                                  {"movedPaymentsMinor", movedPayments},
                                  {"guestCount", sourceGuests}});
    }

    if (mergedFrom.empty()) {
        throw PosError(std::string(protocol::err::kOrderNotFound),
                       "None of the selected tables has an open bill");
    }

    // Recompute after every payment has arrived, then let the payment status
    // catch up: moved money may already cover the combined bill in full.
    orders.recalculate(targetOrderId);
    PaymentService(ctx_).refreshOrderPaymentStatus(targetOrderId);
    orders.refreshTableStatus(targetTableId);

    auto bumpTargetOrder = ctx_.db().prepare(
        "UPDATE orders SET row_version = row_version + 1, updated_at = :now WHERE id = :id");
    bumpTargetOrder.bind(":now", now).bind(":id", targetOrderId);
    bumpTargetOrder.exec();

    bumpTable(targetTableId, now);

    ctx_.auditRequired("table.merge", "order", targetOrderId,
                       Json{{"targetTable", targetTableId},
                            {"mergedFrom", mergedFrom},
                            {"movedPaymentsMinor", movedPaymentsTotal}});

    return Json{{"order", orders.load(targetOrderId)},
                {"mergedFrom", mergedFrom},
                {"movedPaymentsMinor", movedPaymentsTotal},
                {"touchedTableIds", touched}};
}

}  // namespace pos::services
