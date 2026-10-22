#pragma once
#include "pos/services/Idempotency.hpp"
#include "pos/services/InventoryService.hpp"
#include <algorithm>
#include <cctype>
#include <ctime>
#include <map>
#include <optional>
#include <set>

namespace pos::handlers::transfer_workflows {
inline bool isManager(Context &c) {
  const auto &s = c.session();
  return s.role == "administrator" || s.role == "manager" ||
         s.permissions.contains("users.manage");
}
inline void storeScope(Context &c, const Json &p, const std::string &id) {
  if (p.contains("_marketScope")) {
    const auto &s = p.at("_marketScope");
    if (s.value("role", std::string{}) == "manager")
      return;
    bool found = false;
    for (const auto &w : s.value("warehouseIds", Json::array()))
      if (w == id)
        found = true;
    require(found, "Bu anbara giriş icazəniz yoxdur");
    return;
  }
  if (isManager(c))
    return;
  auto q = c.db().prepare("SELECT 1 FROM user_warehouse_access WHERE "
                          "user_id=:u AND warehouse_id=:w");
  q.bind(":u", c.session().userId).bind(":w", id);
  require(q.step(), "Bu anbara giriş icazəniz yoxdur");
}
inline std::string actor(Context &c, const Json &p) {
  return p.contains("_marketScope")
             ? p["_marketScope"].value("id", c.session().userId)
             : c.session().userId;
}
inline void warehouse(Context &c, const std::string &id) {
  auto q =
      c.db().prepare("SELECT id FROM warehouses WHERE id=:id AND active=1");
  q.bind(":id", id);
  require(q.step(), "Anbar tapılmadı");
}
inline Json document(Context &c, const std::string &id) {
  auto q = c.db().prepare(
      "SELECT id,number,from_warehouse_id AS fromWarehouseId,to_warehouse_id "
      "AS toWarehouseId,from_device_id AS fromDeviceId,to_device_id AS "
      "toDeviceId,from_name AS fromName,to_name AS "
      "toName,CASE WHEN revoking=1 AND status='dispatched' THEN 'revoke_pending' ELSE status END AS status,note,revision,created_at AS createdAt,updated_at AS "
      "updatedAt,dispatched_at AS dispatchedAt,received_at AS "
      "receivedAt,returned_at AS returnedAt,source_copy AS "
      "sourceCopy,COALESCE(reversal_of,'') AS "
      "reversalOf,COALESCE(correction_id,'') AS correctionId FROM "
      "transfer_docs WHERE id=:id");
  q.bind(":id", id);
  require(q.step(), "Yerdəyişmə qaiməsi tapılmadı");
  Json d = q.row();
  auto l = c.db().prepare(
      "SELECT id,ingredient_id AS ingredientId,product_json AS "
      "productJson,qty_milli AS qtyMilli,accepted_milli AS "
      "acceptedMilli,rejected_milli AS rejectedMilli,rejection_reason AS "
      "rejectionReason,lots_json AS lotsJson FROM transfer_lines WHERE "
      "transfer_id=:id ORDER BY rowid");
  l.bind(":id", id);
  d["lines"] = l.rows();
  for (auto &r : d["lines"]) {
    r["product"] = Json::parse(r.at("productJson").get<std::string>());
    r["lots"] = Json::parse(r.at("lotsJson").get<std::string>());
    r.erase("productJson");
    r.erase("lotsJson");
  }
  auto ret = c.db().prepare(
      "SELECT id,number,status,created_at AS createdAt,confirmed_at AS "
      "confirmedAt FROM transfer_returns WHERE transfer_id=:id");
  ret.bind(":id", id);
  if (ret.step())
    d["returnDocument"] = ret.row();
  // Why this copy's last message has not reached the other branch yet.
  auto out = c.db().prepare(
      "SELECT last_error,rejected FROM transfer_outbox WHERE transfer_id=:id "
      "AND delivered_at IS NULL AND last_error<>'' ORDER BY rowid DESC LIMIT 1");
  out.bind(":id", id);
  if (out.step()) {
    d["deliveryError"] = out.columnText(0);
    d["deliveryRejected"] = out.row().value("rejected", 0) == 1;
  }
  return d;
}
inline void returnDocument(Context &c, const Json &d) {
  Json lines = Json::array();
  for (const auto &l : d.at("lines"))
    if (l.value("rejectedMilli", std::int64_t{0}) > 0)
      lines.push_back(Json{{"lineId", l.at("id")},
                           {"ingredientId", l.at("ingredientId")},
                           {"product", l.at("product")},
                           {"qtyMilli", l.at("rejectedMilli")},
                           {"reason", l.at("rejectionReason")}});
  if (lines.empty())
    return;
  const auto id = d.at("id").get<std::string>();
  auto q = c.db().prepare("INSERT OR IGNORE INTO "
                          "transfer_returns(id,transfer_id,number,lines_json,"
                          "created_at) VALUES(:id,:doc,:no,:lines,:at)");
  q.bind(":id", "RET-" + id)
      .bind(":doc", id)
      .bind(":no", "GQ-" + id)
      .bind(":lines", lines.dump())
      .bind(":at", nowMs());
  q.exec();
}
inline bool remote(const Json &d) {
  return !d.value("toDeviceId", std::string{}).empty() &&
         d.value("toDeviceId", std::string{}) !=
             d.value("fromDeviceId", std::string{});
}
inline void outbox(Context &c, const Json &d, const std::string &kind,
                   const std::string &target) {
  if (target.empty())
    return;
  const auto key = d.at("id").get<std::string>() + ":" + kind + ":" +
                   std::to_string(d.at("revision").get<int>());
  auto q = c.db().prepare("INSERT OR IGNORE INTO "
                          "transfer_outbox(id,transfer_id,to_device_id,payload_"
                          "json,created_at) VALUES(:id,:doc,:to,:json,:at)");
  q.bind(":id", key)
      .bind(":doc", d.at("id").get<std::string>())
      .bind(":to", target)
      .bind(":json",
            Json{{"eventId", key}, {"kind", kind}, {"document", d}}.dump())
      .bind(":at", nowMs());
  q.exec();
}
inline Json product(Context &c, const std::string &id) {
  auto q = c.db().prepare(
      "SELECT id,name,barcode,unit,cost_minor AS costMinor,sale_price_minor AS "
      "salePriceMinor FROM ingredients WHERE id=:id AND active=1");
  q.bind(":id", id);
  require(q.step(), "Məhsul tapılmadı");
  return q.row();
}
// One spelling for a goods name across branches: Azerbaijani capitals as
// their small letters (SQLite NOCASE only folds ASCII, so "Şəkər" and "şəkər"
// were two goods), i/ı/I/İ as one letter, runs of spaces as one.
inline std::string foldName(const std::string &in) {
  static const std::map<std::string, std::string> pairs = {
      {"\xC6\x8F", "\xC9\x99"}, {"\xC5\x9E", "\xC5\x9F"}, {"\xC3\x87", "\xC3\xA7"},
      {"\xC4\x9E", "\xC4\x9F"}, {"\xC3\x96", "\xC3\xB6"}, {"\xC3\x9C", "\xC3\xBC"},
      {"\xC4\xB0", "i"},          {"\xC4\xB1", "i"}};
  std::string out;
  bool space = false;
  for (std::size_t i = 0; i < in.size();) {
    const auto b = static_cast<unsigned char>(in[i]);
    if (std::isspace(b)) {
      space = !out.empty();
      ++i;
      continue;
    }
    if (space)
      out += ' ';
    space = false;
    if (b < 0x80) {
      out += static_cast<char>(std::tolower(b));
      ++i;
      continue;
    }
    const auto two = in.substr(i, 2);
    const auto hit = pairs.find(two);
    out += hit == pairs.end() ? two : hit->second;
    i += 2;
  }
  return out;
}
inline std::string incomingProduct(Context &c, const Json &p,
                                   const std::string &source) {
  auto code = p.value("barcode", std::string{});
  const auto unit = p.value("unit", std::string{"ədəd"});
  // The recipient's own card, even a deactivated one (receipt revives it): by
  // barcode, else by the same name for goods without one. Never across units.
  if (!code.empty()) {
    auto q = c.db().prepare("SELECT id,unit FROM ingredients WHERE barcode=:b "
                            "ORDER BY active DESC,created_at LIMIT 1");
    q.bind(":b", code);
    if (q.step()) {
      require(q.columnText(1) == unit,
              "Qəbul edən filialda " + code + " barkodlu mal başqa ölçü "
              "vahidindədir (" + q.columnText(1) + ", göndərilən " + unit +
              ")");
      return q.columnText(0);
    }
  }
  const auto id = "tr-" + source + "-" + p.at("id").get<std::string>();
  auto q = c.db().prepare("SELECT id FROM ingredients WHERE id=:id");
  q.bind(":id", id);
  if (q.step())
    return id;
  // The recipient's own card of the same name and unit (it has no barcode, or
  // the sender's has none): the quantity goes onto it, not onto a duplicate.
  {
    const auto want = foldName(p.at("name").get<std::string>());
    auto same = c.db().prepare(
        "SELECT id,name FROM ingredients WHERE unit=:u AND "
        "(COALESCE(barcode,'')='' OR :b='') ORDER BY active DESC,created_at");
    same.bind(":u", unit).bind(":b", code);
    while (same.step())
      if (foldName(same.columnText(1)) == want)
        return same.columnText(0);
  }
  auto i = c.db().prepare(
      "INSERT INTO "
      "ingredients(id,sku,name,barcode,unit,cost_minor,sale_price_minor,active,"
      "created_at,updated_at) VALUES(:id,:sku,:n,:b,:u,:c,:p,1,:at,:at)");
  i.bind(":id", id)
      .bind(":sku", "TR-" + id)
      .bind(":at", nowMs())
      .bind(":n", p.at("name").get<std::string>())
      .bind(":b", code)
      .bind(":u", p.value("unit", std::string{"ədəd"}))
      .bind(":c", p.value("costMinor", Money{0}))
      .bind(":p", p.value("salePriceMinor", Money{0}));
  i.exec();
  return id;
}
// Incoming stock retains the source lots' dates, cost and quantity allocation.
inline void incoming(Context &c, const Json &line, const std::string &wh,
                     std::int64_t qty, std::int64_t offset,
                     const std::string &ref) {
  if (qty == 0)
    return;
  // Goods that physically arrive make a deactivated card visible again.
  auto revive = c.db().prepare(
      "UPDATE ingredients SET active=1,updated_at=:at WHERE id=:id AND active=0");
  revive.bind(":at", nowMs()).bind(":id", line.at("ingredientId").get<std::string>());
  revive.exec();
  services::InventoryService inv(c);
  std::int64_t left = qty, skip = offset;
  for (const auto &l : line.value("lots", Json::array())) {
    auto n = l.value("qtyMilli", std::int64_t{0});
    const auto ignored = std::min(skip, n);
    skip -= ignored;
    n -= ignored;
    const auto take = std::min(left, n);
    if (take <= 0)
      continue;
    services::LotSpec spec;
    spec.lotNo = l.value("lotNo", std::string{});
    spec.producedOn = l.value("producedOn", std::string{});
    spec.expiresOn = l.value("expiresOn", std::string{});
    spec.unitCost = l.value("unitCostMinor", Money{-1});
    spec.receivedAt = l.value("receivedAt", Timestamp{0});
    inv.move(line.at("ingredientId"), wh, take, "transfer_in", ref,
             "Yerdəyişmə qəbulu", spec);
    left -= take;
    if (!left)
      break;
  }
  if (left > 0)
    inv.move(line.at("ingredientId"), wh, left, "transfer_in", ref,
             "Yerdəyişmə qəbulu");
}
// YD-<yymmdd>-<8 hex of the id>: readable, still unique across branches.
inline std::string docNumber(const std::string &id) {
  std::string hex;
  for (char ch : id)
    if (std::isxdigit(static_cast<unsigned char>(ch)) && hex.size() < 8)
      hex += static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
  if (hex.size() < 8)
    return "YD-" + id;
  const auto t = std::time(nullptr);
  char day[8];
  std::strftime(day, sizeof day, "%y%m%d", std::localtime(&t));
  return "YD-" + std::string(day) + "-" + hex;
}
inline void changeStatus(Context &c, const std::string &id,
                         const std::string &status, const std::string &column) {
  auto q = c.db().prepare(
      "UPDATE transfer_docs SET status=:s,revision=revision+1,updated_at=:at," +
      column + "=:at WHERE id=:id");
  q.bind(":s", status).bind(":at", nowMs()).bind(":id", id);
  q.exec();
}
// A revoke the recipient did not accept: the goods returned to the sender's
// shelf leave it again and the document is a plain dispatch once more.
inline void retake(Context &c, const Json &d) {
  services::InventoryService inv(c);
  for (const auto &l : d.at("lines"))
    inv.move(l.at("ingredientId").get<std::string>(),
             d.at("fromWarehouseId").get<std::string>(),
             -l.at("qtyMilli").get<std::int64_t>(), "transfer_out",
             d.at("id").get<std::string>(), "Yerdəyişmə (ləğv qəbul olunmadı)");
  auto q = c.db().prepare("UPDATE transfer_docs SET revoking=0,revision=revision+1,"
                          "updated_at=:at WHERE id=:id");
  q.bind(":at", nowMs()).bind(":id", d.at("id").get<std::string>());
  q.exec();
}
inline std::optional<Json> run(Context &c, const ipc::Request &r) {
  const auto p = r.payload;
  const auto action = p.value("action", std::string{});
  if (action.rfind("transfer.", 0) != 0)
    return std::nullopt;
  const bool read = action == "transfer.list" || action == "transfer.get";
  c.requirePermission(read ? "inventory.view" : "inventory.transfer");
  if (action == "transfer.list") {
    auto q = c.db().prepare("SELECT id FROM transfer_docs ORDER BY created_at "
                            "DESC,id DESC LIMIT 1000");
    Json docs = Json::array();
    while (q.step()) {
      auto d = document(c, q.columnText(0));
      bool visible = true;
      try {
        storeScope(c, p,
                   d.at(d.value("sourceCopy", 1) ? "fromWarehouseId"
                                                 : "toWarehouseId"));
      } catch (...) {
        visible = false;
        if (!remote(d))
          try {
            storeScope(c, p, d.at("toWarehouseId"));
            visible = true;
          } catch (...) {
          }
      }
      if (visible)
        docs.push_back(d);
    }
    return Json{{"documents", docs}};
  }
  if (action == "transfer.outbox") {
    auto q =
        // Failing events go behind fresh ones: one refusal never holds up the rest.
        c.db().prepare("SELECT id,transfer_id AS transferId,to_device_id AS "
                       "deviceId,attempts,payload_json AS payload FROM "
                       "transfer_outbox WHERE delivered_at IS NULL ORDER BY "
                       "attempts,rowid LIMIT 50");
    auto rows = q.rows();
    for (auto &x : rows)
      x["payload"] = Json::parse(x.at("payload").get<std::string>());
    return Json{{"events", rows}};
  }
  if (action == "transfer.ack") {
    auto q = c.db().prepare("UPDATE transfer_outbox SET "
                            "delivered_at=:at,last_error='' WHERE id=:id");
    q.bind(":at", nowMs()).bind(":id", p.at("eventId").get<std::string>());
    q.exec();
    return Json{{"ok", true}};
  }
  if (action == "transfer.failure") {
    auto q = c.db().prepare(
        "UPDATE transfer_outbox SET attempts=attempts+1,last_error=:error,"
        "rejected=:rejected WHERE id=:id AND delivered_at IS NULL");
    q.bind(":error", p.value("error", std::string{}))
        .bind(":rejected", p.value("rejected", false) ? 1 : 0)
        .bind(":id", p.at("eventId").get<std::string>());
    q.exec();
    return Json{{"ok", true}};
  }
  db::Transaction tx(c.db());
  services::Idempotency idem(c);
  const auto key = r.idempotencyKey.empty()
                       ? p.value("idempotencyKey", std::string{})
                       : r.idempotencyKey;
  if (!read) {
    require(!key.empty(), "Əməliyyat açarı tələb olunur");
    if (auto v = idem.begin(key, action, p))
      return *v;
  }
  Json result;
  if (action == "transfer.sync") {
    const auto event = p.at("event");
    const auto id = event.at("eventId").get<std::string>(),
               kind = event.at("kind").get<std::string>();
    auto d = event.at("document");
    auto seen = c.db().prepare("SELECT 1 FROM transfer_inbox WHERE id=:id");
    seen.bind(":id", id);
    if (seen.step())
      return Json{{"ok", true}};
    const auto source = p.value("cloudSourceDeviceId", std::string{}),
               target = p.value("cloudTargetDeviceId", std::string{});
    require(!source.empty() && !target.empty(),
            "İmzalı filial mənbəyi tələb olunur");
    // The recipient answers (receive, revoked, revoke_refused); the sender
    // writes everything else.
    const bool answer = kind == "receive" || kind == "revoked" ||
                        kind == "revoke_refused";
    require((answer ? d.value("fromDeviceId", std::string{})
                    : d.value("toDeviceId", std::string{})) == target,
            "Göndəriş qəbul edən filiala aid deyil");
    const auto expected = answer ? d.value("toDeviceId", std::string{})
                                 : d.value("fromDeviceId", std::string{});
    require(source == expected, "Göndəriş mənbəyi uyğun deyil");
    auto revoked = c.db().prepare("SELECT 1 FROM transfer_inbox WHERE id=:id");
    revoked.bind(":id", "REVOKED:" + d.value("id", std::string{}));
    if (kind == "dispatch" && revoked.step()) {
      // Taken back by the sender before it arrived (see kind "revoke").
    } else if (kind == "dispatch") {
      warehouse(c, d.at("toWarehouseId"));
      auto exists = c.db().prepare("SELECT id FROM transfer_docs WHERE id=:id");
      exists.bind(":id", d.at("id").get<std::string>());
      require(!exists.step(), "Qaimə artıq mövcuddur");
      auto save = c.db().prepare(
          "INSERT INTO "
          "transfer_docs(id,number,from_warehouse_id,to_warehouse_id,from_"
          "device_id,to_device_id,from_name,to_name,status,note,revision,"
          "created_at,updated_at,dispatched_at,source_copy,reversal_of) "
          "VALUES(:id,:no,:f,:t,:fd,:td,:fn,:tn,'dispatched',:note,:rev,:at,:"
          "at,:at,0,:reversal)");
      save.bind(":id", d.at("id").get<std::string>())
          .bind(":no", d.at("number").get<std::string>())
          .bind(":f", d.at("fromWarehouseId").get<std::string>())
          .bind(":t", d.at("toWarehouseId").get<std::string>())
          .bind(":fd", d.at("fromDeviceId").get<std::string>())
          .bind(":td", d.at("toDeviceId").get<std::string>())
          .bind(":fn", d.value("fromName", std::string{}))
          .bind(":tn", d.value("toName", std::string{}))
          .bind(":note", d.value("note", std::string{}))
          .bind(":rev", d.at("revision").get<int>())
          .bind(":at", nowMs())
          .bindOptional(":reversal", d.value("reversalOf", std::string{}));
      save.exec();
      if (!d.value("reversalOf", std::string{}).empty()) {
        const auto original = document(c, d.at("reversalOf"));
        require(original.at("fromDeviceId") == d.at("toDeviceId") &&
                    original.at("toDeviceId") == d.at("fromDeviceId"),
                "Əks qaimə ünvanı uyğun deyil");
        auto link = c.db().prepare("UPDATE transfer_docs SET "
                                   "correction_id=:reverse WHERE id=:original");
        link.bind(":reverse", d.at("id").get<std::string>())
            .bind(":original", d.at("reversalOf").get<std::string>());
        link.exec();
      }
      for (auto &l : d["lines"]) {
        std::string good;
        if (!d.value("reversalOf", std::string{}).empty()) {
          const auto original = document(c, d.at("reversalOf"));
          auto matching = std::find_if(
              original.at("lines").begin(), original.at("lines").end(),
              [&](const Json &x) {
                return x.at("product").at("id") == l.at("product").at("id");
              });
          require(matching != original.at("lines").end() &&
                      l.at("qtyMilli").get<std::int64_t>() <=
                          matching->at("acceptedMilli").get<std::int64_t>(),
                  "Əks qaimədəki məhsul və miqdar uyğun deyil");
          good = matching->at("ingredientId").get<std::string>();
        } else
          good = incomingProduct(c, l.at("product"), source);
        auto ins = c.db().prepare(
            "INSERT INTO "
            "transfer_lines(id,transfer_id,ingredient_id,product_json,qty_"
            "milli,lots_json) VALUES(:id,:d,:g,:p,:q,:l)");
        ins.bind(":id", l.at("id").get<std::string>())
            .bind(":d", d.at("id").get<std::string>())
            .bind(":g", good)
            .bind(":p", l.at("product").dump())
            .bind(":q", l.at("qtyMilli").get<std::int64_t>())
            .bind(":l", l.at("lots").dump());
        ins.exec();
      }
    } else if (kind == "receive") {
      auto original = document(c, d.at("id"));
      require((original.at("status") == "dispatched" ||
               original.at("status") == "revoke_pending") &&
                  original.value("sourceCopy", 0) == 1,
              "Qaimə vəziyyəti uyğun deyil");
      // The recipient confirmed before our revoke reached it: its receipt
      // stands, so the goods we put back on the shelf leave again.
      if (original.at("status") == "revoke_pending")
        retake(c, original);
      require(original.at("fromDeviceId") == d.at("fromDeviceId") &&
                  original.at("toDeviceId") == d.at("toDeviceId") &&
                  original.at("toWarehouseId") == d.at("toWarehouseId"),
              "Qaimə ünvanı uyğun deyil");
      require(d.at("lines").size() == original.at("lines").size(),
              "Bütün sətirləri yoxlayın");
      std::set<std::string> lineIds;
      bool hasRejected = false;
      for (const auto &l : d["lines"]) {
        require(lineIds.insert(l.at("id")).second, "Təkrar sətir");
        auto existing = std::find_if(
            original["lines"].begin(), original["lines"].end(),
            [&](const Json &x) { return x.at("id") == l.at("id"); });
        require(existing != original["lines"].end(), "Qaimə sətri tapılmadı");
        const auto a = l.at("acceptedMilli").get<std::int64_t>(),
                   b = l.at("rejectedMilli").get<std::int64_t>();
        require(a >= 0 && b >= 0 &&
                    a + b == existing->at("qtyMilli").get<std::int64_t>(),
                "Miqdar uyğun deyil");
        require(b == 0 ||
                    l.value("rejectionReason", std::string{})
                            .find_first_not_of(" \n\r\t") != std::string::npos,
                "Qəbul edilməmə səbəbi tələb olunur");
        hasRejected = hasRejected || b > 0;
        auto u = c.db().prepare("UPDATE transfer_lines SET "
                                "accepted_milli=:a,rejected_milli=:b,rejection_"
                                "reason=:r WHERE id=:id AND transfer_id=:d");
        u.bind(":a", a)
            .bind(":b", b)
            .bind(":r", l.value("rejectionReason", std::string{}))
            .bind(":id", l.at("id").get<std::string>())
            .bind(":d", d.at("id").get<std::string>());
        u.exec();
      }
      changeStatus(c, d.at("id"), hasRejected ? "return_pending" : "received",
                   "received_at");
      returnDocument(c, document(c, d.at("id")));
    } else if (kind == "revoke") {
      // On the recipient: the sender takes back a dispatch not confirmed here.
      auto here = c.db().prepare("SELECT 1 FROM transfer_docs WHERE id=:id");
      here.bind(":id", d.at("id").get<std::string>());
      if (!here.step()) {
        // The revoke overtook its dispatch (a dispatch that kept failing is
        // retried behind fresh messages): remember it, so the late dispatch is
        // dropped, and answer for the document as the sender sent it.
        auto tomb = c.db().prepare("INSERT OR IGNORE INTO transfer_inbox VALUES(:id,:at)");
        tomb.bind(":id", "REVOKED:" + d.at("id").get<std::string>()).bind(":at", nowMs());
        tomb.exec();
        outbox(c, d, "revoked", d.at("fromDeviceId"));
      } else {
        auto original = document(c, d.at("id"));
        require(original.value("sourceCopy", 1) == 0 &&
                    original.at("fromDeviceId") == d.at("fromDeviceId"),
                "Ləğv mənbəyi uyğun deyil");
        const bool open = original.at("status") == "dispatched";
        if (open)
          changeStatus(c, d.at("id"), "cancelled", "updated_at");
        const auto now = document(c, d.at("id"));
        outbox(c, now, open ? "revoked" : "revoke_refused",
               now.at("fromDeviceId"));
      }
    } else if (kind == "revoked" || kind == "revoke_refused") {
      // On the sender: the recipient's answer to our revoke.
      auto original = document(c, d.at("id"));
      require(original.value("sourceCopy", 0) == 1, "Qaimə vəziyyəti uyğun deyil");
      if (original.at("status") == "revoke_pending") {
        if (kind == "revoked")
          changeStatus(c, d.at("id"), "cancelled", "updated_at");
        else
          retake(c, original); // back to dispatched; its 'receive' follows
        auto clear = c.db().prepare(
            "UPDATE transfer_docs SET revoking=0 WHERE id=:id");
        clear.bind(":id", d.at("id").get<std::string>());
        clear.exec();
      }
    } else if (kind == "returned") {
      auto original = document(c, d.at("id"));
      require(original.at("status") == "return_pending",
              "Geri qəbulu gözləyən qaimə yoxdur");
      require(original.value("sourceCopy", 1) == 0 &&
                  original.at("fromDeviceId") == d.at("fromDeviceId"),
              "Geri qəbul mənbəyi uyğun deyil");
      changeStatus(c, d.at("id"), "closed", "returned_at");
      auto u = c.db().prepare(
          "UPDATE transfer_returns SET status='closed',confirmed_at=:at WHERE "
          "transfer_id=:id");
      u.bind(":at", nowMs()).bind(":id", d.at("id").get<std::string>());
      u.exec();
    } else
      require(false, "Göndəriş növü tanınmadı");
    auto ins = c.db().prepare("INSERT INTO transfer_inbox VALUES(:id,:at)");
    ins.bind(":id", id).bind(":at", nowMs());
    ins.exec();
    result = {{"ok", true}};
  } else if (action == "transfer.save") {
    const auto id = p.value("id", std::string{}),
               from = p.value("fromWarehouseId", std::string{}),
               to = p.value("toWarehouseId", std::string{}),
               fd = p.value("fromDeviceId", std::string{}),
               td = p.value("toDeviceId", std::string{});
    const bool cross = !td.empty() && td != fd;
    warehouse(c, from);
    storeScope(c, p, from);
    require(!to.empty() && (cross || from != to), "Fərqli qəbul anbarı seçin");
    if (!cross)
      warehouse(c, to);
    const auto docId = id.empty() ? crypto::uuid4() : id;
    require(docId.size() <= 100, "Qaimə nömrəsi çox uzundur");
    auto exists = c.db().prepare("SELECT 1 FROM transfer_docs WHERE id=:id");
    exists.bind(":id", docId);
    const bool updating = exists.step();
    if (updating) {
      const auto old = document(c, docId);
      require(old.at("status") == "draft",
              "Göndərilmiş qaiməyə əks qaimə ilə düzəliş edin");
      require(old.value("sourceCopy", 1) == 1,
              "Qaimə göndərən anbarda dəyişdirilir");
      storeScope(c, p, old.at("fromWarehouseId"));
      require(p.value("revision", 0) == old.at("revision").get<int>(),
              "Qaimə dəyişib, yeniləyin");
    }
    if (!updating)
      require(p.value("revision", 0) == 0,
              "Qaimə tapılmadı, siyahını yeniləyin");
    const auto lines = p.value("lines", Json::array());
    require(!lines.empty() && lines.size() <= 500,
            "Məhsul əlavə edin (ən çox 500 sətir)");
    // A reverse line keeps the original document's product (the other
    // branch's id), which is how that branch matches it back.
    std::map<std::string, Json> reverseProducts;
    if (updating) {
      const auto previous = document(c, docId);
      if (!previous.value("reversalOf", std::string{}).empty()) {
        const auto original = document(c, previous.at("reversalOf"));
        for (const auto &line : lines) {
          auto found = std::find_if(
              original.at("lines").begin(), original.at("lines").end(),
              [&](const Json &l) {
                return l.at("ingredientId") == line.at("ingredientId");
              });
          require(
              found != original.at("lines").end() &&
                  line.value("qtyMilli", std::int64_t{0}) <=
                      found->value("acceptedMilli", std::int64_t{0}),
              "Əks qaimənin miqdarı qəbul edilmiş miqdardan çox ola bilməz");
          reverseProducts[found->at("ingredientId").get<std::string>()] =
              found->at("product");
        }
      }
    }
    const auto number = docNumber(docId);
    auto save = c.db().prepare(
        "INSERT INTO "
        "transfer_docs(id,number,from_warehouse_id,to_warehouse_id,from_device_"
        "id,to_device_id,from_name,to_name,note,actor_id,created_at,updated_at)"
        " VALUES(:id,:n,:f,:t,:fd,:td,:fn,:tn,:note,:actor,:at,:at) ON "
        "CONFLICT(id) DO UPDATE SET "
        "from_warehouse_id=excluded.from_warehouse_id,to_warehouse_id=excluded."
        "to_warehouse_id,from_device_id=excluded.from_device_id,to_device_id="
        "excluded.to_device_id,from_name=excluded.from_name,to_name=excluded."
        "to_name,note=excluded.note,revision=revision+1,updated_at=excluded."
        "updated_at");
    save.bind(":id", docId)
        .bind(":n", number)
        .bind(":f", from)
        .bind(":t", to)
        .bind(":fd", fd)
        .bind(":td", td)
        .bind(":fn", p.value("fromName", std::string{}))
        .bind(":tn", p.value("toName", std::string{}))
        .bind(":note", p.value("note", std::string{}))
        .bind(":actor", actor(c, p))
        .bind(":at", nowMs());
    save.exec();
    auto del =
        c.db().prepare("DELETE FROM transfer_lines WHERE transfer_id=:id");
    del.bind(":id", docId);
    del.exec();
    std::set<std::string> seen;
    for (const auto &l : lines) {
      const auto good = l.at("ingredientId").get<std::string>();
      require(seen.insert(good).second, "Eyni məhsulu bir sətirdə birləşdirin");
      const auto qty = l.value("qtyMilli", std::int64_t{0});
      require(qty > 0 && qty <= 1000000000000LL, "Miqdar düzgün deyil");
      const auto own = product(c, good);
      const auto unit = own.value("unit", std::string{});
      require((unit != "ədəd" && unit != "qab") || qty % 1000 == 0,
              own.value("name", std::string{}) +
                  ": ədədli mal tam ədədlə göndərilir");
      const auto kept = reverseProducts.find(good);
      auto ins =
          c.db().prepare("INSERT INTO "
                         "transfer_lines(id,transfer_id,ingredient_id,product_"
                         "json,qty_milli) VALUES(:id,:d,:g,:p,:q)");
      ins.bind(":id", crypto::uuid4())
          .bind(":d", docId)
          .bind(":g", good)
          .bind(":p", (kept == reverseProducts.end() ? own : kept->second).dump())
          .bind(":q", qty);
      ins.exec();
    }
    result = document(c, docId);
  } else {
    const auto id = p.value("id", std::string{});
    auto d = document(c, id);
    const auto status = d.at("status").get<std::string>();
    if (action == "transfer.get") {
      if (!remote(d)) {
        try {
          storeScope(c, p, d.at("fromWarehouseId"));
        } catch (...) {
          storeScope(c, p, d.at("toWarehouseId"));
        }
      } else
        storeScope(c, p,
                   d.at(d.value("sourceCopy", 1) ? "fromWarehouseId"
                                                 : "toWarehouseId"));
      result = d;
    } else if (action == "transfer.cancel") {
      storeScope(c, p, d.at("fromWarehouseId"));
      require(status == "draft", "Göndərilmiş qaiməni əks qaimə ilə qaytarın");
      require(!p.value("reason", std::string{}).empty(), "Ləğv səbəbini yazın");
      changeStatus(c, id, "cancelled", "updated_at");
      result = document(c, id);
    } else if (action == "transfer.dispatch") {
      storeScope(c, p, d.at("fromWarehouseId"));
      require(status == "draft" && d.value("sourceCopy", 1) == 1,
              "Qaimə artıq göndərilib");
      services::InventoryService inv(c);
      for (auto &l : d["lines"]) {
        const auto good = l.at("ingredientId").get<std::string>(),
                   wh = d.at("fromWarehouseId").get<std::string>();
        const auto qty = l.at("qtyMilli").get<std::int64_t>();
        require(inv.levelOf(good, wh) >= qty,
                "Göndərən anbarda kifayət qədər məhsul yoxdur");
        const auto moved = inv.move(good, wh, -qty, "transfer_out", id,
                                    "Yerdəyişmə göndərişi");
        Json lots = Json::array();
        for (const auto &piece : moved["lots"]) {
          auto q = c.db().prepare(
              "SELECT COALESCE(lot_no,'') AS lotNo,COALESCE(produced_on,'') AS "
              "producedOn,COALESCE(expires_on,'') AS expiresOn,unit_cost_minor "
              "AS unitCostMinor,received_at AS receivedAt FROM stock_lots "
              "WHERE id=:id");
          q.bind(":id", piece.at("lotId").get<std::string>());
          if (q.step()) {
            auto x = q.row();
            x["qtyMilli"] = piece.at("qtyMilli");
            lots.push_back(x);
          }
        }
        auto u = c.db().prepare(
            "UPDATE transfer_lines SET lots_json=:l WHERE id=:id");
        u.bind(":l", lots.dump()).bind(":id", l.at("id").get<std::string>());
        u.exec();
      }
      changeStatus(c, id, "dispatched", "dispatched_at");
      result = document(c, id);
      if (remote(result))
        outbox(c, result, "dispatch", result.at("toDeviceId"));
    } else if (action == "transfer.receive") {
      require(status == "dispatched", "Qaimə qəbulu artıq təsdiqlənib");
      require(!remote(d) || d.value("sourceCopy", 1) == 0,
              "Qəbul edən filialda təsdiqləyin");
      storeScope(c, p, d.at("toWarehouseId"));
      warehouse(c, d.at("toWarehouseId"));
      const auto decisions = p.value("lines", Json::array());
      require(decisions.size() == d["lines"].size(),
              "Bütün sətirləri yoxlayın");
      bool rejected = false;
      for (auto &l : d["lines"]) {
        auto it = std::find_if(decisions.begin(), decisions.end(),
                               [&](const Json &x) {
                                 return x.value("id", std::string{}) ==
                                        l.at("id").get<std::string>();
                               });
        require(it != decisions.end(), "Sətir qərarı tapılmadı");
        const auto accepted = it->value("acceptedMilli", std::int64_t{-1}),
                   rejectedQty = it->value("rejectedMilli", std::int64_t{-1});
        const auto reason = it->value("reason", std::string{});
        require(accepted >= 0 && rejectedQty >= 0 &&
                    accepted + rejectedQty ==
                        l.at("qtyMilli").get<std::int64_t>(),
                "Qəbul və qaytarma miqdarlarının cəmi göndərilənə bərabər "
                "olmalıdır");
        require(rejectedQty == 0 ||
                    reason.find_first_not_of(" \n\r\t") != std::string::npos,
                "Qəbul edilməmə səbəbini yazın");
        const auto unit = l.at("product").value("unit", std::string{});
        require((unit != "ədəd" && unit != "qab") || accepted % 1000 == 0,
                l.at("product").value("name", std::string{}) +
                    ": ədədli mal tam ədədlə qəbul edilir");
        incoming(c, l, d.at("toWarehouseId"), accepted, 0, id);
        auto u = c.db().prepare("UPDATE transfer_lines SET "
                                "accepted_milli=:a,rejected_milli=:b,rejection_"
                                "reason=:r WHERE id=:id");
        u.bind(":a", accepted)
            .bind(":b", rejectedQty)
            .bind(":r", reason)
            .bind(":id", l.at("id").get<std::string>());
        u.exec();
        rejected = rejected || rejectedQty > 0;
      }
      changeStatus(c, id, rejected ? "return_pending" : "received",
                   "received_at");
      returnDocument(c, document(c, id));
      result = document(c, id);
      if (remote(result))
        outbox(c, result, "receive", result.at("fromDeviceId"));
    } else if (action == "transfer.returnConfirm") {
      require(status == "return_pending" && d.value("sourceCopy", 1) == 1,
              "Geri qəbulu göndərən anbarda təsdiqləyin");
      storeScope(c, p, d.at("fromWarehouseId"));
      for (const auto &l : d["lines"])
        incoming(c, l, d.at("fromWarehouseId"), l.at("rejectedMilli"),
                 l.at("acceptedMilli"), "RETURN-" + id);
      changeStatus(c, id, "closed", "returned_at");
      auto ret = c.db().prepare(
          "UPDATE transfer_returns SET status='closed',confirmed_at=:at WHERE "
          "transfer_id=:id");
      ret.bind(":at", nowMs()).bind(":id", id);
      ret.exec();
      result = document(c, id);
      if (remote(result))
        outbox(c, result, "returned", result.at("toDeviceId"));
    } else if (action == "transfer.revoke") {
      // 1.5.47: the sender deletes (or, with a new document, edits) a dispatch
      // the recipient has not confirmed. The goods go back on the sender's
      // shelf now; the recipient cancels its copy, or answers that it already
      // received it (then they leave again - retake).
      storeScope(c, p, d.at("fromWarehouseId"));
      require(status == "dispatched" && d.value("sourceCopy", 1) == 1,
              "Yalnız qəbul edilməmiş göndərişi ləğv etmək olar");
      for (const auto &l : d.at("lines"))
        incoming(c, l, d.at("fromWarehouseId"), l.at("qtyMilli"), 0,
                 "REVOKE-" + id);
      if (remote(d)) {
        auto mark = c.db().prepare(
            "UPDATE transfer_docs SET revoking=1,revision=revision+1,"
            "updated_at=:at WHERE id=:id");
        mark.bind(":at", nowMs()).bind(":id", id);
        mark.exec();
        result = document(c, id);
        outbox(c, result, "revoke", result.at("toDeviceId"));
      } else {
        changeStatus(c, id, "cancelled", "updated_at");
        result = document(c, id);
      }
    } else if (action == "transfer.recall") {
      // The recipient refused the dispatch outright (a validation error, so
      // nothing was booked there): the goods go back on the sender's shelf and
      // the message is never sent again. Market holds the relay lock meanwhile.
      storeScope(c, p, d.at("fromWarehouseId"));
      require(status == "dispatched" && d.value("sourceCopy", 1) == 1 &&
                  remote(d),
              "Yalnız qarşı filialın qəbul etmədiyi göndərişi geri çağırmaq "
              "olar");
      require(p.value("reason", std::string{})
                      .find_first_not_of(" \n\r\t") != std::string::npos,
              "Geri çağırma səbəbini yazın");
      const auto prefix = id + ":dispatch:";
      auto ev = c.db().prepare(
          "SELECT rejected FROM transfer_outbox WHERE transfer_id=:id AND "
          "delivered_at IS NULL AND substr(id,1,length(:p))=:p");
      ev.bind(":id", id).bind(":p", prefix);
      require(ev.step() && ev.row().value("rejected", 0) == 1,
              "Qəbul edən filial qaiməni rədd etməyib, geri çağırmaq olmaz");
      for (const auto &l : d.at("lines"))
        incoming(c, l, d.at("fromWarehouseId"), l.at("qtyMilli"), 0,
                 "RECALL-" + id);
      auto done = c.db().prepare(
          "UPDATE transfer_outbox SET delivered_at=:at,last_error='Geri "
          "çağırıldı' WHERE transfer_id=:id AND delivered_at IS NULL");
      done.bind(":at", nowMs()).bind(":id", id);
      done.exec();
      changeStatus(c, id, "cancelled", "updated_at");
      result = document(c, id);
    } else if (action == "transfer.reverse") {
      require(status == "received" || status == "closed",
              "Əks qaimə üçün əvvəlcə qəbulu tamamlayın");
      require(!remote(d) || d.value("sourceCopy", 1) == 0,
              "Əks qaiməni qəbul edən filial yaradır");
      storeScope(c, p, d.at("toWarehouseId"));
      const auto reason = p.value("reason", std::string{});
      require(reason.find_first_not_of(" \n\r\t") != std::string::npos,
              "Əks qaimənin səbəbini yazın");
      require(d.value("correctionId", std::string{}).empty(),
              "Əlaqəli əks qaimə artıq yaradılıb");
      const auto reverseId = crypto::uuid4();
      auto ins = c.db().prepare(
          "INSERT INTO "
          "transfer_docs(id,number,from_warehouse_id,to_warehouse_id,from_"
          "device_id,to_device_id,from_name,to_name,note,actor_id,created_at,"
          "updated_at,reversal_of) "
          "VALUES(:id,:no,:f,:t,:fd,:td,:fn,:tn,:note,:actor,:at,:at,:"
          "original)");
      ins.bind(":id", reverseId)
          .bind(":no", docNumber(reverseId))
          .bind(":f", d.at("toWarehouseId").get<std::string>())
          .bind(":t", d.at("fromWarehouseId").get<std::string>())
          .bind(":fd", d.value("toDeviceId", std::string{}).empty()
                           ? d.at("fromDeviceId").get<std::string>()
                           : d.at("toDeviceId").get<std::string>())
          .bind(":td", d.at("fromDeviceId").get<std::string>())
          .bind(":fn", d.at("toName").get<std::string>())
          .bind(":tn", d.at("fromName").get<std::string>())
          .bind(":note", reason)
          .bind(":actor", actor(c, p))
          .bind(":at", nowMs())
          .bind(":original", id);
      ins.exec();
      int count = 0;
      for (const auto &l : d.at("lines")) {
        const auto accepted = l.value("acceptedMilli", std::int64_t{0});
        if (!accepted)
          continue;
        count++;
        auto row = c.db().prepare(
            "INSERT INTO "
            "transfer_lines(id,transfer_id,ingredient_id,product_json,qty_"
            "milli) VALUES(:id,:doc,:good,:product,:qty)");
        row.bind(":id", crypto::uuid4())
            .bind(":doc", reverseId)
            .bind(":good", l.at("ingredientId").get<std::string>())
            .bind(":product", l.at("product").dump())
            .bind(":qty", accepted);
        row.exec();
      }
      require(count > 0, "Qaytarılacaq qəbul edilmiş mal yoxdur");
      auto link = c.db().prepare(
          "UPDATE transfer_docs SET correction_id=:r WHERE id=:id");
      link.bind(":r", reverseId).bind(":id", id);
      link.exec();
      result = document(c, reverseId);
    } else
      require(false, "Yerdəyişmə əməliyyatı tanınmadı");
  }
  if (!read) {
    c.auditRequired(action, "transfer", result.value("id", std::string{}),
                    Json{{"actorId", actor(c, p)}, {"payload", p}});
    idem.complete(key, result, "transfer", result.value("id", std::string{}));
  }
  tx.commit();
  return result;
}
} // namespace pos::handlers::transfer_workflows
