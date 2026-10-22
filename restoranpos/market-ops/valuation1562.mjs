/** Market stock values are signed integer qəpik, rounded after combining stock. */
export function patchMarketValuation(source) {
  const helper = `function psMarketStockValue(q,p){const v=BigInt(Math.trunc(Number(q)||0))*BigInt(Math.trunc(Number(p)||0));return Number(v<0n?-((-v+500n)/1000n):(v+500n)/1000n);}
`;
  if (!source.includes('function psMarketStockValue(')) source = helper + source;
  const start = source.indexOf('function psStockTotals(levels) {');
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw Error('Stock totals function missing');
  source = source.slice(0, start) + `function psStockTotals(levels) {
    const byUnit=new Map(),groups=new Map();let buy=0,sell=0;
    for(const r of levels){const q=Number(r.qtyMilli)||0;byUnit.set(r.unit,(byUnit.get(r.unit)||0)+q);
      const key=JSON.stringify([r.ingredientId||r.goodId||r.id,r.costMinor||0,r.salePriceMinor||0]);
      const row=groups.get(key)||{q:0,c:r.costMinor||0,p:r.salePriceMinor||0};row.q+=q;groups.set(key,row);}
    for(const row of groups.values()){buy+=psMarketStockValue(row.q,row.c);sell+=psMarketStockValue(row.q,row.p);}
    return {buy,sell,profit:sell-buy,text:[...byUnit].map(([u,q])=>opsQty(q)+' '+u).join(' · ')||'0'};
  }` + source.slice(end + 2);
  source = source.replaceAll('const q = (r) => Math.max(0, Number(r.qtyMilli) || 0);','const q = (r) => Number(r.qtyMilli) || 0;')
    .replaceAll('Math.round(q(r) * (r.costMinor ?? 0) / 1000)', 'psMarketStockValue(q(r), r.costMinor)')
    .replaceAll('Math.round(q(r) * (r.salePriceMinor ?? 0) / 1000)', 'psMarketStockValue(q(r), r.salePriceMinor)')
    .replaceAll('Math.round(q(r) * ((r.salePriceMinor ?? 0) - (r.costMinor ?? 0)) / 1000)', '(psMarketStockValue(q(r),r.salePriceMinor)-psMarketStockValue(q(r),r.costMinor))')
    .replaceAll('Math.round((Number(row.qtyMilli) || 0) * (row.costMinor ?? 0) / 1000)', 'psMarketStockValue(row.qtyMilli,row.costMinor)')
    .replaceAll('Math.max(0, value)', 'value')
    .replaceAll('Math.max(0, Math.round((Number(row.qtyMilli) || 0) * (row.salePriceMinor ?? 0) / 1000))', 'psMarketStockValue(row.qtyMilli,row.salePriceMinor)')
    .replaceAll('Math.max(0, Math.round((Number(row.qtyMilli) || 0) * ((row.salePriceMinor ?? 0) - (row.costMinor ?? 0)) / 1000))', '(psMarketStockValue(row.qtyMilli,row.salePriceMinor)-psMarketStockValue(row.qtyMilli,row.costMinor))');
  source=source.replace('"Cəmi alış", "Cəmi satış", "Qazanc", "Status"','"Cəmi alış", "Cəmi satış", "Gözlənilən qazanc", "Status"')
    .replace('"Cəmi alış (₼)", "Cəmi satış (₼)", "Qazanc (₼)"','"Cəmi alış (₼)", "Cəmi satış (₼)", "Gözlənilən qazanc (₼)"');
  const labels = [
    ['Cəmi alış', 'Qalıq alış dəyəri', 'Закупочная стоимость остатка', 'Stock cost value'],
    ['Cəmi satış', 'Qalıq satış dəyəri', 'Продажная стоимость остатка', 'Stock sale value'],
    ['Gözlənilən qazanc', 'Qalıq üzrə marja', 'Маржа остатка', 'Stock margin'],
    ['Satışdan qazanc', 'Satış marjası (cari maya)', 'Маржа продаж (текущая себестоимость)', 'Sales margin (current cost)'],
    ['Satılıb', 'Satış məbləği', 'Сумма продаж', 'Sales revenue'],
    ['satılan − maya dəyəri', 'qaytarmalar çıxılıb · cari maya ilə', 'без возвратов · текущая себестоимость', 'net of returns · current cost'],
  ];
  for (const [old, az, ru, en] of labels) {
    for (const suffix of ['', ' (₼)']) source = source.replaceAll(JSON.stringify(old+suffix), `psMarketWords(${JSON.stringify(az+suffix)},${JSON.stringify(ru+suffix)},${JSON.stringify(en+suffix)})`);
  }
  // Keep amounts numeric in Excel, with two decimal places and currency.
  const oldStyle = `const style = ri === 0 ? ' s="1"' : "";`;
  if (!source.includes(oldStyle)) throw Error('Excel number style anchor missing');
  source = source.replace(oldStyle, `const style = ri === 0 ? ' s="1"' : String(rows[0]?.[ci]||'').includes('₼') ? ' s="2"' : "";`);
  source = source.replace('<fonts count="2">', '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;₼&quot;"/></numFmts><fonts count="2">');
  source = source.replace('<cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs>', '<cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs>');
  return source;
}
