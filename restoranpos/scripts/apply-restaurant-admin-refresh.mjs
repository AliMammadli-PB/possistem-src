#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'index-DAmHwBc4.js');
const mark = '/* POS_ADMIN_REFRESH_v1 */';
let source = fs.readFileSync(file, 'utf8');
function once(from, to) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`Admin refresh expected one anchor, found ${count}: ${from.slice(0,110)}`);
  source = source.replace(from, to);
}
function section(start, end, edit) {
  const a = source.indexOf(start), b = source.indexOf(end,a + start.length);
  if(a < 0 || b < 0) throw new Error(`Missing section ${start}`);
  source = source.slice(0,a) + edit(source.slice(a,b)) + source.slice(b);
}
if(!source.includes(mark)) {
  once('children: /* @__PURE__ */ jsxRuntimeExports.jsx(Outlet, {}) })\n    ] })\n  ] });\n}\nfunction RequireAuth', 'children: jsxRuntimeExports.jsx(PsAdminFrame, { children: jsxRuntimeExports.jsx(Outlet, {}) }) })\n    ] })\n  ] });\n}\nfunction RequireAuth');
  section('function AdminHubPage()', 'const LOGO_RASTER_WIDTH', s => s.slice(0,s.indexOf('  return /*')) + '  return jsxRuntimeExports.jsx(PsAdminHub, { links });\n}\n');
  section('function OperationsPage()', 'function AdminHubPage()', s => s
    .replace('className: "mx-auto flex h-full max-w-5xl flex-col gap-4 overflow-y-auto p-6"','className: "ps-operations-page"')
    .replace('className: "mt-1 text-sm text-muted", children: tabs.length > 1 ? tabs.map((tab) => tab.label).join(" · ") : "Anbar qalığı, mal qəbulu və hərəkətlər."','className: "ps-page-subtitle", children: psOpsSubtitle(current?.id)')
    .replace('jsxRuntimeExports.jsx("div", { className: "flex flex-wrap gap-2", children: tabs.map','jsxRuntimeExports.jsx("nav", { className: "ps-ops-tabs", "aria-label": psAdminText("Bölmələr", "Bölümler", "Sections"), children: tabs.map')
    .replace('onClick: () => setActive(tab.id),','onClick: () => setActive(tab.id), "aria-current": current?.id === tab.id ? "page" : undefined,')
    .replace('className: "min-h-0 flex-1", children: current?.render()','className: "ps-ops-panel", children: current?.render()'));
  section('function OpsButton(', 'function useOpsAction(', s => s
    .replace('className: cls, children','className: "ps-ops-button ps-ops-button--" + tone + " " + cls, children')
    .replace('className: "text-sm text-muted", children: empty','className: "ps-empty-state", role: "status", children: empty')
    .replace('className: "overflow-x-auto"','className: "ps-ops-table"')
    .replace('head.map((h) =>','head.map((h, i) =>')
    .replace('className: "px-2 py-2", children: h }, h)','scope: "col", className: "px-2 py-2", children: h }, i)'));
  section('function useOpsAction(', '// ----------------------------------------------------------------- inventory', () => `function useOpsAction(reload) {
  const [busy, setBusy] = reactExports.useState(false);
  const run = reactExports.useCallback(async (promise, okMessage) => {
    setBusy(true);
    try {
      const res = await promise;
      if (!res.success) { toast(res.error?.message || psAdminText("Əməliyyat alınmadı", "İşlem başarısız", "Action failed"), "danger"); return null; }
      if (okMessage) toast(okMessage, "success");
      // A successful write must not be repeated if refreshing the list fails.
      try { if (reload) await reload(); } catch { toast(psAdminText("Saxlanıldı, siyahını yeniləmək alınmadı", "Kaydedildi, liste yenilenemedi", "Saved, but the list could not refresh"), "warning"); }
      return res.data ?? true;
    } catch (error) {
      toast(error?.message || psAdminText("Bağlantı xətası", "Bağlantı hatası", "Connection error"), "danger");
      return null;
    } finally { setBusy(false); }
  }, [reload]);
  return [busy, run];
}

`);
  section('function OpsStock()', 'function OpsSupplyStatus(', s => s
    .replace('className: "grid gap-3 sm:grid-cols-2 xl:grid-cols-5"','className: "ps-stock-metrics"')
    .replace('className: "rounded-2xl border border-hairline bg-elevated p-4"','className: "ps-stock-metric"')
    .replace('className: "ml-1.5 opacity-70"','className: "ps-filter-count"')
    .replace('onClick: () => setStatus(key),','onClick: () => setStatus(key), "aria-pressed": status === key,')
    .replace('card("Stokda məhsul", String(levels.length), "Aktiv inqrediyent", null)','card(psAdminText("Məhsul sayı", "Ürün sayısı", "Products"), String(levels.length), "Aktiv inqrediyent", null)')
    .replace('drawer && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4",','drawer && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: psAdminText("Yeni məhsul", "Yeni ürün", "New product"), onClose: () => setDrawer(null), busy,')
    .replace('edit && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4",','edit && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: edit.row.name, onClose: () => setEdit(null), busy,')
    .replace('if (!drawer.name.trim()) { toast("Ad tələb olunur", "danger"); return; }','if (!drawer.name.trim()) { toast("Ad tələb olunur", "danger"); return; }\n            if (!psStockInputValid(drawer.cost, {empty: true}) || !psStockInputValid(drawer.minQty, {empty: true})) { toast(psAdminText("Maya və minimum düzgün, mənfi olmayan rəqəm olmalıdır", "Maliyet ve minimum geçerli, negatif olmayan sayılar olmalı", "Cost and minimum must be valid non-negative numbers"), "danger"); return; }')
    .replace('const payload = { ingredientId: edit.row.id, warehouseId, reason: edit.reason.trim() };','if (!psStockInputValid(edit.value, {negative: edit.mode === "adjust"}) || opsMilli(edit.value) === 0 || (edit.mode === "waste" && opsMilli(edit.value) > Number(edit.row.qtyMilli))) { toast(psAdminText("Miqdarı yoxlayın. Zay miqdarı mövcud stokdan çox ola bilməz.", "Miktarı kontrol edin. Fire mevcut stoku aşamaz.", "Check the quantity. Waste cannot exceed available stock."), "danger"); return; }\n            if (!edit.reason.trim()) { toast(psAdminText("Səbəb daxil edin", "Neden girin", "Enter a reason"), "danger"); return; }\n            const payload = { ingredientId: edit.row.id, warehouseId, reason: edit.reason.trim() };')
    .replaceAll('tone: "quiet", onClick: () => setDrawer(null)','tone: "quiet", disabled: busy, onClick: () => setDrawer(null)')
    .replaceAll('tone: "quiet", onClick: () => setEdit(null)','tone: "quiet", disabled: busy, onClick: () => setEdit(null)'));
  section('function OpsSuppliers()', 'function OperationsPage()', s => s
    .replaceAll('className: "ml-1.5 opacity-70"','className: "ps-filter-count"')
    .replace('.then(() => { setName(""); setPhone(""); });','.then((ok) => { if (ok) { setName(""); setPhone(""); } });')
    .replace('.then(() => setAsk(null));','.then((ok) => { if (ok) setAsk(null); });')
    .replace('.then(() => setCourierName(""));','.then((ok) => { if (ok) setCourierName(""); });')
    .replace('ask && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-2 rounded-xl border border-gold/30 p-3",','ask && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: ask.guest.name, onClose: () => setAsk(null), busy,')
    .replace('const id = ask.guest.id;','if (!psStockInputValid(ask.value) || opsNum(ask.value) <= 0 || (ask.mode === "points" && !Number.isInteger(opsNum(ask.value)))) { toast(psAdminText("Düzgün müsbət məbləğ daxil edin", "Geçerli pozitif tutar girin", "Enter a valid positive amount"), "danger"); return; }\n            const id = ask.guest.id;')
    .replace('if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt))','if (!form.userId || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt)'));
  section('function SettingsPage()', 'function TablesPage()', s => {
    s = s.replace('className: "flex min-h-0 flex-1 gap-4 p-6"','className: "ps-settings-layout"')
      .replace('className: "hidden w-56 shrink-0 flex-col gap-1 sm:flex"','className: "ps-settings-nav"')
      .replace('onClick: () => setSettingsSection(sec.id),','onClick: () => setSettingsSection(sec.id), "aria-current": settingsSection === sec.id ? "page" : undefined,')
      .replace('jsxRuntimeExports.jsx("div", { className: "min-w-0 flex-1", children:\n        /* @__PURE__ */ jsxRuntimeExports.jsx("select",','jsxRuntimeExports.jsx("div", { className: "ps-settings-mobile", children:\n        /* @__PURE__ */ jsxRuntimeExports.jsx("select",')
      .replace('className: "ps-settings-stack min-w-0 flex-1 space-y-3"','className: "ps-settings-stack w-full min-w-0 flex-1 space-y-3"');
    // Move the QR section INSIDE the printer accordion (previously visible on every tab).
    const qrTitle = s.indexOf('children: "Çek QR-ı"');
    const qrStart = s.lastIndexOf('      /* @__PURE__ */ jsxRuntimeExports.jsxs("section",', qrTitle);
    const systemStart = s.indexOf('      /* @__PURE__ */ jsxRuntimeExports.jsxs(SettingsAccordion, { id: "system"', qrTitle);
    if(qrStart<0 || systemStart<0 || s.slice(qrStart-13,qrStart).trim() !== '] }),') throw new Error('QR parent boundary changed');
    const qr = s.slice(qrStart,systemStart);
    const before = s.slice(0,qrStart).replace(/      \] \}\),\n$/, '');
    s = before + qr + '      ] }),\n' + s.slice(systemStart);
    return s;
  });
  source = mark + '\n' + source;
}
if (!source.includes('/* POS_ADMIN_REFINEMENTS_v1 */')) {
  once('const opsWhen = (ms) => (ms ? new Date(Number(ms)).toLocaleString("az-AZ") : "—");', 'const opsWhen = (value) => { const ms = psOpsTimestamp(value); return Number.isFinite(ms) ? new Date(ms).toLocaleString(useI18n.getState().lang === "en" ? "en-GB" : useI18n.getState().lang === "tr" ? "tr-TR" : "az-AZ") : "—"; };');
  section('function OpsStock()', 'function OpsSupplyStatus(', s => s
    .replace('if (m.kind !== "waste" || Number(m.createdAt) < since) continue;', 'if (m.kind !== "waste" || !Number.isFinite(psOpsTimestamp(m.createdAt)) || psOpsTimestamp(m.createdAt) < since || (warehouseId && m.warehouseId !== warehouseId)) continue;')
    .replace('card("30 günlük itki", formatMoney(wasteMinor), "Zay kimi silinib", null)', 'card(psAdminText("Təxmini itki", "Tahmini fire", "Estimated waste"), formatMoney(wasteMinor), psAdminText("30 gün · son 500 hərəkət · cari maya", "30 gün · son 500 hareket · güncel maliyet", "30 days · latest 500 movements · current cost"), null)')
    .replace('belowMin ? "Sifariş vaxtıdır" : "Hamısı qaydasındadır"', 'belowMin ? "Sifariş vaxtıdır" : outOf ? psAdminText("Stoku bitən məhsullar var", "Stoku tükenen ürünler var", "Some products are out of stock") : "Hamısı qaydasındadır"'));
  section('function OpsSuppliers()', 'function OpsGuests()', s => s
    .replace('setLow(lowRes.data.ingredients ?? [])','setLow((lowRes.data.ingredients ?? []).filter(row => Number(row.qtyMilli) < Number(row.minQtyMilli) || Number(row.qtyMilli) <= 0))')
    .replace('onClick: () => setFilter(key),','onClick: () => setFilter(key), "aria-pressed": filter === key,')
    .replace('draft && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4",','draft && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: psAdminText("Yeni alış", "Yeni alım", "New purchase"), onClose: () => setDraft(null), busy,')
    .replace('form && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4",','form && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: psAdminText("Yeni təchizatçı", "Yeni tedarikçi", "New supplier"), onClose: () => setForm(null), busy,')
    .replace('pay && /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "space-y-3 rounded-2xl border border-gold/30 bg-elevated p-4",','pay && /* @__PURE__ */ jsxRuntimeExports.jsxs(PsAdminDialog, { title: pay.supplier.name, onClose: () => setPay(null), busy,')
    .replace('tone: "quiet", onClick: () => setDraft(null)','tone: "quiet", disabled: busy, onClick: () => setDraft(null)')
    .replace('tone: "quiet", onClick: () => setForm(null)','tone: "quiet", disabled: busy, onClick: () => setForm(null)')
    .replace('tone: "quiet", onClick: () => setPay(null)','tone: "quiet", disabled: busy, onClick: () => setPay(null)'));
  section('function OpsReservations()', 'function OpsDelivery()', s => s.replace('jsxRuntimeExports.jsxs("section", { className: "space-y-2 rounded-xl border border-hairline p-3",','jsxRuntimeExports.jsxs(PsOpsComposer, { title: psAdminText("Yeni rezervasiya", "Yeni rezervasyon", "New reservation"),'));
  section('function OpsRoster()', 'function OpsExport()', s => s.replace('jsxRuntimeExports.jsxs("section", { className: "space-y-2 rounded-xl border border-hairline p-3",','jsxRuntimeExports.jsxs(PsOpsComposer, { title: psAdminText("Növbə planla", "Vardiya planla", "Plan a shift"),'));
  section('function AdminStaffPage()', 'function AdminTablesPage()', s => s
    .replaceAll('children: t.staff.addWaiter','children: psAdminText("İşçi əlavə et", "Çalışan ekle", "Add staff")')
    .replaceAll('children: t.staff.hint','children: psAdminText("Heyəti, vəzifələri və giriş səlahiyyətlərini idarə edin.", "Ekibi, görevleri ve erişim izinlerini yönetin.", "Manage your team, roles and access permissions.")')
    .replace('children: user.code === "9001" ? t.staff.adminBadge : "#" + user.code + " · " + user.role','children: psRoleLabel(user.role)'));
  source = '/* POS_ADMIN_REFINEMENTS_v1 */\n' + source;
}

if (!source.includes('/* POS_ADMIN_RELIABILITY_v1 */')) {
  section('function OpsStock()', 'function OpsSupplyStatus(', s => {
    s=s.replace('  const reload = reactExports.useCallback(async () => {','  const [loading, setLoading] = reactExports.useState(true);\n  const [loadError, setLoadError] = reactExports.useState("");\n  const requestSeq = reactExports.useRef(0);\n  const reload = reactExports.useCallback(async () => {\n    const request = ++requestSeq.current;\n    setLoading(true); setLoadError("");\n    try {');
    s=s.replace('    const rows = levelRes.success ?', '    if (request !== requestSeq.current) return;\n    const failed = [levelRes, whRes, valRes, moveRes].find(res => !res.success);\n    if (failed) throw new Error(failed.error?.message || psAdminText("Anbar məlumatları alınmadı", "Stok verileri alınamadı", "Inventory data could not load"));\n    const rows = levelRes.success ?');
    s=s.replace('  }, [warehouseId]);','    } catch (error) {\n      if (request === requestSeq.current) setLoadError(error?.message || psAdminText("Bağlantı xətası", "Bağlantı hatası", "Connection error"));\n    } finally { if (request === requestSeq.current) setLoading(false); }\n  }, [warehouseId]);');
    s=s.replace('reactExports.useEffect(() => { void reload(); }, [reload]);','reactExports.useEffect(() => { void reload(); return () => { ++requestSeq.current; }; }, [reload]);');
    s=s.replace('  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [','  if (loading || loadError) return jsxRuntimeExports.jsx(PsOpsLoadState, { error: loadError, retry: () => void reload() });\n  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [');
    return s;
  });
  section('function OpsSuppliers()', 'function OpsGuests()', s => s
    .replace('            const lines = draft.lines\n', '            if (!draft.lines.length || draft.lines.some(line => !line.ingredientId || !psStockInputValid(line.qty) || opsMilli(line.qty) <= 0 || !psStockInputValid(line.cost))) { toast(psAdminText("Hər sətirdə məhsul, düzgün miqdar və qiymət daxil edin", "Her satıra ürün, geçerli miktar ve fiyat girin", "Enter a product, valid quantity and price on every line"), "danger"); return; }\n            const lines = draft.lines\n')
    .replace('onClick: () => void run(window.pos.suppliers.pay({ supplierId: pay.supplier.id, amountMinor: opsMinor(pay.value) }), "Ödəniş qeyd olundu")\n            .then((ok) => { if (ok) setPay(null); }),', 'onClick: () => { if (!psStockInputValid(pay.value) || opsMinor(pay.value) <= 0) { toast(psAdminText("Düzgün müsbət məbləğ daxil edin", "Geçerli pozitif tutar girin", "Enter a valid positive amount"), "danger"); return; } void run(window.pos.suppliers.pay({ supplierId: pay.supplier.id, amountMinor: opsMinor(pay.value) }), "Ödəniş qeyd olundu").then((ok) => { if (ok) setPay(null); }); },'));
  once('children: [role.name, /* @__PURE__ */ jsxRuntimeExports.jsxs("span",', 'children: [psRoleLabel(role.name), /* @__PURE__ */ jsxRuntimeExports.jsxs("span",');
  once('`ps-nav ${isActive && _psNavTabMatches(to, location) ? "ps-nav-on" : "ps-nav-off"}`', '`ps-nav ${(isActive && _psNavTabMatches(to, location)) || (to === "/admin" && psAdminRoute(location.pathname)) ? "ps-nav-on" : "ps-nav-off"}`');
  source='/* POS_ADMIN_RELIABILITY_v1 */\n'+source;
}

const helpers = await transform(fs.readFileSync(path.join(root,'scripts/admin-ui/components.jsx'),'utf8'), { loader: 'jsx', jsxFactory: 'reactExports.createElement', jsxFragment: 'reactExports.Fragment', target: 'es2022', legalComments: 'none' });
const helperStart = '/* POS_ADMIN_COMPONENTS_START */';
const helperEnd = '/* POS_ADMIN_COMPONENTS_END */';
const block = helperStart + '\n' + helpers.code + helperEnd + '\n';
if(source.includes(helperStart)) {
  const a=source.indexOf(helperStart), b=source.indexOf(helperEnd,a)+helperEnd.length+1;
  source=source.slice(0,a)+block+source.slice(b);
} else source=source.replace('function AdminHubPage() {',block+'function AdminHubPage() {');
// Parse the complete bundle before writing any change.
await transform(source, {loader:'js',target:'es2022'});
fs.writeFileSync(file,source);
const cssFile=path.join(root,'possistem-system.css');
let css=fs.readFileSync(cssFile,'utf8');
const cssMark='/* POS_ADMIN_REFRESH_STYLES */';
const endMark='/* POS_ADMIN_REFRESH_STYLES_END */';
let suffix='';
if(css.includes(cssMark)){const a=css.indexOf(cssMark),b=css.indexOf(endMark,a);if(b>=0)suffix=css.slice(b+endMark.length);else {const next=css.indexOf('/* POS_',a+cssMark.length);if(next>=0)suffix=css.slice(next);}css=css.slice(0,a);}
css += cssMark+'\n'+fs.readFileSync(path.join(root,'scripts/admin-ui/styles.css'),'utf8')+endMark+suffix;
fs.writeFileSync(cssFile,css);
console.log('Admin workspace refreshed (protected service screens unchanged).');
