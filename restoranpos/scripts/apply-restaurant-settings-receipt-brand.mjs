#!/usr/bin/env node
/**
 * Çek önbaxış shows the venue's logo, header fields and QR — same paper
 * modal, not a dark iframe, and not a blank sample ticket.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const QR_LIB = path.join(ROOT, 'scripts/lib/ps-qr.mjs');
if (fs.readFileSync(BUNDLE, 'utf8').includes('POS_TOUCH_RECEIPT_v1')) {
  await import('./apply-restaurant-touch-receipt.mjs');
  console.log('Native receipt preview already applied');
  process.exit(0);
}
const MARK = '/* POS_SETTINGS_RECEIPT_BRAND_v1 */';
const CSS_MARK = '/* POS_SETTINGS_RECEIPT_BRAND_CSS_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const qrLib = fs.readFileSync(QR_LIB, 'utf8')
  .replaceAll('export function ', 'function ')
  .replace(/export \{[^}]+\};\n?/g, '');

const HELPERS = `
${MARK}
const psQrDataUrl = (() => {
${qrLib}
return psQrDataUrl;
})();
function psPreviewQrText(brand) {
  if (!brand || !brand.qrOn) return "";
  const url = String(brand.qrUrl || "").trim();
  if (url) return url;
  const phone = String(brand.phone || "").replace(/\\D/g, "");
  return phone ? "https://wa.me/" + phone : "";
}
function psReceiptMeta(text) {
  const v = String(text || "").trim();
  if (!v) return null;
  return jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-meta", children: v });
}
function psReceiptTicketEl(brand) {
  const b = brand || {};
  const name = String(b.name || "").trim() || "Nümunə restoran";
  const tag = [b.tagline, b.branch].map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
  const qrText = psPreviewQrText(b);
  const qrSrc = qrText ? psQrDataUrl(qrText) : "";
  const row = (a, c, total) => jsxRuntimeExports.jsxs("div", { className: total ? "ps-receipt-ticket-row is-total" : "ps-receipt-ticket-row", children: [
    jsxRuntimeExports.jsx("span", { children: a }),
    jsxRuntimeExports.jsx("span", { children: c })
  ] });
  return jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket", children: [
    b.logo ? jsxRuntimeExports.jsx("img", { className: "ps-receipt-logo", alt: "", src: b.logo }) : null,
    jsxRuntimeExports.jsx("h1", { children: name }),
    psReceiptMeta(tag),
    psReceiptMeta(b.address),
    psReceiptMeta(b.phone),
    b.hours ? psReceiptMeta("İş saatı: " + b.hours) : null,
    b.taxId ? psReceiptMeta("VÖEN: " + b.taxId) : null,
    psReceiptMeta("Masa 12 · Nümunə çek"),
    row("Club Sandwich", "9.00 ₼"),
    row("Kartof fri", "4.50 ₼"),
    row("Çay", "2.00 ₼"),
    row("Cəmi", "15.50 ₼", true),
    jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-foot", children: "Təşəkkür edirik!" }),
    qrText ? jsxRuntimeExports.jsxs("div", { className: "ps-receipt-qr-wrap", children: [
      qrSrc ? jsxRuntimeExports.jsx("img", { className: "ps-receipt-qr", alt: "QR", src: qrSrc }) : jsxRuntimeExports.jsx("div", { className: "ps-receipt-qr-box", children: "QR" }),
      jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-foot", children: qrText })
    ] }) : null,
    jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-foot", children: "Çek önbaxış · kağız nümunə" })
  ] });
}
`;

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  s = replaceOnce(
    s,
    'function RestaurantInfoSettings() {',
    `${HELPERS}
function RestaurantInfoSettings() {`,
    'inject receipt helpers',
  );

  s = replaceOnce(
    s,
    `  const [previewHtml, setPreviewHtml] = reactExports.useState(null);
  const logoInput = reactExports.useRef(null);`,
    `  const [previewHtml, setPreviewHtml] = reactExports.useState(null);
  const [qrUrl, setQrUrl] = reactExports.useState("");
  const [qrOn, setQrOn] = reactExports.useState(true);
  const logoInput = reactExports.useRef(null);`,
    'restaurant qr state',
  );

  s = replaceOnce(
    s,
    `      if (typeof all["printer.logoDataUrl"] === "string") setLogo(all["printer.logoDataUrl"]);`,
    `      if (typeof all["printer.logoDataUrl"] === "string") setLogo(all["printer.logoDataUrl"]);
      setQrUrl(typeof all["receipt.qrUrl"] === "string" ? all["receipt.qrUrl"] : "");
      setQrOn(String(all["printer.qr"] ?? "1") !== "0");`,
    'restaurant load qr',
  );

  s = replaceOnce(
    s,
    `          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket", children: [
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
          ] })`,
    `          psReceiptTicketEl({
            name: draft["restaurant.name"],
            tagline: draft["restaurant.tagline"],
            address: draft["restaurant.address"],
            phone: draft["restaurant.phone"],
            hours: draft["restaurant.hours"],
            taxId: draft["restaurant.taxId"],
            branch: draft["branch.name"],
            logo,
            qrOn,
            qrUrl
          })`,
    'restaurant ticket brand',
  );

  s = replaceOnce(
    s,
    `  const [qrUrl, setQrUrl] = reactExports.useState("");
  const [qrOn, setQrOn] = reactExports.useState(true);
  const [savingQr, setSavingQr] = reactExports.useState(false);`,
    `  const [qrUrl, setQrUrl] = reactExports.useState("");
  const [qrOn, setQrOn] = reactExports.useState(true);
  const [receiptLogo, setReceiptLogo] = reactExports.useState("");
  const [receiptBrand, setReceiptBrand] = reactExports.useState({});
  const [savingQr, setSavingQr] = reactExports.useState(false);`,
    'printer brand state',
  );

  s = replaceOnce(
    s,
    `      const all = res.data?.settings ?? {};
      setQrUrl(typeof all["receipt.qrUrl"] === "string" ? all["receipt.qrUrl"] : "");
      setQrOn(String(all["printer.qr"] ?? "1") !== "0");
    });
  }, []);`,
    `      const all = res.data?.settings ?? {};
      setQrUrl(typeof all["receipt.qrUrl"] === "string" ? all["receipt.qrUrl"] : "");
      setQrOn(String(all["printer.qr"] ?? "1") !== "0");
      if (typeof all["printer.logoDataUrl"] === "string") setReceiptLogo(all["printer.logoDataUrl"]);
      setReceiptBrand({
        name: typeof all["restaurant.name"] === "string" ? all["restaurant.name"] : "",
        tagline: typeof all["restaurant.tagline"] === "string" ? all["restaurant.tagline"] : "",
        address: typeof all["restaurant.address"] === "string" ? all["restaurant.address"] : "",
        phone: typeof all["restaurant.phone"] === "string" ? all["restaurant.phone"] : "",
        hours: typeof all["restaurant.hours"] === "string" ? all["restaurant.hours"] : "",
        taxId: typeof all["restaurant.taxId"] === "string" ? all["restaurant.taxId"] : "",
        branch: typeof all["branch.name"] === "string" ? all["branch.name"] : ""
      });
    });
  }, []);`,
    'printer load brand',
  );

  s = replaceOnce(
    s,
    `          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "Nümunə restoran" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "ps-receipt-ticket-meta", children: [previewMeta || "80 mm · 40 sütun", /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}), "Masa 12 · Nümunə çek"] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Club Sandwich" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "9.00 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Kartof fri" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "4.50 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Çay" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "2.00 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-receipt-ticket-row is-total", children: [/* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Cəmi" }), /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "15.50 ₼" })] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-receipt-ticket-foot", children: "Çek önbaxış · kağız nümunə" })
          ] })`,
    `          psReceiptTicketEl({
            name: receiptBrand.name,
            tagline: receiptBrand.tagline,
            address: receiptBrand.address,
            phone: receiptBrand.phone,
            hours: receiptBrand.hours,
            taxId: receiptBrand.taxId,
            branch: receiptBrand.branch,
            logo: receiptLogo,
            qrOn,
            qrUrl
          })`,
    'printer ticket brand',
  );

  must(s.includes('psReceiptTicketEl'), 'ticket helper missing');
  must(s.includes('ps-receipt-logo'), 'logo class missing');
  must(s.includes('ps-receipt-qr'), 'qr class missing');
  fs.writeFileSync(BUNDLE, s);
  console.log('bundle: receipt brand');
} else {
  console.log('bundle already applied');
}

let css = fs.readFileSync(CSS, 'utf8');
if (!css.includes(CSS_MARK)) {
  css += `
${CSS_MARK}
.ps-receipt-ticket img.ps-receipt-logo,
.ps-receipt-ticket img.ps-receipt-qr,
.ps-receipt-frame img.ps-receipt-logo,
.ps-receipt-frame img.ps-receipt-qr {
  display: block !important;
}
.ps-receipt-logo {
  width: min(100%, 148px);
  max-height: 72px;
  margin: 0 auto 10px;
  object-fit: contain;
}
.ps-receipt-ticket p.ps-receipt-ticket-meta {
  margin: 0.12rem 0;
}
.ps-receipt-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 10px 0 4px;
}
.ps-receipt-qr {
  width: 108px;
  height: 108px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e7dcc8;
  image-rendering: pixelated;
}
.ps-receipt-qr-box {
  width: 96px;
  height: 96px;
  border: 2px solid #14140f;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
}
`;
  fs.writeFileSync(CSS, css);
  console.log('css: receipt brand');
} else {
  console.log('css already applied');
}
