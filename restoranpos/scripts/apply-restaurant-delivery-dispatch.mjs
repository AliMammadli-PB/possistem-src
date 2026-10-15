#!/usr/bin/env node
/**
 * 1.8.1 — delivery from the floor.
 *
 *  - Masalar: "Çatdırılma" (top right) asks for the guest and address and
 *    opens a bill on a delivery table (delivery.start) - the order screen,
 *    kitchen tickets and payment work as for any table.
 *  - Order screen, on a delivery bill: "Kuryerə ver" - pick the courier and
 *    whether the guest paid (the payment screen takes it) or pays the courier
 *    (the bill closes onto the courier's account).
 *  - Əməliyyatlar → Çatdırılma: paid and unpaid bills for the period, each
 *    courier's open total, and the evening count: tick the bills, "Ödənişi
 *    al" takes the money into a kassa (delivery.settle).
 * Runs after apply-restaurant-portal-rpc.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_DELIVERY_DISPATCH_v1 */';

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
  if (!m.includes('"delivery.start":')) {
    m = replaceOnce(m, 'Cn={', 'Cn={"delivery.start":{auth:!0,perm:"delivery.manage",timeout:15e3,idempotent:!0},"delivery.dispatch":{auth:!0,perm:"delivery.assign",timeout:8e3,idempotent:!0},"delivery.settle":{auth:!0,perm:"delivery.assign",timeout:15e3,idempotent:!0},', 'main policy');
    fs.writeFileSync(MAIN, m);
    console.log('main: delivery dispatch');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('"delivery.start"')) {
    p = replaceOnce(p, '    courierReport: (params) => call("delivery.courierReport", params ?? {})\n  },',
      `    courierReport: (params) => call("delivery.courierReport", params ?? {}),
    listRange: (params) => call("delivery.list", params ?? {}),
    start: (input) => call("delivery.start", input, { timeoutMs: 15000 }),
    dispatch: (input) => call("delivery.dispatch", input),
    settle: (input, options) => call("delivery.settle", input, options)
  },`, 'preload delivery');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: delivery dispatch');
  }
}

const COMPONENTS = String.raw`${MARK}
const PS_DELIVERY_AREA = "area-delivery";
/** Masalar → "Çatdırılma": guest and address, then straight into the order screen. */
function PsDeliveryStartButton() {
  const h = psH;
  const navigate = useNavigate();
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const [form, setForm] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState(false);
  if (!hasPermission("delivery.manage")) return null;
  const save = async () => {
    if (!form.address.trim()) { toast("Ünvanı yazın", "danger"); return; }
    setBusy(true);
    try {
      const r = await window.pos.delivery.start({ customerName: form.name.trim(), phone: form.phone.trim(), address: form.address.trim(), note: form.note.trim() });
      if (!r.success) { toast(r.error.message, "danger"); return; }
      setForm(null);
      navigate("/orders/" + r.data.tableId);
    } finally { setBusy(false); }
  };
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
  return h(reactExports.Fragment, null,
    h("button", { type: "button", className: "ps-delivery-start", onClick: () => setForm({ name: "", phone: "", address: "", note: "" }) }, "🛵 Çatdırılma"),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni çatdırılma sifarişi", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Müştəri", value: form.name, onChange: (v) => setForm({ ...form, name: v }), placeholder: "məs. Aysel" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Telefon", value: form.phone, onChange: (v) => setForm({ ...form, phone: v }), placeholder: "050 000 00 00" })),
      jsxRuntimeExports.jsx(OpsField, { label: "Ünvan", value: form.address, onChange: (v) => setForm({ ...form, address: v }), placeholder: "Küçə, bina, mənzil" }),
      jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: form.note, onChange: (v) => setForm({ ...form, note: v }), placeholder: "məs. qapıda zəng edin" }),
      h("p", { className: "text-xs text-muted" }, "Sifariş açılır: məhsulları vurun, sonra \"Kuryerə ver\" ilə kuryeri və ödənişi seçin."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void save(), children: "Sifarişi aç" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null);
}

/** Order screen, delivery bill: who takes it, and who pays whom. */
function PsDeliveryDispatch({ order, onClose }) {
  const h = psH;
  const navigate = useNavigate();
  const [couriers, setCouriers] = reactExports.useState([]);
  const [info, setInfo] = reactExports.useState(null);
  const [courierId, setCourierId] = reactExports.useState("");
  const [mode, setMode] = reactExports.useState("courier");
  const [newName, setNewName] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const load = reactExports.useCallback(async () => {
    const [c, l] = await Promise.all([window.pos.delivery.couriers(), window.pos.delivery.listRange({ from: 0 })]);
    if (c.success) setCouriers((c.data.couriers ?? []).filter((x) => x.active !== false && x.active !== 0));
    if (l.success) {
      const mine = (l.data.deliveries ?? []).find((d) => d.orderId === order.id) || null;
      setInfo(mine);
      if (mine && mine.courierId) setCourierId(mine.courierId);
    }
  }, [order.id]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const addCourier = async () => {
    if (!newName.trim()) return;
    const r = await window.pos.delivery.saveCourier({ name: newName.trim() });
    if (!r.success) { toast(r.error.message, "danger"); return; }
    setNewName("");
    await load();
    setCourierId(r.data.id);
  };
  const go = async () => {
    if (!courierId) { toast("Kuryeri seçin", "danger"); return; }
    if (!(order.items ?? []).some((i) => i.status !== "voided")) { toast("Əvvəlcə məhsulları vurun", "danger"); return; }
    setBusy(true);
    try {
      // What is not yet with the kitchen goes now.
      if ((order.items ?? []).some((i) => i.status === "draft")) {
        const s = await window.pos.orders.submit(order.id, { idempotencyKey: newIdempotencyKey() });
        if (!s.success) { toast(s.error.message, "danger"); return; }
      }
      const d = await window.pos.delivery.dispatch({ deliveryId: info ? info.id : "", orderId: order.id, courierId, mode });
      if (!d.success) { toast(d.error.message, "danger"); return; }
      if (mode === "courier") {
        const c = await window.pos.orders.closeToAccount(order.id, { idempotencyKey: newIdempotencyKey() });
        if (!c.success) { toast(c.error.message, "danger"); return; }
        toast("Kuryerə verildi — " + formatMoney(order.totalMinor - (order.paidMinor ?? 0)) + " kuryerin adına borc yazıldı", "success");
        navigate("/tables");
      } else {
        toast("Kuryerə verildi — indi ödənişi qəbul edin", "success");
        navigate("/payments/" + order.id);
      }
    } finally { setBusy(false); }
  };
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: "Kuryerə ver — #" + (order.orderNumber || ""), onClose, busy, children: h("div", { className: "space-y-3" },
    info ? h("p", { className: "text-sm text-muted" }, [info.customerName, info.phone, info.address].filter(Boolean).join(" · ")) : null,
    h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Kuryer"),
      h("select", { value: courierId, className: field, onChange: (e) => setCourierId(e.target.value) },
        h("option", { value: "" }, couriers.length ? "Seçin…" : "Kuryer yoxdur — aşağıda əlavə edin"),
        couriers.map((c) => h("option", { key: c.id, value: c.id }, c.name + (c.openCount ? " · " + c.openCount + " yolda" : ""))))),
    h("div", { className: "flex items-end gap-2" },
      jsxRuntimeExports.jsx(OpsField, { label: "Yeni kuryer", value: newName, onChange: setNewName, placeholder: "Ad" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy || !newName.trim(), onClick: () => void addCourier(), children: "Əlavə et" })),
    h("div", { className: "ps-delivery-modes" },
      [["paid", "Müştəri ödəyib", "Ödənişi indi kassada qəbul edin, hesab bağlanır."],
       ["courier", "Müştəri kuryerə ödəyəcək", formatMoney(order.totalMinor - (order.paidMinor ?? 0)) + " kuryerin adına borc yazılır; axşam Çatdırılma bölməsində kuryerdən alınır."]].map(([k, l, d]) =>
        h("button", { key: k, type: "button", "aria-pressed": mode === k, className: "ps-delivery-mode" + (mode === k ? " is-on" : ""), onClick: () => setMode(k) }, h("b", null, l), h("small", null, d)))),
    h("div", { className: "flex gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void go(), children: mode === "courier" ? "Kuryerə ver və bağla" : "Kuryerə ver və ödənişə keç" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: onClose, children: "İmtina" }))) });
}

/** Əməliyyatlar → Çatdırılma: what was delivered, what was paid, what the couriers still hold. */
function OpsDelivery() {
  const h = psH;
  const navigate = useNavigate();
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const canSettle = hasPermission("delivery.assign");
  const [period, setPeriod] = reactExports.useState("day");
  const [view, setView] = reactExports.useState("unpaid");
  const [courierFilter, setCourierFilter] = reactExports.useState("");
  const [rows, setRows] = reactExports.useState(null);
  const [couriers, setCouriers] = reactExports.useState([]);
  const [picked, setPicked] = reactExports.useState({});
  const [settle, setSettle] = reactExports.useState(null);
  const [courierForm, setCourierForm] = reactExports.useState(null);
  const reload = reactExports.useCallback(async () => {
    const [from, to] = psDayRange(period, "", "");
    const [l, c] = await Promise.all([window.pos.delivery.listRange({ from, to, courierId: courierFilter }), window.pos.delivery.couriers()]);
    if (l.success) setRows(l.data.deliveries ?? []); else toast(l.error.message, "danger");
    if (c.success) setCouriers(c.data.couriers ?? []);
    setPicked({});
  }, [period, courierFilter]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!rows) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");

  const sum = (list, key) => list.reduce((t, r) => t + (Number(r[key]) || 0), 0);
  const unpaid = rows.filter((r) => r.money === "unpaid");
  const paid = rows.filter((r) => r.money === "paid");
  const open = rows.filter((r) => r.money === "open");
  const shown = view === "unpaid" ? unpaid : view === "paid" ? paid : view === "open" ? open : rows;
  const chosen = unpaid.filter((r) => picked[r.id]);
  const perCourier = new Map();
  for (const r of rows) {
    if (!r.courierId) continue;
    const row = perCourier.get(r.courierId) || { id: r.courierId, name: r.courierName || "—", count: 0, total: 0, due: 0, dueCount: 0 };
    row.count += 1; row.total += r.money === "cancelled" ? 0 : Number(r.totalMinor) || 0;
    if (r.money === "unpaid") { row.due += Number(r.dueMinor) || 0; row.dueCount += 1; }
    perCourier.set(r.courierId, row);
  }
  const who = (r) => [r.customerName, r.phone].filter(Boolean).join(" · ") || "—";
  const openSettle = (list) => {
    if (!list.length) { toast("Ödənilməmiş qaimə seçin", "danger"); return; }
    setSettle({ list, accountId: undefined });
  };
  const doSettle = () => void run(window.pos.delivery.settle({ deliveryIds: settle.list.map((r) => r.id), accountId: settle.accountId || "" }, { idempotencyKey: newIdempotencyKey() }),
    "Ödəniş alındı — " + formatMoney(sum(settle.list, "dueMinor"))).then((ok) => { if (ok) setSettle(null); });
  const chip = (k, l, value, set) => h("button", { key: k, type: "button", "aria-pressed": value === k, className: "ps-period-chip" + (value === k ? " is-on" : ""), onClick: () => set(k) }, l);
  const statusLabel = { pending: "Gözləyir", assigned: "Kuryerə verilib", picked_up: "Yolda", delivered: "Çatdırılıb", failed: "Alınmadı", cancelled: "Ləğv" };

  return h("div", { className: "space-y-4" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["day", "Bu gün"], ["yesterday", "Dünən"], ["week", "Bu həftə"], ["month", "Bu ay"]].map(([k, l]) => chip(k, l, period, setPeriod)),
      h("select", { value: courierFilter, onChange: (e) => setCourierFilter(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" },
        h("option", { value: "" }, "Bütün kuryerlər"), couriers.map((c) => h("option", { key: c.id, value: c.id }, c.name))),
      h("span", { className: "ml-auto" }),
      hasPermission("delivery.manage") ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setCourierForm({ name: "", phone: "" }), children: "+ Kuryer" }) : null,
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void reload(), children: "Yenilə" })),

    h("div", { className: "ps-stock-metrics" },
      psMetric("Çatdırılma", String(rows.filter((r) => r.money !== "cancelled").length), formatMoney(sum(rows.filter((r) => r.money !== "cancelled"), "totalMinor"))),
      psMetric("Ödənilmiş", formatMoney(sum(paid, "totalMinor")), paid.length + " qaimə", "var(--ps-ok)"),
      psMetric("Kuryerlərdə (ödənilməmiş)", formatMoney(sum(unpaid, "dueMinor")), unpaid.length + " qaimə", unpaid.length ? "var(--ps-danger)" : null),
      psMetric("Açıq hesab", String(open.length), "hələ bağlanmayıb")),

    perCourier.size ? jsxRuntimeExports.jsx(OpsTable, { head: ["Kuryer", "Çatdırılma", "Məbləğ", "Kuryerdə", ""], empty: "",
      rows: [...perCourier.values()].map((c) => [h("b", null, c.name), String(c.count), formatMoney(c.total),
        h("b", { style: c.due ? { color: "var(--ps-danger)" } : null }, formatMoney(c.due) + (c.dueCount ? " (" + c.dueCount + " qaimə)" : "")),
        c.due && canSettle ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => openSettle(unpaid.filter((r) => r.courierId === c.id)), children: "Hesablaş" }) : null]) }) : null,

    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["unpaid", "Ödənilməmiş (" + unpaid.length + ")"], ["paid", "Ödənilmiş (" + paid.length + ")"], ["open", "Açıq (" + open.length + ")"], ["all", "Hamısı"]].map(([k, l]) => chip(k, l, view, setView)),
      view === "unpaid" && canSettle ? h("span", { className: "ml-auto flex items-center gap-2" },
        h("small", { className: "text-muted" }, chosen.length + " seçilib · " + formatMoney(sum(chosen, "dueMinor"))),
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy || !chosen.length, onClick: () => openSettle(chosen), children: "Seçilənlərin ödənişini al" })) : null),

    jsxRuntimeExports.jsx(OpsTable, {
      head: view === "unpaid" && canSettle
        ? [h("input", { type: "checkbox", "aria-label": "Hamısını seç", checked: unpaid.length > 0 && chosen.length === unpaid.length, onChange: (e) => setPicked(e.target.checked ? Object.fromEntries(unpaid.map((r) => [r.id, true])) : {}) }), "Qaimə", "Vaxt", "Müştəri", "Ünvan", "Kuryer", "Məbləğ", ""]
        : ["Qaimə", "Vaxt", "Müştəri", "Ünvan", "Kuryer", "Məbləğ", "Vəziyyət", ""],
      empty: view === "unpaid" ? "Kuryerlərdə ödənilməmiş qaimə yoxdur" : "Bu dövrdə çatdırılma yoxdur",
      rows: shown.map((r) => {
        const base = [h("b", null, "#" + r.orderNumber), opsWhen(r.createdAt), who(r), r.address || "—", r.courierName || "—",
          h("b", null, formatMoney(r.money === "unpaid" ? r.dueMinor : r.totalMinor))];
        if (view === "unpaid" && canSettle) {
          return [h("input", { type: "checkbox", checked: Boolean(picked[r.id]), onChange: (e) => setPicked({ ...picked, [r.id]: e.target.checked }) }), ...base,
            jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => openSettle([r]), children: "Ödəniş al" })];
        }
        const state = r.money === "unpaid" ? psBadge("Kuryerdə", "danger")
          : r.money === "open" ? psBadge(statusLabel[r.status] || "Açıq", "warn")
          : r.money === "cancelled" ? psBadge("Ləğv", "muted")
          : psBadge(r.payMode === "courier" ? "Kuryerdən alındı" : "Kassada ödənilib", "ok");
        return [...base, state,
          r.money === "open" && r.tableId ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => navigate("/orders/" + r.tableId), children: "Aç" }) : null];
      })
    }),

    settle ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Kuryerdən ödəniş — " + formatMoney(sum(settle.list, "dueMinor")), onClose: () => setSettle(null), busy, children: h("div", { className: "space-y-3" },
      jsxRuntimeExports.jsx(OpsTable, { head: ["Qaimə", "Kuryer", "Müştəri", "Məbləğ"], empty: "",
        rows: settle.list.map((r) => ["#" + r.orderNumber, r.courierName || "—", who(r), formatMoney(r.dueMinor)]) }),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: settle.accountId, onChange: (v) => setSettle((p) => (p ? { ...p, accountId: v } : p)), label: "Pul hansı kassaya girir" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: doSettle, children: "Ödənişi al" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setSettle(null), children: "İmtina" }))) }) : null,

    courierForm ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni kuryer", onClose: () => setCourierForm(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: courierForm.name, onChange: (v) => setCourierForm({ ...courierForm, name: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Telefon", value: courierForm.phone, onChange: (v) => setCourierForm({ ...courierForm, phone: v }) })),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => {
          if (!courierForm.name.trim()) { toast("Ad tələb olunur", "danger"); return; }
          void run(window.pos.delivery.saveCourier({ name: courierForm.name.trim(), phone: courierForm.phone.trim() }), "Kuryer əlavə olundu").then((ok) => { if (ok) setCourierForm(null); });
        }, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setCourierForm(null), children: "İmtina" }))) }) : null);
}

`;

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  // The old Çatdırılma tab gives way to the new one.
  s = cut(s, 'function OpsDelivery() {', 'function OpsExport() {', COMPONENTS, 'ops delivery');
  // Masalar: the button, top right, before the area chips.
  s = replaceOnce(s, '          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap justify-end gap-2", children: areas.map((area) => {',
    '          jsxRuntimeExports.jsx(PsDeliveryStartButton, {}),\n          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex flex-wrap justify-end gap-2", children: areas.map((area) => {', 'floor button');
  // Order screen, delivery bill: "Kuryerə ver".
  s = replaceOnce(s, `            order.customerId ? ((order.partnerKind === "employee" ? "İşçi: " : "Partnyor: ") + (order.partnerName || "")) : "Partnyor seç")`,
    `            order.customerId ? ((order.partnerKind === "employee" ? "İşçi: " : "Partnyor: ") + (order.partnerName || "")) : "Partnyor seç"),
          table && table.areaId === PS_DELIVERY_AREA ? psH("button", { type: "button", className: "ps-delivery-dispatch", onClick: () => setDispatchOpen(true) }, "🛵 Kuryerə ver") : null`, 'dispatch button');
  s = replaceOnce(s, '    partnerOpen && order ? jsxRuntimeExports.jsx(PsPartnerPicker, { order, onClose: () => setPartnerOpen(false), onPicked: () => { setPartnerOpen(false); void refreshOrder(); } }) : null,',
    '    partnerOpen && order ? jsxRuntimeExports.jsx(PsPartnerPicker, { order, onClose: () => setPartnerOpen(false), onPicked: () => { setPartnerOpen(false); void refreshOrder(); } }) : null,\n    dispatchOpen && order ? jsxRuntimeExports.jsx(PsDeliveryDispatch, { order, onClose: () => setDispatchOpen(false) }) : null,', 'dispatch dialog');
  s = replaceOnce(s, '  const [partnerOpen, setPartnerOpen] = reactExports.useState(false);\n  const loadOrder',
    '  const [partnerOpen, setPartnerOpen] = reactExports.useState(false);\n  const [dispatchOpen, setDispatchOpen] = reactExports.useState(false);\n  const loadOrder', 'dispatch state');
  fs.writeFileSync(BUNDLE, s);
  console.log('delivery dispatch applied');
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-delivery-start { align-self: center; min-height: 40px; padding: 0 16px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.35);
  background: #f59e0b; color: #fff; font-weight: 700; letter-spacing: 0.01em; white-space: nowrap; box-shadow: 0 4px 14px rgba(245,158,11,0.35); }
.ps-delivery-start:hover { background: #d97706; }
.ps-delivery-dispatch { width: 100%; margin-top: 8px; min-height: 44px; border-radius: 12px; background: #f59e0b; color: #fff; font-weight: 700; }
.ps-delivery-dispatch:hover { background: #d97706; }
.ps-delivery-modes { display: grid; gap: 8px; }
.ps-delivery-mode { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--ps-line, #e2e8f0); background: transparent; }
.ps-delivery-mode small { color: #64748b; }
.ps-delivery-mode.is-on { border-color: #f59e0b; background: #fff7e6; }
`;
    fs.writeFileSync(CSS, css);
  }
}
