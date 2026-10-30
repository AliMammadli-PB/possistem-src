/* Printer purposes share a physical device; kitchen capabilities remain available to dish routing. */
function psPrinterRoles(row){if(Array.isArray(row?.roles))return row.roles.filter(r=>["receipt","kitchen","warehouse"].includes(r));const kind=row?.kind;return kind==="receipt"||kind==="warehouse"?[kind]:kind==="kitchen"&&row.main?["kitchen"]:[];}
function psPrinterKind(row){return row?.kind==="kitchen"||psPrinterRoles(row).includes("kitchen")?"kitchen":psPrinterRoles(row).includes("receipt")?"receipt":psPrinterRoles(row).includes("warehouse")?"warehouse":row?.kind||"kitchen";}
function psIsMainKitchen(row){return psPrinterRoles(row).includes("kitchen");}
function psExtraKitchenPrinters(list){return (Array.isArray(list)?list:[]).filter(row=>psPrinterKind(row)==="kitchen"&&!psIsMainKitchen(row));}
function psReconcilePrinterRoles(raw,current,names={receipt:"Kassa",kitchen:"Mətbəx",warehouse:"Anbar"}) {
  const saved=raw.map(row=>({...row,roles:psPrinterRoles(row)}));
  for(const role of ["receipt","kitchen","warehouse"]){
    const target=current[role];let row=saved.find(s=>s.roles.includes(role)&&s.printer===target)||saved.find(s=>s.printer===target);
    for(const item of saved)item.roles=item.roles.filter(r=>r!==role);
    if(!target||target==="auto"||/^virtual\b/i.test(target))continue;
    if(!row){let id="st-"+role;while(saved.some(s=>s.id===id))id+="-role";row={id,name:names[role],printer:target,kind:role,roles:[],itemIds:[],categoryIds:[]};saved.push(row);}
    row.roles.push(role);if(role==="kitchen")row.kind="kitchen";
  }
  for(const row of saved)row.main=row.roles.includes("kitchen");
  return saved;
}
function PsKitchenStations() {
  const L = psAdminText;
  /* POS_FOCUS_FIX_v1 */
  const [confirmAsk, confirmDialog] = useConfirm();
  const h = (tag, props, ...children) => {
    const { key, ...rest } = props || {};
    const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
    return kids.length > 1
      ? jsxRuntimeExports.jsxs(tag, { ...rest, children: kids }, key)
      : jsxRuntimeExports.jsx(tag, { ...rest, children: kids[0] }, key);
  };
  const KINDS = [
    ["kitchen", L("Mətbəx", "Mutfak", "Kitchen")],
    ["receipt", L("Kassa", "Kasa", "Till")],
    ["warehouse", L("Anbar", "Depo", "Warehouse")],
  ];

  const [stations, setStations] = reactExports.useState([]);
  const [loaded,setLoaded]=reactExports.useState(false);
  // The printer being set up: { id, name, printer, kind, main, itemIds, categoryIds, step: "name" | "search" | "kind" }.
  const [draft, setDraft] = reactExports.useState(null);
  const [list, setList] = reactExports.useState([]);
  const [at, setAt] = reactExports.useState(-1);
  const [printed, setPrinted] = reactExports.useState(false);
  const [manual, setManual] = reactExports.useState(false);
  const [address, setAddress] = reactExports.useState("");
  const [note, setNote] = reactExports.useState("");
  const [busy, setBusy] = reactExports.useState(false);
  const [found, setFound] = reactExports.useState(null);

  reactExports.useEffect(() => {
    let off=false;
    void(async()=>{try{
      const all=await window.pos.settings.getAll();if(!all.success)throw Error(all.error?.message||"Printerlər alınmadı");
      const raw=JSON.parse(all.data.settings["kitchen.stations"]||"[]");if(!Array.isArray(raw))throw Error("Printer siyahısı oxunmadı");
      const current=await window.pos.print.printers();if(!current.success)throw Error(current.error?.message||"Printer təyinatları alınmadı");
      const saved=psReconcilePrinterRoles(raw,current.data,{receipt:L("Kassa","Kasa","Till"),kitchen:L("Mətbəx","Mutfak","Kitchen"),warehouse:L("Anbar","Depo","Warehouse")});
      if(off)return;setStations(saved);setLoaded(true);if(all.data.settings["printer.routingNotice"])setNote(all.data.settings["printer.routingNotice"]);if(!saved.length)startNew();
    }catch(error){if(!off)setNote(error.message||String(error));}})();
    return()=>{off=true;};
  }, []);

  const resetSearch = () => { setList([]); setAt(-1); setPrinted(false); setManual(false); setAddress(""); setNote(""); setFound(null); };
  const startNew = () => { resetSearch(); setDraft({ id: "st-" + Date.now().toString(36), name: "", printer: "", kind: "", roles: [], kitchenEnabled:false, main: false, itemIds: [], categoryIds: [], step: "name" }); };
  const label = () => (draft?.name || "").trim();

  const persist = async (next) => {
    const res = await window.pos.settings.set("kitchen.stations", JSON.stringify(next));
    if (!res.success) { setNote(res.error.message);toast(res.error.message, "danger"); return false; }
    setStations(next);
    return true;
  };
  /** One test page to exactly this device; true when it left the till. */
  const testPage = async (target) => {
    let res;
    try {
      res = await window.pos.print.enqueue({ kind: "test_page", printer: target, exactTarget: true },
        { idempotencyKey: crypto.randomUUID(), timeoutMs: 6e4 });
    } catch (error) { setNote(error.message || String(error)); return false; }
    if (!res.success) { setNote(res.error.message); return false; }
    if (res.data.status !== "completed") { setNote(L("Yoxlama vərəqi göndərilmədi: ", "Test sayfası gönderilemedi: ", "Test page not sent: ") + (res.data.lastError || "")); return false; }
    return true;
  };
  const probe = async (candidates, index) => {
    if (index >= candidates.length) {
      setAt(candidates.length);
      setNote(L("Bütün cihazlar yoxlanıldı. Printer şəbəkədədirsə, ünvanı əl ilə yazın.", "Tüm cihazlar denendi. Yazıcı ağdaysa adresini elle yazın.", "Every device was tried. If the printer is on the network, type its address."));
      return;
    }
    setAt(index); setNote(""); setPrinted(false); setBusy(true);
    const ok = await testPage(candidates[index].name);
    setBusy(false); setPrinted(ok);
  };
  /** only: "usb" or "network" when the first search found nothing and the cable was just plugged in. */
  const search = async (only) => {
    if (!label()) { toast(L("Əvvəlcə printerin adını yazın", "Önce yazıcının adını yazın", "Type the printer's name first"), "danger"); return; }
    resetSearch(); setDraft((d) => ({ ...d, name: d.name.trim(), step: "search" })); setBusy(true);
    let res;
    try { res = await window.pos.print.detect({ probe: false }); }
    catch (error) { setBusy(false); setNote(error.message || String(error)); setFound([]); return; }
    setBusy(false);
    if (!res.success) { setNote(res.error?.message || ""); setFound([]); return; }
    const all = (res.data?.candidates ?? []).filter((p) => p.connection !== "virtual");
    const candidates = only ? all.filter((p) => (only === "network" ? p.connection === "network" : p.connection !== "network")) : all;
    setList(candidates); setFound(candidates);
    if (candidates.length === 0) {
      setAt(0);
      setNote(only === "usb" ? L("USB-də printer tapılmadı.", "USB'de yazıcı bulunamadı.", "No USB printer found.")
        : only === "network" ? L("Şəbəkədə (LAN) printer tapılmadı.", "Ağda (LAN) yazıcı bulunamadı.", "No network printer found.")
        : L("Printer tapılmadı. Kabeli taxın və USB və ya LAN ilə yenidən axtarın, ya da ünvanı əl ilə yazın.", "Yazıcı bulunamadı. Kabloyu takıp USB veya LAN ile yeniden arayın ya da adresi elle yazın.", "No printer found. Plug the cable in and search USB or LAN again, or type the address."));
      return;
    }
    await probe(candidates, 0);
  };
  const keep = (target) => { setDraft((d) => ({ ...d, printer: target, step: "kind" })); setNote(""); };
  const save = async () => {
    if(!label()||!draft.printer){toast(L("Printerin adını və ünvanını seçin","Yazıcının adını ve adresini seçin","Choose a printer name and address"),"danger");return;}
    const roles=psPrinterRoles(draft).filter(r=>r!=="kitchen");if(draft.kitchenEnabled&&draft.main)roles.push("kitchen");
    if(!roles.length&&!draft.kitchenEnabled){toast(L("Ən azı bir çap işi seçin","En az bir görev seçin","Select at least one print purpose"),"danger");return;}
    setBusy(true);setNote("");
    try{
      const all=await window.pos.settings.getAll();if(!all.success)throw Error(all.error?.message||"Printerlər alınmadı");
      const latest=JSON.parse(all.data.settings["kitchen.stations"]||"[]");if(!Array.isArray(latest))throw Error("Printer siyahısı düzgün deyil");
      const current=await window.pos.print.printers();if(!current.success)throw Error(current.error?.message||"Printer təyinatları alınmadı");
      const base=psReconcilePrinterRoles(Object.prototype.hasOwnProperty.call(all.data.settings,"kitchen.stations")?latest:stations,current.data),existing=base.find(s=>s.id===draft.id);
      const others=base.filter(s=>s.id!==draft.id).map(s=>{const nextRoles=psPrinterRoles(s).filter(r=>!roles.includes(r));return {...s,roles:nextRoles,main:nextRoles.includes("kitchen")};});
      const row={id:draft.id,name:label(),printer:draft.printer,kind:draft.kitchenEnabled?"kitchen":roles.includes("receipt")?"receipt":"warehouse",main:roles.includes("kitchen"),roles,itemIds:draft.kitchenEnabled?(existing?.itemIds||draft.itemIds||[]):[],categoryIds:draft.kitchenEnabled?(existing?.categoryIds||draft.categoryIds||[]):[]};
      if(!(await persist([...others,row])))return;
      toast(row.name+L(" printeri və çap işləri yadda saxlanıldı"," yazıcısı ve görevleri kaydedildi"," printer and print purposes saved"),"success");setDraft(null);resetSearch();
    }catch(error){setNote(error.message||String(error));}finally{setBusy(false);}
  };
  const remove = async row => {
    if(!(await confirmAsk(L(`"${row.name}" printeri silinsin?`,`"${row.name}" yazıcısı silinsin mi?`,`Remove "${row.name}"?`))))return;
    setBusy(true);try{const all=await window.pos.settings.getAll();if(!all.success)throw Error(all.error?.message||"Printerlər alınmadı");const latest=JSON.parse(all.data.settings["kitchen.stations"]||"[]");const current=await window.pos.print.printers();if(!current.success)throw Error(current.error?.message||"Printer təyinatları alınmadı");await persist(psReconcilePrinterRoles(Object.prototype.hasOwnProperty.call(all.data.settings,"kitchen.stations")?latest:stations,current.data).filter(s=>s.id!==row.id));}catch(error){setNote(error.message||String(error));}finally{setBusy(false);}
  };
  const edit = row => {resetSearch();setDraft({...row,roles:psPrinterRoles(row),kitchenEnabled:psPrinterKind(row)==="kitchen",main:psIsMainKitchen(row),step:"kind"});};
  const kindLabel = row => {
    const labels=[];const roles=psPrinterRoles(row);if(roles.includes("receipt"))labels.push(L("Kassa","Kasa","Till"));if(roles.includes("warehouse"))labels.push(L("Anbar","Depo","Warehouse"));
    if(psPrinterKind(row)==="kitchen")labels.push(psIsMainKitchen(row)?L("Mətbəx — bütün yeməklər","Mutfak — tüm yemekler","Kitchen — all dishes"):L("Mətbəx — seçilmiş yeməklər","Mutfak — seçili yemekler","Kitchen — selected dishes"));return labels.join(" · ")||L("Rol seçilməyib","Görev seçilmedi","No print purpose assigned");
  };
  const togglePurpose = id => setDraft(d=>{
    if(id==="kitchen"){const enabled=!d.kitchenEnabled;return {...d,kitchenEnabled:enabled,main:enabled?(d.main||!stations.some(s=>s.id!==d.id&&psIsMainKitchen(s))):false};}
    const roles=psPrinterRoles(d);return {...d,roles:roles.includes(id)?roles.filter(r=>r!==id):[...roles,id]};
  });

  const primary = "touch-target rounded-xl bg-gold/25 px-4 py-2.5 text-sm font-medium text-gold hover:bg-gold/35 disabled:opacity-50";
  const quiet = "touch-target rounded-xl border border-hairline px-4 py-2 text-sm text-muted hover:text-cream disabled:opacity-40";
  const yes = "touch-target rounded-xl border border-success/60 bg-success/15 px-4 py-2 text-sm text-success disabled:opacity-40";
  const field = "mt-1 w-full rounded-xl border border-hairline bg-elevated px-3 py-2 text-sm text-cream";

  const saved = stations.map((row) => h("div", { key: row.id, className: "ps-printer-role" },
    h("div", { className: "flex flex-wrap items-center gap-3" },
      h("div", { className: "min-w-0 flex-1" },
        h("p", { className: "ps-printer-role-title" }, row.name, L(" printeri", " yazıcısı", " printer")),
        h("p", { className: "ps-printer-role-status is-ready" }, row.printer),
        h("p", { className: "mt-1 text-xs text-muted" }, kindLabel(row))),
      h("button", { type: "button", disabled: busy, className: "ps-printer-find-button", onClick: () => edit(row) }, L("Dəyişdir", "Değiştir", "Change")),
      h("button", { type: "button", disabled: busy, className: quiet, onClick: () => void remove(row) }, L("Sil", "Sil", "Remove")))));

  let wizard = null;
  if (draft) {
    const name = label();
    const stepName = h("div", { className: "flex flex-wrap items-end gap-3" },
      h("label", { className: "min-w-0 flex-1 text-sm" },
        h("span", { className: "text-xs uppercase tracking-wide text-faint" }, L("Printerin adı", "Yazıcının adı", "Printer name")),
        h("input", { type: "text", value: draft.name, placeholder: L("məs. Kassa, Mətbəx, Kababçı, Bar", "ör. Kasa, Mutfak, Kebapçı, Bar", "e.g. Till, Kitchen, Grill, Bar"),
          onChange: (e) => setDraft((d) => ({ ...d, name: e.target.value })),
          onKeyDown: (e) => { if (e.key === "Enter") void search(); }, className: field })),
      h("button", { type: "button", disabled: busy || !name, className: "ps-printer-find-button", onClick: () => void search() },
        busy && draft.step === "search" ? L("Axtarılır…", "Aranıyor…", "Searching…") : L("Axtar", "Ara", "Search")));

    const reuse=stations.length&&draft.step==="name"?h("label",{className:"block text-sm"},L("Mövcud printerdən istifadə et","Mevcut yazıcıyı kullan","Use a saved printer"),h("select",{className:field,value:"",onChange:e=>{const row=stations.find(s=>s.id===e.target.value);if(row)keep(row.printer);}},h("option",{value:""},L("Printer seçin","Yazıcı seçin","Select printer")),...stations.map(s=>h("option",{key:s.id,value:s.id},s.name+" · "+s.printer)))):null;
    const nothing = Array.isArray(found) && found.length === 0;
    const candidate = draft.step === "search" && !manual && at >= 0 && at < list.length ? list[at] : null;
    const okLabel = [L("OK — bu ", "Tamam — bu ", "OK — this is the "), name, L(" printeridir", " yazıcısı", " printer")];
    const stepSearch = draft.step === "search" ? h("div", { className: "space-y-3 border-t border-hairline pt-3" },
      busy && found === null ? h("p", { className: "text-sm text-muted" }, L("Axtarılır…", "Aranıyor…", "Searching…")) : null,
      note ? h("p", { className: "text-sm text-warning" }, note) : null,
      nothing && !manual ? h("div", { className: "flex flex-wrap gap-2" },
        h("button", { type: "button", disabled: busy, className: primary, onClick: () => void search("usb") }, L("USB-də yenidən axtar", "USB'de yeniden ara", "Search USB again")),
        h("button", { type: "button", disabled: busy, className: primary, onClick: () => void search("network") }, L("LAN-da yenidən axtar", "LAN'da yeniden ara", "Search LAN again")),
        h("button", { type: "button", className: quiet, onClick: () => { setManual(true); setNote(""); } }, L("Əl ilə yaz", "Elle yaz", "Type it"))) : null,
      !nothing && !manual && Array.isArray(found) && at >= found.length ? h("button", { type: "button", className: quiet, onClick: () => { setManual(true); setNote(""); } }, L("Əl ilə yaz", "Elle yaz", "Type it")) : null,
      candidate ? h("div", { className: "rounded-xl border border-hairline bg-elevated px-4 py-3" },
        h("p", { className: "text-xs text-faint" }, at + 1, " / ", list.length),
        h("p", { className: "mt-1 truncate text-sm font-medium text-cream" }, candidate.displayName || candidate.name),
        h("p", { className: "mt-0.5 truncate font-mono text-xs text-faint" }, candidate.name),
        h("p", { className: "mt-2 text-sm text-cream" }, L("Bu cihaza yoxlama vərəqi göndərildi. ", "Bu cihaza test sayfası gönderildi. ", "A test page was sent to this device. "), name, L(" printerindən kağız çıxdı?", " yazıcısından kağıt çıktı mı?", " printer printed it?")),
        h("div", { className: "mt-2 flex flex-wrap gap-2" },
          h("button", { type: "button", disabled: busy || !printed, className: yes, onClick: () => keep(candidate.name) }, ...okLabel),
          h("button", { type: "button", disabled: busy, className: quiet, onClick: () => void probe(list, at + 1) }, L("Yox — növbətini yoxla", "Hayır — sonrakini dene", "No — try the next")))) : null,
      manual ? h("div", { className: "rounded-xl border border-hairline bg-elevated px-4 py-3" },
        h("p", { className: "text-xs uppercase tracking-wide text-faint" }, L("Printerin ünvanı", "Yazıcının adresi", "Printer address")),
        h("input", { type: "text", value: address, placeholder: "tcp:192.168.1.51:9100", onChange: (e) => setAddress(e.target.value), className: field + " font-mono" }),
        h("p", { className: "mt-1 text-xs text-faint" }, "Şəbəkə printeri: tcp:IP:9100 · Windows növbəsi: adını yazın"),
        h("div", { className: "mt-2 flex flex-wrap gap-2" },
          h("button", { type: "button", disabled: busy || !address.trim(), className: "touch-target rounded-xl border border-gold/40 px-4 py-2 text-sm text-gold disabled:opacity-40",
            onClick: async () => { setBusy(true); const ok = await testPage(address.trim()); setBusy(false); if (ok) toast(L("Yoxlama vərəqi göndərildi", "Test sayfası gönderildi", "Test page sent"), "success"); } }, busy ? "…" : "Test çap"),
          h("button", { type: "button", disabled: !address.trim(), className: yes, onClick: () => keep(address.trim()) }, ...okLabel))) : null) : null;

    const stepKind = draft.step === "kind" ? h("div", { className: "space-y-3 border-t border-hairline pt-3" },
      h("p", { className: "ps-printer-role-status is-ready" }, name, ": ", draft.printer),
      h("p",{className:"text-sm text-cream"},L("Bu cihaz hansı çekləri çap etsin? Bir neçə iş seçə bilərsiniz.","Bu cihaz hangi fişleri yazdırsın? Birden fazla görev seçebilirsiniz.","Which receipts should this device print? Select more than one if needed.")),
      h("div",{className:"flex flex-wrap gap-3"},...KINDS.map(([id,text])=>h("label",{key:id,className:"flex items-center gap-2 rounded-xl border border-hairline px-4 py-3"},h("input",{type:"checkbox",style:{width:18,height:18},checked:id==="kitchen"?!!draft.kitchenEnabled:psPrinterRoles(draft).includes(id),onChange:()=>togglePurpose(id),disabled:busy}),text))),
      draft.kitchenEnabled?h("label",{className:"block text-sm"},L("Mətbəx çapının növü","Mutfak baskı türü","Kitchen ticket routing"),h("select",{className:field,value:draft.main?"all":"selected",onChange:e=>setDraft(d=>({...d,main:e.target.value==="all"}))},h("option",{value:"all"},L("Bütün yeməklər — əsas mətbəx","Tüm yemekler — ana mutfak","All dishes — main kitchen")),h("option",{value:"selected"},L("Seçilmiş yeməklər — dönər, bar və s.","Seçili yemekler — döner, bar vb.","Selected dishes — grill, bar, etc.")))):null,
      draft.kitchenEnabled&&!draft.main?h("p",{className:"text-xs text-muted"},L("Menyu bölməsində yeməyi açın və Printer sahəsindən bu printeri seçin. Kassa çeki də eyni cihazdan çıxa bilər.","Menüde ürünü açıp Yazıcı alanından bu cihazı seçin. Kasa fişi de aynı cihazdan çıkabilir.","Open a dish in the Menu and choose this printer. Till receipts can use this same device.")):null,
      h("div", { className: "flex flex-wrap gap-2" },
        h("button", { type: "button", disabled: busy || (!draft.kitchenEnabled&&!psPrinterRoles(draft).length), className: yes, onClick: () => void save() }, L("Yadda saxla", "Kaydet", "Save")),
        h("button", { type: "button", disabled: busy, className: quiet, onClick: () => setDraft((d) => ({ ...d, step: "search" })) }, L("Geri", "Geri", "Back")))) : null;

    wizard = h("div", { className: "ps-printer-role is-open" },
      h("p", { className: "ps-printer-role-title" }, stations.some((s) => s.id === draft.id) ? L("Printeri dəyişdir", "Yazıcıyı değiştir", "Change printer") : L("Yeni printer", "Yeni yazıcı", "New printer")),
      h("div", { className: "mt-3 space-y-3" }, stepName, reuse, stepSearch, stepKind),
      stations.length ? h("button", { type: "button", disabled: busy, className: quiet + " mt-3", onClick: () => { setDraft(null); resetSearch(); } }, L("Bağla", "Kapat", "Close")) : null);
  }

  if(!loaded)return h("section",{className:"ps-printer-section"},h("p",{role:note?"alert":"status"},note||L("Printerlər yüklənir…","Yazıcılar yükleniyor…","Loading saved printers…")),note?h("button",{className:quiet,onClick:()=>location.reload()},L("Yenidən yoxla","Yeniden dene","Try again")):null);
  return h("section", { className: "ps-printer-section space-y-4" },
    h("h2", { className: "font-display text-lg text-cream" }, L("Printerlər", "Yazıcılar", "Printers")),
    h(PsXprinterNetwork),
    h("p", { className: "text-sm text-muted" }, L("Printerin adını yazın və Axtar basın.", "Yazıcının adını yazıp Ara'ya basın.", "Type the printer's name and press Search.")),
    note&&draft?.step!=="search"?h("p",{role:"alert",className:"text-warning"},note):null,
    h("div", { className: "ps-printer-setup space-y-2" }, saved, wizard,
      !draft ? h("button", { type: "button", className: primary, onClick: () => startNew() }, L("+ Printer əlavə et", "+ Yazıcı ekle", "+ Add printer")) : null),
    confirmDialog);
}
