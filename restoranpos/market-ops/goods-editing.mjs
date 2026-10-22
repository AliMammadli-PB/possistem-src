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
    s=s.replace(field,`    // 1.5.47: a new product starts at zero; stock arrives by Alış (purchase) or Sayım.
    canAdjustStock && form.id ? h("div", { className: "ps-price-box ps-good-stock-receive", style: { padding: 16, borderRadius: 14, border: "1px solid #c9ddf4", background: "#f1f7ff" } },
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
  // 1.5.50: the till reads every 20-29 prefix; say so where the scale file is exported (TM-30F, CAS, DIGI, Aclas).
  const prefixLabel = 'label: "Çəki barkodunun prefiksi"';
  if (!source.includes(prefixLabel)) throw Error('Scale export prefix field missing');
  source = source.replace(prefixLabel, 'label: "Çəki barkodunun prefiksi (20–29, tərəzinin barkod ayarındakı ilə eyni)"');
  // 1.5.51: Dahua TM-30F on the shop LAN — find it, print a test label, send the goods; market main does the TCP.
  const scaleEdits = [
    ['csv: { label: "Ümumi CSV", ext: "csv" }', 'csv: { label: "Ümumi CSV", ext: "csv" },\n  dahua: { label: "Dahua TM-30F (LAN kabel)", ext: "txt" }'],
    ['setScale({ kind: "cas", prefix: "20" })', 'setScale({ kind: "dahua", prefix: "20" })'],
    ['jsxRuntimeExports.jsx(OpsButton, { onClick: saveScale, children: "Faylı saxla" }),',
      'scale.kind === "dahua" ? null : jsxRuntimeExports.jsx(OpsButton, { onClick: saveScale, children: "Faylı saxla" }),'],
    ['      h("div", { className: "flex gap-2" },\n        scale.kind === "dahua" ? null',
      '      scale.kind === "dahua" ? jsxRuntimeExports.jsx(PsScaleLan, { prefix: scale.prefix }) : null,\n      h("div", { className: "flex gap-2" },\n        scale.kind === "dahua" ? null'],
    ['function psScaleFile(', PS_SCALE_LAN + 'function psScaleFile('],
  ];
  // 1.5.54: ticking "Çəkili" (or picking kq) gives the good the next PLU and a scale barcode.
  scaleEdits.push(
    ['onChange: (e) => set({ weighted: e.target.checked }) }), "Çəkili (tərəzi)")',
      'onChange: (e) => psScaleTick(form, setForm, { weighted: e.target.checked }) }), "Çəkili (tərəzi)")'],
    ['onChange: (e) => set({ unit: e.target.value, weighted: e.target.value === "kg" ? true : form.weighted }) }',
      'onChange: (e) => psScaleTick(form, setForm, { unit: e.target.value, weighted: e.target.value === "kg" ? true : form.weighted }) }'],
    ['onChange: (v) => set({ plu: v.replace(/\\D/g, "").slice(0, 5) })',
      'onChange: (v) => { const plu = v.replace(/\\D/g, "").slice(0, 5); set({ plu, barcode: plu && /^2\\d{6}(\\d{2})?$/.test(form.barcode) ? form.barcode.slice(0, 2) + plu.padStart(7, "0") : form.barcode }); }'],
    ['function PsGoodDialog(', PS_SCALE_TICK + 'function PsGoodDialog(']);
  for (const [from, to] of scaleEdits) {
    if (source.split(from).length !== 2) throw Error('Scale LAN anchor missing: ' + from.slice(0, 50));
    source = source.replace(from, () => to);
  }
  return source;
}

const PS_SCALE_LAN = `/** 1.5.51: a label scale on the LAN (Dahua TM-A / TM-F), reached through MarketPos main. */
function PsScaleLan({ prefix }) {
  const api = window.parent && window.parent.marketSystem ? window.parent.marketSystem.scale : null;
  const token = () => (window.parent && window.parent.__marketOpsToken) || "";
  const [cfg, setCfg] = reactExports.useState({ ip: "", auto: true, last: "" });
  const [found, setFound] = reactExports.useState(null);
  const [busy, setBusy] = reactExports.useState("");
  const [log, setLog] = reactExports.useState("");
  reactExports.useEffect(() => { if (api) void api.get(token()).then(setCfg).catch(() => undefined); }, []);
  if (!api) return psH("p", { className: "text-sm text-muted" }, "Şəbəkə tərəzisi yalnız MarketPos proqramında işləyir.");
  const pfx = String(prefix || "20").replace(/\\D/g, "").slice(0, 2);
  const err = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
  const save = (next) => api.set(token(), { ip: next.ip, prefix: pfx, auto: next.auto });
  const act = async (key, fn) => {
    setBusy(key);
    try { const text = await fn(); toast(text, "success"); setCfg((c) => ({ ...c, last: text })); }
    catch (e) { toast(err(e), "danger"); setCfg((c) => ({ ...c, last: err(e) })); }
    finally { setBusy(""); }
  };
  const scan = () => act("scan", async () => {
    const r = await api.scan(token());
    setFound(r.found);
    if (r.found.length === 1) setCfg((c) => ({ ...c, ip: r.found[0] }));
    return r.found.length ? r.found.length + " cihaz tapıldı (port 4001). Hansının tərəzi olduğunu \\"Test etiketi\\" ilə yoxlayın."
      : "Bu şəbəkədə (" + (r.networks.join(", ") || "—") + ") port 4001 açıq cihaz tapılmadı. Tərəzinin IP-sini əl ilə yazın.";
  });
  const test = () => act("test", async () => { await save(cfg); const r = await api.test(token()); if (!r.accepted) throw Error("Tərəzi test malını rədd etdi (cavab «" + r.reply + "»). «Tam diaqnostika» basın."); return "Test malı PLU " + r.plu + " tərəzidə yazıldı. Qiymət 8.00 AZN/kq olmalıdır; 310 qram üçün məbləğ 2.48 AZN. 800 / 248 çap olunursa, aşağıdakı pul formatı təlimatına baxın."; });
  const send = () => act("send", async () => { await save(cfg); const r = await api.send(token()); return r.sent + " mal tərəzidə yazıldı" + (r.refused.length ? "; tərəzi " + r.refused.length + " malı rədd etdi: " + r.refused.slice(0, 5).join(", ") : "") + (r.skipped.length ? ". Göndərilməyən mallar: " + r.skipped.slice(0, 5).join(", ") : ""); });
  const diag = () => act("diag", async () => { await save(cfg); const r = await api.diagnose(token()); setLog(r.log); return "Diaqnostika bitdi. Tərəzidə bu PLU-ları yoxlayın: " + r.plus.map((x) => x.split(" ")[3]).join(", "); });
  const copy = () => {
    const ta = document.getElementById("ps-scale-log");
    let ok = false;
    try { ta.select(); ok = document.execCommand("copy"); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) void navigator.clipboard.writeText(log);
    toast("Log kopyalandı", "success");
  };
  const toggle = (auto) => { const next = { ...cfg, auto }; setCfg(next); void save(next).catch((e) => toast(err(e), "danger")); };
  return psH("div", { className: "space-y-2", style: { borderTop: "1px solid #dde5ee", paddingTop: 12 } },
    psH("p", { className: "text-sm text-muted" }, "Tərəzi switch-ə LAN kabeli ilə qoşulubsa, çəkili mallar ona birbaşa gedir. Mal dəyişəndə (ad, qiymət, PLU) tərəziyə avtomatik göndərilir."),
    jsxRuntimeExports.jsx(OpsField, { label: "Tərəzinin IP ünvanı", value: cfg.ip, onChange: (v) => setCfg({ ...cfg, ip: String(v).trim() }), placeholder: "192.168.1.50" }),
    found && found.length ? psH("div", { className: "flex flex-wrap gap-2" }, found.map((ip) => psH("button", { key: ip, type: "button", "aria-pressed": cfg.ip === ip, className: "ps-period-chip" + (cfg.ip === ip ? " is-on" : ""), onClick: () => setCfg({ ...cfg, ip }) }, ip))) : null,
    psH("details", { className: "ps-scale-money-guide", style: { background: "#edf4ff", border: "1px solid #b6cff3", borderRadius: 12, padding: 14, color: "#17355a" } },
      psH("summary", { style: { cursor: "pointer", fontSize: 16, fontWeight: 700, minHeight: 48, display: "flex", alignItems: "center" } }, psMarketWords("Etiketdə 800 / 248 görünür? Pul formatı", "На этикетке 800 / 248? Формат цены", "Label shows 800 / 248? Money format")),
      psH("p", { style: { margin: "10px 0", lineHeight: 1.6 } }, psMarketWords("Qiymət tərəziyə qəpiklə göndərilir: 800 = 8.00 AZN. Göndərilən qiyməti 100-ə bölmək olmaz. Etiketin pul vahidi və onluq formatı tərəzinin öz ayarıdır.", "Цена передаётся в копейках: 800 = 8.00 AZN. Делить цену на 100 при отправке нельзя. Формат печати задаётся на весах.", "Prices are transmitted in minor units: 800 = 8.00 AZN. Do not divide the transmitted price by 100. Label currency and decimals are scale settings.")),
      psH("ol", { style: { paddingLeft: 22, lineHeight: 1.8 } },
        psH("li", null, psMarketWords("Dahua TM-F: Funksiya → 39706 → Təsdiq → Dara ilə P30 parametrinə keçin → 02 → Təsdiq. Bu, göndərilən qiymətin qəpiklə olduğunu seçir. Ekranı dəyişdirməzdən əvvəl parametr adının pul vahidi olduğunu yoxlayın; firmware-lərdə menyu fərqlənə bilər.", "Dahua TM-F: Функция → 39706 → Подтвердить → Тара до P30 → 02 → Подтвердить. Проверьте название параметра: тип цены; меню зависит от прошивки.", "Dahua TM-F: Function → 39706 → Confirm → Tare to P30 → 02 → Confirm. Verify that the parameter is the unit-price denomination; firmware menus may differ.")),
        psH("li", null, psMarketWords("Qiymət və məbləğ etiketdə yenə nöqtəsizdirsə, Dahua proqramında etiket şablonunun qiymət/məbləğ sahələrini iki onluq rəqəmlə qurun. Valyuta mətnini AZN edin; ₼ işarəsi yalnız tərəzinin şrifti dəstəkləyirsə çap olunur.", "Если точки всё ещё нет, настройте два десятичных знака у полей цены/суммы в шаблоне Dahua. Валюта — AZN; ₼ зависит от шрифта весов.", "If decimals are still missing, set price/amount fields to two decimals in the Dahua label template. Use AZN as currency text; ₼ requires scale font support.")),
        psH("li", null, psMarketWords("Test etiketi: 8.00 AZN/kq × 0.310 kq = 2.48 AZN. Göndərilmə cavabı etiketin düzgün çap olunduğunu təsdiqləmir; çıxan etiketi yoxlayın.", "Тест: 8.00 AZN/кг × 0.310 кг = 2.48 AZN. Ответ весов не подтверждает правильный вид печати — проверьте этикетку.", "Test: 8.00 AZN/kg × 0.310 kg = 2.48 AZN. A transfer acknowledgement does not verify the printed format; inspect the label."))),
      psH("p", { style: { margin: "10px 0", lineHeight: 1.6, userSelect: "text" } }, psMarketWords("Təlimat və etiket proqramı: www.dahuazm.com", "Инструкции и программа этикеток: www.dahuazm.com", "Manuals and label software: www.dahuazm.com"))),
    psH("label", { className: "flex items-center gap-2 text-sm" }, psH("input", { type: "checkbox", checked: cfg.auto, onChange: (e) => toggle(e.target.checked) }), "Mal dəyişəndə tərəziyə avtomatik göndər"),
    psH("div", { className: "flex flex-wrap gap-2" },
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: !!busy, onClick: scan, children: busy === "scan" ? "Axtarılır…" : "Şəbəkədə axtar" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: !!busy || !cfg.ip, onClick: test, children: busy === "test" ? "Göndərilir…" : "Test etiketi" }),
      jsxRuntimeExports.jsx(OpsButton, { disabled: !!busy || !cfg.ip, onClick: send, children: busy === "send" ? "Göndərilir…" : "Hamısını tərəziyə göndər" }),
      jsxRuntimeExports.jsx(OpsButton, { tone: "quiet", disabled: !!busy || !cfg.ip, onClick: diag, children: busy === "diag" ? "Yoxlanılır… (~40 san)" : "Tam diaqnostika" })),
    cfg.last ? psH("p", { className: "text-xs text-muted", role: "status" }, cfg.last) : null,
    log ? psH("div", { className: "space-y-2" },
      psH("textarea", { id: "ps-scale-log", readOnly: true, value: log, rows: 14, style: { width: "100%", fontFamily: "monospace", fontSize: 11, whiteSpace: "pre", border: "1px solid #c4d5e6", borderRadius: 10, padding: 8 } }),
      jsxRuntimeExports.jsx(OpsButton, { onClick: copy, children: "Logu kopyala" })) : null,
    psH("p", { className: "text-xs text-faint" }, "Tərəzinin öz IP-si: Funksiya → 9002 → Təsdiq (nöqtə = Dara düyməsi). Etiket barkodu: malın barkodu (prefiks + 7 rəqəm kod) + 5 rəqəm çəki + yoxlama rəqəmi."));
}
`;

const PS_SCALE_TICK = `/**
 * 1.5.54: a good turning weighed gets the PLU after the highest one in use and the barcode its
 * scale label starts with - 1.5.58: prefix + 7-digit code, as the TM-30F prints it - unless it
 * already carries a real barcode.
 */
function psScaleTick(form, setForm, patch) {
  const next = { ...form, ...patch };
  setForm(next);
  if (!next.weighted || form.weighted) return;
  void (async () => {
    let prefix = "20", plu = Number(next.plu) || 0;
    try {
      const s = await window.parent.marketSystem.scale.get(window.parent.__marketOpsToken || "");
      if (/^2\\d$/.test(String(s && s.prefix))) prefix = String(s.prefix);
    } catch (e) { /* outside MarketPos: prefix 20 */ }
    if (!plu) {
      const r = await psErp("goods.list", {});
      if (!r.success) { toast(r.error.message, "danger"); return; }
      plu = (r.data.goods || []).reduce((m, g) => g.id === next.id ? m : Math.max(m, Number(g.plu) || 0), 0) + 1;
    }
    setForm((f) => {
      if (!f || !f.weighted || f.id !== next.id) return f;
      const p = f.plu || String(plu);
      const own = !f.barcode || /^2\\d{6}(\\d{2})?$/.test(f.barcode) || (!f.id && /^2\\d{12}$/.test(f.barcode));
      return { ...f, plu: p, barcode: own ? prefix + p.padStart(7, "0") : f.barcode };
    });
  })();
}
`;
