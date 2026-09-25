#!/usr/bin/env node
/**
 * Parametrlər as a rail and a panel, and an end to the stranger's QR code.
 *
 * The page already held every group the design asks for - restaurant, screen,
 * printer, system, danger zone - as five `<details>` accordions stacked in one
 * long scroll. Nothing needed rewriting; what was missing was the shape. So the
 * sections stay exactly as they are and a rail on the left decides which one is
 * on screen. 52 KB of working printer, display and update logic is not touched.
 *
 * The rail lists the five sections that exist. The mockup drew nine - Kassa,
 * Masa və zal, Mətbəx among them - and those have no settings behind them in
 * this build; an empty section that opens onto nothing is not a section.
 *
 * Second thing, found while reading the receipt path: `receipt.qrUrl` ships
 * seeded with "https://2gis.az/baku/geo/70030076175156383" and `printer.qr`
 * defaults to on, so every till prints a QR sending the guest to one particular
 * pin in Baku - not the restaurant holding the receipt. The URL and the switch
 * get a real control here, in the printer section, where the receipt preview
 * already lives. Clearing the field prints no QR at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_SETTINGS_UI_v1 */';

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

for (const icon of ['Store', 'ReceiptText', 'Server', 'TriangleAlert', 'SlidersHorizontal']) {
  must(s.includes(`const ${icon} = createLucideIcon`), `${icon} is not in the bundle`);
}
must(s.includes('reactExports.createContext'), 'createContext is not available');
must(s.includes('reactExports.useContext'), 'useContext is not available');

// --- the section a rail can select ----------------------------------------
s = replaceOnce(
  s,
  `function SettingsAccordion({ id, title, hint, children, danger = false }) {`,
  `const SettingsSectionCtx = reactExports.createContext(null);

/** The five sections the rail offers, in the order an operator meets them. */
function settingsSections(t) {
  return [
    { id: "restaurant", label: t.settings.sectionRestaurant, icon: Store },
    { id: "screen", label: t.settings.sectionScreen, icon: SlidersHorizontal },
    { id: "printer", label: t.settings.sectionPrinter, icon: ReceiptText },
    { id: "system", label: t.settings.sectionSystem, icon: Server },
    { id: "danger", label: t.settings.dangerZone, icon: TriangleAlert, danger: true }
  ];
}

function SettingsAccordion({ id, title, hint, children, danger = false }) {
  // Inside the rail the section is either the open one or not rendered at all;
  // the accordion below is the fallback for anywhere without a provider.
  const picked = reactExports.useContext(SettingsSectionCtx);
  if (picked !== null) {
    if (picked !== id) return null;
    return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-xl text-cream", style: danger ? { color: "var(--ps-danger)" } : null, children: title }),
        hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: hint }) : null
      ] }),
      children
    ] });
  }
  return SettingsAccordionDetails({ id, title, hint, children, danger });
}

function SettingsAccordionDetails({ id, title, hint, children, danger = false }) {`,
  'settings section context',
);

// --- the rail ------------------------------------------------------------
s = replaceOnce(
  s,
  `    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-stack w-full space-y-3 p-6", children: [`,
  `    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex min-h-0 flex-1 gap-4 p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("nav", { className: "hidden w-56 shrink-0 flex-col gap-1 sm:flex", "aria-label": t.settings.title, children:
        settingsSections(t).map((sec) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => setSettingsSection(sec.id),
            className: settingsSection === sec.id
              ? "touch-target flex items-center gap-3 rounded-xl border border-gold/40 bg-gold/15 px-3 py-2 text-left text-sm text-gold"
              : "touch-target flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left text-sm text-muted hover:text-cream",
            style: sec.danger && settingsSection !== sec.id ? { color: "var(--ps-danger)" } : null,
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(sec.icon, { className: "h-4 w-4 shrink-0" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "truncate", children: sec.label })
            ]
          },
          sec.id
        )) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "min-w-0 flex-1", children:
        /* @__PURE__ */ jsxRuntimeExports.jsx("select", {
          value: settingsSection,
          onChange: (e) => setSettingsSection(e.target.value),
          "aria-label": t.settings.title,
          className: "mb-3 min-h-11 w-full rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream sm:hidden",
          children: settingsSections(t).map((sec) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: sec.id, children: sec.label }, sec.id))
        }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsSectionCtx.Provider, { value: settingsSection, children:
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-stack min-w-0 flex-1 space-y-3", children: [`,
  'settings rail',
);

// Close the two wrappers the rail opened, where the stack's children end -
// found by brace-matching the stack, not by guessing at the tail of the file.
s = replaceOnce(
  s,
  `      ] }) : null
    ] }),
    previewHtml ?`,
  `      ] }) : null
    ] }) }),
    ] }),
    previewHtml ?`,
  'settings rail close',
);

// --- the state the rail reads --------------------------------------------
s = replaceOnce(
  s,
  `  const [resetPhrase, setResetPhrase] = reactExports.useState("");`,
  `  const [settingsSection, setSettingsSection] = reactExports.useState("restaurant");
  const [qrUrl, setQrUrl] = reactExports.useState("");
  const [qrOn, setQrOn] = reactExports.useState(true);
  const [savingQr, setSavingQr] = reactExports.useState(false);
  reactExports.useEffect(() => {
    void window.pos.settings.getAll().then((res) => {
      if (!res.success) return;
      const all = res.data?.settings ?? {};
      setQrUrl(typeof all["receipt.qrUrl"] === "string" ? all["receipt.qrUrl"] : "");
      setQrOn(String(all["printer.qr"] ?? "1") !== "0");
    });
  }, []);
  const [resetPhrase, setResetPhrase] = reactExports.useState("");`,
  'qr state',
);

// --- the control, in the printer section where the receipt already is -----
s = replaceOnce(
  s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "system", title: t.settings.sectionSystem, hint: t.settings.sectionSystemHint, children: [`,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: "Çek QR-ı" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted", children: "Çekin altında çap olunan QR qonağı bu ünvana yönəldir. Boş buraxsanız QR çap olunmur." }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "flex items-center gap-3 text-sm text-cream", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "checkbox", checked: qrOn, onChange: (e) => setQrOn(e.target.checked), style: { width: "17px", height: "17px" } }),
          "QR çap olunsun"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xs uppercase tracking-wide text-faint", children: "QR ünvanı" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", {
            type: "url",
            value: qrUrl,
            disabled: !qrOn,
            placeholder: "https://…",
            onChange: (e) => setQrUrl(e.target.value),
            className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 font-mono text-xs text-cream outline-none focus:border-gold/40 disabled:opacity-40"
          })
        ] }),
        qrOn && qrUrl.includes("70030076175156383")
          ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm", style: { color: "var(--ps-warn)" }, children: "Bu, quraşdırma ilə gələn nümunə ünvandır — sizin restoranınıza aid deyil. Öz ünvanınızı yazın və ya QR-ı söndürün." })
          : null,
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            disabled: savingQr,
            onClick: async () => {
              setSavingQr(true);
              const a = await window.pos.settings.set("printer.qr", qrOn ? "1" : "0");
              const b = await window.pos.settings.set("receipt.qrUrl", qrUrl.trim());
              setSavingQr(false);
              if (!a.success || !b.success) {
                toast((a.success ? b : a).error.message, "danger");
                return;
              }
              toast("QR ayarı saxlanıldı", "success");
            },
            className: "touch-target rounded-xl border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold disabled:opacity-40",
            children: savingQr ? "…" : "Yadda saxla"
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "system", title: t.settings.sectionSystem, hint: t.settings.sectionSystemHint, children: [`,
  'qr control',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('const SettingsSectionCtx = reactExports.createContext(null);'), 'context missing');
must(s.includes('function settingsSections(t) {'), 'rail list missing');
must(s.includes('SettingsSectionCtx.Provider'), 'provider missing');
must(s.includes('function SettingsAccordionDetails('), 'the accordion fallback was lost');
must(s.includes('setSettingsSection(sec.id)'), 'the rail does not switch sections');
must(s.includes('Çek QR-ı'), 'the QR control is missing');
// A regex literal here loses its backslashes to the template string and
// becomes broken JS; the demo url is matched as plain text instead.
must(!/\/2gis\.az\//.test(s), 'a regex literal crept back into the template');
must(s.includes('window.pos.settings.set("receipt.qrUrl"'), 'the QR url is not saved');
must(s.includes('window.pos.settings.set("printer.qr"'), 'the QR switch is not saved');
// Every section the rail offers must still be declared on the page.
for (const id of ['restaurant', 'screen', 'printer', 'system', 'danger']) {
  must(s.includes(`SettingsAccordion, { id: "${id}"`), `${id} section lost`);
}
// The mockup's empty sections must not appear: they have nothing behind them.
for (const absent of ['Kassa və ödəniş', 'Masa və zal']) {
  must(!s.includes(`label: "${absent}"`), `${absent} has no settings behind it`);
}

console.log('patched', BUNDLE);
