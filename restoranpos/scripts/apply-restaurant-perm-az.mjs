#!/usr/bin/env node
/**
 * Azerbaijani labels for the permissions screen.
 *
 * The catalogue comes from the core (`permissions.list`), which returns the
 * raw key and the English description seeded in Migrator.cpp, grouped by the
 * part of the key before the dot. So the screen read "audit.view / View the
 * audit log / AUDIT" - a developer's list, not something a restaurant owner
 * hands to their staff.
 *
 * Translated here rather than in the core seed on purpose: the seed text is
 * also what an operator would have to migrate on every existing till, and
 * display language belongs to the renderer. An unknown key still falls back to
 * whatever the core sent, so a permission added later shows up untranslated
 * instead of disappearing.
 *
 * Role names are deliberately NOT translated. `users.create` resolves a role
 * by NAME (`resolveRoleId(roleName, "role-waiter")`) and refuses the literal
 * "administrator", so renaming them is a data change that breaks staff
 * creation - not a label change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_PERM_AZ_v1 */';

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  must(n === 1, `${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const GROUPS = {
  audit: 'Audit',
  backup: 'Yedəkləmə',
  businessDay: 'İş günü',
  cash: 'Kassa',
  catalog: 'Menyu və kataloq',
  customers: 'Müştərilər',
  delivery: 'Çatdırılma',
  discount: 'Endirimlər',
  gifts: 'Hədiyyələr',
  inventory: 'Anbar və stok',
  kds: 'Mətbəx ekranı',
  license: 'Lisenziya',
  order: 'Sifarişlər',
  payment: 'Ödəniş və kassa',
  printer: 'Printer',
  receipt: 'Çek',
  recipes: 'Reseptlər',
  reports: 'Hesabatlar',
  reservations: 'Rezervasiyalar',
  roles: 'Rollar və səlahiyyətlər',
  schedule: 'İş qrafiki',
  settings: 'Tənzimləmələr',
  shift: 'Növbə',
  suppliers: 'Təchizatçılar və alış',
  tables: 'Masalar',
  users: 'İstifadəçilər',
};

/** key -> [label, hint] */
const KEYS = {
  'audit.view': ['Audit jurnalına baxmaq', 'Kimin nə etdiyinin tarixçəsi'],
  'backup.manage': ['Yedəkləmə və bərpa', 'Yerli ehtiyat nüsxə yaratmaq və geri qaytarmaq'],
  'businessDay.manage': ['İş gününü açıb-bağlamaq', 'Gün açılışı, bağlanışı və Z hesabatı'],
  'cash.manage': ['Kassa əməliyyatları', 'Kassaya mədaxil/məxaric və çekmecə'],
  'catalog.import': ['Kataloqu idxal/ixrac etmək', 'Menyunu CSV ilə yükləmək və çıxarmaq'],
  'catalog.manage': ['Menyunu idarə etmək', 'Kateqoriya, məhsul və qiymət dəyişmək'],
  'customers.credit': ['Müştəri borcu', 'Borc yazmaq və borc ödənişi qəbul etmək'],
  'customers.loyalty': ['Bonus balları', 'Bal qazandırmaq və xərcləmək'],
  'customers.manage': ['Müştəri yaratmaq və redaktə etmək', 'Müştəri kartlarını idarə etmək'],
  'customers.view': ['Müştərilərə baxmaq', 'Müştəri, borc və bal məlumatı'],
  'delivery.assign': ['Kuryer təyin etmək', 'Sifarişi kuryerə vermək və statusu irəlilətmək'],
  'delivery.manage': ['Çatdırılmanı idarə etmək', 'Çatdırılma yaratmaq və kuryerləri idarə etmək'],
  'delivery.view': ['Çatdırılmaya baxmaq', 'Çatdırılma sifarişləri və kuryer hesabatları'],
  'discount.manage': ['Endirim qaydaları', 'Endirim qaydalarını təyin etmək'],
  'gifts.manage': ['Hədiyyə kampaniyaları', 'Kampaniyaları qurmaq və dəyişmək'],
  'gifts.override': ['Hədiyyəni təsdiqləmək', 'Yoxlamadan keçirmə icazəsi vermək'],
  'inventory.adjust': ['Stok düzəlişi və silinmə', 'Qalığı düzəltmək, itki və zay yazmaq'],
  'inventory.count': ['İnventarizasiya', 'Sayım aparmaq və yekunlaşdırmaq'],
  'inventory.manage': ['Anbar və xammal kartları', 'Anbar və xammal yaratmaq, redaktə etmək'],
  'inventory.transfer': ['Anbarlararası transfer', 'Malı bir anbardan digərinə köçürmək'],
  'inventory.view': ['Stok qalığına baxmaq', 'Qalıqlar və mal hərəkətləri'],
  'kds.operate': ['Mətbəx ekranını idarə etmək', 'Sifariş statuslarını dəyişmək'],
  'kds.view': ['Mətbəx ekranına baxmaq', 'Hazırlanan sifarişləri görmək'],
  'license.manage': ['Lisenziya', 'Aktivləşdirmə və lisenziya statusu'],
  'order.closeOther': ['Başqasının sifarişini bağlamaq', 'Öz sifarişi olmayanı da bağlamaq'],
  'order.create': ['Sifariş yaratmaq', 'Yeni sifariş açmaq və məhsul əlavə etmək'],
  'order.discount': ['Sifarişə endirim tətbiq etmək', 'Hesaba faiz və ya məbləğlə endirim'],
  'order.priceOverride': ['Qiyməti əl ilə dəyişmək', 'Sifarişdə məhsulun qiymətini dəyişmək'],
  'order.transfer': ['Sifarişi köçürmək', 'Hesabı başqa masaya köçürmək'],
  'order.view': ['Sifarişlərə baxmaq', 'Sifarişlər və onların tarixçəsi'],
  'order.void': ['Sifarişi ləğv etmək', 'Sifarişi və ya içindəki məhsulu ləğv etmək'],
  'payment.reconcile': ['Kassa uzlaşdırması', 'Gün sonu kassanı uzlaşdırmaq'],
  'payment.refund': ['Geri qaytarma', 'Ödənişi müştəriyə qaytarmaq'],
  'payment.split': ['Hesabı bölmək', 'Hesabı bir neçə ödənişə bölmək'],
  'payment.take': ['Ödəniş qəbul etmək', 'Nağd, kart və digər ödəniş növləri'],
  'payment.view': ['Ödənişlərə baxmaq', 'Hesabda alınmış ödənişləri görmək'],
  'printer.manage': ['Printer ayarları', 'Printeri qurmaq, çapı təkrarlamaq və ləğv etmək'],
  'receipt.print': ['Çek çap etmək', 'Çek çapı və təkrar çap'],
  'recipes.manage': ['Reseptlər', 'Məhsulun nədən hazırlandığını təyin etmək'],
  'reports.export': ['Hesabatı ixrac etmək', 'Excel və ya PDF-ə çıxarmaq'],
  'reports.view': ['Hesabatlara baxmaq', 'Satış və əməliyyat hesabatları'],
  'reports.x': ['X hesabatı', 'Gün ərzində aralıq hesabat almaq'],
  'reports.z': ['Z hesabatı', 'Gün sonu hesabatı almaq'],
  'reservations.manage': ['Rezervasiyanı idarə etmək', 'Rezerv yaratmaq, köçürmək, ləğv etmək'],
  'reservations.view': ['Rezervasiyalara baxmaq', 'Masa rezervlərini görmək'],
  'roles.manage': ['Rol və səlahiyyətlər', 'Rol yaratmaq və səlahiyyət vermək'],
  'schedule.clock': ['Gəliş-gediş qeydi', 'İşə giriş və çıxış vurmaq'],
  'schedule.manage': ['Qrafiki idarə etmək', 'Növbə planlamaq və dəyişmək'],
  'schedule.view': ['Qrafikə baxmaq', 'Növbələr və davamiyyət'],
  'settings.manage': ['Tənzimləmələr', 'Sistem və restoran ayarları'],
  'shift.manage': ['Növbəni idarə etmək', 'Növbə açmaq və bağlamaq'],
  'suppliers.manage': ['Təchizatçı və alış sifarişi', 'Təchizatçı yaratmaq, alış sifarişini redaktə etmək'],
  'suppliers.pay': ['Təchizatçıya ödəniş', 'Alış fakturasını ödəmək'],
  'suppliers.receive': ['Mal qəbulu', 'Gələn malı anbara qəbul etmək'],
  'suppliers.view': ['Təchizatçılara baxmaq', 'Təchizatçılar və alışlar'],
  'tables.layout': ['Masa sxemi', 'Zal planını redaktə etmək'],
  'tables.status': ['Masa statusu', 'Masanın vəziyyətini dəyişmək'],
  'users.manage': ['İşçiləri idarə etmək', 'İşçi yaratmaq və deaktiv etmək'],
};

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
  process.exit(0);
}

const helpers = `const _PS_PERM_GROUP_AZ = ${JSON.stringify(GROUPS, null, 0)};
const _PS_PERM_AZ = ${JSON.stringify(KEYS, null, 0)};
/** Falls back to what the core sent, so a new key shows up rather than vanishing. */
function _psPermGroupAz(group) {
  return _PS_PERM_GROUP_AZ[group] || group;
}
function _psPermAz(perm) {
  const hit = _PS_PERM_AZ[perm.key];
  return hit ? { label: hit[0], hint: hit[1] } : { label: perm.key, hint: perm.description };
}
function RolePermissionsPanel() {`;

s = replaceOnce(s, 'function RolePermissionsPanel() {', helpers, 'panel helpers');

s = replaceOnce(
  s,
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-gold-dim", children: group }),',
  '/* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs uppercase tracking-wide text-gold-dim", children: _psPermGroupAz(group) }),',
  'group heading',
);

// The key itself stays visible, small and faint: it is what the audit log and
// any support conversation will name, so hiding it costs more than it saves.
s = replaceOnce(
  s,
  `            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block truncate", children: perm.key }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-xs text-faint", children: perm.description })`,
  `            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block truncate", children: _psPermAz(perm).label }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-xs text-faint", children: _psPermAz(perm).hint }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "block text-[10px] text-faint/60", children: perm.key })`,
  'permission row',
);

s = MARK + '\n' + s;
fs.writeFileSync(BUNDLE, s);

must(s.includes('_psPermGroupAz(group)'), 'group heading not translated');
must(s.includes('_psPermAz(perm).label'), 'permission label not translated');
must(!s.includes('children: perm.description })'), 'raw English description still rendered');
must(s.includes('"Anbar və stok"'), 'group map missing from bundle');

// Every key the core seeds must have a translation, or the screen is still
// half English and nothing would say so.
const seeded = fs.readFileSync(path.join(ROOT, 'native/core/src/database/Migrator.cpp'), 'utf8');
const rows = [...seeded.matchAll(/\(\s*'[a-z0-9-]+',\s*'([a-zA-Z]+\.[a-zA-Z]+)',\s*'(?:[^']|'')*'\)/g)];
const untranslated = [...new Set(rows.map((m) => m[1]))].filter((k) => !KEYS[k]);
must(untranslated.length === 0, `no Azerbaijani label for: ${untranslated.join(', ')}`);

console.log(`patched ${BUNDLE} (${Object.keys(KEYS).length} keys, ${Object.keys(GROUPS).length} groups)`);
