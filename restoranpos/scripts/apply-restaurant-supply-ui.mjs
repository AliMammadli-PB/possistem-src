#!/usr/bin/env node
/**
 * Təchizat and Təchizatçılar, as two screens instead of one mixed list.
 *
 * They were stacked in a single tab: a "new supplier" form, a supplier table, a
 * purchase draft and a purchase table, one under the other. Ordering stock and
 * managing who you buy from are different jobs done by different people at
 * different times, so they are separate tabs now.
 *
 * Təchizat leads with the thing that actually starts an order - what has fallen
 * below its minimum - and can turn that straight into a draft, quantities
 * filled from the shortfall. That list is `inventory.lowStock`, real data, not
 * a suggestion invented in the renderer.
 *
 * Still not drawn, for want of a backend: per-line delivery status (the core
 * receives a purchase whole), invoice discounts and delivery charges, price
 * history and cheaper-alternative comparison, contact and payment terms beyond
 * name and phone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_SUPPLY_UI_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');

// --- doors to the new tab -------------------------------------------------
// Guarded on their own so they converge after the main mark is in place.
{
  const hubAfter = '    { to: "/operations?tab=suppliers", label: "Təchizat", icon: Store, show: hasPermission("suppliers.view") },';
  const hubAdd = hubAfter + '\n    { to: "/operations?tab=vendors", label: "Təchizatçılar", icon: Store, show: hasPermission("suppliers.view") },';
  if (s.includes(hubAfter) && !s.includes('tab=vendors')) {
    must(s.split(hubAfter).length - 1 === 2, 'expected the suppliers door in both the hub and the sidebar');
    s = s.split(hubAfter).join(hubAdd);
    fs.writeFileSync(BUNDLE, s);
    must(s.split('tab=vendors').length - 1 === 2, 'the vendors door did not reach both lists');
    console.log('added the Təchizatçılar door to the hub and the sidebar');
  }
}

if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

for (const helper of ['function OpsField(', 'function OpsButton(', 'function OpsTable(',
                      'function useOpsAction(', 'function formatMoney(',
                      'const opsQty', 'const opsMilli', 'const opsMinor', 'const opsWhen']) {
  must(s.includes(helper), `${helper} is not in the bundle`);
}

const start = s.indexOf('function OpsSuppliers() {');
must(start !== -1, 'OpsSuppliers not found');
const end = s.indexOf('\nfunction OpsGuests', start);
must(end !== -1, 'end of OpsSuppliers not found');

const NEXT = String.raw`function OpsSupplyStatus({ status }) {
  const tone = status === "received"
    ? { label: "Qəbul edilib", color: "var(--ps-ok)", tint: "#e7f5ee" }
    : status === "cancelled"
      ? { label: "Ləğv edilib", color: "var(--ps-danger)", tint: "#fdecea" }
      : { label: "Qaralama", color: "#a16207", tint: "#fdf4e3" };
  return /* @__PURE__ */ jsxRuntimeExports.jsx("span", {
    style: { display: "inline-block", padding: "3px 9px", borderRadius: "7px", background: tone.tint, color: tone.color, fontSize: "11.5px", fontWeight: 700 },
    children: tone.label
  });
}

function OpsSuppliers() {
  const [suppliers, setSuppliers] = reactExports.useState([]);
  const [purchases, setPurchases] = reactExports.useState([]);
  const [ingredients, setIngredients] = reactExports.useState([]);
  const [low, setLow] = reactExports.useState([]);
  const [filter, setFilter] = reactExports.useState("all");
  const [draft, setDraft] = reactExports.useState(null);

  const reload = reactExports.useCallback(async () => {
    const [sup, pur, ing, lowRes] = await Promise.all([
      window.pos.suppliers.list(),
      window.pos.suppliers.purchases(),
      window.pos.inventory.ingredients(),
      window.pos.inventory.lowStock()
    ]);
    if (sup.success) setSuppliers(sup.data.suppliers ?? []);
    if (pur.success) setPurchases(pur.data.purchases ?? []);
    if (ing.success) setIngredients(ing.data.ingredients ?? []);
    if (lowRes.success) setLow(lowRes.data.ingredients ?? []);
  }, []);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);

  const blank = () => ({ ingredientId: ingredients[0]?.id ?? "", qty: "", cost: "" });

  // What is missing, priced at the ingredient's own cost, so the draft opens
  // with quantities that actually close the shortfall.
  const openSuggested = () => {
    if (!suppliers.length) { toast("Əvvəlcə təchizatçı əlavə edin", "danger"); return; }
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const lines = low.map((r) => {
      const short = Math.max(0, (Number(r.minQtyMilli) || 0) - (Number(r.qtyMilli) || 0));
      const cost = byId.get(r.id)?.costMinor ?? 0;
      return { ingredientId: r.id, qty: String((short || 1000) / 1000), cost: String((cost / 100).toFixed(2)) };
    });
    setDraft({ supplierId: suppliers[0].id, name: suppliers[0].name, lines: lines.length ? lines : [blank()] });
  };

  const shown = purchases.filter((p) => filter === "all" || (p.status ?? "draft") === filter);
  const counts = {
    all: purchases.length,
    draft: purchases.filter((p) => (p.status ?? "draft") === "draft").length,
    received: purchases.filter((p) => p.status === "received").length
  };
  const chip = (key, label) => /* @__PURE__ */ jsxRuntimeExports.jsxs("button", {
    type: "button",
    onClick: () => setFilter(key),
    className: filter === key
      ? "rounded-xl border border-gold/50 bg-gold/15 px-3 py-2 text-sm text-gold"
      : "rounded-xl border border-hairline px-3 py-2 text-sm text-muted hover:text-cream",
    children: [label, /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-1.5 opacity-70", children: counts[key] })]
  }, key);

  const setLine = (i, patch) => {
    const lines = [...draft.lines];
    lines[i] = { ...lines[i], ...patch };
    setDraft({ ...draft, lines });
  };

  const draftTotal = draft
    ? draft.lines.reduce((sum, l) => sum + Math.round(opsMilli(l.qty) * opsMinor(l.cost) / 1000), 0)
    : 0;

  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [

    low.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", {
      className: "flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hairline bg-elevated p-4",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm font-semibold text-cream", children: [low.length, " məhsul minimumdan aşağıdır"] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-xs text-muted", children: low.slice(0, 6).map((r) => r.name + " (" + opsQty(r.qtyMilli) + " " + r.unit + ")").join(" · ") + (low.length > 6 ? " · …" : "") })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: openSuggested, children: "Sifariş təklifi hazırla" })
      ]
    }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      chip("all", "Hamısı"),
      chip("draft", "Qaralama"),
      chip("received", "Qəbul edilib"),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "flex-1" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, {
        disabled: busy,
        onClick: () => {
          if (!suppliers.length) { toast("Əvvəlcə təchizatçı əlavə edin", "danger"); return; }
          setDraft({ supplierId: suppliers[0].id, name: suppliers[0].name, lines: [blank()] });
        },
        children: "+ Yeni alış"
      })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {
      head: ["Sənəd", "Təchizatçı", "Tarix", "Məbləğ", "Status", " "],
      empty: filter === "all" ? "Hələ alış yoxdur" : "Bu statusda alış yoxdur",
      rows: shown.map((p) => [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-cream", children: p.number }),
        p.supplierName,
        opsWhen(p.receivedAt ?? p.createdAt),
        formatMoney(p.totalMinor ?? 0),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsSupplyStatus, { status: p.status ?? "draft" }),
        p.status !== "received"
          ? /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { disabled: busy,
              onClick: () => void run(window.pos.suppliers.receive(p.id), "Mal qəbul edildi"),
              children: "Qəbul et" })
          : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-faint", children: "—" })
      ])
    }),

    draft && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm font-semibold text-cream", children: "Yeni alış" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("select", {
          value: draft.supplierId,
          onChange: (e) => setDraft({ ...draft, supplierId: e.target.value, name: suppliers.find((x) => x.id === e.target.value)?.name ?? "" }),
          "aria-label": "Təchizatçı",
          className: "min-h-11 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream",
          children: suppliers.map((x) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: x.id, children: x.name }, x.id))
        })
      ] }),

      draft.lines.map((line, i) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs uppercase tracking-wide text-faint", children: "Məhsul" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("select", {
            value: line.ingredientId,
            onChange: (e) => setLine(i, { ingredientId: e.target.value }),
            className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream",
            children: ingredients.map((ing) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: ing.id, children: ing.name }, ing.id))
          })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Miqdar", value: line.qty, onChange: (v) => setLine(i, { qty: v }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Vahid qiymət (₼)", value: line.cost, onChange: (v) => setLine(i, { cost: v }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex items-end", children:
          /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet",
            onClick: () => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== i) }),
            children: "Sil" }) })
      ] }, i)),

      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setDraft({ ...draft, lines: [...draft.lines, blank()] }), children: "+ Sətir" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "flex-1" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-sm text-muted", children: ["Cəmi: ", /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-semibold text-cream", children: formatMoney(draftTotal) })] })
      ] }),

      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, {
          disabled: busy,
          onClick: () => {
            const lines = draft.lines
              .filter((l) => l.ingredientId && opsMilli(l.qty) > 0)
              .map((l) => ({ ingredientId: l.ingredientId, qtyMilli: opsMilli(l.qty), unitCostMinor: opsMinor(l.cost) }));
            if (!lines.length) { toast("Ən azı bir sətir lazımdır", "danger"); return; }
            void run(window.pos.suppliers.savePurchase({ supplierId: draft.supplierId, lines }), "Alış yaradıldı")
              .then((ok) => { if (ok) setDraft(null); });
          },
          children: "Yadda saxla"
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setDraft(null), children: "İmtina" })
      ] })
    ] })
  ] });
}

function OpsVendors() {
  const [suppliers, setSuppliers] = reactExports.useState([]);
  const [selected, setSelected] = reactExports.useState(null);
  const [ledger, setLedger] = reactExports.useState([]);
  const [form, setForm] = reactExports.useState(null);
  const [pay, setPay] = reactExports.useState(null);

  const reload = reactExports.useCallback(async () => {
    const res = await window.pos.suppliers.list();
    if (res.success) setSuppliers(res.data.suppliers ?? []);
  }, []);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);

  // The ledger is per supplier, so it is fetched when one is opened rather
  // than pulled for everybody up front.
  const open = async (row) => {
    setSelected(row);
    setLedger([]);
    const res = await window.pos.suppliers.ledger(row.id);
    if (res.success) setLedger(res.data.entries ?? res.data.ledger ?? []);
  };

  const owed = suppliers.reduce((sum, x) => sum + (x.dueMinor ?? 0), 0);

  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", children: "Təchizatçı" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-2xl font-bold text-cream", children: String(suppliers.length) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", style: owed > 0 ? { color: "var(--ps-danger)" } : null, children: "Ümumi borc" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-2xl font-bold text-cream", style: owed > 0 ? { color: "var(--ps-danger)" } : null, children: formatMoney(owed) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-hairline bg-elevated p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", children: "Borclu olan" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-2xl font-bold text-cream", children: String(suppliers.filter((x) => (x.dueMinor ?? 0) > 0).length) })
      ] })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "flex justify-end", children:
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ name: "", phone: "", contact: "" }), children: "+ Yeni təchizatçı" }) }),

    form && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm font-semibold text-cream", children: "Yeni təchizatçı" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: form.name, onChange: (v) => setForm({ ...form, name: v }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Telefon", value: form.phone, onChange: (v) => setForm({ ...form, phone: v }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Əlaqədar şəxs", value: form.contact, onChange: (v) => setForm({ ...form, contact: v }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, {
          disabled: busy,
          onClick: () => {
            if (!form.name.trim()) { toast("Ad tələb olunur", "danger"); return; }
            void run(window.pos.suppliers.save({ name: form.name.trim(), phone: form.phone.trim(), contact: form.contact.trim() }), "Saxlanıldı")
              .then((ok) => { if (ok) setForm(null); });
          },
          children: "Yadda saxla"
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" })
      ] })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {
      head: ["Təchizatçı", "Telefon", "Borc", "  "],
      empty: "Təchizatçı yoxdur",
      rows: suppliers.map((x) => [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-cream", children: x.name }),
        x.phone || "—",
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: (x.dueMinor ?? 0) > 0 ? { color: "var(--ps-danger)", fontWeight: 600 } : null, children: formatMoney(x.dueMinor ?? 0) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "flex gap-1", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void open(x), children: "Hesab" }),
          (x.dueMinor ?? 0) > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setPay({ supplier: x, value: "" }), children: "Ödə" })
        ] })
      ])
    }),

    pay && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm font-semibold text-cream", children: [pay.supplier.name, " — ödəniş"] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-muted", children: ["Cari borc: ", formatMoney(pay.supplier.dueMinor ?? 0)] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: pay.value, onChange: (v) => setPay({ ...pay, value: v }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { disabled: busy,
          onClick: () => void run(window.pos.suppliers.pay({ supplierId: pay.supplier.id, amountMinor: opsMinor(pay.value) }), "Ödəniş qeyd olundu")
            .then((ok) => { if (ok) setPay(null); }),
          children: "Təsdiq et" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPay(null), children: "Bağla" })
      ] })
    ] }),

    selected && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm font-semibold text-cream", children: [selected.name, " — hesab hərəkəti"] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setSelected(null), children: "Bağla" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {
        head: ["Tarix", "Növ", "Məbləğ", "Qeyd"],
        empty: "Hərəkət yoxdur",
        rows: ledger.map((e) => [
          opsWhen(e.createdAt),
          e.kind === "payment" ? "Ödəniş" : "Borc",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: e.kind === "payment" ? "var(--ps-ok)" : "var(--ps-danger)", fontWeight: 600 }, children: formatMoney(Math.abs(e.amountMinor ?? 0)) }),
          e.note || "—"
        ])
      })
    ] })
  ] });
}
`;

s = s.slice(0, start) + NEXT + s.slice(end + 1);

// --- the new tab ----------------------------------------------------------
s = replaceOnce(
  s,
  `    { id: "guests", label: "Müştərilər", show: hasPermission("customers.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsGuests, {}) },`,
  `    { id: "vendors", label: "Təchizatçılar", show: hasPermission("suppliers.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsVendors, {}) },
    { id: "guests", label: "Müştərilər", show: hasPermission("customers.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsGuests, {}) },`,
  'vendors tab',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('function OpsSuppliers() {'), 'OpsSuppliers lost');
must(s.includes('function OpsVendors() {'), 'OpsVendors missing');
must(s.includes('function OpsGuests('), 'OpsGuests lost');
must(s.split('function OpsSuppliers() {').length - 1 === 1, 'OpsSuppliers duplicated');
must(s.includes('id: "vendors"'), 'the vendors tab was not registered');
must(s.includes('Sifariş təklifi hazırla'), 'the shortfall action is missing');
must(s.includes('window.pos.inventory.lowStock'), 'the suggestion is not read from the core');
// A failed save must not discard what was typed.
must(s.includes('.then((ok) => { if (ok) setDraft(null); })'), 'the purchase draft closes on failure');
must(s.includes('.then((ok) => { if (ok) setForm(null); })'), 'the supplier form closes on failure');
must(s.includes('.then((ok) => { if (ok) setPay(null); })'), 'the payment panel closes on failure');
// Nothing drawn without a backend.
for (const absent of ['Qismən', 'Endirim', 'Çatdırılma haqqı', 'Qiymət tarixçəsi', 'Alternativ']) {
  must(!s.includes(`children: "${absent}"`), `${absent} has no backing in the core yet`);
}

console.log('patched', BUNDLE);
