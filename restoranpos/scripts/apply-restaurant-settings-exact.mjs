#!/usr/bin/env node
/**
 * Parametrlər — EXACT operator mockup (Sistem ayarları HTML).
 *
 * Brief wins: the pasted HTML is the visual authority. Real POS fields and
 * backup APIs stay wired; empty demo-only controls are not invented.
 *
 * Impeccable Operate mode + UI-UX-Pro-Max density 7 / motion 2.
 * Touch floor ≥44px / type ≥12px (mockup's 7–9px demo scale is lifted).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const CSS = path.join(ROOT, 'possistem-system.css');
const MARK = '/* POS_SETTINGS_EXACT_v1 */';
const BUNDLE_MARK = '/* POS_SETTINGS_EXACT_BUNDLE_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

let bundle = fs.readFileSync(BUNDLE, 'utf8');

// Later chrome (or a partial re-apply that dropped BUNDLE_MARK but left the
// mockup shell / CLOSE mark) must not fail the NEWEST launch chain.
if (
  bundle.includes(BUNDLE_MARK)
  || bundle.includes('POS_SETTINGS_EXACT_CLOSE_v1')
  || (bundle.includes('className: "topbar"') && bundle.includes('className: "category-bar"'))
) {
  console.log('bundle already applied');
} else if (!bundle.includes(BUNDLE_MARK)) {
  must(bundle.includes('POS_SETTINGS_FORM_BUNDLE_v1') || bundle.includes('ps-category-bar'), 'form chrome missing');
  must(bundle.includes('const HardDrive = createLucideIcon'), 'HardDrive icon missing');
  must(bundle.includes('function formatSize'), 'formatSize missing');
  must(bundle.includes('window.pos.backup.list'), 'backup.list missing');

  // --- the context this file's own markup consumes -----------------------
  //
  // The rail tells each section whether it is the open one, and both halves of
  // that conversation are written by this script: `SettingsSectionCtx.Provider`
  // below and the `useContext` inside SettingsAccordion. The declaration used
  // to come from apply-restaurant-settings-ui.mjs, which is mark-guarded and
  // exits early once applied - so when its declaration was later replaced out
  // of the bundle, this script kept emitting two references to a name that no
  // longer existed. Parametrlər then threw at render and blanked the whole app,
  // because an undeclared identifier is a ReferenceError, not a missing prop.
  //
  // Declaring it here makes this file self-contained: whatever ran before it,
  // the name it uses exists.
  if (!bundle.includes('const SettingsSectionCtx')) {
    bundle = replaceOnce(
      bundle,
      `function settingsSections(t) {`,
      `const SettingsSectionCtx = reactExports.createContext(null);

function settingsSections(t) {`,
      'settings section context',
    );
  }

  // --- compact backup panel (real API) ------------------------------------
  if (!bundle.includes('function SettingsBackupCompact(')) {
    bundle = replaceOnce(
      bundle,
      `function settingsSections(t) {`,
      `function SettingsBackupCompact() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [backups, setBackups] = reactExports.useState([]);
  const [loading, setLoading] = reactExports.useState(true);
  const [busy, setBusy] = reactExports.useState(false);
  const refresh = reactExports.useCallback(async () => {
    const res = await window.pos.backup.list();
    if (!res.success) {
      toast(res.error.message, "danger");
      setLoading(false);
      return;
    }
    setBackups(res.data?.backups ?? []);
    setLoading(false);
  }, []);
  reactExports.useEffect(() => { void refresh(); }, [refresh]);
  const createBackup = async () => {
    setBusy(true);
    const res = await window.pos.backup.create(void 0, { idempotencyKey: newIdempotencyKey() });
    setBusy(false);
    if (!res.success) { toast(res.error.message, "danger"); return; }
    toast(t.backup.createSuccess, "success");
    await refresh();
  };
  if (loading) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "card", children:
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "cardbody", children: t.common.loading }) });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "workspace", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cardhead", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: t.backup.title }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: t.backup.list })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn primary", disabled: busy, onClick: () => void createBackup(), children: busy ? t.common.loading : "İndi backup et" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "cardbody", children:
        backups.length === 0
          ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-muted", style: { margin: 0, fontSize: "13px" }, children: t.backup.empty })
          : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "backup-timeline", children: backups.slice(0, 8).map((row) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "backup-item", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "bi", children: /* @__PURE__ */ jsxRuntimeExports.jsx(HardDrive, { className: "h-4 w-4" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: row.note || t.backup.create }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: formatSize(row.sizeBytes) + " · " + (row.kind || "uğurlu") })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("time", { children: formatTime$3(row.createdAt) })
            ] }, row.id)) })
      })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "settings-section", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "section-title", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { children: "Avtomatik backup" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "Tam idarə və bərpa üçün ehtiyat nüsxə səhifəsini açın." })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Tam backup səhifəsi" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Bərpa, PIN təsdiqi və qeyd." })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "setting-control", children:
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn outline", onClick: () => navigate("/admin/backup"), children: "Aç" })
        })
      ] })
    ] })
  ] });
}

function settingsSections(t) {`,
      'SettingsBackupCompact',
    );
  }

  // --- 6 categories matching the mockup -----------------------------------
  bundle = replaceOnce(
    bundle,
    `function settingsSections(t) {
  return [
    { id: "restaurant", label: t.settings.sectionRestaurant, hint: "Hesab və qəbz", icon: Store, tone: "blue" },
    { id: "screen", label: t.settings.sectionScreen, hint: "Görünüş və touch", icon: SlidersHorizontal, tone: "purple" },
    { id: "printer", label: t.settings.sectionPrinter, hint: "Qəbz və çap", icon: ReceiptText, tone: "green" },
    { id: "system", label: t.settings.sectionSystem, hint: "POS və bağlantı", icon: Server, tone: "gray" },
    { id: "danger", label: t.settings.dangerZone, hint: "Sıfırla və çıxış", icon: TriangleAlert, tone: "red", danger: true }
  ];
}`,
    `function settingsSections(t) {
  return [
    { id: "restaurant", label: "Restoran", hint: "Hesab və qəbz", icon: Store, tone: "blue" },
    { id: "screen", label: "Ekran və dil", hint: "Görünüş və touch", icon: SlidersHorizontal, tone: "purple" },
    { id: "printer", label: "Printer", hint: "Qəbz və çap", icon: ReceiptText, tone: "green" },
    { id: "system", label: "Cihaz və sistem", hint: "POS və bağlantı", icon: Server, tone: "gray" },
    { id: "backup", label: "Ehtiyat nüsxə", hint: "Backup və bərpa", icon: HardDrive, tone: "amber" },
    { id: "danger", label: "Təhlükəli zona", hint: "Sıfırla və çıxış", icon: TriangleAlert, tone: "red", danger: true }
  ];
}`,
    'six categories',
  );

  // --- chrome: topbar + shell + category-bar ------------------------------
  const oldChrome = `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-page flex h-full flex-col overflow-auto", children: [
    /* POS_SETTINGS_FORM_BUNDLE_v1 */
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
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-section": settingsSection, className: "ps-settings-stack", children: [`;

  must(bundle.includes(oldChrome), 'FORM chrome block not found for exact replace');

  const saveFn = `const saveVisibleSettings = () => {
    const root = document.querySelector(".ps-settings-stack");
    if (!root) return;
    const btns = Array.from(root.querySelectorAll("button")).filter((b) => !b.disabled);
    const hit = btns.find((b) => /saxla|yadda|tətbiq|backup|create|save/i.test(String(b.textContent || "")));
    (hit || btns[btns.length - 1])?.click();
  };`;

  // Inject save helper near settingsSection state if missing
  if (!bundle.includes('const saveVisibleSettings = () =>')) {
    bundle = replaceOnce(
      bundle,
      `const [settingsSection, setSettingsSection] = reactExports.useState("restaurant");`,
      `const [settingsSection, setSettingsSection] = reactExports.useState("restaurant");
  ${saveFn}`,
      'saveVisibleSettings',
    );
  }

  bundle = replaceOnce(
    bundle,
    oldChrome,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-page flex h-full flex-col overflow-auto", children: [
    ${BUNDLE_MARK}
    /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "topbar", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "brandline", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "brandmark", children: "PS" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "brandcopy", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "possistem" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "SİSTEM AYARLARI" })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "hero-actions", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "save-status", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("i", {}),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Saxlanılıb" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn primary", onClick: () => saveVisibleSettings(), children: "Saxla" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "settings-shell", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "settings-hero", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { children: "Sistem ayarları" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: "Restoran, ekran, printer və cihaz sazlamaları." })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("nav", { className: "category-bar", "aria-label": "Sistem ayarları", children:
        settingsSections(t).map((sec) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => setSettingsSection(sec.id),
            "aria-current": settingsSection === sec.id ? "page" : undefined,
            className: "category" + (settingsSection === sec.id ? " active" : "") + (sec.danger ? " danger" : ""),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ci tone-" + sec.tone, children:
                /* @__PURE__ */ jsxRuntimeExports.jsx(sec.icon, { className: "h-4 w-4" }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: sec.label }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: sec.hint })
            ]
          },
          sec.id
        )) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsSectionCtx.Provider, { value: settingsSection, children:
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { "data-section": settingsSection, className: "ps-settings-stack pane active", children: [`,
    'exact chrome',
  );

  // Close: after FORM close we need sticky-save + close main. Current close:
  // ] }) }), ] }), /* POS_SETTINGS_FORM_CLOSE_v1 */ previewHtml
  // We opened: topbar, main, Provider, stack. Previous closed: stack, Provider, shell.
  // New: stack, Provider, main — then sticky-save sibling, then page.
  bundle = replaceOnce(
    bundle,
    `      ] }) : null
    ] }) }),
    ] }),
    /* POS_SETTINGS_FORM_CLOSE_v1 */
    previewHtml ?`,
    `      ] }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "backup", title: "Ehtiyat nüsxə", hint: "Backup və bərpa", children: [
        hasPermission("backup.manage")
          ? /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsBackupCompact, {})
          : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "card", children:
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "cardbody", children: "Bu hesab üçün backup icazəsi yoxdur." }) })
      ] }),
    ] }) }),
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sticky-save show", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Dəyişiklikləri yadda saxlamağı unutmayın" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn primary", onClick: () => saveVisibleSettings(), children: "Dəyişiklikləri saxla" })
    ] }),
    /* POS_SETTINGS_EXACT_CLOSE_v1 */
    previewHtml ?`,
    'backup accordion + sticky + close',
  );

  // Support block → info-strip
  bundle = replaceOnce(
    bundle,
    `/* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.nav.support }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-1 text-sm text-muted", children: t.support.hint }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            className: "touch-target mt-4 inline-flex items-center gap-2 rounded-xl border border-hairline bg-elevated px-4 py-3 text-sm text-cream transition hover:border-gold/40 hover:text-gold",
            onClick: () => navigate("/support"),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(MessageCircle, { className: "h-4 w-4 text-gold" }),
              t.nav.support
            ]
          }
        )
      ] }),
      hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsx(RestaurantInfoSettings, {}) : null`,
    `hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "workspace", children:
        /* @__PURE__ */ jsxRuntimeExports.jsx(RestaurantInfoSettings, {})
      }) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "info-strip", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ii", children: /* @__PURE__ */ jsxRuntimeExports.jsx(MessageCircle, { className: "h-4 w-4" }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "copy", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "Dəstəyə ehtiyac var?" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "Kassa məlumatları avtomatik əlavə olunur." })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn outline", onClick: () => navigate("/support"), children: "Dəstəyə yaz" })
      ] })`,
    'info-strip + workspace',
  );

  // Account ribbon → mockup class names
  bundle = bundle.replaceAll('ps-account-ribbon', 'account-ribbon');
  bundle = bundle.replaceAll('ps-avatar', 'avatar');
  bundle = bundle.replaceAll('ps-account-meta', 'meta');
  bundle = bundle.replaceAll('ps-badge-ok', 'badge');
  bundle = bundle.replaceAll('className: "ps-btn soft"', 'className: "btn soft"');

  // RestaurantInfoSettings → card structure classes on outer section
  bundle = replaceOnce(
    bundle,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("h2", { className: "flex items-center gap-2 font-display text-lg text-cream", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(Store, { className: "h-5 w-5 text-gold" }),
      t.settings.restaurantInfo
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted", children: t.settings.restaurantInfoHint }),`,
    `return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cardhead", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: t.settings.restaurantInfo }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: t.settings.restaurantInfoHint })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cardbody", children: [`,
    'restaurant card shell',
  );

  // Close RestaurantInfoSettings: was `] });` ending section — now need extra closes for cardbody+card
  // Find the end of RestaurantInfoSettings return - iframe then ] });
  bundle = replaceOnce(
    bundle,
    `previewHtml !== null ? /* @__PURE__ */ jsxRuntimeExports.jsx("iframe", { title: "cek-onizleme", sandbox: "allow-same-origin", srcDoc: previewHtml, className: "h-[520px] w-full rounded-xl border border-hairline bg-transparent" }) : null
  ] });
}
const LANGS = [`,
    `previewHtml !== null ? /* @__PURE__ */ jsxRuntimeExports.jsx("iframe", { title: "cek-onizleme", sandbox: "allow-same-origin", srcDoc: previewHtml, className: "receipt-preview-frame" }) : null
  ] })
  ] });
}
const LANGS = [`,
    'restaurant card close',
  );

    // Every name this script's markup mentions has to exist, or the page throws
  // at render and takes the whole app down with it.
  must(bundle.includes('const SettingsSectionCtx = reactExports.createContext(null);'),
       'the settings section context is not declared');

fs.writeFileSync(BUNDLE, bundle);
  console.log('bundle: exact mockup chrome applied');
} else {
  console.log('bundle already applied');
}

// --- CSS: mockup verbatim under .ps-settings-page --------------------------
let css = fs.readFileSync(CSS, 'utf8');
if (css.includes(MARK)) {
  console.log('css already applied');
  process.exit(0);
}

css += `
${MARK}
/* =========================================================================
   Sistem ayarları — exact operator mockup (brief wins)
   ========================================================================= */
.ps-settings-page {
  --bg:#f5f7fb; --surface:#fff; --ink:#10233f; --muted:#74859c; --line:#e1e8f0;
  --blue:#1769e8; --blue-soft:#eaf2ff; --green:#138b69; --green-soft:#eaf8f3;
  --amber:#b8781d; --amber-soft:#fff4e4; --purple:#7e59c8; --purple-soft:#f2edfb;
  --red:#d64037; --red-soft:#fff0ee; --shadow:0 12px 32px rgba(22,48,82,.07); --r:16px;
  background: var(--bg) !important;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}
.ps-settings-page * { box-sizing: border-box; }
.ps-settings-page button { cursor: pointer; font: inherit; }
.ps-settings-page svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

.ps-settings-page .topbar {
  height: 58px; background: rgba(255,255,255,.95); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line); display: flex; align-items: center;
  justify-content: space-between; padding: 0 24px; position: sticky; top: 0; z-index: 20;
}
.ps-settings-page .brandline { display: flex; align-items: center; gap: 10px; }
.ps-settings-page .brandmark {
  width: 34px; height: 34px; border-radius: 10px; background: #0f60d2; color: #fff;
  display: grid; place-items: center; font-size: 12px; font-weight: 900;
}
.ps-settings-page .brandcopy b { display: block; font-size: 13px; }
.ps-settings-page .brandcopy span {
  display: block; font-size: 12px; color: var(--muted); margin-top: 2px; letter-spacing: .7px;
}
.ps-settings-page .hero-actions { display: flex; align-items: center; gap: 9px; }
.ps-settings-page .save-status {
  display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted);
}
.ps-settings-page .save-status i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--green); display: inline-block;
}

.ps-settings-page .btn {
  min-height: 40px; border: 0; border-radius: 10px; padding: 0 14px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  font-size: 12.5px; font-weight: 800; transition: .15s;
}
.ps-settings-page .btn.primary {
  background: var(--blue); color: #fff; box-shadow: 0 7px 18px rgba(23,105,232,.18);
}
.ps-settings-page .btn.primary:hover { background: #0f5fd5; }
.ps-settings-page .btn.soft { background: #eef3f8; color: #42566f; }
.ps-settings-page .btn.soft:hover { background: #e6edf5; }
.ps-settings-page .btn.outline {
  background: #fff; color: #40536c; border: 1px solid var(--line);
}
.ps-settings-page .btn.outline:hover { background: #f8fbff; }
.ps-settings-page .btn.danger { background: var(--red-soft); color: var(--red); }

.ps-settings-page .settings-shell {
  max-width: 1220px; margin: 0 auto; padding: 24px 24px 92px; width: 100%;
}
.ps-settings-page .settings-hero {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 18px; margin-bottom: 16px;
}
.ps-settings-page .settings-hero h1 {
  font-size: 26px; margin: 0 0 5px; letter-spacing: -.6px; color: var(--ink); font-weight: 750;
}
.ps-settings-page .settings-hero p { font-size: 13px; color: var(--muted); margin: 0; }

.ps-settings-page .category-bar {
  display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px;
}
.ps-settings-page .category {
  border: 1px solid var(--line) !important; background: #fff !important; border-radius: 13px !important;
  min-height: 84px; padding: 12px !important; text-align: left; transition: .16s; position: relative;
  box-shadow: 0 4px 14px rgba(20,50,84,.025); color: var(--ink) !important;
  display: flex; flex-direction: column; align-items: flex-start;
}
.ps-settings-page .category:hover { border-color: #cbd8e7 !important; transform: translateY(-1px); }
.ps-settings-page .category.active {
  border-color: #bcd1f4 !important; background: #f8fbff !important;
  box-shadow: 0 7px 20px rgba(23,105,232,.07);
}
.ps-settings-page .category.active:after {
  content: ""; position: absolute; left: 11px; right: 11px; bottom: -1px;
  height: 2px; border-radius: 2px; background: var(--blue);
}
.ps-settings-page .category .ci {
  width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; margin-bottom: 9px;
}
.ps-settings-page .ci.tone-blue { background: var(--blue-soft); color: var(--blue); }
.ps-settings-page .ci.tone-purple { background: var(--purple-soft); color: var(--purple); }
.ps-settings-page .ci.tone-green { background: var(--green-soft); color: var(--green); }
.ps-settings-page .ci.tone-gray { background: #eef3f8; color: #5d6f87; }
.ps-settings-page .ci.tone-amber { background: var(--amber-soft); color: var(--amber); }
.ps-settings-page .ci.tone-red { background: var(--red-soft); color: var(--red); }
.ps-settings-page .category b { display: block; font-size: 13px; font-weight: 750; }
.ps-settings-page .category > span:last-child {
  display: block; font-size: 12px; color: var(--muted); margin-top: 3px; font-weight: 500;
}
.ps-settings-page .category.danger b { color: var(--red); }

.ps-settings-page .ps-settings-stack > div > div:first-child { display: none !important; }
.ps-settings-page .ps-settings-stack { display: flex; flex-direction: column; gap: 12px; }
.ps-settings-page .ps-settings-stack > div { display: flex; flex-direction: column; gap: 12px; }

.ps-settings-page .workspace {
  display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start;
}
.ps-settings-page .workspace.single,
.ps-settings-page .ps-settings-stack[data-section="screen"] > div,
.ps-settings-page .ps-settings-stack[data-section="printer"] > div,
.ps-settings-page .ps-settings-stack[data-section="system"] > div {
  display: flex; flex-direction: column; gap: 12px;
}
.ps-settings-page .ps-settings-stack[data-section="restaurant"] > div > .workspace {
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px;
}

.ps-settings-page .card,
.ps-settings-page .settings-section,
.ps-settings-page .ps-settings-stack section {
  background: #fff !important; border: 1px solid var(--line) !important; border-radius: 14px !important;
  box-shadow: var(--shadow) !important; overflow: hidden; padding: 0 !important; margin: 0 !important;
  backdrop-filter: none !important;
}
.ps-settings-page .cardhead {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 15px 11px; border-bottom: 1px solid #edf2f7;
}
.ps-settings-page .cardhead h2 { font-size: 15px; margin: 0 0 4px; }
.ps-settings-page .cardhead h3 { font-size: 13px; margin: 0 0 4px; }
.ps-settings-page .cardhead p { font-size: 12px; color: var(--muted); margin: 0; }
.ps-settings-page .cardbody { padding: 14px 15px; }

.ps-settings-page .account-ribbon {
  display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid var(--line);
  border-radius: 14px; padding: 12px 14px; box-shadow: var(--shadow); margin-bottom: 0;
}
.ps-settings-page .avatar {
  width: 36px; height: 36px; border-radius: 9px; background: var(--blue); color: #fff;
  display: grid; place-items: center; font-size: 13px; font-weight: 900; flex: 0 0 auto;
}
.ps-settings-page .account-ribbon .meta { flex: 1; min-width: 0; }
.ps-settings-page .account-ribbon .meta b { display: block; font-size: 14px; }
.ps-settings-page .account-ribbon .meta span { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
.ps-settings-page .badge {
  font-size: 12px; font-weight: 800; padding: 5px 9px; border-radius: 999px;
  background: var(--green-soft); color: var(--green);
}

.ps-settings-page .info-strip {
  margin-top: 0; background: #fff; border: 1px solid var(--line); border-radius: 13px;
  padding: 12px 14px; display: flex; align-items: center; gap: 10px; box-shadow: var(--shadow);
}
.ps-settings-page .info-strip .ii {
  width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center;
  background: var(--blue-soft); color: var(--blue); flex: 0 0 auto;
}
.ps-settings-page .info-strip .copy { flex: 1; }
.ps-settings-page .info-strip b { display: block; font-size: 13px; }
.ps-settings-page .info-strip span { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }

.ps-settings-page .section-title { padding: 14px 16px 10px; }
.ps-settings-page .section-title h3 { font-size: 14px; margin: 0 0 4px; }
.ps-settings-page .section-title p { font-size: 12px; color: var(--muted); margin: 0; }
.ps-settings-page .setting-row {
  display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center;
  padding: 14px 16px; border-top: 1px solid #edf2f7;
}
.ps-settings-page .setting-row b { display: block; font-size: 13px; }
.ps-settings-page .setting-row span { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
.ps-settings-page .setting-control { display: flex; align-items: center; gap: 7px; }

/* preference-row treatment for existing labels */
.ps-settings-page .ps-settings-stack section > h2,
.ps-settings-page .ps-settings-stack section > p:first-of-type {
  padding-left: 16px; padding-right: 16px;
}
.ps-settings-page .ps-settings-stack section > h2 {
  margin: 0 !important; padding-top: 14px !important; font-size: 14px !important;
  font-weight: 750 !important; color: var(--ink) !important;
}
.ps-settings-page .ps-settings-stack section > p:first-of-type {
  margin: 4px 0 0 !important; padding-bottom: 12px !important; font-size: 12px !important;
  color: var(--muted) !important; border-bottom: 1px solid #edf2f7;
}
.ps-settings-page .ps-settings-stack section > label.block {
  display: grid !important; grid-template-columns: 1fr auto; gap: 18px; align-items: center;
  margin: 0 !important; padding: 14px 16px !important; border-top: 1px solid #edf2f7 !important;
}
.ps-settings-page .ps-settings-stack label.block > span:first-child {
  font-size: 13px !important; font-weight: 750 !important; color: var(--ink) !important;
  text-transform: none !important; letter-spacing: 0 !important;
}
.ps-settings-page .ps-settings-stack label.block > span:not(:first-child) {
  grid-column: 1; font-size: 12px !important; color: var(--muted) !important;
}
.ps-settings-page .ps-settings-stack label.block > :is(input, select, textarea) {
  grid-column: 2; grid-row: 1 / span 2; min-width: 180px; justify-self: end;
}

.ps-settings-page :is(input[type="text"], input[type="url"], input[type="tel"], input[type="number"],
  input[type="password"], input:not([type]), select, textarea) {
  min-height: 40px !important; border: 1px solid #d2deeb !important; border-radius: 9px !important;
  padding: 8px 10px !important; background: #fff !important; color: var(--ink) !important;
  font-size: 13px !important; outline: 0;
}
.ps-settings-page :is(input, select, textarea):focus-visible {
  border-color: #4d8fea !important; box-shadow: 0 0 0 3px rgba(23,105,232,.07) !important;
}

.ps-settings-page .ps-settings-stack section .grid {
  display: grid !important; grid-template-columns: 1fr 1fr; gap: 10px; padding: 14px 16px;
}
.ps-settings-page .ps-settings-stack section .grid > label.block {
  display: flex !important; flex-direction: column; gap: 6px; padding: 0 !important; border: 0 !important;
}
.ps-settings-page .ps-settings-stack section .grid > label.block > :is(input, select, textarea) {
  min-width: 0; width: 100%; grid-column: auto; grid-row: auto; justify-self: stretch;
}

.ps-settings-page .ps-settings-switch {
  display: grid !important; grid-template-columns: 1fr auto; gap: 18px; align-items: center;
  width: 100% !important; min-height: 56px; margin: 0 !important; padding: 12px 16px !important;
  border: 0 !important; border-top: 1px solid #edf2f7 !important; border-radius: 0 !important;
  background: transparent !important; text-align: left;
}
.ps-settings-page .ps-settings-switch-title { font-size: 13px; font-weight: 750; color: var(--ink); }
.ps-settings-page .ps-settings-switch-hint { font-size: 12px; color: var(--muted); }
.ps-settings-page .ps-settings-switch-track {
  width: 42px; height: 24px; border-radius: 99px; background: #cad6e2; position: relative;
  transition: background .2s;
}
.ps-settings-page .ps-settings-switch-thumb {
  position: absolute; width: 18px; height: 18px; border-radius: 50%; background: #fff;
  left: 3px; top: 3px; box-shadow: 0 1px 4px rgba(0,0,0,.18); transition: transform .2s;
}
.ps-settings-page .ps-settings-switch.is-on .ps-settings-switch-track { background: var(--blue); }
.ps-settings-page .ps-settings-switch.is-on .ps-settings-switch-thumb { transform: translateX(18px); }

.ps-settings-page .ps-settings-stack section .flex.flex-wrap {
  display: inline-flex !important; flex-wrap: wrap !important; gap: 0 !important;
  margin: 12px 16px !important; padding: 3px !important; background: #eef3f8;
  border: 1px solid var(--line); border-radius: 10px; width: fit-content; max-width: calc(100% - 32px);
}
.ps-settings-page .ps-settings-stack section .flex.flex-wrap > button {
  min-height: 36px !important; border: 0 !important; border-radius: 8px !important;
  background: transparent !important; color: #516278 !important; font-size: 12.5px !important;
  font-weight: 700 !important; padding: 0 12px !important; box-shadow: none !important;
}
.ps-settings-page .ps-settings-stack section .flex.flex-wrap > button[class*="bg-gold"],
.ps-settings-page .ps-settings-stack section .flex.flex-wrap > button[class*="border-gold"] {
  background: #fff !important; color: var(--blue) !important;
  box-shadow: 0 1px 2px rgba(21,34,56,.08) !important;
}

.ps-settings-page .ps-settings-commit,
.ps-settings-page .ps-settings-stack section > :is(button[class*="bg-gold"], button.btn-gold) {
  display: inline-flex !important; margin: 12px 16px 16px auto !important;
  min-height: 42px !important; padding: 0 16px !important; border-radius: 10px !important;
  border: 0 !important; background: var(--blue) !important; color: #fff !important;
  font-weight: 750 !important; font-size: 13px !important;
  box-shadow: 0 7px 18px rgba(23,105,232,.18); width: fit-content;
}

.ps-settings-page .receipt-preview-frame {
  height: 420px; width: 100%; border: 1px dashed #c8d5e3; border-radius: 12px;
  background: #f9fafc; margin-top: 12px;
}

.ps-settings-page .backup-timeline { display: grid; gap: 0; }
.ps-settings-page .backup-item {
  display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center; padding: 10px 0;
}
.ps-settings-page .backup-item + .backup-item { border-top: 1px solid #edf2f7; }
.ps-settings-page .backup-item .bi {
  width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
  background: var(--green-soft); color: var(--green);
}
.ps-settings-page .backup-item b { display: block; font-size: 13px; }
.ps-settings-page .backup-item span { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
.ps-settings-page .backup-item time { font-size: 12px; color: #5b6e86; }

.ps-settings-page .ps-settings-stack[data-section="danger"] {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.ps-settings-page .ps-settings-stack[data-section="danger"] > div { display: contents; }
.ps-settings-page .ps-settings-stack[data-section="danger"] section {
  border-color: #efcbc8 !important; padding: 16px !important;
}
.ps-settings-page .ps-settings-stack[data-section="danger"] section > h2 {
  color: var(--red) !important; padding: 0 !important; border: 0 !important;
}
.ps-settings-page .ps-settings-stack[data-section="danger"] section > p:first-of-type {
  border: 0 !important; padding: 0 0 12px !important; margin: 4px 0 0 !important;
}
.ps-settings-page .ps-settings-stack[data-section="danger"] section > button {
  background: var(--red-soft) !important; color: var(--red) !important; border: 0 !important;
  box-shadow: none !important; margin: 0 !important;
}

.ps-settings-page .sticky-save {
  position: fixed; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,.95);
  backdrop-filter: blur(12px); border-top: 1px solid var(--line); padding: 10px 24px;
  display: flex; align-items: center; justify-content: flex-end; gap: 10px; z-index: 25;
}
.ps-settings-page .sticky-save span { font-size: 12px; color: var(--muted); margin-right: auto; }

/* kill older layout leftovers inside this page */
.ps-settings-page .ps-settings-nav,
.ps-settings-page .ps-settings-mobile,
.ps-settings-page .ps-settings-layout,
.ps-settings-page .ps-eyebrow,
.ps-settings-page .gold-rule { display: none !important; }

@media (prefers-reduced-motion: reduce) {
  .ps-settings-page .category, .ps-settings-page .ps-settings-switch-track,
  .ps-settings-page .ps-settings-switch-thumb { transition: none !important; }
}
@media (max-width: 1050px) {
  .ps-settings-page .category-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ps-settings-page .workspace { grid-template-columns: 1fr; }
  .ps-settings-page .ps-settings-stack[data-section="danger"] { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .ps-settings-page .settings-shell { padding: 18px 16px 92px; }
  .ps-settings-page .category-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ps-settings-page .ps-settings-stack section > label.block { grid-template-columns: 1fr !important; }
  .ps-settings-page .ps-settings-stack label.block > :is(input, select, textarea) {
    grid-column: 1 !important; grid-row: auto !important; justify-self: stretch !important; min-width: 0 !important; width: 100%;
  }
  .ps-settings-page .account-ribbon { flex-wrap: wrap; }
  .ps-settings-page .ps-settings-stack section .grid { grid-template-columns: 1fr; }
}
`;

fs.writeFileSync(CSS, css);
must(css.includes('.category-bar'), 'category-bar CSS missing');
must(css.includes('.sticky-save'), 'sticky-save CSS missing');
must(css.includes('tone-amber'), 'backup amber tone missing');
console.log('patched', CSS);
