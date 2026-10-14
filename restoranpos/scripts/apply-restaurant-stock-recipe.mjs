#!/usr/bin/env node
/**
 * Anbar → Kalkulyasiya, the way an owner does it: create "Nar, 1 kg" in the
 * warehouse, then write the recipe of "Nar qovurması" from those items.
 *
 *  - Anbar "Yeni məhsul" takes the quantity on hand too (posted as a
 *    "Başlanğıc qalıq" adjustment), so a new item no longer starts as "Bitib";
 *  - Kalkulyasiya lists draft dishes as well (the core now returns them with
 *    active=false): they come first and carry a "Qaralama" tag, so a dish just
 *    added in the catalog can be costed straight away.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_STOCK_RECIPE_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

// Anbar: quantity on hand in the new-item dialog.
s = replaceOnce(s,
  `onClick: () => setDrawer({ name: "", unit: "kg", cost: "", minQty: "" }), children: "+ Yeni məhsul" })`,
  `onClick: () => setDrawer({ name: "", unit: "kg", cost: "", minQty: "", qty: "" }), children: "+ Yeni məhsul" })`,
  'drawer init');
s = replaceOnce(s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: drawer.name, onChange: (v) => setDrawer({ ...drawer, name: v }) }),`,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid gap-2 sm:grid-cols-5", children: [
        ${MARK}
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: drawer.name, onChange: (v) => setDrawer({ ...drawer, name: v }), placeholder: "məs. Nar" }),`,
  'drawer grid');
s = replaceOnce(s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Minimum", value: drawer.minQty, onChange: (v) => setDrawer({ ...drawer, minQty: v }), placeholder: "0" })
      ] }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Anbarda var (" + drawer.unit + ")", value: drawer.qty ?? "", onChange: (v) => setDrawer({ ...drawer, qty: v }), placeholder: "məs. 1" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(OpsField, { label: "Minimum", value: drawer.minQty, onChange: (v) => setDrawer({ ...drawer, minQty: v }), placeholder: "0" })
      ] }),`,
  'drawer quantity field');
s = replaceOnce(s,
  `            if (!psStockInputValid(drawer.cost, {empty: true}) || !psStockInputValid(drawer.minQty, {empty: true})) {`,
  `            if (!psStockInputValid(drawer.cost, {empty: true}) || !psStockInputValid(drawer.minQty, {empty: true}) || !psStockInputValid(drawer.qty ?? "", {empty: true})) {`,
  'drawer validation');
s = replaceOnce(s,
  `            void run(window.pos.inventory.saveIngredient({
              name: drawer.name.trim(),
              unit: drawer.unit,
              costMinor: opsMinor(drawer.cost),
              minQtyMilli: opsMilli(drawer.minQty)
            }), "Məhsul əlavə olundu").then((ok) => { if (ok) setDrawer(null); });`,
  `            const startMilli = opsMilli(drawer.qty || "0");
            void run((async () => {
              const created = await window.pos.inventory.saveIngredient({
                name: drawer.name.trim(),
                unit: drawer.unit,
                costMinor: opsMinor(drawer.cost),
                minQtyMilli: opsMilli(drawer.minQty)
              });
              const newId = created.success ? (created.data?.id || created.data?.ingredient?.id) : null;
              if (!newId || !(startMilli > 0)) return created;
              return window.pos.inventory.adjust({ ingredientId: newId, warehouseId, qtyDeltaMilli: startMilli, reason: "Başlanğıc qalıq" });
            })(), "Məhsul əlavə olundu").then((ok) => { if (ok) setDrawer(null); });`,
  'drawer save with quantity');

// Kalkulyasiya: drafts first, tagged.
s = replaceOnce(s,
  `    .sort((a, b) => {
      if (sort === "worst") return (b.foodCostBp ?? 0) - (a.foodCostBp ?? 0);`,
  `    .sort((a, b) => {
      const draftFirst = Number(b.active === false) - Number(a.active === false);
      if (draftFirst) return draftFirst;
      if (sort === "worst") return (b.foodCostBp ?? 0) - (a.foodCostBp ?? 0);`,
  'costing drafts first');
s = replaceOnce(s,
  `        return [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-cream", children: row.name }),
          row.category ?? "—",`,
  `        return [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "font-medium text-cream", children: [row.name, row.active === false ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", style: { background: "#fdf4e3", color: "#a16207" }, children: "Qaralama" }) : null] }),
          row.category ?? "—",`,
  'costing draft tag');

fs.writeFileSync(BUNDLE, s);
console.log('stock and recipe flow applied');
