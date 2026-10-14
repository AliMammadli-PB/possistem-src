#!/usr/bin/env node
/**
 * 1.7.29 — expired lots are out of usable stock (core: blockExpired).
 *
 * Anbar → Partiyalar shows a blocked lot as "istifadədən çıxarılıb"; "Sil"
 * marks it thrown away (the balance already dropped when it expired) and
 * "Tarixi düzəlt" corrects a wrongly typed date, making the lot usable again
 * (lots.extend). Runs after apply-restaurant-procurement.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_EXPIRY_BLOCK_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes('"lots.extend":')) {
    m = replaceOnce(m, 'Cn={', 'Cn={"lots.extend":{auth:!0,perm:"inventory.adjust",timeout:8e3,idempotent:!0},', 'main policy');
    fs.writeFileSync(MAIN, m);
    console.log('main: lots.extend');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('"lots.extend"')) {
    p = replaceOnce(p, '    writeOff: (input) => call("lots.writeOff", input),',
      '    writeOff: (input) => call("lots.writeOff", input),\n    extendLot: (lotId, expiresOn) => call("lots.extend", { lotId, expiresOn }),', 'preload');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: extendLot');
  }
}

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  s = replaceOnce(s, 'function psDaysBadge(lot) {\n',
    `${MARK}\nfunction psDaysBadge(lot) {\n  if (lot.blockedAt) return psBadge("Vaxtı keçib (" + lot.expiresOn + ") — istifadədən çıxarılıb", "danger");\n`, 'badge');
  s = replaceOnce(s, '[["active", "Anbarda"], ["expiring", "3 gün içində bitir"], ["expired", "Vaxtı keçib"],',
    '[["active", "Anbarda"], ["expiring", "3 gün içində bitir"], ["expired", "Vaxtı keçib (atılmalı)"],', 'chip');
  s = replaceOnce(s, '  const [off, setOff] = reactExports.useState(null);\n  const [query, setQuery] = reactExports.useState("");',
    '  const [off, setOff] = reactExports.useState(null);\n  const [ext, setExt] = reactExports.useState(null);\n  const [query, setQuery] = reactExports.useState("");', 'ext state');
  s = replaceOnce(s, '          r.quality === "accepted" && r.qtyMilli > 0 && hasPermission("inventory.adjust") ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setOff({ lot: r, reason: (r.daysLeft ?? 1) < 0 ? "expired" : "waste", qty: String(r.qtyMilli / 1000), note: "" }), children: "Sil" }) : null)',
    '          r.blockedAt && hasPermission("inventory.adjust") ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setExt({ lot: r, date: "" }), children: "Tarixi düzəlt" }) : null,\n          r.quality === "accepted" && r.qtyMilli > 0 && hasPermission("inventory.adjust") ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: () => setOff({ lot: r, reason: r.blockedAt || (r.daysLeft ?? 1) < 0 ? "expired" : "waste", qty: String(r.qtyMilli / 1000), note: "" }), children: r.blockedAt ? "Atıldı" : "Sil" }) : null)', 'buttons');
  s = replaceOnce(s, '      h("p", { className: "text-xs text-muted" }, "Dəyəri İtkilər hesabatına düşür: " + ',
    '      off.lot.blockedAt ? h("p", { className: "text-xs text-muted" }, "Vaxtı keçdiyi gün qalıqdan çıxarılıb və itkiyə yazılıb. Bu, partiyanın atıldığını qeyd edir; qalıq yenidən azalmır.") : h("p", { className: "text-xs text-muted" }, "Dəyəri İtkilər hesabatına düşür: " + ', 'off note');
  s = replaceOnce(s, '    off ? jsxRuntimeExports.jsx(PsAdminDialog, { title: off.lot.name + " — anbardan sil",',
    `    ext ? jsxRuntimeExports.jsx(PsAdminDialog, { title: ext.lot.name + " — son istifadə tarixini düzəlt", onClose: () => setExt(null), busy, children: psH("div", { className: "space-y-3" },
      psH("p", { className: "text-xs text-muted" }, "Tarix səhv yazılıbsa düzəldin: partiya yenidən istifadəyə qayıdır və qalığa əlavə olunur. Həqiqətən vaxtı keçibsə, \\"Atıldı\\" seçin."),
      psLabeled("Yeni son istifadə tarixi", psH("input", { type: "date", value: ext.date, className: psField, onChange: (e) => setExt({ ...ext, date: e.target.value }) })),
      psH("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy || !ext.date, onClick: () => void run(window.pos.stock.extendLot(ext.lot.id, ext.date), "Tarix düzəldildi — partiya istifadəyə qayıtdı").then((ok) => { if (ok) setExt(null); }), children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setExt(null), children: "İmtina" }))) }) : null,
    off ? jsxRuntimeExports.jsx(PsAdminDialog, { title: off.lot.name + " — anbardan sil",`, 'ext dialog');
  s = replaceOnce(s, 'info.expiredLots ? h("b", null, info.expiredLots + " partiyanın vaxtı keçib (" + formatMoney(info.expiredValueMinor) + ")") : null,',
    'info.expiredLots ? h("b", null, info.expiredLots + " partiyanın vaxtı keçib — istifadədən çıxarılıb, atılmalıdır (" + formatMoney(info.expiredValueMinor) + ")") : null,', 'banner');
  s = replaceOnce(s, 'psMetric("Anbarda vaxtı keçmiş", formatMoney(data.expiredOnHandMinor),', 'psMetric("Atılmalı (vaxtı keçmiş)", formatMoney(data.expiredOnHandMinor),', 'loss metric');
  fs.writeFileSync(BUNDLE, s);
  console.log('expiry block applied');
}
