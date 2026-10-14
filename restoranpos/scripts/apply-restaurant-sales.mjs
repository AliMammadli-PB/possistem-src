#!/usr/bin/env node
/**
 * 1.7.27 — Satışlar, one Partnyorlar list, obyekt everywhere.
 *
 *  - Satışlar (Əməliyyatlar): every closed bill as a sales invoice — obyekt,
 *    kassa, table, waiter, who closed it, discount, cash / card / partner
 *    debt. Returns (payments.refund by line), a period report (by waiter, by
 *    obyekt, best sellers). Correct (sales.update) and delete (sales.delete)
 *    only with the sales.edit / sales.delete permissions from the role screen.
 *  - Alışlar: invoice and return correction / deletion under purchases.edit /
 *    purchases.delete.
 *  - Partnyorlar: suppliers in the one list (no separate block below), sorted
 *    by name, filter by type and by obyekt; a person belongs to an obyekt.
 *  - Maaşlar, Xərclər: obyekt filter and column.
 * Runs after apply-restaurant-purchases-v2.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_SALES_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}
function cut(src, from, to, repl, label) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0 || src.indexOf(from, a + 1) >= 0) throw new Error(`${label}: anchors not found once`);
  return src.slice(0, a) + repl + src.slice(b);
}

{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes('"sales.list":')) {
    m = replaceOnce(m, '"purchases.update":{auth:!0,perm:"suppliers.manage"', '"purchases.update":{auth:!0,perm:"purchases.edit"', 'main purchases.update perm');
    m = replaceOnce(m, 'Cn={', 'Cn={"sales.list":{auth:!0,perm:"sales.view",timeout:15e3,idempotent:!1},"sales.get":{auth:!0,perm:"sales.view",timeout:8e3,idempotent:!1},"sales.update":{auth:!0,perm:"sales.edit",timeout:3e4,idempotent:!0},"sales.delete":{auth:!0,perm:"sales.delete",timeout:3e4,idempotent:!0},"purchases.delete":{auth:!0,perm:"purchases.delete",timeout:3e4,idempotent:!0},"purchases.deleteReturn":{auth:!0,perm:"purchases.delete",timeout:3e4,idempotent:!0},', 'main policy');
    fs.writeFileSync(MAIN, m);
    console.log('main: sales');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('"sales.list"')) {
    p = replaceOnce(p, '    updatePurchase: (input, options) => call("purchases.update", input, options),',
      '    updatePurchase: (input, options) => call("purchases.update", input, options),\n    deletePurchase: (purchaseId) => call("purchases.delete", { purchaseId }),\n    deleteReturn: (returnId) => call("purchases.deleteReturn", { returnId }),',
      'preload suppliers');
    p = replaceOnce(p, '\n  cashAccounts: {', `
  sales: {
    list: (from, to) => call("sales.list", { from, to }, { timeoutMs: 15000 }),
    get: (orderId) => call("sales.get", { orderId }),
    update: (input, options) => call("sales.update", input, options),
    remove: (input) => call("sales.delete", input)
  },

  cashAccounts: {`, 'preload sales');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: sales');
  }
}

const SALES = String.raw`${MARK}
function psDayRange(kind, fromStr, toStr) {
  const d = new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (kind === "yesterday") return [today - 86400000, today];
  if (kind === "custom") {
    const f = fromStr ? new Date(fromStr + "T00:00").getTime() : today;
    const t = toStr ? new Date(toStr + "T00:00").getTime() + 86400000 : f + 86400000;
    return [f, Math.max(t, f + 1)];
  }
  return [psPeriodStart(kind, 0), today + 86400000];
}
function psPayLabel(s) {
  return [(s.cashMinor ?? 0) > 0 ? "Nağd " + formatMoney(s.cashMinor) : "", (s.cardMinor ?? 0) > 0 ? "Kart " + formatMoney(s.cardMinor) : "",
    (s.accountMinor ?? 0) > 0 ? "Borc " + formatMoney(s.accountMinor) : ""].filter(Boolean).join(" · ") || "—";
}
function psBadge(text, tone) {
  return psH("span", { className: "ps-badge ps-badge-" + (tone || "muted") }, text);
}
function psMetric(label, value, sub, tone) {
  return psH("div", { key: label, className: "ps-stock-metric" },
    psH("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint" }, label),
    psH("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream", style: tone ? { color: tone } : null }, value),
    psH("p", { className: "mt-1 text-[11px] text-muted" }, sub));
}
function psObjectFilter(objects, value, onChange, all) {
  if (!objects.length) return null;
  return psH("select", { value, onChange: (e) => onChange(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" },
    psH("option", { value: "" }, all || "Bütün obyektlər"), objects.map((o) => psH("option", { key: o.id, value: o.id }, o.name)));
}
const PS_REFUND_REASONS = ["Müştəri imtina etdi", "Səhv sifariş", "Keyfiyyət problemi", "Gecikmə", "Digər"];

function OpsSales() {
  const h = psH;
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const canEdit = hasPermission("sales.edit");
  const canDelete = hasPermission("sales.delete");
  const canRefund = hasPermission("payment.refund");
  const accData = usePsAccounts();
  const objects = accData?.objects ?? [];
  const tills = (accData?.accounts ?? []).filter((a) => a.kind === "till");
  const [period, setPeriod] = reactExports.useState("day");
  const [range, setRange] = reactExports.useState({ from: "", to: "" });
  const [view, setView] = reactExports.useState("sales");
  const [objectId, setObjectId] = reactExports.useState("");
  const [accountId, setAccountId] = reactExports.useState("");
  const [waiterId, setWaiterId] = reactExports.useState("");
  const [query, setQuery] = reactExports.useState("");
  const [showDeleted, setShowDeleted] = reactExports.useState(false);
  const [data, setData] = reactExports.useState(null);
  const [detail, setDetail] = reactExports.useState(null);
  const [edit, setEdit] = reactExports.useState(null);
  const [ret, setRet] = reactExports.useState(null);
  const [del, setDel] = reactExports.useState(null);
  const [partners, setPartners] = reactExports.useState([]);
  const reload = reactExports.useCallback(async () => {
    const [from, to] = psDayRange(period, range.from, range.to);
    const r = await window.pos.sales.list(from, to);
    if (r.success) setData(r.data); else toast(r.error.message, "danger");
  }, [period, range.from, range.to]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!data) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");

  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
  const needle = query.trim().toLocaleLowerCase("az");
  const match = (s) => (!objectId || s.objectId === objectId) && (!accountId || s.accountId === accountId) && (!waiterId || s.waiterId === waiterId)
    && (!needle || [s.number, s.customerName, s.tableName, s.waiterName].some((v) => String(v || "").toLocaleLowerCase("az").includes(needle)));
  const all = (data.sales ?? []).filter(match);
  const live = all.filter((s) => !s.deletedAt);
  const rows = showDeleted ? all : live;
  const refunds = (data.refunds ?? []).filter((r) => !objectId || r.objectId === objectId);
  const sum = (list, key) => list.reduce((t, x) => t + (Number(x[key]) || 0), 0);
  const total = sum(live, "totalMinor");
  const refundTotal = sum(refunds, "amountMinor");
  const waiters = [...new Map((data.sales ?? []).map((s) => [s.waiterId, s.waiterName || "—"])).entries()];
  const group = (key, label) => {
    const map = new Map();
    for (const s of live) {
      const k = s[key] || "—";
      const row = map.get(k) || { name: label(s), count: 0, total: 0, discount: 0 };
      row.count += 1; row.total += Number(s.totalMinor) || 0; row.discount += Number(s.discountMinor) || 0;
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  };

  const load = async (s) => {
    const r = await window.pos.sales.get(s.id);
    if (!r.success) { toast(r.error.message, "danger"); return null; }
    return r.data;
  };
  const openDetail = async (s) => { const d = await load(s); if (d) setDetail(d); };
  const openEdit = async (s) => {
    const d = await load(s);
    if (!d) return;
    if (hasPermission("customers.view") && !partners.length) {
      const p = await window.pos.guests.list("");
      if (p.success) setPartners((p.data.customers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "az")));
    }
    setEdit({ sale: d, waiterId: d.waiterId, customerId: d.customerId || "", note: d.note || "", discount: ((Number(d.discountMinor) || 0) / 100).toFixed(2),
      lines: (d.items ?? []).filter((i) => i.status !== "voided").map((i) => ({ id: i.id, name: i.name, qty: String(i.quantity), price: ((Number(i.unitPriceMinor) || 0) / 100).toFixed(2),
        perUnitMod: Math.round((Number(i.modifierTotalMinor) || 0) / Math.max(1, Number(i.quantity) || 1)), origQty: Number(i.quantity), origPrice: Number(i.unitPriceMinor) })) });
  };
  const editTotal = edit ? Math.max(0, edit.lines.reduce((t, l) => t + Math.max(0, Math.round(opsNum(l.qty))) * (opsMinor(l.price || "0") + l.perUnitMod), 0) - opsMinor(edit.discount || "0")) : 0;
  const saveEdit = () => {
    const d = edit.sale;
    const input = { orderId: d.id };
    if (edit.waiterId !== d.waiterId) input.waiterId = edit.waiterId;
    if ((edit.customerId || "") !== (d.customerId || "")) input.customerId = edit.customerId;
    if (edit.note !== (d.note || "")) input.note = edit.note;
    if (!psStockInputValid(edit.discount || "0", { empty: true })) { toast("Endirimi düzgün yazın", "danger"); return; }
    if (opsMinor(edit.discount || "0") !== (Number(d.discountMinor) || 0)) input.discountMinor = opsMinor(edit.discount || "0");
    const lines = [];
    for (const l of edit.lines) {
      const qty = Math.round(opsNum(l.qty));
      if (!psStockInputValid(l.price || "0", { empty: true }) || !Number.isFinite(qty) || qty < 0) { toast(l.name + ": miqdar və qiymət düzgün olmalıdır", "danger"); return; }
      if (qty !== l.origQty || opsMinor(l.price || "0") !== l.origPrice) lines.push({ id: l.id, quantity: qty, unitPriceMinor: opsMinor(l.price || "0") });
    }
    if (lines.length) input.lines = lines;
    if (Object.keys(input).length === 1) { setEdit(null); return; }
    void run(window.pos.sales.update(input, { idempotencyKey: newIdempotencyKey() }), "Satış düzəldildi").then((ok) => { if (ok) setEdit(null); });
  };

  const openReturn = async (s) => {
    const d = await load(s);
    if (!d) return;
    const pays = (d.payments ?? []).filter((p) => p.status === "approved").sort((a, b) => (b.amountMinor ?? 0) - (a.amountMinor ?? 0));
    if (!pays.length) { toast("Bu satışda geri qaytarılacaq ödəniş yoxdur — lazımdırsa düzəliş edin", "danger"); return; }
    const lines = (d.items ?? []).filter((i) => i.status !== "voided").map((i) => ({ id: i.id, name: i.name, max: Math.max(0, (Number(i.quantity) || 0) - (Number(i.refundedQty) || 0)),
      unit: Math.round((Number(i.lineTotalMinor) || 0) / Math.max(1, Number(i.quantity) || 1)), qty: 0 })).filter((l) => l.max > 0);
    setRet({ sale: d, pays, paymentId: pays[0].id, lines, amount: "", reason: PS_REFUND_REASONS[0], custom: "", key: newIdempotencyKey() });
  };
  const retTotal = ret ? ret.lines.reduce((t, l) => t + l.qty * l.unit, 0) : 0;
  const saveReturn = () => {
    const items = ret.lines.filter((l) => l.qty > 0).map((l) => ({ orderItemId: l.id, quantity: l.qty }));
    const amount = items.length ? retTotal : opsMinor(ret.amount || "0");
    if (amount <= 0) { toast("Qaytarılan məhsulu və ya məbləği seçin", "danger"); return; }
    const reason = ret.reason === "Digər" ? ret.custom.trim() : ret.reason;
    if (!reason) { toast("Səbəbi yazın", "danger"); return; }
    void run(window.pos.payments.refund({ paymentId: ret.paymentId, amountMinor: amount, reason, ...(items.length ? { items } : {}) }, { idempotencyKey: ret.key }),
      "Qaytarıldı").then((ok) => { if (ok) setRet(null); });
  };
  const saveDelete = () => {
    if (!del.reason.trim()) { toast("Silinmə səbəbini yazın", "danger"); return; }
    void run(window.pos.sales.remove({ orderId: del.sale.id, reason: del.reason.trim() }), "Satış silindi").then((ok) => { if (ok) setDel(null); });
  };

  const chip = (k, l, value, set) => h("button", { key: k, type: "button", "aria-pressed": value === k, className: "ps-period-chip" + (value === k ? " is-on" : ""), onClick: () => set(k) }, l);
  const select = (value, onChange, first, options) => h("select", { value, onChange: (e) => onChange(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" },
    h("option", { value: "" }, first), options.map(([v, l]) => h("option", { key: v, value: v }, l)));

  return h("div", { className: "space-y-4" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["day", "Bu gün"], ["yesterday", "Dünən"], ["week", "Bu həftə"], ["month", "Bu ay"], ["custom", "Tarix seç"]].map(([k, l]) => chip(k, l, period, setPeriod)),
      period === "custom" ? h("span", { className: "flex items-center gap-1 text-sm text-muted" },
        h("input", { type: "date", value: range.from, onChange: (e) => setRange({ ...range, from: e.target.value }), className: "rounded-xl border border-hairline bg-elevated px-2 py-1.5 text-cream" }), "—",
        h("input", { type: "date", value: range.to, onChange: (e) => setRange({ ...range, to: e.target.value }), className: "rounded-xl border border-hairline bg-elevated px-2 py-1.5 text-cream" })) : null,
      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void reload(), children: "Yenilə" })),

    h("div", { className: "ps-stock-metrics" },
      psMetric("Satış", formatMoney(total), live.length + " qaimə"),
      psMetric("Nağd", formatMoney(sum(live, "cashMinor")), "kassaya"),
      psMetric("Kart", formatMoney(sum(live, "cardMinor")), "banka"),
      psMetric("Borca (partnyor)", formatMoney(sum(live, "accountMinor")), live.filter((s) => (s.accountMinor ?? 0) > 0).length + " satış"),
      psMetric("Endirim", formatMoney(sum(live, "discountMinor")), live.filter((s) => (s.discountMinor ?? 0) > 0).length + " satış"),
      psMetric("Qaytarma", formatMoney(refundTotal), refunds.length + " qaytarma", refundTotal > 0 ? "var(--ps-danger)" : null),
      psMetric("Orta çek", formatMoney(live.length ? Math.round(total / live.length) : 0), sum(live, "guestCount") + " qonaq"),
      psMetric("Xalis", formatMoney(total - refundTotal), "satış − qaytarma", "var(--ps-ok)")),

    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["sales", "Satış qaimələri"], ["returns", "Qaytarmalar"], ["report", "Hesabat"]].map(([k, l]) => chip(k, l, view, setView)),
      psObjectFilter(objects, objectId, (v) => { setObjectId(v); setAccountId(""); }),
      tills.length ? select(accountId, setAccountId, "Bütün kassalar", tills.filter((a) => !objectId || a.objectId === objectId).map((a) => [a.id, a.name + (a.objectName ? " · " + a.objectName : "")])) : null,
      select(waiterId, setWaiterId, "Bütün ofisiantlar", waiters),
      h("input", { value: query, placeholder: "Axtar: № / masa / partnyor", onChange: (e) => setQuery(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" }),
      view === "sales" ? h("label", { className: "flex items-center gap-1 text-sm text-muted" },
        h("input", { type: "checkbox", checked: showDeleted, onChange: (e) => setShowDeleted(e.target.checked) }), "Silinənlər də") : null),

    view === "sales" ? jsxRuntimeExports.jsx(OpsTable, {
      head: ["Qaimə", "Vaxt", "Obyekt / kassa", "Masa", "Ofisiant", "Bağlayan", "Cəm", "Endirim", "Ödəniş", "Partnyor", ""],
      empty: "Bu dövrdə satış yoxdur",
      rows: rows.map((s) => [
        h("span", { className: "flex flex-wrap items-center gap-1" }, h("b", null, "#" + s.number), s.deletedAt ? psBadge("Silinib", "danger") : null, (s.refundedMinor ?? 0) > 0 ? psBadge("Qaytarma " + formatMoney(s.refundedMinor), "warn") : null),
        opsWhen(s.closedAt),
        [s.objectName, s.accountName].filter(Boolean).join(" · ") || "—",
        s.tableName || "—",
        s.waiterName || "—",
        s.closedByName || "—",
        h("b", { style: s.deletedAt ? { textDecoration: "line-through" } : null }, formatMoney(s.totalMinor ?? 0)),
        (s.discountMinor ?? 0) > 0 ? h("span", { title: [s.discountByName, s.discountReason].filter(Boolean).join(" · ") }, formatMoney(s.discountMinor) + (s.discountByName ? " · " + s.discountByName : "")) : "—",
        psPayLabel(s),
        s.customerName || "—",
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openDetail(s), children: "Bax" }),
          !s.deletedAt && canRefund && ((s.cashMinor ?? 0) + (s.cardMinor ?? 0)) > (s.refundedMinor ?? 0) ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openReturn(s), children: "Qaytar" }) : null,
          !s.deletedAt && canEdit ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(s), children: "Düzəliş" }) : null,
          !s.deletedAt && canDelete ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setDel({ sale: s, reason: "" }), children: "Sil" }) : null)
      ])
    }) : null,

    view === "returns" ? jsxRuntimeExports.jsx(OpsTable, {
      head: ["Vaxt", "Satış", "Obyekt", "Mallar", "Məbləğ", "Üsul", "Səbəb", "Kim qaytardı"],
      empty: "Bu dövrdə qaytarma yoxdur",
      rows: refunds.map((r) => [opsWhen(r.createdAt), "#" + r.number, r.objectName || "—", r.items || "Məbləğlə", h("b", { style: { color: "var(--ps-danger)" } }, formatMoney(r.amountMinor ?? 0)),
        r.method === "card" ? "Kart" : r.method === "cash" ? "Nağd" : r.method, r.reason || "—", r.userName || "—"])
    }) : null,

    view === "report" ? h("div", { className: "grid gap-4 lg:grid-cols-2" },
      h("section", { className: "space-y-2" }, h("h3", { className: "ps-recipe-step" }, "Ofisiantlar üzrə"),
        jsxRuntimeExports.jsx(OpsTable, { head: ["Ofisiant", "Satış", "Cəm", "Orta çek", "Endirim"], empty: "Satış yoxdur",
          rows: group("waiterId", (s) => s.waiterName || "—").map((g) => [g.name, String(g.count), h("b", null, formatMoney(g.total)), formatMoney(Math.round(g.total / g.count)), formatMoney(g.discount)]) })),
      h("section", { className: "space-y-2" }, h("h3", { className: "ps-recipe-step" }, "Obyektlər və kassalar üzrə"),
        jsxRuntimeExports.jsx(OpsTable, { head: ["Obyekt / kassa", "Satış", "Cəm", "Orta çek"], empty: "Satış yoxdur",
          rows: group("accountId", (s) => [s.objectName, s.accountName].filter(Boolean).join(" · ") || "Kassaya bağlanmayıb").map((g) => [g.name, String(g.count), h("b", null, formatMoney(g.total)), formatMoney(Math.round(g.total / g.count))]) })),
      h("section", { className: "space-y-2" }, h("h3", { className: "ps-recipe-step" }, "Bağlayanlar üzrə (kassir)"),
        jsxRuntimeExports.jsx(OpsTable, { head: ["Kim bağlayıb", "Satış", "Cəm"], empty: "Satış yoxdur",
          rows: group("closedById", (s) => s.closedByName || "—").map((g) => [g.name, String(g.count), h("b", null, formatMoney(g.total))]) })),
      h("section", { className: "space-y-2" }, h("h3", { className: "ps-recipe-step" }, "Ən çox satılan" + (objectId || accountId || waiterId ? " (bütün obyektlər)" : "")),
        jsxRuntimeExports.jsx(OpsTable, { head: ["Məhsul", "Say", "Məbləğ"], empty: "Satış yoxdur",
          rows: (data.top ?? []).map((t) => [t.name, String(t.quantity), h("b", null, formatMoney(t.totalMinor ?? 0))]) }))) : null,

    detail ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Satış #" + detail.number, onClose: () => setDetail(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "ps-sale-facts" },
        [["Açılıb", opsWhen(detail.openedAt)], ["Bağlanıb", opsWhen(detail.closedAt)], ["Obyekt", detail.objectName || "—"], ["Kassa", detail.accountName || "—"], ["Masa", detail.tableName || "—"],
         ["Qonaq", String(detail.guestCount ?? "—")], ["Ofisiant", detail.waiterName || "—"], ["Hesabı bağlayan", detail.closedByName || "—"], ["Partnyor", detail.customerName || "—"],
         ["Endirim", (detail.discountMinor ?? 0) > 0 ? formatMoney(detail.discountMinor) + (detail.discountByName ? " · " + detail.discountByName : "") + (detail.discountReason ? " · " + detail.discountReason : "") : "—"],
         ["Ödəniş", psPayLabel(detail)], ["Qeyd", detail.note || "—"]].concat(detail.deletedAt ? [["Silinib", opsWhen(detail.deletedAt) + " · " + (detail.deleteReason || "")]] : [])
          .map(([k, v]) => h("div", { key: k }, h("span", null, k), h("b", null, v)))),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Məhsul", "Miqdar", "Qiymət", "Cəm", "Qaytarılıb"], empty: "Məhsul yoxdur",
        rows: (detail.items ?? []).map((i) => [h("span", { style: i.status === "voided" ? { textDecoration: "line-through", opacity: 0.6 } : null }, i.name + (i.note ? " (" + i.note + ")" : "")),
          String(i.quantity), formatMoney(i.unitPriceMinor ?? 0), formatMoney(i.lineTotalMinor ?? 0), (i.refundedQty ?? 0) > 0 ? String(i.refundedQty) : "—"]) }),
      h("div", { className: "ps-purchase-total" }, h("span", null, "Cəm"), h("b", null, formatMoney(detail.totalMinor ?? 0))),
      (detail.payments ?? []).length ? jsxRuntimeExports.jsx(OpsTable, { head: ["Ödəniş", "Üsul", "Məbləğ", "Kim"], empty: "",
        rows: detail.payments.map((p) => [opsWhen(p.createdAt), (p.method === "cash" ? "Nağd" : p.method === "card" ? "Kart" : p.method === "mixed" ? "Qarışıq" : p.method) + (p.status === "canceled" ? " (ləğv)" : ""), formatMoney(p.amountMinor ?? 0), p.userName || "—"]) }) : null,
      (detail.refunds ?? []).length ? jsxRuntimeExports.jsx(OpsTable, { head: ["Qaytarma", "Məbləğ", "Səbəb", "Kim"], empty: "",
        rows: detail.refunds.map((r) => [opsWhen(r.createdAt), formatMoney(r.amountMinor ?? 0), r.reason || "—", r.userName || "—"]) }) : null) }) : null,

    edit ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Satış #" + edit.sale.number + " — düzəliş", onClose: () => setEdit(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Ofisiant (qulluq edən)"),
          h("select", { value: edit.waiterId, className: field, onChange: (e) => setEdit({ ...edit, waiterId: e.target.value }) },
            (edit.sale.waiters ?? []).map((w) => h("option", { key: w.id, value: w.id }, w.name)))),
        h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Partnyor"),
          h("select", { value: edit.customerId, className: field, onChange: (e) => setEdit({ ...edit, customerId: e.target.value }) },
            h("option", { value: "" }, "— Partnyorsuz —"),
            (partners.some((p) => p.id === edit.sale.customerId) || !edit.sale.customerId ? [] : [{ id: edit.sale.customerId, name: edit.sale.customerName }]).concat(partners)
              .map((p) => h("option", { key: p.id, value: p.id }, p.name + (p.kind === "employee" ? " (işçi)" : "")))))),
      h("div", { className: "ps-recipe-rows" }, edit.lines.map((l, i) => h("div", { key: l.id, className: "ps-sale-edit-row" },
        h("span", { className: "ps-recipe-name" }, l.name),
        h("label", { className: "ps-recipe-price" }, h("span", null, "Miqdar"),
          h("input", { inputMode: "numeric", value: l.qty, onChange: (e) => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) }) })),
        h("label", { className: "ps-recipe-price" }, h("span", null, "Qiymət (₼)"),
          h("input", { inputMode: "decimal", value: l.price, onChange: (e) => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) }) })),
        h("button", { type: "button", className: "ps-recipe-remove", "aria-label": "Sil", title: "Bu məhsulu satışdan çıxar", onClick: () => setEdit({ ...edit, lines: edit.lines.map((x, j) => (j === i ? { ...x, qty: "0" } : x)) }) }, "×")))),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Endirim (₼)", value: edit.discount, onChange: (v) => setEdit({ ...edit, discount: v }), placeholder: "0.00" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: edit.note, onChange: (v) => setEdit({ ...edit, note: v }) })),
      h("div", { className: "ps-purchase-total" }, h("span", null, "Yeni cəm (təxmini)"), h("b", null, formatMoney(editTotal))),
      h("p", { className: "text-xs text-muted" }, "Fərq partnyorun borcuna (satış borca idisə) və ya ödənişə yazılır; anbar da yeni miqdara görə düzəlir. Miqdarı 0 yazsanız məhsul satışdan çıxır."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveEdit, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setEdit(null), children: "İmtina" }))) }) : null,

    ret ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Satış #" + ret.sale.number + " — geri qaytarma", onClose: () => setRet(null), busy, children: h("div", { className: "space-y-3" },
      ret.pays.length > 1 ? h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Hansı ödənişdən"),
        h("select", { value: ret.paymentId, className: field, onChange: (e) => setRet({ ...ret, paymentId: e.target.value }) },
          ret.pays.map((p) => h("option", { key: p.id, value: p.id }, (p.method === "card" ? "Kart" : p.method === "cash" ? "Nağd" : "Qarışıq") + " · " + formatMoney(p.amountMinor ?? 0))))) : null,
      ret.lines.length ? h("div", { className: "ps-recipe-rows" }, ret.lines.map((l, i) => h("div", { key: l.id, className: "ps-sale-return-row" },
        h("span", { className: "ps-recipe-name" }, l.name, h("small", null, " · ən çox " + l.max)),
        h("span", { className: "ps-qty-stepper" },
          h("button", { type: "button", onClick: () => setRet({ ...ret, lines: ret.lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, x.qty - 1) } : x)) }) }, "−"),
          h("b", null, String(l.qty)),
          h("button", { type: "button", onClick: () => setRet({ ...ret, lines: ret.lines.map((x, j) => (j === i ? { ...x, qty: Math.min(x.max, x.qty + 1) } : x)) }) }, "+")),
        h("b", { className: "ps-recipe-cost" }, formatMoney(l.qty * l.unit))))) : null,
      !ret.lines.some((l) => l.qty > 0) ? jsxRuntimeExports.jsx(OpsField, { label: "Və ya məbləğlə (₼)", value: ret.amount, onChange: (v) => setRet({ ...ret, amount: v }), placeholder: "0.00" }) : null,
      h("div", { className: "flex flex-wrap gap-2" }, PS_REFUND_REASONS.map((k) => chip(k, k, ret.reason, (v) => setRet({ ...ret, reason: v })))),
      ret.reason === "Digər" ? jsxRuntimeExports.jsx(OpsField, { label: "Səbəb", value: ret.custom, onChange: (v) => setRet({ ...ret, custom: v }) }) : null,
      h("div", { className: "ps-purchase-total" }, h("span", null, "Müştəriyə qaytarılır"), h("b", null, formatMoney(ret.lines.some((l) => l.qty > 0) ? retTotal : opsMinor(ret.amount || "0")))),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: saveReturn, children: "Qaytar" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setRet(null), children: "İmtina" }))) }) : null,

    del ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Satış #" + del.sale.number + " silinsin?", onClose: () => setDel(null), busy, children: h("div", { className: "space-y-3" },
      h("p", { className: "text-sm text-muted" }, formatMoney(del.sale.totalMinor ?? 0) + " — ödəniş kassadan çıxır, partnyor borcu silinir, məhsullar anbara qayıdır. Qaimə \"Silinənlər\"də qalır."),
      jsxRuntimeExports.jsx(OpsField, { label: "Səbəb", value: del.reason, onChange: (v) => setDel({ ...del, reason: v }), placeholder: "məs. səhv vurulub, test satışı" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: saveDelete, children: "Sil" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setDel(null), children: "İmtina" }))) }) : null);
}

function OpsPartners() {
  const h = psH;
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const canPeople = hasPermission("customers.view");
  const canSuppliers = hasPermission("suppliers.view");
  const accData = usePsAccounts();
  const objects = accData?.objects ?? [];
  const objectName = (id) => (objects.find((o) => o.id === id) || {}).name || "";
  const [type, setType] = reactExports.useState("all");
  const [objectId, setObjectId] = reactExports.useState("");
  const [query, setQuery] = reactExports.useState("");
  const [people, setPeople] = reactExports.useState([]);
  const [suppliers, setSuppliers] = reactExports.useState([]);
  const [form, setForm] = reactExports.useState(null);
  const [ask, setAsk] = reactExports.useState(null);
  const [pay, setPay] = reactExports.useState(null);
  const [ledger, setLedger] = reactExports.useState(null);
  const [confirmAsk, confirmDialog] = useConfirm();
  const reload = reactExports.useCallback(async () => {
    const [p, s] = await Promise.all([canPeople ? window.pos.guests.list("") : null, canSuppliers ? window.pos.suppliers.list() : null]);
    if (p?.success) setPeople(p.data.customers ?? []);
    if (s?.success) setSuppliers(s.data.suppliers ?? []);
  }, [canPeople, canSuppliers]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";

  const rows = [
    ...people.map((p) => ({ key: "c" + p.id, src: "person", type: p.kind === "employee" ? "employee" : "customer", id: p.id, name: p.name, phone: p.phone || "", objectId: p.objectId || "", salaryMinor: p.salaryMinor ?? 0, owesUs: p.debtMinor ?? 0, weOwe: 0, raw: p })),
    ...suppliers.map((x) => ({ key: "s" + x.id, src: "supplier", type: "supplier", id: x.id, name: x.name, phone: x.phone || "", contact: x.contact || "", objectId: "", salaryMinor: 0, owesUs: 0, weOwe: x.dueMinor ?? 0, raw: x }))
  ].sort((a, b) => a.name.localeCompare(b.name, "az"));
  const needle = query.trim().toLocaleLowerCase("az");
  const inScope = rows.filter((r) => (!objectId || r.objectId === objectId) && (!needle || (r.name + " " + r.phone).toLocaleLowerCase("az").includes(needle)));
  const shown = inScope.filter((r) => type === "all" || r.type === type);
  const count = (t) => inScope.filter((r) => t === "all" || r.type === t).length;
  const sum = (key) => shown.reduce((t, r) => t + (Number(r[key]) || 0), 0);

  const save = async () => {
    if (!form.name.trim()) { toast("Ad tələb olunur", "danger"); return; }
    if (form.type === "supplier") {
      const ok = await run(window.pos.suppliers.save({ ...(form.id ? { id: form.id } : {}), name: form.name.trim(), phone: form.phone.trim(), contact: (form.contact || "").trim() }), form.id ? "Saxlanıldı" : "Partnyor əlavə olundu");
      if (ok) setForm(null);
      return;
    }
    if (form.type === "employee" && !psStockInputValid(form.salary || "0", { empty: true })) { toast("Maaşı düzgün yazın", "danger"); return; }
    const ok = await run(window.pos.guests.save({
      ...(form.id ? { id: form.id } : {}), name: form.name.trim(), phone: form.phone.trim(),
      kind: form.type, salaryMinor: form.type === "employee" ? opsMinor(form.salary || "0") : 0, objectId: form.objectId || ""
    }), form.id ? "Saxlanıldı" : "Partnyor əlavə olundu");
    if (ok) setForm(null);
  };
  const openLedger = async (r) => {
    const res = r.src === "supplier" ? await window.pos.suppliers.ledger(r.id) : await window.pos.guests.ledger(r.id);
    setLedger({ row: r, rows: res.success ? (res.data.entries ?? res.data.ledger ?? []) : [] });
  };
  const remove = async (r) => {
    if (!(await confirmAsk('"' + r.name + '" partnyorlardan silinsin? Keçmiş hesab qalır.', { danger: true }))) return;
    if (r.src === "supplier") void run(window.pos.suppliers.save({ id: r.id, name: r.name, phone: r.phone, contact: r.contact || "", active: false }), "Silindi");
    else void run(window.pos.guests.deactivate(r.id), "Silindi");
  };
  const edit = (r) => setForm({ id: r.id, type: r.type, name: r.name, phone: r.phone, contact: r.contact || "", salary: ((r.salaryMinor ?? 0) / 100).toFixed(2), objectId: r.objectId });
  const kindLabel = (r, e) => e.kind === "payment" ? "Ödəniş" : e.kind === "adjustment" ? "Düzəliş" : (e.amountMinor ?? 0) < 0 ? (r.src === "supplier" ? "Qaytarma / silinmə" : "Qaytarma / azalma") : r.src === "supplier" ? "Alış (borc)" : "Borc";

  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      psMetric("Partnyor", String(shown.length), type === "all" ? "hamısı" : PS_PARTNER_TYPES[type]),
      psMetric("Bizə borclu", formatMoney(sum("owesUs")), shown.filter((r) => r.owesUs > 0).length + " partnyor", sum("owesUs") > 0 ? "var(--ps-danger)" : null),
      psMetric("Təchizatçılara borcumuz", formatMoney(sum("weOwe")), shown.filter((r) => r.weOwe > 0).length + " təchizatçı", sum("weOwe") > 0 ? "var(--ps-danger)" : null),
      psMetric("Aylıq maaş fondu", formatMoney(sum("salaryMinor")), shown.filter((r) => r.type === "employee").length + " işçi")),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["all", "Hamısı"], ["supplier", "Təchizatçı"], ["employee", "İşçi"], ["customer", "Müştəri"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": type === k, className: "ps-period-chip" + (type === k ? " is-on" : ""), onClick: () => setType(k) }, l + " (" + count(k) + ")")),
      psObjectFilter(objects, objectId, setObjectId),
      h("input", { value: query, placeholder: "Axtar: ad / telefon", onChange: (e) => setQuery(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" }),
      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ type: type === "all" ? "customer" : type, name: "", phone: "", contact: "", salary: "", objectId }), children: "+ Yeni partnyor" })),

    jsxRuntimeExports.jsx(OpsTable, {
      head: ["Partnyor", "Tip", "Obyekt", "Telefon", "Aylıq maaş", "Borc", ""],
      empty: "Bu seçimdə partnyor yoxdur",
      rows: shown.map((r) => [
        h("span", { className: "font-medium text-cream" }, r.name, r.contact ? h("small", { className: "ml-1 text-muted" }, "· " + r.contact) : null),
        PS_PARTNER_TYPES[r.type],
        objectName(r.objectId) || "—",
        r.phone || "—",
        r.type === "employee" ? formatMoney(r.salaryMinor) : "—",
        r.weOwe > 0 ? h("span", { style: { color: "var(--ps-danger)", fontWeight: 600 } }, "Borcumuz " + formatMoney(r.weOwe))
          : r.owesUs > 0 ? h("span", { style: { color: "var(--ps-danger)", fontWeight: 600 } }, "Bizə borc " + formatMoney(r.owesUs))
          : r.weOwe < 0 ? h("span", { style: { color: "var(--ps-ok)" } }, "Avans " + formatMoney(-r.weOwe)) : formatMoney(0),
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openLedger(r), children: "Hesab" }),
          r.owesUs > 0 && hasPermission("customers.credit") ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setAsk({ person: r.raw, value: "" }), children: "Borcu al" }) : null,
          r.weOwe > 0 && hasPermission("suppliers.pay") ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => setPay({ row: r, value: "", note: "" }), children: "Ödə" }) : null,
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => edit(r), children: "Redaktə" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void remove(r), children: "Sil" }))
      ])
    }),

    ledger ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, ledger.row.name + " — hesab · " + (ledger.row.src === "supplier" ? "borcumuz " + formatMoney(ledger.row.weOwe) : "borc " + formatMoney(ledger.row.owesUs))),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setLedger(null), children: "Bağla" })),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Tarix", "Növ", "Məbləğ", "Qeyd"], empty: "Hərəkət yoxdur",
        rows: ledger.rows.map((e) => [opsWhen(e.createdAt), kindLabel(ledger.row, e),
          h("span", { style: { color: e.kind === "charge" && (e.amountMinor ?? 0) > 0 ? "var(--ps-danger)" : "var(--ps-ok)", fontWeight: 600 } }, formatMoney(Math.abs(e.amountMinor ?? 0))),
          [e.orderNumber ? "#" + e.orderNumber : "", e.note || ""].filter(Boolean).join(" · ") || "—"]) })) : null,

    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Partnyoru redaktə et" : "Yeni partnyor", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("label", { className: "block text-sm" },
        h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Partnyorun tipi"),
        h("select", { value: form.type, disabled: Boolean(form.id), className: field, onChange: (e) => setForm({ ...form, type: e.target.value }) },
          Object.entries(PS_PARTNER_TYPES).filter(([k]) => (k === "supplier" ? canSuppliers : canPeople)).map(([k, l]) => h("option", { key: k, value: k }, l)))),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: form.name, onChange: (v) => setForm({ ...form, name: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Telefon", value: form.phone, onChange: (v) => setForm({ ...form, phone: v }) }),
        form.type === "employee" ? jsxRuntimeExports.jsx(OpsField, { label: "Aylıq maaş (₼)", value: form.salary, onChange: (v) => setForm({ ...form, salary: v }), placeholder: "0.00" }) : null,
        form.type === "supplier" ? jsxRuntimeExports.jsx(OpsField, { label: "Əlaqədar şəxs", value: form.contact, onChange: (v) => setForm({ ...form, contact: v }) }) : null,
        form.type !== "supplier" && objects.length ? h("label", { className: "block text-sm" },
          h("span", { className: "text-xs uppercase tracking-wide text-faint" }, form.type === "employee" ? "Hansı obyektdə işləyir" : "Obyekt"),
          h("select", { value: form.objectId || "", className: field, onChange: (e) => setForm({ ...form, objectId: e.target.value }) },
            h("option", { value: "" }, "— Seçilməyib —"), objects.map((o) => h("option", { key: o.id, value: o.id }, o.name)))) : null),
      form.type === "employee" ? h("p", { className: "text-xs text-muted" }, "İşçinin (və ailəsinin) yeməkləri sifarişdə onun adına borc yazılır və Maaşlar bölməsində maaşından çıxılır.") : null,
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void save(), children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(null), children: "İmtina" }))) }) : null,

    ask ? jsxRuntimeExports.jsx(PsAdminDialog, { title: ask.person.name + " — borcu al", onClose: () => setAsk(null), busy, children: h("div", { className: "space-y-3" },
      h("p", { className: "text-xs text-muted" }, "Cari borc: " + formatMoney(ask.person.debtMinor ?? 0)),
      jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: ask.value, onChange: (v) => setAsk({ ...ask, value: v }) }),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: ask.accountId, onChange: (v) => setAsk((p) => (p ? { ...p, accountId: v } : p)), label: "Pul hansı kassaya girir" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => {
          if (!psStockInputValid(ask.value) || opsMinor(ask.value) <= 0) { toast("Düzgün məbləğ yazın", "danger"); return; }
          void run(window.pos.guests.payDebt({ customerId: ask.person.id, amountMinor: opsMinor(ask.value), accountId: ask.accountId || "" }), "Ödəniş qəbul edildi").then((ok) => { if (ok) setAsk(null); });
        }, children: "Təsdiq et" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setAsk(null), children: "Bağla" }))) }) : null,

    pay ? jsxRuntimeExports.jsx(PsAdminDialog, { title: pay.row.name + " — ödəniş", onClose: () => setPay(null), busy, children: h("div", { className: "space-y-3" },
      h("p", { className: "text-xs text-muted" }, "Borcumuz: " + formatMoney(pay.row.weOwe) + ". Bir hissəsini ödəsəniz, qalanı borc olaraq qalır."),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: pay.value, onChange: (v) => setPay({ ...pay, value: v }), placeholder: "0.00" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: pay.note, onChange: (v) => setPay({ ...pay, note: v }) })),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: pay.accountId, onChange: (v) => setPay((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassadan ödənilir" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => {
          if (!psStockInputValid(pay.value) || opsMinor(pay.value) <= 0) { toast("Məbləği yazın", "danger"); return; }
          if (opsMinor(pay.value) > pay.row.weOwe) { toast("Ödəniş borcdan çox ola bilməz", "danger"); return; }
          void run(window.pos.suppliers.pay({ supplierId: pay.row.id, amountMinor: opsMinor(pay.value), accountId: pay.accountId || "", note: pay.note.trim() }), "Ödəniş qeyd olundu").then((ok) => { if (ok) setPay(null); });
        }, children: "Ödə" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "İmtina" }))) }) : null,
    confirmDialog);
}

`;

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  // Components: Satışlar plus the new Partnyorlar in place of the old one.
  s = cut(s, 'function OpsPartners() {', 'function psMonthBounds(month) {', SALES, 'partners + sales');

  s = replaceOnce(s, '    { id: "stock", label: "Anbar", show: ',
    '    { id: "sales", label: "Satışlar", show: hasPermission("sales.view") && _psArea("/operations?tab=sales"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsSales, {}) },\n    { id: "stock", label: "Anbar", show: ', 'sales tab');
  s = replaceOnce(s, '    { to: "/admin/cash", label: t.nav.cash, icon: CircleDollarSign, show: hasPermission("cash.manage") },',
    '    { to: "/operations?tab=sales", label: "Satışlar", icon: CircleDollarSign, show: hasPermission("sales.view") },\n    { to: "/admin/cash", label: t.nav.cash, icon: CircleDollarSign, show: hasPermission("cash.manage") },', 'hub link');
  s = replaceOnce(s, '  const opsLinks = canAdmin ? [] : [\n',
    '  const opsLinks = canAdmin ? [] : [\n    { to: "/operations?tab=sales", label: "Satışlar", icon: CircleDollarSign, show: hasPermission("sales.view") },\n', 'ops link');

  // Permission screen: words for the new rights.
  s = replaceOnce(s, 'function _psPermGroupAz(group) {', `Object.assign(_PS_PERM_GROUP_AZ, { sales: "Satışlar", purchases: "Alışlar", salary: "Maaşlar" });
Object.assign(_PS_PERM_AZ, {
  "sales.view": ["Satışlara baxmaq", "Satış qaimələri, qaytarmalar və satış hesabatı"],
  "sales.edit": ["Satışa düzəliş", "Bağlanmış satışda miqdar, qiymət, endirim, ofisiant, partnyor"],
  "sales.delete": ["Satışı silmək", "Bağlanmış satışı silmək — pul, borc və anbar geri qayıdır"],
  "purchases.edit": ["Alışa düzəliş", "Alış qaiməsinə və alışdan qaytarmaya düzəliş"],
  "purchases.delete": ["Alışı silmək", "Alış qaiməsini və alışdan qaytarmanı silmək"],
  "salary.manage": ["Maaşlar", "Maaş təyin etmək, avans və maaş vermək"],
  "cash.accounts": ["Kassalar", "Kassa və obyekt yaratmaq, kassalar arası transfer"]
});
function _psPermGroupAz(group) {`, 'perm labels');

  // ---- Maaşlar: obyekt
  s = replaceOnce(s, `  const [open, setOpen] = reactExports.useState(null);
  const reload = reactExports.useCallback(async () => {
    const r = await window.pos.salary.list(`, `  const [open, setOpen] = reactExports.useState(null);
  const salaryAcc = usePsAccounts();
  const salaryObjects = salaryAcc?.objects ?? [];
  const [salaryObject, setSalaryObject] = reactExports.useState("");
  const reload = reactExports.useCallback(async () => {
    const r = await window.pos.salary.list(`, 'salary state');
  s = replaceOnce(s, '  const sum = (key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);\n\n  return h("div", { className: "space-y-4" },\n    h("div", { className: "ps-stock-metrics" },\n      ...[["Maaş fondu"',
    '  const shownRows = rows.filter((r) => !salaryObject || r.objectId === salaryObject);\n  const sum = (key) => shownRows.reduce((t, r) => t + (Number(r[key]) || 0), 0);\n\n  return h("div", { className: "space-y-4" },\n    h("div", { className: "ps-stock-metrics" },\n      ...[["Maaş fondu"', 'salary sums');
  s = replaceOnce(s, '      h("small", { className: "text-muted" }, "Yeni ay başlayanda hər işçinin qarşısında yenə tam maaş görünür.")),',
    '      psObjectFilter(salaryObjects, salaryObject, setSalaryObject),\n      h("small", { className: "text-muted" }, "Yeni ay başlayanda hər işçinin qarşısında yenə tam maaş görünür.")),', 'salary filter');
  s = replaceOnce(s, '      head: ["İşçi", "Aylıq maaş", "Ödənilib", "Yeməklər", "Qalıq", ""],', '      head: ["İşçi", "Obyekt", "Aylıq maaş", "Ödənilib", "Yeməklər", "Qalıq", ""],', 'salary head');
  s = replaceOnce(s, `      rows: rows.map((r) => [
        h("span", { className: "font-medium text-cream" }, r.name, r.settled ? h("span", { className: "ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", style: { background: "#e7f5ee", color: "var(--ps-ok)" } }, "Ödənilib") : null),`,
    `      rows: shownRows.map((r) => [
        h("span", { className: "font-medium text-cream" }, r.name, r.settled ? h("span", { className: "ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", style: { background: "#e7f5ee", color: "var(--ps-ok)" } }, "Ödənilib") : null),
        (salaryObjects.find((o) => o.id === r.objectId) || {}).name || "—",`, 'salary row');

  // ---- Xərclər: obyekt
  s = replaceOnce(s, `  const [form, setForm] = reactExports.useState(null);
  const reload = reactExports.useCallback(async () => {
    const r = await window.pos.cash.list("");`, `  const [form, setForm] = reactExports.useState(null);
  const expenseAcc = usePsAccounts();
  const expenseObjects = expenseAcc?.objects ?? [];
  const [expenseObject, setExpenseObject] = reactExports.useState("");
  const reload = reactExports.useCallback(async () => {
    const r = await window.pos.cash.list("");`, 'expense state');
  s = replaceOnce(s, '  const shown = rows.filter((m) => (Number(m.createdAt) || 0) >= since);', '  const shown = rows.filter((m) => (Number(m.createdAt) || 0) >= since && (!expenseObject || m.objectId === expenseObject));', 'expense filter');
  s = replaceOnce(s, `      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ kind: "Bazarlıq", custom: "", value: "", note: "" }), children: "+ Xərc" })),`,
    `      psObjectFilter(expenseObjects, expenseObject, setExpenseObject),
      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ kind: "Bazarlıq", custom: "", value: "", note: "" }), children: "+ Xərc" })),`, 'expense toolbar');
  s = replaceOnce(s, `      head: ["Tarix", "Kateqoriya", "Məbləğ", "Qeyd"],
      empty: "Bu dövrdə xərc yoxdur",
      rows: shown.map((m) => [opsWhen(m.createdAt), m.reason || "—",`, `      head: ["Tarix", "Kateqoriya", "Kassa / obyekt", "Məbləğ", "Qeyd"],
      empty: "Bu dövrdə xərc yoxdur",
      rows: shown.map((m) => [opsWhen(m.createdAt), m.reason || "—", [m.accountName, m.objectName].filter(Boolean).join(" · ") || "—",`, 'expense table');

  // ---- Alışlar: correct / delete under their own permissions
  s = replaceOnce(s, '  const [objectFilter, setObjectFilter] = reactExports.useState("");\n  const [invoice, setInvoice]',
    '  const [objectFilter, setObjectFilter] = reactExports.useState("");\n  const [confirmAsk, confirmDialog] = useConfirm();\n  const [invoice, setInvoice]', 'purchases confirm');
  s = replaceOnce(s, '\n  const saveReturn = () => {\n    const lines = ret.lines.filter((l) => l.ingredientId', `
  const canFix = hasPermission("purchases.edit");
  const canRemove = hasPermission("purchases.delete");
  const removePurchase = async (p) => {
    if (!(await confirmAsk("Qaimə " + p.number + " silinsin? Mallar anbardan çıxır, məbləğ təchizatçının borcundan silinir.", { danger: true }))) return;
    void run(window.pos.suppliers.deletePurchase(p.id), "Qaimə silindi");
  };
  const removeReturn = async (r) => {
    if (!(await confirmAsk("Qaytarma " + r.number + " silinsin? Mallar anbara qayıdır, məbləğ yenə borca yazılır.", { danger: true }))) return;
    void run(window.pos.suppliers.deleteReturn(r.id), "Qaytarma silindi");
  };
  const openReturnEdit = async (r) => {
    const mine = new Map((r.lines ?? []).map((l) => [l.ingredientId, Number(l.qtyMilli) || 0]));
    if (r.purchaseId) {
      const res = await window.pos.suppliers.purchase(r.purchaseId);
      if (!res.success) { toast(res.error.message, "danger"); return; }
      const lines = (res.data.lines ?? []).map((l) => ({ ingredientId: l.ingredientId, name: l.name, unit: l.unit, fixed: true,
        maxMilli: Math.max(0, (Number(l.qtyMilli) || 0) - (Number(l.returnedMilli) || 0) + (mine.get(l.ingredientId) || 0)),
        qty: mine.has(l.ingredientId) ? String(mine.get(l.ingredientId) / 1000) : "", price: ((Number(l.unitCostMinor) || 0) / 100).toFixed(2) })).filter((l) => l.maxMilli > 0);
      setRet({ replaceReturnId: r.id, number: r.number, supplierId: r.supplierId, purchaseId: r.purchaseId, purchaseNumber: r.purchaseNumber, warehouseId: r.warehouseId || "", lines, note: r.note || "" });
    } else {
      setRet({ replaceReturnId: r.id, number: r.number, supplierId: r.supplierId, purchaseId: "", warehouseId: r.warehouseId || "", note: r.note || "",
        lines: (r.lines ?? []).map((l) => ({ ingredientId: l.ingredientId, qty: String((Number(l.qtyMilli) || 0) / 1000), price: ((Number(l.unitCostMinor) || 0) / 100).toFixed(2) })) });
    }
  };
  const saveReturn = () => {
    const lines = ret.lines.filter((l) => l.ingredientId`, 'purchase helpers');
  s = replaceOnce(s, 'window.pos.suppliers.returnGoods({ supplierId: ret.supplierId, purchaseId: ret.purchaseId || "", warehouseId: ret.warehouseId || "", lines,',
    'window.pos.suppliers.returnGoods({ supplierId: ret.supplierId, purchaseId: ret.purchaseId || "", warehouseId: ret.warehouseId || "", replaceReturnId: ret.replaceReturnId || "", lines,', 'return replace');
  s = replaceOnce(s, 'ret ? jsxRuntimeExports.jsx(PsAdminDialog, { title: ret.purchaseId ? "Qaytarma — qaimə " + ret.purchaseNumber : "Geri qaytarma",',
    'ret ? jsxRuntimeExports.jsx(PsAdminDialog, { title: ret.replaceReturnId ? "Qaytarma " + ret.number + " — düzəliş" : ret.purchaseId ? "Qaytarma — qaimə " + ret.purchaseNumber : "Geri qaytarma",', 'return title');
  s = replaceOnce(s, '          p.status !== "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void run(window.pos.suppliers.receive(p.id), "Qəbul edildi"), children: "Qəbul et" }) : null,',
    '          p.status !== "received" && p.status !== "cancelled" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void run(window.pos.suppliers.receive(p.id), "Qəbul edildi"), children: "Qəbul et" }) : null,', 'receive guard');
  s = replaceOnce(s, '          p.status === "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(p), children: "Düzəliş et" }) : null,',
    '          p.status === "received" && canFix ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(p), children: "Düzəliş et" }) : null,\n          p.status !== "cancelled" && canRemove ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void removePurchase(p), children: "Sil" }) : null,', 'invoice actions');
  s = replaceOnce(s, '      head: ["Qaytarma", "Tarix", "Təchizatçı", "Obyekt", "Qaimə", "Mallar", "Borcdan silindi"],',
    '      head: ["Qaytarma", "Tarix", "Təchizatçı", "Obyekt", "Qaimə", "Mallar", "Borcdan silindi", ""],', 'returns head');
  s = replaceOnce(s, '        h("b", { style: { color: "var(--ps-ok)" } }, formatMoney(r.totalMinor ?? 0))])',
    `        h("b", { style: { color: "var(--ps-ok)" } }, formatMoney(r.totalMinor ?? 0)),
        h("span", { className: "flex flex-wrap gap-1" },
          canFix ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openReturnEdit(r), children: "Düzəliş" }) : null,
          canRemove ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void removeReturn(r), children: "Sil" }) : null)])`, 'returns actions');
  s = replaceOnce(s, `        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: savePay, children: "Ödə" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "İmtina" }))) }) : null);`,
    `        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: savePay, children: "Ödə" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "İmtina" }))) }) : null,
    confirmDialog);`, 'purchases confirm render');
  fs.writeFileSync(BUNDLE, s);
  console.log('sales applied');
}

// apply-restaurant-admin-refresh.mjs rewrites the hub and the tab titles on every assemble.
{
  let t = fs.readFileSync(BUNDLE, 'utf8');
  const before = t;
  if (!t.includes('sales: ["Satışlar"')) {
    t = replaceOnce(t, 'purchases: ["Alışlar", "Alımlar", "Purchases"]', 'sales: ["Satışlar", "Satışlar", "Sales"], purchases: ["Alışlar", "Alımlar", "Purchases"]', 'sales title');
    t = replaceOnce(t, '    purchases: ["Alış qaimələri', '    sales: ["Satış qaimələri — obyekt, kassa, ofisiant, endirim, borc; qaytarma və hesabat.", "Satış faturaları ve iadeler.", "Sales invoices, returns and report."],\n    purchases: ["Alış qaimələri', 'sales subtitle');
  }
  if (!t.includes('"/operations?tab=sales", "/admin/cash"')) t = replaceOnce(t, 'paths: ["/admin/cash"', 'paths: ["/operations?tab=sales", "/admin/cash"', 'hub group');
  if (!t.includes('"/operations?tab=sales": [')) t = replaceOnce(t, '    "/admin/cash": [', '    "/operations?tab=sales": ["Satış qaimələri, qaytarma, hesabat", "Satışlar ve iadeler", "Sales and returns"],\n    "/admin/cash": [', 'hub description');
  if (!t.includes('["tab=sales","reports"]')) t = replaceOnce(t, '["tab=purchases","suppliers"],', '["tab=purchases","suppliers"],["tab=sales","reports"],', 'lan area');
  if (t !== before) { fs.writeFileSync(BUNDLE, t); console.log('sales: hub and titles'); }
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-badge { display: inline-block; padding: 0.05rem 0.4rem; border-radius: 0.4rem; font-size: 10px; font-weight: 600; background: #f1f5f9; color: #475569; }
.ps-badge-danger { background: #fdecec; color: var(--ps-danger, #dc2626); }
.ps-badge-warn { background: #fff4e0; color: #b45309; }
.ps-sale-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.4rem 0.8rem; }
.ps-sale-facts > div { display: flex; flex-direction: column; padding: 0.4rem 0.6rem; border-radius: 0.6rem; background: #f8fafc; }
.ps-sale-facts span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
.ps-sale-facts b { font-size: 0.9rem; }
.ps-sale-edit-row { display: grid; grid-template-columns: minmax(9rem, 1.6fr) 6rem 7rem 2.5rem; align-items: end; gap: 0.5rem; padding: 0.4rem 0.6rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-sale-return-row { display: grid; grid-template-columns: 1fr auto 6rem; align-items: center; gap: 0.6rem; padding: 0.4rem 0.6rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-qty-stepper { display: inline-flex; align-items: center; gap: 0.5rem; }
.ps-qty-stepper button { width: 2.2rem; height: 2.2rem; border-radius: 0.6rem; border: 1px solid var(--ps-line, #e2e8f0); font-weight: 700; }
@media (max-width: 720px) { .ps-sale-edit-row { grid-template-columns: 1fr 1fr; } .ps-sale-edit-row > .ps-recipe-name { grid-column: 1 / -1; } }
`;
    fs.writeFileSync(CSS, css);
  }
}
