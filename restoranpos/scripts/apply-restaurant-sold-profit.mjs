#!/usr/bin/env node
/**
 * Mallar / Anbar: profit that grows with sales (Market 1.5.61).
 *
 * "Qazanc" here was the stock's possible profit (qalıq × (satış − alış)), so it
 * shrank every time a good was sold - the opposite of what a shop owner reads
 * into the word. goods.list now also returns what was actually sold (net of
 * returns, after the receipt discount); this patch shows it next to the stock
 * figures and names the old one for what it is.
 *
 * Idempotent and fail-closed: an anchor that is missing (and not already
 * patched) stops the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(ROOT, 'index-DAmHwBc4.js');
let s = fs.readFileSync(BUNDLE, 'utf8');
const before = s;

function swap(from, to, label) {
  if (s.includes(to)) return;
  if (!s.includes(from)) throw new Error(`sold-profit: anchor missing (${label})`);
  s = s.replace(from, () => to);
}

swap(
  '      psMetric("Qazanc", formatMoney(t.profitMinor ?? 0), "satış − alış", (t.profitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)")),',
  '      psMetric("Gözlənilən qazanc", formatMoney(t.profitMinor ?? 0), "qalıq üzrə: satış − alış", (t.profitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)"),\n' +
  '      psMetric("Satılıb", formatMoney(t.soldMinor ?? 0), "satış məbləği (qaytarmalar çıxılıb)"),\n' +
  '      psMetric("Satışdan qazanc", formatMoney(t.soldProfitMinor ?? 0), "satılan − maya dəyəri", (t.soldProfitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)")),',
  'metrics',
);
swap(
  'head: ["Barkod", "Mal", "Alış", "Satış", "Qalıq", "Cəmi alış", "Cəmi satış", "Qazanc", ""],',
  'head: ["Barkod", "Mal", "Alış", "Satış", "Qalıq", "Cəmi alış", "Cəmi satış", "Gözlənilən qazanc", "Satışdan qazanc", ""],',
  'table head',
);
swap(
  '        h("b", { style: { color: (g.profitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(g.profitMinor ?? 0)),\n        h("span", { className: "flex flex-wrap gap-1" },',
  '        h("b", { style: { color: (g.profitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(g.profitMinor ?? 0)),\n' +
  '        h("span", null, h("b", { style: { color: (g.soldProfitMinor ?? 0) < 0 ? "var(--ps-danger)" : "var(--ps-ok)" } }, formatMoney(g.soldProfitMinor ?? 0)), (Number(g.soldQtyMilli) || 0) > 0 ? h("span", { className: "block text-[11px] text-faint" }, opsQty(g.soldQtyMilli) + " " + g.unit + " satılıb") : null),\n' +
  '        h("span", { className: "flex flex-wrap gap-1" },',
  'table row',
);
swap(
  '"Cəmi: " + goods.length + " mal · alış " + formatMoney(t.costMinor ?? 0) + " · satış " + formatMoney(t.saleMinor ?? 0) + " · qazanc " + formatMoney(t.profitMinor ?? 0)',
  '"Cəmi: " + goods.length + " mal · alış " + formatMoney(t.costMinor ?? 0) + " · satış " + formatMoney(t.saleMinor ?? 0) + " · gözlənilən qazanc " + formatMoney(t.profitMinor ?? 0) + " · satışdan qazanc " + formatMoney(t.soldProfitMinor ?? 0)',
  'footer',
);
swap(
  '["Barkod", "Ad", "Kateqoriya", "Vahid", "PLU", "Alış (₼)", "Satış (₼)", "Qalıq", "Cəmi alış (₼)", "Cəmi satış (₼)", "Qazanc (₼)"],',
  '["Barkod", "Ad", "Kateqoriya", "Vahid", "PLU", "Alış (₼)", "Satış (₼)", "Qalıq", "Cəmi alış (₼)", "Cəmi satış (₼)", "Gözlənilən qazanc (₼)", "Satılıb (₼)", "Satışdan qazanc (₼)"],',
  'excel head',
);
swap(
  'psAzn(g.costValueMinor), psAzn(g.saleValueMinor), psAzn(g.profitMinor)]),',
  'psAzn(g.costValueMinor), psAzn(g.saleValueMinor), psAzn(g.profitMinor), psAzn(g.soldMinor ?? 0), psAzn(g.soldProfitMinor ?? 0)]),',
  'excel row',
);
swap(
  '["", "CƏMİ", "", "", "", "", "", "", psAzn(t.costMinor), psAzn(t.saleMinor), psAzn(t.profitMinor)]',
  '["", "CƏMİ", "", "", "", "", "", "", psAzn(t.costMinor), psAzn(t.saleMinor), psAzn(t.profitMinor), psAzn(t.soldMinor ?? 0), psAzn(t.soldProfitMinor ?? 0)]',
  'excel total',
);

if (s !== before) fs.writeFileSync(BUNDLE, s);
console.log(s === before ? 'sold-profit: already applied' : 'sold-profit: applied');
