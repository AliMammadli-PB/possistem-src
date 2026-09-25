#!/usr/bin/env node
/**
 * Kataloq spacing + persistable product/category reorder (drag + up/down).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK_V4 = '/* POS_CATALOG_v4 */';
const MARK = '/* POS_CATALOG_v5 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('already applied');
  process.exit(0);
}

const needsV4 = !s.includes(MARK_V4);
if (needsV4) {
s = replaceOnce(
  s,
  '  const [openMenu, setOpenMenu] = reactExports.useState(null);',
  '  const [openMenu, setOpenMenu] = reactExports.useState(null);\n  const [dragId, setDragId] = reactExports.useState(null);',
  'dragId state',
);

s = replaceOnce(
  s,
  `  const moveProduct = async (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= products2.length || saving) return;
    const current = products2[index];
    const target = products2[targetIndex];
    if (!current || !target) return;
    const currentOrder = current.sortOrder ?? index + 1;
    const targetOrder = target.sortOrder ?? targetIndex + 1;
    setSaving(true);
    const first = await window.pos.catalogAdmin.upsertProduct(
      {
        id: current.id,
        categoryId: current.categoryId,
        nameAz: current.nameAz,
        sortOrder: targetOrder
      },
      { idempotencyKey: newIdempotencyKey() }
    );
    if (!first.success) {
      setSaving(false);
      toast(first.error.message, "danger");
      return;
    }
    const second = await window.pos.catalogAdmin.upsertProduct(
      {
        id: target.id,
        categoryId: target.categoryId,
        nameAz: target.nameAz,
        sortOrder: currentOrder
      },
      { idempotencyKey: newIdempotencyKey() }
    );
    setSaving(false);
    if (!second.success) {
      toast(second.error.message, "danger");
      await loadProducts(categoryId);
      return;
    }
    await loadProducts(categoryId);
  };`,
  `  const persistListOrder = async (list) => {
    setSaving(true);
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const next = i + 1;
      const res = await window.pos.catalogAdmin.upsertProduct(
        {
          id: row.id,
          categoryId: row.categoryId,
          nameAz: row.nameAz,
          sortOrder: next
        },
        { idempotencyKey: newIdempotencyKey() }
      );
      if (!res.success) {
        setSaving(false);
        toast(res.error.message, "danger");
        await loadProducts(categoryId);
        return false;
      }
    }
    setSaving(false);
    await loadProducts(categoryId);
    return true;
  };
  const persistCategoryList = async (list) => {
    setSaving(true);
    for (let i = 0; i < list.length; i++) {
      const res = await window.pos.catalogAdmin.upsertCategory(
        categoryPayload(list[i], i + 1),
        { idempotencyKey: newIdempotencyKey() }
      );
      if (!res.success) {
        setSaving(false);
        toast(res.error.message, "danger");
        await loadCategories();
        return false;
      }
    }
    setSaving(false);
    await loadCategories();
    return true;
  };
  const moveProduct = async (id, direction) => {
    const index = products2.findIndex((row) => row.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= products2.length || saving) return;
    const list = products2.slice();
    const [row] = list.splice(index, 1);
    list.splice(targetIndex, 0, row);
    setProducts(list.map((item, i) => ({ ...item, sortOrder: i + 1 })));
    await persistListOrder(list);
  };
  const dropProduct = async (fromId, toId) => {
    setDragId(null);
    if (!fromId || !toId || fromId === toId || saving) return;
    const from = products2.findIndex((row) => row.id === fromId);
    const to = products2.findIndex((row) => row.id === toId);
    if (from < 0 || to < 0) return;
    const list = products2.slice();
    const [row] = list.splice(from, 1);
    list.splice(to, 0, row);
    setProducts(list.map((item, i) => ({ ...item, sortOrder: i + 1 })));
    await persistListOrder(list);
  };
  const dropCategory = async (fromId, toId) => {
    setDragId(null);
    if (!fromId || !toId || fromId === toId || saving) return;
    const from = categories2.findIndex((row) => row.id === fromId);
    const to = categories2.findIndex((row) => row.id === toId);
    if (from < 0 || to < 0) return;
    const list = categories2.slice();
    const [row] = list.splice(from, 1);
    list.splice(to, 0, row);
    setCategories(list.map((item, i) => ({ ...item, sortOrder: i + 1 })));
    await persistCategoryList(list);
  };`,
  'persist drag/id reorder',
);

s = replaceOnce(
  s,
  `          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-cat" + (selected ? " is-on" : ""), style: { position: "relative" }, children: [`,
  `          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-cat" + (selected ? " is-on" : "") + (dragId === cat.id ? " is-drag" : ""), draggable: true, onDragStart: (e) => { setDragId(cat.id); e.dataTransfer.setData("text/plain", cat.id); e.dataTransfer.effectAllowed = "move"; }, onDragOver: (e) => { e.preventDefault(); }, onDrop: (e) => { e.preventDefault(); void dropCategory(e.dataTransfer.getData("text/plain"), cat.id); }, style: { position: "relative" }, children: [`,
  'category drag',
);

s = replaceOnce(
  s,
        `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-thead", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.catalog.name }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-thead", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.catalog.name }),`,
  'thead handle col',
);

s = replaceOnce(
  s,
  `          return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row", style: { position: "relative" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image), alt: "", className: hiddenImage ? "opacity-25 grayscale" : "" }),`,
  `          return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row" + (dragId === product.id ? " is-drag" : ""), draggable: !productQuery.trim(), onDragStart: (e) => { setDragId(product.id); e.dataTransfer.setData("text/plain", product.id); e.dataTransfer.effectAllowed = "move"; }, onDragOver: (e) => { e.preventDefault(); }, onDrop: (e) => { e.preventDefault(); void dropProduct(e.dataTransfer.getData("text/plain"), product.id); }, style: { position: "relative" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-ord", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-catalog-drag", "aria-hidden": "true", children: "⋮⋮" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-shift", disabled: saving || products2.findIndex((row) => row.id === product.id) === 0, onClick: (e) => { e.stopPropagation(); void moveProduct(product.id, -1); }, "aria-label": t.catalog.moveUp, children: "↑" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-shift", disabled: saving || products2.findIndex((row) => row.id === product.id) === products2.length - 1, onClick: (e) => { e.stopPropagation(); void moveProduct(product.id, 1); }, "aria-label": t.catalog.moveDown, children: "↓" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image), alt: "", className: hiddenImage ? "opacity-25 grayscale" : "" }),`,
  'product drag+shift',
);

s = replaceOnce(
  s,
  `              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || index === 0, onClick: () => { setOpenMenu(null); void moveProduct(index, -1); }, children: t.catalog.moveUp }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || index === visibleProducts.length - 1, onClick: () => { setOpenMenu(null); void moveProduct(index, 1); }, children: t.catalog.moveDown }),`,
  `              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || products2.findIndex((row) => row.id === product.id) === 0, onClick: () => { setOpenMenu(null); void moveProduct(product.id, -1); }, children: t.catalog.moveUp }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: saving || products2.findIndex((row) => row.id === product.id) === products2.length - 1, onClick: () => { setOpenMenu(null); void moveProduct(product.id, 1); }, children: t.catalog.moveDown }),`,
  'kebab uses product id',
);
}

if (!needsV4) {
  if (s.includes('(row.sortOrder ?? next) === next')) {
    s = replaceOnce(
      s,
      `      if ((row.sortOrder ?? next) === next) continue;
      const res = await window.pos.catalogAdmin.upsertProduct(`,
      `      const res = await window.pos.catalogAdmin.upsertProduct(`,
      'always persist product sortOrder',
    );
  }
  if (!s.includes('persistCategoryList')) {
    s = replaceOnce(
      s,
      `    await loadProducts(categoryId);
    return true;
  };
  const moveProduct = async (id, direction) => {`,
      `    await loadProducts(categoryId);
    return true;
  };
  const persistCategoryList = async (list) => {
    setSaving(true);
    for (let i = 0; i < list.length; i++) {
      const res = await window.pos.catalogAdmin.upsertCategory(
        categoryPayload(list[i], i + 1),
        { idempotencyKey: newIdempotencyKey() }
      );
      if (!res.success) {
        setSaving(false);
        toast(res.error.message, "danger");
        await loadCategories();
        return false;
      }
    }
    setSaving(false);
    await loadCategories();
    return true;
  };
  const moveProduct = async (id, direction) => {`,
      'persistCategoryList',
    );
  }
  if (s.includes('await moveCategory(from, to - from)')) {
    s = replaceOnce(
      s,
      `    if (from < 0 || to < 0) return;
    await moveCategory(from, to - from);
  };`,
      `    if (from < 0 || to < 0) return;
    const list = categories2.slice();
    const [row] = list.splice(from, 1);
    list.splice(to, 0, row);
    setCategories(list.map((item, i) => ({ ...item, sortOrder: i + 1 })));
    await persistCategoryList(list);
  };`,
      'category drop splice',
    );
  }
}

must(s.includes('dropProduct'), 'dropProduct missing');
must(s.includes('ps-catalog-ord'), 'ord column missing');
must(s.includes('void moveProduct(product.id, -1)'), 'id-based move missing');
must(s.includes('persistCategoryList'), 'category persist missing');
must(!s.includes('void moveProduct(index, -1)'), 'index move remains');
must(!s.includes('(row.sortOrder ?? next) === next'), 'stale sortOrder skip remains');

if (!s.includes(MARK_V4)) {
  s = s.replace('/* POS_OPS_v1b */', `/* POS_OPS_v1b */\n${MARK_V4}`);
  if (!s.includes(MARK_V4)) s = s.replace('/* POS_LAYOUT_v3 */', `/* POS_LAYOUT_v3 */\n${MARK_V4}`);
}
s = s.replace(MARK_V4, `${MARK_V4}\n${MARK}`);
if (!s.includes(MARK)) s = s.replace('/* POS_OPS_v1b */', `/* POS_OPS_v1b */\n${MARK}`);
must(s.includes(MARK), 'catalog mark');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
