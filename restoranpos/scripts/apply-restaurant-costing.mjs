#!/usr/bin/env node
/**
 * Kalkulyasiya: what each dish costs to make, against what it sells for.
 *
 * Everything this needs was already in the database - recipes in
 * `menu_item_ingredients`, ingredient prices in `ingredients.cost_minor` - and
 * the arithmetic existed in `recipes.get`, for one dish at a time. So a chef
 * could open a dish and see its cost, and nobody could answer the question an
 * owner actually asks: which dishes are losing money, and what is the menu's
 * food cost.
 *
 * Three things this screen shows that were invisible before:
 *
 *  - Dishes with no recipe at all. They were not "cheap", they were unanswered,
 *    and being absent from the question is how they stayed that way for years.
 *  - Recipes built from ingredients whose cost is zero. The dish then reads as
 *    pure profit and drags the menu average down with it.
 *  - Dishes priced below what they cost. One per menu is a loss leader; five is
 *    a pricing sheet nobody has revisited since the last supplier increase.
 *
 * Cost is the gross quantity the store gives up. Trimming loss is deliberately
 * not deducted: the kilo was paid for whole, and a costing that counts only
 * what reached the plate reads low by exactly what went in the bin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const PRELOAD = path.join(ROOT, 'out/preload/index.js');
const MARK = '/* POS_COSTING_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const hits = src.split(find).length - 1;
  must(hits === 1, `${label}: expected 1 match, found ${hits}`);
  return src.replace(find, repl);
}

// --- the bridge -----------------------------------------------------------
{
  let preload = fs.readFileSync(PRELOAD, 'utf8');
  if (preload.includes('reports.costing')) {
    console.log('preload already applied');
  } else {
    preload = replaceOnce(
      preload,
      '    lowStock: () => call("inventory.lowStock"),',
      `    lowStock: () => call("inventory.lowStock"),
    /** Kalkulyasiya: every dish costed from its recipe at today's prices. */
    costing: () => call("reports.costing", {}, { timeoutMs: 15000 }),`,
      'costing bridge',
    );
    fs.writeFileSync(PRELOAD, preload);
    console.log('  + preload: reports.costing');
  }
  must(fs.readFileSync(PRELOAD, 'utf8').includes('reports.costing'), 'the bridge did not land');
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

for (const helper of ['function OpsTable(', 'function useOpsAction(', 'function formatMoney(',
                      'function OpsButton(', 'function OpsField(']) {
  must(s.includes(helper), `${helper} is not in the bundle`);
}

// --- the screen -----------------------------------------------------------
const PAGE = String.raw`function OpsCosting() {
  const [rows, setRows] = reactExports.useState([]);
  const [summary, setSummary] = reactExports.useState(null);
  const [query, setQuery] = reactExports.useState("");
  const [filter, setFilter] = reactExports.useState("all");
  const [sort, setSort] = reactExports.useState("worst");

  const reload = reactExports.useCallback(async () => {
    const res = await window.pos.inventory.costing();
    if (!res.success) return;
    setRows(res.data.items ?? []);
    setSummary(res.data.summary ?? null);
  }, []);

  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);

  // Basis points rather than a float: the core never sends one across, and a
  // percentage with two decimals is more precision than a menu deserves.
  const pct = (bp) => (Number(bp) / 100).toFixed(1) + "%";

  const state = (row) => {
    if (!row.hasRecipe) return { key: "norecipe", label: "Kalkulyasiya yoxdur", color: "var(--ps-danger)" };
    if (row.unpriced) return { key: "unpriced", label: "Maya dəyəri yazılmayıb", color: "var(--ps-warn)" };
    if ((row.marginMinor ?? 0) < 0) return { key: "losing", label: "Zərər", color: "var(--ps-danger)" };
    if ((row.foodCostBp ?? 0) > 3500) return { key: "high", label: "Maya yüksək", color: "#a16207" };
    return { key: "ok", label: "Normal", color: "var(--ps-ok)" };
  };

  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter((row) => {
      if (filter !== "all" && state(row).key !== filter) return false;
      if (!needle) return true;
      return String(row.name ?? "").toLowerCase().includes(needle)
          || String(row.category ?? "").toLowerCase().includes(needle);
    })
    .slice()
    .sort((a, b) => {
      // Worst first by default: a list sorted by name is a list nobody acts on.
      if (sort === "worst") return (b.foodCostBp ?? 0) - (a.foodCostBp ?? 0);
      if (sort === "margin") return (a.marginMinor ?? 0) - (b.marginMinor ?? 0);
      return String(a.name ?? "").localeCompare(String(b.name ?? ""), "az");
    });

  const card = (label, value, sub, tone) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: "rounded-2xl border border-hairline bg-elevated p-4",
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.09em] text-faint", style: tone ? { color: tone } : null, children: label }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-2xl font-bold tracking-tight text-cream", style: tone ? { color: tone } : null, children: value }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-[11px] text-muted", children: sub })
      ]
    },
    label
  );

  const chip = (id, label) => /* @__PURE__ */ jsxRuntimeExports.jsx(
    "button",
    {
      type: "button",
      onClick: () => setFilter(id),
      className: "touch-target rounded-xl border px-3 py-1.5 text-xs " + (filter === id
        ? "border-gold/60 bg-gold/15 text-gold"
        : "border-hairline text-muted hover:text-cream"),
      children: label
    },
    id
  );

  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-3 sm:grid-cols-2 lg:grid-cols-4", children: [
      card("Menyu mayası", summary ? pct(summary.foodCostBp) : "—", "Satış qiymətinin faizi kimi", null),
      card("Kalkulyasiyası olan", summary ? summary.withRecipe + " / " + summary.dishes : "—", "Resepti yazılmış yeməklər", null),
      card("Kalkulyasiyası yoxdur", summary ? String(summary.missingRecipes) : "—", "Mayası bilinmir", summary && summary.missingRecipes > 0 ? "var(--ps-danger)" : null),
      card("Zərərlə satılan", summary ? String(summary.losingMoney) : "—", "Qiymət mayadan aşağı", summary && summary.losingMoney > 0 ? "var(--ps-danger)" : null)
    ] }),

    summary && summary.unpricedIngredients > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-cream", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("b", { children: [summary.unpricedIngredients, " yeməyin tərkibində maya dəyəri yazılmamış məhsul var."] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mt-1 block text-muted", children: "Onların mayası olduğundan ucuz görünür və menyunun orta mayasını aşağı çəkir. Anbarda həmin məhsulların qiymətini yazın." })
    ] }) : null,

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "min-w-[200px] flex-1", children:
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Axtar", value: query, onChange: setQuery, placeholder: "Yemək və ya kateqoriya" })
      }),
      chip("all", "Hamısı"),
      chip("losing", "Zərər"),
      chip("high", "Maya yüksək"),
      chip("norecipe", "Kalkulyasiyasız"),
      chip("unpriced", "Qiymətsiz tərkib"),
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => void run(Promise.resolve({ success: true })), children: "Yenilə" })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap gap-2 text-xs text-muted", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Sıralama:" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setSort("worst"), className: sort === "worst" ? "text-gold" : "hover:text-cream", children: "Maya faizi" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setSort("margin"), className: sort === "margin" ? "text-gold" : "hover:text-cream", children: "Qazanc" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setSort("name"), className: sort === "name" ? "text-gold" : "hover:text-cream", children: "Ad" })
    ] }),

    /* @__PURE__ */ jsxRuntimeExports.jsx(OpsTable, {
      head: ["Yemək", "Kateqoriya", "Maya", "Qiymət", "Qazanc", "Maya %", "Vəziyyət"],
      empty: "Bu süzgəcə uyğun yemək yoxdur",
      rows: shown.map((row) => {
        const st = state(row);
        return [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-cream", children: row.name }),
          row.category ?? "—",
          row.hasRecipe ? formatMoney(row.costMinor ?? 0) : "—",
          formatMoney(row.priceMinor ?? 0),
          row.hasRecipe
            ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: (row.marginMinor ?? 0) < 0 ? "var(--ps-danger)" : null }, children: formatMoney(row.marginMinor ?? 0) })
            : "—",
          row.hasRecipe ? pct(row.foodCostBp) : "—",
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs", style: { color: st.color }, children: st.label })
        ];
      })
    })
  ] });
}

`;

s = replaceOnce(s, 'function OpsSuppliers() {', PAGE + 'function OpsSuppliers() {', 'costing page');

// --- the tab --------------------------------------------------------------
s = replaceOnce(
  s,
  `    { id: "suppliers", label: "Təchizat", show: hasPermission("suppliers.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsSuppliers, {}) },`,
  `    { id: "suppliers", label: "Təchizat", show: hasPermission("suppliers.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsSuppliers, {}) },
    { id: "costing", label: "Kalkulyasiya", show: hasPermission("inventory.view"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsCosting, {}) },`,
  'costing tab',
);

// The hub's title map names every tab it can land on; without an entry the
// header reads blank, which looks like a half-built screen.
s = replaceOnce(
  s,
  `suppliers: ["T\\u0259chizat", "Tedarik", "Purchasing"],`,
  `suppliers: ["T\\u0259chizat", "Tedarik", "Purchasing"], costing: ["Kalkulyasiya", "Maliyet", "Costing"],`,
  'hub title',
);

must(s.includes('function OpsCosting()'), 'the page is missing');
must(s.includes('id: "costing"'), 'the tab is missing');
must(s.includes('window.pos.inventory.costing()'), 'nothing calls the core');
// A dish with no recipe must never be shown as costing nothing.
must(s.includes('row.hasRecipe ? formatMoney(row.costMinor ?? 0) : "—"'), 'an unknown cost is shown as a number');

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);
console.log('patched', path.basename(BUNDLE));
