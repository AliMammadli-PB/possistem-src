#pragma once
// Included within Application.cpp's private namespace: uses its validated
// permission, audit and clock helpers, with the same native transaction.
inline nlohmann::json cartShape(const nlohmann::json &lines) {
  std::map<std::string, std::int64_t> counts;
  for (const auto &l : lines) {
    const auto id = l.at("productId").get<std::string>();
    const auto q = l.contains("qtyMilli") && !l["qtyMilli"].is_null()
                       ? l["qtyMilli"].get<std::int64_t>()
                       : static_cast<std::int64_t>(
                             std::llround(l.value("qty", 0.0) * 1000));
    if (q < 0 || q > 1000000000000LL)
      throw PosError("E_VALIDATION", "Miqdar düzgün deyil");
    counts[id] += q;
  }
  nlohmann::json shape = nlohmann::json::object();
  for (const auto &[id, qty] : counts)
    if (qty)
      shape[id] = qty;
  return shape;
}
inline nlohmann::json cartState(db::Database &db, const nlohmann::json &p) {
  const auto rows =
      db.query("SELECT * FROM cart_drafts WHERE id=? AND actor_id=?",
               {requireString(p, "cartId"), requireString(p, "actorId")});
  if (rows.empty() || rows[0].at("completed").get<int>())
    return {{"lines", nlohmann::json::array()},
            {"revision", 0},
            {"dirty", false},
            {"completed", !rows.empty()}};
  const auto &r = rows[0];
  return {
      {"lines", nlohmann::json::parse(r.at("lines_json").get<std::string>())},
      {"revision", r.at("revision")},
      {"dirty", r.at("dirty").get<int>() != 0},
      {"changes",
       nlohmann::json::parse(r.at("changes_json").get<std::string>())},
      {"discountMinor", r.at("discount_minor")},
      {"completed", false}};
}
inline nlohmann::json cartSync(db::Database &db, const nlohmann::json &p) {
  if (p.value("role", std::string{}).empty())
    throw PosError("PERMISSION_DENIED", "Giriş tələb olunur");
  const auto id = requireString(p, "cartId"),
             actor = requireString(p, "actorId");
  const auto lines = p.at("lines");
  if (!lines.is_array() || lines.size() > 1000)
    throw PosError("E_VALIDATION", "Səbət düzgün deyil");
  nlohmann::json changes = nlohmann::json::array();
  const auto shape = cartShape(lines);
  const auto rows = db.query(
      "SELECT * FROM cart_drafts WHERE id=? AND actor_id=?", {id, actor});
  bool dirty = false;
  int rev = 1;
  const auto discount = p.value("discountMinor", std::int64_t{0});
  if (!rows.empty() && !rows[0].at("completed").get<int>()) {
    const auto &r = rows[0];
    changes = nlohmann::json::parse(r.at("changes_json").get<std::string>());
    dirty = r.at("dirty").get<int>() != 0;
    rev = r.at("revision").get<int>();
    const auto previous =
        cartShape(nlohmann::json::parse(r.at("lines_json").get<std::string>()));
    if (shape == previous &&
        discount == r.at("discount_minor").get<std::int64_t>())
      return cartState(db, p);
    for (auto it = previous.begin(); it != previous.end(); ++it)
      if (shape.value(it.key(), std::int64_t{0}) <
          it.value().get<std::int64_t>()) {
        dirty = true;
        changes.push_back(
            {{"productId", it.key()},
             {"fromMilli", it.value()},
             {"toMilli", shape.value(it.key(), std::int64_t{0})}});
      }
    if (discount > r.at("discount_minor").get<std::int64_t>()) {
      dirty = true;
      changes.push_back(
          {{"discountFrom", r.at("discount_minor")}, {"discountTo", discount}});
    }
    rev++;
  }
  db.execBound(
      "INSERT INTO "
      "cart_drafts(id,actor_id,lines_json,revision,dirty,discount_minor,"
      "changes_json,completed,updated_at) VALUES(?,?,?,?,?,?,?,0,?) ON "
      "CONFLICT(id) DO UPDATE SET "
      "lines_json=excluded.lines_json,revision=excluded.revision,dirty="
      "excluded.dirty,discount_minor=excluded.discount_minor,changes_json="
      "excluded.changes_json,completed=0,updated_at=excluded.updated_at",
      {id, actor, lines.dump(), std::to_string(rev), dirty ? "1" : "0",
       std::to_string(discount), changes.dump(), std::to_string(nowMs())});
  return cartState(db, p);
}
inline nlohmann::json cartApprove(db::Database &db, const nlohmann::json &p) {
  const auto approver = p.value("approverId", std::string{}),
             role = p.value("approverRole", std::string{});
  if (approver.empty() || (role != "manager" && role != "head_cashier"))
    throw PosError("PERMISSION_DENIED", "İcazəli rəhbərin PIN-i tələb olunur");
  auto auth = p;
  auth["actorId"] = approver;
  auth["role"] = role;
  auth.erase("approverId");
  auth.erase("approverRole");
  requirePermission(db, auth, "SALE_CANCEL");
  auto state = cartState(db, p);
  if (state.at("revision").get<int>() != p.value("revision", 0))
    throw PosError("E_VALIDATION", "Səbət dəyişib, yenidən təsdiqləyin");
  db.begin();
  try {
    db.execBound(
        "UPDATE cart_drafts SET "
        "changes_json='[]',dirty=0,approved_revision=revision,approver_id=? "
        "WHERE id=? AND actor_id=?",
        {approver, requireString(p, "cartId"), requireString(p, "actorId")});
    audit(db, requireString(p, "actorId"), "CART_CHANGES_APPROVED",
          nlohmann::json{{"cartId", p.at("cartId")},
                         {"revision", state.at("revision")},
                         {"approverId", approver},
                         {"lines", state.at("lines")},
                         {"changes", state.at("changes")}}
              .dump());
    db.commit();
  } catch (...) {
    db.rollback();
    throw;
  }
  return cartState(db, p);
}
inline void validateCart(db::Database &db, const nlohmann::json &p,
                         const nlohmann::json &lines) {
  if (!p.value("requireCartApproval", false))
    return;
  const auto state = cartState(db, p);
  if (state.at("dirty") == true || state.value("completed", false) ||
      state.at("revision").get<int>() != p.value("cartRevision", 0) ||
      cartShape(state.at("lines")) != cartShape(lines) ||
      state.value("discountMinor", std::int64_t{0}) !=
          p.value("discountMinor", std::int64_t{0}))
    throw PosError("CART_APPROVAL_REQUIRED",
                   "Səbət dəyişikliklərini rəhbər PIN-i ilə təsdiqləyin");
}
inline void completeCart(db::Database &db, const nlohmann::json &p) {
  if (p.value("requireCartApproval", false))
    db.execBound("UPDATE cart_drafts SET completed=1 WHERE id=? AND actor_id=?",
                 {requireString(p, "cartId"), requireString(p, "actorId")});
}
