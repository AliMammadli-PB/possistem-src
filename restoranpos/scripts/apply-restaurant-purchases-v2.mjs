#!/usr/bin/env node
/**
 * 1.7.26 — Təchizat, Müştərilər, Rezervasiya, İş qrafiki out of the app for
 * good (tabs, links, landing page, permission screen); Alışlar gains
 * per-branch buying and returns (each obyekt has its own store), "+ Yeni mal"
 * on an invoice line, and "Düzəliş et" on a saved invoice (purchases.update).
 * Supplier debt is seen and paid in Partnyorlar, so Alışlar drops its debts view.
 * Runs after apply-restaurant-purchases.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_PURCHASES_v2 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}
function replaceAll(src, find, repl, count, label) {
  const n = src.split(find).length - 1;
  if (n !== count) throw new Error(`${label}: expected ${count} matches, got ${n}`);
  return src.split(find).join(repl);
}
function cut(src, from, to, repl, label) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0 || src.indexOf(from, a + 1) >= 0) throw new Error(`${label}: anchors not found once`);
  return src.slice(0, a) + repl + src.slice(b);
}

{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes('"purchases.update":')) {
    m = replaceOnce(m, 'Cn={', 'Cn={"purchases.update":{auth:!0,perm:"suppliers.manage",timeout:3e4,idempotent:!0},', 'main policy');
    fs.writeFileSync(MAIN, m);
    console.log('main: purchases.update');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('purchases.update"')) {
    p = replaceOnce(p, '    returnGoods: (input, options) => call("purchases.return", input, options),',
      '    returnGoods: (input, options) => call("purchases.return", input, options),\n    updatePurchase: (input, options) => call("purchases.update", input, options),',
      'preload suppliers');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: updatePurchase');
  }
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  // ---- the four sections, gone
  for (const id of ['suppliers', 'guests', 'reservations', 'roster']) {
    const re = new RegExp(`^    \\{ id: "${id}", label: "[^"]+", show: false && .*\\n`, 'm');
    if (!re.test(s)) throw new Error(`tab ${id} not found`);
    s = s.replace(re, '');
  }
  s = replaceOnce(s, '    if (can("suppliers.view")) return "/operations?tab=suppliers";', '    if (can("suppliers.view")) return "/operations?tab=purchases";', 'landing purchases');
  s = replaceOnce(s, '    if (can("customers.view")) return "/operations?tab=guests";\n    if (can("schedule.view")) return "/operations?tab=roster";\n', '', 'landing guests/roster');
  s = replaceAll(s, '{ to: "/operations?tab=suppliers", label: "Təchizat", icon: Store, show: hasPermission("suppliers.view") }',
    '{ to: "/operations?tab=purchases", label: "Alışlar", icon: Store, show: hasPermission("suppliers.view") }', 2, 'link purchases');
  s = replaceAll(s, '{ to: "/operations?tab=vendors", label: "Təchizatçılar", icon: Store, show: hasPermission("suppliers.view") }',
    '{ to: "/operations?tab=vendors", label: "Partnyorlar", icon: Users, show: hasPermission("suppliers.view") || hasPermission("customers.view") }', 2, 'link partners');
  const dead = /^ *\{ to: "\/operations\?tab=(guests|reservations|roster)".*\n/gm;
  if ((s.match(dead) || []).length !== 5) throw new Error('links: expected 5 dead links');
  s = s.replace(dead, '');

  // Permission screen: nothing left uses these.
  s = replaceOnce(s, '    setCatalogue(cat.data.groups ?? {});',
    '    setCatalogue(Object.fromEntries(Object.entries(cat.data.groups ?? {}).filter(([g]) => g !== "reservations" && g !== "schedule")\n      .map(([g, list]) => [g, (list ?? []).filter((p) => p.key !== "customers.loyalty")])));',
    'permission catalogue');

  // Partner ledger: a return is money off, not debt.
  s = replaceOnce(s, '          e.kind === "payment" ? "Ödəniş" : e.kind === "adjustment" ? "Düzəliş" : "Borc",\n          h("span", { style: { color: e.kind === "charge" ? "var(--ps-danger)"',
    '          e.kind === "payment" ? "Ödəniş" : e.kind === "adjustment" ? "Düzəliş" : (e.amountMinor ?? 0) < 0 ? "Qaytarma / azalma" : "Borc",\n          h("span", { style: { color: e.kind === "charge" && (e.amountMinor ?? 0) > 0 ? "var(--ps-danger)"',
    'partner ledger kind');

  // ---- Alışlar
  s = replaceOnce(s, '/* POS_PURCHASES_v1 */\nfunction OpsPurchases() {', `/* POS_PURCHASES_v1 */\n${MARK}\nfunction OpsPurchases() {`, 'mark');
  s = replaceOnce(s, '  const [supplierFilter, setSupplierFilter] = reactExports.useState("");\n  const [invoice, setInvoice]',
    '  const [supplierFilter, setSupplierFilter] = reactExports.useState("");\n  const [objectFilter, setObjectFilter] = reactExports.useState("");\n  const [invoice, setInvoice]', 'object filter state');
  s = replaceOnce(s, `    setData({ suppliers: sup.data.suppliers ?? [], purchases: pur.data.purchases ?? [], returns: rets.data.returns ?? [], ingredients: ings.data.ingredients ?? [] });`,
    `    // Branches and their stores; without cash.manage there are none to pick and the main store is used.
    const [from, to] = psToday();
    const acc = await window.pos.cashAccounts.list(from, to).catch(() => null);
    const objects = acc?.success ? (acc.data.objects ?? []).filter((o) => o.warehouseId) : [];
    const mine = acc?.success ? (acc.data.accounts ?? []).find((a) => a.kind === "till" && a.terminalId === acc.data.currentTerminalId) : null;
    const home = objects.find((o) => mine && o.id === mine.objectId);
    setData({ suppliers: sup.data.suppliers ?? [], purchases: pur.data.purchases ?? [], returns: rets.data.returns ?? [], ingredients: ings.data.ingredients ?? [], objects, homeWarehouse: home ? home.warehouseId : "" });`,
    'load objects');
  s = replaceOnce(s, '  const purchases = data.purchases.filter((p) => !supplierFilter || p.supplierId === supplierFilter);\n  const returns = data.returns.filter((r) => !supplierFilter || r.supplierId === supplierFilter);',
    '  const purchases = data.purchases.filter((p) => (!supplierFilter || p.supplierId === supplierFilter) && (!objectFilter || p.warehouseId === objectFilter));\n  const returns = data.returns.filter((r) => (!supplierFilter || r.supplierId === supplierFilter) && (!objectFilter || r.warehouseId === objectFilter));',
    'filters');

  // A line can be a new good, typed in: name + unit; it is created on save.
  s = replaceOnce(s, `    return h("div", { key: i, className: "ps-purchase-row" },
      withMax && l.fixed`, `    return h("div", { key: i, className: "ps-purchase-row" },
      l.isNew ? h("div", { className: "ps-purchase-new" },
          h("input", { value: l.name, placeholder: "Yeni malın adı", className: field, onChange: (e) => setLine(form, setForm, i, { name: e.target.value }) }),
          h("select", { value: l.unit, className: field, onChange: (e) => setLine(form, setForm, i, { unit: e.target.value }) },
            [["kg", "kq"], ["l", "litr"], ["ədəd", "ədəd"], ["qab", "qab"]].map(([u, t]) => h("option", { key: u, value: u }, t))))
      : withMax && l.fixed`, 'new line row');

  s = replaceOnce(s, '\n  const saveInvoice = () => {', `
  const objectSelect = (form, setForm, locked) => data.objects.length ? h("label", { className: "block text-sm" },
    h("span", { className: "text-xs uppercase tracking-wide text-faint" }, "Obyekt (hansı anbar)"),
    h("select", { value: form.warehouseId || "", disabled: locked, className: field, onChange: (e) => setForm({ ...form, warehouseId: e.target.value }) },
      h("option", { value: "" }, "Əsas anbar"),
      data.objects.map((o) => h("option", { key: o.id, value: o.warehouseId }, o.name)))) : null;
  const usable = (l) => (l.ingredientId || (l.isNew && l.name.trim())) && qtyMilli(l.qty) > 0;
  // New goods are created first; the form keeps their ids so a failed save does not create them twice.
  const resolveLines = async (form) => {
    const taken = new Set(data.ingredients.map((x) => String(x.barcode || "")).filter(Boolean));
    for (const l of form.lines) {
      if (l.ingredientId || !l.isNew || !usable(l)) continue;
      const barcode = psMakeBarcode(taken);
      taken.add(barcode);
      const r = await window.pos.inventory.saveIngredient({ name: l.name.trim(), unit: l.unit || "kg", barcode, costMinor: opsMinor(l.price || "0"), minQtyMilli: 0 });
      if (!r.success) throw new Error(r.error?.message || "Mal yaradılmadı");
      l.ingredientId = r.data.id;
    }
    return form.lines.filter((l) => l.ingredientId && qtyMilli(l.qty) > 0)
      .map((l) => ({ ingredientId: l.ingredientId, qtyMilli: qtyMilli(l.qty), unitCostMinor: opsMinor(l.price || "0") }));
  };
  const openEdit = async (p) => {
    const r = await window.pos.suppliers.purchase(p.id);
    if (!r.success) { toast(r.error.message, "danger"); return; }
    setInvoice({ editId: p.id, number: p.number, supplierId: r.data.supplierId, newSupplier: "", warehouseId: r.data.warehouseId || "", paid: "", accountId: undefined, note: r.data.note || "",
      lines: (r.data.lines ?? []).map((l) => ({ ingredientId: l.ingredientId, qty: String((Number(l.qtyMilli) || 0) / 1000), price: ((Number(l.unitCostMinor) || 0) / 100).toFixed(2) })) });
  };

  const saveInvoice = () => {`, 'helpers');

  s = cut(s, '  const saveInvoice = () => {', '\n  const openReturnFrom = async (p) => {', `  const saveInvoice = () => {
    if (!invoice.supplierId && !invoice.newSupplier.trim()) { toast("Təchizatçını seçin və ya adını yazın", "danger"); return; }
    if (!invoice.lines.some(usable)) { toast("Ən azı bir mal və miqdar yazın", "danger"); return; }
    const total = invoice.lines.reduce((t, l) => t + lineTotal(l), 0);
    const paid = !invoice.editId && invoice.paid ? opsMinor(invoice.paid) : 0;
    if (paid < 0 || paid > total) { toast("Ödənilən məbləğ cəmdən çox ola bilməz", "danger"); return; }
    void run((async () => {
      if (!invoice.supplierId) {
        const created = await window.pos.suppliers.save({ name: invoice.newSupplier.trim() });
        if (!created.success) return created;
        invoice.supplierId = created.data.id;
      }
      const supplierId = invoice.supplierId;
      const lines = await resolveLines(invoice);
      const head = { supplierId, warehouseId: invoice.warehouseId || "", lines, note: invoice.note.trim() };
      if (invoice.editId) return window.pos.suppliers.updatePurchase({ ...head, purchaseId: invoice.editId }, { idempotencyKey: newIdempotencyKey() });
      const saved = await window.pos.suppliers.savePurchase({ ...head, idempotencyKey: newIdempotencyKey() });
      if (!saved.success) return saved;
      const received = await window.pos.suppliers.receive(saved.data.id);
      if (!received.success) return received;
      if (paid > 0) return window.pos.suppliers.pay({ supplierId, amountMinor: paid, purchaseId: saved.data.id, accountId: invoice.accountId || "", note: "Alış qaiməsi" });
      return received;
    })(), invoice.editId ? "Qaimə düzəldildi" : "Alış qaiməsi qəbul edildi").then((ok) => { if (ok) setInvoice(null); });
  };
`, 'saveInvoice');

  s = replaceOnce(s, '    setRet({ supplierId: r.data.supplierId, purchaseId: p.id, purchaseNumber: p.number, lines, note: "" });',
    '    setRet({ supplierId: r.data.supplierId, purchaseId: p.id, purchaseNumber: p.number, warehouseId: r.data.warehouseId || "", lines, note: "" });', 'return from invoice');
  s = replaceOnce(s, 'window.pos.suppliers.returnGoods({ supplierId: ret.supplierId, purchaseId: ret.purchaseId || "", lines,',
    'window.pos.suppliers.returnGoods({ supplierId: ret.supplierId, purchaseId: ret.purchaseId || "", warehouseId: ret.warehouseId || "", lines,', 'return warehouse');

  // Toolbar: no debts view (Partnyorlar has it), an object filter, dialogs open on this PC's branch.
  s = replaceOnce(s, '[["invoices", "Alış qaimələri"], ["returns", "Qaytarmalar"], ["debts", "Təchizatçı borcları"]]', '[["invoices", "Alış qaimələri"], ["returns", "Qaytarmalar"]]', 'views');
  s = replaceOnce(s, `        h("option", { value: "" }, "Bütün təchizatçılar"), data.suppliers.map((x) => h("option", { key: x.id, value: x.id }, x.name))),`,
    `        h("option", { value: "" }, "Bütün təchizatçılar"), data.suppliers.map((x) => h("option", { key: x.id, value: x.id }, x.name))),
      data.objects.length ? h("select", { value: objectFilter, onChange: (e) => setObjectFilter(e.target.value), className: "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" },
        h("option", { value: "" }, "Bütün obyektlər"), data.objects.map((o) => h("option", { key: o.id, value: o.warehouseId }, o.name))) : null,`, 'object filter');
  s = replaceOnce(s, 'onClick: () => setRet({ supplierId: supplierFilter, purchaseId: "", lines: [blankLine()], note: "" })',
    'onClick: () => setRet({ supplierId: supplierFilter, purchaseId: "", warehouseId: objectFilter || data.homeWarehouse, lines: [blankLine()], note: "" })', 'new return');
  s = replaceOnce(s, 'onClick: () => setInvoice({ supplierId: supplierFilter, newSupplier: "", lines: [blankLine()],',
    'onClick: () => setInvoice({ supplierId: supplierFilter, newSupplier: "", warehouseId: objectFilter || data.homeWarehouse, lines: [blankLine()],', 'new invoice');

  // Tables: which branch.
  s = replaceOnce(s, '      head: ["Qaimə", "Tarix", "Təchizatçı", "Cəm", "Qalan borc", "Vəziyyət", ""],',
    '      head: ["Qaimə", "Tarix", "Təchizatçı", "Obyekt", "Cəm", "Qalan borc", "Vəziyyət", ""],', 'invoice head');
  s = replaceOnce(s, '        h("b", null, p.number), opsWhen(p.receivedAt || p.createdAt), p.supplierName, formatMoney(p.totalMinor ?? 0),',
    '        h("b", null, p.number), opsWhen(p.receivedAt || p.createdAt), p.supplierName, p.objectName || p.warehouseName || "—", formatMoney(p.totalMinor ?? 0),', 'invoice object');
  s = replaceOnce(s, `          p.status === "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void openReturnFrom(p), children: "Qaytar" }) : null)`,
    `          p.status === "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void openEdit(p), children: "Düzəliş et" }) : null,
          p.status === "received" && canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => void openReturnFrom(p), children: "Qaytar" }) : null)`, 'edit button');
  s = replaceOnce(s, '      head: ["Qaytarma", "Tarix", "Təchizatçı", "Qaimə", "Mallar", "Borcdan silindi"],',
    '      head: ["Qaytarma", "Tarix", "Təchizatçı", "Obyekt", "Qaimə", "Mallar", "Borcdan silindi"],', 'return head');
  s = replaceOnce(s, '      rows: returns.map((r) => [h("b", null, r.number), opsWhen(r.createdAt), r.supplierName, r.purchaseNumber || "—",',
    '      rows: returns.map((r) => [h("b", null, r.number), opsWhen(r.createdAt), r.supplierName, r.objectName || "—", r.purchaseNumber || "—",', 'return object');
  s = cut(s, '    view === "debts" ? jsxRuntimeExports.jsx(OpsTable, {', '    detail ? h("section"', '', 'debts view');

  // Invoice dialog: object, new goods, edit mode.
  s = replaceOnce(s, `    invoice ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni alış qaiməsi", onClose: () => setInvoice(null), busy, children: h("div", { className: "space-y-3" },
      supplierSelect(invoice, setInvoice, true),`,
    `    invoice ? jsxRuntimeExports.jsx(PsAdminDialog, { title: invoice.editId ? "Qaimə " + invoice.number + " — düzəliş" : "Yeni alış qaiməsi", onClose: () => setInvoice(null), busy, children: h("div", { className: "space-y-3" },
      supplierSelect(invoice, setInvoice, true),
      objectSelect(invoice, setInvoice, false),`, 'invoice dialog head');
  s = replaceOnce(s, `      h("button", { type: "button", className: "ps-recipe-add", onClick: () => setInvoice({ ...invoice, lines: [...invoice.lines, blankLine()] }) }, "+ Sətir"),`,
    `      h("div", { className: "flex flex-wrap gap-2" },
        h("button", { type: "button", className: "ps-recipe-add", onClick: () => setInvoice({ ...invoice, lines: [...invoice.lines, blankLine()] }) }, "+ Sətir"),
        h("button", { type: "button", className: "ps-recipe-add", onClick: () => setInvoice({ ...invoice, lines: [...invoice.lines, { ingredientId: "", isNew: true, name: "", unit: "kg", qty: "", price: "" }] }) }, "+ Yeni mal")),`, 'new good button');
  s = replaceOnce(s, `      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "İndi ödənilən (₼) — boş qalsa hamısı borca", value: invoice.paid,`,
    `      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        invoice.editId ? null : jsxRuntimeExports.jsx(OpsField, { label: "İndi ödənilən (₼) — boş qalsa hamısı borca", value: invoice.paid,`, 'paid hidden on edit');
  s = replaceOnce(s, `      h("p", { className: "text-xs text-muted" }, "Təsdiq edəndə mallar anbara girir, " + formatMoney(Math.max(0, invoiceTotal - (invoice.paid ? opsMinor(invoice.paid) : 0))) + " təchizatçının borcuna yazılır."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveInvoice, children: "Təsdiq et" }),`,
    `      h("p", { className: "text-xs text-muted" }, invoice.editId
        ? "Yadda saxlayanda anbar qalığı və təchizatçının borcu yeni miqdar və qiymətə görə düzəlir."
        : "Təsdiq edəndə mallar anbara girir, " + formatMoney(Math.max(0, invoiceTotal - (invoice.paid ? opsMinor(invoice.paid) : 0))) + " təchizatçının borcuna yazılır."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: saveInvoice, children: invoice.editId ? "Yadda saxla" : "Təsdiq et" }),`, 'invoice footer');
  s = replaceOnce(s, `      supplierSelect(ret, setRet, false),
      lineRows(ret, setRet, true),`, `      supplierSelect(ret, setRet, false),
      objectSelect(ret, setRet, Boolean(ret.purchaseId)),
      lineRows(ret, setRet, true),`, 'return object');
  fs.writeFileSync(BUNDLE, s);
  console.log('purchases v2 applied');
}

// apply-restaurant-admin-refresh.mjs rewrites the hub and the tab titles on every assemble.
{
  let t = fs.readFileSync(BUNDLE, 'utf8');
  const before = t;
  t = t.replace('"/operations?tab=roster", ', '');
  t = t.replace('"/operations?tab=suppliers", "/operations?tab=vendors"]', '"/operations?tab=purchases", "/operations?tab=vendors"]');
  t = t.replace('"/operations?tab=guests", "/operations?tab=reservations", ', '');
  t = t.replace(/^ {4}"\/operations\?tab=(roster|guests|reservations)": \[.*\n/gm, '');
  t = t.replace(/^ {4}"\/operations\?tab=suppliers": \[.*\n/m, '    "/operations?tab=purchases": ["Alış qaimələri, qaytarma, obyekt anbarları", "Alım faturaları ve iadeler", "Purchase invoices and returns"],\n');
  t = t.replace(/^ {4}"\/operations\?tab=vendors": \[.*\n/m, '    "/operations?tab=vendors": ["Təchizatçı, işçi, müştəri — borc və ödəniş", "Tedarikçi, çalışan, müşteri", "Suppliers, staff, customers"],\n');
  if (!t.includes('["tab=purchases","suppliers"]')) t = replaceOnce(t, '["tab=suppliers","suppliers"],', '["tab=suppliers","suppliers"],["tab=purchases","suppliers"],', 'lan area');
  t = t.replace('purchases: ["Alış qaimələri, təchizatçıya qaytarma və təchizatçı borcları."', 'purchases: ["Alış qaimələri və qaytarma, obyektə görə. Borc — Partnyorlarda."');
  if (t !== before) { fs.writeFileSync(BUNDLE, t); console.log('purchases v2: hub and titles'); }
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-purchase-new { display: grid; grid-template-columns: 1fr 6rem; gap: 0.4rem; }
.ps-purchase-new > * { margin-top: 0; }
@media (max-width: 720px) { .ps-purchase-row > .ps-purchase-new { grid-column: 1 / -1; } }
`;
    fs.writeFileSync(CSS, css);
  }
}
