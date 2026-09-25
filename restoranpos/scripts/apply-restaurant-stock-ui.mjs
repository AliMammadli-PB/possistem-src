#!/usr/bin/env node
/**
 * The Anbar screen the design called for, built on what the core answers today.
 *
 * What was there: a permanently open four-field form and a flat list. What the
 * owner needs first is the state of the store - what it is worth, what is about
 * to run out, what went in the bin - and that was nowhere.
 *
 * Deliberately NOT drawn, because nothing behind them exists yet: category,
 * purchase-vs-stock unit conversion, average/previous cost, optimal and maximum
 * levels, batches and expiry, per-product suppliers. A filter that filters
 * nothing and a price that never moves are worse than an honest gap - they read
 * as features and get trusted. Those arrive with the schema that backs them.
 *
 * Sayım is likewise absent here: the core implements the whole stocktake
 * (create / count / post) but no screen calls it, and a button that opens
 * nothing is not a feature. It is the next piece, not a stub in this one.
 *
 * Mal qəbulu is not duplicated either - purchases live on the Təchizat tab,
 * which already creates and receives them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_STOCK_UI_v2 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

// The helpers this component leans on must already be in the bundle; a missing
// one is a ReferenceError at render that no syntax check would catch.
// Declared two ways in this bundle: components as `function X(`, the small
// number helpers as `const x =`. Check each the way it is actually written.
for (const helper of ['function OpsField(', 'function OpsButton(', 'function OpsTable(',
                      'function useOpsAction(', 'function formatMoney(',
                      'const opsQty', 'const opsMilli', 'const opsMinor']) {
  must(s.includes(helper), `${helper} is not in the bundle`);
}

const start = s.indexOf('function OpsStock() {');
must(start !== -1, 'OpsStock not found');
const end = s.indexOf('\nfunction OpsSuppliers', start);
must(end !== -1, 'end of OpsStock not found');

const NEXT = String.raw`function OpsStock() {
  const [levels, setLevels] = reactExports.useState([]);
  const [warehouses, setWarehouses] = reactExports.useState([]);
  const [warehouseId, setWarehouseId] = reactExports.useState("");
  const [worth, setWorth] = reactExports.useState(0);
  const [wasteMinor, setWasteMinor] = reactExports.useState(0);
  const [query, setQuery] = reactExports.useState("");
  const [status, setStatus] = reactExports.useState("all");
  const [drawer, setDrawer] = reactExports.useState(null);
  const [edit, setEdit] = reactExports.useState(null);

  const reload = reactExports.useCallback(async () => {
    const [levelRes, whRes, valRes, moveRes] = await Promise.all([
      window.pos.inventory.levels(warehouseId),
      window.pos.inventory.warehouses(),
      window.pos.inventory.valuation(warehouseId),
      window.pos.inventory.movements({ limit: 500 })
    ]);
    const rows = levelRes.success ? (levelRes.data.levels ?? []) : [];
    setLevels(rows);
    if (whRes.success) {
      const list = whRes.data.warehouses ?? [];
      setWarehouses(list);
      setWarehouseId((prev) => prev || list[0]?.id || "");
    }
    if (valRes.success) setWorth(valRes.data.totalMinor ?? 0);

    // Movements carry no cost, so it is priced from the ingredient the row
    // points at. Thirty days because that is the window the card names.
    if (moveRes.success) {
      const cost = new Map(rows.map((r) => [r.id, r.costMinor ?? 0]));
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let total = 0;
      for (const m of moveRes.data.movements ?? []) {
        if (m.kind !== "waste" || Number(m.createdAt) < since) continue;
        total += Math.abs(Number(m.qtyDeltaMilli) || 0) * (cost.get(m.ingredientId) ?? 0) / 1000;
      }
      setWasteMinor(Math.round(total));
    }
  }, [warehouseId]);

  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);

  // Four states, because "low" alone cannot tell an owner whether to order now
  // or after the weekend. A minimum of zero means the item is simply untracked.
  const stateOf = (row) => {
    const qty = Number(row.qtyMilli) || 0;
    const min = Number(row.minQtyMilli) || 0;
    if (qty <= 0) return { key: "out", label: "Bitib", color: "var(--ps-danger)", tint: "#fdecea" };
    if (min <= 0) return { key: "ok", label: "Normal", color: "var(--ps-ok)", tint: "#e7f5ee" };
    if (qty < min) return { key: "low", label: "Minimumdan aşağı", color: "var(--ps-warn)", tint: "#fdeee3" };
    if (qty <= min * 1.25) return { key: "near", label: "Minimuma yaxın", color: "#a16207", tint: "#fdf4e3" };
    return { key: "ok", label: "Normal", color: "var(--ps-ok)", tint: "#e7f5ee" };
  };

  const needle = query.trim().toLowerCase();
  const shown = levels.filter((row) => {
    if (status !== "all" && stateOf(row).key !== status) return false;
    if (!needle) return true;
    return String(row.name ?? "").toLowerCase().includes(needle)
        || String(row.sku ?? "").toLowerCase().includes(needle);
  });

  const belowMin = levels.filter((r) => stateOf(r).key === "low").length;
  const outOf = levels.filter((r) => stateOf(r).key === "out").length;

  const card = (label, value, sub, tone) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: "rounded-2xl border border-hairline bg-elevated p-4",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-1.5", children: [
          tone ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: tone } }) : null,
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", style: tone ? { color: tone } : null, children: label })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream", style: tone ? { color: tone } : null, children: value }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-[11px] text-muted", children: sub })
      ]
    },
    label
  );

  const chip = (key, label, count) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "button",
    {
      type: "button",
      onClick: () => setStatus(key),
      className: status === key
        ? "rounded-xl border border-gold/50 bg-gold/15 px-3 py-2 text-sm text-gold"
        : "rounded-xl border border-hairline px-3 py-2 text-sm text-muted hover:text-cream",
      children: [label, /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-1.5 opacity-70", children: count })]
    },
    key
  );

  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-5", children: [
      card("Ümumi stok dəyəri", formatMoney(worth), warehouses.length > 1 ? "Seçilmiş anbar" : "Bütün anbar", null),
      card("Stokda məhsul", String(levels.length), "Aktiv inqrediyent", null),
      card("Minimumdan aşağı", String(belowMin), belowMin ? "Sifariş vaxtıdır" : "Hamısı qaydasındadır", belowMin ? "var(--ps-warn)" : null),
      card("Stoku bitən", String(outOf), outOf ? "Menyuda təsir edir" : "Bitən yoxdur", outOf ? "var(--ps-danger)" : null),
      card("30 günlük itki", formatMoney(wasteMinor), "Zay kimi silinib", null)
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      warehouses.length > 1 ? /* @__PURE__ */ jsxRuntimeExports.jsx("select", {
        value: warehouseId,
        onChange: (e) => setWarehouseId(e.target.value),
        className: "min-h-11 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream",
        children: warehouses.map((w) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: w.id, children: w.name }, w.id))
      }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsx("input", {
        type: "search",
        value: query,
        onChange: (e) => setQuery(e.target.value),
        placeholder: "Məhsul və ya SKU axtar…",
        "aria-label": "Məhsul axtar",
        className: "min-h-11 min-w-[220px] flex-1 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream"
      }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { onClick: () => setDrawer({ name: "", unit: "kg", cost: "", minQty: "" }), children: "+ Yeni məhsul" })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2", children: [
      chip("all", "Hamısı", levels.length),
      chip("out", "Bitib", outOf),
      chip("low", "Minimumdan aşağı", belowMin),
      chip("near", "Minimuma yaxın", levels.filter((r) => stateOf(r).key === "near").length),
      chip("ok", "Normal", levels.filter((r) => stateOf(r).key === "ok").length)
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {
      head: ["Məhsul", "Cari stok", "Minimum", "Maya", "Stok dəyəri", "Status", ""],
      empty: needle || status !== "all" ? "Bu axtarışa uyğun məhsul yoxdur" : "Hələ məhsul əlavə olunmayıb",
      rows: shown.map((row) => {
        const st = stateOf(row);
        const value = Math.round((Number(row.qtyMilli) || 0) * (row.costMinor ?? 0) / 1000);
        return [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "block", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block font-medium text-cream", children: row.name }),
            row.sku ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-[11px] text-faint", children: row.sku }) : null
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { color: st.color, fontWeight: 600 }, children: [opsQty(row.qtyMilli), " ", row.unit] }),
          opsQty(row.minQtyMilli),
          formatMoney(row.costMinor ?? 0),
          formatMoney(value),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {
            style: { display: "inline-block", padding: "3px 9px", borderRadius: "7px", background: st.tint, color: st.color, fontSize: "11.5px", fontWeight: 700 },
            children: st.label
          }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "flex gap-1", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEdit({ mode: "adjust", row, value: "", reason: "" }), children: "Düzəliş" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setEdit({ mode: "waste", row, value: "", reason: "" }), children: "Zay" })
          ] })
        ];
      })
    }),

    drawer && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm font-semibold text-cream", children: "Yeni məhsul" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: drawer.name, onChange: (v) => setDrawer({ ...drawer, name: v }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs uppercase tracking-wide text-faint", children: "Vahid" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("select", {
            value: drawer.unit,
            onChange: (e) => setDrawer({ ...drawer, unit: e.target.value }),
            className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream",
            children: ["kg", "l", "ədəd", "qab"].map((u) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: u, children: u }, u))
          })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Maya (₼)", value: drawer.cost, onChange: (v) => setDrawer({ ...drawer, cost: v }), placeholder: "0.00" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Minimum", value: drawer.minQty, onChange: (v) => setDrawer({ ...drawer, minQty: v }), placeholder: "0" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, {
          disabled: busy,
          onClick: () => {
            if (!drawer.name.trim()) { toast("Ad tələb olunur", "danger"); return; }
            void run(window.pos.inventory.saveIngredient({
              name: drawer.name.trim(),
              unit: drawer.unit,
              costMinor: opsMinor(drawer.cost),
              minQtyMilli: opsMilli(drawer.minQty)
            }), "Məhsul əlavə olundu").then((ok) => { if (ok) setDrawer(null); });
          },
          children: "Yadda saxla"
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setDrawer(null), children: "İmtina" })
      ] })
    ] }),

    edit && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm font-semibold text-cream", children: [edit.row.name, " — ", edit.mode === "waste" ? "zay / silinmə" : "stok düzəlişi"] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: edit.mode === "waste" ? "Silinən miqdar" : "Fərq (+/-)", value: edit.value, onChange: (v) => setEdit({ ...edit, value: v }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Səbəb", value: edit.reason, onChange: (v) => setEdit({ ...edit, reason: v }) })
      ] }),
      edit.mode === "waste" && edit.value ? /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-muted", children: [
        "İtkinin dəyəri: ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--ps-danger)", fontWeight: 700 }, children: formatMoney(Math.round(opsMilli(edit.value) * (edit.row.costMinor ?? 0) / 1000)) })
      ] }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, {
          disabled: busy,
          onClick: () => {
            const payload = { ingredientId: edit.row.id, warehouseId, reason: edit.reason.trim() };
            const call = edit.mode === "waste"
              ? window.pos.inventory.waste({ ...payload, qtyMilli: opsMilli(edit.value) })
              : window.pos.inventory.adjust({ ...payload, qtyDeltaMilli: opsMilli(edit.value) });
            void run(call, "Saxlanıldı").then((ok) => { if (ok) setEdit(null); });
          },
          children: "Təsdiq et"
        }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setEdit(null), children: "Bağla" })
      ] })
    ] })
  ] });
}
`;

s = s.slice(0, start) + NEXT + s.slice(end + 1);
s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('function OpsStock() {'), 'OpsStock lost');
must(s.includes('function OpsSuppliers('), 'OpsSuppliers lost');
must(s.split('function OpsStock() {').length - 1 === 1, 'OpsStock duplicated');
must(s.includes('Ümumi stok dəyəri'), 'the value card is missing');
must(s.includes('inventory.valuation'), 'valuation is not read');
must(s.includes('m.kind !== "waste"'), 'the waste window is not computed');
// The old always-open form must be gone; adding a product is a deliberate act.
must(!s.includes('children: "Yeni inqrediyent"'), 'the old inline form survived');
// Nothing may be drawn that the core cannot answer.
for (const absent of ['Kateqoriya', 'Alış vahidi', 'Orta alış', 'Partiya', 'Optimal']) {
  must(!s.includes(`children: "${absent}"`), `${absent} has no backing in the core yet`);
}

// A failed save must leave the panel open with the values still in it.
must(s.includes('.then((ok) => { if (ok) setDrawer(null); })'), 'the drawer closes on failure');
must(s.includes('.then((ok) => { if (ok) setEdit(null); })'), 'the adjust panel closes on failure');

console.log('patched', BUNDLE);
