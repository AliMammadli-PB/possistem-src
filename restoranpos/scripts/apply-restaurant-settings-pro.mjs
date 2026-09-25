#!/usr/bin/env node
/**
 * Parametrlər — real redesign (UI-UX-Pro-Max, density 7 / motion 2 / variance 4).
 *
 * Earlier pass (settings-design) only polished CSS on the old card stack. This
 * pass changes the page chrome and the visual system so NEWEST looks different
 * at a glance: hub-style header, nav as a solid rail card with icon wells,
 * preference-list rows, connected segment controls, sticky commit bar, danger
 * panel that cannot be mistaken for a normal card.
 *
 * Kept from the product identity (not the skill's marketing defaults):
 *   admin brand #245bd6, light #f6f7f9 surface, Manrope, Lucide icons,
 *   AZ/TR/EN copy already in the bundle. Rejected: dark terminal palette,
 *   Playfair Display SC, landing-page Hero/CTA pattern.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_SETTINGS_PRO_v1 */';
const BUNDLE_MARK = '/* POS_SETTINGS_PRO_BUNDLE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

// --- bundle: page chrome --------------------------------------------------
let bundle = fs.readFileSync(BUNDLE, 'utf8');
// Superseded by later settings chrome — do not fail the launch chain.
if (
  bundle.includes('POS_SETTINGS_FORM_BUNDLE_v1') ||
  bundle.includes('POS_SETTINGS_EXACT_BUNDLE_v1') ||
  bundle.includes('ps-category-bar') ||
  bundle.includes('category-bar')
) {
  console.log('bundle superseded by newer settings chrome — skip');
  // CSS may still be needed on a fresh tree; fall through only if mark missing.
} else if (!bundle.includes(BUNDLE_MARK)) {
  must(bundle.includes('ps-settings-page'), 'settings page missing');

  bundle = replaceOnce(
    bundle,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-page flex h-full flex-col overflow-auto", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "border-b border-hairline px-6 py-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-settings-title font-display text-2xl text-cream", children: t.settings.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-settings-hint", children: t.settings.deviceHint }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "gold-rule mt-3 w-28 opacity-50" })
    ] }),`,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-page flex h-full flex-col overflow-auto", children: [
    ${BUNDLE_MARK}
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "ps-settings-hero", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-eyebrow", children: "İDARƏ" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-settings-title", children: t.settings.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-settings-hint", children: t.settings.deviceHint })
    ] }),`,
    'settings hero',
  );

  // Rail buttons: icon sits in a well; active state is a left rail accent.
  bundle = replaceOnce(
    bundle,
    `className: settingsSection === sec.id
              ? "touch-target flex items-center gap-3 rounded-xl border border-gold/40 bg-gold/15 px-3 py-2 text-left text-sm text-gold"
              : "touch-target flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left text-sm text-muted hover:text-cream",
            style: sec.danger && settingsSection !== sec.id ? { color: "var(--ps-danger)" } : null,
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(sec.icon, { className: "h-4 w-4 shrink-0" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate", children: sec.label })
            ]`,
    `className: "ps-settings-nav-item" + (settingsSection === sec.id ? " is-active" : "") + (sec.danger ? " is-danger" : ""),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-nav-icon", children:
                /* @__PURE__ */ jsxRuntimeExports.jsx(sec.icon, { className: "h-4 w-4" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-nav-label", children: sec.label })
            ]`,
    'nav item chrome',
  );

  // Reduce-motion becomes a proper switch row (visual via CSS + class hooks).
  bundle = replaceOnce(
    bundle,
    `className: \`touch-target flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm \${reduceMotion ? "border-gold/40 bg-gold/10 text-gold" : "border-hairline bg-elevated text-cream"}\`,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.settings.reduceMotion }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: reduceMotion ? "ON" : "OFF" })
          ]`,
    `className: "ps-settings-switch" + (reduceMotion ? " is-on" : ""),
          "aria-pressed": reduceMotion,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ps-settings-switch-copy", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-switch-title", children: t.settings.reduceMotion }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-switch-hint", children: reduceMotion ? "Aktiv" : "Sönülü" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-switch-track", "aria-hidden": true, children:
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-switch-thumb" }) })
          ]`,
    'reduce-motion switch',
  );

  // Display apply → sticky commit bar class.
  bundle = replaceOnce(
    bundle,
    `className: "touch-target rounded-xl bg-gold/20 px-4 py-2 text-sm text-gold hover:bg-gold/30 disabled:opacity-50",
            children: savingDisplay ? t.common.loading : t.settings.displayApply`,
    `className: "ps-settings-commit",
            children: savingDisplay ? t.common.loading : t.settings.displayApply`,
    'display commit',
  );

  fs.writeFileSync(BUNDLE, bundle);
  console.log('bundle: settings chrome rewritten');
} else {
  console.log('bundle already applied');
}

// --- CSS ------------------------------------------------------------------
let css = fs.readFileSync(CSS, 'utf8');
if (css.includes('POS_SETTINGS_EXACT_v1') || bundle.includes('POS_SETTINGS_EXACT_BUNDLE_v1') || bundle.includes('category-bar')) {
  console.log('css superseded by newer settings chrome — skip');
  process.exit(0);
}
if (css.includes(MARK)) {
  console.log('css already applied');
  process.exit(0);
}

must(css.includes('.ps-settings-layout'), 'settings layout layer missing');
must(css.includes('.ps-admin-workspace'), 'admin workspace tokens missing');

css += `
${MARK}
/* =========================================================================
   Parametrlər PRO — commercial POS settings (density 7, motion 2)
   Scoped. Floor screens keep their own language.
   ========================================================================= */

.ps-settings-page {
  --set-ink: #152238;
  --set-muted: #5b6b82;
  --set-line: #e3e9f2;
  --set-soft: #f0f4fa;
  --set-card: #ffffff;
  --set-brand: var(--ps-brand, #245bd6);
  --set-brand-soft: #eaf0fc;
  --set-danger: #b42318;
  --set-radius: 14px;
  background:
    radial-gradient(1200px 420px at 12% -10%, #dbe7ff 0%, transparent 55%),
    linear-gradient(180deg, #f7f8fb 0%, #eef2f7 100%) !important;
}

.ps-settings-hero {
  padding: 28px 32px 8px;
  max-width: 1320px;
  margin: 0 auto;
  width: 100%;
}
.ps-settings-hero .ps-eyebrow {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 11px;
  letter-spacing: .14em;
  font-weight: 800;
  color: var(--set-brand);
}
.ps-settings-title {
  margin: 0 !important;
  font-size: 30px !important;
  line-height: 1.15 !important;
  letter-spacing: -.6px !important;
  font-weight: 750 !important;
  color: var(--set-ink) !important;
  font-family: var(--font-sans) !important;
}
.ps-settings-hint {
  margin: 8px 0 0 !important;
  max-width: 46rem;
  font-size: 14px !important;
  line-height: 1.55 !important;
  color: var(--set-muted) !important;
}
.ps-settings-page .gold-rule { display: none !important; }

.ps-settings-layout {
  display: grid !important;
  grid-template-columns: 248px minmax(0, 1fr) !important;
  gap: 22px !important;
  padding: 18px 32px 40px !important;
  max-width: 1320px;
  width: 100%;
  margin: 0 auto;
  align-items: start;
}

/* --- rail card ----------------------------------------------------------- */
.ps-settings-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 12px;
  padding: 10px;
  background: var(--set-card);
  border: 1px solid var(--set-line);
  border-radius: var(--set-radius);
  box-shadow: 0 8px 24px rgba(21, 34, 56, .04);
}
.ps-settings-nav-item {
  width: 100%;
  display: flex !important;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 10px !important;
  border: 0 !important;
  border-radius: 11px !important;
  background: transparent !important;
  color: #4a5b73 !important;
  font-size: 13px !important;
  font-weight: 650 !important;
  text-align: left;
  cursor: pointer;
  transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}
.ps-settings-nav-item:hover { background: var(--set-soft) !important; color: var(--set-ink) !important; }
.ps-settings-nav-icon {
  width: 34px; height: 34px; flex: 0 0 34px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px;
  background: var(--set-soft);
  color: #4a5b73;
}
.ps-settings-nav-item.is-active {
  background: var(--set-brand-soft) !important;
  color: var(--set-brand) !important;
  box-shadow: inset 3px 0 0 var(--set-brand);
}
.ps-settings-nav-item.is-active .ps-settings-nav-icon {
  background: #dbe7ff;
  color: var(--set-brand);
}
.ps-settings-nav-item.is-danger { color: var(--set-danger) !important; }
.ps-settings-nav-item.is-danger .ps-settings-nav-icon {
  background: #fdecec; color: var(--set-danger);
}
.ps-settings-nav-item.is-danger.is-active {
  background: #fff1f0 !important;
  box-shadow: inset 3px 0 0 var(--set-danger);
}
.ps-settings-nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ps-settings-mobile select {
  min-height: 48px !important;
  border-radius: 12px !important;
  border: 1px solid var(--set-line) !important;
  background: #fff !important;
  color: var(--set-ink) !important;
  font-weight: 650;
}

/* --- panel --------------------------------------------------------------- */
.ps-settings-stack {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ps-settings-stack > div > div:first-child {
  position: sticky; top: 0; z-index: 3;
  margin: 0 0 4px !important;
  padding: 6px 2px 14px;
  background: linear-gradient(#f4f6fa 70%, transparent);
}
.ps-settings-stack > div > div:first-child h2 {
  font-size: 20px !important;
  font-weight: 750 !important;
  letter-spacing: -.3px;
  color: var(--set-ink) !important;
}
.ps-settings-stack > div > div:first-child p {
  font-size: 13px !important;
  color: var(--set-muted) !important;
  margin-top: 4px !important;
}

.ps-settings-stack section {
  margin: 0 !important;
  padding: 0 !important;
  background: var(--set-card) !important;
  border: 1px solid var(--set-line) !important;
  border-radius: var(--set-radius) !important;
  box-shadow: 0 1px 2px rgba(21, 34, 56, .03) !important;
  overflow: hidden;
}
.ps-settings-stack section.glass {
  backdrop-filter: none !important;
  background: var(--set-card) !important;
}
.ps-settings-stack section > h2 {
  margin: 0 !important;
  padding: 16px 18px 0 !important;
  font-size: 14px !important;
  font-weight: 750 !important;
  letter-spacing: .01em;
  text-transform: none !important;
  color: var(--set-ink) !important;
}
.ps-settings-stack section > p:first-of-type {
  margin: 4px 18px 0 !important;
  padding: 0 0 12px !important;
  font-size: 12.5px !important;
  color: var(--set-muted) !important;
  border-bottom: 1px solid var(--set-line);
}

/* preference rows */
.ps-settings-stack section > label.block,
.ps-settings-stack section > .grid,
.ps-settings-stack section > div:not(.ps-settings-switch):not(:has(> .ps-settings-commit)) {
  padding-left: 18px;
  padding-right: 18px;
}
.ps-settings-stack label.block {
  display: grid !important;
  gap: 6px;
  margin: 0 !important;
  padding-top: 14px !important;
  padding-bottom: 14px !important;
  border-top: 1px solid var(--set-line) !important;
}
.ps-settings-stack section > label.block:first-of-type { border-top: 0 !important; }
.ps-settings-stack label.block > span:first-child {
  font-size: 13px !important;
  font-weight: 650 !important;
  color: var(--set-ink) !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
}
.ps-settings-stack label.block > span:not(:first-child) {
  font-size: 12px !important;
  color: var(--set-muted) !important;
  line-height: 1.5;
}
@media (min-width: 1000px) {
  .ps-settings-stack section > label.block {
    grid-template-columns: minmax(160px, 240px) minmax(0, 1fr);
    gap: 18px;
    align-items: center;
  }
  .ps-settings-stack section > label.block > span:not(:first-child) {
    grid-column: 2;
  }
}

.ps-settings-stack :is(input[type="text"], input[type="url"], input[type="tel"],
                       input[type="number"], input[type="password"], input[type="search"],
                       input:not([type]), select, textarea) {
  min-height: 44px !important;
  border-radius: 10px !important;
  border: 1px solid #d5deea !important;
  background: #fff !important;
  color: var(--set-ink) !important;
  font-size: 14px !important;
  padding: 10px 12px !important;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.ps-settings-stack :is(input, select, textarea):focus-visible {
  border-color: var(--set-brand) !important;
  box-shadow: 0 0 0 3px rgba(36, 91, 214, .22) !important;
  outline: none !important;
}

/* connected segment groups (language / resolution / zoom) */
.ps-settings-stack section .flex.flex-wrap {
  display: inline-flex !important;
  flex-wrap: wrap !important;
  gap: 0 !important;
  padding: 3px !important;
  margin: 10px 18px 14px !important;
  background: var(--set-soft);
  border: 1px solid var(--set-line);
  border-radius: 12px;
  width: fit-content;
  max-width: calc(100% - 36px);
}
.ps-settings-stack section .flex.flex-wrap > button {
  min-height: 40px !important;
  margin: 0 !important;
  border: 0 !important;
  border-radius: 9px !important;
  background: transparent !important;
  color: #516278 !important;
  font-size: 12.5px !important;
  font-weight: 650 !important;
  padding: 0 12px !important;
  box-shadow: none !important;
}
.ps-settings-stack section .flex.flex-wrap > button:hover {
  background: rgba(255,255,255,.7) !important;
  color: var(--set-ink) !important;
}
.ps-settings-stack section .flex.flex-wrap > button[class*="bg-gold"],
.ps-settings-stack section .flex.flex-wrap > button[class*="border-gold"],
.ps-settings-stack section .flex.flex-wrap > button[aria-pressed="true"] {
  background: #fff !important;
  color: var(--set-brand) !important;
  box-shadow: 0 1px 2px rgba(21, 34, 56, .08) !important;
}

/* switch row */
.ps-settings-switch {
  width: calc(100% - 0px) !important;
  display: flex !important;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 64px;
  margin: 0 !important;
  padding: 14px 18px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  text-align: left;
  cursor: pointer;
}
.ps-settings-switch-copy { display: flex; flex-direction: column; gap: 2px; }
.ps-settings-switch-title {
  font-size: 13.5px; font-weight: 700; color: var(--set-ink);
}
.ps-settings-switch-hint {
  font-size: 12px; color: var(--set-muted);
}
.ps-settings-switch-track {
  width: 48px; height: 28px; flex: 0 0 48px;
  border-radius: 999px;
  background: #c9d3e3;
  position: relative;
  transition: background-color 180ms ease;
}
.ps-settings-switch-thumb {
  position: absolute; top: 3px; left: 3px;
  width: 22px; height: 22px; border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, .25);
  transition: transform 180ms ease;
}
.ps-settings-switch.is-on .ps-settings-switch-track { background: var(--set-brand); }
.ps-settings-switch.is-on .ps-settings-switch-thumb { transform: translateX(20px); }

/* commit action */
.ps-settings-commit,
.ps-settings-stack section > :is(button.ps-settings-commit) {
  display: flex !important;
  width: calc(100% - 36px) !important;
  margin: 8px 18px 18px auto !important;
  max-width: 280px;
  min-height: 46px !important;
  justify-content: center;
  border-radius: 11px !important;
  border: 0 !important;
  background: var(--set-brand) !important;
  color: #fff !important;
  font-size: 13.5px !important;
  font-weight: 750 !important;
  box-shadow: 0 8px 18px rgba(36, 91, 214, .28);
}
.ps-settings-commit:hover:not(:disabled) {
  background: #1d4ec2 !important;
}
.ps-settings-stack section > :is(button, a.touch-target):not(.ps-settings-nav-item):not(.ps-settings-switch) {
  min-height: 44px;
}
.ps-settings-stack section > div:last-child:has(> .ps-settings-commit) {
  display: flex;
  justify-content: flex-end;
  padding: 0 0 4px;
  background: linear-gradient(180deg, transparent, #f7f9fc 40%);
  border-top: 1px solid var(--set-line);
}

/* danger */
.ps-settings-stack[data-section="danger"] section {
  border-color: #f0c7c2 !important;
  background: #fff8f7 !important;
}
.ps-settings-stack[data-section="danger"] > div > div:first-child h2,
.ps-settings-stack[data-section="danger"] section > h2 {
  color: var(--set-danger) !important;
}

@media (prefers-reduced-motion: reduce) {
  .ps-settings-page *, .ps-settings-nav-item, .ps-settings-switch-track, .ps-settings-switch-thumb {
    transition: none !important;
  }
}

@media (max-width: 1199px) {
  .ps-settings-layout { grid-template-columns: 210px minmax(0, 1fr) !important; gap: 16px !important; }
  .ps-settings-hero, .ps-settings-layout { padding-left: 22px !important; padding-right: 22px !important; }
}
@media (max-width: 760px) {
  .ps-settings-layout { display: block !important; padding: 14px 16px 28px !important; }
  .ps-settings-nav { display: none !important; }
  .ps-settings-mobile { display: block !important; margin-bottom: 14px; }
  .ps-settings-hero { padding: 20px 16px 4px; }
  .ps-settings-title { font-size: 24px !important; }
}
`;

fs.writeFileSync(CSS, css);
must(css.includes('.ps-settings-nav-item.is-active'), 'nav active state missing');
must(css.includes('.ps-settings-switch-track'), 'switch chrome missing');
must(css.includes('.ps-settings-commit'), 'commit button style missing');
must(!css.slice(css.indexOf(MARK)).includes('.ps-shell {'), 'rule escaped settings scope');
console.log('patched', CSS);
