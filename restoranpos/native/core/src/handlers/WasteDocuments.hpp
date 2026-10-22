#pragma once
// Zay (waste) as a document (1.5.47): Z-00001 with lines, listed under Alışlar
// → Zaylar, editable and cancellable. Stock leaves through 'waste' movements
// that reference the document; an edit or a cancel puts the old lines back
// with 'adjustment' movements (also referencing it), so history stays intact.
// reports.stockLoss reads these documents' live lines, not their movements.
#include "pos/Crypto.hpp"
#include "pos/services/Idempotency.hpp"
#include "pos/services/InventoryService.hpp"
#include <optional>

namespace pos::handlers::waste_documents {
inline Json document(Context &c, const std::string &id) {
  auto q = c.db().prepare(
      "SELECT d.id,d.number,d.warehouse_id AS warehouseId,COALESCE(w.name,'') AS "
      "warehouseName,d.total_minor AS totalMinor,d.note,d.created_at AS createdAt,"
      "d.updated_at AS updatedAt,CASE WHEN d.cancelled_at IS NULL THEN 'active' "
      "ELSE 'cancelled' END AS status,COALESCE(u.full_name,'') AS actorName "
      "FROM waste_documents d LEFT JOIN warehouses w ON w.id=d.warehouse_id "
      "LEFT JOIN users u ON u.id=d.actor_id WHERE d.id=:id");
  q.bind(":id", id);
  require(q.step(), "Zay qaiməsi tapılmadı");
  Json d = q.row();
  auto l = c.db().prepare(
      "SELECT x.ingredient_id AS ingredientId,COALESCE(i.name,'') AS name,"
      "COALESCE(i.unit,'') AS unit,x.qty_milli AS qtyMilli,x.cost_minor AS "
      "costMinor,x.total_minor AS totalMinor FROM waste_document_items x LEFT "
      "JOIN ingredients i ON i.id=x.ingredient_id WHERE x.document_id=:id ORDER "
      "BY x.rowid");
  l.bind(":id", id);
  d["lines"] = l.rows();
  return d;
}
// The document's lines go back on the shelf (edit or cancel).
inline void undo(Context &c, const Json &d, const std::string &why) {
  services::InventoryService inv(c);
  for (const auto &l : d.at("lines"))
    inv.move(l.at("ingredientId").get<std::string>(),
             d.at("warehouseId").get<std::string>(),
             l.at("qtyMilli").get<std::int64_t>(), "adjustment",
             d.at("id").get<std::string>(), why, {}, true);
}
inline std::optional<Json> run(Context &c, const ipc::Request &r) {
  const auto &p = r.payload;
  const auto action = p.value("action", std::string{});
  if (action.rfind("waste.", 0) != 0)
    return std::nullopt;
  if (action == "waste.list") {
    c.requirePermission("inventory.view");
    auto q = c.db().prepare(
        "SELECT d.id,d.number,d.created_at AS createdAt,d.warehouse_id AS "
        "warehouseId,COALESCE(w.name,'') AS warehouseName,(SELECT COUNT(*) FROM "
        "waste_document_items x WHERE x.document_id=d.id) AS lineCount,"
        "d.total_minor AS totalMinor,d.note,CASE WHEN d.cancelled_at IS NULL "
        "THEN 'active' ELSE 'cancelled' END AS status,COALESCE(u.full_name,'') "
        "AS actorName FROM waste_documents d LEFT JOIN warehouses w ON "
        "w.id=d.warehouse_id LEFT JOIN users u ON u.id=d.actor_id WHERE "
        "d.created_at>=:from AND d.created_at<:to AND (:w='' OR "
        "d.warehouse_id=:w) ORDER BY d.created_at DESC LIMIT 1000");
    q.bind(":from", p.value("from", std::int64_t{0}))
        .bind(":to", p.value("to", nowMs() + 86400000))
        .bind(":w", p.value("warehouseId", std::string{}));
    return Json{{"documents", q.rows()}};
  }
  if (action == "waste.get") {
    c.requirePermission("inventory.view");
    return document(c, p.at("id").get<std::string>());
  }
  c.requirePermission("inventory.adjust");
  db::Transaction tx(c.db());
  services::Idempotency idem(c);
  const auto key = r.idempotencyKey.empty()
                       ? p.value("idempotencyKey", std::string{})
                       : r.idempotencyKey;
  if (!key.empty())
    if (auto v = idem.begin(key, action, p))
      return *v;
  Json result;
  if (action == "waste.save") {
    const auto replace = p.value("id", std::string{});
    std::string id, number, warehouse;
    if (!replace.empty()) {
      const auto old = document(c, replace);
      require(old.at("status") == "active", "Ləğv edilmiş zay qaiməsini dəyişmək olmaz");
      undo(c, old, "Zay qaiməsi düzəldildi");
      auto drop = c.db().prepare("DELETE FROM waste_document_items WHERE document_id=:id");
      drop.bind(":id", replace);
      drop.exec();
      id = replace;
      number = old.at("number").get<std::string>();
      warehouse = old.at("warehouseId").get<std::string>();
    } else {
      warehouse = p.value("warehouseId", std::string{});
      auto wh = c.db().prepare("SELECT 1 FROM warehouses WHERE id=:id AND active=1");
      wh.bind(":id", warehouse);
      require(wh.step(), "Anbar tapılmadı");
      id = "waste-" + crypto::uuid4();
      auto seq = c.db().prepare("SELECT COALESCE(MAX(CAST(SUBSTR(number,3) AS INTEGER)),0)+1 FROM waste_documents");
      seq.step();
      char buf[32];
      std::snprintf(buf, sizeof(buf), "Z-%05lld", static_cast<long long>(seq.columnInt(0)));
      number = buf;
    }
    const auto note = p.value("note", std::string{});
    require(note.find_first_not_of(" \n\r\t") != std::string::npos, "Zay səbəbini yazın");
    const auto lines = p.value("lines", Json::array());
    require(!lines.empty(), "Zay ediləcək mal seçin");
    const auto now = nowMs();
    if (replace.empty()) {
      auto ins = c.db().prepare(
          "INSERT INTO waste_documents(id,number,warehouse_id,note,actor_id,"
          "created_at,updated_at) VALUES(:id,:no,:w,:n,:a,:at,:at)");
      ins.bind(":id", id).bind(":no", number).bind(":w", warehouse).bind(":n", note)
          .bindOptional(":a", c.session().userId).bind(":at", now);
      ins.exec();
    }
    services::InventoryService inv(c);
    Money total = 0;
    for (const auto &l : lines) {
      const auto good = l.value("ingredientId", std::string{});
      const auto qty = l.value("qtyMilli", std::int64_t{0});
      require(!good.empty() && qty > 0, "Miqdar sıfırdan böyük olmalıdır");
      auto cost = c.db().prepare("SELECT cost_minor FROM ingredients WHERE id=:id");
      cost.bind(":id", good);
      require(cost.step(), "Mal tapılmadı");
      require(inv.levelOf(good, warehouse) >= qty, "Anbarda zay üçün bu qədər mal yoxdur");
      inv.move(good, warehouse, -qty, "waste", id, note);
      const Money unit = cost.columnInt(0), sum = unit * qty / 1000;
      total += sum;
      auto item = c.db().prepare(
          "INSERT INTO waste_document_items(id,document_id,ingredient_id,qty_milli,"
          "cost_minor,total_minor) VALUES(:id,:d,:g,:q,:c,:t)");
      item.bind(":id", crypto::uuid4()).bind(":d", id).bind(":g", good).bind(":q", qty)
          .bind(":c", unit).bind(":t", sum);
      item.exec();
    }
    auto up = c.db().prepare("UPDATE waste_documents SET total_minor=:t,note=:n,updated_at=:at WHERE id=:id");
    up.bind(":t", total).bind(":n", note).bind(":at", now).bind(":id", id);
    up.exec();
    c.auditRequired(replace.empty() ? "waste.create" : "waste.edit", "waste_document", id,
                    Json{{"number", number}, {"totalMinor", total}});
    result = document(c, id);
  } else if (action == "waste.delete") {
    const auto id = p.at("id").get<std::string>();
    const auto old = document(c, id);
    require(old.at("status") == "active", "Zay qaiməsi artıq ləğv edilib");
    undo(c, old, "Zay qaiməsi ləğv edildi");
    auto up = c.db().prepare("UPDATE waste_documents SET cancelled_at=:at,updated_at=:at WHERE id=:id");
    up.bind(":at", nowMs()).bind(":id", id);
    up.exec();
    c.auditRequired("waste.delete", "waste_document", id, Json{{"number", old.at("number")}});
    result = Json{{"ok", true}, {"id", id}};
  } else
    require(false, "Naməlum zay əməliyyatı");
  if (!key.empty())
    idem.complete(key, result, "waste_document", result.value("id", std::string{}));
  tx.commit();
  return result;
}
} // namespace pos::handlers::waste_documents
