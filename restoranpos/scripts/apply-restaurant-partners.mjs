#!/usr/bin/env node
/**
 * 1.7.22 — Anbar, Kalkulyasiya periods, Partnyorlar, tabs, salaries, expenses.
 *
 *  - Anbar: new / edit item = name, barcode (scan it, or left empty for an
 *    in-store EAN-13 starting with 2), unit, purchase and sale price. Cards for
 *    total stock, its purchase and sale value and the expected profit; a
 *    banner for items that went negative.
 *  - Kalkulyasiya: Bu gün / Bu həftə / Bu ay / Sıfırlanandan bəri and a
 *    "Sıfırla" button (settings costing.resetAt); negative ingredients listed.
 *  - Təchizatçılar → Partnyorlar: suppliers, employees and guests; a new
 *    partner picks its type, an employee gets a monthly salary.
 *  - Order screen: "Partnyor seç" bottom right (orders.setPartner). Payment
 *    screen: "Qalanı … borcuna yaz və bağla" (orders.close toAccount).
 *  - Maaşlar: per employee and month - salary, paid, meals on their tab,
 *    still due; Avans / Tam ödəniş / Qeyd (salary.list, salary.pay).
 *  - Xərclər: cash expenses by category and period (cash.movement expense).
 *
 * Main gets the three new methods in its policy table, the preload the calls.
 * Runs after apply-restaurant-recipe-v2.mjs (uses psH, psRecipeEditor).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_PARTNERS_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

// ------------------------------------------------------------------ main
{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes(MARK)) {
    m = replaceOnce(m, 'Cn={"reports.costing":',
      `Cn={${MARK}"orders.setPartner":{auth:!0,perm:"customers.view",timeout:3e3,idempotent:!0},"salary.list":{auth:!0,perm:"salary.manage",timeout:8e3,idempotent:!1},"salary.pay":{auth:!0,perm:"salary.manage",timeout:5e3,idempotent:!0},"reports.costing":`,
      'main policy table');
    fs.writeFileSync(MAIN, m);
    console.log('main: partner and salary methods');
  }
}

// --------------------------------------------------------------- preload
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('salary.list')) {
    p = replaceOnce(p,
      '    close: (orderId, options) => call("orders.close", { orderId }, options),',
      `    close: (orderId, options) => call("orders.close", { orderId }, options),
    /** Closes the bill with what is unpaid on the partner's tab ("nisyə"). */
    closeToAccount: (orderId, options) => call("orders.close", { orderId, toAccount: true }, options),
    setPartner: (orderId, customerId) => call("orders.setPartner", { orderId, customerId: customerId ?? "" }),`,
      'preload orders');
    p = replaceOnce(p,
      '    costing: () => call("reports.costing", {}, { timeoutMs: 15000 }),',
      '    costing: (since) => call("reports.costing", { since: since ?? 0 }, { timeoutMs: 15000 }),',
      'preload costing since');
    p = replaceOnce(p,
      '  guests: {',
      `  salary: {
    list: (input) => call("salary.list", input),
    pay: (input, options) => call("salary.pay", input, options)
  },

  guests: {`,
      'preload salary');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: partner, salary, costing period');
  }
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  // ------------------------------------------------------- shared helpers
  s = replaceOnce(s, 'function psRecipeUnits(stockUnit) {', `${MARK}
/** An in-store EAN-13 (prefix 2) no other item has. */
function psMakeBarcode(taken) {
  for (let i = 0; i < 50; i++) {
    const body = "2" + String(Date.now() % 1e8).padStart(8, "0") + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += Number(body[k]) * (k % 2 ? 3 : 1);
    const code = body + ((10 - (sum % 10)) % 10);
    if (!taken.has(code)) return code;
  }
  return "";
}
/** Stock on hand by unit, and what it cost and sells for. */
function psStockTotals(levels) {
  const byUnit = new Map();
  let buy = 0, sell = 0, profit = 0;
  for (const r of levels) {
    const q = Number(r.qtyMilli) || 0;
    if (q <= 0) continue;
    byUnit.set(r.unit, (byUnit.get(r.unit) || 0) + q);
    const cost = Math.round(q * (Number(r.costMinor) || 0) / 1000);
    buy += cost;
    const sale = Number(r.salePriceMinor) || 0;
    if (sale > 0) { const v = Math.round(q * sale / 1000); sell += v; profit += v - cost; }
  }
  const text = [...byUnit].map(([u, q]) => opsQty(q) + " " + u).join(" · ") || "0";
  return { buy, sell, profit, text };
}
/** Start of today / this week (Monday) / this month, never before the last reset. */
function psPeriodStart(period, resetAt) {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "week") start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  if (period === "month") start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (period === "reset") start = 0;
  return Math.max(start, Number(resetAt) || 0);
}
function psStockItemDialog({ drawer, setDrawer, busy, run, levels }) {
  const h = psH;
  const set = (patch) => setDrawer({ ...drawer, ...patch });
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";
  const save = () => {
    if (!drawer.name.trim()) { toast("Malın adını yazın", "danger"); return; }
    if (!psStockInputValid(drawer.cost, { empty: true }) || !psStockInputValid(drawer.sale, { empty: true })) { toast("Alış və satış qiyməti düzgün rəqəm olmalıdır", "danger"); return; }
    const taken = new Set(levels.filter((r) => r.id !== drawer.id).map((r) => String(r.barcode || "")).filter(Boolean));
    let barcode = String(drawer.barcode || "").trim();
    if (barcode && taken.has(barcode)) { toast("Bu barkod artıq başqa məhsuldadır", "danger"); return; }
    if (!barcode) barcode = psMakeBarcode(taken);
    void run(window.pos.inventory.saveIngredient({
      ...(drawer.id ? { id: drawer.id } : {}),
      name: drawer.name.trim(), unit: drawer.unit, barcode,
      costMinor: opsMinor(drawer.cost), salePriceMinor: opsMinor(drawer.sale),
      minQtyMilli: drawer.minQtyMilli || 0
    }), drawer.id ? "Saxlanıldı" : "Məhsul əlavə olundu").then((ok) => { if (ok) setDrawer(null); });
  };
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: drawer.id ? "Məhsulu redaktə et" : "Yeni məhsul", onClose: () => setDrawer(null), busy, children: h("div", { className: "space-y-3" },
    h("div", { className: "grid gap-2 sm:grid-cols-2" },
      jsxRuntimeExports.jsx(OpsField, { label: "Malın adı", value: drawer.name, onChange: (v) => set({ name: v }), placeholder: "məs. Pomidor" }),
      h("label", { className: "block text-sm" },
        h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Barkod"),
        h("input", { value: drawer.barcode || "", autoFocus: !drawer.id, inputMode: "numeric", className: field,
          placeholder: "Skanerlə oxudun · boş qalsa avtomatik",
          onChange: (e) => set({ barcode: e.target.value.replace(/\\s+/g, "") }),
          onKeyDown: (e) => { if (e.key === "Enter") e.preventDefault(); } })),
      h("label", { className: "block text-sm" },
        h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Vahid"),
        h("select", { value: drawer.unit, className: field, onChange: (e) => set({ unit: e.target.value }) },
          [["kg", "kq"], ["l", "litr"], ["ədəd", "ədəd"], ["qab", "qab"]].map(([u, l]) => h("option", { key: u, value: u }, l)))),
      jsxRuntimeExports.jsx(OpsField, { label: "Alış qiyməti (maya, ₼)", value: drawer.cost, onChange: (v) => set({ cost: v }), placeholder: "0.00" }),
      jsxRuntimeExports.jsx(OpsField, { label: "Satış qiyməti (₼)", value: drawer.sale, onChange: (v) => set({ sale: v }), placeholder: "0.00" })),
    h("p", { className: "text-xs text-muted" }, "Miqdar Təchizat (alış) və ya Düzəliş ilə daxil edilir. Barkod boş qalsa, proqram özü verir."),
    h("div", { className: "flex gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setDrawer(null), children: "İmtina" })))
  });
}
function psNegativeBanner(items) {
  const neg = items.filter((i) => (Number(i.qtyMilli) || 0) < 0);
  if (!neg.length) return null;
  return psH("div", { className: "ps-neg-banner" },
    psH("b", null, "Mənfi qalıq: "),
    neg.map((i) => i.name + " " + opsQty(i.qtyMilli) + " " + i.unit).join(" · "),
    psH("span", null, " — satılan yeməklərin tərkibi anbarda çatmır, giriş edin."));
}
function psRecipeUnits(stockUnit) {`, 'helpers');

  // ------------------------------------------------------------- 1-3. Anbar
  s = replaceOnce(s,
    `    if (qty <= 0) return { key: "out", label: "Bitib", color: "var(--ps-danger)", tint: "#fdecea" };`,
    `    if (qty < 0) return { key: "neg", label: "Mənfi", color: "var(--ps-danger)", tint: "#fdecea" };
    if (qty <= 0) return { key: "out", label: "Bitib", color: "var(--ps-danger)", tint: "#fdecea" };`,
    'stock negative state');
  s = replaceOnce(s,
    `  const belowMin = levels.filter((r) => stateOf(r).key === "low").length;`,
    `  const belowMin = levels.filter((r) => stateOf(r).key === "low").length;
  const totals = psStockTotals(levels);
  const negCount = levels.filter((r) => stateOf(r).key === "neg").length;`,
    'stock totals');
  const cardsStart = s.indexOf(`      card("Ümumi stok dəyəri"`);
  const cardsEnd = s.indexOf(`\n    ] }),`, cardsStart);
  if (cardsStart < 0 || cardsEnd < 0) throw new Error('stock cards not found');
  s = s.slice(0, cardsStart) + `      card("Ümumi qalıq", totals.text, String(levels.length) + " məhsul", null),
      card("Alış dəyəri", formatMoney(totals.buy), "Qalıq × alış qiyməti", null),
      card("Satış dəyəri", formatMoney(totals.sell), "Qalıq × satış qiyməti", null),
      card("Gözlənilən qazanc", formatMoney(totals.profit), "Satış − alış", totals.profit < 0 ? "var(--ps-danger)" : "var(--ps-ok)"),
      card("Bitən / mənfi", String(outOf + negCount), outOf + negCount ? "Giriş edin" : "Hamısı var", outOf + negCount ? "var(--ps-danger)" : null)` + s.slice(cardsEnd);
  s = replaceOnce(s,
    `] }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      warehouses.length > 1`,
    `] }),
    psNegativeBanner(levels),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      warehouses.length > 1`,
    'stock negative banner');
  s = replaceOnce(s,
    `setDrawer({ name: "", unit: "kg", cost: "", minQty: "", qty: "" }), children: "+ Yeni məhsul" })`,
    `setDrawer({ name: "", unit: "kg", cost: "", sale: "", barcode: "" }), children: "+ Yeni məhsul" })`,
    'stock new item');
  s = replaceOnce(s,
    `      chip("out", "Bitib", outOf),
      chip("low", "Minimumdan aşağı", belowMin),
      chip("near", "Minimuma yaxın", levels.filter((r) => stateOf(r).key === "near").length),`,
    `      chip("neg", "Mənfi", negCount),
      chip("out", "Bitib", outOf),`,
    'stock chips');
  s = replaceOnce(s,
    `head: ["Məhsul", "Cari stok", "Minimum", "Maya", "Stok dəyəri", "Status", ""],`,
    `head: ["Məhsul", "Cari stok", "Satış", "Maya", "Stok dəyəri", "Status", ""],`,
    'stock head');
  s = replaceOnce(s, `          opsQty(row.minQtyMilli),`, `          formatMoney(row.salePriceMinor ?? 0),`, 'stock sale cell');
  s = replaceOnce(s,
    `            row.sku ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-[11px] text-faint", children: row.sku }) : null`,
    `            (row.barcode || row.sku) ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-[11px] text-faint", children: row.barcode || row.sku }) : null`,
    'stock barcode under name');
  s = replaceOnce(s,
    `            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEdit({ mode: "adjust", row, value: "", reason: "" }), children: "Düzəliş" }),`,
    `            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setDrawer({ id: row.id, name: row.name, unit: row.unit, cost: ((row.costMinor ?? 0) / 100).toFixed(2), sale: ((row.salePriceMinor ?? 0) / 100).toFixed(2), barcode: row.barcode || "", minQtyMilli: row.minQtyMilli || 0 }), children: "Redaktə" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEdit({ mode: "adjust", row, value: "", reason: "" }), children: "Düzəliş" }),`,
    'stock edit button');
  {
    const start = s.indexOf(`    drawer && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: psAdminText("Yeni məhsul"`);
    const end = s.indexOf(`\n    edit && /* @__PURE__ */`, start);
    if (start < 0 || end < 0) throw new Error('stock drawer not found');
    s = s.slice(0, start) + `    /* POS_STOCK_RECIPE_v1 */ /* dialog replaced by POS_PARTNERS_v1 */\n    drawer && psStockItemDialog({ drawer, setDrawer, busy, run, levels }),\n` + s.slice(end);
  }

  // ---------------------------------------------------------- 4. Kalkulyasiya
  s = replaceOnce(s,
    `  const [pickQuery, setPickQuery] = reactExports.useState("");
`,
    `  const [pickQuery, setPickQuery] = reactExports.useState("");
  const [period, setPeriod] = reactExports.useState("day");
  const [resetAt, setResetAt] = reactExports.useState(0);
  const [confirmAsk, confirmDialog] = useConfirm();
  reactExports.useEffect(() => {
    void window.pos.settings.getAll().then((r) => { if (r.success) setResetAt(Number(r.data.settings["costing.resetAt"]) || 0); });
  }, []);
  const since = psPeriodStart(period, resetAt);
`,
    'costing period state');
  s = replaceOnce(s,
    `    const [costRes, ingRes] = await Promise.all([
      window.pos.inventory.costing(),`,
    `    const [costRes, ingRes] = await Promise.all([
      window.pos.inventory.costing(since),`,
    'costing since call');
  s = replaceOnce(s,
    `    if (ingRes.success) setIngredients(ingRes.data.ingredients ?? []);
  }, []);`,
    `    if (ingRes.success) setIngredients(ingRes.data.ingredients ?? []);
  }, [since]);`,
    'costing reload deps');
  s = replaceOnce(s,
    `    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2 text-xs text-muted", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Sıralama:" }),`,
    `    psNegativeBanner(ingredients),
    psH("div", { className: "ps-period-bar" },
      psH("span", null, "Dövr:"),
      [["day", "Bu gün"], ["week", "Bu həftə"], ["month", "Bu ay"], ["reset", "Sıfırlanandan bəri"]].map(([k, l]) =>
        psH("button", { key: k, type: "button", "aria-pressed": period === k, className: "ps-period-chip" + (period === k ? " is-on" : ""), onClick: () => setPeriod(k) }, l)),
      psH("button", { type: "button", className: "ps-period-reset", onClick: async () => {
        if (!(await confirmAsk("Satış sayları sıfırlansın? Reseptlər və anbar dəyişmir.", { danger: true }))) return;
        const now = Date.now();
        const r = await window.pos.settings.set("costing.resetAt", String(now));
        if (!r.success) { toast(r.error.message, "danger"); return; }
        setResetAt(now); setPeriod("reset"); toast("Sıfırlandı", "success");
      } }, "Sıfırla"),
      psH("small", null, "Satılan, gəlir və qazanc seçilən dövr üçündür")),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2 text-xs text-muted", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Sıralama:" }),`,
    'costing period bar');
  s = replaceOnce(s, `"Total qazanc: ",`, `"Dövr qazancı: ",`, 'costing profit label');
  s = replaceOnce(s,
    `    editor && psRecipeEditor({ editor, setEditor, ingredients, busy, pickQuery, setPickQuery, lineCostMinor, editorCost, setLine, saveRecipe, unitLabel })
  ] });`,
    `    editor && psRecipeEditor({ editor, setEditor, ingredients, busy, pickQuery, setPickQuery, lineCostMinor, editorCost, setLine, saveRecipe, unitLabel }),
    confirmDialog
  ] });`,
    'costing confirm dialog');

  // --------------------------------------------------- 5, 7, 8. Ops tabs
  s = replaceOnce(s,
    `    { id: "vendors", label: "Təchizatçılar", show: hasPermission("suppliers.view") && _psArea("/operations?tab=vendors"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsVendors, {}) },`,
    `    { id: "vendors", label: "Partnyorlar", show: (hasPermission("suppliers.view") || hasPermission("customers.view")) && _psArea("/operations?tab=vendors"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsPartners, {}) },
    { id: "salary", label: "Maaşlar", show: hasPermission("salary.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsSalary, {}) },
    { id: "expenses", label: "Xərclər", show: hasPermission("cash.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsExpenses, {}) },`,
    'ops tabs');
  s = replaceOnce(s, `setGuests(res.data.customers ?? [])`, `setGuests((res.data.customers ?? []).filter((g) => g.kind !== "employee"))`, 'guests without employees');

  s = replaceOnce(s, `function OpsGuests() {`, `const PS_PARTNER_TYPES = { supplier: "Təchizatçı", employee: "İşçi", customer: "Müştəri" };
function OpsPartners() {
  const h = psH;
  const hasPermission = useAuthStore((st) => st.hasPermission);
  const canPeople = hasPermission("customers.view");
  const canSuppliers = hasPermission("suppliers.view");
  const [type, setType] = reactExports.useState("all");
  const [people, setPeople] = reactExports.useState([]);
  const [form, setForm] = reactExports.useState(null);
  const [ask, setAsk] = reactExports.useState(null);
  const [ledger, setLedger] = reactExports.useState(null);
  const [supKey, setSupKey] = reactExports.useState(0);
  const [confirmAsk, confirmDialog] = useConfirm();
  const reload = reactExports.useCallback(async () => {
    if (!canPeople) return;
    const r = await window.pos.guests.list("");
    if (r.success) setPeople(r.data.customers ?? []);
  }, [canPeople]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  const kindOf = (p) => (p.kind === "employee" ? "employee" : "customer");
  const shown = people.filter((p) => type === "all" || kindOf(p) === type);
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream";

  const save = async () => {
    if (!form.name.trim()) { toast("Ad tələb olunur", "danger"); return; }
    if (form.type === "supplier") {
      const ok = await run(window.pos.suppliers.save({ name: form.name.trim(), phone: form.phone.trim(), contact: (form.contact || "").trim() }), "Partnyor əlavə olundu");
      if (ok) { setForm(null); setSupKey((k) => k + 1); }
      return;
    }
    if (form.type === "employee" && (!psStockInputValid(form.salary || "0", { empty: true }))) { toast("Maaşı düzgün yazın", "danger"); return; }
    const ok = await run(window.pos.guests.save({
      ...(form.id ? { id: form.id } : {}), name: form.name.trim(), phone: form.phone.trim(),
      kind: form.type, salaryMinor: form.type === "employee" ? opsMinor(form.salary || "0") : 0
    }), form.id ? "Saxlanıldı" : "Partnyor əlavə olundu");
    if (ok) setForm(null);
  };
  const openLedger = async (p) => {
    const r = await window.pos.guests.ledger(p.id);
    setLedger({ person: p, rows: r.success ? (r.data.entries ?? []) : [] });
  };
  const remove = async (p) => {
    if (!(await confirmAsk('"' + p.name + '" partnyorlardan silinsin? Keçmiş hesab qalır.', { danger: true }))) return;
    void run(window.pos.guests.deactivate(p.id), "Silindi");
  };

  return h("div", { className: "space-y-4" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["all", "Hamısı"], ["supplier", "Təchizatçı"], ["employee", "İşçi"], ["customer", "Müştəri"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": type === k, className: "ps-period-chip" + (type === k ? " is-on" : ""), onClick: () => setType(k) }, l)),
      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ type: type === "all" ? "customer" : type, name: "", phone: "", contact: "", salary: "" }), children: "+ Yeni partnyor" })),

    canPeople && type !== "supplier" ? jsxRuntimeExports.jsx(OpsTable, {
      head: ["Partnyor", "Tip", "Telefon", "Aylıq maaş", "Borc", ""],
      empty: "Bu tipdə partnyor yoxdur",
      rows: shown.map((p) => [
        h("span", { className: "font-medium text-cream" }, p.name),
        PS_PARTNER_TYPES[kindOf(p)],
        p.phone || "—",
        kindOf(p) === "employee" ? formatMoney(p.salaryMinor ?? 0) : "—",
        h("span", { style: (p.debtMinor ?? 0) > 0 ? { color: "var(--ps-danger)", fontWeight: 600 } : null }, formatMoney(p.debtMinor ?? 0)),
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openLedger(p), children: "Hesab" }),
          (p.debtMinor ?? 0) > 0 ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setAsk({ person: p, value: "" }), children: "Borcu ödə" }) : null,
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm({ id: p.id, type: kindOf(p), name: p.name, phone: p.phone || "", salary: ((p.salaryMinor ?? 0) / 100).toFixed(2) }), children: "Redaktə" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void remove(p), children: "Sil" }))
      ])
    }) : null,

    canSuppliers && (type === "all" || type === "supplier")
      ? h("div", { className: "space-y-2" }, h("h3", { className: "ps-recipe-step" }, "Təchizatçılar"), jsxRuntimeExports.jsx(OpsVendors, {}, "sup-" + supKey))
      : null,

    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Partnyoru redaktə et" : "Yeni partnyor", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("label", { className: "block text-sm" },
        h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Partnyorun tipi"),
        h("select", { value: form.type, disabled: Boolean(form.id), className: field, onChange: (e) => setForm({ ...form, type: e.target.value }) },
          Object.entries(PS_PARTNER_TYPES).map(([k, l]) => h("option", { key: k, value: k }, l)))),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: form.name, onChange: (v) => setForm({ ...form, name: v }) }),
        jsxRuntimeExports.jsx(OpsField, { label: "Telefon", value: form.phone, onChange: (v) => setForm({ ...form, phone: v }) }),
        form.type === "employee" ? jsxRuntimeExports.jsx(OpsField, { label: "Aylıq maaş (₼)", value: form.salary, onChange: (v) => setForm({ ...form, salary: v }), placeholder: "0.00" }) : null,
        form.type === "supplier" ? jsxRuntimeExports.jsx(OpsField, { label: "Əlaqədar şəxs", value: form.contact, onChange: (v) => setForm({ ...form, contact: v }) }) : null),
      form.type === "employee" ? h("p", { className: "text-xs text-muted" }, "İşçinin (və ailəsinin) yeməkləri sifarişdə onun adına borc yazılır və Maaşlar bölməsində maaşından çıxılır.") : null,
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void save(), children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(null), children: "İmtina" }))) }) : null,

    ask ? jsxRuntimeExports.jsx(PsAdminDialog, { title: ask.person.name + " — borcu ödə", onClose: () => setAsk(null), busy, children: h("div", { className: "space-y-3" },
      h("p", { className: "text-xs text-muted" }, "Cari borc: " + formatMoney(ask.person.debtMinor ?? 0)),
      jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: ask.value, onChange: (v) => setAsk({ ...ask, value: v }) }),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => {
          if (!psStockInputValid(ask.value) || opsMinor(ask.value) <= 0) { toast("Düzgün məbləğ yazın", "danger"); return; }
          void run(window.pos.guests.payDebt({ customerId: ask.person.id, amountMinor: opsMinor(ask.value) }), "Ödəniş qəbul edildi").then((ok) => { if (ok) setAsk(null); });
        }, children: "Təsdiq et" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setAsk(null), children: "Bağla" }))) }) : null,

    ledger ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, ledger.person.name + " — hesab"),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setLedger(null), children: "Bağla" })),
      jsxRuntimeExports.jsx(OpsTable, {
        head: ["Tarix", "Növ", "Məbləğ", "Qeyd"],
        empty: "Hərəkət yoxdur",
        rows: ledger.rows.map((e) => [
          opsWhen(e.createdAt),
          e.kind === "payment" ? "Ödəniş" : e.kind === "adjustment" ? "Düzəliş" : "Borc",
          h("span", { style: { color: e.kind === "charge" ? "var(--ps-danger)" : "var(--ps-ok)", fontWeight: 600 } }, formatMoney(Math.abs(e.amountMinor ?? 0))),
          [e.orderNumber ? "#" + e.orderNumber : "", e.note || ""].filter(Boolean).join(" · ") || "—"
        ])
      })) : null,
    confirmDialog);
}

function psMonthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
}
function OpsSalary() {
  const h = psH;
  const [month, setMonth] = reactExports.useState(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  const [rows, setRows] = reactExports.useState([]);
  const [ask, setAsk] = reactExports.useState(null);
  const [open, setOpen] = reactExports.useState(null);
  const reload = reactExports.useCallback(async () => {
    const r = await window.pos.salary.list({ month, ...psMonthBounds(month) });
    if (r.success) setRows(r.data.employees ?? []); else toast(r.error.message, "danger");
  }, [month]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  const kindLabel = { advance: "Avans", full: "Tam ödəniş", note: "Qeyd" };

  const pay = () => {
    const amount = ask.kind === "note" ? 0 : opsMinor(ask.value);
    if (ask.kind !== "note" && (!psStockInputValid(ask.value) || amount <= 0)) { toast("Məbləği yazın", "danger"); return; }
    if (ask.kind === "note" && !ask.note.trim()) { toast("Qeydi yazın", "danger"); return; }
    void run(window.pos.salary.pay({ customerId: ask.row.id, month, kind: ask.kind, amountMinor: amount, note: ask.note.trim(), fromCash: ask.kind !== "note" && ask.fromCash },
      { idempotencyKey: newIdempotencyKey() }), "Saxlanıldı").then((ok) => { if (ok) setAsk(null); });
  };
  const saveSalary = (row) => {
    if (!psStockInputValid(ask.value) ) { toast("Maaşı düzgün yazın", "danger"); return; }
    void run(window.pos.guests.save({ id: row.id, name: row.name, phone: row.phone || "", kind: "employee", salaryMinor: opsMinor(ask.value) }), "Maaş yeniləndi").then((ok) => { if (ok) setAsk(null); });
  };
  const sum = (key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      ...[["Maaş fondu", sum("salaryMinor")], ["Ödənilib", sum("paidMinor")], ["Yeməklər (tutulma)", sum("mealsMinor")], ["Qalıq ödəniləcək", sum("remainingMinor")]].map(([l, v]) =>
        h("div", { key: l, className: "ps-stock-metric" },
          h("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint" }, l),
          h("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream" }, formatMoney(v)),
          h("p", { className: "mt-1 text-[11px] text-muted" }, month)))),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      h("label", { className: "text-sm text-muted" }, "Ay: ",
        h("input", { type: "month", value: month, onChange: (e) => e.target.value && setMonth(e.target.value), className: "ml-1 rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream" })),
      h("small", { className: "text-muted" }, "Yeni ay başlayanda hər işçinin qarşısında yenə tam maaş görünür.")),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["İşçi", "Aylıq maaş", "Ödənilib", "Yeməklər", "Qalıq", ""],
      empty: "İşçi yoxdur — Partnyorlar bölməsində İşçi tipli partnyor yaradın",
      rows: rows.map((r) => [
        h("span", { className: "font-medium text-cream" }, r.name, r.settled ? h("span", { className: "ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", style: { background: "#e7f5ee", color: "var(--ps-ok)" } }, "Ödənilib") : null),
        h("button", { type: "button", className: "ps-link-btn", onClick: () => setAsk({ row: r, kind: "salary", value: ((r.salaryMinor ?? 0) / 100).toFixed(2) }) }, formatMoney(r.salaryMinor ?? 0)),
        formatMoney(r.paidMinor ?? 0),
        formatMoney(r.mealsMinor ?? 0),
        h("b", { style: { color: (r.remainingMinor ?? 0) > 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(r.remainingMinor ?? 0)),
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy || r.settled, onClick: () => setAsk({ row: r, kind: "advance", value: "", note: "", fromCash: true }), children: "Avans" }),
          jsxRuntimeExports.jsx(OpsButton, { disabled: busy || r.settled, onClick: () => setAsk({ row: r, kind: "full", value: ((r.remainingMinor ?? 0) / 100).toFixed(2), note: "", fromCash: true }), children: "Tam ödəniş" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setAsk({ row: r, kind: "note", value: "", note: "", fromCash: false }), children: "Qeyd" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setOpen(open === r.id ? null : r.id), children: "Tarixçə" }))
      ])
    }),
    open ? (() => {
      const r = rows.find((x) => x.id === open);
      if (!r) return null;
      return h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
        h("p", { className: "text-sm font-semibold text-cream" }, r.name + " — " + month),
        jsxRuntimeExports.jsx(OpsTable, { head: ["Tarix", "Növ", "Məbləğ", "Qeyd"], empty: "Bu ay hərəkət yoxdur",
          rows: (r.history ?? []).map((e) => [opsWhen(e.createdAt), kindLabel[e.kind] || e.kind, e.kind === "note" ? "—" : formatMoney(e.amountMinor ?? 0), e.note || "—"]) }));
    })() : null,
    ask ? jsxRuntimeExports.jsx(PsAdminDialog, {
      title: ask.row.name + " — " + (ask.kind === "salary" ? "aylıq maaş" : kindLabel[ask.kind]), onClose: () => setAsk(null), busy,
      children: h("div", { className: "space-y-3" },
        ask.kind === "salary"
          ? jsxRuntimeExports.jsx(OpsField, { label: "Aylıq maaş (₼)", value: ask.value, onChange: (v) => setAsk({ ...ask, value: v }) })
          : h("div", { className: "space-y-2" },
              ask.kind === "full" ? h("p", { className: "text-xs text-muted" }, "Maaş " + formatMoney(ask.row.salaryMinor ?? 0) + " − ödənilib " + formatMoney(ask.row.paidMinor ?? 0) + " − yeməklər " + formatMoney(ask.row.mealsMinor ?? 0) + ". Yemək borcu maaşdan tutulmuş sayılır.") : null,
              ask.kind !== "note" ? jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: ask.value, onChange: (v) => setAsk({ ...ask, value: v }) }) : null,
              jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: ask.note, onChange: (v) => setAsk({ ...ask, note: v }) }),
              ask.kind !== "note" ? h("label", { className: "flex items-center gap-2 text-sm text-cream" },
                h("input", { type: "checkbox", checked: ask.fromCash, onChange: (e) => setAsk({ ...ask, fromCash: e.target.checked }) }),
                "Kassadan çıxsın (Xərclərdə görünür)") : null),
        h("div", { className: "flex gap-2" },
          jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => (ask.kind === "salary" ? saveSalary(ask.row) : pay()), children: "Təsdiq et" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setAsk(null), children: "Bağla" })))
    }) : null);
}

const PS_EXPENSE_KINDS = ["Bazarlıq", "Kommunal", "Maaş", "Nəqliyyat", "Təmir", "Digər"];
function OpsExpenses() {
  const h = psH;
  const [rows, setRows] = reactExports.useState([]);
  const [period, setPeriod] = reactExports.useState("month");
  const [form, setForm] = reactExports.useState(null);
  const reload = reactExports.useCallback(async () => {
    const r = await window.pos.cash.list("");
    if (r.success) setRows((r.data.movements ?? []).filter((m) => m.kind === "expense"));
  }, []);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  const since = psPeriodStart(period, 0);
  const shown = rows.filter((m) => (Number(m.createdAt) || 0) >= since);
  const total = shown.reduce((t, m) => t + (Number(m.amountMinor) || 0), 0);
  const byKind = new Map();
  for (const m of shown) byKind.set(m.reason || "Digər", (byKind.get(m.reason || "Digər") || 0) + (Number(m.amountMinor) || 0));

  const save = () => {
    if (!psStockInputValid(form.value) || opsMinor(form.value) <= 0) { toast("Məbləği yazın", "danger"); return; }
    const reason = form.kind === "Digər" && form.custom.trim() ? form.custom.trim() : form.kind;
    void run(window.pos.cash.movement({ kind: "expense", amountMinor: opsMinor(form.value), reason, note: form.note.trim() }, { idempotencyKey: newIdempotencyKey() }), "Xərc yazıldı")
      .then((ok) => { if (ok) setForm(null); });
  };

  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      h("div", { className: "ps-stock-metric" },
        h("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint" }, "Cəmi xərc"),
        h("p", { className: "mt-2 text-2xl font-bold tracking-tight", style: { color: "var(--ps-danger)" } }, formatMoney(total)),
        h("p", { className: "mt-1 text-[11px] text-muted" }, shown.length + " xərc")),
      ...[...byKind].map(([k, v]) => h("div", { key: k, className: "ps-stock-metric" },
        h("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint" }, k),
        h("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream" }, formatMoney(v)),
        h("p", { className: "mt-1 text-[11px] text-muted" }, "Kateqoriya")))),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      [["day", "Bu gün"], ["week", "Bu həftə"], ["month", "Bu ay"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": period === k, className: "ps-period-chip" + (period === k ? " is-on" : ""), onClick: () => setPeriod(k) }, l)),
      h("span", { className: "ml-auto" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ kind: "Bazarlıq", custom: "", value: "", note: "" }), children: "+ Xərc" })),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["Tarix", "Kateqoriya", "Məbləğ", "Qeyd"],
      empty: "Bu dövrdə xərc yoxdur",
      rows: shown.map((m) => [opsWhen(m.createdAt), m.reason || "—", h("b", { style: { color: "var(--ps-danger)" } }, formatMoney(m.amountMinor ?? 0)), m.note || "—"])
    }),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni xərc", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "flex flex-wrap gap-2" }, PS_EXPENSE_KINDS.map((k) =>
        h("button", { key: k, type: "button", "aria-pressed": form.kind === k, className: "ps-period-chip" + (form.kind === k ? " is-on" : ""), onClick: () => setForm({ ...form, kind: k }) }, k))),
      form.kind === "Digər" ? jsxRuntimeExports.jsx(OpsField, { label: "Nə üçün", value: form.custom, onChange: (v) => setForm({ ...form, custom: v }), placeholder: "məs. Marketdən çörək" }) : null,
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: form.value, onChange: (v) => setForm({ ...form, value: v }), placeholder: "0.00" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: form.note, onChange: (v) => setForm({ ...form, note: v }), placeholder: "məs. kassir Elvin aldı" })),
      h("p", { className: "text-xs text-muted" }, "Pul kassadan çıxır və X hesabatda görünür."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null);
}

function PsPartnerPicker({ order, onClose, onPicked }) {
  const h = psH;
  const [tab, setTab] = reactExports.useState(order.partnerKind === "customer" ? "customer" : "employee");
  const [q, setQ] = reactExports.useState("");
  const [people, setPeople] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState(false);
  reactExports.useEffect(() => {
    void window.pos.guests.list("").then((r) => setPeople(r.success ? (r.data.customers ?? []) : []));
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => (tab === "employee" ? p.kind === "employee" : p.kind !== "employee")
    && (!needle || (p.name + " " + (p.phone || "")).toLowerCase().includes(needle)));
  const pick = async (id) => {
    setBusy(true);
    const r = await window.pos.orders.setPartner(order.id, id);
    setBusy(false);
    if (!r.success) { toast(r.error.message, "danger"); return; }
    onPicked();
  };
  return jsxRuntimeExports.jsx(Modal, {
    title: "Partnyor seçin", subtitle: "Ödənilməyən hissə seçdiyiniz şəxsin borcuna yazılacaq.", wide: true, onDismiss: busy ? void 0 : onClose,
    footer: [
      order.customerId ? jsxRuntimeExports.jsx("button", { type: "button", disabled: busy, onClick: () => void pick(""), className: "touch-target rounded-xl border border-danger/40 px-4 py-3 text-sm text-danger", children: "Partnyoru götür" }, "clear") : null,
      jsxRuntimeExports.jsx("button", { type: "button", onClick: onClose, className: "touch-target rounded-xl border border-hairline px-4 py-3 text-sm text-muted", children: "Bağla" }, "close")
    ],
    children: h("div", { className: "space-y-3" },
      h("div", { className: "flex gap-2" },
        [["employee", "İşçi"], ["customer", "Müştəri"]].map(([k, l]) =>
          h("button", { key: k, type: "button", "aria-pressed": tab === k, className: "ps-period-chip" + (tab === k ? " is-on" : ""), onClick: () => setTab(k) }, l))),
      h("input", { type: "search", value: q, onChange: (e) => setQ(e.target.value), placeholder: "Ad və ya telefon", className: "w-full rounded-xl border border-hairline bg-elevated px-3 py-2.5 text-cream" }),
      people === null ? h("p", { className: "text-sm text-muted" }, "Yüklənir…")
        : shown.length ? h("div", { className: "ps-partner-list" }, shown.map((p) =>
            h("button", { key: p.id, type: "button", disabled: busy, className: "ps-partner-row" + (order.customerId === p.id ? " is-on" : ""), onClick: () => void pick(p.id) },
              h("b", null, p.name), h("span", null, p.phone || ""), (p.debtMinor ?? 0) > 0 ? h("em", null, "Borc " + formatMoney(p.debtMinor)) : null)))
        : h("p", { className: "text-sm text-muted" }, tab === "employee" ? "İşçi yoxdur — Əməliyyatlar → Partnyorlar bölməsində yaradın." : "Müştəri yoxdur — Partnyorlar bölməsində yaradın."))
  });
}

function OpsGuests() {`, 'partner, salary, expense components');

  // ------------------------------------------------------- 6. order screen
  s = replaceOnce(s,
    `  const [cartPage, setCartPage] = reactExports.useState(0);`,
    `  const [cartPage, setCartPage] = reactExports.useState(0);
  const [partnerOpen, setPartnerOpen] = reactExports.useState(false);`,
    'order partner state');
  s = replaceOnce(s,
    `jsxRuntimeExports.jsx(MoneyText, { minor: remaining })
          ] })
        ] })`,
    `jsxRuntimeExports.jsx(MoneyText, { minor: remaining })
          ] }),
          psH("button", { type: "button", className: "ps-partner-btn" + (order.customerId ? " is-on" : ""), onClick: () => setPartnerOpen(true) },
            order.customerId ? ((order.partnerKind === "employee" ? "İşçi: " : "Partnyor: ") + (order.partnerName || "")) : "Partnyor seç")
        ] })`,
    'order partner button');
  s = replaceOnce(s,
    `    pending && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"`,
    `    partnerOpen && order ? jsxRuntimeExports.jsx(PsPartnerPicker, { order, onClose: () => setPartnerOpen(false), onPicked: () => { setPartnerOpen(false); void refreshOrder(); } }) : null,
    pending && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"`,
    'order partner picker');

  // ----------------------------------------------------- payment screen
  s = replaceOnce(s,
    `  const closeOrder = async () => {`,
    `  const closeToAccount = async () => {
    if (!order || busy) return;
    setBusy(true);
    const res = await window.pos.orders.closeToAccount(order.id, { idempotencyKey: newIdempotencyKey() });
    setBusy(false);
    if (!res.success) { toast(res.error.message, "danger"); return; }
    releaseOrderDraft(order);
    toast((order.partnerName || "Partnyor") + " borcuna yazıldı", "success");
    navigate("/tables");
  };
  const closeOrder = async () => {`,
    'payment close to account');
  s = replaceOnce(s,
    `              onClick: () => void closeOrder(),
              className: "touch-target mt-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success disabled:opacity-40",
              children: t.payment.closeOrder
            }
          )`,
    `              onClick: () => void closeOrder(),
              className: "touch-target mt-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm text-success disabled:opacity-40",
              children: t.payment.closeOrder
            }
          ),
          order && order.status !== "closed" && remaining > 0 && order.customerId ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", {
            type: "button", disabled: busy, onClick: () => void closeToAccount(),
            className: "touch-target mt-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger disabled:opacity-40",
            children: "Qalanı " + formatMoney(remaining) + " — " + (order.partnerName || "partnyor") + " borcuna yaz və bağla"
          }) : null,
          order && order.status !== "closed" && remaining > 0 && !order.customerId ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-xs text-faint", children: "Nisyə üçün sifariş ekranında sağ altda partnyor seçin." }) : null`,
    'payment account button');

  s = replaceOnce(s, `function methodLabel(method, t) {
  if (method === "cash") return t.payment.cash;`,
    `function methodLabel(method, t) {
  if (method === "account") return "Nisyə (partnyor borcu)";
  if (method === "cash") return t.payment.cash;`, 'report method label');
  fs.writeFileSync(BUNDLE, s);
  console.log('partners applied');
}

// Titles and subtitles for the new tabs. apply-restaurant-admin-refresh.mjs
// rewrites these maps on every assemble, so this step re-applies on its own.
{
  let s = fs.readFileSync(BUNDLE, 'utf8');
  if (!s.includes('vendors: ["Partnyorlar"')) {
  s = replaceOnce(s, String.raw`vendors: ["T\u0259chizat\xE7\u0131lar", "Tedarik\xE7iler", "Suppliers"]`, `vendors: ["Partnyorlar", "Partnerler", "Partners"], salary: ["Maaşlar", "Maaşlar", "Salaries"], expenses: ["Xərclər", "Giderler", "Expenses"]`, 'ops titles');
  s = replaceOnce(s, String.raw`vendors: ["T\u0259chizat\xE7\u0131lar\u0131 v\u0259 hesabla\u015Fmalar\u0131 bir yerd\u0259 izl\u0259yin.", "Tedarik\xE7ileri ve hesaplar\u0131n\u0131 tek yerden takip edin.", "Keep supplier details and accounts together."]`, `vendors: ["Təchizatçılar, işçilər və müştərilər — borcları bir yerdə.", "Tedarikçiler, çalışanlar ve müşteriler — borçlar tek yerde.", "Suppliers, staff and guests — their tabs in one place."],
    salary: ["İşçilərin aylıq maaşı, avans və yeməklərin tutulması.", "Çalışan maaşları, avanslar ve kesintiler.", "Monthly salaries, advances and deductions."],
    expenses: ["Kassadan çıxan xərclər — bazarlıq, kommunal və s.", "Kasadan çıkan giderler.", "Money paid out of the till."]`, 'ops subtitles');
    fs.writeFileSync(BUNDLE, s);
    console.log('partners: tab titles');
  }
}

let css = fs.readFileSync(CSS, 'utf8');
if (!css.includes(MARK)) {
  css += `
${MARK}
.ps-neg-banner { padding: 0.65rem 0.9rem; border: 1px solid #fca5a5; border-radius: 0.9rem; background: #fef2f2; color: #991b1b; font-size: 0.88rem; }
.ps-period-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.85rem; color: #475569; }
.ps-period-bar small { color: #94a3b8; }
button.ps-period-chip[aria-pressed], .ps-ops-panel button.ps-period-chip[aria-pressed] { min-height: 2.4rem; padding: 0 0.85rem !important; border: 1px solid #cbd5e1 !important; border-radius: 999px !important; background: #fff !important; color: #0f172a !important; font-size: 0.85rem !important; font-weight: 650; }
button.ps-period-chip[aria-pressed].is-on, .ps-ops-panel button.ps-period-chip[aria-pressed].is-on { border-color: #2563eb !important; background: #eff6ff !important; color: #1d4ed8 !important; }
.ps-period-reset { min-height: 2.4rem; padding: 0 0.9rem; border: 1px solid #fca5a5 !important; border-radius: 999px; background: #fef2f2 !important; color: #b91c1c !important; font-weight: 700; }
.ps-link-btn { background: none !important; border: 0 !important; color: #1d4ed8 !important; text-decoration: underline; font-weight: 650; }
.ps-partner-btn { width: 100%; margin-top: 0.6rem; min-height: 2.8rem; border: 1px dashed rgba(201,168,106,.55); border-radius: 0.75rem; background: transparent; color: var(--ps-brand, #c9a86a); font-weight: 700; }
.ps-partner-btn.is-on { border-style: solid; background: rgba(201,168,106,.12); }
.ps-partner-list { display: grid; gap: 0.4rem; max-height: 22rem; overflow: auto; }
.ps-partner-row { display: grid; grid-template-columns: 1fr auto auto; gap: 0.6rem; align-items: center; min-height: 3rem; padding: 0 0.9rem; border: 1px solid rgba(201,168,106,.25); border-radius: 0.75rem; background: transparent; color: inherit; text-align: left; }
.ps-partner-row.is-on { border-color: #c9a86a; background: rgba(201,168,106,.14); }
.ps-partner-row span { opacity: .7; font-size: .85rem; }
.ps-partner-row em { font-style: normal; color: #f87171; font-size: .85rem; }
`;
  fs.writeFileSync(CSS, css);
}
