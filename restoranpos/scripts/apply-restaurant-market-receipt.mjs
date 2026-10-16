#!/usr/bin/env node
/**
 * Market POS 1.5.1 — receipts in the restaurant's design.
 *
 * Market opens the till's own "Çek ayarları" (logo, QR, header, paper,
 * preview) inside its Parametrlər (#/settings in the Market frame, see
 * market-ops/bridge.template.js). In that frame (window.__psMarketMode):
 *  - only the receipt section is shown;
 *  - the print profile is saved without a printer of its own (Market prints
 *    the bytes itself through receipt.renderExternal);
 *  - the preview shows a shop receipt (till and cashier, no table).
 * Runs after apply-restaurant-erp-v2.mjs (uses psMarketMode).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_MARKET_RECEIPT_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  s = replaceOnce(s, `  const picked = reactExports.useContext(SettingsSectionCtx);
  if (picked !== null) {`, `  ${MARK}
  const pickedSection = reactExports.useContext(SettingsSectionCtx);
  // Market shows only the receipt section, open.
  const picked = psMarketMode() ? "receipt" : pickedSection;
  if (picked !== null) {`, 'accordion');
  s = replaceOnce(s, `  const savePrinterProfile = async (patch,notify=true) => {
    const target = currentPrinterTarget();`, `  const savePrinterProfile = async (patch,notify=true) => {
    const target = psMarketMode() ? "virtual" : currentPrinterTarget();`, 'profile target');
  s = replaceOnce(s, `  const printDraft = () => psPrintInput({paperWidth,dpi,printableDots,charsPerLine,renderMode,fontHeightPx,fontWidthPx,sideMarginPx,currencyDisplay,qrOn,qrUrl,brand:receiptBrand});`,
    `  const printDraft = () => ({ ...psPrintInput({paperWidth,dpi,printableDots,charsPerLine,renderMode,fontHeightPx,fontWidthPx,sideMarginPx,currencyDisplay,qrOn,qrUrl,brand:receiptBrand}), ...(psMarketMode() ? { retail: true } : {}) });`, 'preview retail');
  fs.writeFileSync(BUNDLE, s);
  console.log('market receipt applied');
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-market-ops .ps-settings-page nav.category-bar { display: none !important; }
`;
    fs.writeFileSync(CSS, css);
  }
}
