/** Bounded goods rendering for the Market copy of the shared warehouse UI. */
export function patchWarehousePerformance(source) {
  if (source.includes('POS_MARKET_GOODS_PERF_v1')) return source;
  const start = source.indexOf('function OpsGoods() {');
  const end = source.indexOf('// -------------------------------------------------------------- stocktake', start);
  if (start < 0 || end < start) throw new Error('Market goods component boundaries missing');
  let goods = source.slice(start, end);
  const tableStart = goods.indexOf('jsxRuntimeExports.jsx(OpsTable, {');
  const tableEnd = goods.indexOf(',\n    goods.length ?', tableStart);
  if (tableStart < 0 || tableEnd < tableStart) throw new Error('Market goods table missing');
  const table = goods.slice(tableStart, tableEnd).replace('rows: goods.map((g)', 'rows: pageGoods.map((g)');
  goods = goods.slice(0, tableStart) + 'goodsTable,\n    pager' + goods.slice(tableEnd);
  const setup = `  // POS_MARKET_GOODS_PERF_v1: input/dialog changes do not reconstruct every goods row.
  const goods = data?.goods ?? PS_MARKET_EMPTY_GOODS;
  const t = data?.totals ?? {};
  const [page, setPage] = reactExports.useState(1);
  const pages = Math.max(1, Math.ceil(goods.length / 50));
  const activePage = Math.min(page, pages);
  reactExports.useEffect(() => { setPage(1); }, [needle, categoryId, objectId, warehouseId]);
  const pageGoods = reactExports.useMemo(() => goods.slice((activePage - 1) * 50, activePage * 50), [goods, activePage]);
  const goodsTable = reactExports.useMemo(() => ${table}, [pageGoods, busy, confirmAsk, run, needle, categoryId]);
  const pager = goods.length > 50 ? h("nav", { className: "ps-market-goods-pager", "aria-label": psAdminText("Mal səhifələri", "Ürün sayfaları", "Goods pages"), style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 } },
    ...[
      [1, psAdminText("İlk səhifə", "İlk sayfa", "First page"), activePage === 1],
      [activePage - 1, psAdminText("Əvvəlki", "Önceki", "Previous"), activePage === 1],
      [activePage + 1, psAdminText("Növbəti", "Sonraki", "Next"), activePage === pages],
      [pages, psAdminText("Son səhifə", "Son sayfa", "Last page"), activePage === pages]
    ].map(([next, label, disabled]) => h("button", { key: label, type: "button", className: "ps-ops-button ps-ops-button--quiet", style: { minHeight: 52, minWidth: 52, padding: "10px 14px" }, disabled, onClick: () => setPage(Math.min(pages, Math.max(1, next))) }, label)),
    h("span", { style: { color: "#536985", fontSize: 14 } }, (activePage - 1) * 50 + 1, "–", Math.min(activePage * 50, goods.length), " / ", goods.length, " · ", activePage, " / ", pages)) : null;
  if (!data || !cats) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");`;
  const before = '  if (!data || !cats) return h("p", { className: "text-sm text-muted" }, "Yüklənir…");\n  const goods = data.goods ?? [];\n  const t = data.totals ?? {};';
  if (!goods.includes(before)) throw new Error('Market goods state setup missing');
  goods = goods.replace(before, setup);
  return source.slice(0, start) + 'const PS_MARKET_EMPTY_GOODS = [];\n' + goods + source.slice(end);
}
