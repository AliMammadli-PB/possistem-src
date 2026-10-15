#!/usr/bin/env node
/**
 * 1.9.0 — the shop side of Əməliyyatlar, shared with Market POS.
 *
 *  - Mallar: one list of goods with search (barcode, name, code, price, PLU),
 *    category, price per branch, totals at cost / sale / profit; new, copy,
 *    edit; Excel export and import; scale files (Market only).
 *  - Kateqoriyalar: a tree, goods are tied to a category or sub-category.
 *  - İnventarizasiya: the "before" document, counting by hand, scanner,
 *    terminal file or phone (portal), the comparison, then the store holds
 *    the count. Terminal exchange files: CSV/TXT and Mobile SMARTS.
 *  - Qazanc: money that came into a kassa from outside sales, as documents.
 *  - Anbar: cost / sale / profit per row, Excel; Xərclər, Alışlar and kassa
 *    movements open on today with a date or range to look further back.
 *  - Toasts show above open dialogs; "Kuryerə ver" prints the courier slip.
 *  - window.__psMarketMode (Market POS) hides Kalkulyasiya and Çatdırılma.
 * Runs last but one (before buildstamp).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
const MAIN = path.join(ROOT, 'index.js');
const PRELOAD = path.join(ROOT, 'out', 'preload', 'index.js');
const MARK = '/* POS_ERP_V2_v1 */';

function replaceOnce(src, find, repl, label) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, got ${n}`);
  return src.replace(find, repl);
}

export const ERP_METHODS = [
  'categories.list', 'categories.save', 'categories.delete',
  'goods.list', 'goods.prices', 'goods.import',
  'stocktake.list', 'stocktake.create', 'stocktake.get', 'stocktake.count', 'stocktake.post',
  'stocktake.import', 'stocktake.update', 'stocktake.cancel',
  'income.list', 'income.save', 'income.delete',
  'cashAccounts.moves', 'inventory.movements',
];

{
  let m = fs.readFileSync(MAIN, 'utf8');
  if (!m.includes('_psSaveBinaryFile')) {
    // Another step may already have synced the core methods from protocol.json; add only what is missing.
    const policy = [`"categories.list":{auth:!0,perm:"inventory.view",timeout:5e3,idempotent:!1}`, `"categories.save":{auth:!0,perm:"inventory.manage",timeout:5e3,idempotent:!1}`, `"categories.delete":{auth:!0,perm:"inventory.manage",timeout:5e3,idempotent:!1}`, `"goods.list":{auth:!0,perm:"inventory.view",timeout:15e3,idempotent:!1}`, `"goods.prices":{auth:!0,perm:"inventory.manage",timeout:5e3,idempotent:!1}`, `"goods.import":{auth:!0,perm:"inventory.manage",timeout:6e4,idempotent:!1}`, `"stocktake.import":{auth:!0,perm:"inventory.count",timeout:6e4,idempotent:!1}`, `"stocktake.update":{auth:!0,perm:"inventory.count",timeout:5e3,idempotent:!1}`, `"stocktake.cancel":{auth:!0,perm:"inventory.count",timeout:5e3,idempotent:!1}`, `"income.list":{auth:!0,perm:"cash.manage",timeout:1e4,idempotent:!1}`, `"income.save":{auth:!0,perm:"cash.manage",timeout:1e4,idempotent:!0}`, `"income.delete":{auth:!0,perm:"cash.manage",timeout:1e4,idempotent:!1}`, `"files.saveBinary":{auth:!0,perm:null,timeout:6e4,idempotent:!1}`];
    const missing = policy.filter((entry) => !m.includes(entry.slice(0, entry.indexOf(':') + 1)));
    if (missing.length) m = replaceOnce(m, 'Cn={', 'Cn={' + missing.join(',') + ',', 'main policy');
    // Generous timeouts where the screens move many lines at once.
    for (const [method, timeout] of [['goods.list', '15e3'], ['goods.import', '6e4'], ['stocktake.import', '6e4'], ['stocktake.get', '15e3'], ['stocktake.post', '6e4']]) {
      m = m.replace(new RegExp(`("${method.replace('.', '\\.')}":\\{[^}]*timeout:)[^,]+`), `$1${timeout}`);
    }
    // Excel (xlsx) from the renderer: base64 in, the operator picks where it goes.
    m = replaceOnce(m, 'case"files.saveText":return _psSaveTextFile(t);', 'case"files.saveText":return _psSaveTextFile(t);case"files.saveBinary":return _psSaveBinaryFile(t);', 'main saveBinary case');
    m = replaceOnce(m, 'async function _psSaveTextFile(e){', 'async function _psSaveBinaryFile(e){const t=e&&typeof e=="object"?e:{};const n=String(t.filename||"possistem.xlsx").replace(/[\\\\/:*?"<>|]/g,"_");const x=(n.match(/\\.([a-z0-9]{1,5})$/i)||[,"bin"])[1];try{const r=c.BrowserWindow.getFocusedWindow()??c.BrowserWindow.getAllWindows()[0];const o={defaultPath:n,filters:[{name:x.toUpperCase(),extensions:[x]}]};const a=r?await c.dialog.showSaveDialog(r,o):await c.dialog.showSaveDialog(o);if(a.canceled||!a.filePath)return{success:!0,data:{canceled:!0}};const b=Buffer.from(String(t.base64??""),"base64");p.writeFileSync(a.filePath,b);return{success:!0,data:{canceled:!1,path:a.filePath,bytes:b.length}}}catch(r){return{success:!1,error:{code:"E_IO",message:r instanceof Error?r.message:String(r),retryable:!1}}}}async function _psSaveTextFile(e){', 'main saveBinary fn');
    fs.writeFileSync(MAIN, m);
    console.log('main: erp v2');
  }
}
{
  let p = fs.readFileSync(PRELOAD, 'utf8');
  if (!p.includes('saveBinary:')) {
    p = replaceOnce(p, '    saveText: (filename, text) => call("files.saveText", { filename, text }),',
      '    saveText: (filename, text) => call("files.saveText", { filename, text }),\n    saveBinary: (filename, base64) => call("files.saveBinary", { filename, base64 }, { timeoutMs: 60000 }),', 'preload saveBinary');
    p = replaceOnce(p, '  files: {\n', `  erp: {
    /** Mallar, Kateqoriyalar, İnventarizasiya, Qazanc and dated lists (1.9.0). */
    call: (method, payload, options) => ${JSON.stringify(ERP_METHODS)}.includes(method)
      ? call(method, payload ?? {}, options)
      : Promise.resolve({ success: false, data: null, error: { code: "E_FORBIDDEN", message: "Not allowed", retryable: false } })
  },
  files: {
`, 'preload erp');
    fs.writeFileSync(PRELOAD, p);
    console.log('preload: erp v2');
  }
}

const COMPONENTS = String.raw`${MARK}
function psErp(method, payload, options) { return window.pos.erp.call(method, payload ?? {}, options); }
function psMarketMode() { return Boolean(window.__psMarketMode); }
function psMoneyIn(text) { const v = Number(String(text ?? "").replace(/\s+/g, "").replace(",", ".")); return Number.isFinite(v) ? Math.round(v * 100) : NaN; }
function psQtyIn(text) { const v = Number(String(text ?? "").replace(/\s+/g, "").replace(",", ".")); return Number.isFinite(v) ? Math.round(v * 1000) : NaN; }
const psAzn = (minor) => Math.round(Number(minor) || 0) / 100;
const psQtyNum = (milli) => Math.round(Number(milli) || 0) / 1000;

/** Period chips + optional date range, the same everywhere. */
function usePsRange(initial) {
  const [period, setPeriod] = reactExports.useState(initial || "day");
  const [range, setRange] = reactExports.useState({ from: "", to: "" });
  const [from, to] = psDayRange(period, range.from, range.to);
  return { period, setPeriod, range, setRange, from, to };
}
function psRangeBar(r) {
  const h = psH;
  const date = "rounded-xl border border-hairline bg-elevated px-2 py-1.5 text-cream";
  return [
    ...[["day", "Bu gün"], ["yesterday", "Dünən"], ["week", "Bu həftə"], ["month", "Bu ay"], ["custom", "Tarix seç"]].map(([k, l]) =>
      h("button", { key: "rg-" + k, type: "button", "aria-pressed": r.period === k, className: "ps-period-chip" + (r.period === k ? " is-on" : ""), onClick: () => r.setPeriod(k) }, l)),
    r.period === "custom" ? h("span", { key: "rg-dates", className: "flex items-center gap-1 text-sm text-muted" },
      h("input", { type: "date", value: r.range.from, onChange: (e) => r.setRange({ ...r.range, from: e.target.value }), className: date }), "—",
      h("input", { type: "date", value: r.range.to, onChange: (e) => r.setRange({ ...r.range, to: e.target.value }), className: date })) : null
  ];
}
function psSearchBox(value, onChange, placeholder, key) {
  return psH("input", { key: key || "search", type: "search", value, placeholder, onChange: (e) => onChange(e.target.value),
    className: "min-h-10 min-w-[200px] flex-1 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream" });
}
const psSelectCls = "min-h-10 rounded-xl border border-hairline bg-elevated px-3 text-sm text-cream";

// ------------------------------------------------------------ files (xlsx)
const _psCrcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function psCrc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = _psCrcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** A stored (uncompressed) zip: all an xlsx needs. */
function psZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = psCrc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(14, 0x21, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
function psXmlEsc(s) { return String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
function psColName(i) { let s = ""; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
/** One sheet; numbers stay numbers so Excel can sum them. Row 1 is bold. */
function psXlsx(sheet, rows) {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const body = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
    const ref = psColName(ci) + (ri + 1);
    const style = ri === 0 ? ' s="1"' : "";
    if (typeof v === "number" && Number.isFinite(v)) return '<c r="' + ref + '"' + style + '><v>' + v + '</v></c>';
    if (v === null || v === undefined || v === "") return "";
    return '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + psXmlEsc(v) + '</t></is></c>';
  }).join("") + "</row>").join("");
  const widths = (rows[0] || []).map((_, ci) => Math.min(60, Math.max(10, ...rows.slice(0, 200).map((r) => String(r[ci] ?? "").length + 2))));
  const cols = widths.length ? "<cols>" + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>" : "";
  const name = String(sheet || "Siyahı").replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31);
  return psZip([
    { name: "[Content_Types].xml", data: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", data: head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + psXmlEsc(name) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/styles.xml", data: head + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' },
    { name: "xl/worksheets/sheet1.xml", data: head + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + body + '</sheetData></worksheet>' }
  ]);
}
async function psUnzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Fayl Excel (.xlsx) deyil");
  const dec = new TextDecoder();
  const out = new Map();
  let p = dv.getUint32(eocd + 16, true);
  for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + size);
    out.set(name, async () => method === 0 ? raw
      : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()));
  }
  return out;
}
/** The first sheet as rows of text. */
async function psReadXlsx(buf) {
  const zip = await psUnzip(buf);
  const dec = new TextDecoder();
  const xml = async (name) => zip.has(name) ? new DOMParser().parseFromString(dec.decode(await zip.get(name)()), "application/xml") : null;
  const shared = [];
  const ss = await xml("xl/sharedStrings.xml");
  if (ss) for (const si of ss.getElementsByTagName("si")) shared.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
  const sheetName = zip.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : [...zip.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  const doc = sheetName ? await xml(sheetName) : null;
  if (!doc) throw new Error("Excel faylında vərəq tapılmadı");
  const rows = [];
  for (const row of doc.getElementsByTagName("row")) {
    const cells = [];
    for (const c of row.getElementsByTagName("c")) {
      const letters = (c.getAttribute("r") || "").replace(/\d+/g, "");
      let idx = cells.length;
      if (letters) { idx = 0; for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64); idx -= 1; }
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      cells[idx] = t === "s" ? (shared[Number(v)] ?? "") : t === "inlineStr" ? [...c.getElementsByTagName("t")].map((x) => x.textContent).join("") : v;
    }
    rows.push(Array.from(cells, (x) => String(x ?? "").trim()));
  }
  return rows;
}
function psParseText(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const first = lines[0] || "";
  const sep = [";", "\t", ",", "|"].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"')));
}
/** xlsx, csv, txt (terminal) - whatever the operator picked, as rows. */
async function psReadTableFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) return psReadXlsx(buf);
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("windows-1254").decode(buf);
  return psParseText(text);
}
function psPickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept || "";
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}
async function psSaveFile(filename, data, mime) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  try {
    if (window.pos?.files?.saveBinary) {
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const r = await window.pos.files.saveBinary(filename, btoa(bin));
      if (!r.success) { toast(r.error?.message || "Fayl saxlanılmadı", "danger"); return false; }
      if (r.data?.canceled) return false;
      toast("Fayl saxlanıldı: " + (r.data?.path || filename), "success");
      return true;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast("Fayl yükləndi: " + filename, "success");
    return true;
  } catch (error) { toast(error?.message || "Fayl saxlanılmadı", "danger"); return false; }
}
function psStamp() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function psExcel(base, sheet, rows) {
  return psSaveFile(base + "-" + psStamp() + ".xlsx", psXlsx(sheet, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
/** Header names in Azerbaijani, Turkish, Russian or English → field. */
function psHeaderMap(row, wanted) {
  const norm = (s) => String(s || "").toLocaleLowerCase("az").replace(/[^a-zəöüğıçşа-я0-9]/gi, "");
  const map = {};
  row.forEach((cell, i) => {
    const n = norm(cell);
    for (const [field, names] of Object.entries(wanted)) if (map[field] === undefined && names.some((w) => n === w || n.startsWith(w))) map[field] = i;
  });
  return map;
}

// ---------------------------------------------------------------- scales
/** Scale label files: imported with the maker's tool (CL-Works, DIGI, Aclas Link / RLS). */
const PS_SCALES = {
  cas: { label: "CAS (CL-Works)", ext: "csv" },
  digi: { label: "DIGI (SM)", ext: "txt" },
  aclas: { label: "Rongta / Aclas", ext: "txt" },
  csv: { label: "Ümumi CSV", ext: "csv" }
};
function psScaleFile(kind, goods, prefix) {
  const items = goods.filter((g) => Number(g.weighted) && Number(g.plu) > 0);
  const price = (g) => (psAzn(g.salePriceMinor)).toFixed(2);
  const code = (g) => String(g.plu).padStart(5, "0");
  const name = (g) => String(g.name).replace(/[;,\t\r\n"]/g, " ").slice(0, 40);
  let text = "";
  if (kind === "cas") text = "PLU No,Item Code,Name,Unit Price,Weight Unit,Barcode Prefix\r\n" + items.map((g) => [g.plu, code(g), '"' + name(g) + '"', price(g), "kg", prefix].join(",")).join("\r\n");
  else if (kind === "digi") text = items.map((g) => [g.plu, code(g), name(g), Math.round(Number(g.salePriceMinor) || 0), 0, prefix].join("\t")).join("\r\n");
  else if (kind === "aclas") text = "ID\tItemCode\tName\tPrice\tUnit\tBarcodeType\r\n" + items.map((g) => [g.plu, code(g), name(g), price(g), 4, prefix].join("\t")).join("\r\n");
  else text = "﻿PLU;Kod;Ad;Qiymət (kq);Barkod;Prefiks\r\n" + items.map((g) => [g.plu, code(g), name(g), price(g), g.barcode || "", prefix].join(";")).join("\r\n");
  return { count: items.length, text };
}

// ------------------------------------------------------------ categories
function usePsCategories() {
  const [list, setList] = reactExports.useState(null);
  const reload = reactExports.useCallback(async () => {
    const r = await psErp("categories.list");
    if (r.success) setList(r.data); else toast(r.error.message, "danger");
  }, []);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  return [list, reload];
}
/** Parents before children, each with its depth. */
function psCategoryTree(categories) {
  const byParent = new Map();
  for (const c of categories) { const k = c.parentId || ""; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(c); }
  const out = [];
  const walk = (parent, depth) => { for (const c of byParent.get(parent) || []) { out.push({ ...c, depth }); if (depth < 12) walk(c.id, depth + 1); } };
  walk("", 0);
  return out;
}
function psCategorySelect(categories, value, onChange, opts) {
  const o = opts || {};
  return psH("select", { value: value || "", onChange: (e) => onChange(e.target.value), className: o.className || psSelectCls },
    psH("option", { value: "" }, o.all || "Bütün kateqoriyalar"),
    o.none ? psH("option", { value: "none" }, o.none) : null,
    psCategoryTree(categories || []).map((c) => psH("option", { key: c.id, value: c.id, disabled: o.disable === c.id }, "  ".repeat(c.depth) + c.name)));
}

function OpsCategories() {
  const h = psH;
  const [confirmAsk, confirmDialog] = useConfirm();
  const [data, reload] = usePsCategories();
  const [form, setForm] = reactExports.useState(null);
  const [query, setQuery] = reactExports.useState("");
  const [busy, run] = useOpsAction(reload);
  if (!data) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");
  const tree = psCategoryTree(data.categories ?? []);
  const needle = query.trim().toLocaleLowerCase("az");
  const shown = needle ? tree.filter((c) => String(c.path || c.name).toLocaleLowerCase("az").includes(needle)) : tree;
  const save = () => {
    if (!form.name.trim()) { toast("Adı yazın", "danger"); return; }
    void run(psErp("categories.save", { ...(form.id ? { id: form.id } : {}), name: form.name.trim(), parentId: form.parentId || "" }), "Saxlanıldı")
      .then((ok) => { if (ok) setForm(null); });
  };
  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      psMetric("Kateqoriya", String(tree.filter((c) => !c.parentId).length), "ana kateqoriya"),
      psMetric("Alt kateqoriya", String(tree.filter((c) => c.parentId).length), "qol"),
      psMetric("Kateqoriyasız mal", String(data.uncategorized ?? 0), "Mallar bölməsindən bağlayın", (data.uncategorized ?? 0) ? "var(--ps-warn)" : null)),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      psSearchBox(query, setQuery, "Kateqoriya axtar…"),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ name: "", parentId: "" }), children: "+ Kateqoriya" })),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["Kateqoriya", "Mal sayı", ""],
      empty: needle ? "Tapılmadı" : "Hələ kateqoriya yoxdur. \"+ Kateqoriya\" ilə başlayın.",
      rows: shown.map((c) => [
        h("span", { className: "ps-cat-name", style: { paddingLeft: (c.depth * 22) + "px" } }, c.depth ? "└ " : "", h("b", null, c.name)),
        String(c.goods ?? 0),
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm({ name: "", parentId: c.id }), children: "+ Alt kateqoriya" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm({ id: c.id, name: c.name, parentId: c.parentId || "" }), children: "Düzəliş" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: async () => {
            if (!(await confirmAsk('"' + c.name + '" silinsin? İçindəki mallar və alt kateqoriyalar bir pillə yuxarı keçir.', { danger: true }))) return;
            void run(psErp("categories.delete", { categoryId: c.id }), "Silindi");
          }, children: "Sil" }))])
    }),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Kateqoriyanı dəyiş" : (form.parentId ? "Yeni alt kateqoriya" : "Yeni kateqoriya"), onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      jsxRuntimeExports.jsx(OpsField, { label: "Ad", value: form.name, onChange: (v) => setForm({ ...form, name: v }), placeholder: "məs. İçkilər" }),
      psLabeled("Hansı kateqoriyanın içində", psCategorySelect(data.categories, form.parentId, (v) => setForm({ ...form, parentId: v }), { all: "— Ana kateqoriya —", disable: form.id, className: psField })),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null,
    confirmDialog);
}

// ----------------------------------------------------------------- goods
function psGoodForm(g, copy) {
  return {
    id: copy ? undefined : g?.id,
    name: g ? g.name + (copy ? " (kopya)" : "") : "",
    barcode: copy ? "" : (g?.barcode || ""),
    unit: g?.unit || "ədəd",
    categoryId: g?.categoryId || "",
    cost: g ? (psAzn(g.lastCostMinor ?? g.costMinor)).toFixed(2) : "",
    sale: g ? (psAzn(g.basePriceMinor ?? g.salePriceMinor)).toFixed(2) : "",
    minQty: g && g.minQtyMilli ? String(psQtyNum(g.minQtyMilli)) : "",
    weighted: g ? Boolean(Number(g.weighted)) : false,
    plu: copy || !g ? "" : (Number(g.plu) ? String(g.plu) : ""),
    prices: Object.fromEntries((g?.prices ?? []).map((p) => [p.objectId, (psAzn(p.salePriceMinor)).toFixed(2)])),
    copyOf: copy ? g?.name : ""
  };
}
function PsGoodDialog({ form, setForm, categories, objects, onSaved }) {
  const h = psH;
  const [busy, run] = usePsDialogRun(onSaved);
  const set = (patch) => setForm({ ...form, ...patch });
  const save = () => {
    if (!form.name.trim()) { toast("Malın adını yazın", "danger"); return; }
    const cost = form.cost === "" ? 0 : psMoneyIn(form.cost);
    const sale = form.sale === "" ? 0 : psMoneyIn(form.sale);
    if (!Number.isFinite(cost) || !Number.isFinite(sale) || cost < 0 || sale < 0) { toast("Alış və satış qiyməti düzgün rəqəm olmalıdır", "danger"); return; }
    const minQty = form.minQty === "" ? 0 : psQtyIn(form.minQty);
    const prices = [];
    for (const o of objects) {
      const v = form.prices[o.id];
      if (v === undefined || String(v).trim() === "") continue;
      const m = psMoneyIn(v);
      if (!Number.isFinite(m) || m < 0) { toast(o.name + ": qiyməti düzgün yazın", "danger"); return; }
      prices.push({ objectId: o.id, salePriceMinor: m });
    }
    const barcode = String(form.barcode || "").trim() || psMakeBarcode(new Set());
    void run(window.pos.inventory.saveIngredient({
      ...(form.id ? { id: form.id } : {}),
      name: form.name.trim(), unit: form.unit, barcode, costMinor: cost, salePriceMinor: sale, minQtyMilli: Number.isFinite(minQty) ? minQty : 0,
      categoryId: form.categoryId || "", weighted: Boolean(form.weighted), plu: Number(form.plu) || 0, prices,
      idempotencyKey: newIdempotencyKey()
    }), form.id ? "Saxlanıldı" : "Yeni mal yaradıldı").then((ok) => { if (ok) setForm(null); });
  };
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Malı dəyiş" : (form.copyOf ? "Kopyadan yeni mal" : "Yeni mal"), onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
    form.copyOf ? h("p", { className: "text-xs text-muted" }, "\"" + form.copyOf + "\" malının məlumatları köçürüldü. Düzəliş edib yadda saxlayın — yeni mal yaranacaq. Eyni barkodla ikinci mal yaratmaq olmur.") : null,
    h("div", { className: "grid gap-2 sm:grid-cols-2" },
      jsxRuntimeExports.jsx(OpsField, { label: "Malın adı", value: form.name, onChange: (v) => set({ name: v }), placeholder: "məs. Coca-Cola 1L" }),
      psLabeled("Barkod", h("span", { className: "flex gap-1" },
        h("input", { value: form.barcode, autoFocus: !form.id, inputMode: "numeric", className: psField, placeholder: "Skanerlə oxudun · boş qalsa avtomatik",
          onChange: (e) => set({ barcode: e.target.value.replace(/\s+/g, "") }), onKeyDown: (e) => { if (e.key === "Enter") e.preventDefault(); } }),
        h("button", { type: "button", className: "ps-mini-btn", title: "Daxili barkod yarat", onClick: () => set({ barcode: psMakeBarcode(new Set()) }) }, "⟳"))),
      psLabeled("Kateqoriya", psCategorySelect(categories, form.categoryId, (v) => set({ categoryId: v }), { all: "— Kateqoriyasız —", className: psField })),
      psLabeled("Vahid", h("select", { value: form.unit, className: psField, onChange: (e) => set({ unit: e.target.value, weighted: e.target.value === "kg" ? true : form.weighted }) },
        [["ədəd", "ədəd"], ["kg", "kq"], ["l", "litr"], ["qab", "qab"]].map(([u, l]) => h("option", { key: u, value: u }, l)))),
      jsxRuntimeExports.jsx(OpsField, { label: "Alış qiyməti (₼)", value: form.cost, onChange: (v) => set({ cost: v }), placeholder: "0.00" }),
      jsxRuntimeExports.jsx(OpsField, { label: "Satış qiyməti (₼)", value: form.sale, onChange: (v) => set({ sale: v }), placeholder: "0.00" }),
      jsxRuntimeExports.jsx(OpsField, { label: "Minimum qalıq", value: form.minQty, onChange: (v) => set({ minQty: v }), placeholder: "0" }),
      h("div", { className: "grid grid-cols-2 gap-2" },
        h("label", { className: "flex items-center gap-2 pt-6 text-sm text-cream" }, h("input", { type: "checkbox", checked: form.weighted, onChange: (e) => set({ weighted: e.target.checked }) }), "Çəkili (tərəzi)"),
        form.weighted ? jsxRuntimeExports.jsx(OpsField, { label: "PLU (tərəzi kodu)", value: form.plu, onChange: (v) => set({ plu: v.replace(/\D/g, "").slice(0, 5) }), placeholder: "avtomatik" }) : null)),
    objects.length ? h("div", { className: "ps-price-box" },
      h("p", { className: "text-xs uppercase tracking-wide text-faint" }, "Obyektə görə satış qiyməti"),
      h("p", { className: "text-xs text-muted" }, "Boş qalsa hər yerdə ümumi satış qiyməti işləyir."),
      h("div", { className: "grid gap-2 sm:grid-cols-2" }, objects.map((o) =>
        jsxRuntimeExports.jsx(OpsField, { key: o.id, label: o.name + " (₼)", value: form.prices[o.id] ?? "", placeholder: form.sale || "0.00",
          onChange: (v) => set({ prices: { ...form.prices, [o.id]: v } }) })))) : null,
    h("div", { className: "flex gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(null), children: "İmtina" })))
  });
}
const PS_GOODS_HEADERS = {
  barcode: ["barkod", "barcode", "штрихкод", "ean", "kod"],
  name: ["ad", "malınadı", "maladı", "mal", "name", "ürün", "urun", "наименование", "название", "товар"],
  cost: ["alış", "alis", "maya", "cost", "alış qiyməti", "закуп", "себестоимость", "purchase"],
  sale: ["satış", "satis", "qiymət", "qiymet", "price", "fiyat", "цена", "sale"],
  unit: ["vahid", "unit", "birim", "ед"],
  category: ["kateqoriya", "category", "kategori", "группа", "категория"]
};
function PsGoodsImport({ onClose, onDone }) {
  const h = psH;
  const [rows, setRows] = reactExports.useState(null);
  const [update, setUpdate] = reactExports.useState(true);
  const [result, setResult] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState(false);
  const pick = async () => {
    const file = await psPickFile(".xlsx,.csv,.txt");
    if (!file) return;
    try {
      const table = (await psReadTableFile(file)).filter((r) => r.some((c) => String(c).trim()));
      if (!table.length) { toast("Faylda sətir yoxdur", "danger"); return; }
      let map = psHeaderMap(table[0], PS_GOODS_HEADERS);
      let body = table.slice(1);
      if (map.name === undefined && map.barcode === undefined) { map = { barcode: 0, name: 1, cost: 2, sale: 3, unit: 4, category: 5 }; body = table; }
      const unitOf = (u) => { const s = String(u || "").toLocaleLowerCase("az"); return s.startsWith("k") ? "kg" : s.startsWith("l") ? "l" : s.startsWith("q") && s !== "qab" ? "q" : s === "qab" ? "qab" : "ədəd"; };
      const money = (v) => { const m = psMoneyIn(v); return Number.isFinite(m) && String(v).trim() !== "" ? m : -1; };
      setRows(body.map((r) => ({
        barcode: String(r[map.barcode] ?? "").replace(/\s+/g, "").replace(/\.0+$/, ""), name: String(r[map.name] ?? "").trim(),
        costMinor: map.cost === undefined ? -1 : money(r[map.cost]), salePriceMinor: map.sale === undefined ? -1 : money(r[map.sale]),
        unit: map.unit === undefined ? "ədəd" : unitOf(r[map.unit]), category: map.category === undefined ? "" : String(r[map.category] ?? "").trim()
      })).filter((r) => r.name || r.barcode));
    } catch (error) { toast(error?.message || "Fayl oxunmadı", "danger"); }
  };
  const go = async () => {
    setBusy(true);
    try {
      let created = 0, updated = 0, skipped = 0;
      const problems = [];
      for (let i = 0; i < rows.length; i += 500) {
        const r = await psErp("goods.import", { rows: rows.slice(i, i + 500), updateExisting: update }, { timeoutMs: 60000 });
        if (!r.success) { toast(r.error.message, "danger"); return; }
        created += r.data.created; updated += r.data.updated; skipped += r.data.skipped;
        for (const p of r.data.problems ?? []) problems.push({ ...p, line: p.line + i });
      }
      setResult({ created, updated, skipped, problems });
      toast("İdxal bitdi: " + created + " yeni, " + updated + " yeniləndi", "success");
      if (onDone) await onDone();
    } finally { setBusy(false); }
  };
  const template = () => psExcel("mallar-numune", "Mallar", [["Barkod", "Ad", "Alış", "Satış", "Vahid", "Kateqoriya"], ["4760000000017", "Nümunə mal", 1.2, 2, "ədəd", "İçkilər / Sular"]]);
  return jsxRuntimeExports.jsx(PsAdminDialog, { title: "Excel-dən mal idxalı", onClose, busy, children: h("div", { className: "space-y-3" },
    h("p", { className: "text-sm text-muted" }, "Sütunlar: Barkod, Ad, Alış, Satış, Vahid, Kateqoriya (\"Ana / Alt\"). Başlıq sətri tanınır; olmasa bu sırayla oxunur. .xlsx, .csv, .txt."),
    h("div", { className: "flex flex-wrap gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => void pick(), disabled: busy, children: rows ? "Başqa fayl seç" : "Fayl seç" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void template(), children: "Nümunə fayl" })),
    rows ? h("div", { className: "space-y-2" },
      h("p", { className: "text-sm text-cream" }, rows.length + " sətir oxundu. İlk sətirlər:"),
      jsxRuntimeExports.jsx(OpsTable, { head: ["Barkod", "Ad", "Alış", "Satış", "Vahid", "Kateqoriya"], empty: "",
        rows: rows.slice(0, 6).map((r) => [r.barcode || "—", r.name || "—", r.costMinor >= 0 ? formatMoney(r.costMinor) : "—", r.salePriceMinor >= 0 ? formatMoney(r.salePriceMinor) : "—", r.unit, r.category || "—"]) }),
      h("label", { className: "flex items-center gap-2 text-sm text-cream" }, h("input", { type: "checkbox", checked: update, onChange: (e) => setUpdate(e.target.checked) }), "Barkodu olan mallar yenilənsin (ad, qiymət, kateqoriya)"),
      jsxRuntimeExports.jsx(OpsButton, { disabled: busy || !rows.length, onClick: () => void go(), children: busy ? "İdxal edilir…" : "İdxal et" })) : null,
    result ? h("div", { className: "ps-recipe-note" },
      h("p", null, "Yeni: " + result.created + " · Yeniləndi: " + result.updated + " · Ötürüldü: " + result.skipped),
      result.problems.slice(0, 20).map((p) => h("p", { key: p.line + p.error, className: "text-xs", style: { color: "var(--ps-danger)" } }, "Sətir " + p.line + ": " + p.error))) : null)
  });
}
function OpsGoods() {
  const h = psH;
  const [confirmAsk, confirmDialog] = useConfirm();
  const acc = usePsAccounts();
  const objects = acc?.objects ?? [];
  const [cats, reloadCats] = usePsCategories();
  const [warehouses, setWarehouses] = reactExports.useState([]);
  const [query, setQuery] = reactExports.useState("");
  const [needle, setNeedle] = reactExports.useState("");
  const [categoryId, setCategoryId] = reactExports.useState("");
  const [objectId, setObjectId] = reactExports.useState("");
  const [warehouseId, setWarehouseId] = reactExports.useState("");
  const [data, setData] = reactExports.useState(null);
  const [form, setForm] = reactExports.useState(null);
  const [importing, setImporting] = reactExports.useState(false);
  const [scale, setScale] = reactExports.useState(null);
  reactExports.useEffect(() => { const t = setTimeout(() => setNeedle(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  reactExports.useEffect(() => { void window.pos.inventory.warehouses().then((r) => { if (r.success) setWarehouses(r.data.warehouses ?? []); }); }, []);
  const seq = reactExports.useRef(0);
  const reload = reactExports.useCallback(async () => {
    const n = ++seq.current;
    const r = await psErp("goods.list", { search: needle, categoryId, objectId, warehouseId });
    if (n !== seq.current) return;
    if (r.success) setData(r.data); else toast(r.error.message, "danger");
  }, [needle, categoryId, objectId, warehouseId]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!data || !cats) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");
  const goods = data.goods ?? [];
  const t = data.totals ?? {};
  const exportExcel = () => psExcel("mallar", "Mallar", [
    ["Barkod", "Ad", "Kateqoriya", "Vahid", "PLU", "Alış (₼)", "Satış (₼)", "Qalıq", "Cəmi alış (₼)", "Cəmi satış (₼)", "Qazanc (₼)"],
    ...goods.map((g) => [g.barcode || "", g.name, g.categoryPath || "", g.unit, Number(g.plu) || "", psAzn(g.costMinor), psAzn(g.salePriceMinor), psQtyNum(g.qtyMilli), psAzn(g.costValueMinor), psAzn(g.saleValueMinor), psAzn(g.profitMinor)]),
    ["", "CƏMİ", "", "", "", "", "", "", psAzn(t.costMinor), psAzn(t.saleMinor), psAzn(t.profitMinor)]
  ]);
  const saveScale = () => {
    const prefix = String(scale.prefix || "20").replace(/\D/g, "").slice(0, 2) || "20";
    const file = psScaleFile(scale.kind, goods, prefix);
    if (!file.count) { toast("Çəkili və PLU-su olan mal yoxdur", "danger"); return; }
    void psSaveFile("terezi-" + scale.kind + "-" + psStamp() + "." + PS_SCALES[scale.kind].ext, file.text, "text/plain").then((ok) => { if (ok) setScale(null); });
  };
  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      psMetric("Mal", String(t.count ?? goods.length), "siyahıda"),
      psMetric("Cəmi alış", formatMoney(t.costMinor ?? 0), "qalıq × alış"),
      psMetric("Cəmi satış", formatMoney(t.saleMinor ?? 0), "qalıq × satış" + (objectId ? " (obyekt qiyməti)" : "")),
      psMetric("Qazanc", formatMoney(t.profitMinor ?? 0), "satış − alış", (t.profitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)")),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      psSearchBox(query, setQuery, "Axtar: barkod / ad / qiymət / PLU"),
      psCategorySelect(cats.categories, categoryId, setCategoryId, { none: "Kateqoriyasız" }),
      objects.length ? psObjectFilter(objects, objectId, setObjectId, "Qiymət: ümumi") : null,
      warehouses.length > 1 ? h("select", { value: warehouseId, onChange: (e) => setWarehouseId(e.target.value), className: psSelectCls },
        h("option", { value: "" }, "Bütün anbarlar"), warehouses.map((w) => h("option", { key: w.id, value: w.id }, w.name))) : null),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm(psGoodForm(null, false)), children: "+ Yeni mal" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void exportExcel(), children: "Excel ixrac" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setImporting(true), children: "Excel import" }),
      psMarketMode() ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setScale({ kind: "cas", prefix: "20" }), children: "Tərəziyə çıxış" }) : null),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["Barkod", "Mal", "Alış", "Satış", "Qalıq", "Cəmi alış", "Cəmi satış", "Qazanc", ""],
      empty: needle || categoryId ? "Bu axtarışa uyğun mal yoxdur" : "Hələ mal yoxdur — \"+ Yeni mal\" və ya Excel import",
      rows: goods.map((g) => [
        h("span", { className: "font-mono text-xs" }, g.barcode || "—", Number(g.plu) ? h("span", { className: "block text-faint" }, "PLU " + g.plu) : null),
        h("span", { className: "block" }, h("span", { className: "block font-medium text-cream" }, g.name),
          g.categoryPath ? h("span", { className: "block text-[11px] text-faint" }, g.categoryPath) : null),
        formatMoney(g.costMinor ?? 0),
        h("span", null, formatMoney(g.salePriceMinor ?? 0), g.objectPriceMinor !== null && g.objectPriceMinor !== undefined ? h("span", { className: "block text-[11px] text-gold" }, "obyekt qiyməti") : null),
        h("span", { style: (Number(g.qtyMilli) || 0) < 0 ? { color: "var(--ps-danger)", fontWeight: 600 } : null }, opsQty(g.qtyMilli), " ", g.unit),
        formatMoney(g.costValueMinor ?? 0), formatMoney(g.saleValueMinor ?? 0),
        h("b", { style: { color: (g.profitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(g.profitMinor ?? 0)),
        h("span", { className: "flex flex-wrap gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(psGoodForm(g, false)), children: "Düzəliş" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm(psGoodForm(g, true)), children: "Kopyala" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: async () => {
            if (!(await confirmAsk('"' + g.name + '" silinsin? Keçmiş hərəkətlər qalır.', { danger: true }))) return;
            void run(window.pos.inventory.deactivateIngredient(g.id), "Silindi");
          }, children: "Sil" }))])
    }),
    goods.length ? h("p", { className: "text-xs text-muted" }, "Cəmi: " + goods.length + " mal · alış " + formatMoney(t.costMinor ?? 0) + " · satış " + formatMoney(t.saleMinor ?? 0) + " · qazanc " + formatMoney(t.profitMinor ?? 0)) : null,
    form ? jsxRuntimeExports.jsx(PsGoodDialog, { form, setForm, categories: cats.categories, objects, onSaved: async () => { await reload(); await reloadCats(); } }) : null,
    importing ? jsxRuntimeExports.jsx(PsGoodsImport, { onClose: () => setImporting(false), onDone: async () => { await reload(); await reloadCats(); } }) : null,
    scale ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Tərəziyə çıxış", onClose: () => setScale(null), children: h("div", { className: "space-y-3" },
      h("p", { className: "text-sm text-muted" }, "Çəkili (PLU-su olan) mallar tərəzi faylına yazılır. Faylı tərəzinin proqramı ilə (CL-Works, DIGI, Aclas Link / RLS) tərəziyə yükləyin."),
      h("div", { className: "flex flex-wrap gap-2" }, Object.entries(PS_SCALES).map(([k, v]) =>
        h("button", { key: k, type: "button", "aria-pressed": scale.kind === k, className: "ps-period-chip" + (scale.kind === k ? " is-on" : ""), onClick: () => setScale({ ...scale, kind: k }) }, v.label))),
      jsxRuntimeExports.jsx(OpsField, { label: "Çəki barkodunun prefiksi", value: scale.prefix, onChange: (v) => setScale({ ...scale, prefix: v }), placeholder: "20" }),
      h("p", { className: "text-xs text-muted" }, psScaleFile(scale.kind, goods, "20").count + " çəkili mal yazılacaq (siyahıdakı filtrə görə)."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { onClick: saveScale, children: "Faylı saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setScale(null), children: "Bağla" }))) }) : null,
    confirmDialog);
}

// -------------------------------------------------------------- stocktake
const PS_ST_STATUS = { open: ["Sayılır", "warn"], posted: ["Anbara yükləndi", "ok"], cancelled: ["Ləğv edilib", "danger"], counted: ["Sayılıb", "warn"] };
const PS_COUNT_HEADERS = { barcode: ["barkod", "barcode", "штрихкод", "kod", "code", "ean"], qty: ["miqdar", "say", "qty", "quantity", "количество", "кол", "adet", "miktar", "fakt"] };
function PsStocktakeDetail({ id, onBack }) {
  const h = psH;
  const [confirmAsk, confirmDialog] = useConfirm();
  const [doc, setDoc] = reactExports.useState(null);
  const [filter, setFilter] = reactExports.useState("all");
  const [query, setQuery] = reactExports.useState("");
  const [scan, setScan] = reactExports.useState("");
  const [scanQty, setScanQty] = reactExports.useState("1");
  const [edits, setEdits] = reactExports.useState({});
  const [phone, setPhone] = reactExports.useState(false);
  const [pending, setPending] = reactExports.useState(null);
  const scanRef = reactExports.useRef(null);
  const reload = reactExports.useCallback(async () => {
    const r = await psErp("stocktake.get", { stocktakeId: id }, { timeoutMs: 30000 });
    if (r.success) setDoc(r.data); else toast(r.error.message, "danger");
  }, [id]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!doc) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");
  const open = doc.status === "open";
  const lines = doc.lines ?? [];
  const tot = doc.totals ?? {};
  const needle = query.trim().toLocaleLowerCase("az");
  const shown = lines.filter((l) => {
    if (filter === "counted" && l.countedMilli === null) return false;
    if (filter === "uncounted" && l.countedMilli !== null) return false;
    if (filter === "diff" && !(Number(l.diffMilli) || 0)) return false;
    return !needle || String(l.name).toLocaleLowerCase("az").includes(needle) || String(l.barcode || "").includes(needle) || String(l.sku || "").toLocaleLowerCase("az").includes(needle);
  });
  const addScan = async () => {
    const code = scan.trim();
    if (!code) return;
    const qty = psQtyIn(scanQty || "1");
    if (!Number.isFinite(qty) || qty === 0) { toast("Miqdarı yazın", "danger"); return; }
    const byName = lines.filter((l) => String(l.name).toLocaleLowerCase("az").includes(code.toLocaleLowerCase("az")));
    const payload = /^\d{4,}$/.test(code) || !byName.length ? { barcode: code } : byName.length === 1 ? { ingredientId: byName[0].ingredientId } : null;
    if (!payload) { setQuery(code); toast("Bir neçə mal tapıldı — siyahıdan seçin", "warning"); return; }
    const r = await psErp("stocktake.count", { stocktakeId: id, ...payload, countedMilli: qty, mode: "add" });
    if (!r.success) { toast(r.error.message, "danger"); return; }
    toast(r.data.name + ": " + opsQty(r.data.countedMilli) + " " + r.data.unit, "success");
    setScan(""); setScanQty("1");
    await reload();
    scanRef.current?.focus();
  };
  const setCount = async (line, text) => {
    const clear = String(text).trim() === "";
    const qty = clear ? null : psQtyIn(text);
    if (!clear && (!Number.isFinite(qty) || qty < 0)) { toast("Miqdarı düzgün yazın", "danger"); return; }
    const r = await psErp("stocktake.count", { lineId: line.id, countedMilli: qty });
    if (!r.success) { toast(r.error.message, "danger"); return; }
    setEdits((e) => { const n = { ...e }; delete n[line.id]; return n; });
    await reload();
  };
  const importFile = async () => {
    const file = await psPickFile(".xlsx,.csv,.txt,.dat");
    if (!file) return;
    try {
      const table = (await psReadTableFile(file)).filter((r) => r.some((c) => String(c).trim()));
      let map = psHeaderMap(table[0] || [], PS_COUNT_HEADERS);
      let body = table.slice(1);
      if (map.barcode === undefined) { map = { barcode: 0, qty: table[0] && table[0].length > 2 ? 2 : 1 }; body = table; }
      const linesIn = body.map((r) => ({ barcode: String(r[map.barcode] ?? "").trim(), qtyMilli: psQtyIn(r[map.qty] ?? "") })).filter((l) => l.barcode && Number.isFinite(l.qtyMilli));
      if (!linesIn.length) { toast("Faylda barkod və miqdar tapılmadı", "danger"); return; }
      setPending({ lines: linesIn, file: file.name });
    } catch (error) { toast(error?.message || "Fayl oxunmadı", "danger"); }
  };
  const applyImport = async (mode) => {
    const linesIn = pending.lines;
    setPending(null);
    const r = await psErp("stocktake.import", { stocktakeId: id, lines: linesIn, mode }, { timeoutMs: 60000 });
    if (!r.success) { toast(r.error.message, "danger"); return; }
    toast(r.data.matched + " mal yükləndi" + (r.data.unmatched?.length ? " · " + r.data.unmatched.length + " barkod tapılmadı" : ""), r.data.unmatched?.length ? "warning" : "success");
    if (r.data.unmatched?.length) void psExcel("tapilmayan-barkodlar", "Tapılmadı", [["Barkod", "Miqdar"], ...r.data.unmatched.map((u) => [u.code, psQtyNum(u.qtyMilli)])]);
    await reload();
  };
  const terminalExport = async (kind) => {
    const r = await psErp("goods.list", { warehouseId: doc.warehouseId });
    if (!r.success) { toast(r.error.message, "danger"); return; }
    const goods = r.data.goods ?? [];
    const clean = (s) => String(s ?? "").replace(/[;\t\r\n"]/g, " ");
    const text = kind === "smarts"
      ? "﻿Штрихкод;Наименование;Артикул;Цена;Остаток;Ед.\r\n" + goods.map((g) => [g.barcode || "", clean(g.name), g.sku || "", psAzn(g.salePriceMinor).toFixed(2), psQtyNum(g.qtyMilli), g.unit].join(";")).join("\r\n")
      : "﻿barkod;ad;qiymet;qaliq;vahid\r\n" + goods.map((g) => [g.barcode || "", clean(g.name), psAzn(g.salePriceMinor).toFixed(2), psQtyNum(g.qtyMilli), g.unit].join(";")).join("\r\n");
    await psSaveFile((kind === "smarts" ? "mobile-smarts-mallar-" : "terminal-mallar-") + psStamp() + (kind === "smarts" ? ".csv" : ".txt"), text, "text/plain");
  };
  const docExcel = (which) => {
    const head = which === "before" ? ["Barkod", "Mal", "Vahid", "Əvvəlki qalıq", "Alış (₼)", "Dəyər (₼)"]
      : which === "count" ? ["Barkod", "Mal", "Vahid", "Sayılan", "Alış (₼)", "Dəyər (₼)"]
      : ["Barkod", "Mal", "Vahid", "Əvvəl", "Sayılan", "Fərq", "Fərq alışla (₼)", "Fərq satışla (₼)"];
    const rows = lines.map((l) => which === "before" ? [l.barcode || "", l.name, l.unit, psQtyNum(l.expectedMilli), psAzn(l.costMinor), psAzn(Math.round(l.expectedMilli * l.costMinor / 1000))]
      : which === "count" ? [l.barcode || "", l.name, l.unit, psQtyNum(l.targetMilli), psAzn(l.costMinor), psAzn(Math.round(l.targetMilli * l.costMinor / 1000))]
      : [l.barcode || "", l.name, l.unit, psQtyNum(l.expectedMilli), psQtyNum(l.targetMilli), psQtyNum(l.diffMilli), psAzn(l.diffCostMinor), psAzn(l.diffSaleMinor)]);
    const total = which === "before" ? ["", "CƏMİ", "", "", "", psAzn(tot.expectedCostMinor)] : which === "count" ? ["", "CƏMİ", "", "", "", psAzn(tot.countedCostMinor)] : ["", "CƏMİ", "", "", "", "", psAzn(tot.diffCostMinor), psAzn(tot.diffSaleMinor)];
    const name = { before: "evvelki-qaliq", count: "sayim", compare: "muqayise" }[which];
    return psExcel(name + "-" + (doc.number || doc.id), doc.number || "Sayım", [head, ...rows, total]);
  };
  const post = async () => {
    const msg = "Anbar \"" + doc.warehouseName + "\" sayılan miqdarlara bərabərləşsin?" + (Number(doc.zeroUncounted) ? " Sayılmayan " + ((tot.lines ?? 0) - (tot.counted ?? 0)) + " mal SIFIRLANACAQ." : " Sayılmayan mallara toxunulmur.");
    if (!(await confirmAsk(msg, { danger: true }))) return;
    void run(psErp("stocktake.post", { stocktakeId: id }, { timeoutMs: 60000, idempotencyKey: newIdempotencyKey() }), "Sayım anbara yükləndi");
  };
  const chip = (k, l, n) => h("button", { key: k, type: "button", "aria-pressed": filter === k, className: "ps-period-chip" + (filter === k ? " is-on" : ""), onClick: () => setFilter(k) }, l + " (" + n + ")");
  const [label, tone] = PS_ST_STATUS[doc.status] || [doc.status, "muted"];
  return h("div", { className: "space-y-4" },
    h("div", { className: "flex flex-wrap items-center gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: onBack, children: "← Siyahı" }),
      h("b", { className: "text-lg text-cream" }, doc.number || "Sayım"), psBadge(label, tone),
      h("span", { className: "text-sm text-muted" }, doc.warehouseName + " · " + opsWhen(doc.createdAt) + (doc.postedAt ? " · yükləndi " + opsWhen(doc.postedAt) : ""))),
    h("div", { className: "ps-stock-metrics" },
      psMetric("Əvvəlki qaimə", formatMoney(tot.expectedCostMinor ?? 0), (tot.lines ?? 0) + " mal (alışla)"),
      psMetric("Sayım qaiməsi", formatMoney(tot.countedCostMinor ?? 0), (tot.counted ?? 0) + " mal sayılıb"),
      psMetric("Fərq (alışla)", formatMoney(tot.diffCostMinor ?? 0), "satışla " + formatMoney(tot.diffSaleMinor ?? 0), (tot.diffCostMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)"),
      psMetric("Kəsir / artıq", (tot.short ?? 0) + " / " + (tot.over ?? 0), "mal")),
    open ? h("div", { className: "ps-count-bar" },
      h("input", { ref: scanRef, value: scan, autoFocus: true, placeholder: "Barkod oxudun və ya adını yazın, Enter", onChange: (e) => setScan(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); void addScan(); } }, className: "min-h-11 flex-1 rounded-xl border border-gold/40 bg-elevated px-3 text-cream" }),
      h("input", { value: scanQty, inputMode: "decimal", onChange: (e) => setScanQty(e.target.value), className: "min-h-11 w-24 rounded-xl border border-hairline bg-elevated px-3 text-cream", title: "Miqdar" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => void addScan(), children: "+ Say" })) : null,
    h("div", { className: "flex flex-wrap items-center gap-2" },
      chip("all", "Hamısı", lines.length), chip("counted", "Sayılıb", tot.counted ?? 0), chip("uncounted", "Sayılmayıb", (tot.lines ?? 0) - (tot.counted ?? 0)),
      chip("diff", "Fərqli", (tot.short ?? 0) + (tot.over ?? 0)),
      psSearchBox(query, setQuery, "Siyahıda axtar: ad / barkod", "st-q")),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      open ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void importFile(), children: "Terminaldan / fayldan yüklə" }) : null,
      open ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void terminalExport("txt"), children: "Terminala çıxış (TXT)" }) : null,
      open ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void terminalExport("smarts"), children: "Mobile SMARTS (CSV)" }) : null,
      open && !psMarketMode() ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPhone(true), children: "Telefonla say" }) : null,
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void docExcel("before"), children: "Əvvəlki qaimə" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void docExcel("count"), children: "Sayım qaiməsi" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void docExcel("compare"), children: "Müqayisə (Excel)" }),
      h("span", { className: "ml-auto" }),
      open ? h("label", { className: "flex items-center gap-2 text-sm text-cream" }, h("input", { type: "checkbox", checked: Boolean(Number(doc.zeroUncounted)),
        onChange: (e) => void run(psErp("stocktake.update", { stocktakeId: id, zeroUncounted: e.target.checked })) }), "Sayılmayanlar sıfırlansın") : null,
      open ? jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: async () => { if (await confirmAsk("Sayım ləğv edilsin? Anbara toxunulmur.", { danger: true })) void run(psErp("stocktake.cancel", { stocktakeId: id }), "Ləğv edildi"); }, children: "Ləğv et" }) : null,
      open ? jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: () => void post(), children: "Anbara yüklə" }) : null),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["Barkod", "Mal", "Əvvəl", "Sayılan", "Fərq", "Fərq (₼)"],
      empty: "Bu filtrdə mal yoxdur",
      rows: shown.slice(0, 1500).map((l) => {
        const diff = Number(l.diffMilli) || 0;
        const color = diff < 0 ? "var(--ps-danger)" : diff > 0 ? "var(--ps-ok)" : null;
        return [
          h("span", { className: "font-mono text-xs" }, l.barcode || l.sku || "—"),
          h("span", { className: "font-medium text-cream" }, l.name),
          opsQty(l.expectedMilli) + " " + l.unit,
          open ? h("input", { className: "ps-count-input", inputMode: "decimal", placeholder: l.countedMilli === null ? "—" : "",
            value: edits[l.id] ?? (l.countedMilli === null ? "" : String(psQtyNum(l.countedMilli))),
            onChange: (e) => setEdits({ ...edits, [l.id]: e.target.value }),
            onBlur: (e) => { if (edits[l.id] !== undefined) void setCount(l, e.target.value); },
            onKeyDown: (e) => { if (e.key === "Enter") e.currentTarget.blur(); } })
            : (l.countedMilli === null ? h("span", { className: "text-faint" }, "sayılmayıb") : opsQty(l.countedMilli) + " " + l.unit),
          h("b", { style: color ? { color } : null }, (diff > 0 ? "+" : "") + opsQty(diff)),
          h("span", { style: color ? { color } : null }, formatMoney(l.diffCostMinor ?? 0))];
      })
    }),
    shown.length > 1500 ? h("p", { className: "text-xs text-muted" }, "İlk 1500 sətir göstərilir — axtarışla daraldın.") : null,
    pending ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Fayldan sayım", onClose: () => setPending(null), children: h("div", { className: "space-y-3 text-sm text-cream" },
      h("p", null, pending.file + ": " + pending.lines.length + " sətir oxundu."),
      h("p", { className: "text-muted" }, "Bir neçə terminal ayrı-ayrı yerləri sayıbsa \"Üstünə gəl\" seçin; bu fayl son sayımdırsa \"Əvəz et\"."),
      h("div", { className: "flex flex-wrap gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { onClick: () => void applyImport("add"), children: "Üstünə gəl" }),
        jsxRuntimeExports.jsx(OpsButton, { onClick: () => void applyImport("set"), children: "Əvəz et" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPending(null), children: "İmtina" }))) }) : null,
    phone ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Telefonla say", onClose: () => setPhone(false), children: h("div", { className: "space-y-3 text-sm text-cream" },
      h("p", null, "Telefonda və ya Android terminalın brauzerində possistem.az-a daxil olun → Restoran idarəetməsi → Əməliyyatlar → İnventarizasiya."),
      h("p", null, "Bu sayımı (" + (doc.number || "") + ") açıb barkodu oxudun və ya adını yazın — saydığınız dərhal bu kompüterə gəlir. Bir neçə nəfər eyni anda saya bilər."),
      h("p", { className: "text-xs text-muted" }, "Kassa internetə qoşulu olmalıdır."),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setPhone(false), children: "Bağla" })) }) : null,
    confirmDialog);
}
function OpsStocktake() {
  const h = psH;
  const rg = usePsRange("month");
  const [rows, setRows] = reactExports.useState(null);
  const [warehouses, setWarehouses] = reactExports.useState([]);
  const [openId, setOpenId] = reactExports.useState("");
  const [form, setForm] = reactExports.useState(null);
  const [query, setQuery] = reactExports.useState("");
  const reload = reactExports.useCallback(async () => {
    const r = await psErp("stocktake.list", { from: 0 });
    if (r.success) setRows(r.data.stocktakes ?? []); else toast(r.error.message, "danger");
  }, []);
  reactExports.useEffect(() => { void reload(); void window.pos.inventory.warehouses().then((r) => { if (r.success) setWarehouses(r.data.warehouses ?? []); }); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (openId) return jsxRuntimeExports.jsx(PsStocktakeDetail, { id: openId, onBack: () => { setOpenId(""); void reload(); } });
  if (!rows) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");
  const needle = query.trim().toLocaleLowerCase("az");
  // Open counts stay in view whatever the dates; finished ones by period.
  const shown = rows.filter((s) => (s.status === "open" || ((Number(s.createdAt) || 0) >= rg.from && (Number(s.createdAt) || 0) < rg.to))
    && (!needle || [s.number, s.note, s.warehouseName, s.actorName].some((v) => String(v || "").toLocaleLowerCase("az").includes(needle))));
  const create = () => {
    void run(psErp("stocktake.create", { warehouseId: form.warehouseId || "", note: form.note.trim(), zeroUncounted: form.zero }, { idempotencyKey: newIdempotencyKey(), timeoutMs: 30000 }), "Sayım başladı — əvvəlki qalıq qaiməsi saxlanıldı")
      .then((d) => { if (d && d.id) { setForm(null); setOpenId(d.id); } });
  };
  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      psMetric("Açıq sayım", String(rows.filter((s) => s.status === "open").length), "davam edir", rows.some((s) => s.status === "open") ? "var(--ps-warn)" : null),
      psMetric("Bu dövrdə", String(shown.length), "inventarizasiya")),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      psRangeBar(rg), psSearchBox(query, setQuery, "Axtar: № / anbar / qeyd"),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ warehouseId: warehouses[0]?.id || "", note: "", zero: true }), children: "+ Yeni inventarizasiya" })),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["№", "Tarix", "Anbar", "Sayılıb", "Vəziyyət", "Kim", "Qeyd", ""],
      empty: "Bu dövrdə inventarizasiya yoxdur",
      rows: shown.map((s) => {
        const [label, tone] = PS_ST_STATUS[s.status] || [s.status, "muted"];
        return [h("b", null, s.number || "—"), opsWhen(s.createdAt), s.warehouseName, (s.countedCount ?? 0) + " / " + (s.lineCount ?? 0), psBadge(label, tone), s.actorName || "—", s.note || "—",
          jsxRuntimeExports.jsx(OpsButton, { tone: s.status === "open" ? "gold" : "quiet", onClick: () => setOpenId(s.id), children: s.status === "open" ? "Saymağa davam" : "Bax" })];
      })
    }),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: "Yeni inventarizasiya", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("p", { className: "text-sm text-muted" }, "Anbarın indiki qalıqları \"əvvəlki qaimə\" kimi saxlanılır. Sonra mallar sayılır (əl ilə, skanerlə, terminal faylı ilə və ya telefonla) və müqayisədən sonra sayım anbara yüklənir."),
      warehouses.length > 1 ? psLabeled("Anbar", h("select", { value: form.warehouseId, className: psField, onChange: (e) => setForm({ ...form, warehouseId: e.target.value }) },
        warehouses.map((w) => h("option", { key: w.id, value: w.id }, w.name)))) : null,
      jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: form.note, onChange: (v) => setForm({ ...form, note: v }), placeholder: "məs. aylıq sayım" }),
      h("label", { className: "flex items-center gap-2 text-sm text-cream" }, h("input", { type: "checkbox", checked: form.zero, onChange: (e) => setForm({ ...form, zero: e.target.checked }) }),
        "Sayılmayan mallar sıfırlansın (köhnə qalıqlar silinir)"),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: create, children: "Başla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null);
}

// ----------------------------------------------------------------- income
const PS_INCOME_KINDS = ["Əlavə gəlir", "İcarə", "Kəşbek / bonus", "Faiz", "Borc qaytarıldı", "Digər"];
function OpsIncome() {
  const h = psH;
  const [confirmAsk, confirmDialog] = useConfirm();
  const acc = usePsAccounts();
  const objects = acc?.objects ?? [];
  const accounts = acc?.accounts ?? [];
  const rg = usePsRange("day");
  const [objectId, setObjectId] = reactExports.useState("");
  const [accountId, setAccountId] = reactExports.useState("");
  const [kind, setKind] = reactExports.useState("");
  const [query, setQuery] = reactExports.useState("");
  const [needle, setNeedle] = reactExports.useState("");
  const [data, setData] = reactExports.useState(null);
  const [form, setForm] = reactExports.useState(null);
  reactExports.useEffect(() => { const t = setTimeout(() => setNeedle(query.trim()), 250); return () => clearTimeout(t); }, [query]);
  const reload = reactExports.useCallback(async () => {
    const r = await psErp("income.list", { from: rg.from, to: rg.to, objectId, accountId, kind, search: needle });
    if (r.success) setData(r.data); else toast(r.error.message, "danger");
  }, [rg.from, rg.to, objectId, accountId, kind, needle]);
  reactExports.useEffect(() => { void reload(); }, [reload]);
  const [busy, run] = useOpsAction(reload);
  if (!data) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");
  const docs = data.docs ?? [];
  const byKind = new Map();
  for (const d of docs) byKind.set(d.kind || "Digər", (byKind.get(d.kind || "Digər") || 0) + (Number(d.amountMinor) || 0));
  const toInput = (ms) => { const d = new Date(Number(ms) || Date.now()); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const save = () => {
    const amount = psMoneyIn(form.value);
    if (!Number.isFinite(amount) || amount <= 0) { toast("Məbləği yazın", "danger"); return; }
    if (!form.accountId) { toast("Pulun girdiyi kassanı / xəzinəni seçin", "danger"); return; }
    const k = form.kind === "Digər" && form.custom.trim() ? form.custom.trim() : form.kind;
    const day = new Date(form.date + "T00:00");
    const now = new Date();
    const docAt = Number.isFinite(day.getTime()) ? day.getTime() + (now.getHours() * 3600 + now.getMinutes() * 60) * 1000 : Date.now();
    void run(psErp("income.save", { ...(form.id ? { id: form.id } : {}), accountId: form.accountId, amountMinor: amount, kind: k, reason: form.reason.trim(), note: form.note.trim(), docAt, idempotencyKey: form.key },
      { idempotencyKey: form.key }), form.id ? "Qaimə düzəldildi" : "Qazanc yazıldı").then((ok) => { if (ok) setForm(null); });
  };
  return h("div", { className: "space-y-4" },
    h("div", { className: "ps-stock-metrics" },
      psMetric("Cəmi qazanc", formatMoney(data.totalMinor ?? 0), docs.length + " qaimə", "var(--ps-ok)"),
      ...[...byKind].slice(0, 4).map(([k, v]) => psMetric(k, formatMoney(v), "tip"))),
    h("div", { className: "flex flex-wrap items-center gap-2" }, psRangeBar(rg)),
    h("div", { className: "flex flex-wrap items-center gap-2" },
      psSearchBox(query, setQuery, "Axtar: səbəb / qeyd / №"),
      psObjectFilter(objects, objectId, setObjectId),
      h("select", { value: accountId, onChange: (e) => setAccountId(e.target.value), className: psSelectCls },
        h("option", { value: "" }, "Bütün kassalar"), accounts.map((a) => h("option", { key: a.id, value: a.id }, a.name))),
      h("select", { value: kind, onChange: (e) => setKind(e.target.value), className: psSelectCls },
        h("option", { value: "" }, "Bütün tiplər"), [...new Set([...PS_INCOME_KINDS, ...(data.kinds ?? [])])].map((k) => h("option", { key: k, value: k }, k))),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void psExcel("qazanc", "Qazanc", [["№", "Tarix", "Tip", "Səbəb", "Kassa", "Obyekt", "Məbləğ (₼)", "Qeyd", "Kim"],
        ...docs.map((d) => [d.number, opsWhen(d.docAt), d.kind, d.reason, d.accountName, d.objectName, psAzn(d.amountMinor), d.note, d.actorName]), ["", "", "", "", "", "CƏMİ", psAzn(data.totalMinor), "", ""]]), children: "Excel" }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: () => setForm({ kind: PS_INCOME_KINDS[0], custom: "", value: "", reason: "", note: "", date: toInput(Date.now()), accountId: undefined, key: newIdempotencyKey() }), children: "+ Qazanc" })),
    jsxRuntimeExports.jsx(OpsTable, {
      head: ["№", "Tarix", "Tip", "Səbəb", "Kassa / obyekt", "Məbləğ", "Qeyd", ""],
      empty: "Bu dövrdə qazanc yoxdur",
      rows: docs.map((d) => [h("b", null, d.number), opsWhen(d.docAt), d.kind || "—", d.reason || "—", [d.accountName, d.objectName].filter(Boolean).join(" · ") || "—",
        h("b", { style: { color: "var(--ps-ok)" } }, "+" + formatMoney(d.amountMinor ?? 0)), d.note || "—",
        h("span", { className: "flex gap-1" },
          jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: busy, onClick: () => setForm({ id: d.id, kind: PS_INCOME_KINDS.includes(d.kind) ? d.kind : "Digər", custom: PS_INCOME_KINDS.includes(d.kind) ? "" : d.kind,
            value: psAzn(d.amountMinor).toFixed(2), reason: d.reason || "", note: d.note || "", date: toInput(d.docAt), accountId: d.accountId, key: newIdempotencyKey() }), children: "Düzəliş" }),
          jsxRuntimeExports.jsx(OpsButton, { tone: "danger", disabled: busy, onClick: async () => {
            if (!(await confirmAsk(d.number + " silinsin? " + formatMoney(d.amountMinor) + " kassadan geri çıxılır.", { danger: true }))) return;
            void run(psErp("income.delete", { id: d.id }), "Silindi");
          }, children: "Sil" }))])
    }),
    form ? jsxRuntimeExports.jsx(PsAdminDialog, { title: form.id ? "Qazanc qaiməsini düzəlt" : "Yeni qazanc", onClose: () => setForm(null), busy, children: h("div", { className: "space-y-3" },
      h("div", { className: "flex flex-wrap gap-2" }, PS_INCOME_KINDS.map((k) =>
        h("button", { key: k, type: "button", "aria-pressed": form.kind === k, className: "ps-period-chip" + (form.kind === k ? " is-on" : ""), onClick: () => setForm({ ...form, kind: k }) }, k))),
      form.kind === "Digər" ? jsxRuntimeExports.jsx(OpsField, { label: "Tip", value: form.custom, onChange: (v) => setForm({ ...form, custom: v }), placeholder: "məs. Sponsorluq" }) : null,
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: "Məbləğ (₼)", value: form.value, onChange: (v) => setForm({ ...form, value: v }), placeholder: "0.00" }),
        psLabeled("Tarix", h("input", { type: "date", value: form.date, className: psField, onChange: (e) => setForm({ ...form, date: e.target.value }) })),
        jsxRuntimeExports.jsx(OpsField, { label: "Səbəb", value: form.reason, onChange: (v) => setForm({ ...form, reason: v }), placeholder: "məs. anbarın icarəsi" }),
        jsxRuntimeExports.jsx(OpsField, { label: "Qeyd", value: form.note, onChange: (v) => setForm({ ...form, note: v }), placeholder: "" })),
      jsxRuntimeExports.jsx(PsAccountSelect, { value: form.accountId, onChange: (v) => setForm((p) => (p ? { ...p, accountId: v } : p)), label: "Hansı kassaya / xəzinəyə" }),
      h("p", { className: "text-xs text-muted" }, "Pul seçilən kassaya girir. Qaimə sonra düzəldilə və ya silinə bilər — kassa da düzəlir."),
      h("div", { className: "flex gap-2" },
        jsxRuntimeExports.jsx(OpsButton, { disabled: busy, onClick: save, children: "Yadda saxla" }),
        jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setForm(null), children: "İmtina" }))) }) : null,
    confirmDialog);
}

/** Kassa movements for a period (default today), with search. */
function PsKassaMoves({ account, kinds, onClose }) {
  const h = psH;
  const rg = usePsRange("day");
  const [query, setQuery] = reactExports.useState("");
  const [rows, setRows] = reactExports.useState(null);
  reactExports.useEffect(() => {
    let alive = true;
    void psErp("cashAccounts.moves", { accountId: account.id, from: rg.from, to: rg.to }).then((r) => {
      if (!alive) return;
      if (r.success) setRows(r.data.moves ?? []); else toast(r.error.message, "danger");
    });
    return () => { alive = false; };
  }, [account.id, rg.from, rg.to]);
  const needle = query.trim().toLocaleLowerCase("az");
  const shown = (rows ?? []).filter((e) => !needle || [e.note, kinds[e.kind] || e.kind, e.actorName].some((v) => String(v || "").toLocaleLowerCase("az").includes(needle)));
  const sum = shown.reduce((t, e) => t + (Number(e.amountMinor) || 0), 0);
  return h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
    h("div", { className: "flex items-center justify-between gap-3" },
      h("p", { className: "text-sm font-semibold text-cream" }, account.name + " — hərəkətlər (satışlardan başqa)"),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: onClose, children: "Bağla" })),
    h("div", { className: "flex flex-wrap items-center gap-2" }, psRangeBar(rg), psSearchBox(query, setQuery, "Axtar: qeyd / növ / kim")),
    rows === null ? h("p", { className: "text-sm text-muted" }, "Yüklənir…") : jsxRuntimeExports.jsx(OpsTable, { head: ["Tarix", "Növ", "Məbləğ", "Qeyd", "Kim"], empty: "Bu dövrdə hərəkət yoxdur",
      rows: shown.map((e) => [opsWhen(e.createdAt), kinds[e.kind] || e.kind,
        h("b", { style: { color: (e.amountMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, ((e.amountMinor ?? 0) < 0 ? "−" : "+") + formatMoney(Math.abs(e.amountMinor ?? 0))),
        e.note || "—", e.actorName || "—"]) }),
    shown.length ? h("p", { className: "text-xs text-muted" }, shown.length + " hərəkət · net " + formatMoney(sum)) : null);
}
`;

let s = fs.readFileSync(BUNDLE, 'utf8');
if (s.includes(MARK)) {
  console.log('bundle already applied');
} else {
  s = replaceOnce(s, '// --------------------------------------------------------------------- shell\nfunction OperationsPage() {',
    COMPONENTS + '\n// --------------------------------------------------------------------- shell\nfunction OperationsPage() {', 'components');

  // New tabs, next to Anbar; Market leaves out Kalkulyasiya and Çatdırılma.
  s = replaceOnce(s, `    { id: "purchases", label: "Alışlar", show: hasPermission("suppliers.view") && _psArea("/operations?tab=suppliers"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsPurchases, {}) },
    { id: "costing", label: "Kalkulyasiya", show: hasPermission("inventory.view") && _psArea("/operations?tab=stock"),`,
  `    { id: "goods", label: "Mallar", show: hasPermission("inventory.view") && _psArea("/operations?tab=stock"), render: () => jsxRuntimeExports.jsx(OpsGoods, {}) },
    { id: "categories", label: "Kateqoriyalar", show: hasPermission("inventory.view") && _psArea("/operations?tab=stock"), render: () => jsxRuntimeExports.jsx(OpsCategories, {}) },
    { id: "stocktake", label: "İnventarizasiya", show: hasPermission("inventory.count") && _psArea("/operations?tab=stock"), render: () => jsxRuntimeExports.jsx(OpsStocktake, {}) },
    { id: "purchases", label: "Alışlar", show: hasPermission("suppliers.view") && _psArea("/operations?tab=suppliers"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsPurchases, {}) },
    { id: "costing", label: "Kalkulyasiya", show: !psMarketMode() && hasPermission("inventory.view") && _psArea("/operations?tab=stock"),`, 'tabs');
  s = replaceOnce(s, `    { id: "expenses", label: "Xərclər", show: hasPermission("cash.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsExpenses, {}) },
    { id: "delivery", label: "Çatdırılma", show: hasPermission("delivery.view"),`,
  `    { id: "expenses", label: "Xərclər", show: hasPermission("cash.manage"), render: () => /* @__PURE__ */ jsxRuntimeExports.jsx(OpsExpenses, {}) },
    { id: "income", label: "Qazanc", show: hasPermission("cash.manage"), render: () => jsxRuntimeExports.jsx(OpsIncome, {}) },
    { id: "delivery", label: "Çatdırılma", show: !psMarketMode() && hasPermission("delivery.view"),`, 'tabs 2');
  // Market has no Kalkulyasiya or Çatdırılma at all: gone, not greyed out.
  s = replaceOnce(s, `  ];
  const tabs = _psTabs.filter((tab) => tab.show);`,
    `  ].filter((tab) => !(psMarketMode() && (tab.id === "costing" || tab.id === "delivery")));
  const tabs = _psTabs.filter((tab) => tab.show);`, 'market tabs');
  s = replaceOnce(s, `    expenses: ["Kassadan çıxan xərclər — bazarlıq, kommunal və s.", "Kasadan çıkan giderler.", "Money paid out of the till."],`,
    `    expenses: ["Kassadan çıxan xərclər — bazarlıq, kommunal və s.", "Kasadan çıkan giderler.", "Money paid out of the till."],
    goods: ["Bütün mallar — barkod, kateqoriya, obyektə görə qiymət; cəmi alış, satış və qazanc.", "Tüm ürünler.", "All goods."],
    categories: ["Kateqoriyalar və alt kateqoriyalar — mallar bunlara bağlanır.", "Kategoriler ve alt kategoriler.", "Categories and sub-categories."],
    stocktake: ["Sayım: əvvəlki qalıq qaiməsi, sayım qaiməsi, müqayisə və anbara yükləmə.", "Sayım ve karşılaştırma.", "Stock count and comparison."],
    income: ["Kassaya və xəzinəyə satışdan kənar gələn pul — qaimə kimi.", "Kasaya gelen diğer gelirler.", "Other money into a till or treasury."],`, 'subtitles');

  // Admin hub and sidebar doors.
  s = replaceOnce(s, `    { to: "/operations?tab=purchases", label: "Alışlar", icon: Store, show: hasPermission("suppliers.view") },
    { to: "/operations?tab=vendors", label: "Partnyorlar", icon: Users, show: hasPermission("suppliers.view") || hasPermission("customers.view") },
    { to: "/operations?tab=delivery", label: "Çatdırılma", icon: Move, show: hasPermission("delivery.view") },
    { to: "/operations?tab=sales", label: "Satışlar",`,
  `    { to: "/operations?tab=goods", label: "Mallar", icon: PackageOpen, show: hasPermission("inventory.view") },
    { to: "/operations?tab=stocktake", label: "İnventarizasiya", icon: ClipboardList, show: hasPermission("inventory.count") },
    { to: "/operations?tab=purchases", label: "Alışlar", icon: Store, show: hasPermission("suppliers.view") },
    { to: "/operations?tab=vendors", label: "Partnyorlar", icon: Users, show: hasPermission("suppliers.view") || hasPermission("customers.view") },
    { to: "/operations?tab=delivery", label: "Çatdırılma", icon: Move, show: !psMarketMode() && hasPermission("delivery.view") },
    { to: "/operations?tab=sales", label: "Satışlar",`, 'admin hub');
  s = replaceOnce(s, `    { to: "/operations?tab=stock", label: "Anbar", icon: PackageOpen, show: hasPermission("inventory.view") },
    { to: "/operations?tab=purchases", label: "Alışlar", icon: Store, show: hasPermission("suppliers.view") },
    { to: "/operations?tab=vendors", label: "Partnyorlar", icon: Users, show: hasPermission("suppliers.view") || hasPermission("customers.view") },
    { to: "/operations?tab=delivery", label: "Çatdırılma", icon: Move, show: hasPermission("delivery.view") },
  ];`,
  `    { to: "/operations?tab=stock", label: "Anbar", icon: PackageOpen, show: hasPermission("inventory.view") },
    { to: "/operations?tab=goods", label: "Mallar", icon: PackageOpen, show: hasPermission("inventory.view") },
    { to: "/operations?tab=stocktake", label: "İnventarizasiya", icon: ClipboardList, show: hasPermission("inventory.count") },
    { to: "/operations?tab=purchases", label: "Alışlar", icon: Store, show: hasPermission("suppliers.view") },
    { to: "/operations?tab=vendors", label: "Partnyorlar", icon: Users, show: hasPermission("suppliers.view") || hasPermission("customers.view") },
    { to: "/operations?tab=delivery", label: "Çatdırılma", icon: Move, show: !psMarketMode() && hasPermission("delivery.view") },
  ];`, 'sidebar');

  // Anbar: per row what the stock cost, sells for and earns; barcode search; Excel.
  s = replaceOnce(s, `    return String(row.name ?? "").toLowerCase().includes(needle)
        || String(row.sku ?? "").toLowerCase().includes(needle);`,
  `    return String(row.name ?? "").toLowerCase().includes(needle)
        || String(row.sku ?? "").toLowerCase().includes(needle)
        || String(row.barcode ?? "").toLowerCase().includes(needle);`, 'stock search');
  s = replaceOnce(s, `      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { onClick: () => setDrawer({ name: "", unit: "kg", cost: "", sale: "", barcode: "" }), children: "+ Yeni məhsul" })`,
  `      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => { const q = (r) => Math.max(0, Number(r.qtyMilli) || 0); void psExcel("anbar", "Anbar", [["Barkod", "Mal", "Vahid", "Miqdar", "Alış (₼)", "Satış (₼)", "Cəmi alış (₼)", "Cəmi satış (₼)", "Qazanc (₼)"],
        ...shown.map((r) => [r.barcode || r.sku || "", r.name, r.unit, psQtyNum(r.qtyMilli), psAzn(r.costMinor), psAzn(r.salePriceMinor), psAzn(Math.round(q(r) * (r.costMinor ?? 0) / 1000)), psAzn(Math.round(q(r) * (r.salePriceMinor ?? 0) / 1000)), psAzn(Math.round(q(r) * ((r.salePriceMinor ?? 0) - (r.costMinor ?? 0)) / 1000))]),
        ["", "CƏMİ", "", "", "", "", psAzn(psStockTotals(shown).buy), psAzn(psStockTotals(shown).sell), psAzn(psStockTotals(shown).sell - psStockTotals(shown).buy)]]); }, children: "Excel ixrac" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(OpsButton, { onClick: () => setDrawer({ name: "", unit: "kg", cost: "", sale: "", barcode: "" }), children: "+ Yeni məhsul" })`, 'stock excel');
  s = replaceOnce(s, `      head: ["Məhsul", "Cari stok", "Satış", "Maya", "Stok dəyəri", "Status", ""],`,
    `      head: ["Məhsul", "Cari stok", "Alış", "Satış", "Cəmi alış", "Cəmi satış", "Qazanc", "Status", ""],`, 'stock head');
  s = replaceOnce(s, `          formatMoney(row.salePriceMinor ?? 0),
          formatMoney(row.costMinor ?? 0),
          formatMoney(value),`,
  `          formatMoney(row.costMinor ?? 0),
          formatMoney(row.salePriceMinor ?? 0),
          formatMoney(Math.max(0, value)),
          formatMoney(Math.max(0, Math.round((Number(row.qtyMilli) || 0) * (row.salePriceMinor ?? 0) / 1000))),
          psH("b", { style: { color: (row.salePriceMinor ?? 0) < (row.costMinor ?? 0) ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(Math.max(0, Math.round((Number(row.qtyMilli) || 0) * ((row.salePriceMinor ?? 0) - (row.costMinor ?? 0)) / 1000)))),`, 'stock row');

  // Xərclər: today by default, any date or range, search.
  s = replaceOnce(s, `  const [period, setPeriod] = reactExports.useState("month");
  const [form, setForm] = reactExports.useState(null);
  const expenseAcc = usePsAccounts();`,
  `  const rg = usePsRange("day");
  const [expenseQ, setExpenseQ] = reactExports.useState("");
  const [form, setForm] = reactExports.useState(null);
  const expenseAcc = usePsAccounts();`, 'expenses state');
  s = replaceOnce(s, `  const since = psPeriodStart(period, 0);
  const shown = rows.filter((m) => (Number(m.createdAt) || 0) >= since && (!expenseObject || m.objectId === expenseObject));`,
  `  const expenseNeedle = expenseQ.trim().toLocaleLowerCase("az");
  const shown = rows.filter((m) => (Number(m.createdAt) || 0) >= rg.from && (Number(m.createdAt) || 0) < rg.to && (!expenseObject || m.objectId === expenseObject)
    && (!expenseNeedle || [m.reason, m.note, m.accountName, m.objectName].some((v) => String(v || "").toLocaleLowerCase("az").includes(expenseNeedle))));`, 'expenses filter');
  s = replaceOnce(s, `      [["day", "Bu gün"], ["week", "Bu həftə"], ["month", "Bu ay"]].map(([k, l]) =>
        h("button", { key: k, type: "button", "aria-pressed": period === k, className: "ps-period-chip" + (period === k ? " is-on" : ""), onClick: () => setPeriod(k) }, l)),
      psObjectFilter(expenseObjects, expenseObject, setExpenseObject),`,
  `      psRangeBar(rg),
      psSearchBox(expenseQ, setExpenseQ, "Axtar: səbəb / qeyd / kassa"),
      psObjectFilter(expenseObjects, expenseObject, setExpenseObject),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => void psExcel("xercler", "Xərclər", [["Tarix", "Kateqoriya", "Kassa", "Obyekt", "Məbləğ (₼)", "Qeyd"], ...shown.map((m) => [opsWhen(m.createdAt), m.reason || "", m.accountName || "", m.objectName || "", psAzn(m.amountMinor), m.note || ""]), ["", "", "", "CƏMİ", psAzn(total), ""]]), children: "Excel" }),`, 'expenses bar');

  // Kassalar → hərəkətlər: by date, today first.
  s = replaceOnce(s, `    moves ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, moves.account.name + " — hərəkətlər (satışlardan başqa)"),`,
  `    moves ? jsxRuntimeExports.jsx(PsKassaMoves, { account: moves.account, kinds: MOVE, onClose: () => setMoves(null) }, moves.account.id) : null,
    false ? h("section", { className: "space-y-3 rounded-2xl border border-hairline bg-elevated p-4" },
      h("div", { className: "flex items-center justify-between gap-3" },
        h("p", { className: "text-sm font-semibold text-cream" }, moves.account.name + " — hərəkətlər (satışlardan başqa)"),`, 'kassa moves');
  s = replaceOnce(s, `    const r = await window.pos.cashAccounts.moves(a.id);
    if (r.success) setMoves({ account: a, rows: r.data.moves ?? [] }); else toast(r.error.message, "danger");`,
    `    setMoves({ account: a, rows: [] });`, 'kassa open moves');

  // Alışlar: today by default, any date or range, search.
  s = replaceOnce(s, `      h("span", { className: "ml-auto" }),
      canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setRet(`,
    `      view === "invoices" || view === "returns" ? psRangeBar(purchaseRange) : null,
      view === "invoices" ? psSearchBox(purchaseQ, setPurchaseQ, "Axtar: qaimə № / təchizatçı / qeyd", "pq") : null,
      h("span", { className: "ml-auto" }),
      canManage ? jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", onClick: () => setRet(`, 'purchases bar');
  s = replaceOnce(s, `      rows: purchases.filter((p) => p.status !== "draft").map((p) => [`,
    `      rows: purchases.filter((p) => p.status !== "draft" && psInPurchaseRange(p) && psPurchaseMatch(p)).map((p) => [`, 'purchases filter');
  {
    const at = s.indexOf('function OpsPurchases() {');
    if (at < 0 || s.indexOf('function OpsPurchases() {', at + 1) >= 0) throw new Error('OpsPurchases: anchor');
    const body = s.indexOf('\n', at) + 1;
    s = s.slice(0, body) + `  const purchaseRange = usePsRange("day");
  const [purchaseQ, setPurchaseQ] = reactExports.useState("");
  const psInPurchaseRange = (p) => { const t = Number(psOpsTimestamp(p.receivedAt || p.createdAt)) || 0; return t >= purchaseRange.from && t < purchaseRange.to; };
  const psPurchaseMatch = (p) => { const q = purchaseQ.trim().toLocaleLowerCase("az"); return !q || [p.number, p.supplierName, p.note, p.invoiceNo, p.objectName, p.warehouseName].some((v) => String(v || "").toLocaleLowerCase("az").includes(q)); };
` + s.slice(body);
  }

  // "Kuryerə ver": the courier's slip - goods, prices, guest, phone, address.
  s = replaceOnce(s, `      const d = await window.pos.delivery.dispatch({ deliveryId: info ? info.id : "", orderId: order.id, courierId, mode });
      if (!d.success) { toast(d.error.message, "danger"); return; }`,
  `      const d = await window.pos.delivery.dispatch({ deliveryId: info ? info.id : "", orderId: order.id, courierId, mode });
      if (!d.success) { toast(d.error.message, "danger"); return; }
      void window.pos.print.enqueue({ orderId: order.id, kind: "customer_bill" }, { idempotencyKey: newIdempotencyKey(), timeoutMs: 3e4 })
        .then((p) => { if (!p.success) toast("Kuryer çeki çap olunmadı: " + (p.error?.message || ""), "warning"); });`, 'courier slip');

  // Toasts sit in the top layer, above modal dialogs (which live there too).
  s = replaceOnce(s, `  const reduce = useReducedMotion();
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "pointer-events-none fixed top-6 left-1/2 z-[100] flex w-[min(420px,92vw)] -translate-x-1/2 flex-col gap-2", children:`,
  `  const reduce = useReducedMotion();
  const hostRef = reactExports.useRef(null);
  reactExports.useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el || typeof el.showPopover !== "function") return;
    try { if (el.matches(":popover-open")) el.hidePopover(); if (toasts.length) el.showPopover(); } catch {}
  }, [toasts]);
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { ref: hostRef, popover: "manual", className: "ps-toast-host pointer-events-none fixed top-6 left-1/2 z-[100] flex w-[min(420px,92vw)] -translate-x-1/2 flex-col gap-2", children:`, 'toast host');

  fs.writeFileSync(BUNDLE, s);
  console.log('erp v2 applied');
}

{
  const CSS = path.join(ROOT, 'possistem-system.css');
  let css = fs.readFileSync(CSS, 'utf8');
  if (!css.includes(MARK)) {
    css += `
${MARK}
.ps-toast-host[popover] { inset: auto; top: 24px; left: 50%; right: auto; bottom: auto; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; color: inherit; }
.ps-toast-host:not(:popover-open) { display: none; }
.ps-cat-name { display: inline-block; }
.ps-mini-btn { min-width: 40px; margin-top: 4px; border-radius: 12px; border: 1px solid var(--ps-line, #e2e8f0); background: transparent; font-size: 16px; }
.ps-price-box { display: grid; gap: 6px; padding: 12px; border-radius: 14px; border: 1px dashed var(--ps-line, #e2e8f0); }
.ps-count-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px; border-radius: 14px; border: 1px solid rgba(201,168,106,0.35); background: rgba(201,168,106,0.07); }
.ps-count-input { width: 96px; min-height: 36px; padding: 0 8px; border-radius: 10px; border: 1px solid var(--ps-line, #e2e8f0); background: transparent; color: inherit; }
.ps-count-input:focus { outline: none; border-color: #c9a86a; }
@media (max-width: 640px) { .ps-count-bar input:first-child { min-width: 100%; } }
`;
    fs.writeFileSync(CSS, css);
  }
}
