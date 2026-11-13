#include "ServiceFixture.hpp"
#include "pos/Crypto.hpp"
#include "pos/Error.hpp"
#include "pos/handlers/Handlers.hpp"
#include "pos/services/InventoryService.hpp"
namespace {
class QrPaymentFixture {
public:
  ServiceFixture f;
  pos::Json session;
  std::string order;
  QrPaymentFixture() {
    f.openTill();
    pos::handlers::registerQrOrders(f.contextPtr());
    pos::handlers::registerPayments(f.contextPtr());
    auto c = f.db().prepare("SELECT id FROM menu_categories LIMIT 1");
    REQUIRE(c.step());
    auto i =
        f.db().prepare("INSERT INTO "
                       "menu_items(id,category_id,sku,name_az,price_minor,"
                       "active,available,created_at,updated_at) "
                       "VALUES('pay-dish',:cat,'QR-PAY','Pizza',501,1,1,0,0)");
    i.bind(":cat", c.columnText(0));
    i.exec();
    f.db().exec("INSERT INTO "
                "warehouses(id,name,kind,active,sort_order,created_at,updated_"
                "at) VALUES('qr-store','QR anbar','store',1,-1000,0,0);"
                "INSERT INTO "
                "ingredients(id,sku,name,unit,cost_minor,created_at,updated_at)"
                " VALUES('qr-flour','QR-FLOUR','Un','kg',100,0,0);"
                "INSERT INTO "
                "menu_item_ingredients(menu_item_id,ingredient_id,qty_milli) "
                "VALUES('pay-dish','qr-flour',150)");
    auto r =
        call("qr.accept",
             {{"externalId", pos::crypto::uuid4()},
              {"tableId", "tbl-01"},
              {"lines", pos::Json::array({{{"productId", "pay-dish"},
                                           {"qty", 2},
                                           {"modifiers", pos::Json::array()},
                                           {"unitPriceMinor", 501},
                                           {"modifierPriceMinor", 0}}})}});
    order = r["orderId"].get<std::string>();
    session = call("qrPay.begin", {{"orderId", order}});
  }
  pos::Json call(const std::string &method, const pos::Json &payload) {
    pos::ipc::Request r;
    r.requestId = pos::crypto::uuid4();
    r.method = method;
    r.payload = payload;
    r.idempotencyKey = pos::crypto::uuid4();
    return f.server().callHandler(r);
  }
  pos::Json proof(const std::string &action, const std::string &id,
                  pos::Money amount, const std::string &txn = "") {
    const auto sid = session["sessionId"].get<std::string>();
    const auto expires = pos::nowMs() + 90000;
    auto key = pos::crypto::fromHex(session["secret"].get<std::string>());
    std::string a(64, '\x36'), b(64, '\x5c');
    for (size_t i = 0; i < key.size(); i++) {
      a[i] = char(key[i] ^ 0x36);
      b[i] = char(key[i] ^ 0x5c);
    }
    auto h = pos::crypto::fromHex(pos::crypto::sha256Hex(
        a + action + "|" + sid + "|" + id + "|" + std::to_string(amount) + "|" +
        txn + "||" + std::to_string(expires)));
    return {{"sessionId", sid},
            {"intentId", id},
            {"amountMinor", amount},
            {"transaction", txn},
            {"rrn", ""},
            {"expiresAt", expires},
            {"signature",
             pos::crypto::sha256Hex(b + std::string(h.begin(), h.end()))}};
  }
  long count(const std::string &sql) {
    auto q = f.db().prepare(sql);
    REQUIRE(q.step());
    return q.columnInt(0);
  }
};
} // namespace
TEST_CASE("QR payment reserves split amounts and applies each bank result once",
          "[qr-payments]") {
  QrPaymentFixture q;
  const auto first = pos::crypto::uuid4(), second = pos::crypto::uuid4();
  REQUIRE(q.session["snapshot"]["totalMinor"] == 1002);
  REQUIRE(q.call("qrPay.begin", {{"orderId", q.order}})["sessionId"] ==
          q.session["sessionId"]);
  REQUIRE(q.call("qrPay.hold", q.proof("hold", first, 501))["held"] == true);
  REQUIRE(q.call("qrPay.hold", q.proof("hold", first, 501))["held"] == true);
  REQUIRE_THROWS(q.call("qrPay.hold", q.proof("hold", second, 502)));
  REQUIRE(q.call("qrPay.hold", q.proof("hold", second, 501))["held"] == true);
  REQUIRE_THROWS(q.call("qrPay.stop", {{"sessionId", q.session["sessionId"]}}));
  const auto paid =
      q.call("qrPay.apply", q.proof("apply", first, 501, "BANK-1"));
  REQUIRE(paid["applied"] == true);
  REQUIRE(q.call("qrPay.apply",
                 q.proof("apply", first, 501, "BANK-1"))["paymentId"] ==
          paid["paymentId"]);
  REQUIRE_THROWS(
      q.call("qrPay.apply", q.proof("apply", first, 501, "OTHER-BANK")));
  REQUIRE(q.count("SELECT COUNT(*) FROM payments WHERE status='approved'") ==
          1);
  REQUIRE(pos::services::InventoryService(q.f.ctx()).levelOf("qr-flour",
                                                             "qr-store") == 0);
  try {
    q.call("payments.refund", {{"paymentId", paid["paymentId"]},
                               {"amountMinor", 501},
                               {"reason", "test"}});
    FAIL("QR payment refunded through terminal");
  } catch (const pos::PosError &e) {
    REQUIRE(std::string(e.what()).find("Epoint") != std::string::npos);
  }
  REQUIRE(q.call("qrPay.apply",
                 q.proof("apply", second, 501, "BANK-2"))["applied"] == true);
  REQUIRE(
      q.count(
          "SELECT SUM(amount_minor) FROM payments WHERE status='approved'") ==
      1002);
  REQUIRE(q.count("SELECT COUNT(*) FROM orders WHERE status='closed'") == 1);
  REQUIRE(pos::services::InventoryService(q.f.ctx()).levelOf(
              "qr-flour", "qr-store") == -300);
  q.call("qrPay.apply", q.proof("apply", second, 501, "BANK-2"));
  REQUIRE(pos::services::InventoryService(q.f.ctx()).levelOf(
              "qr-flour", "qr-store") == -300);
  REQUIRE(
      q.count(
          "SELECT COUNT(*) FROM qr_payment_sessions WHERE state='closed'") ==
      1);
  REQUIRE(
      q.count(
          "SELECT COUNT(*) FROM print_jobs WHERE kind='customer_receipt'") ==
      1);
}
TEST_CASE("QR payment proofs, amount, mutations and failed release are guarded",
          "[qr-payments]") {
  QrPaymentFixture q;
  auto id = pos::crypto::uuid4();
  auto p = q.proof("hold", id, 501);
  p["amountMinor"] = 502;
  REQUIRE_THROWS(q.call("qrPay.hold", p));
  p = q.proof("hold", id, 501);
  p["signature"] = "wrong";
  REQUIRE_THROWS(q.call("qrPay.hold", p));
  REQUIRE_THROWS(q.f.db().exec("UPDATE order_items SET quantity=3"));
  REQUIRE_THROWS(q.f.db().exec("UPDATE orders SET discount_value=10"));
  REQUIRE_THROWS(q.f.db().exec("UPDATE business_days SET status='closed'"));
  REQUIRE_THROWS(q.call(
      "payments.createCash",
      {{"orderId", q.order}, {"amountMinor", 1002}, {"tenderedMinor", 1002}}));
  q.call("qrPay.hold", q.proof("hold", id, 501));
  REQUIRE_THROWS(q.call("qrPay.release", q.proof("release", id, 502)));
  REQUIRE(q.call("qrPay.release", q.proof("release", id, 501))["released"] ==
          true);
  REQUIRE(q.call("qrPay.release", q.proof("release", id, 501))["released"] ==
          true);
  REQUIRE_THROWS(q.call("qrPay.hold", q.proof("hold", id, 501)));
  REQUIRE(q.call("qrPay.stop",
                 {{"sessionId", q.session["sessionId"]}})["stopped"] == true);
  REQUIRE_NOTHROW(q.f.db().exec("UPDATE orders SET discount_value=0"));
  q.f.ctx().session().permissions.clear();
  REQUIRE_THROWS(q.call("qrPay.begin", {{"orderId", q.order}}));
}
TEST_CASE("SUNMI tills cannot start uncertified split QR receipts",
          "[qr-payments]") {
  QrPaymentFixture q;
  q.call("qrPay.stop", {{"sessionId", q.session["sessionId"]}});
  q.f.db().exec(
      "INSERT OR REPLACE INTO app_settings(key,value,value_type,updated_at) "
      "VALUES('sunmi.activatedAt','1','string',0)");
  REQUIRE_THROWS(q.call("qrPay.begin", {{"orderId", q.order}}));
}
