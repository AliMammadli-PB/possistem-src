#!/usr/bin/env node
/**
 * 1.7.25 — Alışlar: purchase invoices, returns to the supplier, supplier debt.
 *
 *  - Əməliyyatlar: Təchizat, Müştərilər, İş qrafiki, Rezervasiya hidden; one
 *    "Alışlar" section instead.
 *  - New invoice: supplier (from Partnyorlar, or typed in), Anbar goods with
 *    quantity and price, optional amount paid now from a kassa. Saving
 *    receives it at once (purchases.save + purchases.receive): goods into the
 *    store, the total onto the supplier's debt, the paid part off it.
 *  - Return (from an invoice or free): goods out of the store, the same money
 *    off the debt (purchases.return).
 *  - Supplier debts: balance, history, pay from a kassa.
 * Runs after apply-restaurant-objects.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_PURCHASES_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes('"purchases.return":')) {
    m = replaceOnce(m, 'Cn={',
      'Cn={"purchases.return":{auth:!0,perm:"suppliers.manage",timeout:8e3,idempotent:!0},"purchases.returns":{auth:!0,perm:"suppliers.view",timeout:8e3,idempotent:!1},',
      'main policy');
    fs.writeFileSync(MAIN, m);
    console.log('main: purchase returns');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('purchases.return"')) {
    p = replaceOnce(p,
      '    receive: (purchaseId) => call("purchases.receive", { purchaseId }, { timeoutMs: 30000 })\n  },',
      '    receive: (purchaseId) => call("purchases.receive", { purchaseId }, { timeoutMs: 30000 }),\n    returnGoods: (input, options) => call("purchases.return", input, options),\n    returns: (supplierId) => call("purchases.returns", { supplierId: supplierId ?? "" })\n  },',
      'preload suppliers');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: purchase returns');
  }
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  s = replaceOnce(s, 'function OpsObjects() {', `${MARK}
function OpsPurchases() {
  const h = psH;
  const [data, setData] = reactExports.useState(null);
  const [view, setView] = reactExports.useState("invoices");
  const [supplierFilter, setSupplierFilter] = reactExports.useState("");
  const [invoice, setInvoice] = reactExports.useState(null);
  const [ret, setRet] = reactExports.useState(null);
  const [pay, setPay] = reactExports.useState(null);
  const [detail, setDetail] = reactExports.useState(null);
  const [ledger, setLedger] = reactExports.useState(null);
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const canManage = hasPermission("suppliers.manage");
  const reload = reactExports.useCallback(async () => {
    const [sup, pur, rets, ings] = await Promise.all([window.pos.suppliers.list(), window.pos.suppliers.purchases(), window.pos.suppliers.returns(""), window.pos.inventory.ingredients()]);
    const failed = [sup, pur, rets, ings].find((r) => !r.success);
    if (failed) { toast(failed.error.message, "danger"); return; }
    setData({ suppliers: sup.data.suppliers ?? [], purchases: pur.data.purchases ?? [], returns: rets.data.returns ?? [], ingredients: ings.data.ingredients ?? [] });
  }, []);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!data) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");

  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
  const ingById = new Map(data.ingredients.map((i) => [i.id, i]));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const purchases = data.purchases.filter((p) => !supplierFilter || p.supplierId === supplierFilter);
  const returns = data.returns.filter((r) => !supplierFilter || r.supplierId === supplierFilter);
  const suppliers = data.suppliers.filter((x) => !supplierFilter || x.id === supplierFilter);
  const totalDue = suppliers.reduce((t, x) => t + (Number(x.dueMinor) || 0), 0);
  const monthBought = purchases.filter((p) => p.status === "received" && (psOpsTimestamp(p.receivedAt || p.createdAt) || 0) >= monthStart).reduce((t, p) => t + (Number(p.totalMinor) || 0), 0);
  const monthReturned = returns.filter((r) => (psOpsTimestamp(r.createdAt) || 0) >= monthStart).reduce((t, r) => t + (Number(r.totalMinor) || 0), 0);
  const qtyMilli = (v) => Math.round(opsNum(v) * 1000);
  const lineTotal = (l) => Math.round(qtyMilli(l.qty) * opsMinor(l.price || "0") / 1000);
  const metric = (label, value, sub, tone) => h("div", { key: label, className: "ps-stock-metric" },
    h("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint" }, label),
    h("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream", style: tone ? { color: tone } : null }, value),
    h("p", { className: "mt-1 text-[11px] text-muted" }, sub));
  const blankLine = () => ({ ingredientId: "", qty: "", price: "" });
  const setLine = (form, setForm, i, patch) => setForm({ ...form, lines: form.lines.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    if (patch.ingredientId && !l.price) { const ing = ingById.get(patch.ingredientId); if (ing) next.price = ((Number(ing.costMinor) || 0) / 100).toFixed(2); }
    return next;
  }) });
  const lineRows = (form, setForm, withMax) => h("div", { className: "ps-recipe-rows" }, form.lines.map((l, i) => {
    const ing = ingById.get(l.ingredientId);
    return h("div", { key: i, className: "ps-purchase-row" },
      withMax && l.fixed
        ? h("span", { className: "ps-recipe-name" }, l.name, h("small", null, " · ən çox " + opsQty(l.maxMilli) + " " + (l.unit || "")))
        : h("select", { value: l.ingredientId, className: field, onChange: (e) => setLine(form, setForm, i, { ingredientId: e.target.value }) },
            h("option", { value: "" }, "Anbar məhsulu seçin…"),
            data.ingredients.map((x) => h("option", { key: x.id, value: x.id }, x.name + " (" + x.unit + ")"))),
      h("label", { className: "ps-recipe-price" }, h("span", null, "Miqdar" + (ing || l.unit ? " (" + (ing ? ing.unit : l.unit) + ")" : "")),
        h("input", { inputMode: "decimal", value: l.qty, placeholder: "0", onChange: (e) => setLine(form, setForm, i, { qty: e.target.value }) })),
      h("label", { className: "ps-recipe-price" }, h("span", null, "Qiymət (₼)"),
        h("input", { inputMode: "decimal", value: l.price, placeholder: "0.00", onChange: (e) => setLine(form, setForm, i, { price: e.target.value }) })),
      h("b", { className: "ps-recipe-cost" }, formatMoney(lineTotal(l))),
      h("button", { type: "button", className: "ps-recipe-remove", "aria-label": "Sil", onClick: () => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) }) }, "×"));
  }));
  const supplierSelect = (form, setForm, allowNew) => h("div", { className: "grid gap-2 sm:grid-cols-2" },
    h("label", { className: "block text-sm" }, h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Təchizatçı"),
      h("select", { value: form.supplierId, disabled: Boolean(form.purchaseId), className: field, onChange: (e) => setForm({ ...form, supplierId: e.target.value }) },
        h("option", { value: "" }, allowNew ? "— Yeni təchizatçı —" : "Seçin…"),
        data.suppliers.map((x) => h("option", { key: x.id, value: x.id }, x.name + ((x.dueMinor ?? 0) > 0 ? " · borc " + formatMoney(x.dueMinor) : ""))))),
    allowNew && !form.supplierId ? jsxRuntimeExports.jsx(OpsField, { label: "Yeni təchizatçının adı", value: form.newSupplier, onChange: (v) => setForm({ ...form, newSupplier: v }), placeholder: "məs. Bazar MMC" }) : null);

  const saveInvoice = () => {
    const lines = invoice.lines.filter((l) => l.ingredientId && qtyMilli(l.qty) > 0)
      .map((l) => ({ ingredientId: l.ingredientId, qtyMilli: qtyMilli(l.qty), unitCostMinor: opsMinor(l.price || "0") }));
    if (!invoice.supplierId && !invoice.newSupplier.trim()) { toast("Təchizatçını seçin və ya adını yazın", "danger"); return; }
    if (!lines.length) { toast("Ən azı bir mal və miqdar yazın", "danger"); return; }
    const total = invoice.lines.reduce((t, l) => t + lineTotal(l), 0);
    const paid = invoice.paid ? opsMinor(invoice.paid) : 0;
    if (paid < 0 || paid > total) { toast("Ödənilən məbləğ cəmdən çox ola bilməz", "danger"); return; }
    void run((async () => {
      let supplierId = invoice.supplierId;
      if (!supplierId) {
        const created = await window.pos.suppliers.save({ name: invoice.newSupplier.trim() });
        if (!created.success) return created;
        supplierId = created.data.id;
      }
      const saved = await window.pos.suppliers.savePurchase({ supplierId, lines, note: invoice.note.trim(), idempotencyKey: newIdempotencyKey() });
      if (!saved.success) return saved;
      const received = await window.pos.suppliers.receive(saved.data.id);
      if (!received.success) return received;
      if (paid > 0) return window.pos.suppliers.pay({ supplierId, amountMinor: paid, purchaseId: saved.data.id, accountId: invoice.accountId || "", note: "Alış qaiməsi" });
      return received;
    })(), "Alış qaiməsi qəbul edildi").then((ok) => { if (ok) setInvoice(null); });
  };

  const openReturnFrom = async (p) => {
    const r = await window.pos.suppliers.purchase(p.id);
    if (!r.success) { toast(r.error.message, "danger"); return; }
    const lines = (r.data.lines ?? []).map((l) => ({ ingredientId: l.ingredientId, name: l.name, unit: l.unit, fixed: true,
      maxMilli: Math.max(0, (Number(l.qtyMilli) || 0) - (Number(l.returnedMilli) || 0)), qty: "", price: ((Number(l.unitCostMinor) || 0) / 100).toFixed(2) }))
      .filter((l) => l.maxMilli > 0);
    if (!lines.length) { toast("Bu qaimədən qaytarılacaq mal qalmayıb", "danger"); return; }
    setRet({ supplierId: r.data.supplierId, purchaseId: p.id, purchaseNumber: p.number, lines, note: "" });
  };
  const saveReturn = () => {
    const lines = ret.lines.filter((l) => l.ingredientId && qtyMilli(l.qty) > 0)
      .map((l) => ({ ingredientId: l.ingredientId, qtyMilli: qtyMilli(l.qty), unitCostMinor: opsMinor(l.price || "0") }));
    if (!ret.supplierId) { toast("Təchizatçını seçin", "danger"); return; }
    if (!lines.length) { toast("Qaytarılan malı və miqdarı yazın", "danger"); return; }
    const over = ret.lines.find((l) => l.fixed && qtyMilli(l.qty) > l.maxMilli);
    if (over) { toast(over.name + ": ən çox " + opsQty(over.maxMilli) + " qaytarmaq olar", "danger"); return; }
    void run(window.pos.suppliers.returnGoods({ supplierId: ret.supplierId, purchaseId: ret.purchaseId || "", lines, note: ret.note.trim() },
      { idempotencyKey: newIdempotencyKey() }), "Qaytarıldı — məbləğ borcdan silindi").then((ok) => { if (ok) setRet(null); });
  };
  const savePay = () => {
    if (!psStockInputValid(pay.value) || opsMinor(pay.value) <= 0) { toast("Məbləği yazın", "danger"); return; }
    if (opsMinor(pay.value) > (pay.supplier.dueMinor ?? 0)) { toast("Ödəniş borcdan çox ola bilməz", "danger"); return; }
    void run(window.pos.suppliers.pay({ supplierId: pay.supplier.id, amountMinor: opsMinor(pay.value), accountId: pay.accountId || "", note: pay.note.trim() }),
      "Ödəniş qeyd olundu").then((ok) => { if (ok) setPay(null); });
  };
  const openDetail = async (p) => {
    const r = await window.pos.suppliers.purchase(p.id);
    if (r.success) setDetail(r.data); else toast(r.error.message, "danger");
  };
  const openLedger = async (x) => {
    const r = await window.pos.suppliers.ledger(x.id);
    if (r.success) setLedger({ supplier: x, rows: r.data.entries ?? [] }); else toast(r.error.message, "danger");
  };
  const ledgerKind = (e) => e.kind === "payment" ? "Ödəniş" : (e.amountMinor ?? 0) < 0 ? "Qaytarma (borcdan silindi)" : "Alış (borc)";
  const invoiceTotal = invoice ? invoice.lines.reduce((t, l) => t + lineTotal(l), 0) : 0;
  const returnTotal = ret ? ret.lines.reduce((t, l) => t + lineTotal(l), 0) : 0;

  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      metric("Təchizatçılara borc", formatMoney(totalDue), suppliers.filter((x) => (x.dueMinor ?? 0) > 0).length + " təchizatçı", totalDue > 0 ? "var(--ps-danger)" : null),
      metric("Bu ay alış", formatMoney(monthBought), purchases.filter((p) => (psOpsTimestamp(p.createdAt) || 0) >= monthStart).length + " qaimə"),
      metric("Bu ay qaytarma", formatMoney(monthReturned), returns.filter((r) => (psOpsTimestamp(r.createdAt) || 0) >= monthStart).length + " qaytarma")),

    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["invoices", "Alış qaimələri"], ["returns", "Qaytarmalar"], ["debts", "Təchizatçı borcları"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": view === k, className: "ps-period-chip" + (view === k ? " is-on" : ""), onClick: () => setView(k) }, l)),
      h("select", { value: supplierFilter, onChange: (e) => setSupplierFilter(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" },
        h("option", { value: "" }, "Bütün təchizatçılar"), data.suppliers.map((x) => h("option", { key: x.id, value: x.id }, x.name))),
      h("span", { className: "ml-auto" }),
      canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setRet({ supplierId: supplierFilter, purchaseId: "", lines: [blankLine()], note: "" }), children: "Geri qaytarma" }) : null,
      canManage ? jsxRuntimeExports.jsx(OpsButton, { onClick: () => setInvoice({ supplierId: supplierFilter, newSupplier: "", lines: [blankLine()], paid: "", accountId: undefined, note: "" }), children: "+ Yeni alış qaiməsi" }) : null),

    view === "invoices" ? jsxRuntimeExports.jsx(OpsTable, {
      head: ["Qaimə", "Tarix", "Təchizatçı", "Cəm", "Qalan borc", "Vəziyyət", ""],
      empty: "Hələ alış qaiməsi yoxdur",
      rows: purchases.map((p) => [
        h("b", null, p.number), opsWhen(p.receivedAt || p.createdAt), p.supplierName, formatMoney(p.totalMinor ?? 0),
        h("span", { style: (p.dueMinor ?? 0) > 0 ? { color: "var(--ps-danger)", fontWeight: 600 } : null }, formatMoney(p.dueMinor ?? 0)),
        p.status === "received" ? "Qəbul edilib" : p.status === "cancelled" ? "Ləğv edilib" : "Gözləyir",
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openDetail(p), children: "Bax" }),
          p.status !== "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void run(window.pos.suppliers.receive(p.id), "Qəbul edildi"), children: "Qəbul et" }) : null,
          p.status === "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void openReturnFrom(p), children: "Qaytar" }) : null)
      ])
    }) : null,

    view === "returns" ? jsxRuntimeExports.jsx(OpsTable, {
      head: ["Qaytarma", "Tarix", "Təchizatçı", "Qaimə", "Mallar", "Borcdan silindi"],
      empty: "Hələ qaytarma yoxdur",
      rows: returns.map((r) => [h("b", null, r.number), opsWhen(r.createdAt), r.supplierName, r.purchaseNumber || "—",
        (r.lines ?? []).map((l) => l.name + " " + opsQty(l.qtyMilli) + " " + l.unit).join(", "),
        h("b", { style: { color: "var(--ps-ok)" } }, formatMoney(r.totalMinor ?? 0))])
    }) : null,

    view === "debts" ? jsxRuntimeExports.jsx(OpsTable, {
      head: ["Təchizatçı", "Telefon", "Borc", ""],
      empty: "Təchizatçı yoxdur — Partnyorlar bölməsində və ya yeni qaimədə yaradın",
      rows: suppliers.map((x) => [h("b", null, x.name), x.phone || "—",
        h("span", { style: (x.dueMinor ?? 0) > 0 ? { color: "var(--ps-danger)", fontWeight: 700 } : null }, formatMoney(x.dueMinor ?? 0)),
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void openLedger(x), children: "Hesab" }),
          (x.dueMinor ?? 0) > 0 && hasPermission("suppliers.pay") ? jsxRuntimeExports.jsx(OpsButton, { onClick: () => setPay({ supplier: x, value: "", note: "", accountId: undefined }), children: "Ödə" }) : null)])
    }) : null,

    detail ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, detail.number + " — " + detail.supplierName + " · " + formatMoney(detail.totalMinor ?? 0)),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setDetail(null), children: "Bağla" })),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Mal", "Alınıb", "Qaytarılıb", "Qiymət", "Cəm"], empty: "Sətir yoxdur",
        rows: (detail.lines ?? []).map((l) => [l.name, opsQty(l.qtyMilli) + " " + l.unit, (Number(l.returnedMilli) || 0) > 0 ? opsQty(l.returnedMilli) + " " + l.unit : "—",
          formatMoney(l.unitCostMinor ?? 0), formatMoney(l.lineTotalMinor ?? 0)]) })) : null,

    ledger ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, ledger.supplier.name + " — hesab · borc " + formatMoney(ledger.supplier.dueMinor ?? 0)),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setLedger(null), children: "Bağla" })),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Tarix", "Növ", "Məbləğ", "Qeyd"], empty: "Hərəkət yoxdur",
        rows: ledger.rows.map((e) => [opsWhen(e.createdAt), ledgerKind(e),
          h("b", { style: { color: e.kind === "charge" && (e.amountMinor ?? 0) > 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(Math.abs(e.amountMinor ?? 0))),
          e.note || "—"]) })) : null,

    invoice ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni alış qaiməsi", onClose: () => setInvoice(null), busy, children: h("div", { className: "space-y-3" },
      supplierSelect(invoice, setInvoice, true),
      h("h3", { className: "ps-recipe-step" }, "Mallar"),
      lineRows(invoice, setInvoice, false),
      h("button", { type: "button", className: "ps-recipe-add", onClick: () => setInvoice({ ...invoice, lines: [...invoice.lines, blankLine()] }) }, "+ Sətir"),
      h("div", { className: "ps-purchase-total" }, h("span", null, "Qaimənin cəmi"), h("b", null, formatMoney(invoiceTotal))),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "İndi ödənilən (₼) — boş qalsa hamısı borca", value: invoice.paid, onChange: (v) => setInvoice({ ...invoice, paid: v }), placeholder: "0.00" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: invoice.note, onChange: (v) => setInvoice({ ...invoice, note: v }), placeholder: "məs. qaimə №123" })),
      invoice.paid && opsMinor(invoice.paid) > 0 ? jsxRuntimeExports.jsx(PsAccountSelect, { value: invoice.accountId, onChange: (v) => setInvoice((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassadan ödənilir" }) : null,
      h("p", { className: "text-xs text-muted" }, "Təsdiq edəndə mallar anbara girir, " + formatMoney(Math.max(0, invoiceTotal - (invoice.paid ? opsMinor(invoice.paid) : 0))) + " təchizatçının borcuna yazılır."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveInvoice, children: "Təsdiq et" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setInvoice(null), children: "İmtina" }))) }) : null,

    ret ? jsxRuntimeExports.jsx(PsAdminDialog, { title: ret.purchaseId ? "Qaytarma — qaimə " + ret.purchaseNumber : "Geri qaytarma", onClose: () => setRet(null), busy, children: h("div", { className: "space-y-3" },
      supplierSelect(ret, setRet, false),
      lineRows(ret, setRet, true),
      !ret.purchaseId ? h("button", { type: "button", className: "ps-recipe-add", onClick: () => setRet({ ...ret, lines: [...ret.lines, blankLine()] }) }, "+ Sətir") : null,
      h("div", { className: "ps-purchase-total" }, h("span", null, "Borcdan silinəcək"), h("b", null, formatMoney(returnTotal))),
      jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: ret.note, onChange: (v) => setRet({ ...ret, note: v }), placeholder: "məs. xarab gəldi" }),
      h("p", { className: "text-xs text-muted" }, "Mallar anbardan çıxır, məbləğ təchizatçının borcundan silinir."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: saveReturn, children: "Qaytar" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setRet(null), children: "İmtina" }))) }) : null,

    pay ? jsxRuntimeExports.jsx(PsAdminDialog, { title: pay.supplier.name + " — ödəniş", onClose: () => setPay(null), busy, children: h("div", { className: "space-y-3" },
      h("p", { className: "text-xs text-muted" }, "Cari borc: " + formatMoney(pay.supplier.dueMinor ?? 0) + ". Bir hissəsini ödəsəniz, qalanı borc olaraq qalır."),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: pay.value, onChange: (v) => setPay({ ...pay, value: v }), placeholder: "0.00" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: pay.note, onChange: (v) => setPay({ ...pay, note: v }) })),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: pay.accountId, onChange: (v) => setPay((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassadan ödənilir" }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: savePay, children: "Ödə" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "İmtina" }))) }) : null);
}

function OpsObjects() {`, 'purchases component');

  // Tabs: Alışlar in, four out.
  s = replaceOnce(s, '    { id: "suppliers", label: "Təchizat", show: ',
    '    { id: "purchases", label: "Alışlar", show: hasPermission("suppliers.view") && _psArea("/operations?tab=suppliers"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsPurchases, {}) },\n    { id: "suppliers", label: "Təchizat", show: false && ',
    'purchases tab');
  s = replaceOnce(s, '    { id: "guests", label: "Müştərilər", show: ', '    { id: "guests", label: "Müştərilər", show: false && ', 'hide guests');
  s = replaceOnce(s, '    { id: "reservations", label: "Rezervasiya", show: ', '    { id: "reservations", label: "Rezervasiya", show: false && ', 'hide reservations');
  s = replaceOnce(s, '    { id: "roster", label: "İş qrafiki", show: ', '    { id: "roster", label: "İş qrafiki", show: false && ', 'hide roster');
  fs.writeFileSync(BUNDLE, s);
  console.log('purchases applied');
}

// Titles (apply-restaurant-admin-refresh.mjs rewrites these maps on every assemble).
{
  let t = fs.readFileSync(BUNDLE, 'utf8');
  if (!t.includes('purchases: ["Alışlar"')) {
    t = replaceOnce(t, 'objects: ["Obyektlər", "Şubeler", "Branches"]', 'purchases: ["Alışlar", "Alımlar", "Purchases"], objects: ["Obyektlər", "Şubeler", "Branches"]', 'purchases title');
    t = replaceOnce(t, '    objects: ["Filiallar',
      '    purchases: ["Alış qaimələri, təchizatçıya qaytarma və təchizatçı borcları.", "Alım faturaları, iadeler ve tedarikçi borçları.", "Purchase invoices, returns and supplier debt."],\n    objects: ["Filiallar',
      'purchases subtitle');
    fs.writeFileSync(BUNDLE, t);
    console.log('purchases: tab titles');
  }
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-purchase-row { display: grid; grid-template-columns: minmax(10rem, 1.6fr) minmax(6rem, 0.8fr) minmax(6rem, 0.8fr) 5rem 2.5rem; align-items: end; gap: 0.5rem; padding: 0.5rem 0.6rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-purchase-row .ps-recipe-name small { color: #64748b; font-weight: 500; }
.ps-purchase-total { display: flex; justify-content: space-between; align-items: baseline; padding: 0.6rem 0.8rem; border-radius: 0.8rem; background: #f1f5f9; }
.ps-purchase-total b { font-size: 1.3rem; }
@media (max-width: 720px) { .ps-purchase-row { grid-template-columns: 1fr 1fr; } .ps-purchase-row > select, .ps-purchase-row > .ps-recipe-name { grid-column: 1 / -1; } }
`;
    fs.writeFileSync(CSS, css);
  }
}
