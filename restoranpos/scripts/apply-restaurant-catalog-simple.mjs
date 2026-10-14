#!/usr/bin/env node
/**
 * Catalog, made simpler after customer feedback:
 *  - the dish editor's Printer list shows the names the venue gave its
 *    printers ("Kababçı (əsas mətbəx)"), not a bare "Mətbəx", and shows the
 *    dish's current printer even when the printer list arrives after the dish;
 *  - a picture can be picked from the till's own picture catalogue
 *    ("Kataloqdan"), not only from a file. Stored as "builtin:<name>", so it
 *    survives updates (asset file names carry a build hash);
 *  - product rows lose the ↑/↓ buttons (still in the ⋮ menu): checkbox and
 *    drag handle side by side.
 * Runs after apply-restaurant-kitchen-stations.mjs and apply-restaurant-catalog-bulk.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_CATALOG_SIMPLE_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  // Built-in pictures by name.
  s = replaceOnce(
    s,
    `function resolveProductVisual(productId, categoryId, customImage) {
  return customImage || products.get(productId)`,
    `${MARK}
function psBuiltinVisual(value) {
  if (typeof value !== "string" || !value.startsWith("builtin:")) return null;
  const key = value.slice(8);
  return products.get(key) || categories.get(key) || "";
}
function psBuiltinVisualKeys() {
  return [...products.keys(), ...categories.keys()];
}
function resolveProductVisual(productId, categoryId, customImage) {
  const builtin = psBuiltinVisual(customImage);
  if (builtin !== null) customImage = builtin;
  return customImage || products.get(productId)`,
    'resolveProductVisual',
  );

  // Editor state: gallery toggle, and the dish's printer once the list has loaded.
  s = replaceOnce(
    s,
    `  const pickProductImage = async () => {`,
    `  const [showGallery, setShowGallery] = reactExports.useState(false);
  reactExports.useEffect(() => { if (!editorOpen) setShowGallery(false); }, [editorOpen]);
  reactExports.useEffect(() => {
    if (editId) setPrinterStation((psExtraKitchenPrinters(kitchenPrinters).find((p) => (p.itemIds || []).includes(editId)) || {}).id || "");
  }, [kitchenPrinters, editId]);
  const mainKitchenName = (kitchenPrinters.find((p) => psPrinterKind(p) === "kitchen" && psIsMainKitchen(p)) || {}).name || "";
  const pickProductImage = async () => {`,
    'editor state',
  );

  // Two picture buttons: from the catalogue, from a file.
  s = replaceOnce(
    s,
    `              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void pickProductImage(), className: "touch-target mt-2 w-full rounded-xl border border-hairline px-2 py-2 text-xs", children: "Şəkil seç" })
            ] }),`,
    `              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => setShowGallery((v) => !v), className: "touch-target mt-2 w-full rounded-xl border border-hairline px-2 py-2 text-xs" + (showGallery ? " ps-gallery-on" : ""), children: "Kataloqdan" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving, onClick: () => void pickProductImage(), className: "touch-target mt-1 w-full rounded-xl border border-hairline px-2 py-2 text-xs", children: "Kompüterdən" })
            ] }),`,
    'picture buttons',
  );
  s = replaceOnce(
    s,
    `          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-3 rounded-xl border border-hairline px-3 py-2 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", checked: published, onChange: (e) => setPublished(e.target.checked), className: "h-4 w-4" }),`,
    `          showGallery ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-gallery", role: "listbox", "aria-label": "Şəkil kataloqu", children: psBuiltinVisualKeys().map((key) => /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", role: "option", "aria-selected": imageUrl === "builtin:" + key, className: "ps-gallery-item" + (imageUrl === "builtin:" + key ? " is-on" : ""), onClick: () => { setImageUrl("builtin:" + key); setShowGallery(false); }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: psBuiltinVisual("builtin:" + key), alt: "", loading: "lazy" }) }, key)) }) : null,
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-3 rounded-xl border border-hairline px-3 py-2 text-sm", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", checked: published, onChange: (e) => setPublished(e.target.checked), className: "h-4 w-4" }),`,
    'gallery grid',
  );

  // Printer list with the venue's own names.
  s = replaceOnce(
    s,
    `"Printer — mətbəxə göndəriləndə haradan çıxsın" }),`,
    `"Hansı printerdən çıxsın" }),`,
    'printer label',
  );
  s = replaceOnce(
    s,
    `jsxRuntimeExports.jsx("option", { value: "", children: "Mətbəx (əsas)" }),`,
    `jsxRuntimeExports.jsx("option", { value: "", children: mainKitchenName ? mainKitchenName + " (əsas mətbəx)" : "Mətbəx (əsas)" }),`,
    'main kitchen option',
  );

  // Rows: no ↑/↓ (they stay in the ⋮ menu).
  s = replaceOnce(
    s,
    `              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-shift", disabled: saving || products2.findIndex((row) => row.id === product.id) === 0, onClick: (e) => { e.stopPropagation(); void moveProduct(product.id, -1); }, "aria-label": t.catalog.moveUp, children: "↑" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-shift", disabled: saving || products2.findIndex((row) => row.id === product.id) === products2.length - 1, onClick: (e) => { e.stopPropagation(); void moveProduct(product.id, 1); }, "aria-label": t.catalog.moveDown, children: "↓" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image)`,
    `            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image)`,
    'row arrows',
  );
  fs.writeFileSync(BUNDLE, s);
  console.log('catalog simplified');
} else {
  console.log('bundle already applied');
}

let css = fs.readFileSync(CSS, 'utf8');
if (!css.includes(MARK)) {
  css += `
${MARK}
.ps-catalog-list .ps-catalog-ord { flex-direction: row; gap: 0.45rem; }
.ps-admin-workspace[data-page="/admin/catalog"] .ps-catalog-row { min-height: 72px; }
.ps-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr)); gap: 0.4rem; max-height: 15rem; overflow: auto; padding: 0.4rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.9rem; }
.ps-gallery-item { aspect-ratio: 1; padding: 0; border: 2px solid transparent; border-radius: 0.6rem; overflow: hidden; background: #f1f5f9; cursor: pointer; }
.ps-gallery-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-gallery-item.is-on, .ps-gallery-item:hover { border-color: #2563eb; }
.ps-gallery-on { border-color: #2563eb !important; color: #2563eb; }
`;
  fs.writeFileSync(CSS, css);
}
