#!/usr/bin/env node
/**
 * Parametrlər → mockup form (category cards + preference rows).
 *
 * Visual target: the HTML the operator pasted ("Sistem ayarları" with a
 * 6-card category bar, account ribbon, setting rows, switches, danger grid).
 * Real sections stay at five — Restoran / Ekran / Printer / Sistem / Təhlükəli —
 * because Backup has no backend in this build; inventing a sixth empty tab
 * would break the "no empty sections" rule from the earlier rail rewrite.
 *
 * Touch sizes stay POS-safe (≥12px type, ≥44px tap). The mockup's 7–9px type
 * is demo-scale and is not copied literally.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_SETTINGS_FORM_v1 */';
const BUNDLE_MARK = '/* POS_SETTINGS_FORM_BUNDLE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let bundle = fs.readFileSync(BUNDLE, 'utf8');

if (
  bundle.includes('POS_SETTINGS_EXACT_BUNDLE_v1')
  || bundle.includes('POS_SETTINGS_EXACT_CLOSE_v1')
  || bundle.includes('className: "topbar"')
  || bundle.includes('className: "category-bar"')
) {
  console.log('bundle superseded by settings-exact — skip');
} else if (!bundle.includes(BUNDLE_MARK)) {
  // --- section list with mockup-style hints + tone -----------------------
  bundle = replaceOnce(
    bundle,
    `function settingsSections(t) {
  return [
    { id: "restaurant", label: t.settings.sectionRestaurant, icon: Store },
    { id: "screen", label: t.settings.sectionScreen, icon: SlidersHorizontal },
    { id: "printer", label: t.settings.sectionPrinter, icon: ReceiptText },
    { id: "system", label: t.settings.sectionSystem, icon: Server },
    { id: "danger", label: t.settings.dangerZone, icon: TriangleAlert, danger: true }
  ];
}`,
    `function settingsSections(t) {
  return [
    { id: "restaurant", label: t.settings.sectionRestaurant, hint: "Hesab və qəbz", icon: Store, tone: "blue" },
    { id: "screen", label: t.settings.sectionScreen, hint: "Görünüş və touch", icon: SlidersHorizontal, tone: "purple" },
    { id: "printer", label: t.settings.sectionPrinter, hint: "Qəbz və çap", icon: ReceiptText, tone: "green" },
    { id: "system", label: t.settings.sectionSystem, hint: "POS və bağlantı", icon: Server, tone: "gray" },
    { id: "danger", label: t.settings.dangerZone, hint: "Sıfırla və çıxış", icon: TriangleAlert, tone: "red", danger: true }
  ];
}`,
    'settingsSections hints',
  );

  // --- page chrome: hero + horizontal category bar -----------------------
  const oldChromeStart = bundle.includes('/* POS_SETTINGS_PRO_BUNDLE_v1 */')
    ? `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-page flex h-full flex-col overflow-auto", children: [
    /* POS_SETTINGS_PRO_BUNDLE_v1 */
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "ps-settings-hero", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-eyebrow", children: "İDARƏ" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-settings-title", children: t.settings.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-settings-hint", children: t.settings.deviceHint })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-layout", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("nav", { className: "ps-settings-nav", "aria-label": t.settings.title, children:
        settingsSections(t).map((sec) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => setSettingsSection(sec.id), "aria-current": settingsSection === sec.id ? "page" : undefined,
            className: "ps-settings-nav-item" + (settingsSection === sec.id ? " is-active" : "") + (sec.danger ? " is-danger" : ""),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-nav-icon", children:
                /* @__PURE__ */ jsxRuntimeExports.jsx(sec.icon, { className: "h-4 w-4" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-nav-label", children: sec.label })
            ]
          },
          sec.id
        )) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-settings-mobile", children:
        /* @__PURE__ */ jsxRuntimeExports.jsx("select", {
          value: settingsSection,
          onChange: (e) => setSettingsSection(e.target.value),
          "aria-label": t.settings.title,
          className: "mb-3 min-h-11 w-full rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream sm:hidden",
          children: settingsSections(t).map((sec) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: sec.id, children: sec.label }, sec.id))
        }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsSectionCtx.Provider, { value: settingsSection, children:
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-section": settingsSection, className: "ps-settings-stack w-full min-w-0 flex-1 space-y-3", children: [`
    : null;

  must(oldChromeStart, 'PRO chrome not found — run settings-pro first or restore bundle');

  bundle = replaceOnce(
    bundle,
    oldChromeStart,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-page flex h-full flex-col overflow-auto", children: [
    ${BUNDLE_MARK}
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-shell", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-hero", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-settings-title", children: t.settings.title }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-settings-hint", children: t.settings.deviceHint })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("nav", { className: "ps-category-bar", "aria-label": t.settings.title, children:
        settingsSections(t).map((sec) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => setSettingsSection(sec.id),
            "aria-current": settingsSection === sec.id ? "page" : undefined,
            className: "ps-category" + (settingsSection === sec.id ? " is-active" : "") + (sec.danger ? " is-danger" : ""),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-category-icon tone-" + sec.tone, children:
                /* @__PURE__ */ jsxRuntimeExports.jsx(sec.icon, { className: "h-4 w-4" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: sec.label }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: sec.hint })
            ]
          },
          sec.id
        )) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsSectionCtx.Provider, { value: settingsSection, children:
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-section": settingsSection, className: "ps-settings-stack", children: [`,
    'form chrome',
  );

  // Close the extra shell wrapper opened above. Previous rail close was:
  //   ] }) }),  ] }),  previewHtml
  // After PRO it should still be the same Provider+layout closes.
  // We opened: shell, Provider, stack. Need: stack, Provider, shell.
  // Existing close after danger section:
  if (!bundle.includes('/* POS_SETTINGS_FORM_CLOSE_v1 */')) {
    bundle = replaceOnce(
      bundle,
      `      ] }) : null
    ] }) }),
    ] }),
    previewHtml ?`,
      `      ] }) : null
    ] }) }),
    ] }),
    /* POS_SETTINGS_FORM_CLOSE_v1 */
    previewHtml ?`,
      'form close mark',
    );
  }

  // Tenant block → account ribbon classes
  bundle = replaceOnce(
    bundle,
    `tenant && hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.tenantAccount }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted", children: t.settings.tenantAccountHint }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rounded-xl border border-hairline bg-elevated px-4 py-3 text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-cream", children: tenant.customerName || "—" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-0.5 font-mono text-xs text-faint", children: tenant.email })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => void switchAccount(),
            className: "touch-target flex items-center gap-2 rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:border-danger/40 hover:text-danger",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(LogOut, { className: "h-4 w-4" }),
              t.settings.tenantLogout
            ]
          }
        )
      ] }) : null,`,
    `tenant && hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-account-ribbon", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-avatar", children: String(tenant.customerName || tenant.email || "?").trim().charAt(0).toUpperCase() || "?" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-account-meta", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: tenant.customerName || "—" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: (tenant.email || "") + " · Bu kassaya bağlı hesab" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-badge-ok", children: "Aktiv" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => void switchAccount(),
            className: "ps-btn soft",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(LogOut, { className: "h-4 w-4" }),
              t.settings.tenantLogout
            ]
          }
        )
      ] }) : null,`,
    'account ribbon',
  );

  fs.writeFileSync(BUNDLE, bundle);
  console.log('bundle: form chrome applied');
} else {
  console.log('bundle already applied');
}

// --- CSS ------------------------------------------------------------------
let css = fs.readFileSync(CSS, 'utf8');
if (
  css.includes('POS_SETTINGS_EXACT_v1')
  || bundle.includes('POS_SETTINGS_EXACT_BUNDLE_v1')
  || bundle.includes('POS_SETTINGS_EXACT_CLOSE_v1')
  || bundle.includes('className: "topbar"')
) {
  console.log('css superseded by settings-exact — skip');
  process.exit(0);
}
if (css.includes(MARK)) {
  console.log('css already applied');
  process.exit(0);
}

css += `
${MARK}
/* =========================================================================
   Sistem ayarları — category-bar form (operator mockup)
   ========================================================================= */

.ps-settings-page {
  --s-bg: #f5f7fb;
  --s-surface: #ffffff;
  --s-ink: #10233f;
  --s-muted: #74859c;
  --s-line: #e1e8f0;
  --s-blue: #1769e8;
  --s-blue-soft: #eaf2ff;
  --s-green: #138b69;
  --s-green-soft: #eaf8f3;
  --s-amber: #b8781d;
  --s-amber-soft: #fff4e4;
  --s-purple: #7e59c8;
  --s-purple-soft: #f2edfb;
  --s-red: #d64037;
  --s-red-soft: #fff0ee;
  --s-shadow: 0 12px 32px rgba(22, 48, 82, .07);
  --s-r: 16px;
  background: var(--s-bg) !important;
  color: var(--s-ink);
}

.ps-settings-shell {
  max-width: 1220px;
  margin: 0 auto;
  padding: 24px 24px 48px;
  width: 100%;
}

.ps-settings-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
  padding: 0 !important;
  background: none !important;
}
.ps-settings-title {
  font-size: 26px !important;
  letter-spacing: -.6px !important;
  margin: 0 0 5px !important;
  color: var(--s-ink) !important;
  font-weight: 750 !important;
  font-family: var(--font-sans) !important;
}
.ps-settings-hint {
  font-size: 13px !important;
  color: var(--s-muted) !important;
  margin: 0 !important;
  max-width: 40rem;
}
.ps-settings-page .ps-eyebrow,
.ps-settings-page .gold-rule { display: none !important; }

/* kill previous sidebar layout */
.ps-settings-layout {
  display: block !important;
  padding: 0 !important;
  max-width: none !important;
  margin: 0 !important;
  grid-template-columns: none !important;
}
.ps-settings-nav,
.ps-settings-mobile { display: none !important; }

/* --- category bar -------------------------------------------------------- */
.ps-category-bar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.ps-category {
  border: 1px solid var(--s-line) !important;
  background: #fff !important;
  border-radius: 13px !important;
  min-height: 84px;
  padding: 12px !important;
  text-align: left;
  color: var(--s-ink) !important;
  box-shadow: 0 4px 14px rgba(20, 50, 84, .025);
  transition: border-color .16s, transform .16s, box-shadow .16s, background .16s;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  cursor: pointer;
}
.ps-category:hover {
  border-color: #cbd8e7 !important;
  transform: translateY(-1px);
}
.ps-category.is-active {
  border-color: #bcd1f4 !important;
  background: #f8fbff !important;
  box-shadow: 0 7px 20px rgba(23, 105, 232, .07);
}
.ps-category.is-active:after {
  content: "";
  position: absolute;
  left: 11px; right: 11px; bottom: -1px;
  height: 2px; border-radius: 2px;
  background: var(--s-blue);
}
.ps-category-icon {
  width: 32px; height: 32px; border-radius: 9px;
  display: grid; place-items: center;
  margin-bottom: 9px;
}
.ps-category-icon.tone-blue { background: var(--s-blue-soft); color: var(--s-blue); }
.ps-category-icon.tone-purple { background: var(--s-purple-soft); color: var(--s-purple); }
.ps-category-icon.tone-green { background: var(--s-green-soft); color: var(--s-green); }
.ps-category-icon.tone-gray { background: #eef3f8; color: #5d6f87; }
.ps-category-icon.tone-red { background: var(--s-red-soft); color: var(--s-red); }
.ps-category b {
  display: block;
  font-size: 13px;
  font-weight: 750;
  line-height: 1.25;
}
.ps-category > span:last-child {
  display: block;
  font-size: 11px;
  color: var(--s-muted);
  margin-top: 3px;
  font-weight: 500;
}
.ps-category.is-danger b { color: var(--s-red); }

/* --- stack / pane -------------------------------------------------------- */
.ps-settings-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.ps-settings-stack > div > div:first-child {
  display: none !important; /* category card already names the section */
}
.ps-settings-stack > div {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* account ribbon */
.ps-account-ribbon {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--s-line);
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: var(--s-shadow);
}
.ps-avatar {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--s-blue); color: #fff;
  display: grid; place-items: center;
  font-size: 13px; font-weight: 900;
  flex: 0 0 auto;
}
.ps-account-meta { flex: 1; min-width: 0; }
.ps-account-meta b { display: block; font-size: 14px; color: var(--s-ink); }
.ps-account-meta span { display: block; font-size: 12px; color: var(--s-muted); margin-top: 2px; }
.ps-badge-ok {
  font-size: 11px; font-weight: 800;
  padding: 5px 9px; border-radius: 999px;
  background: var(--s-green-soft); color: var(--s-green);
}
.ps-btn {
  min-height: 40px; border: 0; border-radius: 10px;
  padding: 0 14px; display: inline-flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 750; cursor: pointer;
}
.ps-btn.soft { background: #eef3f8; color: #42566f; }
.ps-btn.soft:hover { background: #e6edf5; }
.ps-btn.primary {
  background: var(--s-blue); color: #fff;
  box-shadow: 0 7px 18px rgba(23, 105, 232, .18);
}
.ps-btn.primary:hover { background: #0f5fd5; }
.ps-btn.outline {
  background: #fff; color: #40536c; border: 1px solid var(--s-line);
}
.ps-btn.danger { background: var(--s-red-soft); color: var(--s-red); }

/* cards = existing sections */
.ps-settings-stack section {
  background: #fff !important;
  border: 1px solid var(--s-line) !important;
  border-radius: 14px !important;
  box-shadow: var(--s-shadow) !important;
  padding: 0 !important;
  overflow: hidden;
  margin: 0 !important;
}
.ps-settings-stack section.glass {
  backdrop-filter: none !important;
  background: #fff !important;
}
.ps-settings-stack section > h2 {
  margin: 0 !important;
  padding: 14px 16px 0 !important;
  font-size: 15px !important;
  font-weight: 750 !important;
  color: var(--s-ink) !important;
}
.ps-settings-stack section > p:first-of-type {
  margin: 4px 16px 0 !important;
  padding: 0 0 12px !important;
  font-size: 12px !important;
  color: var(--s-muted) !important;
  border-bottom: 1px solid #edf2f7;
}

/* preference rows */
.ps-settings-stack section > label.block {
  display: grid !important;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: center;
  margin: 0 !important;
  padding: 14px 16px !important;
  border-top: 1px solid #edf2f7 !important;
  border-radius: 0 !important;
}
.ps-settings-stack section > label.block:first-of-type { border-top: 0 !important; }
.ps-settings-stack label.block > span:first-child {
  font-size: 13px !important;
  font-weight: 750 !important;
  color: var(--s-ink) !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
}
.ps-settings-stack label.block > span:not(:first-child) {
  grid-column: 1;
  font-size: 12px !important;
  color: var(--s-muted) !important;
  margin-top: 2px;
}
.ps-settings-stack label.block > :is(input, select, textarea, .flex, div) {
  grid-column: 2;
  grid-row: 1 / span 2;
  justify-self: end;
  min-width: 180px;
}
@media (min-width: 1000px) {
  .ps-settings-stack section > label.block {
    grid-template-columns: 1fr auto !important;
  }
}

.ps-settings-stack :is(input[type="text"], input[type="url"], input[type="tel"],
                       input[type="number"], input[type="password"], input[type="search"],
                       input:not([type]), select, textarea) {
  min-height: 40px !important;
  border: 1px solid #d2deeb !important;
  border-radius: 9px !important;
  padding: 8px 10px !important;
  background: #fff !important;
  color: var(--s-ink) !important;
  font-size: 13px !important;
  width: 100%;
}
.ps-settings-stack :is(input, select, textarea):focus-visible {
  border-color: #4d8fea !important;
  box-shadow: 0 0 0 3px rgba(23, 105, 232, .1) !important;
  outline: none !important;
}

/* form grids inside restaurant card */
.ps-settings-stack section .grid {
  display: grid !important;
  gap: 10px;
  padding: 14px 16px 16px;
}
.ps-settings-stack section .grid > label.block {
  display: flex !important;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 0 !important;
  border: 0 !important;
}
.ps-settings-stack section .grid > label.block > :is(input, select, textarea) {
  min-width: 0;
  justify-self: stretch;
  grid-column: auto;
  grid-row: auto;
}

/* segment groups */
.ps-settings-stack section .flex.flex-wrap {
  display: inline-flex !important;
  flex-wrap: wrap !important;
  gap: 0 !important;
  margin: 12px 16px !important;
  padding: 3px !important;
  background: #eef3f8;
  border: 1px solid var(--s-line);
  border-radius: 10px;
  width: fit-content;
  max-width: calc(100% - 32px);
}
.ps-settings-stack section .flex.flex-wrap > button {
  min-height: 36px !important;
  border: 0 !important;
  border-radius: 8px !important;
  background: transparent !important;
  color: #516278 !important;
  font-size: 12.5px !important;
  font-weight: 700 !important;
  padding: 0 12px !important;
  box-shadow: none !important;
}
.ps-settings-stack section .flex.flex-wrap > button[class*="bg-gold"],
.ps-settings-stack section .flex.flex-wrap > button[class*="border-gold"] {
  background: #fff !important;
  color: var(--s-blue) !important;
  box-shadow: 0 1px 2px rgba(21, 34, 56, .08) !important;
}

/* switches (reduce motion + checkboxes in settings) */
.ps-settings-switch {
  width: 100% !important;
  display: grid !important;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 18px;
  min-height: 56px;
  margin: 0 !important;
  padding: 12px 16px !important;
  border: 0 !important;
  border-top: 1px solid #edf2f7 !important;
  border-radius: 0 !important;
  background: transparent !important;
  text-align: left;
}
.ps-settings-switch-title { font-size: 13px; font-weight: 750; color: var(--s-ink); }
.ps-settings-switch-hint { font-size: 12px; color: var(--s-muted); }
.ps-settings-switch-track {
  width: 42px; height: 24px; border-radius: 99px;
  background: #cad6e2; position: relative; flex: 0 0 42px;
  transition: background .2s;
}
.ps-settings-switch-thumb {
  position: absolute; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; left: 3px; top: 3px;
  box-shadow: 0 1px 4px rgba(0,0,0,.18);
  transition: transform .2s;
}
.ps-settings-switch.is-on .ps-settings-switch-track { background: var(--s-blue); }
.ps-settings-switch.is-on .ps-settings-switch-thumb { transform: translateX(18px); }

.ps-settings-stack input[type="checkbox"] {
  width: 20px; height: 20px; accent-color: var(--s-blue);
}

/* commit */
.ps-settings-commit,
.ps-settings-stack section > :is(button.ps-settings-commit),
.ps-settings-stack section > :is(button.btn-gold, button[class*="bg-gold"]) {
  display: inline-flex !important;
  margin: 12px 16px 16px auto !important;
  min-height: 42px !important;
  padding: 0 16px !important;
  border-radius: 10px !important;
  border: 0 !important;
  background: var(--s-blue) !important;
  color: #fff !important;
  font-weight: 750 !important;
  font-size: 13px !important;
  box-shadow: 0 7px 18px rgba(23, 105, 232, .18);
  width: fit-content;
}
.ps-settings-stack section > div:last-child:has(> button) {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #edf2f7;
  background: #fbfcfe;
}

/* danger */
.ps-settings-stack[data-section="danger"] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.ps-settings-stack[data-section="danger"] > div { display: contents; }
.ps-settings-stack[data-section="danger"] section {
  border-color: #efcbc8 !important;
  background: #fff !important;
  padding: 16px !important;
}
.ps-settings-stack[data-section="danger"] section > h2 {
  color: var(--s-red) !important;
  padding: 0 !important;
  border: 0 !important;
}
.ps-settings-stack[data-section="danger"] section > p:first-of-type {
  border: 0 !important;
  padding: 0 0 12px !important;
  margin: 4px 0 0 !important;
}
.ps-settings-stack[data-section="danger"] section > :is(button, a) {
  background: var(--s-red-soft) !important;
  color: var(--s-red) !important;
  border: 0 !important;
  box-shadow: none !important;
  margin: 0 !important;
}

/* receipt preview */
.ps-settings-stack .ps-receipt-ticket,
.ps-settings-stack iframe {
  border-radius: 12px;
  border: 1px dashed #c8d5e3;
  background: #f9fafc;
}

@media (prefers-reduced-motion: reduce) {
  .ps-category, .ps-settings-switch-track, .ps-settings-switch-thumb { transition: none !important; }
}

@media (max-width: 1050px) {
  .ps-category-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ps-settings-stack[data-section="danger"] { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .ps-settings-shell { padding: 18px 16px 40px; }
  .ps-category-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ps-settings-stack section > label.block {
    grid-template-columns: 1fr !important;
  }
  .ps-settings-stack label.block > :is(input, select, textarea, .flex, div) {
    grid-column: 1 !important;
    grid-row: auto !important;
    justify-self: stretch !important;
    min-width: 0 !important;
    width: 100%;
  }
  .ps-account-ribbon { flex-wrap: wrap; }
}
`;

fs.writeFileSync(CSS, css);
must(css.includes('.ps-category-bar'), 'category bar CSS missing');
must(css.includes('.ps-account-ribbon'), 'account ribbon CSS missing');
must(!css.slice(css.indexOf(MARK)).includes('.ps-shell {'), 'escaped shell rule');
console.log('patched', CSS);
