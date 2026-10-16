/** Market's warehouse editor: atomic stock reception and finite action state. */
export function patchGoodsEditing(source) {
  if (source.includes('POS_MARKET_GOODS_EDIT_v1')) return source;
  const replaceSection = (start, end, edit) => {
    const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
    if(a<0||b<0)throw Error('Market goods editor section missing: '+start);
    source=source.slice(0,a)+edit(source.slice(a,b))+source.slice(b);
  };
  const runner = (name, callback, failure) => `function ${name}(${callback}) {
  const [busy, setBusy] = reactExports.useState(false);
  const lock = reactExports.useRef(false);
  const run = reactExports.useCallback(async (operation, message) => {
    if (lock.current) return ${failure};
    lock.current = true; setBusy(true);
    try {
      const res = await (typeof operation === "function" ? operation() : operation);
      if (!res?.success) { toast(res?.error?.message || psAdminText("Əməliyyat alınmadı", "İşlem başarısız", "Action failed"), "danger"); return ${failure}; }
      if (res.syncWarning) toast(psAdminText("Əməliyyat saxlanıldı, kassa ilə yenilənmə davam edir", "İşlem kaydedildi, kasa güncellenmeye devam ediyor", "Saved; register synchronization is still running"), "warning");
      else if (message) toast(message, "success");
      // The write has committed. A failed list refresh must not keep the
      // dialog open and encourage another stock reception with a new key.
      try { if (${callback}) await ${callback}(); }
      catch { toast(psAdminText("Saxlanıldı, siyahını yeniləyin", "Kaydedildi, listeyi yenileyin", "Saved; refresh the list"), "warning"); }
      return ${name.endsWith('Action') ? 'res.data ?? true' : 'true'};
    } catch (error) { toast(error?.message || psAdminText("Bağlantı xətası", "Bağlantı hatası", "Connection error"), "danger"); return ${failure}; }
    finally { lock.current = false; setBusy(false); }
  }, [${callback}]);
  return [busy, run];
}

`;
  source = source.replace('function psGoodForm(', runner('useMarketGoodsAction','reload','null') + runner('useMarketGoodsDialogRun','onDone','false') + 'function psGoodForm(');
  replaceSection('function psGoodForm(', 'const PS_GOODS_HEADERS', s => {
    s=s.replace('const [busy, run] = usePsDialogRun(onSaved);', 'const [busy, run] = useMarketGoodsDialogRun(onSaved);');
    s=s.replace('    copyOf: copy ? g?.name : ""','    stockDelta: "", stockWarehouseId: "",\n    copyOf: copy ? g?.name : ""');
    s=s.replace('function PsGoodDialog({ form, setForm, categories, objects, onSaved }) {','function PsGoodDialog({ form, setForm, categories, objects, warehouses = [], onSaved }) {\n  // POS_MARKET_GOODS_EDIT_v1\n  const submission = reactExports.useRef("");\n  const generatedBarcode = reactExports.useRef("");\n  const canAdjustStock = useAuthStore(state => Boolean(state.session?.permissions?.includes("inventory.adjust") || state.session?.permissions?.includes("*")));\n  const activeWarehouses = warehouses.filter(w => w.active !== 0 && w.active !== false);');
    s=s.replace('const barcode = String(form.barcode || "").trim() || psMakeBarcode(new Set());', 'const barcode = String(form.barcode || "").trim() || (generatedBarcode.current ||= psMakeBarcode(new Set()));');
    const from=s.indexOf('    void run(window.pos.inventory.saveIngredient({'),to=s.indexOf('\n  };',from);
    if(from<0||to<0)throw Error('Goods save handler missing');
    s=s.slice(0,from)+`    const stockText = String(form.stockDelta || "").trim();
    const stockDeltaMilli = stockText ? psQtyIn(stockText) : 0;
    if (!Number.isSafeInteger(stockDeltaMilli) || stockDeltaMilli < 0 || stockDeltaMilli > 1000000000000 || (stockText && !/^\\d+(?:[.,]\\d{0,3})?$/.test(stockText))) { toast(psAdminText("Miqdarı düzgün yazın", "Miktarı doğru yazın", "Enter a valid quantity"), "danger"); return; }
    const warehouseId = form.stockWarehouseId || activeWarehouses[0]?.id || "";
    if (stockDeltaMilli > 0 && !warehouseId) { toast(psAdminText("Anbar seçin", "Depo seçin", "Choose a warehouse"), "danger"); return; }
    const payload = {
      ...(form.id ? { id: form.id } : {}), name: form.name.trim(), unit: form.unit, barcode,
      costMinor: cost, salePriceMinor: sale, minQtyMilli: Number.isFinite(minQty) ? minQty : 0,
      categoryId: form.categoryId || "", weighted: Boolean(form.weighted), plu: Number(form.plu) || 0, prices,
      ...(stockDeltaMilli > 0 ? { stockDeltaMilli, warehouseId } : {})
    };
    if (!submission.current) submission.current = newIdempotencyKey();
    void run(() => window.pos.inventory.saveIngredient({ ...payload, idempotencyKey: submission.current }), form.id ? "Saxlanıldı" : "Yeni mal yaradıldı").then((ok) => { if (ok) setForm(null); });`+s.slice(to);
    s=s.replace('busy, children: h("div", { className: "space-y-3" }','busy, children: h("fieldset", { disabled: busy, className: "space-y-3", style: { border: 0, padding: 0, margin: 0, minWidth: 0 } }');
    s=s.replace('label: "Minimum qalıq",','label: psAdminText("Minimum qalıq (xəbərdarlıq)", "Minimum stok (uyarı)", "Low-stock alert threshold"),');
    const field='    objects.length ? h("div", { className: "ps-price-box" },';
    if(!s.includes(field))throw Error('Goods stock field insertion missing');
    s=s.replace(field,`    canAdjustStock ? h("div", { className: "ps-price-box ps-good-stock-receive", style: { padding: 16, borderRadius: 14, border: "1px solid #c9ddf4", background: "#f1f7ff" } },
      h("h3", { style: { fontSize: 17, fontWeight: 700 } }, psAdminText("Anbara qalıq əlavə et", "Depoya stok ekle", "Add warehouse stock")),
      h("p", { style: { fontSize: 14, margin: "8px 0 14px", color: "#536985" } }, psAdminText("Bu miqdar mövcud qalığa əlavə olunur. Minimum qalıq yalnız xəbərdarlıq üçündür, stok yaratmır.", "Bu miktar mevcut stoğa eklenir. Minimum stok yalnızca uyarı içindir.", "This quantity is added to existing stock. The alert threshold does not add stock.")),
      h("div", { className: "grid gap-2 sm:grid-cols-2" },
        jsxRuntimeExports.jsx(OpsField, { label: psAdminText("Əlavə ediləcək miqdar", "Eklenecek miktar", "Quantity to add"), value: form.stockDelta || "", onChange: v => set({ stockDelta: v }), placeholder: "0" }),
        psLabeled(psAdminText("Anbar", "Depo", "Warehouse"), h("select", { className: psField, value: form.stockWarehouseId || activeWarehouses[0]?.id || "", onChange: e => set({ stockWarehouseId: e.target.value }) }, activeWarehouses.map(w => h("option", { key: w.id, value: w.id }, w.name)))))
    ) : null,
`+field);
    s=s.replace('onClick: save, children: "Yadda saxla"','onClick: save, children: busy ? psAdminText("Saxlanılır…", "Kaydediliyor…", "Saving…") : "Yadda saxla"');
    return s;
  });
  replaceSection('function OpsGoods()', '// -------------------------------------------------------------- stocktake', s => {
    s=s.replace('const [busy, run] = useOpsAction(reload);', 'const [busy, run] = useMarketGoodsAction(reload);');
    s=s.replace('  const seq = reactExports.useRef(0);','  const seq = reactExports.useRef(0);\n  const deleteLock = reactExports.useRef(false);');
    const old=`            if (!(await confirmAsk('"' + g.name + '" silinsin? Keçmiş hərəkətlər qalır.', { danger: true }))) return;
            void run(window.pos.inventory.deactivateIngredient(g.id), "Silindi");`;
    if(!s.includes(old))throw Error('Goods delete handler missing');
    s=s.replace(old,`            if (deleteLock.current) return;
            deleteLock.current = true;
            try {
              if (!(await confirmAsk('"' + g.name + '" silinsin? Keçmiş hərəkətlər qalır.', { danger: true }))) return;
              await run(() => window.pos.inventory.deactivateIngredient(g.id), "Silindi");
            } finally { deleteLock.current = false; }`);
    s=s.replace('form, setForm, categories: cats.categories, objects, onSaved:', 'form, setForm, categories: cats.categories, objects, warehouses, onSaved:');
    return s;
  });
  return source;
}
