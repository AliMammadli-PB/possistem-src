#!/usr/bin/env node
/**
 * Restaurant "Çek önizləməsi" uses the same paper modal as printer
 * "Çek önbaxış" — cream sheet + ticket, not a dark iframe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
if (fs.readFileSync(BUNDLE, 'utf8').includes('POS_TOUCH_RECEIPT_v1')) {
  await import('./apply-restaurant-touch-receipt.mjs');
  console.log('Native receipt preview already applied');
  process.exit(0);
}
const MARK = '/* POS_SETTINGS_RECEIPT_MODAL_v1 */';

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
  console.log('bundle already applied');
  process.exit(0);
}

s = replaceOnce(
  s,
  `/* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => previewHtml === null ? void refreshPreview() : setPreviewHtml(null), className: "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:text-cream", children: previewHtml === null ? "Çek önizləməsi" : "Önizləməni bağla" })
    ] }),
    previewHtml !== null ? /* @__PURE__ */ jsxRuntimeExports.jsx("iframe", { title: "cek-onizleme", sandbox: "allow-same-origin", srcDoc: previewHtml, className: "receipt-preview-frame" }) : null`,
  `/* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setPreviewHtml(previewHtml ? null : "paper"), className: "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:text-cream", children: previewHtml ? t.common.close : t.settings.previewReceipt })
    ] }),
    ${MARK}
    previewHtml ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-layer", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-receipt-layer-bg", "aria-label": t.common.close, onClick: () => setPreviewHtml(null) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-sheet", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "ps-receipt-sheet-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: t.settings.previewReceipt }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "80 mm · 40 sütun" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setPreviewHtml(null), children: t.common.close })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-frame", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: draft["restaurant.name"] || "Nümunə restoran" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ps-receipt-ticket-meta", children: [
              draft["restaurant.tagline"] || "80 mm · 40 sütun",
              /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
              "Masa 12 · Nümunə çek"
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Club Sandwich" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "9.00 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Kartof fri" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "4.50 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Çay" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "2.00 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row is-total", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Cəmi" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "15.50 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-foot", children: "Çek önbaxış · kağız nümunə" })
          ] })
        ] })
      ] })
    ] }) : null`,
  'restaurant receipt modal',
);

must(s.includes(MARK), 'receipt modal mark missing');
must(s.includes('ps-receipt-ticket'), 'ticket missing');
must(!s.includes('className: "receipt-preview-frame"'), 'old iframe still present');
fs.writeFileSync(BUNDLE, s);
console.log('patched restaurant receipt modal');
