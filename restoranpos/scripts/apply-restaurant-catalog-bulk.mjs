#!/usr/bin/env node
/**
 * Kataloq: pick several products and delete them at once.
 *
 * Each row gets a checkbox (in the drag column, so the grid is unchanged) and
 * the toolbar a "Select all · N selected · Delete selected" bar. Deleting is
 * the existing per-product archive (soft delete, one audit row each) run over
 * the selection, then one reload - no new core method.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_CATALOG_BULK_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  // State and the bulk action, next to the single-product delete.
  s = replaceOnce(
    s,
    `  const removeProduct = async (id) => {
    if (!await confirm(t.catalog.confirmDeleteProduct, { danger: true })) return;`,
    `  ${MARK}
  const [bulkIds, setBulkIds] = reactExports.useState([]);
  reactExports.useEffect(() => { setBulkIds([]); }, [categoryId]);
  const toggleBulk = (id) => setBulkIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const removeSelected = async () => {
    const ids = bulkIds.filter((id) => products2.some((p) => p.id === id));
    if (!ids.length) return;
    if (!await confirm(psAdminText(ids.length + " məhsul silinsin?", ids.length + " ürün silinsin mi?", "Delete " + ids.length + " products?"), { danger: true })) return;
    setSaving(true);
    let failed = 0;
    for (const id of ids) {
      const res = await window.pos.catalogAdmin.archiveProduct(id);
      if (!res.success) failed += 1;
    }
    setSaving(false);
    setBulkIds([]);
    if (editId && ids.includes(editId)) {
      setEditorOpen(false);
      setEditId(null);
    }
    toast(
      failed
        ? psAdminText((ids.length - failed) + " silindi, " + failed + " silinmədi", (ids.length - failed) + " silindi, " + failed + " silinemedi", (ids.length - failed) + " deleted, " + failed + " failed")
        : psAdminText(ids.length + " məhsul silindi", ids.length + " ürün silindi", ids.length + " products deleted"),
      failed ? "danger" : "success"
    );
    await loadProducts(categoryId);
  };
  const removeProduct = async (id) => {
    if (!await confirm(t.catalog.confirmDeleteProduct, { danger: true })) return;`,
    'bulk state',
  );

  // The bar under the toolbar.
  s = replaceOnce(
    s,
    `          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); }, children: "+ " + t.catalog.newProduct })
        ] }),
`,
    `          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-new-btn", onClick: () => { setShowLocales(false); startCreate(); }, children: "+ " + t.catalog.newProduct })
        ] }),
        visibleProducts.length > 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-bulk", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "ps-catalog-bulk-all", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", checked: visibleProducts.every((p) => bulkIds.includes(p.id)), onChange: (e) => setBulkIds(e.target.checked ? visibleProducts.map((p) => p.id) : []) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: psAdminText("Hamısını seç", "Tümünü seç", "Select all") })
          ] }),
          bulkIds.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-catalog-bulk-count", children: bulkIds.length + psAdminText(" seçildi", " seçildi", " selected") }) : null,
          bulkIds.length ? /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-bulk-delete", disabled: saving, onClick: () => void removeSelected(), children: psAdminText("Seçilənləri sil", "Seçilenleri sil", "Delete selected") }) : null
        ] }) : null,
`,
    'bulk bar',
  );

  // A checkbox per row, at the top of the drag column.
  s = replaceOnce(
    s,
    `            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-ord", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-catalog-drag", "aria-hidden": "true", children: "⋮⋮" }),`,
    `            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-ord", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", className: "ps-catalog-check", checked: bulkIds.includes(product.id), onChange: () => toggleBulk(product.id), onClick: (e) => e.stopPropagation(), "aria-label": psAdminText("Seç", "Seç", "Select") }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-catalog-drag", "aria-hidden": "true", children: "⋮⋮" }),`,
    'row checkbox',
  );
  s = replaceOnce(
    s,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row" + (dragId === product.id ? " is-drag" : ""),`,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row" + (dragId === product.id ? " is-drag" : "") + (bulkIds.includes(product.id) ? " is-picked" : ""),`,
    'row highlight',
  );
  fs.writeFileSync(BUNDLE, s);
  console.log('catalog bulk delete applied');
} else {
  console.log('bundle already applied');
}

let css = fs.readFileSync(CSS, 'utf8');
if (!css.includes(MARK)) {
  css += `
${MARK}
.ps-catalog-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; margin: 0.25rem 0 0.75rem; padding: 0.55rem 0.9rem; border: 1px solid var(--ps-line, #e2e8f0); border-radius: 0.9rem; background: var(--ps-surface, #fff); }
.ps-catalog-bulk-all { display: inline-flex; align-items: center; gap: 0.55rem; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
.ps-catalog-bulk-all input, .ps-catalog-check { width: 1.15rem; height: 1.15rem; accent-color: #2563eb; cursor: pointer; }
.ps-catalog-bulk-count { font-size: 0.9rem; color: #475569; }
.ps-catalog-bulk-delete { margin-left: auto; min-height: 2.5rem; padding: 0 1rem; border: 1px solid #fca5a5; border-radius: 0.75rem; background: #fef2f2; color: #b91c1c; font-weight: 700; }
.ps-catalog-bulk-delete:disabled { opacity: 0.5; }
.ps-catalog-row.is-picked { background: #eff6ff; }
`;
  fs.writeFileSync(CSS, css);
}
