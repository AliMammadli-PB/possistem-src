#pragma once
// Private ops bridge. Main blocks this method from renderer IPC.
inline nlohmann::json customerBridge(db::Database &db,
                                     const nlohmann::json &p) {
  const auto action = p.value("action", std::string{});
  if (action == "export")
    return {{"customers", db.query(CUSTOMER_PROJECTION_SQL +
                                   std::string(" ORDER BY c.name"))},
            {"events",
             db.query("SELECT l.* FROM customer_ledger l LEFT JOIN "
                      "customer_bridge_acks a ON a.ledger_id=l.id WHERE "
                      "a.ledger_id IS NULL AND l.kind!='bridge_adjustment' "
                      "ORDER BY l.created_at,l.rowid LIMIT 1000")}};
  db.begin();
  try {
    if (action == "ack")
      for (const auto &id : p.at("ids"))
        db.execBound("INSERT OR IGNORE INTO customer_bridge_acks VALUES(?)",
                     {id.get<std::string>()});
    else if (action == "import")
      for (const auto &c : p.at("customers")) {
        const auto id = requireString(c, "id");
        db.execBound(
            "INSERT INTO "
            "customers(id,name,phone,credit_allowed,credit_limit_minor,active,"
            "created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "name=excluded.name,phone=excluded.phone,credit_allowed=excluded."
            "credit_allowed,credit_limit_minor=excluded.credit_limit_minor,"
            "active=excluded.active",
            {id, c.at("name").get<std::string>(),
             c.value("phone", std::string{}),
             c.value("creditAllowed", false) ? "1" : "0",
             std::to_string(c.value("creditLimitMinor", std::int64_t{0})),
             c.value("active", 1) ? "1" : "0", std::to_string(nowMs())});
        const auto pending =
            db.queryInt("SELECT COALESCE(SUM(l.amount_minor),0) FROM "
                        "customer_ledger l LEFT JOIN customer_bridge_acks a ON "
                        "a.ledger_id=l.id WHERE l.customer_id=? AND "
                        "a.ledger_id IS NULL AND l.kind!='bridge_adjustment'",
                        {id});
        const auto balance =
            db.queryInt("SELECT COALESCE((SELECT balance_after_minor FROM "
                        "customer_ledger WHERE customer_id=? ORDER BY "
                        "created_at DESC,rowid DESC LIMIT 1),0)",
                        {id});
        const auto target = c.value("debtMinor", std::int64_t{0}) + pending,
                   delta = target - balance;
        if (delta)
          db.execBound(
              "INSERT INTO "
              "customer_ledger(id,customer_id,kind,amount_minor,balance_after_"
              "minor,ref_type,ref_id,note,created_at,actor_id) "
              "VALUES(?,?,'bridge_adjustment',?,?,'ops_bridge','','Partnyor "
              "hesabı ilə uyğunlaşdırma',?,'system')",
              {newId("cb"), id, std::to_string(delta), std::to_string(target),
               std::to_string(nowMs())});
      }
    else
      throw PosError("E_VALIDATION", "Unknown customer bridge action");
    db.commit();
    return {{"ok", true}};
  } catch (...) {
    db.rollback();
    throw;
  }
}
