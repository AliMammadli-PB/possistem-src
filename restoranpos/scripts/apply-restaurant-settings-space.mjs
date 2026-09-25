#!/usr/bin/env node
/**
 * Parametrlər spacing pass: texts were concatenating, logo overflowed the
 * card, receipt preview was full-bleed, chip CSS (gap:0) leaked onto action
 * rows. Restore gaps, contain the logo, center the receipt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_SETTINGS_SPACE_v1 */';
const BUNDLE_MARK = '/* POS_SETTINGS_SPACE_BUNDLE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let bundle = fs.readFileSync(BUNDLE, 'utf8');
if (bundle.includes(BUNDLE_MARK)) {
  console.log('bundle already applied');
} else {
  const logoNeedle =
    `/* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "flex h-16 w-40 items-center justify-center rounded-lg border border-hairline bg-white", children: logo ? /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: logo, alt: "", className: "max-h-14 max-w-36 object-contain" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs text-ink/50", children: "Loqo yoxdur" }) }),`;
  if (!bundle.includes(logoNeedle)) {
    // Newer settings chrome rewrote the logo row; do not crash Desktop launch.
    console.log('bundle superseded by newer settings chrome — skip');
  } else {
    bundle = replaceOnce(
      bundle,
      logoNeedle,
      `${BUNDLE_MARK}
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-logo-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-logo-thumb", children: logo ? /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: logo, alt: "", className: "ps-logo-thumb-img" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Loqo yoxdur" }) }),`,
      'logo row + thumb',
    );
    fs.writeFileSync(BUNDLE, bundle);
    console.log('bundle: logo contained');
  }
}

let css = fs.readFileSync(CSS, 'utf8');
if (css.includes(MARK)) {
  console.log('css already applied');
  process.exit(0);
}

css += `
${MARK}
/* Spacing / contain / center — Parametrlər */
.ps-settings-page .ps-settings-stack {
  gap: 16px !important;
}
.ps-settings-page .ps-settings-stack > div {
  gap: 16px !important;
}
.ps-settings-page .card,
.ps-settings-page .settings-section,
.ps-settings-page .ps-settings-stack section {
  overflow: visible !important;
}
.ps-settings-page .ps-settings-stack section {
  display: flex !important;
  flex-direction: column;
  gap: 14px !important;
  padding: 18px 18px 20px !important;
}
.ps-settings-page .cardbody {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 16px 20px;
}
.ps-settings-page .ps-settings-stack section > h2,
.ps-settings-page .ps-settings-stack section > p:first-of-type {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
.ps-settings-page .ps-settings-stack section > h2 {
  padding-top: 0 !important;
  line-height: 1.35;
}
.ps-settings-page .ps-settings-stack section > p {
  margin: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  padding-bottom: 0 !important;
  border-bottom: 0 !important;
  line-height: 1.55;
}
.ps-settings-page .ps-settings-stack section .grid {
  padding: 0 !important;
  gap: 14px !important;
}
.ps-settings-page .ps-settings-stack section > label.block {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

/* Chip groups stay compact. Action rows (items-center) must keep a real gap. */
.ps-settings-page .ps-settings-stack section .flex.flex-wrap:not(.items-center) {
  gap: 4px !important;
  margin: 0 !important;
  max-width: 100%;
}
.ps-settings-page .ps-settings-stack section .flex.flex-wrap.items-center {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 12px !important;
  margin: 0 !important;
  padding: 0 !important;
  background: none !important;
  border: 0 !important;
  width: 100% !important;
  max-width: none !important;
  box-shadow: none !important;
}

.ps-settings-page .ps-logo-row {
  display: flex !important;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px !important;
  margin: 0 !important;
  padding: 0 !important;
  background: none !important;
  border: 0 !important;
  width: 100% !important;
  max-width: none !important;
}
.ps-settings-page .ps-logo-thumb {
  flex: 0 0 128px;
  width: 128px !important;
  height: 72px !important;
  overflow: hidden !important;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #f4f7fb;
  display: grid !important;
  place-items: center;
  color: var(--muted);
  font-size: 12px;
}
.ps-settings-page .ps-logo-thumb-img {
  max-width: 100% !important;
  max-height: 100% !important;
  width: auto !important;
  height: auto !important;
  object-fit: contain;
  display: block;
}

.ps-settings-page .ps-settings-switch-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  min-width: 0;
}
.ps-settings-page .ps-settings-switch-title {
  display: block;
  line-height: 1.35;
}
.ps-settings-page .ps-settings-switch-hint {
  display: block;
  line-height: 1.4;
}

.ps-settings-page .receipt-preview-frame {
  display: block;
  width: min(380px, 100%);
  height: 560px;
  margin: 8px auto 4px;
  background: #f4f7fb;
  border: 1px dashed #c8d5e3;
  border-radius: 12px;
}

.ps-settings-page .ps-settings-commit,
.ps-settings-page .ps-settings-stack section > :is(button[class*="bg-gold"], button.btn-gold) {
  margin: 4px 0 0 !important;
}

.ps-settings-page .settings-shell {
  padding-bottom: 108px;
}
`;

fs.writeFileSync(CSS, css);
must(css.includes('.ps-logo-thumb'), 'logo thumb CSS missing');
must(css.includes('.ps-settings-switch-copy'), 'switch copy CSS missing');
console.log('patched', CSS);
