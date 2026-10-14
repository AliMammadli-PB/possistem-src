#!/usr/bin/env node
/**
 * 1.7.28 — purchasing, replenishment, lots and costing in the screens.
 *
 *  Alışlar:  stage badges (draft / ordered / partly / received / deleted);
 *            "Mal qəbulu" in parts with lot number, dates, place and quality;
 *            supplier invoice matching; extra costs (delivery, transport);
 *            Qaralamalar (automatic suggestions, confirm); Təchizatçı
 *            qiymətləri (compare, terms); Hesabat (supplier performance).
 *  Anbar:    expiry banner; Partiyalar (move, write off, quality check),
 *            Yerləşmələr, Sifariş qaydaları (min / target / order qty and
 *            suggestions), İtkilər.
 *  Kalkulyasiya: costing method (weighted average / FIFO / last price).
 * Core: PurchaseHandlers.cpp, StockControlHandlers.cpp, ReplenishService.
 * Runs after apply-restaurant-sales.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_PROCUREMENT_v1 */';

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
  if (!m.includes('"replenish.suggestions":')) {
    const p = (perm, t, idem) => `{auth:!0,perm:"${perm}",timeout:${t},idempotent:${idem ? '!0' : '!1'}}`;
    const policies = {
      'purchases.confirm': p('suppliers.manage', '8e3', 1), 'purchases.inspect': p('suppliers.receive', '3e4', 1),
      'purchases.invoice': p('suppliers.manage', '3e4', 1), 'purchases.addCost': p('suppliers.manage', '3e4', 1),
      'purchases.removeCost': p('purchases.edit', '3e4', 1),
      'replenish.suggestions': p('inventory.view', '15e3', 0), 'replenish.run': p('suppliers.manage', '3e4', 1),
      'replenish.createDraft': p('suppliers.manage', '8e3', 1),
      'stockRules.list': p('inventory.view', '8e3', 0), 'stockRules.save': p('inventory.manage', '8e3', 1),
      'supplierItems.list': p('suppliers.view', '8e3', 0), 'supplierItems.save': p('suppliers.manage', '8e3', 1),
      'locations.list': p('inventory.view', '8e3', 0), 'locations.save': p('inventory.manage', '8e3', 1),
      'lots.list': p('inventory.view', '15e3', 0), 'lots.relocate': p('inventory.transfer', '8e3', 1),
      'lots.writeOff': p('inventory.adjust', '8e3', 1),
      'reports.expiry': p('inventory.view', '8e3', 0), 'reports.suppliers': p('suppliers.view', '15e3', 0),
      'reports.stockLoss': p('inventory.view', '15e3', 0), 'inventory.costingMethod': p('inventory.view', '8e3', 1),
    };
    m = replaceOnce(m, 'Cn={', 'Cn={' + Object.entries(policies).map(([k, v]) => `"${k}":${v}`).join(',') + ',', 'main policy');
    fs.writeFileSync(MAIN, m);
    console.log('main: procurement');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('"replenish.suggestions"')) {
    p = replaceOnce(p, '    deletePurchase: (purchaseId) => call("purchases.delete", { purchaseId }),',
      `    deletePurchase: (purchaseId) => call("purchases.delete", { purchaseId }),
    confirmPurchase: (purchaseId) => call("purchases.confirm", { purchaseId }),
    receiveLines: (input, options) => call("purchases.receive", input, { timeoutMs: 30000, ...(options ?? {}) }),
    inspectLot: (lotId, decision) => call("purchases.inspect", { lotId, decision }, { timeoutMs: 30000 }),
    invoice: (input) => call("purchases.invoice", input, { timeoutMs: 30000 }),
    addCost: (input, options) => call("purchases.addCost", input, { timeoutMs: 30000, ...(options ?? {}) }),
    removeCost: (costId) => call("purchases.removeCost", { costId }, { timeoutMs: 30000 }),`, 'preload suppliers');
    p = replaceOnce(p, '    costing: (since) => call("reports.costing", { since: since ?? 0 }, { timeoutMs: 15000 }),\n    valuation: (warehouseId) => call("inventory.valuation", { warehouseId: warehouseId ?? "" }),',
      '    costing: (since, method) => call("reports.costing", { since: since ?? 0, method: method ?? "" }, { timeoutMs: 15000 }),\n    valuation: (warehouseId, method) => call("inventory.valuation", { warehouseId: warehouseId ?? "", method: method ?? "" }),',
      'preload costing');
    p = replaceOnce(p, '\n  sales: {', `
  stock: {
    suggestions: (warehouseId) => call("replenish.suggestions", { warehouseId: warehouseId ?? "" }, { timeoutMs: 15000 }),
    runReplenish: (warehouseId) => call("replenish.run", { warehouseId: warehouseId ?? "" }, { timeoutMs: 30000 }),
    createDraft: (input) => call("replenish.createDraft", input),
    rules: (warehouseId) => call("stockRules.list", { warehouseId: warehouseId ?? "" }),
    saveRule: (input) => call("stockRules.save", input),
    supplierItems: (params) => call("supplierItems.list", params ?? {}),
    saveSupplierItem: (input) => call("supplierItems.save", input),
    locations: (warehouseId) => call("locations.list", { warehouseId: warehouseId ?? "" }),
    saveLocation: (input) => call("locations.save", input),
    lots: (params) => call("lots.list", params ?? {}, { timeoutMs: 15000 }),
    relocate: (input) => call("lots.relocate", input),
    writeOff: (input) => call("lots.writeOff", input),
    expiry: (warehouseId, days) => call("reports.expiry", { warehouseId: warehouseId ?? "", days: days ?? 3 }),
    supplierReport: (params) => call("reports.suppliers", params ?? {}, { timeoutMs: 15000 }),
    lossReport: (params) => call("reports.stockLoss", params ?? {}, { timeoutMs: 15000 }),
    costingMethod: (method) => call("inventory.costingMethod", { method: method ?? "" })
  },

  sales: {`, 'preload stock');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: procurement');
  }
}

const COMPONENTS = String.raw`${MARK}
const PS_STAGE = { draft: ["Qaralama", "muted"], ordered: ["Sifariş", "warn"], partially_received: ["Qismən qəbul", "warn"], received: ["Qəbul edilib", "ok"], cancelled: ["Silinib", "danger"] };
const PS_QUALITY = { accepted: "Qəbul", pending: "Yoxlamada", rejected: "Rədd" };
const PS_LOC_KINDS = { fridge: "Soyuducu", freezer: "Dondurucu", shelf: "Rəf", zone: "Zona", dry: "Quru anbar" };
const PS_COST_KINDS = { delivery: "Çatdırılma", transport: "Daşınma", customs: "Gömrük", other: "Digər" };
const psField = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
function psStageBadge(p) {
  const [label, tone] = PS_STAGE[p.status] || [p.status, "muted"];
  const part = p.status === "partially_received" && (p.orderedMilli ?? 0) > 0 ? " " + Math.round((Number(p.receivedMilli) || 0) * 100 / p.orderedMilli) + "%" : "";
  return psBadge(label + part, tone);
}
function psLabeled(label, child) {
  return psH("label", { className: "block text-sm" }, psH("span", { className: "text-xs uppercase tracking-wide text-faint" }, label), child);
}
function psDaysBadge(lot) {
  if (lot.daysLeft === null || lot.daysLeft === undefined) return psH("span", { className: "text-muted" }, "—");
  if (lot.daysLeft < 0) return psBadge("Vaxtı keçib " + (-lot.daysLeft) + " gün", "danger");
  if (lot.daysLeft <= 3) return psBadge(lot.daysLeft === 0 ? "Bu gün bitir" : lot.daysLeft + " gün qalıb", "warn");
  return psH("span", null, lot.expiresOn);
}
function usePsDialogRun(onDone) {
  const [busy, setBusy] = reactExports.useState(false);
  const run = async (promise, ok) => {
    setBusy(true);
    try {
      const res = await promise;
      if (!res.success) { toast(res.error?.message || "Əməliyyat alınmadı", "danger"); return false; }
      if (ok) toast(ok, "success");
      if (onDone) await onDone();
      return true;
    } catch (error) { toast(error?.message || "Bağlantı xətası", "danger"); return false; } finally { setBusy(false); }
  };
  return [busy, run];
}

/** Goods arriving: in parts, with lot, dates, place and quality. */
function PsReceiveDialog({ purchaseId, onClose, onDone }) {
  const h = psH;
  const [doc, setDoc] = reactExports.useState(null);
  const [locations, setLocations] = reactExports.useState([]);
  const [rows, setRows] = reactExports.useState([]);
  const [note, setNote] = reactExports.useState("");
  const [key] = reactExports.useState(() => newIdempotencyKey());
  const [busy, run] = usePsDialogRun(onDone);
  reactExports.useEffect(() => {
    void (async () => {
      const r = await window.pos.suppliers.purchase(purchaseId);
      if (!r.success) { toast(r.error.message, "danger"); onClose(); return; }
      setDoc(r.data);
      const loc = await window.pos.stock.locations(r.data.warehouseId);
      if (loc.success) setLocations((loc.data.locations ?? []).filter((l) => l.active));
      setRows((r.data.lines ?? []).filter((l) => (l.remainingMilli ?? 0) > 0).map((l) => ({ itemId: l.id, name: l.name, unit: l.unit,
        ordered: l.qtyMilli, received: l.receivedMilli, remaining: l.remainingMilli, returned: l.returnedMilli,
        qty: String((l.remainingMilli ?? 0) / 1000), rejected: "", quality: "accepted", lotNo: "", producedOn: "", expiresOn: "", locationId: "" })));
    })();
  }, [purchaseId]);
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => {
    const lines = [];
    for (const r of rows) {
      const qty = Math.round(opsNum(r.qty || "0") * 1000);
      const rejected = Math.round(opsNum(r.rejected || "0") * 1000);
      if (!Number.isFinite(qty) || !Number.isFinite(rejected) || qty < 0 || rejected < 0) { toast(r.name + ": miqdar düzgün deyil", "danger"); return; }
      if (r.quality !== "rejected" && qty > r.remaining) { toast(r.name + ": qalan " + opsQty(r.remaining) + " " + r.unit + "-dan çox qəbul olmaz", "danger"); return; }
      if (qty > 0 || rejected > 0) lines.push({ itemId: r.itemId, qtyMilli: qty, rejectedMilli: rejected, quality: r.quality, lotNo: r.lotNo.trim(),
        producedOn: r.producedOn, expiresOn: r.expiresOn, locationId: r.locationId });
    }
    if (!lines.length) { toast("Qəbul ediləcək miqdar yazın", "danger"); return; }
    void run(window.pos.suppliers.receiveLines({ purchaseId, lines, note: note.trim() }, { idempotencyKey: key }), "Mal qəbul edildi").then((ok) => { if (ok) onClose(); });
  };
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: "Mal qəbulu" + (doc ? " — " + doc.number + " · " + doc.supplierName : ""), onClose, busy, children: h("div", { className: "space-y-3" },
    !doc ? h("p", { className: "text-sm text-muted" }, "Yüklənir…") : null,
    doc && !rows.length ? h("p", { className: "text-sm text-muted" }, "Bu qaimədə gözlənilən mal qalmayıb.") : null,
    doc && rows.length ? h("div", { className: "flex flex-wrap gap-2" },
      h("button", { type: "button", className: "ps-recipe-add", onClick: () => setRows(rows.map((r) => ({ ...r, qty: String(r.remaining / 1000) }))) }, "Hamısı gəldi"),
      h("button", { type: "button", className: "ps-recipe-add", onClick: () => setRows(rows.map((r) => ({ ...r, qty: "" }))) }, "Miqdarları sıfırla")) : null,
    rows.map((r, i) => h("div", { key: r.itemId, className: "ps-receive-row" },
      h("p", { className: "ps-receive-head" }, h("b", null, r.name),
        h("small", null, " · sifariş " + opsQty(r.ordered) + " · qəbul " + opsQty(r.received) + " · qalan " + opsQty(r.remaining) + ((r.returned ?? 0) > 0 ? " · qaytarılıb " + opsQty(r.returned) : "") + " " + r.unit)),
      h("div", { className: "ps-receive-grid" },
        psLabeled("Bu dəfə (" + r.unit + ")", h("input", { inputMode: "decimal", value: r.qty, className: psField, onChange: (e) => set(i, { qty: e.target.value }) })),
        psLabeled("Rədd (" + r.unit + ")", h("input", { inputMode: "decimal", value: r.rejected, placeholder: "0", className: psField, onChange: (e) => set(i, { rejected: e.target.value }) })),
        psLabeled("Keyfiyyət", h("select", { value: r.quality, className: psField, onChange: (e) => set(i, { quality: e.target.value }) },
          Object.entries(PS_QUALITY).map(([k, l]) => h("option", { key: k, value: k }, l)))),
        psLabeled("Partiya №", h("input", { value: r.lotNo, placeholder: doc ? doc.number : "", className: psField, onChange: (e) => set(i, { lotNo: e.target.value }) })),
        psLabeled("İstehsal", h("input", { type: "date", value: r.producedOn, className: psField, onChange: (e) => set(i, { producedOn: e.target.value }) })),
        psLabeled("Son istifadə", h("input", { type: "date", value: r.expiresOn, className: psField, onChange: (e) => set(i, { expiresOn: e.target.value }) })),
        locations.length ? psLabeled("Yerləşmə", h("select", { value: r.locationId, className: psField, onChange: (e) => set(i, { locationId: e.target.value }) },
          h("option", { value: "" }, "—"), locations.map((l) => h("option", { key: l.id, value: l.id }, l.name + " (" + (PS_LOC_KINDS[l.kind] || l.kind) + ")")))) : null))),
    rows.length ? jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: note, onChange: setNote, placeholder: "məs. sürücü, maşın nömrəsi" }) : null,
    h("p", { className: "text-xs text-muted" }, "Qəbul: anbara girir və borca yazılır. Yoxlamada: ayrıca saxlanılır, yoxlamadan sonra anbara girir. Rədd: anbara girmir, borca yazılmır."),
    h("div", { className: "flex gap-2" },
      rows.length ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Qəbul et" }) : null,
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: onClose, children: "Bağla" }))) });
}

/** The supplier's invoice against what was ordered and what arrived. */
function PsInvoiceDialog({ purchaseId, onClose, onDone }) {
  const h = psH;
  const [doc, setDoc] = reactExports.useState(null);
  const [form, setForm] = reactExports.useState(null);
  const [busy, run] = usePsDialogRun(onDone);
  reactExports.useEffect(() => {
    void window.pos.suppliers.purchase(purchaseId).then((r) => {
      if (!r.success) { toast(r.error.message, "danger"); onClose(); return; }
      setDoc(r.data);
      setForm({ invoiceNo: r.data.invoiceNo || "", invoiceDate: r.data.invoiceDate || "", lines: (r.data.lines ?? []).map((l) => ({ itemId: l.id, name: l.name, unit: l.unit,
        ordered: l.qtyMilli, received: l.receivedMilli, price: l.unitCostMinor,
        qty: String(((l.invoiceQtyMilli ?? null) !== null ? l.invoiceQtyMilli : (l.receivedMilli || l.qtyMilli)) / 1000),
        cost: (((l.invoiceUnitCostMinor ?? null) !== null ? l.invoiceUnitCostMinor : l.unitCostMinor) / 100).toFixed(2) })) });
    });
  }, [purchaseId]);
  if (!form) return null;
  const save = (confirm) => {
    if (!form.invoiceNo.trim()) { toast("Faktura nömrəsini yazın", "danger"); return; }
    const lines = form.lines.map((l) => ({ itemId: l.itemId, invoiceQtyMilli: Math.round(opsNum(l.qty || "0") * 1000), invoiceUnitCostMinor: opsMinor(l.cost || "0") }));
    void run(window.pos.suppliers.invoice({ purchaseId, invoiceNo: form.invoiceNo.trim(), invoiceDate: form.invoiceDate, confirm, lines }),
      confirm ? "Faktura təsdiqləndi — borc faktura qiyməti ilə hesablandı" : "Faktura saxlanıldı").then((ok) => { if (ok) onClose(); });
  };
  const diff = (a, b, fmt) => a === b ? h("span", { className: "text-muted" }, "—") : h("b", { style: { color: a > b ? "var(--ps-danger)" : "var(--ps-ok)" } }, (a > b ? "+" : "−") + fmt(Math.abs(a - b)));
  let invoiceTotal = 0;
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: "Faktura — " + doc.number + " · " + doc.supplierName, onClose, busy, children: h("div", { className: "space-y-3" },
    h("div", { className: "grid gap-2 sm:grid-cols-2" },
      jsxRuntimeExports.jsx(OpsField, { label: "Faktura №", value: form.invoiceNo, onChange: (v) => setForm({ ...form, invoiceNo: v }) }),
      psLabeled("Faktura tarixi", h("input", { type: "date", value: form.invoiceDate, className: psField, onChange: (e) => setForm({ ...form, invoiceDate: e.target.value }) }))),
    jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Sifariş", "Qəbul", "Fakturada", "Miqdar fərqi", "Sifariş qiyməti", "Faktura qiyməti", "Qiymət fərqi"], empty: "",
      rows: form.lines.map((l, i) => {
        const qty = Math.round(opsNum(l.qty || "0") * 1000);
        const cost = opsMinor(l.cost || "0");
        invoiceTotal += Math.round(qty * cost / 1000);
        const setLine = (patch) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
        return [l.name, opsQty(l.ordered) + " " + l.unit, opsQty(l.received) + " " + l.unit,
          h("input", { inputMode: "decimal", value: l.qty, className: "ps-cell-input", onChange: (e) => setLine({ qty: e.target.value }) }),
          diff(qty, l.received, (v) => opsQty(v) + " " + l.unit),
          formatMoney(l.price),
          h("input", { inputMode: "decimal", value: l.cost, className: "ps-cell-input", onChange: (e) => setLine({ cost: e.target.value }) }),
          diff(cost, l.price, formatMoney)];
      }) }),
    h("div", { className: "ps-purchase-total" }, h("span", null, "Faktura cəmi"), h("b", null, formatMoney(invoiceTotal))),
    h("p", { className: "text-xs text-muted" }, "Miqdar fərqi: fakturada yazılan ilə faktiki qəbul edilən arasında. Təsdiq edəndə təchizatçı borcu qəbul edilən miqdar × faktura qiyməti ilə yenidən hesablanır, maya dəyəri də yenilənir."),
    h("div", { className: "flex flex-wrap gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => save(true), children: "Təsdiq et" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => save(false), children: "Yadda saxla (təsdiqsiz)" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: onClose, children: "Bağla" }))) });
}

/** Delivery, transport and the like, spread over the goods' cost. */
function PsCostsDialog({ purchaseId, onClose, onDone }) {
  const h = psH;
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const [doc, setDoc] = reactExports.useState(null);
  const [form, setForm] = reactExports.useState({ kind: "delivery", value: "", toSupplier: true, accountId: undefined, allocation: "value", note: "" });
  const load = reactExports.useCallback(async () => {
    const r = await window.pos.suppliers.purchase(purchaseId);
    if (r.success) setDoc(r.data); else toast(r.error.message, "danger");
  }, [purchaseId]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const [busy, run] = usePsDialogRun(async () => { await load(); if (onDone) await onDone(); });
  if (!doc) return null;
  const add = () => {
    if (!psStockInputValid(form.value) || opsMinor(form.value) <= 0) { toast("Məbləği yazın", "danger"); return; }
    void run(window.pos.suppliers.addCost({ purchaseId, kind: form.kind, amountMinor: opsMinor(form.value), toSupplier: form.toSupplier,
      accountId: form.toSupplier ? "" : form.accountId || "", allocation: form.allocation, note: form.note.trim() }, { idempotencyKey: newIdempotencyKey() }), "Xərc əlavə olundu")
      .then((ok) => { if (ok) setForm({ ...form, value: "", note: "" }); });
  };
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: "Əlavə xərclər — " + doc.number, onClose, busy, children: h("div", { className: "space-y-3" },
    jsxRuntimeExports.jsx(OpsTable, { head: ["Növ", "Məbləğ", "Kim ödəyir", "Bölüşdürmə", "Qeyd", ""], empty: "Əlavə xərc yoxdur",
      rows: (doc.costs ?? []).map((c) => [PS_COST_KINDS[c.kind] || c.kind, formatMoney(c.amountMinor ?? 0), c.toSupplier ? "Təchizatçı hesabına" : "Kassadan / ayrıca",
        c.allocation === "qty" ? "Miqdara görə" : "Dəyərə görə", c.note || "—",
        hasPermission("purchases.edit") ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void run(window.pos.suppliers.removeCost(c.id), "Xərc silindi"), children: "Sil" }) : null]) }),
    jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Qiymət", "Maya (xərclə)"], empty: "",
      rows: (doc.lines ?? []).map((l) => [l.name, formatMoney(((l.invoiceUnitCostMinor ?? null) !== null && doc.invoiceConfirmedAt) ? l.invoiceUnitCostMinor : l.unitCostMinor), h("b", null, formatMoney(l.landedUnitCostMinor ?? 0))]) }),
    h("h3", { className: "ps-recipe-step" }, "Yeni xərc"),
    h("div", { className: "flex flex-wrap gap-2" }, Object.entries(PS_COST_KINDS).map(([k, l]) =>
      h("button", { key: k, type: "button", "aria-pressed": form.kind === k, className: "ps-period-chip" + (form.kind === k ? " is-on" : ""), onClick: () => setForm({ ...form, kind: k }) }, l))),
    h("div", { className: "grid gap-2 sm:grid-cols-2" },
      jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: form.value, onChange: (v) => setForm({ ...form, value: v }), placeholder: "0.00" }),
      jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: form.note, onChange: (v) => setForm({ ...form, note: v }) }),
      psLabeled("Kim ödəyir", h("select", { value: form.toSupplier ? "1" : "0", className: psField, onChange: (e) => setForm({ ...form, toSupplier: e.target.value === "1" }) },
        h("option", { value: "1" }, "Təchizatçı fakturaya yazır (borca)"), h("option", { value: "0" }, "Ayrıca ödənilir (kassadan)"))),
      psLabeled("Bölüşdürmə", h("select", { value: form.allocation, className: psField, onChange: (e) => setForm({ ...form, allocation: e.target.value }) },
        h("option", { value: "value" }, "Dəyərə görə"), h("option", { value: "qty" }, "Miqdara (çəkiyə) görə")))),
    !form.toSupplier ? jsxRuntimeExports.jsx(PsAccountSelect, { value: form.accountId, onChange: (v) => setForm((p) => ({ ...p, accountId: v })), label: "Hansı kassadan ödənilir" }) : null,
    h("div", { className: "flex gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: add, children: "Xərci əlavə et" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: onClose, children: "Bağla" }))) });
}

/** Short ingredients: what the system would order, and from whom. */
function PsReplenishPanel({ warehouseId, onChanged }) {
  const h = psH;
  const [rows, setRows] = reactExports.useState(null);
  const [suppliers, setSuppliers] = reactExports.useState([]);
  const [pick, setPick] = reactExports.useState({});
  const load = reactExports.useCallback(async () => {
    const [s, sup] = await Promise.all([window.pos.stock.suggestions(warehouseId || ""), window.pos.suppliers.list()]);
    if (s.success) setRows(s.data.suggestions ?? []); else toast(s.error.message, "danger");
    if (sup.success) setSuppliers(sup.data.suppliers ?? []);
  }, [warehouseId]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const [busy, run] = usePsDialogRun(async () => { await load(); if (onChanged) await onChanged(); });
  if (!rows) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");
  return h("section", { className: "space-y-2" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      h("h3", { className: "ps-recipe-step" }, "Avtomatik təkliflər (" + rows.length + ")"),
      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void run(window.pos.stock.runReplenish(warehouseId || ""), "Yoxlanıldı — qaralamalar yeniləndi"), children: "İndi yoxla" })),
    jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Anbar", "Qalıq", "Yolda", "Min / hədəf", "Təklif", "Təchizatçı", ""], empty: "Minimumdan aşağı mal yoxdur (və ya artıq sifarişdədir)",
      rows: rows.map((r) => {
        const k = r.ingredientId + "|" + r.warehouseId;
        const chosen = pick[k] ?? (r.supplier ? r.supplier.supplierId : "");
        return [h("b", null, r.name), r.warehouseName, h("span", { style: { color: "var(--ps-danger)", fontWeight: 600 } }, opsQty(r.qtyMilli) + " " + r.unit),
          opsQty(r.onOrderMilli) + " " + r.unit, opsQty(r.minQtyMilli) + " / " + opsQty(r.targetQtyMilli) + " " + r.unit,
          h("b", null, opsQty(r.suggestedQtyMilli) + " " + r.unit),
          h("select", { value: chosen, className: "ps-cell-input", onChange: (e) => setPick({ ...pick, [k]: e.target.value }) },
            h("option", { value: "" }, "Təchizatçı seçin…"), suppliers.map((s) => h("option", { key: s.id, value: s.id }, s.name + (r.supplier && r.supplier.supplierId === s.id ? " ★ " + formatMoney(r.supplier.priceMinor) : "")))),
          jsxRuntimeExports.jsx(OpsButton, { disabled: busy || !chosen, onClick: () => void run(window.pos.stock.createDraft({ ingredientId: r.ingredientId, warehouseId: r.warehouseId,
            supplierId: chosen, qtyMilli: r.suggestedQtyMilli }), "Qaralamaya əlavə olundu"), children: "Qaralamaya at" })];
      }) }));
}

/** The same ingredient from several suppliers, side by side. */
function PsSupplierPrices() {
  const h = psH;
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const [ingredients, setIngredients] = reactExports.useState([]);
  const [suppliers, setSuppliers] = reactExports.useState([]);
  const [ingredientId, setIngredientId] = reactExports.useState("");
  const [items, setItems] = reactExports.useState([]);
  const [form, setForm] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void Promise.all([window.pos.inventory.ingredients(), window.pos.suppliers.list()]).then(([i, s]) => {
      if (i.success) setIngredients((i.data.ingredients ?? []).filter((x) => !String(x.sku || "").startsWith("MENU-")));
      if (s.success) setSuppliers(s.data.suppliers ?? []);
    });
  }, []);
  const load = reactExports.useCallback(async () => {
    const r = await window.pos.stock.supplierItems(ingredientId ? { ingredientId } : {});
    if (r.success) setItems(r.data.items ?? []); else toast(r.error.message, "danger");
  }, [ingredientId]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const [busy, run] = usePsDialogRun(load);
  const save = () => {
    if (!form.supplierId || !form.ingredientId) { toast("Təchizatçı və mal seçin", "danger"); return; }
    void run(window.pos.stock.saveSupplierItem({ supplierId: form.supplierId, ingredientId: form.ingredientId, leadDays: Math.max(0, Math.round(opsNum(form.lead || "0"))),
      minOrderMilli: Math.round(opsNum(form.min || "0") * 1000), packMilli: Math.round(opsNum(form.pack || "0") * 1000), supplierSku: form.sku.trim(), preferred: form.preferred,
      ...(form.price !== "" ? { lastPriceMinor: opsMinor(form.price) } : {}) }), "Saxlanıldı").then((ok) => { if (ok) setForm(null); });
  };
  const edit = (r) => setForm({ supplierId: r.supplierId, ingredientId: r.ingredientId, lead: String(r.leadDays ?? 0), min: String((r.minOrderMilli ?? 0) / 1000),
    pack: String((r.packMilli ?? 0) / 1000), sku: r.supplierSku || "", preferred: Boolean(r.preferred), price: "", fixed: true });
  return h("div", { className: "space-y-3" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      h("select", { value: ingredientId, onChange: (e) => setIngredientId(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" },
        h("option", { value: "" }, "Bütün mallar"), ingredients.map((i) => h("option", { key: i.id, value: i.id }, i.name))),
      h("span", { className: "ml-auto" }),
      hasPermission("suppliers.manage") ? jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ supplierId: "", ingredientId, lead: "0", min: "0", pack: "0", sku: "", preferred: false, price: "" }), children: "+ Təchizatçı şərti" }) : null),
    jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Təchizatçı", "Son qiymət", "Əvvəlki qiymətlər", "Min – maks", "Çatdırılma", "Min sifariş / paket", ""], empty: "Hələ qiymət yoxdur — mal qəbul edildikcə avtomatik yığılır",
      rows: items.map((r) => [h("b", null, r.ingredientName),
        h("span", { className: "flex flex-wrap items-center gap-1" }, r.supplierName, r.suggested ? psBadge("★ Təklif", "ok") : null, r.preferred ? psBadge("Seçilmiş", "muted") : null),
        h("b", null, formatMoney(r.lastPriceMinor ?? 0) + " / " + r.unit),
        (r.history ?? []).slice(1).map((x) => formatMoney(x.priceMinor)).join(" · ") || "—",
        (r.purchases ?? 0) > 0 ? formatMoney(r.minPriceMinor ?? 0) + " – " + formatMoney(r.maxPriceMinor ?? 0) : "—",
        (r.leadDays ?? 0) + " gün",
        opsQty(r.minOrderMilli ?? 0) + " / " + opsQty(r.packMilli ?? 0) + " " + r.unit,
        hasPermission("suppliers.manage") ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => edit(r), children: "Şərtlər" }) : null]) }),
    h("p", { className: "text-xs text-muted" }, "★ Təklif: qiymət və çatdırılma müddəti birlikdə ən sərfəli olan (hər gün gözləmə 2% baha sayılır). \"Seçilmiş\" təchizatçı həmişə üstündür."),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Təchizatçı şərtləri", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        psLabeled("Təchizatçı", h("select", { value: form.supplierId, disabled: form.fixed, className: psField, onChange: (e) => setForm({ ...form, supplierId: e.target.value }) },
          h("option", { value: "" }, "Seçin…"), suppliers.map((s) => h("option", { key: s.id, value: s.id }, s.name)))),
        psLabeled("Mal", h("select", { value: form.ingredientId, disabled: form.fixed, className: psField, onChange: (e) => setForm({ ...form, ingredientId: e.target.value }) },
          h("option", { value: "" }, "Seçin…"), ingredients.map((i) => h("option", { key: i.id, value: i.id }, i.name + " (" + i.unit + ")")))),
        jsxRuntimeExports.jsx(OpsField, { label: "Qiymət (₼, boş = son alış)", value: form.price, onChange: (v) => setForm({ ...form, price: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Çatdırılma müddəti (gün)", value: form.lead, onChange: (v) => setForm({ ...form, lead: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Minimum sifariş", value: form.min, onChange: (v) => setForm({ ...form, min: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Paket ölçüsü (0 = yox)", value: form.pack, onChange: (v) => setForm({ ...form, pack: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Təchizatçının kodu", value: form.sku, onChange: (v) => setForm({ ...form, sku: v }) })),
      h("label", { className: "flex items-center gap-2 text-sm" }, h("input", { type: "checkbox", checked: form.preferred, onChange: (e) => setForm({ ...form, preferred: e.target.checked }) }),
        "Bu mal üçün həmişə bu təchizatçı"),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null);
}

/** What each supplier is really like, per branch. */
function PsSupplierReport({ warehouseId }) {
  const h = psH;
  const [period, setPeriod] = reactExports.useState("month");
  const [rows, setRows] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void window.pos.stock.supplierReport({ from: psPeriodStart(period, 0), to: Date.now() + 86400000, warehouseId: warehouseId || "" })
      .then((r) => { if (r.success) setRows(r.data.suppliers ?? []); else toast(r.error.message, "danger"); });
  }, [period, warehouseId]);
  const pct = (bp) => ((Number(bp) || 0) / 100).toFixed(1) + "%";
  return h("div", { className: "space-y-3" },
    h("div", { className: "flex flex-wrap gap-2" }, [["week", "Bu həftə"], ["month", "Bu ay"], ["reset", "Hamısı"]].map(([k, l]) =>
      h("button", { key: k, type: "button", "aria-pressed": period === k, className: "ps-period-chip" + (period === k ? " is-on" : ""), onClick: () => setPeriod(k) }, l))),
    !rows ? h("p", { className: "text-sm text-muted" }, "Yüklənir…") : jsxRuntimeExports.jsx(OpsTable, {
      head: ["Təchizatçı", "Qaimə", "Alış həcmi", "Tamlıq", "Vaxtında", "Orta gecikmə", "Orta çatdırılma", "Qiymət dəyişməsi", "Rədd", "Qaytarma", "Borcumuz"],
      empty: "Bu dövrdə alış yoxdur",
      rows: rows.filter((r) => (r.purchases ?? 0) > 0 || (r.dueMinor ?? 0) !== 0).map((r) => [h("b", null, r.supplierName), String(r.purchases ?? 0),
        formatMoney(r.receivedValueMinor ?? 0), pct(r.fillRateBp), (r.timed ?? 0) > 0 ? pct(r.onTimeBp) : "—",
        (r.timed ?? 0) > 0 ? (Number(r.avgDelayDays) || 0).toFixed(1) + " gün" : "—", (Number(r.avgLeadDays) || 0).toFixed(1) + " gün",
        h("span", { style: { color: (r.priceChangeBp ?? 0) > 0 ? "var(--ps-danger)" : (r.priceChangeBp ?? 0) < 0 ? "var(--ps-ok)" : null } }, ((r.priceChangeBp ?? 0) > 0 ? "+" : "") + pct(r.priceChangeBp)),
        opsQty(r.rejectedMilli ?? 0), formatMoney(r.returnsMinor ?? 0) + " (" + pct(r.returnRateBp) + ")", formatMoney(r.dueMinor ?? 0)])
    }));
}

/** Anbar: lots expired / about to. */
function PsExpiryBanner({ warehouseId, onOpen }) {
  const h = psH;
  const [info, setInfo] = reactExports.useState(null);
  reactExports.useEffect(() => {
    if (!warehouseId) return;
    void window.pos.stock.expiry(warehouseId, 3).then((r) => { if (r.success) setInfo(r.data); });
  }, [warehouseId]);
  if (!info || (!info.expiredLots && !info.expiringLots && !info.pendingLots)) return null;
  return h("button", { type: "button", className: "ps-expiry-banner", onClick: onOpen },
    info.expiredLots ? h("b", null, info.expiredLots + " partiyanın vaxtı keçib (" + formatMoney(info.expiredValueMinor) + ")") : null,
    info.expiringLots ? h("span", null, info.expiringLots + " partiya 3 gün içində bitir (" + formatMoney(info.expiringValueMinor) + ")") : null,
    info.pendingLots ? h("span", null, info.pendingLots + " partiya keyfiyyət yoxlamasındadır") : null,
    h("small", null, "Partiyalara bax →"));
}

function PsStockLots({ warehouseId, onChanged }) {
  const h = psH;
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const [status, setStatus] = reactExports.useState("active");
  const [rows, setRows] = reactExports.useState(null);
  const [locations, setLocations] = reactExports.useState([]);
  const [move, setMove] = reactExports.useState(null);
  const [off, setOff] = reactExports.useState(null);
  const [query, setQuery] = reactExports.useState("");
  const load = reactExports.useCallback(async () => {
    const [l, loc] = await Promise.all([window.pos.stock.lots({ warehouseId, status, days: 3 }), window.pos.stock.locations(warehouseId)]);
    if (l.success) setRows(l.data.lots ?? []); else toast(l.error.message, "danger");
    if (loc.success) setLocations((loc.data.locations ?? []).filter((x) => x.active));
  }, [warehouseId, status]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const [busy, run] = usePsDialogRun(async () => { await load(); if (onChanged) await onChanged(); });
  const needle = query.trim().toLocaleLowerCase("az");
  const shown = (rows ?? []).filter((r) => !needle || (r.name + " " + r.lotNo + " " + r.supplierName).toLocaleLowerCase("az").includes(needle));
  return h("div", { className: "space-y-3" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["active", "Anbarda"], ["expiring", "3 gün içində bitir"], ["expired", "Vaxtı keçib"], ["pending", "Yoxlamada"], ["rejected", "Rədd edilib"], ["all", "Hamısı"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": status === k, className: "ps-period-chip" + (status === k ? " is-on" : ""), onClick: () => setStatus(k) }, l)),
      h("input", { value: query, placeholder: "Axtar: mal / partiya / təchizatçı", onChange: (e) => setQuery(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" })),
    !rows ? h("p", { className: "text-sm text-muted" }, "Yüklənir…") : jsxRuntimeExports.jsx(OpsTable, {
      head: ["Mal", "Partiya", "Yerləşmə", "Qəbul", "İstehsal", "Son istifadə", "Qalıq", "Dəyər", "Mənbə", ""],
      empty: "Bu seçimdə partiya yoxdur",
      rows: shown.map((r) => [h("b", null, r.name), r.lotNo || "—",
        r.locationName ? r.locationName + " (" + (PS_LOC_KINDS[r.locationKind] || r.locationKind) + ")" : "—",
        opsWhen(r.receivedAt), r.producedOn || "—", psDaysBadge(r),
        h("span", { style: { fontWeight: 600 } }, opsQty(r.qtyMilli) + " / " + opsQty(r.qtyReceivedMilli) + " " + r.unit),
        formatMoney(r.valueMinor ?? 0),
        [r.supplierName, r.purchaseNumber].filter(Boolean).join(" · ") || (r.lotNo === "İLKİN" ? "İlkin qalıq" : "—"),
        h("span", { className: "flex flex-wrap gap-1" },
          r.quality === "pending" && hasPermission("suppliers.receive") ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void run(window.pos.suppliers.inspectLot(r.id, "accept"), "Qəbul edildi — anbara girdi"), children: "Qəbul et" }) : null,
          r.quality === "pending" && hasPermission("suppliers.receive") ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void run(window.pos.suppliers.inspectLot(r.id, "reject"), "Rədd edildi"), children: "Rədd et" }) : null,
          r.quality === "accepted" && r.qtyMilli > 0 && hasPermission("inventory.transfer") ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setMove({ lot: r, locationId: r.locationId || "", qty: String(r.qtyMilli / 1000) }), children: "Yer dəyiş" }) : null,
          r.quality === "accepted" && r.qtyMilli > 0 && hasPermission("inventory.adjust") ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setOff({ lot: r, reason: (r.daysLeft ?? 1) < 0 ? "expired" : "waste", qty: String(r.qtyMilli / 1000), note: "" }), children: "Sil" }) : null)])
    }),
    move ? jsxRuntimeExports.jsx(PsAdminDialog, { title: move.lot.name + " — yer dəyiş", onClose: () => setMove(null), busy, children: h("div", { className: "space-y-3" },
      locations.length ? null : h("p", { className: "text-sm text-muted" }, "Əvvəlcə \"Yerləşmələr\" bölməsində soyuducu, rəf və s. yaradın."),
      psLabeled("Hara", h("select", { value: move.locationId, className: psField, onChange: (e) => setMove({ ...move, locationId: e.target.value }) },
        h("option", { value: "" }, "— Yerləşməsiz —"), locations.map((l) => h("option", { key: l.id, value: l.id }, l.name + " (" + (PS_LOC_KINDS[l.kind] || l.kind) + ")")))),
      jsxRuntimeExports.jsx(OpsField, { label: "Miqdar (" + move.lot.unit + ")", value: move.qty, onChange: (v) => setMove({ ...move, qty: v }) }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void run(window.pos.stock.relocate({ lotId: move.lot.id, locationId: move.locationId, qtyMilli: Math.round(opsNum(move.qty || "0") * 1000) }), "Köçürüldü").then((ok) => { if (ok) setMove(null); }), children: "Köçür" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setMove(null), children: "İmtina" }))) }) : null,
    off ? jsxRuntimeExports.jsx(PsAdminDialog, { title: off.lot.name + " — anbardan sil", onClose: () => setOff(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "flex flex-wrap gap-2" }, [["expired", "Vaxtı keçib"], ["waste", "İsraf / xarab"], ["lost", "İtki"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": off.reason === k, className: "ps-period-chip" + (off.reason === k ? " is-on" : ""), onClick: () => setOff({ ...off, reason: k }) }, l))),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Miqdar (" + off.lot.unit + ")", value: off.qty, onChange: (v) => setOff({ ...off, qty: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: off.note, onChange: (v) => setOff({ ...off, note: v }) })),
      h("p", { className: "text-xs text-muted" }, "Dəyəri İtkilər hesabatına düşür: " + formatMoney(Math.round(opsNum(off.qty || "0") * (off.lot.unitCostMinor ?? 0)))),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void run(window.pos.stock.writeOff({ lotId: off.lot.id, qtyMilli: Math.round(opsNum(off.qty || "0") * 1000), reason: off.reason, note: off.note.trim() }), "Silindi").then((ok) => { if (ok) setOff(null); }), children: "Sil" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setOff(null), children: "İmtina" }))) }) : null);
}

function PsStockLocations({ warehouseId }) {
  const h = psH;
  const canManage = useAuthStore((st) => st.hasPermission)("inventory.manage");
  const [rows, setRows] = reactExports.useState([]);
  const [form, setForm] = reactExports.useState(null);
  const load = reactExports.useCallback(async () => {
    const r = await window.pos.stock.locations(warehouseId);
    if (r.success) setRows(r.data.locations ?? []); else toast(r.error.message, "danger");
  }, [warehouseId]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const [busy, run] = usePsDialogRun(load);
  const save = () => {
    if (!form.name.trim()) { toast("Adını yazın", "danger"); return; }
    void run(window.pos.stock.saveLocation({ ...(form.id ? { id: form.id } : { warehouseId }), name: form.name.trim(), kind: form.kind, active: form.active }), "Saxlanıldı").then((ok) => { if (ok) setForm(null); });
  };
  return h("div", { className: "space-y-3" },
    h("div", { className: "flex flex-wrap items-center gap-2" }, h("p", { className: "text-sm text-muted" }, "Soyuducu, dondurucu, rəf və zonalar — partiyalar bunlara yerləşdirilir."),
      h("span", { className: "ml-auto" }), canManage ? jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ name: "", kind: "fridge", active: true }), children: "+ Yeni yerləşmə" }) : null),
    jsxRuntimeExports.jsx(OpsTable, { head: ["Ad", "Növ", "Partiya", "Vəziyyət", ""], empty: "Hələ yerləşmə yoxdur",
      rows: rows.map((l) => [h("b", null, l.name), PS_LOC_KINDS[l.kind] || l.kind, String(l.lotCount ?? 0), l.active ? "Aktiv" : "Bağlı",
        canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm({ id: l.id, name: l.name, kind: l.kind, active: Boolean(l.active) }), children: "Redaktə" }) : null]) }),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Yerləşməni redaktə et" : "Yeni yerləşmə", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: form.name, onChange: (v) => setForm({ ...form, name: v }), placeholder: "məs. Ət soyuducusu" }),
      h("div", { className: "flex flex-wrap gap-2" }, Object.entries(PS_LOC_KINDS).map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": form.kind === k, className: "ps-period-chip" + (form.kind === k ? " is-on" : ""), onClick: () => setForm({ ...form, kind: k }) }, l))),
      form.id ? h("label", { className: "flex items-center gap-2 text-sm" }, h("input", { type: "checkbox", checked: form.active, onChange: (e) => setForm({ ...form, active: e.target.checked }) }), "Aktiv") : null,
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null);
}

function PsStockRules({ warehouseId }) {
  const h = psH;
  const canManage = useAuthStore((st) => st.hasPermission)("inventory.manage");
  const [rows, setRows] = reactExports.useState([]);
  const [edits, setEdits] = reactExports.useState({});
  const [query, setQuery] = reactExports.useState("");
  const [refresh, setRefresh] = reactExports.useState(0);
  const load = reactExports.useCallback(async () => {
    const r = await window.pos.stock.rules(warehouseId);
    if (r.success) { setRows(r.data.rules ?? []); setEdits({}); } else toast(r.error.message, "danger");
  }, [warehouseId]);
  reactExports.useEffect(() => { void load(); }, [load]);
  const [busy, run] = usePsDialogRun(async () => { await load(); setRefresh((n) => n + 1); });
  const val = (r, k) => (edits[r.ingredientId] && edits[r.ingredientId][k] !== undefined ? edits[r.ingredientId][k] : String((r[k] ?? 0) / 1000));
  const put = (r, k, v) => setEdits({ ...edits, [r.ingredientId]: { ...(edits[r.ingredientId] || {}), [k]: v } });
  const save = (r) => void run(window.pos.stock.saveRule({ ingredientId: r.ingredientId, warehouseId, minQtyMilli: Math.round(opsNum(val(r, "minQtyMilli") || "0") * 1000),
    targetQtyMilli: Math.round(opsNum(val(r, "targetQtyMilli") || "0") * 1000), reorderQtyMilli: Math.round(opsNum(val(r, "reorderQtyMilli") || "0") * 1000) }), "Saxlanıldı");
  const needle = query.trim().toLocaleLowerCase("az");
  return h("div", { className: "space-y-4" },
    jsxRuntimeExports.jsx(PsReplenishPanel, { warehouseId, onChanged: load }, "rp-" + refresh),
    h("div", { className: "flex flex-wrap items-center gap-2" }, h("h3", { className: "ps-recipe-step" }, "Sifariş qaydaları"),
      h("input", { value: query, placeholder: "Axtar", onChange: (e) => setQuery(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" })),
    jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Qalıq", "Minimum", "Hədəf stok", "Optimal sifariş", ""], empty: "Mal yoxdur",
      rows: rows.filter((r) => !needle || r.name.toLocaleLowerCase("az").includes(needle)).map((r) => [h("b", null, r.name),
        h("span", { style: (r.minQtyMilli ?? 0) > 0 && (r.qtyMilli ?? 0) <= r.minQtyMilli ? { color: "var(--ps-danger)", fontWeight: 600 } : null }, opsQty(r.qtyMilli) + " " + r.unit),
        ...["minQtyMilli", "targetQtyMilli", "reorderQtyMilli"].map((k) => h("input", { key: k, inputMode: "decimal", disabled: !canManage, value: val(r, k), className: "ps-cell-input", onChange: (e) => put(r, k, e.target.value) })),
        canManage && edits[r.ingredientId] ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => save(r), children: "Saxla" }) : null]) }),
    h("p", { className: "text-xs text-muted" }, "Qalıq + yolda olan minimuma düşəndə sistem təklif olunan təchizatçıya qaralama alış yaradır (hədəfə qədər, ən azı optimal sifariş qədər). Qaralama Alışlar → Qaralamalar-da təsdiqlənməsə sifariş getmir."));
}

function PsStockLoss({ warehouseId }) {
  const h = psH;
  const [period, setPeriod] = reactExports.useState("month");
  const [data, setData] = reactExports.useState(null);
  reactExports.useEffect(() => {
    void window.pos.stock.lossReport({ from: psPeriodStart(period, 0), to: Date.now() + 86400000, warehouseId })
      .then((r) => { if (r.success) setData(r.data); else toast(r.error.message, "danger"); });
  }, [period, warehouseId]);
  const label = { expired: "Vaxtı keçib", waste: "İsraf", lost: "İtki" };
  return h("div", { className: "space-y-3" },
    h("div", { className: "flex flex-wrap gap-2" }, [["day", "Bu gün"], ["week", "Bu həftə"], ["month", "Bu ay"], ["reset", "Hamısı"]].map(([k, l]) =>
      h("button", { key: k, type: "button", "aria-pressed": period === k, className: "ps-period-chip" + (period === k ? " is-on" : ""), onClick: () => setPeriod(k) }, l))),
    !data ? h("p", { className: "text-sm text-muted" }, "Yüklənir…") : h("div", { className: "space-y-3" },
      h("div", { className: "ps-stock-metrics" },
        psMetric("Vaxtı keçmiş silinən", formatMoney(data.expiredMinor), "dövrdə", data.expiredMinor ? "var(--ps-danger)" : null),
        psMetric("İsraf", formatMoney(data.wasteMinor), "dövrdə", data.wasteMinor ? "var(--ps-danger)" : null),
        psMetric("İtki (sayım, düzəliş)", formatMoney(data.lostMinor), "dövrdə", data.lostMinor ? "var(--ps-danger)" : null),
        psMetric("Cəmi itki", formatMoney(data.totalMinor), "dövrdə", data.totalMinor ? "var(--ps-danger)" : null),
        psMetric("Anbarda vaxtı keçmiş", formatMoney(data.expiredOnHandMinor), data.expiredOnHandLots + " partiya", data.expiredOnHandMinor ? "var(--ps-warn)" : null),
        psMetric("Minimumdan aşağı", formatMoney(data.belowMinValueMinor), (data.belowMin ?? []).length + " mal (çatışmayan dəyər)", (data.belowMin ?? []).length ? "var(--ps-warn)" : null)),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Tarix", "Növ", "Mal", "Anbar", "Miqdar", "Dəyər", "Səbəb"], empty: "Bu dövrdə itki yoxdur",
        rows: (data.rows ?? []).map((r) => [opsWhen(r.createdAt), label[r.category] || r.category, h("b", null, r.name), r.warehouseName, opsQty(r.qtyMilli) + " " + r.unit,
          h("b", { style: { color: "var(--ps-danger)" } }, formatMoney(r.valueMinor ?? 0)), r.reason || "—"]) }),
      (data.belowMin ?? []).length ? jsxRuntimeExports.jsx(OpsTable, { head: ["Minimumdan aşağı", "Anbar", "Qalıq", "Minimum", "Çatışmır", "Dəyər"], empty: "",
        rows: data.belowMin.map((r) => [h("b", null, r.name), r.warehouseName, opsQty(r.qtyMilli) + " " + r.unit, opsQty(r.minQtyMilli), opsQty(r.shortMilli), formatMoney(r.valueMinor ?? 0)]) }) : null,
      h("p", { className: "text-xs text-muted" }, "Dəyər partiyanın öz maya dəyəri ilə, partiya olmayanda seçilmiş üsulla (" + ({ average: "çəkili orta", fifo: "FIFO", last: "son qiymət" }[data.method] || data.method) + ") hesablanır.")));
}

function PsStockViews({ view, warehouseId, onChanged }) {
  if (!warehouseId) return null;
  if (view === "lots") return jsxRuntimeExports.jsx(PsStockLots, { warehouseId, onChanged }, "lots-" + warehouseId);
  if (view === "locations") return jsxRuntimeExports.jsx(PsStockLocations, { warehouseId }, "loc-" + warehouseId);
  if (view === "rules") return jsxRuntimeExports.jsx(PsStockRules, { warehouseId }, "rules-" + warehouseId);
  if (view === "loss") return jsxRuntimeExports.jsx(PsStockLoss, { warehouseId }, "loss-" + warehouseId);
  return null;
}

`;

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  s = replaceOnce(s, '/* POS_PURCHASES_v1 */\n/* POS_PURCHASES_v2 */\nfunction OpsPurchases() {', COMPONENTS + '/* POS_PURCHASES_v1 */\n/* POS_PURCHASES_v2 */\nfunction OpsPurchases() {', 'components');

  // ---------------------------------------------------------------- Alışlar
  s = replaceOnce(s, '  const [confirmAsk, confirmDialog] = useConfirm();\n  const [invoice, setInvoice]',
    '  const [confirmAsk, confirmDialog] = useConfirm();\n  const [receiving, setReceiving] = reactExports.useState(null);\n  const [invoicing, setInvoicing] = reactExports.useState(null);\n  const [costing, setCosting] = reactExports.useState(null);\n  const [invoice, setInvoice]', 'purchase dialog state');
  s = replaceOnce(s, 'const monthBought = purchases.filter((p) => p.status === "received" && (psOpsTimestamp(p.receivedAt || p.createdAt) || 0) >= monthStart).reduce((t, p) => t + (Number(p.totalMinor) || 0), 0);',
    'const monthBought = purchases.filter((p) => p.status !== "cancelled" && (psOpsTimestamp(p.receivedAt || p.orderedAt || p.createdAt) || 0) >= monthStart).reduce((t, p) => t + (Number(p.chargedMinor) || 0), 0);\n  const openOrders = purchases.filter((p) => p.status === "ordered" || p.status === "partially_received");\n  const drafts = data.purchases.filter((p) => p.status === "draft" && (!objectFilter || p.warehouseId === objectFilter));', 'month bought');
  s = replaceOnce(s, '      metric("Bu ay qaytarma", formatMoney(monthReturned), returns.filter((r) => (psOpsTimestamp(r.createdAt) || 0) >= monthStart).length + " qaytarma")),',
    '      metric("Bu ay qaytarma", formatMoney(monthReturned), returns.filter((r) => (psOpsTimestamp(r.createdAt) || 0) >= monthStart).length + " qaytarma"),\n      metric("Gözlənilən mal", String(openOrders.length), "sifariş / qismən qəbul", openOrders.length ? "var(--ps-warn)" : null),\n      metric("Qaralamalar", String(drafts.length), drafts.filter((p) => p.autoDraft).length + " avtomatik", drafts.length ? "var(--ps-warn)" : null)),', 'metrics');
  s = replaceOnce(s, '[["invoices", "Alış qaimələri"], ["returns", "Qaytarmalar"]]',
    '[["invoices", "Alış qaimələri"], ["drafts", "Qaralamalar" + (drafts.length ? " (" + drafts.length + ")" : "")], ["returns", "Qaytarmalar"], ["prices", "Təchizatçı qiymətləri"], ["report", "Hesabat"]]', 'views');
  s = replaceOnce(s, '        p.status === "received" ? "Qəbul edilib" : p.status === "cancelled" ? "Ləğv edilib" : "Gözləyir",',
    '        psStageBadge(p),', 'stage badge');
  s = replaceOnce(s, '      rows: purchases.map((p) => [', '      rows: purchases.filter((p) => p.status !== "draft").map((p) => [', 'drafts out of invoices');
  s = replaceOnce(s, '          p.status !== "received" && p.status !== "cancelled" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void run(window.pos.suppliers.receive(p.id), "Qəbul edildi"), children: "Qəbul et" }) : null,',
    `          (p.status === "ordered" || p.status === "partially_received") && hasPermission("suppliers.receive") ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => setReceiving(p.id), children: "Mal qəbulu" }) : null,
          p.status !== "cancelled" && p.status !== "draft" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setInvoicing(p.id), children: p.invoiceConfirmedAt ? "Faktura ✓" : "Faktura" }) : null,
          p.status !== "cancelled" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setCosting(p.id), children: "Xərclər" }) : null,`, 'receive button');
  s = replaceOnce(s, '          p.status === "received" && canFix ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(p), children: "Düzəliş et" }) : null,',
    '          p.status !== "cancelled" && canFix ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(p), children: "Düzəliş et" }) : null,', 'edit button');
  s = replaceOnce(s, '          p.status === "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void openReturnFrom(p), children: "Qaytar" }) : null)',
    '          (p.status === "received" || p.status === "partially_received") && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void openReturnFrom(p), children: "Qaytar" }) : null)', 'return button');
  // What can go back is what came in.
  s = replaceOnce(s, 'maxMilli: Math.max(0, (Number(l.qtyMilli) || 0) - (Number(l.returnedMilli) || 0)), qty: "",',
    'maxMilli: Math.max(0, (Number(l.receivedMilli) || 0) - (Number(l.returnedMilli) || 0)), qty: "",', 'return max');
  s = replaceOnce(s, 'maxMilli: Math.max(0, (Number(l.qtyMilli) || 0) - (Number(l.returnedMilli) || 0) + (mine.get(l.ingredientId) || 0)),',
    'maxMilli: Math.max(0, (Number(l.receivedMilli) || 0) - (Number(l.returnedMilli) || 0) + (mine.get(l.ingredientId) || 0)),', 'return edit max');

  // New invoice: order now, receive later (or both at once, as before).
  s = replaceOnce(s, '  const saveInvoice = () => {\n    if (!invoice.supplierId && !invoice.newSupplier.trim())', '  const saveInvoice = (mode) => {\n    if (!invoice.supplierId && !invoice.newSupplier.trim())', 'save mode');
  s = replaceOnce(s, '      const saved = await window.pos.suppliers.savePurchase({ ...head, idempotencyKey: newIdempotencyKey() });\n      if (!saved.success) return saved;\n      const received = await window.pos.suppliers.receive(saved.data.id);',
    '      const saved = await window.pos.suppliers.savePurchase({ ...head, idempotencyKey: newIdempotencyKey() });\n      if (!saved.success) return saved;\n      if (mode === "order") {\n        if (paid > 0) return window.pos.suppliers.pay({ supplierId, amountMinor: paid, purchaseId: saved.data.id, accountId: invoice.accountId || "", note: "Alış sifarişi (avans)" });\n        return saved;\n      }\n      const received = await window.pos.suppliers.receive(saved.data.id);', 'order only');
  s = replaceOnce(s, '    })(), invoice.editId ? "Qaimə düzəldildi" : "Alış qaiməsi qəbul edildi").then((ok) => { if (ok) setInvoice(null); });',
    '    })(), invoice.editId ? "Qaimə düzəldildi" : mode === "order" ? "Sifariş yaradıldı — mal gələndə \\"Mal qəbulu\\"" : "Alış qaiməsi qəbul edildi").then((ok) => { if (ok) setInvoice(null); });', 'order toast');
  s = replaceOnce(s, '        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveInvoice, children: invoice.editId ? "Yadda saxla" : "Təsdiq et" }),',
    '        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => saveInvoice("receive"), children: invoice.editId ? "Yadda saxla" : "Təsdiq et və qəbul et" }),\n        invoice.editId ? null : jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => saveInvoice("order"), children: "Yalnız sifariş et" }),', 'order button');

  // Views: drafts, prices, report.
  s = replaceOnce(s, '    detail ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },',
    `    view === "drafts" ? h("div", { className: "space-y-4" },
      jsxRuntimeExports.jsx(PsReplenishPanel, { warehouseId: objectFilter, onChanged: reload }),
      h("h3", { className: "ps-recipe-step" }, "Qaralama alışlar"),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Qaimə", "Yaradılıb", "Təchizatçı", "Obyekt", "Cəm", "", ""], empty: "Qaralama yoxdur",
        rows: drafts.map((p) => [h("b", null, p.number), opsWhen(p.createdAt), p.supplierName, p.objectName || p.warehouseName || "—", formatMoney(p.totalMinor ?? 0),
          p.autoDraft ? psBadge("Avtomatik", "warn") : psBadge("Əl ilə", "muted"),
          h("span", { className: "flex flex-wrap gap-1" },
            jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openDetail(p), children: "Bax" }),
            canManage ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void run(window.pos.suppliers.confirmPurchase(p.id), "Təsdiqləndi — sifariş oldu"), children: "Təsdiq et" }) : null,
            canFix ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(p), children: "Düzəliş et" }) : null,
            canRemove ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void removePurchase(p), children: "Sil" }) : null)]) })) : null,
    view === "prices" ? jsxRuntimeExports.jsx(PsSupplierPrices, {}) : null,
    view === "report" ? jsxRuntimeExports.jsx(PsSupplierReport, { warehouseId: objectFilter }) : null,

    detail ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },`, 'extra views');
  s = cut(s, '      jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Alınıb", "Qaytarılıb", "Qiymət", "Cəm"], empty: "Sətir yoxdur",', '\n    ledger ? h("section"',
    `      h("div", { className: "flex flex-wrap gap-2 text-xs text-muted" }, psStageBadge(detail),
        detail.invoiceNo ? h("span", null, "Faktura " + detail.invoiceNo + (detail.invoiceConfirmedAt ? " ✓ təsdiqli" : " (təsdiqsiz)")) : null,
        detail.expectedAt ? h("span", null, "Gözlənilən: " + opsWhen(detail.expectedAt)) : null,
        h("span", null, "Borca yazılıb: " + formatMoney(detail.chargedMinor ?? 0))),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Sifariş", "Qəbul", "Qalan", "Yoxlamada", "Rədd", "Qaytarılıb", "Faktura", "Qiymət", "Maya (xərclə)"], empty: "Sətir yoxdur",
        rows: (detail.lines ?? []).map((l) => [l.name, opsQty(l.qtyMilli) + " " + l.unit, opsQty(l.receivedMilli) + " " + l.unit, (l.remainingMilli ?? 0) > 0 ? opsQty(l.remainingMilli) : "—",
          (l.pendingMilli ?? 0) > 0 ? opsQty(l.pendingMilli) : "—", (l.rejectedMilli ?? 0) > 0 ? opsQty(l.rejectedMilli) : "—", (l.returnedMilli ?? 0) > 0 ? opsQty(l.returnedMilli) : "—",
          (l.invoiceQtyMilli ?? null) !== null ? opsQty(l.invoiceQtyMilli) + " × " + formatMoney(l.invoiceUnitCostMinor ?? 0) : "—",
          formatMoney(l.unitCostMinor ?? 0), formatMoney(l.landedUnitCostMinor ?? 0)]) }),
      (detail.receipts ?? []).length ? jsxRuntimeExports.jsx(OpsTable, { head: ["Qəbul", "Tarix", "Kim", "Mallar"], empty: "",
        rows: detail.receipts.map((r) => [r.number, opsWhen(r.createdAt), r.userName || "—", (r.lines ?? []).map((x) => x.name + " " + opsQty(x.qtyMilli) + (x.rejectedMilli ? " (rədd " + opsQty(x.rejectedMilli) + ")" : "") + (x.quality === "pending" ? " · yoxlamada" : "")).join(", ")]) }) : null,
      (detail.lots ?? []).length ? jsxRuntimeExports.jsx(OpsTable, { head: ["Partiya", "Mal", "Yer", "Son istifadə", "Qalıq", "Keyfiyyət", ""], empty: "",
        rows: detail.lots.map((x) => [x.lotNo || "—", x.name, x.locationName || "—", x.expiresOn || "—", opsQty(x.qtyMilli) + " / " + opsQty(x.qtyReceivedMilli) + " " + x.unit, PS_QUALITY[x.quality] || x.quality,
          x.quality === "pending" && hasPermission("suppliers.receive") ? h("span", { className: "flex gap-1" },
            jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void run(window.pos.suppliers.inspectLot(x.id, "accept"), "Qəbul edildi").then(() => openDetail(detail)), children: "Qəbul" }),
            jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void run(window.pos.suppliers.inspectLot(x.id, "reject"), "Rədd edildi").then(() => openDetail(detail)), children: "Rədd" })) : null]) }) : null,
      (detail.costs ?? []).length ? h("p", { className: "text-xs text-muted" }, "Əlavə xərclər: " + detail.costs.map((c) => (PS_COST_KINDS[c.kind] || c.kind) + " " + formatMoney(c.amountMinor)).join(" · ")) : null) : null,
`, 'detail table');

  s = replaceOnce(s, `        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: savePay, children: "Ödə" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "İmtina" }))) }) : null,
    confirmDialog);`, `        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: savePay, children: "Ödə" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "İmtina" }))) }) : null,
    receiving ? jsxRuntimeExports.jsx(PsReceiveDialog, { purchaseId: receiving, onClose: () => setReceiving(null), onDone: reload }) : null,
    invoicing ? jsxRuntimeExports.jsx(PsInvoiceDialog, { purchaseId: invoicing, onClose: () => setInvoicing(null), onDone: reload }) : null,
    costing ? jsxRuntimeExports.jsx(PsCostsDialog, { purchaseId: costing, onClose: () => setCosting(null), onDone: reload }) : null,
    confirmDialog);`, 'dialogs');

  // ------------------------------------------------------------------ Anbar
  s = replaceOnce(s, '  const [drawer, setDrawer] = reactExports.useState(null);\n  const [edit, setEdit] = reactExports.useState(null);\n\n  const [loading, setLoading]',
    '  const [drawer, setDrawer] = reactExports.useState(null);\n  const [edit, setEdit] = reactExports.useState(null);\n  const [stockView, setStockView] = reactExports.useState("levels");\n\n  const [loading, setLoading]', 'stock view state');
  s = replaceOnce(s, '    psNegativeBanner(levels),\n', `    psNegativeBanner(levels),
    jsxRuntimeExports.jsx(PsExpiryBanner, { warehouseId, onOpen: () => setStockView("lots") }, "exp-" + warehouseId),
    psH("div", { className: "flex flex-wrap gap-2" }, [["levels", "Qalıqlar"], ["lots", "Partiyalar"], ["locations", "Yerləşmələr"], ["rules", "Sifariş qaydaları"], ["loss", "İtkilər"]].map(([k, l]) =>
      psH("button", { key: k, type: "button", "aria-pressed": stockView === k, className: "ps-period-chip" + (stockView === k ? " is-on" : ""), onClick: () => setStockView(k) }, l))),
    stockView !== "levels" ? jsxRuntimeExports.jsx(PsStockViews, { view: stockView, warehouseId, onChanged: reload }) : null,
`, 'stock views');
  s = replaceOnce(s, '    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [\n      chip("all", "Hamısı", levels.length),',
    '    stockView === "levels" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [\n      chip("all", "Hamısı", levels.length),', 'levels chips');
  s = replaceOnce(s, '    /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {\n      head: ["Məhsul", "Cari stok", "Satış", "Maya", "Stok dəyəri", "Status", ""],',
    '    stockView === "levels" && /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {\n      head: ["Məhsul", "Cari stok", "Satış", "Maya", "Stok dəyəri", "Status", ""],', 'levels table');

  // ------------------------------------------------------------ Kalkulyasiya
  s = replaceOnce(s, '  const [resetAt, setResetAt] = reactExports.useState(0);\n  const [confirmAsk, confirmDialog] = useConfirm();\n  reactExports.useEffect(() => {\n    void window.pos.settings.getAll()',
    '  const [resetAt, setResetAt] = reactExports.useState(0);\n  const [costMethod, setCostMethod] = reactExports.useState("");\n  const [confirmAsk, confirmDialog] = useConfirm();\n  reactExports.useEffect(() => {\n    void window.pos.stock.costingMethod().then((r) => { if (r.success) setCostMethod(r.data.method); });\n  }, []);\n  reactExports.useEffect(() => {\n    void window.pos.settings.getAll()', 'costing state');
  s = replaceOnce(s, '      window.pos.inventory.costing(since),\n      window.pos.inventory.ingredients()\n    ]);',
    '      window.pos.inventory.costing(since, costMethod),\n      window.pos.inventory.ingredients()\n    ]);', 'costing call');
  s = replaceOnce(s, '    if (ingRes.success) setIngredients(ingRes.data.ingredients ?? []);\n  }, [since]);',
    '    if (ingRes.success) setIngredients(ingRes.data.ingredients ?? []);\n  }, [since, costMethod]);', 'costing deps');
  s = replaceOnce(s, '      psH("small", null, "Satılan, gəlir və qazanc seçilən dövr üçündür")),',
    `      psH("small", null, "Satılan, gəlir və qazanc seçilən dövr üçündür")),
    psH("div", { className: "ps-period-bar" },
      psH("span", null, "Maya üsulu:"),
      [["average", "Çəkili orta"], ["fifo", "FIFO"], ["last", "Son alış qiyməti"]].map(([k, l]) =>
        psH("button", { key: k, type: "button", "aria-pressed": costMethod === k, className: "ps-period-chip" + (costMethod === k ? " is-on" : ""), onClick: async () => {
          const r = await window.pos.stock.costingMethod(k);
          if (r.success) setCostMethod(r.data.method); else toast(r.error.message, "danger");
        } }, l)),
      psH("small", null, costMethod === "fifo" ? "Anbarda qalan ən köhnə partiyanın qiyməti" : costMethod === "last" ? "Son alışın maya dəyəri (əlavə xərclərlə)" : "Hər qəbulda yenilənən orta maya dəyəri")),`, 'method bar');
  fs.writeFileSync(BUNDLE, s);
  console.log('procurement applied');
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-badge-ok { background: #e7f5ee; color: var(--ps-ok, #15803d); }
.ps-receive-row { padding: 0.6rem 0.7rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-receive-head { margin-bottom: 0.4rem; }
.ps-receive-head small { color: #64748b; }
.ps-receive-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.5rem; }
.ps-cell-input { width: 100%; min-width: 5rem; padding: 0.35rem 0.5rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.5rem; background: var(--ps-elevated, #fff); }
.ps-expiry-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1rem; width: 100%; text-align: left; padding: 0.6rem 0.9rem; border-radius: 0.8rem; background: #fff4e0; color: #92400e; border: 1px solid #f5d29a; }
.ps-expiry-banner b { color: var(--ps-danger, #dc2626); }
.ps-expiry-banner small { margin-left: auto; font-weight: 600; }
`;
    fs.writeFileSync(CSS, css);
  }
}
