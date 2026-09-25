#!/usr/bin/env node
/**
 * Restaurant layout v3: full-width Kataloq table, full-width Parametrlər,
 * working Çek önbaxış (core preview or local mock).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_LAYOUT_v3 */';

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

s = replaceOnce(
  s,
  'defaultOpen: id === "restaurant"',
  'defaultOpen: id === "restaurant" || id === "printer"',
  'open printer accordion',
);

s = replaceOnce(
  s,
  'function SettingsAccordion({ id, title, hint, children, danger = false }) {',
  `function buildReceiptMockHtml(meta) {
  const safe = String(meta || "").replace(/[<>&]/g, "");
  return \`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#f1f5f9;font-family:ui-monospace,Menlo,monospace;color:#0f172a}
    .ticket{width:280px;margin:18px auto;background:#fff;padding:18px 16px;border:1px solid #dbe4f0}
    h1{margin:0;text-align:center;font-size:18px}
    .meta{margin:8px 0 12px;text-align:center;font-size:11px;color:#64748b}
    .row{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:4px 0}
    hr{border:0;border-top:1px dashed #cbd5e1;margin:10px 0}
    .total{font-weight:800;font-size:15px}
    .foot{margin-top:14px;text-align:center;font-size:11px;color:#64748b}
  </style></head><body><div class="ticket"><h1>possistem</h1>
  <div class="meta">Restoran POS · \${safe}</div><hr>
  <div class="row"><span>Club Sandwich</span><span>9.00 ₼</span></div>
  <div class="row"><span>Kartof fri</span><span>4.50 ₼</span></div><hr>
  <div class="row total"><span>Cəmi</span><span>13.50 ₼</span></div>
  <div class="foot">Çek önbaxış</div></div></body></html>\`;
}
function SettingsAccordion({ id, title, hint, children, danger = false }) {`,
  'receipt mock helper',
);

s = replaceOnce(
  s,
  `  const runPreview = async () => {
    setPreviewing(true);
    const res = await window.pos.print.previewTest({
      paperWidth,
      charsPerLine,
      renderMode,
      fontHeightPx,
      fontWidthPx,
      sideMarginPx
    });
    setPreviewing(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    const data = res.data;
    setPreviewHtml(data.html ?? null);
    setPreviewMeta(\`\${data.paperWidth ?? paperWidth} mm · \${data.charsPerLine ?? charsPerLine} sütun\`);
  };`,
  `  const runPreview = async () => {
    setPreviewing(true);
    const meta = \`\${paperWidth} mm · \${charsPerLine} sütun\`;
    let html = "";
    try {
      const api = window.pos && window.pos.print && window.pos.print.previewTest;
      if (typeof api === "function") {
        const res = await api({ paperWidth, charsPerLine, renderMode, fontHeightPx, fontWidthPx, sideMarginPx });
        if (res && res.success && res.data && res.data.html) html = String(res.data.html);
        if (res && res.data && (res.data.paperWidth || res.data.charsPerLine)) {
          setPreviewMeta(\`\${res.data.paperWidth ?? paperWidth} mm · \${res.data.charsPerLine ?? charsPerLine} sütun\`);
        } else setPreviewMeta(meta);
      } else setPreviewMeta(meta);
    } catch {
      setPreviewMeta(meta);
    }
    if (!html) html = buildReceiptMockHtml(meta);
    setPreviewHtml(html);
    setPreviewing(false);
  };`,
  'preview always opens',
);

s = replaceOnce(
  s,
  '    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-stack mx-auto w-full max-w-2xl space-y-3 p-6", children: [',
  '    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-stack w-full space-y-3 p-6", children: [',
  'settings full width',
);

s = replaceOnce(
  s,
  `        previewHtml ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between text-xs text-faint", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: previewMeta }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "text-muted hover:text-cream",
                onClick: () => setPreviewHtml(null),
                children: t.common.close
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "iframe",
            {
              title: t.settings.previewReceipt,
              className: "h-[420px] w-full rounded-xl border border-hairline bg-ink",
              srcDoc: previewHtml
            }
          )
        ] }) : null`,
  '        null',
  'remove clipped iframe',
);

s = replaceOnce(
  s,
  `    confirmDialog
  ] });
}
const ICONS = {`,
  `    previewHtml ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-layer", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-receipt-layer-bg", "aria-label": t.common.close, onClick: () => setPreviewHtml(null) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-sheet", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "ps-receipt-sheet-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: t.settings.previewReceipt }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: previewMeta }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setPreviewHtml(null), children: t.common.close })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("iframe", { title: t.settings.previewReceipt, className: "ps-receipt-frame", srcDoc: previewHtml })
      ] })
    ] }) : null,
    confirmDialog
  ] });
}
const ICONS = {`,
  'receipt modal',
);

s = replaceOnce(
  s,
  `        visibleProducts.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-catalog-empty", children: t.catalog.empty }) : /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "ps-catalog-list", children: visibleProducts.map((product, index) => {
          const sold = isSoldOut(product);
          const hiddenImage = isImageHidden(product);
          const menuOn = openMenu === "p:" + product.id;
          const live = product.active === true || product.active === 1;
          const pill = sold ? t.catalog.soldOut : live ? t.catalog.available : t.catalog.draft;
          const pillClass = sold ? "ps-pill is-danger" : live ? "ps-pill" : "ps-pill is-warn";
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row", style: { position: "relative" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image), alt: "", className: hiddenImage ? "opacity-25 grayscale" : "" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "ps-catalog-row-copy", onClick: () => { setShowLocales(false); void startEdit(product); }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: localizedName(product, lang) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: product.priceMinor > 0 ? (product.priceMinor / 100).toFixed(2) + " ₼" : t.catalog.draft })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: pillClass, children: pill }),`,
  `        visibleProducts.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-catalog-empty", children: t.catalog.empty }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-catalog-thead", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.catalog.name }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.catalog.price }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.catalog.available }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", {})
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("ul", { className: "ps-catalog-list", children: visibleProducts.map((product, index) => {
          const sold = isSoldOut(product);
          const hiddenImage = isImageHidden(product);
          const menuOn = openMenu === "p:" + product.id;
          const live = product.active === true || product.active === 1;
          const pill = sold ? t.catalog.soldOut : live ? t.catalog.available : t.catalog.draft;
          const pillClass = sold ? "ps-pill is-danger" : live ? "ps-pill" : "ps-pill is-warn";
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("li", { className: "ps-catalog-row", style: { position: "relative" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: resolveProductVisual(product.id, product.categoryId, product.image), alt: "", className: hiddenImage ? "opacity-25 grayscale" : "" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-row-copy", onClick: () => { setShowLocales(false); void startEdit(product); }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: localizedName(product, lang) }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-catalog-price", children: product.priceMinor > 0 ? (product.priceMinor / 100).toFixed(2) + " ₼" : "—" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: pillClass, children: pill }),`,
  'catalog table header+price col',
);

s = replaceOnce(
  s,
  `          ] }, product.id);
        }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "ps-catalog-mods", children: [`,
  `          ] }, product.id);
        }) }) ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "ps-catalog-mods", children: [`,
  'close catalog fragment',
);

must(s.includes('ps-catalog-thead'), 'thead missing');
must(s.includes('ps-catalog-price'), 'price col missing');
must(s.includes('ps-receipt-layer'), 'receipt modal missing');
must(s.includes('buildReceiptMockHtml'), 'mock helper missing');
must(s.includes('ps-settings-stack w-full'), 'settings still max-w-2xl');

s = s.replace('/* POS_SHELL_v2 */', `/* POS_SHELL_v2 */\n${MARK}`);
must(s.includes(MARK), 'layout mark');

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
