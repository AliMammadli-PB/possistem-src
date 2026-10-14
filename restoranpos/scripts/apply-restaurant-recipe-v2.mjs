#!/usr/bin/env node
/**
 * Catalog → Anbar → Kalkulyasiya, end to end (customer report, 1.7.21):
 *
 *  1. A product added in the catalog lands in Anbar: a stock item of the same
 *     name (unit ədəd, sku MENU-<productId>) linked 1:1 as its recipe, so a
 *     bottle of Kola leaves the stock when it is sold.
 *  2. Anbar rows can be deleted (ingredients.deactivate: history stays).
 *  3. The recipe editor is rebuilt: every Anbar item is a chip - tap as many
 *     as the dish needs (Pomidor, Yumurta…), then type each amount on one
 *     compact row (q / kg, ml / l, ədəd). Saving a real recipe drops the 1:1
 *     link and removes that placeholder from Anbar; from then on a sale takes
 *     the ingredients out of stock (consumeOnClose, unchanged).
 * Runs after apply-restaurant-stock-recipe.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_RECIPE_V2 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  // 1. Catalog: a new product gets its own Anbar item.
  s = replaceOnce(s,
    `    const productId = editId || (typeof res.data === "object" && res.data && "id" in res.data ? String(res.data.id) : "");
`,
    `    const productId = editId || (typeof res.data === "object" && res.data && "id" in res.data ? String(res.data.id) : "");
    ${MARK}
    if (!editId && productId) {
      // It shows up in Anbar straight away and is taken out 1:1 when sold,
      // until a real recipe is written for it in Kalkulyasiya.
      try {
        const ing = await window.pos.inventory.saveIngredient({ name: nameAz.trim(), unit: "ədəd", costMinor: 0, minQtyMilli: 0, sku: "MENU-" + productId });
        const ingId = ing.success ? (ing.data?.id || ing.data?.ingredient?.id) : null;
        if (ingId) await window.pos.inventory.saveRecipe(productId, [{ ingredientId: ingId, qtyMilli: 1000 }]);
      } catch {}
    }
`,
    'catalog new product to anbar');

  // 2. Anbar: delete a row.
  s = replaceOnce(s,
    `function OpsStock() {
  const [levels, setLevels] = reactExports.useState([]);`,
    `function OpsStock() {
  const [confirmAsk, confirmDialog] = useConfirm();
  const [levels, setLevels] = reactExports.useState([]);`,
    'stock confirm hook');
  s = replaceOnce(s,
    `            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setEdit({ mode: "waste", row, value: "", reason: "" }), children: "Zay" })
          ] })`,
    `            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setEdit({ mode: "waste", row, value: "", reason: "" }), children: "Zay" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: async () => {
              if (!(await confirmAsk('"' + row.name + '" anbardan silinsin? Keçmiş hərəkətlər qalır. Reseptlərdə varsa, oradan da çıxarın.', { danger: true }))) return;
              void run(window.pos.inventory.deactivateIngredient(row.id), "Silindi");
            }, children: "Sil" })
          ] })`,
    'stock delete button');
  s = replaceOnce(s,
    `        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEdit(null), children: "Bağla" })
      ] })
    ] })
  ] });
}
function OpsSupplyStatus`,
    `        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEdit(null), children: "Bağla" })
      ] })
    ] }),
    confirmDialog
  ] });
}
function OpsSupplyStatus`,
    'stock confirm dialog');

  // 3. Kalkulyasiya.
  s = replaceOnce(s,
    `    if (line.unit === "q") return Math.round(n);`,
    `    if (line.unit === "q" || line.unit === "ml") return Math.round(n);`,
    'ml quantities');
  s = replaceOnce(s,
    `        const persistUnit = line.unit === "q" ? "kg" : (line.unit || "kg");`,
    `        const persistUnit = line.unit === "q" ? "kg" : line.unit === "ml" ? "l" : (line.unit || "kg");`,
    'ml persist unit');
  s = replaceOnce(s,
    `  const [editor, setEditor] = reactExports.useState(null);

  const reload = reactExports.useCallback(async () => {
    const [costRes, ingRes] = await Promise.all([`,
    `  const [editor, setEditor] = reactExports.useState(null);
  const [pickQuery, setPickQuery] = reactExports.useState("");

  const reload = reactExports.useCallback(async () => {
    const [costRes, ingRes] = await Promise.all([`,
    'pick query state');

  // openRecipe: fresh Anbar list, the 1:1 placeholder kept out of the lines.
  s = replaceOnce(s,
    `    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const lines = (res.data.lines ?? []).map((line) => {`,
    `    const fresh = await window.pos.inventory.ingredients();
    const ingList = fresh.success ? (fresh.data.ingredients ?? []) : ingredients;
    if (fresh.success) setIngredients(ingList);
    const selfItem = ingList.find((i) => i.sku === "MENU-" + row.id);
    const byId = new Map(ingList.map((i) => [i.id, i]));
    setPickQuery("");
    const lines = (res.data.lines ?? []).filter((line) => !selfItem || line.ingredientId !== selfItem.id).map((line) => {`,
    'open recipe fresh list');
  s = replaceOnce(s,
    `      priceMinor: row.priceMinor ?? 0,
      lines: lines.length ? lines : [blankLine()]
    });`,
    `      priceMinor: row.priceMinor ?? 0,
      selfId: selfItem ? selfItem.id : "",
      lines
    });`,
    'open recipe editor state');

  // saveRecipe: a picked row needs an amount; keep or drop the placeholder.
  s = replaceOnce(s,
    `    for (const line of editor.lines) {
      const qtyMilli = lineQtyMilli(line);`,
    `    for (const line of editor.lines) {
      const qtyMilli = lineQtyMilli(line);
      if (line.mode === "pick" && line.ingredientId && qtyMilli <= 0) {
        toast("Miqdarı yazın: " + (line.name || "məhsul"), "danger");
        return;
      }`,
    'save recipe amount check');
  s = replaceOnce(s,
    `    void run(window.pos.inventory.saveRecipe(editor.id, prepared), prepared.length ? "Resept saxlanıldı" : "Resept silindi")
      .then((ok) => {
        if (ok) {
          setEditor(null);`,
    `    const keepSelf = !prepared.length && editor.selfId;
    if (keepSelf) prepared.push({ ingredientId: editor.selfId, qtyMilli: 1000 });
    const dropSelf = !keepSelf && editor.selfId;
    void run(window.pos.inventory.saveRecipe(editor.id, prepared), keepSelf ? "Saxlanıldı" : prepared.length ? "Resept saxlanıldı" : "Resept silindi")
      .then((ok) => {
        if (ok) {
          if (dropSelf) void window.pos.inventory.deactivateIngredient(editor.selfId).then(() => reload());
          setEditor(null);`,
    'save recipe placeholder');

  // The editor itself.
  const start = s.indexOf(`    editor && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, {
      title: "Resept — " + editor.name,`);
  if (start < 0) throw new Error('recipe editor start not found');
  const endMarker = `
  ] });
}

function OpsSuppliers`;
  const end = s.indexOf(endMarker, start);
  if (end < 0) throw new Error('recipe editor end not found');
  s = s.slice(0, start) + `    editor && psRecipeEditor({ editor, setEditor, ingredients, busy, pickQuery, setPickQuery, lineCostMinor, editorCost, setLine, saveRecipe, unitLabel })` + s.slice(end);

  s = replaceOnce(s,
    `function OpsCosting() {`,
    `${MARK}
function psH(tag, props, ...children) {
  const { key, ...rest } = props || {};
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return kids.length > 1 ? jsxRuntimeExports.jsxs(tag, { ...rest, children: kids }, key) : jsxRuntimeExports.jsx(tag, { ...rest, children: kids[0] }, key);
}
/** The units a recipe row can use for an Anbar item of this stock unit. */
function psRecipeUnits(stockUnit) {
  if (stockUnit === "kg") return ["q", "kg"];
  if (stockUnit === "l") return ["ml", "l"];
  return [stockUnit || "ədəd"];
}
function psRecipeEditor({ editor, setEditor, ingredients, busy, pickQuery, setPickQuery, lineCostMinor, editorCost, setLine, saveRecipe, unitLabel }) {
  const h = psH;
  const label = (u) => (u === "ml" ? "ml" : unitLabel(u));
  const cost = editorCost();
  const margin = editor.priceMinor - cost;
  const pct = editor.priceMinor > 0 ? (cost * 100 / editor.priceMinor).toFixed(1) + "%" : "—";
  const stock = ingredients.filter((i) => i.id !== editor.selfId);
  const needle = pickQuery.trim().toLowerCase();
  const shown = needle ? stock.filter((i) => String(i.name || "").toLowerCase().includes(needle)) : stock;
  const picked = new Set(editor.lines.filter((l) => l.mode === "pick").map((l) => l.ingredientId));
  const toggle = (ing) => {
    if (picked.has(ing.id)) {
      setEditor((prev) => prev ? { ...prev, lines: prev.lines.filter((l) => !(l.mode === "pick" && l.ingredientId === ing.id)) } : prev);
      return;
    }
    const unit = psRecipeUnits(ing.unit)[0];
    const costMinor = Number(ing.costMinor) || 0;
    setEditor((prev) => prev ? { ...prev, lines: [...prev.lines, { mode: "pick", ingredientId: ing.id, name: ing.name, stockUnit: ing.unit, unit, qty: "", unitCost: (costMinor / 100).toFixed(2), unitCostMinor: costMinor }] } : prev);
  };
  const removeAt = (i) => setEditor((prev) => prev ? { ...prev, lines: prev.lines.filter((_, j) => j !== i) } : prev);
  const priceLabel = (u) => (u === "q" || u === "kg" ? "1 kg qiyməti" : u === "ml" || u === "l" ? "1 litr qiyməti" : "1 " + label(u) + " qiyməti");
  const stockUnitOf = (line) => line.stockUnit || (ingredients.find((i) => i.id === line.ingredientId) || {}).unit || (line.unit === "q" ? "kg" : line.unit === "ml" ? "l" : line.unit);
  const fact = (k, v, tone) => h("div", { className: "ps-recipe-fact" }, h("span", null, k), h("b", tone ? { style: { color: tone } } : null, v));

  return jsxRuntimeExports.jsx(PsAdminDialog, { title: "Resept — " + editor.name, busy, onClose: () => setEditor(null), children: h("div", { className: "ps-recipe" },
    h("div", { className: "ps-recipe-facts" },
      fact("Satış", formatMoney(editor.priceMinor)),
      fact("Maya", formatMoney(cost)),
      fact("Qazanc", formatMoney(margin), margin < 0 ? "var(--ps-danger)" : "var(--ps-ok)"),
      fact("Maya %", pct)),
    editor.selfId && !editor.lines.length
      ? h("p", { className: "ps-recipe-note" }, "İndi bu məhsul anbarda hazır məhsul kimi izlənir: hər satışda anbardan 1 ədəd çıxır (kola, su kimi). Tərkib seçsəniz, satışda tərkibi anbardan çıxacaq.")
      : null,

    h("h3", { className: "ps-recipe-step" }, "1. Anbardan tərkibi seçin"),
    stock.length > 8 ? h("input", { type: "search", className: "ps-recipe-search", placeholder: "Axtar: pomidor, yumurta…", value: pickQuery, onChange: (e) => setPickQuery(e.target.value) }) : null,
    stock.length
      ? h("div", { className: "ps-recipe-chips" }, shown.map((ing) => h("button", {
          key: ing.id, type: "button", "aria-pressed": picked.has(ing.id),
          className: "ps-recipe-chip" + (picked.has(ing.id) ? " is-on" : ""),
          onClick: () => toggle(ing)
        }, (picked.has(ing.id) ? "✓ " : "+ ") + ing.name, h("small", null, label(ing.unit)))))
      : h("p", { className: "ps-recipe-note" }, "Anbarda hələ məhsul yoxdur. Anbar bölməsində əlavə edin və ya aşağıda yenisini yazın."),

    h("h3", { className: "ps-recipe-step" }, "2. Bir porsiyaya nə qədər gedir"),
    editor.lines.length
      ? h("div", { className: "ps-recipe-rows" }, editor.lines.map((line, i) => {
          const units = line.mode === "pick" ? psRecipeUnits(stockUnitOf(line)) : ["q", "kg", "ml", "l", "ədəd"];
          return h("div", { key: (line.ingredientId || "new") + i, className: "ps-recipe-row" },
            line.mode === "pick"
              ? h("span", { className: "ps-recipe-name" }, line.name)
              : h("input", { className: "ps-recipe-name-input", placeholder: "Ad (məs. Pomidor)", value: line.name, onChange: (e) => setLine(i, { name: e.target.value }) }),
            h("span", { className: "ps-recipe-qty" },
              h("input", { inputMode: "decimal", placeholder: line.unit === "q" || line.unit === "ml" ? "150" : "1", value: line.qty, onChange: (e) => setLine(i, { qty: e.target.value }), "aria-label": "Miqdar" }),
              units.length > 1
                ? h("select", { value: line.unit, onChange: (e) => setLine(i, { unit: e.target.value }), "aria-label": "Vahid" }, units.map((u) => h("option", { key: u, value: u }, label(u))))
                : h("em", null, label(units[0]))),
            h("label", { className: "ps-recipe-price" }, h("span", null, priceLabel(line.unit)),
              h("input", { inputMode: "decimal", placeholder: "0.00", value: line.unitCost, onChange: (e) => setLine(i, { unitCost: e.target.value }) })),
            h("b", { className: "ps-recipe-cost" }, formatMoney(lineCostMinor(line))),
            h("button", { type: "button", className: "ps-recipe-remove", "aria-label": "Sil", onClick: () => removeAt(i) }, "×"));
        }))
      : h("p", { className: "ps-recipe-note" }, "Yuxarıdan tərkibi seçin."),
    h("button", { type: "button", className: "ps-recipe-add", onClick: () => setEditor((prev) => prev ? { ...prev, lines: [...prev.lines, { mode: "new", ingredientId: "", name: "", unit: "q", qty: "", unitCost: "", unitCostMinor: 0 }] } : prev) }, "+ Anbarda olmayan məhsul"),

    h("div", { className: "ps-recipe-actions" },
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void saveRecipe(), children: "Saxla" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setEditor(null), children: "Bağla" })))
  });
}

function OpsCosting() {`,
    'recipe editor component');

  fs.writeFileSync(BUNDLE, s);
  console.log('recipe v2 applied');
} else {
  console.log('bundle already applied');
}

let css = fs.readFileSync(CSS, 'utf8');
if (!css.includes(MARK)) {
  css += `
${MARK}
.ps-recipe { display: grid; gap: 0.75rem; }
.ps-recipe-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; }
.ps-recipe-fact { padding: 0.6rem 0.75rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-recipe-fact span { display: block; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; }
.ps-recipe-fact b { font-size: 1.1rem; }
.ps-recipe-note { margin: 0; padding: 0.6rem 0.8rem; border-radius: 0.8rem; background: #f1f5f9; color: #475569; font-size: 0.85rem; }
.ps-recipe-step { margin: 0.4rem 0 0; font-size: 0.95rem; font-weight: 800; }
.ps-recipe-search { width: 100%; min-height: 2.6rem; padding: 0 0.8rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-recipe-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; max-height: 11rem; overflow: auto; }
.ps-recipe .ps-recipe-chip[aria-pressed] { display: inline-flex; align-items: baseline; gap: 0.35rem; min-height: 2.6rem; padding: 0 0.85rem !important; font-size: 0.9rem !important; color: #0f172a !important; border: 1px solid #cbd5e1 !important; border-radius: 999px !important; background: #fff !important; font-weight: 650; cursor: pointer; }
.ps-recipe-chip small { color: #94a3b8; font-weight: 600; }
.ps-recipe .ps-recipe-chip[aria-pressed].is-on { border-color: #2563eb !important; background: #eff6ff !important; color: #1d4ed8 !important; }
.ps-recipe-rows { display: grid; gap: 0.45rem; }
.ps-recipe-row { display: grid; grid-template-columns: minmax(6.5rem, 1.1fr) minmax(11rem, 1.2fr) minmax(7rem, 0.8fr) 4.5rem 2.5rem; align-items: center; gap: 0.5rem; padding: 0.5rem 0.6rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.8rem; }
.ps-recipe-name { font-weight: 700; }
.ps-recipe-name-input, .ps-recipe-qty input, .ps-recipe-qty select, .ps-recipe-price input { min-height: 2.5rem; padding: 0 0.6rem; border: 1px solid #cbd5e1 !important; border-radius: 0.6rem; background: #fff !important; min-width: 0; }
.ps-recipe-qty { display: flex; align-items: center; gap: 0.35rem; }
.ps-recipe-qty input { width: 100%; }
.ps-recipe-qty select { width: 4.6rem; flex: none; }
.ps-recipe-qty em { font-style: normal; color: #475569; font-weight: 650; }
.ps-recipe-price { display: grid; gap: 0.15rem; }
.ps-recipe-price span { font-size: 0.66rem; color: #64748b; }
.ps-recipe-cost { text-align: right; }
.ps-recipe-remove { width: 2.4rem; height: 2.4rem; border: 1px solid #fecaca !important; border-radius: 0.6rem; background: #fff !important; color: #b91c1c; font-size: 1.2rem; }
.ps-recipe-add { justify-self: start; padding: 0.5rem 0.9rem; border: 1px dashed #94a3b8 !important; border-radius: 0.7rem; background: transparent !important; font-weight: 650; }
.ps-recipe-actions { display: flex; gap: 0.5rem; padding-top: 0.25rem; }
@media (max-width: 720px) {
  .ps-recipe-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ps-recipe-row { grid-template-columns: 1fr 1fr; }
  .ps-recipe-row .ps-recipe-name, .ps-recipe-row .ps-recipe-name-input { grid-column: 1 / -1; }
}
`;
  fs.writeFileSync(CSS, css);
}
