#!/usr/bin/env node
/**
 * English strings that reached Azerbaijani screens: the payment screen's
 * "Payments" heading, the diagnostics page labels, and the kitchen display,
 * which printed the raw station id ("kitchen", "cold") and minutes as "5m".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MARK = '/* POS_I18N_FIXES_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

const LABELS = [
  ['children: "Payments" })', 'children: "Ödənişlər" })'],
  ['children: "System Diagnostics"', 'children: "Sistem diaqnostikası"'],
  ['children: "Safe Mode"', 'children: "Təhlükəsiz rejim"'],
  ['children: "Print jobs"', 'children: "Çap tapşırıqları"'],
  ['children: "POS Core"', 'children: "POS nüvəsi"'],
  ['children: "Environment"', 'children: "Mühit"'],
  ['children: "Copy JSON"', 'children: "JSON-u kopyala"'],
];

let s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(MARK)) {
  for (const [find, repl] of LABELS) s = replaceOnce(s, find, repl, find);
  s = replaceOnce(
    s,
    `              job.station,
              job.elapsedMinutes != null ? \` · \${job.elapsedMinutes}m\` : ""`,
    `              ${MARK}({ kitchen: "Mətbəx", bar: "Bar", cold: "Soyuq sex", hot: "İsti sex", grill: "Qril", pastry: "Şirniyyat", dessert: "Desert" })[job.station] ?? job.station,
              job.elapsedMinutes != null ? \` · \${job.elapsedMinutes} dəq\` : ""`,
    'kitchen station label',
  );
  fs.writeFileSync(BUNDLE, s);
  console.log('i18n fixes applied', BUNDLE);
}

// Order and line statuses were printed as the core's ids ("sent", "draft").
const STATUS_MARK = '/* POS_I18N_STATUS_v1 */';
s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(STATUS_MARK)) {
  const STATUS = `${STATUS_MARK}({ draft: "qaralama", held: "gözləmədə", open: "açıq", sent: "mətbəxə göndərilib", preparing: "hazırlanır", ready: "hazırdır", served: "verilib", paid: "ödənilib", closed: "bağlanıb", voided: "ləğv edilib" })`;
  s = replaceOnce(s, 'order ? ` · ${order.status}` : ""', `order ? \` · \${${STATUS}[order.status] ?? order.status}\` : ""`, 'order status');
  s = replaceOnce(s, 'className: "mt-1 text-xs text-muted", children: item.status })', `className: "mt-1 text-xs text-muted", children: ${STATUS}[item.status] ?? item.status })`, 'item status');
  fs.writeFileSync(BUNDLE, s);
  console.log('status labels applied', BUNDLE);
}

// Backup section of the Azerbaijani dictionary (the admin hub already calls it
// "Ehtiyat nüsxə") and the diagnostics page's field names.
const DIAG_MARK = '/* POS_I18N_BACKUP_DIAG_v1 */';
s = fs.readFileSync(BUNDLE, 'utf8');
if (!s.includes(DIAG_MARK)) {
  s = replaceOnce(
    s,
    `  backup: {
    title: "Backup",
    create: "Backup yarat",
    list: "Backup siyahısı",
    empty: "Backup yoxdur",`,
    `  backup: {
    ${DIAG_MARK}title: "Ehtiyat nüsxə",
    create: "Ehtiyat nüsxə yarat",
    list: "Ehtiyat nüsxələr",
    empty: "Ehtiyat nüsxə yoxdur",`,
    'az backup title',
  );
  // Only the Azerbaijani dictionary: the English one uses the same keys.
  const azStart = s.indexOf('const az = {');
  const azEnd = s.indexOf('const en = {', azStart);
  if (azStart < 0 || azEnd < 0) throw new Error('az dictionary not found');
  let az = s.slice(azStart, azEnd);
  for (const [find, repl] of [
    ['    createSuccess: "Backup yaradıldı",', '    createSuccess: "Ehtiyat nüsxə yaradıldı",'],
    ['    restoreTitle: "Backup-dan bərpa",', '    restoreTitle: "Ehtiyat nüsxədən bərpa",'],
    ['    restoreWarn: "Bu backup-dan sonrakı bütün məlumat silinəcək.",', '    restoreWarn: "Bu nüsxədən sonrakı bütün məlumat silinəcək.",'],
    ['    restoreMissing: "Backup faylı tapılmadı",', '    restoreMissing: "Ehtiyat nüsxə faylı tapılmadı",'],
    ['    backup: "Backup",', '    backup: "Ehtiyat nüsxə",'],
  ]) az = replaceOnce(az, find, repl, find.trim());
  s = s.slice(0, azStart) + az + s.slice(azEnd);
  const DIAG = [
    ['App version', 'Proqram versiyası'], ['Busy with', 'Hazırda icra edir'], ['Core path', 'Nüvə yolu'],
    ['Core version', 'Nüvə versiyası'], ['Database', 'Verilənlər bazası'], ['Last error', 'Son xəta'],
    ['Last exit code', 'Son çıxış kodu'], ['Logs', 'Jurnallar'], ['Mode', 'Rejim'],
    ['Restart attempts', 'Yenidən başlatma cəhdləri'], ['Stage', 'Mərhələ'], ['Error', 'Xəta'],
    ['Exit code', 'Çıxış kodu'], ['State', 'Vəziyyət'],
  ];
  for (const [find, repl] of DIAG) {
    const needle = `label: "${find}"`;
    if (!s.includes(needle)) throw new Error(`diagnostics label not found: ${find}`);
    s = s.replaceAll(needle, `label: "${repl}"`);
  }
  fs.writeFileSync(BUNDLE, s);
  console.log('backup and diagnostics labels applied', BUNDLE);
}
