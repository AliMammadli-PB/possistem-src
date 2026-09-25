#!/usr/bin/env node
/**
 * Restaurant till UX: Parametrlər is device settings, İdarə is admin.
 * Idempotent patches against the checked-in renderer bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_UX_IA_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

function insertAfter(src, find, extra, label) {
  return replaceOnce(src, find, find + extra, label);
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('already applied');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
s = insertAfter(
  s,
  `settings: "Parametrlər",
    audit: "Audit",`,
  `
    admin: "İdarə",`,
  'az nav.admin',
);
s = insertAfter(
  s,
  `settings: "Settings",
    audit: "Audit",`,
  `
    admin: "Admin",`,
  'en nav.admin',
);
s = insertAfter(
  s,
  `settings: "Ayarlar",
    audit: "Denetim",`,
  `
    admin: "Yönetim",`,
  'tr nav.admin',
);

s = insertAfter(
  s,
  `title: "İdarə paneli",
    todaySales: "Bu gün satış",`,
  `
    goTables: "Masalara keç",
    emptyNext: "Satış yoxdur. Növbəni masalardan başladın.",`,
  'az dashboard empty',
);
s = insertAfter(
  s,
  `title: "Dashboard",
    todaySales: "Today sales",`,
  `
    goTables: "Go to tables",
    emptyNext: "No sales yet. Start the shift from the floor.",`,
  'en dashboard empty',
);
s = insertAfter(
  s,
  `title: "Panel",
    todaySales: "Bugünkü satış",`,
  `
    goTables: "Masalara geç",
    emptyNext: "Satış yok. Vardiyayı masalardan başlatın.",`,
  'tr dashboard empty',
);

s = insertAfter(
  s,
  `newProduct: "Yeni məhsul",
    editProduct: "Məhsulu redaktə et",`,
  `
    moreLocales: "TR / EN adlar",
    editCategories: "Kateqoriyaları redaktə et",
    closeEditor: "Bağla",`,
  'az catalog extras',
);
s = insertAfter(
  s,
  `newProduct: "New product",
    editProduct: "Edit product",`,
  `
    moreLocales: "TR / EN names",
    editCategories: "Edit categories",
    closeEditor: "Close",`,
  'en catalog extras',
);
s = insertAfter(
  s,
  `newProduct: "Yeni ürün",
    editProduct: "Ürünü düzenle",`,
  `
    moreLocales: "TR / EN adlar",
    editCategories: "Kategorileri düzenle",
    closeEditor: "Kapat",`,
  'tr catalog extras',
);

s = replaceOnce(
  s,
  `    confirmDeleteTable: "Bu masa silinsin?",
    deleted: "Silindi"
  },
  gifts: {
    title: "Hədiyyə kampaniyaları",`,
  `    confirmDeleteTable: "Bu masa silinsin?",
    deleted: "Silindi",
    editArea: "Zalı redaktə et",
    renameArea: "Adı dəyiş"
  },
  gifts: {
    title: "Hədiyyə kampaniyaları",`,
  'az adminTables editArea',
);
s = replaceOnce(
  s,
  `    confirmDeleteTable: "Delete this table?",
    deleted: "Deleted"
  },
  gifts: {`,
  `    confirmDeleteTable: "Delete this table?",
    deleted: "Deleted",
    editArea: "Edit zone",
    renameArea: "Rename"
  },
  gifts: {`,
  'en adminTables editArea',
);
s = replaceOnce(
  s,
  `    deleted: "Silindi"
  },
  gifts: {
    title: "Hediye kampanyaları",`,
  `    deleted: "Silindi",
    editArea: "Salonu düzenle",
    renameArea: "Adı değiştir"
  },
  gifts: {
    title: "Hediye kampanyaları",`,
  'tr adminTables editArea',
);

s = s.replace(
  `wrongCredentials: "Email və ya parol yanlışdır",`,
  `wrongCredentials: "Email və ya parol səhvdir",`,
);

s = insertAfter(
  s,
  `adminHub: "İdarə",
    adminHubHint: "İdarəetmə və hesabat səhifələri",`,
  `
    deviceHint: "Bu kassanın cihaz və sistem ayarları — kataloq, işçilər və hesabatlar İdarə bölməsindədir.",
    sectionRestaurant: "Restoran",
    sectionRestaurantHint: "Qəbz başlığı və restoran hesabı",
    sectionScreen: "Ekran və dil",
    sectionScreenHint: "Ölçü, miqyas, dil və hərəkət",
    sectionPrinter: "Printer",
    sectionPrinterHint: "Çek aparatı və kağız",
    sectionSystem: "Sistem",
    sectionSystemHint: "Yeniləmə, WhatsApp, loglar",
    dangerZone: "Təhlükəli zona",
    dangerZoneHint: "Bütün əməliyyat məlumatını sıfırlayır. Geri qaytarılmır.",
    resetDb: "Bütün bazanı sıfırla",
    resetDbPhrase: "Təsdiq üçün SIFIRLA yazın",
    resetDbPhraseValue: "SIFIRLA",
    resetDbPin: "Menecer / admin PIN",
    resetDbOk: "Baza sıfırlandı — proqramı yenidən başladın",
    resetDbNeedPhrase: "Əvvəlcə SIFIRLA yazın",
    resetDbNeedPin: "PIN tələb olunur",
    moreDetails: "Ətraflı",
    hideDetails: "Gizlət",
    statusActive: "Aktiv",
    statusExpired: "Müddət bitib",
    statusGrace: "Güzəşt müddəti",
    statusUnknown: "Naməlum",
    whatsappOpen: "WhatsApp botu",`,
  'az settings IA',
);
s = insertAfter(
  s,
  `adminHub: "Administration",
    adminHubHint: "Management and reporting pages",`,
  `
    deviceHint: "Device and system settings for this till — catalog, staff and reports live under Admin.",
    sectionRestaurant: "Restaurant",
    sectionRestaurantHint: "Receipt header and account",
    sectionScreen: "Display and language",
    sectionScreenHint: "Size, zoom, language and motion",
    sectionPrinter: "Printer",
    sectionPrinterHint: "Receipt printer and paper",
    sectionSystem: "System",
    sectionSystemHint: "Updates, WhatsApp, logs",
    dangerZone: "Danger zone",
    dangerZoneHint: "Resets operational data. This cannot be undone.",
    resetDb: "Reset the entire database",
    resetDbPhrase: "Type RESET to confirm",
    resetDbPhraseValue: "RESET",
    resetDbPin: "Manager / admin PIN",
    resetDbOk: "Database reset — restart the app",
    resetDbNeedPhrase: "Type RESET first",
    resetDbNeedPin: "PIN required",
    moreDetails: "Details",
    hideDetails: "Hide",
    statusActive: "Active",
    statusExpired: "Expired",
    statusGrace: "Grace period",
    statusUnknown: "Unknown",
    whatsappOpen: "WhatsApp bot",`,
  'en settings IA',
);
s = insertAfter(
  s,
  `adminHub: "Yönetim",
    adminHubHint: "Yönetim ve rapor sayfaları",`,
  `
    deviceHint: "Bu kasanın cihaz ve sistem ayarları — katalog, personel ve raporlar Yönetim bölümündedir.",
    sectionRestaurant: "Restoran",
    sectionRestaurantHint: "Fiş başlığı ve hesap",
    sectionScreen: "Ekran ve dil",
    sectionScreenHint: "Ölçü, ölçek, dil ve hareket",
    sectionPrinter: "Yazıcı",
    sectionPrinterHint: "Fiş yazıcısı ve kağıt",
    sectionSystem: "Sistem",
    sectionSystemHint: "Güncelleme, WhatsApp, günlükler",
    dangerZone: "Tehlikeli bölge",
    dangerZoneHint: "Operasyonel veriyi sıfırlar. Geri alınamaz.",
    resetDb: "Tüm veritabanını sıfırla",
    resetDbPhrase: "Onay için SIFIRLA yazın",
    resetDbPhraseValue: "SIFIRLA",
    resetDbPin: "Yönetici PIN",
    resetDbOk: "Veritabanı sıfırlandı — uygulamayı yeniden başlatın",
    resetDbNeedPhrase: "Önce SIFIRLA yazın",
    resetDbNeedPin: "PIN gerekli",
    moreDetails: "Ayrıntılar",
    hideDetails: "Gizle",
    statusActive: "Aktif",
    statusExpired: "Süresi doldu",
    statusGrace: "Ek süre",
    statusUnknown: "Bilinmiyor",
    whatsappOpen: "WhatsApp botu",`,
  'tr settings IA',
);

// ---------------------------------------------------------------------------
// Helpers + AdminHub + accordion
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `function RestaurantInfoSettings() {`,
  `${MARK}
function isFloorPath(pathname) {
  return /^(?:\\/tables|\\/orders\\/|\\/payments\\/|\\/receipts\\/|\\/kds)/.test(pathname || "");
}
function formatTillDate(date, lang) {
  const daysAz = ["bazar", "bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə"];
  const monthsAz = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
  if (lang === "az") {
    return daysAz[date.getDay()] + ", " + date.getDate() + " " + monthsAz[date.getMonth()];
  }
  const locale = lang === "tr" ? "tr-TR" : "en-GB";
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(date);
}
function SettingsAccordion({ id, title, hint, children, danger = false }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "ps-settings-acc" + (danger ? " ps-settings-danger" : ""), defaultOpen: id === "restaurant", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("summary", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "ps-settings-acc-copy", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-display text-lg text-cream", children: title }),
        hint ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-acc-kicker", children: hint }) : null
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ps-settings-acc-mark", "aria-hidden": true, children: "+" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ps-settings-acc-body", children })
  ] });
}
function AdminHubPage() {
  const { t } = useI18n();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const links = [
    { to: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard, show: hasPermission("reports.view") },
    { to: "/admin/tables", label: t.nav.adminTables, icon: LayoutGrid, show: hasPermission("tables.layout") },
    { to: "/admin/catalog", label: t.nav.catalog, icon: UtensilsCrossed, show: hasPermission("catalog.manage") },
    { to: "/admin/staff", label: t.nav.staff, icon: Users, show: hasPermission("users.manage") },
    { to: "/admin/reports", label: t.nav.reports, icon: FileChartColumnIncreasing, show: hasPermission("reports.view") },
    { to: "/admin/backup", label: t.nav.backup, icon: HardDrive, show: hasPermission("backup.manage") },
    { to: "/reconcile", label: t.nav.reconcile, icon: CircleDollarSign, show: hasPermission("payment.reconcile") },
    { to: "/audit", label: t.nav.audit, icon: ClipboardList, show: hasPermission("audit.view") },
    { to: "/settings/license", label: t.nav.license, icon: Key, show: true },
    { to: "/diagnostics", label: t.nav.diagnostics, icon: ShieldAlert, show: hasPermission("settings.manage") }
  ].filter((l) => l.show);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex h-full flex-col overflow-auto", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "border-b border-hairline px-6 py-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-settings-title font-display text-2xl text-cream", children: t.nav.admin }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-settings-hint", children: t.settings.adminHubHint })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mx-auto w-full max-w-3xl p-6", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid gap-2 sm:grid-cols-2", children: links.map(({ to, label, icon: Icon2 }) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      Link,
      {
        to,
        className: "touch-target flex items-center gap-3 rounded-xl border border-hairline bg-elevated px-4 py-3 text-sm text-cream transition hover:border-gold/40 hover:text-gold",
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon2, { className: "h-4 w-4 shrink-0 text-gold" }),
          label
        ]
      },
      to
    )) }) })
  ] });
}
function RestaurantInfoSettings() {`,
  'helpers + AdminHub',
);

// ---------------------------------------------------------------------------
// SettingsPage: state + reset + drop admin tile dump
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [confirm, confirmDialog] = useConfirm();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);`,
  `function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const [confirm, confirmDialog] = useConfirm();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [resetPhrase, setResetPhrase] = reactExports.useState("");
  const [resetPin, setResetPin] = reactExports.useState("");
  const [resetting, setResetting] = reactExports.useState(false);
  const runOperationalReset = async () => {
    const needed = t.settings.resetDbPhraseValue || "SIFIRLA";
    if (resetPhrase.trim() !== needed) {
      toast(t.settings.resetDbNeedPhrase, "warning");
      return;
    }
    if (!resetPin.trim()) {
      toast(t.settings.resetDbNeedPin, "warning");
      return;
    }
    if (!await confirm(t.settings.dangerZoneHint, { danger: true, title: t.settings.resetDb })) return;
    setResetting(true);
    const pinApi = window.pos.auth.verifyManagerPin || window.pos.auth.verifyPin;
    if (pinApi) {
      const pinRes = await pinApi(resetPin.trim());
      if (!pinRes?.success) {
        setResetting(false);
        toast(pinRes?.error?.message || t.settings.resetDbNeedPin, "danger");
        return;
      }
    }
    const resetFn = window.pos.system?.resetOperational;
    if (!resetFn) {
      setResetting(false);
      toast(t.common.error, "danger");
      return;
    }
    const res = await resetFn({}, { idempotencyKey: newIdempotencyKey() });
    setResetting(false);
    if (!res.success) {
      toast(res.error.message, "danger");
      return;
    }
    setResetPhrase("");
    setResetPin("");
    toast(t.settings.resetDbOk, "success");
  };`,
  'SettingsPage state',
);

const adminHubBlockStart = `      adminLinks.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.adminHub }),`;
must(s.includes(adminHubBlockStart), 'admin hub block missing');

s = replaceOnce(
  s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "font-display text-2xl text-cream", children: t.settings.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "gold-rule mt-3 w-28 opacity-50" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mx-auto w-full max-w-2xl space-y-6 p-6", children: [`,
  `      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-settings-title font-display text-2xl text-cream", children: t.settings.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-settings-hint", children: t.settings.deviceHint }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "gold-rule mt-3 w-28 opacity-50" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-settings-stack mx-auto w-full max-w-2xl space-y-3 p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "restaurant", title: t.settings.sectionRestaurant, hint: t.settings.sectionRestaurantHint, children: [`,
  'settings header + restaurant accordion open',
);

// Close restaurant accordion after RestaurantInfoSettings, then open screen accordion
s = replaceOnce(
  s,
  `      hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsx(RestaurantInfoSettings, {}) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.language }),`,
  `      hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsx(RestaurantInfoSettings, {}) : null
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "screen", title: t.settings.sectionScreen, hint: t.settings.sectionScreenHint, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.language }),`,
  'close restaurant / open screen',
);

// After reduce-motion section, skip updates+display grouping by wrapping display into screen
// Current order: language, motion, updates, display, printer, extras
// Insert close screen before updates, wrap updates later.

s = replaceOnce(
  s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.updates }),`,
  `      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.updates }),`,
  'close screen before updates — TEMP wrong, fix next',
);

// Wait, I closed screen too early - display is after updates. Need to move display into screen.
// Re-open: I closed screen after motion and started updates as a section still.
// I'll wrap display into screen by moving it - too hard now.
// Instead close screen after display.

// Undo the premature close: I replaced updates section start with `] }),` + updates section.
// That closed screen before updates, leaving display outside. I'll wrap display into screen by
// changing the close to happen after display.

// Find display section start and the premature `] }),` I just added before updates.
// I'll move that closer after display section.

// The display section ends right before printer section.
s = replaceOnce(
  s,
  `      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.updates }),`,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.updates }),`,
  'revert premature screen close',
);

// After display apply button section, before printer, close screen and open printer + later system.
// Display section is `glass space-y-3` with h2 t.settings.display
// Printer section follows with t.settings.printer

s = replaceOnce(
  s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.printer }),`,
  `      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "printer", title: t.settings.sectionPrinter, hint: t.settings.sectionPrinterHint, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: t.settings.printer }),`,
  'close screen / open printer accordion',
);

// After printer section (before logs section), close printer and open system
s = replaceOnce(
  s,
  `      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass space-y-3 rounded-2xl p-5", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => void openLogs(),`,
  `      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "system", title: t.settings.sectionSystem, hint: t.settings.sectionSystemHint, children: [
      hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsxs(
        Link,
        {
          to: "/settings/whatsapp",
          className: "touch-target flex w-full items-center justify-between rounded-xl border border-hairline bg-elevated px-4 py-3 text-left text-sm text-cream hover:border-gold/40",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.settings.whatsappOpen }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "→" })
          ]
        }
      ) : null,
      /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            onClick: () => void openLogs(),`,
  'close printer / open system',
);

// Remove diagnostics link from settings extras; add danger zone; close system accordion
s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          Link,
          {
            to: "/diagnostics",
            className: "touch-target flex w-full items-center justify-between rounded-xl border border-hairline bg-elevated px-4 py-3 text-left text-sm text-muted hover:text-cream",
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: t.nav.diagnostics }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "→" })
            ]
          }
        )
      ] })
    ] }),
    confirmDialog`,
  `      ] })
      ] }),
      hasPermission("system.reset") || hasPermission("settings.manage") ? /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "danger", title: t.settings.dangerZone, hint: t.settings.dangerZoneHint, danger: true, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-muted", children: t.settings.dangerZoneHint }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.settings.resetDbPhrase }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: resetPhrase, onChange: (e) => setResetPhrase(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: t.settings.resetDbPin }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "password", inputMode: "numeric", value: resetPin, onChange: (e) => setResetPin(e.target.value.replace(/\\D/g, "").slice(0, 8)), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-3 text-cream outline-none focus:border-gold/50" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", disabled: resetting, onClick: () => void runOperationalReset(), className: "touch-target w-full rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger hover:bg-danger/15 disabled:opacity-40", children: resetting ? t.common.loading : t.settings.resetDb })
      ] }) : null
    ] }),
    confirmDialog`,
  'danger zone + close system',
);

// Remove the admin tile dump
s = s.replace(
  /      adminLinks\.length > 0 && \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsxs\("section", \{ className: "glass rounded-2xl p-5", children: \[\n        \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsx\("h2", \{ className: "font-display text-lg text-cream", children: t\.settings\.adminHub \}\),\n        \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsx\("p", \{ className: "mt-1 text-sm text-muted", children: t\.settings\.adminHubHint \}\),\n        \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsx\("div", \{ className: "mt-4 grid gap-2 sm:grid-cols-2", children: adminLinks\.map\(\(\{ to, label, icon: Icon2 \}\) => \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsxs\(\n          Link,\n          \{\n            to,\n            className: "touch-target flex items-center gap-3 rounded-xl border border-hairline bg-elevated px-4 py-3 text-sm text-cream transition hover:border-gold\/40 hover:text-gold",\n            children: \[\n              \/\* @__PURE__ \*\/ jsxRuntimeExports\.jsx\(Icon2, \{ className: "h-4 w-4 shrink-0 text-gold" \}\),\n              label\n            \]\n          \},\n          to\n        \)\) \}\)\n      \] \}\),\n/,
  '',
);

must(!s.includes('t.settings.adminHub }),'), 'admin hub title still in SettingsPage');

// ---------------------------------------------------------------------------
// AppShell — service vs admin chrome
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `function AppShell() {
  const session = useAuthStore((s) => s.session);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { t } = useI18n();
  const navigate = useNavigate();
  const logout = async () => {
    await window.pos.auth.logout();
    toast(t.nav.logout, "info");
    navigate("/login", { replace: true });
  };
  const links = [
    { to: "/tables", label: t.nav.tables, icon: Table2, show: true },
    {
      to: "/dashboard",
      label: t.nav.dashboard,
      icon: ChartColumn,
      show: hasPermission("reports.view")
    },
    {
      to: "/kds",
      label: t.nav.kds,
      icon: Soup,
      show: hasPermission("kds.operate")
    },
    {
      to: "/admin/catalog",
      label: t.nav.catalog,
      icon: Utensils,
      show: hasPermission("catalog.manage")
    },
    {
      to: "/admin/gifts",
      label: t.nav.gifts,
      icon: Gift,
      show: hasPermission("gifts.manage")
    },
    {
      to: "/settings",
      label: t.nav.settings,
      icon: Settings,
      show: true
    }
  ];`,
  `function AppShell() {
  const session = useAuthStore((s) => s.session);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const floorMode = isFloorPath(location.pathname);
  const canAdmin = hasPermission("reports.view") || hasPermission("catalog.manage") || hasPermission("settings.manage") || hasPermission("users.manage") || hasPermission("tables.layout") || hasPermission("backup.manage");
  const logout = async () => {
    await window.pos.auth.logout();
    toast(t.nav.logout, "info");
    navigate("/login", { replace: true });
  };
  const serviceLinks = [
    { to: "/tables", label: t.nav.tables, icon: Table2, show: true },
    { to: "/kds", label: t.nav.kds, icon: Soup, show: hasPermission("kds.operate") }
  ];
  const adminLinksNav = [
    { to: "/admin", label: t.nav.admin, icon: LayoutDashboard, show: canAdmin },
    { to: "/dashboard", label: t.nav.dashboard, icon: ChartColumn, show: !floorMode && hasPermission("reports.view") },
    { to: "/admin/catalog", label: t.nav.catalog, icon: Utensils, show: !floorMode && hasPermission("catalog.manage") },
    { to: "/admin/gifts", label: t.nav.gifts, icon: Gift, show: !floorMode && hasPermission("gifts.manage") },
    { to: "/settings", label: t.nav.settings, icon: Settings, show: !floorMode }
  ];
  const links = [...serviceLinks, ...adminLinksNav];`,
  'AppShell floor chrome',
);

s = replaceOnce(
  s,
          `          hasPermission("settings.manage") && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              className: "mb-1 flex min-h-10 w-full items-center justify-center gap-3 rounded-lg px-2 py-2 text-left text-xs text-faint hover:bg-elevated hover:text-gold 2xl:justify-start 2xl:px-3",
              title: t.nav.diagnostics,
              onClick: () => navigate("/diagnostics"),
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldAlert, { className: "h-4 w-4", strokeWidth: 1.6 }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hidden 2xl:block", children: t.nav.diagnostics })
              ]
            }
          ),`,
  `          !floorMode && hasPermission("settings.manage") && /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              className: "mb-1 flex min-h-10 w-full items-center justify-center gap-3 rounded-lg px-2 py-2 text-left text-xs text-faint hover:bg-elevated hover:text-gold 2xl:justify-start 2xl:px-3",
              title: t.nav.diagnostics,
              onClick: () => navigate("/diagnostics"),
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(ShieldAlert, { className: "h-4 w-4", strokeWidth: 1.6 }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hidden 2xl:block", children: t.nav.diagnostics })
              ]
            }
          ),`,
  'hide diagnostics on floor',
);

s = replaceOnce(
  s,
  `            className: ({ isActive }) => \`group relative flex min-h-11 items-center justify-center gap-3 rounded-lg px-2 py-2.5 text-[13px] font-medium transition 2xl:justify-start 2xl:px-3 \${isActive ? "bg-oxblood/70 text-cream shadow-[inset_3px_0_0_#c4a66a]" : "text-muted hover:bg-elevated hover:text-cream"}\`,`,
  `            className: ({ isActive }) => \`group relative flex min-h-11 items-center justify-center gap-3 rounded-lg px-2 py-2.5 text-[13px] font-medium transition 2xl:justify-start 2xl:px-3 \${isActive ? "bg-oxblood/70 text-cream shadow-[inset_3px_0_0_#c4a66a]" : "text-muted hover:bg-elevated hover:text-cream"}\${floorMode && to === "/admin" ? " ps-floor-nav-admin" : ""}\`,`,
  'floor admin nav class',
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/settings", element: /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsPage, {}) }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/admin", element: /* @__PURE__ */ jsxRuntimeExports.jsx(AdminHubPage, {}) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Route, { path: "/settings", element: /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsPage, {}) }),`,
  'admin route',
);

// ---------------------------------------------------------------------------
// Zone edit copy
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `              children: t.catalog.editProduct
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              disabled: busy,
              onClick: () => setPendingDelete({ kind: "area", id: area.id, label: area.nameAz }),`,
  `              children: t.adminTables.editArea || t.adminTables.renameArea || "Zalı redaktə et"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              disabled: busy,
              onClick: () => setPendingDelete({ kind: "area", id: area.id, label: area.nameAz }),`,
  'zone edit copy',
);

// ---------------------------------------------------------------------------
// Tenant login AZ error
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `      setError(res.error.message || t.tenant.wrongCredentials);`,
  `      setError(/invalid credentials/i.test(res.error?.message || "") ? t.tenant.wrongCredentials : (res.error.message || t.tenant.wrongCredentials));`,
  'tenant login error',
);

// ---------------------------------------------------------------------------
// Dashboard date + title + empty CTA
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `  const locale = lang === "az" ? "az-AZ" : lang === "tr" ? "tr-TR" : "en-GB";
  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(/* @__PURE__ */ new Date());`,
  `  const locale = lang === "az" ? "az-AZ" : lang === "tr" ? "tr-TR" : "en-GB";
  const today = formatTillDate(/* @__PURE__ */ new Date(), lang);`,
  'dashboard today format',
);

s = replaceOnce(
  s,
  `  const heroCaption = wholeDay ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(span.from)
  ) : describeRange(span.from, span.to);`,
  `  const heroCaption = wholeDay ? formatTillDate(new Date(span.from), lang) : describeRange(span.from, span.to);`,
  'dashboard hero caption',
);

s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "brand-kicker text-gold-dim", children: today }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "mt-1 font-display text-4xl text-cream", children: t.dashboard.title })`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "ps-dash-date text-gold-dim", children: today }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "ps-dash-title mt-1 font-display text-4xl text-cream", children: t.dashboard.title })`,
  'dashboard title classes',
);

s = replaceOnce(
  s,
  `                  /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: hours.filter((h) => h.totalMinor > 0).length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("tr", { children: /* @__PURE__ */ jsxRuntimeExports.jsx("td", { colSpan: 4, className: "py-6 text-center text-muted", children: t.common.noResults }) }) : hours.filter((h) => h.totalMinor > 0).map((h) => /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "border-t border-hairline/60", children: [`,
  `                  /* @__PURE__ */ jsxRuntimeExports.jsx("tbody", { children: hours.filter((h) => h.totalMinor > 0).length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("tr", { children: /* @__PURE__ */ jsxRuntimeExports.jsx("td", { colSpan: 4, className: "py-6 text-center text-muted", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ps-empty-cta", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: t.dashboard.emptyNext || t.common.noResults }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx(Link, { to: "/tables", children: t.dashboard.goTables })
                  ] }) }) }) : hours.filter((h) => h.totalMinor > 0).map((h) => /* @__PURE__ */ jsxRuntimeExports.jsxs("tr", { className: "border-t border-hairline/60", children: [`,
  'dashboard empty CTA',
);

// ---------------------------------------------------------------------------
// License: human status + details disclosure
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `function LicensePage({ gateMode = false }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [status, setStatus] = reactExports.useState(null);
  const [loading, setLoading] = reactExports.useState(true);`,
  `function LicensePage({ gateMode = false }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [status, setStatus] = reactExports.useState(null);
  const [showLicenseDetails, setShowLicenseDetails] = reactExports.useState(false);
  const [loading, setLoading] = reactExports.useState(true);`,
  'license details state',
);

s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 font-display text-2xl text-gradient-gold", children: expired ? "expired" : status?.status ?? "—" }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-3 font-display text-2xl text-gradient-gold", children: expired ? t.settings.statusExpired : status?.status === "active" ? t.settings.statusActive : status?.status === "grace" || status?.status === "offline_grace" || status?.status === "legacy_grace" ? t.settings.statusGrace : status?.status ? String(status.status) : t.settings.statusUnknown }),`,
  'license human status',
);

s = replaceOnce(
  s,
  `          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between gap-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "text-faint", children: t.license.licenseId }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { className: "font-mono text-cream", children: status?.licenseId || "—" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between gap-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "text-faint", children: t.license.expires }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { className: "text-cream", children: formatTime(status?.expiresAt) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between gap-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "text-faint", children: t.license.installation }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { className: "truncate font-mono text-xs text-muted", children: status?.installationId || "—" })
          ] })`,
  `          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between gap-4", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "text-faint", children: t.license.expires }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { className: "text-cream", children: formatTime(status?.expiresAt) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setShowLicenseDetails((v) => !v), className: "touch-target mt-2 w-full rounded-xl border border-hairline px-3 py-2 text-left text-sm text-muted hover:text-cream", children: showLicenseDetails ? t.settings.hideDetails : t.settings.moreDetails }),
          showLicenseDetails ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between gap-4", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "text-faint", children: t.license.licenseId }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { className: "ps-license-mono text-cream", children: status?.licenseId || "—" })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex justify-between gap-4", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("dt", { className: "text-faint", children: t.license.installation }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("dd", { className: "ps-license-mono text-muted", children: status?.installationId || "—" })
            ] })
          ] }) : null`,
  'license details disclosure',
);

// ---------------------------------------------------------------------------
// Catalog: list-first editor + locale disclosure + category edit mode
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `  const [productGroupIds, setProductGroupIds] = reactExports.useState([]);
  const loadCategories = reactExports.useCallback(async () => {`,
  `  const [productGroupIds, setProductGroupIds] = reactExports.useState([]);
  const [editorOpen, setEditorOpen] = reactExports.useState(false);
  const [showLocales, setShowLocales] = reactExports.useState(false);
  const [categoryEditMode, setCategoryEditMode] = reactExports.useState(false);
  const loadCategories = reactExports.useCallback(async () => {`,
  'catalog editor state',
);

s = replaceOnce(
  s,
  `  const startEdit = async (product) => {
    setEditId(product.id);`,
  `  const startEdit = async (product) => {
    setEditorOpen(true);
    setEditId(product.id);`,
  'startEdit opens drawer',
);

s = replaceOnce(
  s,
  `  const startCreate = () => {
    setEditId(null);`,
  `  const startCreate = () => {
    setEditorOpen(true);
    setEditId(null);`,
  'startCreate opens drawer',
);

s = replaceOnce(
  s,
  `    toast(t.common.save, "success");
    startCreate();
    await loadProducts(categoryId);
  };
  const pickProductImage = async () => {`,
  `    toast(t.common.save, "success");
    setEditorOpen(false);
    setEditId(null);
    await loadProducts(categoryId);
  };
  const pickProductImage = async () => {`,
  'save closes editor',
);

s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.14em] text-faint", children: t.catalog.categories }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center justify-between gap-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.14em] text-faint", children: t.catalog.categories }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setCategoryEditMode((v) => !v), className: "touch-target rounded-lg px-2 py-1 text-[11px] text-muted hover:text-gold", children: t.catalog.editCategories })
        ] }),`,
  'category edit toggle',
);

s = replaceOnce(
  s,
  `                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid shrink-0 grid-cols-2 gap-0.5 self-center", children: [`,
  `                categoryEditMode ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid shrink-0 grid-cols-2 gap-0.5 self-center", children: [`,
  'category chrome gated open',
);

// Close the category chrome ternary — the grid closes with `] })` then `] })` for the row.
// After the delete button's closing of the grid, add `: null`.
s = replaceOnce(
  s,
                  `                    children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, { size: 14 })
                    }
                  )
                ] })
              ] })
            },
            cat.id
          );`,
  `                    children: /* @__PURE__ */ jsxRuntimeExports.jsx(X, { size: 14 })
                    }
                  )
                ] }) : null
              ] })
            },
            cat.id
          );`,
  'category chrome gated close',
);

// Wrap product editor in drawer
s = replaceOnce(
  s,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass rounded-2xl p-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: editId ? t.catalog.editProduct : t.catalog.newProduct }),`,
  `        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-3 flex justify-end", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => startCreate(), className: "touch-target rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-on-gold", children: t.catalog.newProduct })
        ] }),
        editorOpen ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "ps-catalog-editor-backdrop", "aria-label": t.catalog.closeEditor, onClick: () => setEditorOpen(false) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "ps-catalog-editor-panel glass rounded-none p-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mb-2 flex items-center justify-between gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "font-display text-lg text-cream", children: editId ? t.catalog.editProduct : t.catalog.newProduct }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setEditorOpen(false), className: "touch-target rounded-xl border border-hairline px-3 py-2 text-sm text-muted", children: t.catalog.closeEditor })
          ] }),`,
  'catalog drawer open',
);

s = replaceOnce(
  s,
  `            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (AZ)" }),`,
  `            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (AZ)" }),`,
  'AZ name full width',
);

s = replaceOnce(
  s,
  `              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (TR)" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameTr, onChange: (e) => setNameTr(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream outline-none focus:border-gold/50" })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (EN)" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameEn, onChange: (e) => setNameEn(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream outline-none focus:border-gold/50" })
              ] })
            ] }),`,
  `              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", onClick: () => setShowLocales((v) => !v), className: "touch-target text-left text-xs text-muted hover:text-gold", children: t.catalog.moreLocales }),
              showLocales ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (TR)" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameTr, onChange: (e) => setNameTr(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream outline-none focus:border-gold/50" })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { className: "block text-sm", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "Ad (EN)" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { value: nameEn, onChange: (e) => setNameEn(e.target.value), className: "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-cream outline-none focus:border-gold/50" })
              ] })
              ] }) : null
            ] }),`,
  'locale disclosure',
);

// Close the editor fragment after the editor section, before products section
s = replaceOnce(
  s,
  `            ] }) : null
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass overflow-hidden rounded-2xl", children: [`,
  `            ] }) : null
          ] })
        ] })
        ] }) : null,
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "glass overflow-hidden rounded-2xl", children: [`,
  'close catalog drawer fragment',
);

// ---------------------------------------------------------------------------
// Hide seed PIN/code on staff login UI
// ---------------------------------------------------------------------------
s = replaceOnce(
  s,
  `                              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mt-1 block font-mono text-[10px] tracking-[0.16em] text-gold-dim", children: user.code })`,
  `                              (typeof window !== "undefined" && window.pos?.app && false) ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mt-1 block font-mono text-[10px] tracking-[0.16em] text-gold-dim", children: user.code }) : null`,
  'hide login codes',
);

s = replaceOnce(
  s,
  `                            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "mt-2 text-[10px] uppercase tracking-[0.17em] text-gold-dim", children: [
                              t.roles[selected.role] ?? selected.role,
                              " · ",
                              selected.code
                            ] })`,
  `                            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "mt-2 text-[10px] uppercase tracking-[0.17em] text-gold-dim", children: t.roles[selected.role] ?? selected.role })`,
  'hide selected login code',
);

// Staff list: don't present 9001 as guidance — show role only for seeded admin in prod
s = replaceOnce(
  s,
  `                  /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-xs text-faint", children: [
                    "#",
                    user.code,
                    " · ",
                    user.role
                  ] })`,
  `                  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-faint", children: user.code === "9001" ? t.staff.adminBadge : "#" + user.code + " · " + user.role })`,
  'hide seed staff code',
);

// Soften restart "dev" eyebrow
s = s.replace(
  `              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "dev" })`,
  `              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-faint", children: "→" })`,
);

fs.writeFileSync(BUNDLE, s);
console.log('patched', BUNDLE, 'bytes', s.length);
