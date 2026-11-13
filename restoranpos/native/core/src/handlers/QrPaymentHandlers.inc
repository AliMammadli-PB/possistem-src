// Private sidecar operations. They are intentionally absent from the renderer
// method registry; only the main-process QR coordinator/signed command driver
// calls them.
namespace {
std::string qrHmac(const std::string &keyHex, const std::string &message) {
  auto k = crypto::fromHex(keyHex);
  require(k.size() == 32, "QR secret is invalid");
  std::string inner(64, '\x36'), outer(64, '\x5c');
  for (size_t i = 0; i < k.size(); i++) {
    inner[i] = char(k[i] ^ 0x36);
    outer[i] = char(k[i] ^ 0x5c);
  }
  auto digest = crypto::fromHex(crypto::sha256Hex(inner + message));
  return crypto::sha256Hex(outer + std::string(digest.begin(), digest.end()));
}
void qrSchema(Context &c) {
  db::Transaction schemaTransaction(c.db());
  c.db().exec(R"SQL(
 CREATE TABLE IF NOT EXISTS qr_payment_sessions(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),secret TEXT NOT NULL,revision TEXT NOT NULL,snapshot_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',business_day_id TEXT NOT NULL,cashier_id TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS qr_payment_one_open ON qr_payment_sessions(order_id) WHERE state='open';
 CREATE TABLE IF NOT EXISTS qr_payment_holds(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES qr_payment_sessions(id),amount_minor INTEGER NOT NULL CHECK(amount_minor>0),status TEXT NOT NULL CHECK(status IN('held','applied','released')),provider_transaction TEXT UNIQUE,payment_id TEXT,created_at INTEGER NOT NULL);
 )SQL");
  bool column = false;
  {
    auto s = c.db().prepare("PRAGMA table_info(payments)");
    while (s.step())
      if (s.columnText(1) == "qr_payment_id")
        column = true;
  }
  if (!column)
    c.db().exec("ALTER TABLE payments ADD COLUMN qr_payment_id TEXT");
  c.db().exec(R"SQL(
 CREATE UNIQUE INDEX IF NOT EXISTS payments_qr_intent ON payments(qr_payment_id) WHERE qr_payment_id IS NOT NULL;
 CREATE TRIGGER IF NOT EXISTS qr_lock_item_insert BEFORE INSERT ON order_items WHEN EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=NEW.order_id AND state='open') BEGIN SELECT RAISE(ABORT,'QR payment is open. Stop QR payments before editing this bill.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_item_update BEFORE UPDATE ON order_items WHEN EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=OLD.order_id AND state='open') BEGIN SELECT RAISE(ABORT,'QR payment is open. Stop QR payments before editing this bill.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_item_delete BEFORE DELETE ON order_items WHEN EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=OLD.order_id AND state='open') BEGIN SELECT RAISE(ABORT,'QR payment is open. Stop QR payments before editing this bill.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_payment BEFORE INSERT ON payments WHEN NEW.qr_payment_id IS NULL AND EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=NEW.order_id AND state='open') BEGIN SELECT RAISE(ABORT,'QR payment is open. Check pending online payments first.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_payment_update BEFORE UPDATE ON payments WHEN EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=OLD.order_id AND state='open') AND (NEW.amount_minor<>OLD.amount_minor OR NEW.order_id<>OLD.order_id OR OLD.status='approved' AND NEW.status<>'approved') BEGIN SELECT RAISE(ABORT,'Stop QR payments before changing a payment.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_payment_delete BEFORE DELETE ON payments WHEN EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=OLD.order_id AND state='open') BEGIN SELECT RAISE(ABORT,'Stop QR payments before deleting a payment.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_bill BEFORE UPDATE ON orders WHEN EXISTS(SELECT 1 FROM qr_payment_sessions WHERE order_id=OLD.id AND state='open') AND (NEW.total_minor<>OLD.total_minor OR NEW.discount_minor<>OLD.discount_minor OR NEW.service_minor<>OLD.service_minor OR NEW.discount_value<>OLD.discount_value OR COALESCE(NEW.discount_type,'')<>COALESCE(OLD.discount_type,'') OR NEW.deposit_minor<>OLD.deposit_minor OR NEW.prepaid_deposit_minor<>OLD.prepaid_deposit_minor OR NEW.minimum_table_minor<>OLD.minimum_table_minor OR NEW.status='voided' OR COALESCE(NEW.table_id,'')<>COALESCE(OLD.table_id,'')) BEGIN SELECT RAISE(ABORT,'QR payment is open. Bill changes are locked.');END;
 CREATE TRIGGER IF NOT EXISTS qr_lock_day BEFORE UPDATE ON business_days WHEN NEW.status='closed' AND EXISTS(SELECT 1 FROM qr_payment_sessions WHERE business_day_id=OLD.id AND state='open') BEGIN SELECT RAISE(ABORT,'Stop or settle open QR payments before closing the business day.');END;
 )SQL");
  schemaTransaction.commit();
}
Json qrSession(Context &c, const std::string &id) {
  auto s = c.db().prepare("SELECT * FROM qr_payment_sessions WHERE id=:id");
  s.bind(":id", id);
  require(s.step(), "QR payment session not found");
  return s.row();
}
void qrProof(const Json &row, const Json &p, const std::string &action) {
  const auto sid = getOr<std::string>(p, "sessionId", ""),
             id = getOr<std::string>(p, "intentId", ""),
             txn = getOr<std::string>(p, "transaction", ""),
             rrn = getOr<std::string>(p, "rrn", "");
  const auto amount = getOr<Money>(p, "amountMinor", 0),
             expiry = getOr<std::int64_t>(p, "expiresAt", 0);
  require(id.size() == 36 && amount > 0 && txn.find('|') == std::string::npos &&
              rrn.find('|') == std::string::npos && txn.size() < 150,
          "QR payment proof is malformed");
  require(expiry >= nowMs() && expiry <= nowMs() + 120000,
          "QR payment proof expired");
  const auto text = action + "|" + sid + "|" + id + "|" +
                    std::to_string(amount) + "|" + txn + "|" + rrn + "|" +
                    std::to_string(expiry),
             expected = qrHmac(row.at("secret").get<std::string>(), text),
             got = getOr<std::string>(p, "signature", "");
  unsigned diff = unsigned(expected.size() ^ got.size());
  for (size_t i = 0; i < expected.size(); i++)
    diff |= unsigned(expected[i] ^ (i < got.size() ? got[i] : 0));
  require(diff == 0, "QR payment proof is invalid");
}
} // namespace
void registerQrPayments(const ContextPtr &ctx) {
  qrSchema(*ctx);
  ctx->server().registerHandler("qrPay.begin", [ctx](const ipc::Request
                                                         &request) {
    ctx->requirePermission("payment.take");
    services::LicenseService(*ctx).requirePaidForSale();
    services::BusinessDayService(*ctx).requireOpenTill();
    require(
        ctx->settingInt("sunmi.activatedAt", 0) <= 0,
        "QR payments on a SUNMI fiscal till require a certified multi-payment "
        "receipt integration. They are not enabled on this till.");
    const auto orderId = getOr<std::string>(request.payload, "orderId", "");
    db::Transaction tx(ctx->db());
    services::OrderService orders(*ctx);
    orders.recalculate(orderId);
    auto order = orders.load(orderId);
    require(order.value("status", std::string{}) != "closed" &&
                order.value("status", std::string{}) != "voided",
            "This bill is closed");
    require(services::PaymentService(*ctx).unresolvedCount(orderId) == 0,
            "Resolve the previous terminal payment first");
    const auto remaining = services::PaymentService(*ctx).outstanding(orderId);
    require(remaining > 0 && !order.value("tableId", std::string{}).empty(),
            "An open table bill is required");
    auto existing = ctx->db().prepare("SELECT id FROM qr_payment_sessions "
                                      "WHERE order_id=:id AND state='open'");
    existing.bind(":id", orderId);
    if (existing.step()) {
      auto row = qrSession(*ctx, existing.columnText(0));
      tx.commit();
      return Json{
          {"sessionId", row["id"]},
          {"secret", row["secret"]},
          {"snapshot", Json::parse(row["snapshot_json"].get<std::string>())}};
    }
    Json lines = Json::array();
    for (const auto &l : order["items"]) {
      if (l.value("status", std::string{}) == "voided" ||
          l.value("complimentary", 0) != 0)
        continue;
      const auto quantity = static_cast<std::int64_t>(
          std::llround(l.value("quantity", 0.0) * 1000));
      if (quantity > 0)
        lines.push_back(Json{{"id", l["id"]},
                             {"name", l["name"]},
                             {"quantityMilli", quantity},
                             {"amountMinor", l["lineTotalMinor"]}});
    }
    const auto sid = crypto::uuid4(),
               secret = crypto::toHex(crypto::randomBytes(32));
    Json snapshot = {
        {"orderId", orderId},
        {"orderNumber", order["orderNumber"]},
        {"tableId", order["tableId"]},
        {"tableLabel", order["tableLabel"]},
        {"totalMinor", order["totalMinor"]},
        {"paidMinor", order.value("totalMinor", Money{0}) - remaining},
        {"lines", lines}};
    snapshot["revision"] = crypto::sha256Hex(serialize(snapshot));
    const auto day = resolveBusinessDay(*ctx, orderId);
    auto insert = ctx->db().prepare(
        "INSERT INTO "
        "qr_payment_sessions(id,order_id,secret,revision,snapshot_json,"
        "business_day_id,cashier_id,created_at) "
        "VALUES(:id,:order,:secret,:revision,:snapshot,:day,:cashier,:now)");
    insert.bind(":id", sid)
        .bind(":order", orderId)
        .bind(":secret", secret)
        .bind(":revision", snapshot["revision"].get<std::string>())
        .bind(":snapshot", serialize(snapshot))
        .bind(":day", day)
        .bind(":cashier", ctx->session().userId)
        .bind(":now", nowMs());
    insert.exec();
    ctx->auditRequired("qr.payment.open", "order", orderId,
                       Json{{"sessionId", sid}});
    tx.commit();
    return Json{{"sessionId", sid}, {"secret", secret}, {"snapshot", snapshot}};
  });
  ctx->server().registerHandler("qrPay.hold", [ctx](
                                                  const ipc::Request &request) {
    const auto p = request.payload;
    const auto sid = getOr<std::string>(p, "sessionId", ""),
               id = getOr<std::string>(p, "intentId", "");
    const auto amount = getOr<Money>(p, "amountMinor", 0);
    db::Transaction tx(ctx->db());
    auto session = qrSession(*ctx, sid);
    qrProof(session, p, "hold");
    require(session["state"] == "open", "QR payment session closed");
    auto old = ctx->db().prepare("SELECT session_id,amount_minor,status FROM "
                                 "qr_payment_holds WHERE id=:id");
    old.bind(":id", id);
    if (old.step()) {
      require(old.columnText(0) == sid && old.columnInt(1) == amount,
              "QR hold does not match");
      require(old.columnText(2) != "released", "QR hold was released");
      tx.commit();
      return Json{{"held", true}};
    }
    auto sum = ctx->db().prepare(
        "SELECT COALESCE(sum(amount_minor),0) FROM qr_payment_holds WHERE "
        "session_id=:id AND status='held'");
    sum.bind(":id", sid);
    sum.step();
    require(amount <= services::PaymentService(*ctx).outstanding(
                          session["order_id"].get<std::string>()) -
                          sum.columnInt(0),
            "QR amount exceeds remaining bill");
    auto i =
        ctx->db().prepare("INSERT INTO "
                          "qr_payment_holds(id,session_id,amount_minor,status,"
                          "created_at) VALUES(:id,:sid,:amount,'held',:now)");
    i.bind(":id", id)
        .bind(":sid", sid)
        .bind(":amount", amount)
        .bind(":now", nowMs());
    i.exec();
    tx.commit();
    return Json{{"held", true}};
  });
  ctx->server().registerHandler(
      "qrPay.release", [ctx](const ipc::Request &request) {
        const auto p = request.payload;
        const auto sid = getOr<std::string>(p, "sessionId", ""),
                   id = getOr<std::string>(p, "intentId", "");
        db::Transaction tx(ctx->db());
        auto session = qrSession(*ctx, sid);
        qrProof(session, p, "release");
        auto old = ctx->db().prepare("SELECT amount_minor,status,session_id "
                                     "FROM qr_payment_holds WHERE id=:id");
        old.bind(":id", id);
        if (old.step())
          require(old.columnInt(0) == getOr<Money>(p, "amountMinor", 0) &&
                      old.columnText(1) != "applied" &&
                      old.columnText(2) == sid,
                  "QR hold release does not match");
        auto s = ctx->db().prepare(
            "UPDATE qr_payment_holds SET status='released' WHERE id=:id AND "
            "session_id=:sid AND status='held' AND amount_minor=:amount");
        s.bind(":id", id)
            .bind(":sid", sid)
            .bind(":amount", getOr<Money>(p, "amountMinor", 0));
        s.exec();
        tx.commit();
        return Json{{"released", true}};
      });
  ctx->server().registerHandler("qrPay.apply", [ctx](const ipc::Request
                                                         &request) {
    const auto p = request.payload;
    const auto sid = getOr<std::string>(p, "sessionId", ""),
               id = getOr<std::string>(p, "intentId", ""),
               txn = getOr<std::string>(p, "transaction", "");
    const auto amount = getOr<Money>(p, "amountMinor", 0);
    require(!txn.empty(), "Bank transaction is required");
    std::string orderId, paymentId;
    {
      db::Transaction tx(ctx->db());
      auto session = qrSession(*ctx, sid);
      qrProof(session, p, "apply");
      orderId = session["order_id"].get<std::string>();
      auto hold = ctx->db().prepare(
          "SELECT * FROM qr_payment_holds WHERE id=:id AND session_id=:sid");
      hold.bind(":id", id).bind(":sid", sid);
      require(hold.step(), "QR hold not found");
      const auto h = hold.row();
      require(h["amount_minor"].get<Money>() == amount,
              "QR payment amount changed");
      if (h["status"] == "applied") {
        require(h["provider_transaction"] == txn,
                "Bank transaction does not match");
        tx.commit();
        return Json{{"applied", true}, {"paymentId", h["payment_id"]}};
      }
      require(h["status"] == "held" && session["state"] == "open",
              "QR payment cannot be applied");
      require(
          ctx->settingInt("sunmi.activatedAt", 0) <= 0,
          "Fiscal integration requires review before applying this QR payment");
      require(services::PaymentService(*ctx).outstanding(orderId) >= amount,
              "QR payment requires reconciliation");
      // Link the future payment first so the guard trigger permits only this
      // held id.
      paymentId = crypto::uuid4();
      const auto now = nowMs();
      auto i = ctx->db().prepare(
          "INSERT INTO "
          "payments(id,order_id,method,status,amount_minor,tip_minor,tendered_"
          "minor,change_minor,idempotency_key,user_id,business_day_id,created_"
          "at,updated_at,terminal_id,qr_payment_id) "
          "VALUES(:id,:order,'card','created',:amount,0,:amount,0,:key,:user,:"
          "day,:now,:now,:terminal,:intent)");
      i.bind(":id", paymentId)
          .bind(":order", orderId)
          .bind(":amount", amount)
          .bind(":key", "qr:" + id)
          .bind(":user", session["cashier_id"].get<std::string>())
          .bind(":day", session["business_day_id"].get<std::string>())
          .bind(":now", now)
          .bind(":terminal", ctx->saleTerminalId())
          .bind(":intent", id);
      i.exec();
      services::PaymentService payments(*ctx);
      payments.applyTransition(paymentId, PaymentStatus::Approved,
                               "Verified Epoint QR payment", txn);
      auto u = ctx->db().prepare("UPDATE qr_payment_holds SET "
                                 "status='applied',provider_transaction=:txn,"
                                 "payment_id=:payment WHERE id=:id");
      u.bind(":txn", txn).bind(":payment", paymentId).bind(":id", id);
      u.exec();
      if (payments.outstanding(orderId) == 0) {
        auto done = ctx->db().prepare(
            "UPDATE qr_payment_sessions SET state='closed' WHERE id=:id");
        done.bind(":id", sid);
        done.exec();
      }
      payments.refreshOrderPaymentStatus(orderId);
      queueReceiptIfSettled(*ctx, orderId);
      ctx->auditRequired("qr.payment.approved", "payment", paymentId,
                         Json{{"orderId", orderId},
                              {"intentId", id},
                              {"transaction", txn},
                              {"amountMinor", amount}});
      ctx->enqueueSync("payment", paymentId, "create",
                       Json{{"method", "card"}, {"source", "qr"}});
      tx.commit();
    }
    drainPrintQueue(*ctx);
    ctx->server().emitEvent(protocol::event::kOrdersUpdated,
                            Json{{"orderIds", {orderId}}});
    return Json{{"applied", true}, {"paymentId", paymentId}};
  });
  ctx->server().registerHandler(
      "qrPay.inspect", [ctx](const ipc::Request &request) {
        ctx->requirePermission("payment.take");
        auto q = ctx->db().prepare("SELECT id,state FROM qr_payment_sessions "
                                   "WHERE order_id=:id AND state='open'");
        q.bind(":id", getOr<std::string>(request.payload, "orderId", ""));
        if (!q.step())
          return Json{{"sessionId", nullptr}};
        return Json{{"sessionId", q.columnText(0)}, {"state", q.columnText(1)}};
      });
  ctx->server().registerHandler("qrPay.stop", [ctx](
                                                  const ipc::Request &request) {
    ctx->requirePermission("payment.take");
    db::Transaction tx(ctx->db());
    const auto sid = getOr<std::string>(request.payload, "sessionId", "");
    auto session = qrSession(*ctx, sid);
    auto n = ctx->db().prepare("SELECT count(*) FROM qr_payment_holds WHERE "
                               "session_id=:id AND status='held'");
    n.bind(":id", sid);
    n.step();
    require(n.columnInt(0) == 0, "QR payment is pending. Check the bank result "
                                 "before stopping QR payments.");
    auto u =
        ctx->db().prepare("UPDATE qr_payment_sessions SET state='cancelled' "
                          "WHERE id=:id AND state='open'");
    u.bind(":id", sid);
    u.exec();
    ctx->auditRequired("qr.payment.stop", "order",
                       session["order_id"].get<std::string>(),
                       Json{{"sessionId", sid}});
    tx.commit();
    return Json{{"stopped", true}};
  });
}
